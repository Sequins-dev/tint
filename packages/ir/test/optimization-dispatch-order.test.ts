import assert from "node:assert/strict";
import test from "node:test";
import { verify, type FunctionIR, type ModuleIR } from "@tint/ir/scalar";
import { orderRecordDispatch } from "../src/optimization/dispatch-order.ts";
const s = { start: 0, end: 0 };

/** Three layouts; candidate r reads field r (a different offset each); `read(x)` reads
 * it through a union chain testing layouts 0, 1, 2 in that order. `main`
 * allocates `allocated` (one record-new per entry) and passes the last one. */
function fixture(allocated: readonly number[]): ModuleIR {
  const chainBlock = (id: number, record: number, next: number) => ({
    id,
    instructions: [{ kind: "load" as const, id: 10 + id, slot: 0, ...s }],
    terminator: {
      kind: "record" as const,
      object: 10 + id,
      record,
      field: record,
      operation: "read" as const,
      slot: 1,
      consequent: 3,
      alternate: next,
      ...s,
    },
  });
  const read: FunctionIR = {
    id: 1,
    name: "read",
    exported: false,
    parameters: [0],
    slots: ["reference", "number"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [{ kind: "load", id: 0, slot: 0, ...s }],
        terminator: {
          kind: "record",
          object: 0,
          record: 0,
          field: 0,
          operation: "read",
          slot: 1,
          consequent: 3,
          alternate: 1,
          ...s,
        },
      },
      chainBlock(1, 1, 2),
      chainBlock(2, 2, 4),
      {
        id: 3,
        instructions: [{ kind: "load", id: 1, slot: 1, ...s }],
        terminator: { kind: "return", value: 1, ...s },
      },
      { id: 4, instructions: [], terminator: { kind: "trap", ...s } },
    ],
  };
  const instructions: FunctionIR["blocks"][number]["instructions"][number][] = [
    { kind: "constant", id: 0, value: 1, ...s },
  ];
  let last = 0;
  for (const record of allocated) {
    last = instructions.length;
    instructions.push({
      kind: "record-new",
      id: last,
      record,
      arguments: [0, 0, 0],
      ...s,
    });
  }
  instructions.push({
    kind: "call",
    id: 100,
    target: 1,
    arguments: [last],
    ...s,
  });
  const main: FunctionIR = {
    id: 0,
    name: "main",
    exported: true,
    parameters: [],
    slots: [],
    returnType: "number",
    entry: 0,
    blocks: [
      { id: 0, instructions, terminator: { kind: "return", value: 100, ...s } },
    ],
  };
  const field = (offset: number) => ({
    offset,
    type: "number" as const,
    mutable: true,
  });
  return {
    records: [
      { byteLength: 48, fields: [field(16), field(24), field(32)] },
      { byteLength: 48, fields: [field(16), field(24), field(32)] },
      { byteLength: 48, fields: [field(16), field(24), field(32)] },
    ],
    functions: [main, read],
  };
}
function order(module: ModuleIR): number[] {
  const read = module.functions[1]!;
  return [0, 1, 2].map((id) => {
    const t = read.blocks[id]!.terminator;
    assert.equal(t.kind, "record");
    if (t.kind !== "record") return -1;
    assert.equal(t.field, t.record, "each candidate keeps its own field");
    return t.record;
  });
}

test("union read chains test the most allocated layout first", () => {
  const module = fixture([2, 2, 1]);
  assert.deepEqual(verify(module), { ok: true });
  const result = orderRecordDispatch(module, 100000);
  assert.ok(result);
  assert.equal(result.rewritten, 1);
  assert.deepEqual(verify(result.module), { ok: true });
  // Layout 2 (two sites), then 1 (one), then 0 (none); the failure edge stays.
  assert.deepEqual(order(result.module), [2, 1, 0]);
  const tail = result.module.functions[1]!.blocks[2]!.terminator;
  assert.ok(tail.kind === "record" && tail.alternate === 4);
});

test("ties and an already ordered chain keep source order", () => {
  for (const allocated of [
    [0, 1, 2],
    [0, 0, 1],
  ]) {
    const result = orderRecordDispatch(fixture(allocated), 100000);
    assert.ok(result);
    assert.equal(result.rewritten, 0);
    assert.deepEqual(order(result.module), [0, 1, 2]);
  }
  assert.equal(orderRecordDispatch(fixture([2]), 3), undefined);
});
