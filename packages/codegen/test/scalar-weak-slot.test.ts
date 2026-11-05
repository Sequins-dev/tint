import test from "node:test";
import assert from "node:assert/strict";
import type { ModuleIR } from "@tint/ir/scalar";
import { emitModule } from "../src/aarch64/scalar/index.ts";
const s = { start: 0, end: 0 };
const module: ModuleIR = {
  functions: [
    {
      id: 0,
      name: "weak",
      exported: true,
      parameters: [0, 1, 2],
      slots: ["general", "general", "boolean"],
      returnType: "general",
      entry: 0,
      blocks: [
        {
          id: 0,
          instructions: [
            { kind: "load", id: 0, slot: 0, ...s },
            { kind: "load", id: 1, slot: 1, ...s },
            { kind: "load", id: 2, slot: 2, ...s },
            {
              kind: "weak-slot-new",
              id: 3,
              key: 0,
              value: 1,
              ephemeron: 2,
              ...s,
            },
            { kind: "weak-slot-key", id: 4, cell: 3, ...s },
            { kind: "weak-slot-value", id: 5, cell: 3, ...s },
            { kind: "weak-slot-set-value", cell: 3, value: 1, ...s },
            { kind: "weak-slot-clear", cell: 3, ...s },
          ],
          terminator: { kind: "return", value: 4, ...s },
        },
      ],
    },
  ],
};
test("weak operations emit with rooted general values across both allocation paths", () => {
  for (const linearAllocation of [false, true]) {
    const result = emitModule(module, { linearAllocation });
    assert.ok(result.ok, JSON.stringify(result));
  }
});
test("generational weak operations fail closed until the old-generation barrier contract is supported", () => {
  const result = emitModule(module, { generationalBarriers: true });
  assert.equal(result.ok, false);
  if (!result.ok)
    assert.match(result.error.message, /weak.*generational|generational.*weak/);
});
