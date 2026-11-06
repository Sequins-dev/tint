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
  // Both images omit the two redundant jumps to adjacent function entry blocks.
  for (const [options, length, hash] of [
    [
      {},
      816,
      "587ead8db6e28de774e947f1e1da700445f509fbf9299060a7cee75e0c2464a5",
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
      920,
      "269ccc87e6b47161ecb3b7bb5a05ed9b403fb2e2a93ffb1e85f16495401ac4fe",
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
