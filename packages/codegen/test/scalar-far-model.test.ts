// The large code model (docs/large-images.md): far-model modules address
// their pools and helpers through 48-bit ADR/MOVZ/MOVK/MOVK/ADD sequences,
// switch to it on their own from farModuleBytes on, and long branches the
// unconditional B cannot reach become an x16 address sequence and BR.
import assert from "node:assert/strict";
import test from "node:test";
import type { Block, FunctionIR } from "@tint/ir/scalar";
import { emitModule } from "../src/aarch64/scalar/index.ts";
const s = { start: 0, end: 0 };

function words(code: Uint8Array, offset: number, byteLength: number): number[] {
  const view = new DataView(code.buffer, code.byteOffset);
  return Array.from({ length: byteLength / 4 }, (_, index) =>
    view.getUint32(offset + index * 4, true),
  );
}
const adr = (word: number, rd: number) =>
  (word & 0x9f00001f) >>> 0 === (0x10000000 | rd) >>> 0;
const movz = (word: number, rd: number) =>
  (word & 0xffe0001f) >>> 0 === (0xd2800000 | rd) >>> 0;
const movk = (word: number, rd: number, hw: number) =>
  (word & 0xffe0001f) >>> 0 === (0xf2800000 | (hw << 21) | rd) >>> 0;
/** Targets of every far sequence for `rd` in `code` (based at `base`). */
function farTargets(code: readonly number[], base: number, rd: number) {
  const targets: number[] = [];
  for (let index = 0; index + 4 < code.length; index++) {
    const w = code;
    if (
      !adr(w[index]!, rd) ||
      !movz(w[index + 1]!, 17) ||
      !movk(w[index + 2]!, 17, 1) ||
      !movk(w[index + 3]!, 17, 2)
    )
      continue;
    const imm = (word: number) => (word >>> 5) & 0xffff;
    const magnitude =
      imm(w[index + 1]!) +
      imm(w[index + 2]!) * 65536 +
      imm(w[index + 3]!) * 4294967296;
    const subtract = (w[index + 4]! & 0xff000000) >>> 0 === 0xcb000000;
    targets.push(base + index * 4 + (subtract ? -magnitude : magnitude));
  }
  return targets;
}
/** Near (four-instruction) sequences for `rd`: ADR, MOVZ, MOVK #16, ADD. */
function nearSequences(code: readonly number[], rd: number): number {
  let count = 0;
  for (let index = 0; index + 3 < code.length; index++)
    if (
      adr(code[index]!, rd) &&
      movz(code[index + 1]!, 17) &&
      movk(code[index + 2]!, 17, 1) &&
      !movk(code[index + 3]!, 17, 2)
    )
      count++;
  return count;
}
function literal(id: number, body: Block["instructions"] = []): FunctionIR {
  return {
    id,
    name: "literal" + id,
    exported: true,
    parameters: [0, 1],
    slots: ["boolean", "number"],
    returnType: "string",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          ...body,
          { kind: "string-literal", id: 1, value: "far pooled", ...s },
        ],
        terminator: { kind: "return", value: 1, ...s },
      },
    ],
  };
}
function guarded(id: number, body: Block["instructions"]): FunctionIR {
  return {
    id,
    name: "guarded" + id,
    exported: true,
    parameters: [0, 1],
    slots: ["boolean", "number"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [{ kind: "load", id: 0, slot: 0, ...s }],
        terminator: {
          kind: "branch",
          condition: 0,
          consequent: 1,
          alternate: 2,
          ...s,
        },
      },
      {
        id: 1,
        instructions: body,
        terminator: { kind: "jump", target: 2, ...s },
      },
      {
        id: 2,
        instructions: [{ kind: "load", id: 1, slot: 1, ...s }],
        terminator: { kind: "return", value: 1, ...s },
      },
    ],
  };
}
function oversized(count: number): Block["instructions"] {
  const body: Block["instructions"][number][] = [];
  for (let index = 0; index < count; index++) {
    body.push({
      kind: "constant",
      id: 1000000 + index * 2,
      value: index + 0.5,
      ...s,
    });
    body.push({ kind: "store", slot: 1, value: 1000000 + index * 2, ...s });
  }
  return body;
}

test("far-model modules address their literal pool with 48-bit sequences", () => {
  const near = emitModule(
    { functions: [literal(0)] },
    { compactAddresses: false },
  );
  assert.ok(near.ok, JSON.stringify(near));
  const far = emitModule(
    { functions: [literal(0)] },
    { compactAddresses: false, farAddresses: true },
  );
  assert.ok(far.ok, JSON.stringify(far));
  assert.equal(near.value.formHints?.far, undefined);
  assert.equal(far.value.formHints?.far, true);
  const fn = far.value.functions[0]!,
    code = words(far.value.code, fn.offset, fn.byteLength),
    pooled = far.value.strings.find((item) => item.value === "far pooled");
  assert.ok(pooled);
  assert.ok(farTargets(code, fn.offset, 9).includes(pooled.offset));
  assert.equal(nearSequences(code, 9), 0);
  // One instruction per far site: the same function, four bytes longer
  // for each relocatable address it materializes.
  const nearFn = near.value.functions[0]!;
  assert.ok(fn.byteLength > nearFn.byteLength);
  assert.equal((fn.byteLength - nearFn.byteLength) % 4, 0);
});

test("modules from farModuleBytes on switch to the far model on their own", () => {
  const emitted = emitModule(
    { functions: [literal(0)] },
    { compactAddresses: false, farModuleBytes: 64 },
  );
  assert.ok(emitted.ok, JSON.stringify(emitted));
  assert.equal(emitted.value.formHints?.far, true);
  const fn = emitted.value.functions[0]!;
  assert.equal(
    nearSequences(words(emitted.value.code, fn.offset, fn.byteLength), 9),
    0,
  );
  // farAddresses: false keeps the near model regardless of size.
  const pinned = emitModule(
    { functions: [literal(0)] },
    { compactAddresses: false, farModuleBytes: 64, farAddresses: false },
  );
  assert.ok(pinned.ok);
  assert.equal(pinned.value.formHints?.far, undefined);
});

test("long branches beyond B's reach use an x16 address sequence and BR", () => {
  // A function past conditional reach takes long branches; the far-branch
  // form (forced here through the form hints, chosen automatically when a
  // B cannot reach) replaces each B with ADR/MOVZ/MOVK/ADD x16 and BR x16.
  const module = { functions: [guarded(0, oversized(90000))] };
  for (const far of [false, true]) {
    const emitted = emitModule(module, {
      farAddresses: far,
      formHints: {
        calls: true,
        longBranches: ["guarded0"],
        islands: [],
        longAddresses: [],
        farBranches: ["guarded0"],
      },
    });
    assert.ok(emitted.ok, JSON.stringify(emitted));
    assert.deepEqual(emitted.value.formHints?.farBranches, ["guarded0"]);
    const fn = emitted.value.functions[0]!;
    assert.ok(fn.byteLength > 1 << 20);
    const code = words(emitted.value.code, fn.offset, fn.byteLength);
    const br = code.findIndex((word) => word === 0xd61f0200);
    assert.ok(br > 0, "BR x16");
    const length = far ? 5 : 4,
      start = br - length;
    assert.ok(adr(code[start]!, 16), "address sequence before BR");
    // The inverted conditional skip jumps over the sequence and the BR.
    const skip = code[start - 1]!;
    const isCompare = (skip & 0x7e000000) === 0x34000000;
    const isCond = (skip & 0xff000010) >>> 0 === 0x54000000;
    assert.ok(isCompare || isCond);
    const displacement = (((skip >>> 5) & 0x7ffff) << 13) >> 13;
    assert.equal(displacement * 4, (length + 2) * 4);
    // The target is the join block, inside the function after the body.
    const imm = (word: number) => (word >>> 5) & 0xffff;
    let magnitude = imm(code[start + 1]!) + imm(code[start + 2]!) * 65536;
    if (far) magnitude += imm(code[start + 3]!) * 4294967296;
    const target = fn.offset + start * 4 + magnitude;
    assert.ok(target > fn.offset + (1 << 20));
    assert.ok(target < fn.offset + fn.byteLength);
  }
});
