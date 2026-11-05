import assert from "node:assert/strict";
import { test } from "node:test";
import { verify } from "@tint/ir/scalar";
import { emitModule } from "@tint/codegen/aarch64/scalar";
import { optimizeModule } from "@tint/ir/optimization";
import { functionEnvironmentFixture } from "./function-environment-fixture.ts";

test("function environments survive optimization and native emission", () => {
  for (const present of [false, true]) {
    const module = functionEnvironmentFixture(present);
    assert.ok(verify(module).ok, JSON.stringify(verify(module)));
    const optimized = optimizeModule(module).module;
    assert.ok(verify(optimized).ok, JSON.stringify(verify(optimized)));
    for (const input of [module, optimized]) {
      const emitted = emitModule(input);
      assert.ok(emitted.ok, JSON.stringify(emitted));
    }
  }
});

test("environment inspection alone emits a function descriptor with its managed edge", () => {
  const emitted = emitModule({
    functions: [
      {
        id: 0,
        name: "inspect",
        exported: true,
        parameters: [0],
        slots: ["reference"],
        returnType: "optional-reference",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load", id: 0, slot: 0, start: 0, end: 0 },
              {
                kind: "function-environment",
                id: 1,
                callee: 0,
                start: 0,
                end: 0,
              },
            ],
            terminator: { kind: "return", value: 1, start: 0, end: 0 },
          },
        ],
      },
    ],
  });
  assert.ok(emitted.ok, JSON.stringify(emitted));
  assert.equal(emitted.value.records.length, 1);
  assert.deepEqual(emitted.value.records[0]?.referenceOffsets, [24]);
});
