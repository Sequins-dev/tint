import { test } from "node:test";
import assert from "node:assert/strict";
import { verify, type FunctionIR, type Instruction } from "@tint/ir/scalar";
import {
  selectArrayAccesses,
  versionNonzeroDivisors,
} from "@tint/ir/optimization";

const span = { start: 0, end: 0 };
/** `sum(n)`: d = n | 0; total = 0; for (i = 0; i < 10; i++) total += i % d;
 * return total. Slots: 0 d, 1 i, 2 total, 3 n. `written` also stores to d
 * in the loop body. */
function loop(options: {
  readonly facts: boolean;
  readonly written?: boolean;
}): FunctionIR {
  const body: Instruction[] = [
    { kind: "load", id: 10, slot: 2, ...span },
    { kind: "load", id: 11, slot: 1, ...span },
    { kind: "load", id: 12, slot: 0, ...span },
    { kind: "binary", id: 13, operator: "%", left: 11, right: 12, ...span },
    { kind: "binary", id: 14, operator: "+", left: 10, right: 13, ...span },
    { kind: "store", slot: 2, value: 14, ...span },
    { kind: "constant", id: 15, value: 1, ...span },
    { kind: "binary", id: 16, operator: "+", left: 11, right: 15, ...span },
    { kind: "store", slot: 1, value: 16, ...span },
  ];
  if (options.written === true)
    body.push({ kind: "store", slot: 0, value: 15, ...span });
  return {
    id: 0,
    name: "sum",
    exported: true,
    parameters: [3],
    slots: ["number", "number", "number", "number"],
    ...(options.facts ? { integerSlots: [0, 1, 2] } : {}),
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "load", id: 6, slot: 3, ...span },
          { kind: "constant", id: 1, value: 0, ...span },
          { kind: "binary", id: 0, operator: "|", left: 6, right: 1, ...span },
          { kind: "store", slot: 0, value: 0, ...span },
          { kind: "store", slot: 1, value: 1, ...span },
          { kind: "store", slot: 2, value: 1, ...span },
        ],
        terminator: { kind: "jump", target: 1, ...span },
      },
      {
        id: 1,
        instructions: [
          { kind: "load", id: 2, slot: 1, ...span },
          { kind: "constant", id: 3, value: 10, ...span },
          { kind: "binary", id: 4, operator: "<", left: 2, right: 3, ...span },
        ],
        terminator: {
          kind: "branch",
          condition: 4,
          consequent: 2,
          alternate: 3,
          ...span,
        },
      },
      {
        id: 2,
        instructions: body,
        terminator: { kind: "jump", target: 1, ...span },
      },
      {
        id: 3,
        instructions: [{ kind: "load", id: 5, slot: 2, ...span }],
        terminator: { kind: "return", value: 5, ...span },
      },
    ],
  };
}
/** The slots `%` divides by, in block order. */
function divisorSlots(fn: FunctionIR): number[] {
  const slots: number[] = [];
  for (const block of fn.blocks) {
    const loaded = new Map<number, number>();
    for (const op of block?.instructions ?? []) {
      if (op?.kind === "load") loaded.set(op.id, op.slot);
      if (op?.kind === "binary" && op.operator === "%")
        slots.push(loaded.get(op.right) ?? -1);
    }
  }
  return slots;
}

test("a remainder by an invariant integer slot gets a positive-divisor version", () => {
  const input = loop({ facts: true });
  assert.deepEqual(verify({ functions: [input] }), { ok: true });
  const result = versionNonzeroDivisors(input, 1000000);
  assert.ok(result);
  assert.equal(result.versioned, 1);
  assert.deepEqual(verify({ functions: [result.fn] }), { ok: true });
  // The preheader tests the divisor; the hot loop reads a fresh slot and the
  // cold copy the original.
  assert.equal(result.fn.blocks[0]?.terminator.kind, "branch");
  const [hot, cold] = divisorSlots(result.fn);
  assert.ok(hot !== undefined && hot > 3);
  assert.equal(cold, 0);
  // Bounds proves the fresh slot nonzero.
  const selected = selectArrayAccesses(result.fn, 1000000);
  assert.ok(selected);
  assert.ok((selected.fn.nonzeroSlots ?? []).includes(hot));
  assert.ok(!(selected.fn.nonzeroSlots ?? []).includes(0));
});

test("divisors the loop writes, not integer slots or proven nonzero keep one loop", () => {
  for (const input of [
    loop({ facts: true, written: true }),
    loop({ facts: false }),
    { ...loop({ facts: true }), nonzeroSlots: [0] },
  ]) {
    assert.deepEqual(verify({ functions: [input] }), { ok: true });
    const result = versionNonzeroDivisors(input, 1000000);
    assert.ok(result);
    assert.equal(result.versioned, 0);
    assert.equal(result.fn, input);
  }
});

test("an exhausted version budget reports no result", () => {
  assert.equal(versionNonzeroDivisors(loop({ facts: true }), 3), undefined);
});
