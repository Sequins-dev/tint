import assert from "node:assert/strict";
import test from "node:test";
import { verify, type ModuleIR } from "../src/scalar/index.ts";
const s = { start: 0, end: 0 };
function fixture(proven: boolean): ModuleIR {
  return {
    records: [
      {
        byteLength: 32,
        fields: [{ offset: 16, type: "number", mutable: true }],
      },
    ],
    functions: [
      {
        id: 0,
        name: "read",
        exported: true,
        parameters: [0],
        slots: ["reference"],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "constant", id: 0, value: 42, ...s },
              proven
                ? { kind: "record-new", id: 1, record: 0, arguments: [0], ...s }
                : { kind: "load", id: 1, slot: 0, ...s },
              {
                kind: "record-read",
                id: 2,
                object: 1,
                record: 0,
                field: 0,
                ...s,
              },
            ],
            terminator: { kind: "return", value: 2, ...s },
          },
        ],
      },
    ],
  };
}
test("field reads require a verified layout proof, not a reference annotation", () => {
  assert.deepEqual(verify(fixture(true)), { ok: true });
  assert.equal(verify(fixture(false)).ok, false);
});

test("layout effect discovery does not rescan the module for each function", () => {
  const base = fixture(true);
  let visits = 0;
  const functions = Array.from({ length: 128 }, (_, id) => ({
    ...base.functions[0]!,
    id,
    name: `read${id}`,
  }));
  const first = functions[0]!;
  functions[0] = {
    ...first,
    blocks: first.blocks.map((block) => ({
      ...block,
      instructions: block.instructions.map((op) =>
        op.kind !== "constant"
          ? op
          : {
              ...op,
              get kind(): "constant" {
                visits++;
                return "constant";
              },
            },
      ),
    })),
  };
  assert.deepEqual(verify({ ...base, functions }), { ok: true });
  assert.ok(
    visits < 64,
    `first instruction inspected ${visits} times for module effects`,
  );
});
