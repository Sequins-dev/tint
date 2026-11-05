import { test } from "node:test";
import assert from "node:assert/strict";
import { verify, type ModuleIR } from "@tint/ir/scalar";
import { emitModule } from "@tint/codegen/aarch64/scalar";
const span = { start: 0, end: 1 };
export function recordPredicate(record: number = 0): ModuleIR {
  return {
    records: [{ byteLength: 16, fields: [] }],
    functions: [
      {
        id: 0,
        name: "matches",
        exported: true,
        parameters: [0],
        slots: ["general"],
        returnType: "boolean",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load", id: 0, slot: 0, ...span },
              { kind: "general-record-is", id: 1, value: 0, record, ...span },
            ],
            terminator: { kind: "return", value: 1, ...span },
          },
        ],
      },
    ],
  };
}
test("general record predicates validate descriptors and emit without allocation helpers", () => {
  assert.ok(verify(recordPredicate()).ok);
  assert.equal(verify(recordPredicate(1)).ok, false);
  const result = emitModule(recordPredicate());
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.value.helpers.length, 0);
  assert.equal(result.value.records.length, 1);
});
