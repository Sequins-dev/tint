import assert from "node:assert/strict";
import test from "node:test";
import { emitModule } from "../src/aarch64/scalar/index.ts";
import { verify, type ModuleIR } from "@tint/ir/scalar";
const s = { start: 0, end: 0 };

/** pushList's shape: a reference parameter copied into a local slot that is
 * used before an allocating call and dead after it. The local can take a
 * callee-saved register home, whose store writes only the register. */
const module: ModuleIR = {
  records: [
    { byteLength: 32, fields: [{ offset: 16, type: "number", mutable: true }] },
  ],
  functions: [
    {
      id: 0,
      name: "push",
      exported: true,
      parameters: [0, 1],
      slots: ["reference", "optional-reference", "reference"],
      returnType: "number",
      entry: 0,
      blocks: [
        {
          id: 0,
          instructions: [
            { kind: "load", id: 0, slot: 0, ...s },
            { kind: "store", slot: 2, value: 0, ...s },
            { kind: "load", id: 1, slot: 2, ...s },
            { kind: "load", id: 2, slot: 1, ...s },
            { kind: "load", id: 3, slot: 2, ...s },
            { kind: "call", id: undefined, target: 1, arguments: [1], ...s },
            { kind: "constant", id: 4, value: 7, ...s },
          ],
          terminator: { kind: "return", value: 4, ...s },
        },
      ],
    },
    {
      id: 1,
      name: "allocate",
      exported: false,
      parameters: [0],
      slots: ["reference"],
      returnType: "void",
      entry: 0,
      blocks: [
        {
          id: 0,
          instructions: [
            { kind: "constant", id: 0, value: 1, ...s },
            { kind: "record-new", id: 1, record: 0, arguments: [0], ...s },
          ],
          terminator: { kind: "return", value: undefined, ...s },
        },
      ],
    },
  ],
};

/** Stack offsets STR Xt/STP Xt1,Xt2 (unsigned/signed offset, base SP) write. */
function spStores(word: number): number[] {
  if ((word & 0xffc003e0) >>> 0 === 0xf90003e0)
    return [((word >>> 10) & 4095) * 8];
  if ((word & 0xffc003e0) >>> 0 === 0xa90003e0) {
    let imm = (word >>> 15) & 127;
    if (imm >= 64) imm -= 128;
    return [imm * 8, imm * 8 + 8];
  }
  return [];
}

test("every root word is written before the first collection, including register-homed slots", () => {
  assert.deepEqual(verify(module), { ok: true });
  for (const closedRoots of [[0], undefined]) {
    const emitted = emitModule(module, {
      maxByteLength: 0xffffffff,
      debugSpans: false,
      linearAllocation: false,
      generationalBarriers: false,
      ...(closedRoots === undefined ? {} : { closedRoots }),
    });
    assert.ok(emitted.ok, JSON.stringify(emitted));
    const fn = emitted.value.functions[0]!,
      frame = emitted.value.roots.find((root) => root.function === 0);
    assert.ok(frame, "the caller publishes a root frame");
    const view = new DataView(emitted.value.code.buffer),
      written = new Set<number>();
    // The prologue's stack-overflow exit (BL then RET) is not a collection
    // of this frame: scan to the BL that follows the frame's publication.
    let calls = 0;
    for (
      let offset = fn.offset;
      offset < fn.offset + fn.byteLength;
      offset += 4
    ) {
      const word = view.getUint32(offset, true);
      for (const at of spStores(word)) written.add(at);
      if ((word & 0xfc000000) >>> 0 === 0x94000000 && ++calls === 2) break;
    }
    assert.equal(calls, 2, "the allocating call follows the prologue");
    for (const root of frame.offsets)
      assert.ok(
        written.has(frame.frameOffset + root),
        `root word sp+${frame.frameOffset + root} is initialized before the call`,
      );
  }
});
