import assert from "node:assert/strict";
import test from "node:test";
import { traceModuleReferences } from "../src/optimization/reachability.ts";
import type { ModuleIR } from "@tint/ir/scalar";
const span = { start: 0, end: 0 };
test("reachability retains unique sparse record IDs without scanning unused layouts", () => {
  const module: ModuleIR = {
    records: Array.from({ length: 10000 }, () => ({
      byteLength: 16,
      fields: [],
    })),
    functions: [
      {
        id: 0,
        name: "root",
        exported: true,
        parameters: [],
        slots: [],
        returnType: "reference",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              {
                kind: "record-new",
                id: 0,
                record: 9999,
                arguments: [],
                ...span,
              },
              { kind: "record-new", id: 1, record: 2, arguments: [], ...span },
              {
                kind: "record-new",
                id: 2,
                record: 9999,
                arguments: [],
                ...span,
              },
            ],
            terminator: { kind: "return", value: 2, ...span },
          },
        ],
      },
    ],
  };
  const result = traceModuleReferences(module, [0], 10)!;
  assert.ok(result);
  assert.deepEqual(result.recordIds, [9999, 2]);
  assert.equal(result.records[9999], 1);
  assert.equal(result.records[2], 1);
  assert.ok(result.work <= 10);
});
