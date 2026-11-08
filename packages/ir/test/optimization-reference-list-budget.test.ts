import assert from "node:assert/strict";
import test from "node:test";
import type { ModuleIR, FunctionIR } from "@tint/ir/scalar";
import { referenceListWorkBudget } from "../src/optimization/reference-lists.ts";

function program(functions: number, instructionsPerBlock: number): ModuleIR {
  const list: FunctionIR[] = [];
  for (let id = 0; id < functions; id++)
    list.push({
      id,
      name: "f" + id,
      parameters: [],
      slots: ["number"],
      returnType: "void",
      blocks: [
        {
          id: 0,
          instructions: Array.from({ length: instructionsPerBlock }, () => ({
            kind: "load" as const,
            id: 0,
            slot: 0,
            start: 0,
            end: 0,
          })),
          terminator: { kind: "return" as const },
        },
      ],
    } as unknown as FunctionIR);
  return { functions: list, records: [] };
}

test("dense list proof budget keeps a floor and scales with module size", () => {
  assert.equal(referenceListWorkBudget(program(2, 3)), 10000000);
  // 300,000 functions of 9 instructions and one block each: 3,000,000 units.
  assert.equal(referenceListWorkBudget(program(300000, 9)), 24000000);
});
