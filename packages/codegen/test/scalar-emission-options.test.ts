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
  // Each record descriptor is preceded by two dispatch family words and its
  // 8-byte record index. Number
  // constants materialize only their nonzero 16-bit parts.
  for (const [options, length, hash] of [
    [
      {},
      776,
      "05c5e65d9ee41b573554afcac8a645049a5da8203259ba7e2f7285bdd82794cc",
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
      880,
      "a46935be1aa67858b473d0859189efc1c2832224154520ceb3d9615a331a0f8c",
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
