import { darwinHostABI } from "@tint/platform/darwin/host-abi";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { ModuleIR } from "@tint/ir/scalar";
import { emitModule } from "../src/aarch64/scalar/index.ts";
const span = { start: 1, end: 2 };
function fixture(): ModuleIR {
  return {
    functions: [
      {
        id: 0,
        name: "entry",
        exported: true,
        parameters: [],
        slots: [],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "function-new", id: 0, target: 1, ...span },
              {
                kind: "call-indirect",
                id: 1,
                target: 1,
                callee: 0,
                arguments: [],
                ...span,
              },
            ],
            terminator: { kind: "return", value: 1, ...span },
          },
        ],
      },
      {
        id: 1,
        name: "answer",
        exported: false,
        parameters: [],
        slots: [],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [{ kind: "constant", id: 0, value: 42, ...span }],
            terminator: { kind: "return", value: 0, ...span },
          },
        ],
      },
    ],
  };
}
test("emission options preserve default and configured byte images", () => {
  // Both images omit redundant entry jumps. The closed image defers temporary
  // root initialization to its allocating block; the open image is unchanged.
  // Each record descriptor is preceded by its 8-byte record index.
  for (const [options, length, hash] of [
    [
      {},
      768,
      "784d2a2844f8ec6f484b9b69a3bd18c423efbac036d90695013e70d8fb2557da",
    ],
    [
      {
        maxByteLength: 0xffffffff,
        hostABI: darwinHostABI(),
        debugSpans: true,
        linearAllocation: true,
        generationalBarriers: false,
        closedRoots: [0],
      },
      872,
      "2128d6535773e74c25a910e39fb29f981915ee941c3adf74b5a113383b45426a",
    ],
  ] as const) {
    const r = emitModule(fixture(), options);
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(r.value.code.length, length);
    assert.equal(createHash("sha256").update(r.value.code).digest("hex"), hash);
  }
});

test("emission options retain explicit invalid-budget rejection", () => {
  for (const budget of [NaN, 0, 3, Infinity, 0x100000000, null]) {
    const r = emitModule(fixture(), { maxByteLength: budget as number });
    assert.equal(r.ok, false, String(budget));
  }
});

test("analysis emission reports block offsets without changing the code", () => {
  const plain = emitModule(fixture());
  const analysed = emitModule(fixture(), { analysis: true });
  assert.ok(plain.ok && analysed.ok);
  assert.deepEqual(analysed.value.code, plain.value.code);
  assert.equal(plain.value.blocks, undefined);
  const blocks = analysed.value.blocks!;
  const module = fixture();
  assert.equal(blocks.length, module.functions.length);
  module.functions.forEach((fn, index) => {
    const native = analysed.value.functions[index]!;
    const starts = blocks[index]!;
    assert.equal(starts.length, fn.blocks.length);
    // The entry block starts inside its function; emitted blocks stay in range.
    for (const start of starts)
      if (start >= 0)
        assert.ok(
          start >= native.offset && start < native.offset + native.byteLength,
        );
    assert.ok(starts.some((start) => start >= 0));
  });
});
