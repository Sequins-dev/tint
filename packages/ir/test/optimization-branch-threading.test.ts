import assert from "node:assert/strict";
import test from "node:test";
import { verify, type FunctionIR, type ModuleIR } from "@tint/ir/scalar";
import { threadBranches } from "../src/optimization/branch-threading.ts";
const s = { start: 0, end: 0 };

/** `r = x === 1 && y === 2; c = r; if (c) ...` as lowered: the `&&` result is
 * carried in slot 2 and copied into slot 3, and thin blocks reload them to
 * branch (b3 and b4 retest the copy). Returns 10 when both hold, else 20. */
const carried: FunctionIR = {
  id: 0,
  name: "carried",
  exported: true,
  parameters: [0, 1],
  slots: ["number", "number", "boolean", "boolean"],
  returnType: "number",
  entry: 0,
  blocks: [
    {
      id: 0,
      instructions: [
        { kind: "load", id: 0, slot: 0, ...s },
        { kind: "constant", id: 1, value: 1, ...s },
        { kind: "binary", id: 2, operator: "===", left: 0, right: 1, ...s },
        { kind: "store", slot: 2, value: 2, ...s },
      ],
      terminator: {
        kind: "branch",
        condition: 2,
        consequent: 1,
        alternate: 2,
        ...s,
      },
    },
    {
      id: 1,
      instructions: [
        { kind: "load", id: 3, slot: 1, ...s },
        { kind: "constant", id: 4, value: 2, ...s },
        { kind: "binary", id: 5, operator: "===", left: 3, right: 4, ...s },
        { kind: "store", slot: 2, value: 5, ...s },
      ],
      terminator: { kind: "jump", target: 2, ...s },
    },
    {
      id: 2,
      instructions: [
        { kind: "load", id: 6, slot: 2, ...s },
        { kind: "store", slot: 3, value: 6, ...s },
      ],
      terminator: {
        kind: "branch",
        condition: 6,
        consequent: 3,
        alternate: 4,
        ...s,
      },
    },
    {
      id: 3,
      instructions: [{ kind: "load", id: 7, slot: 3, ...s }],
      terminator: {
        kind: "branch",
        condition: 7,
        consequent: 5,
        alternate: 6,
        ...s,
      },
    },
    {
      id: 4,
      instructions: [{ kind: "load", id: 8, slot: 3, ...s }],
      terminator: {
        kind: "branch",
        condition: 8,
        consequent: 5,
        alternate: 6,
        ...s,
      },
    },
    {
      id: 5,
      instructions: [{ kind: "constant", id: 9, value: 10, ...s }],
      terminator: { kind: "return", value: 9, ...s },
    },
    {
      id: 6,
      instructions: [{ kind: "constant", id: 10, value: 20, ...s }],
      terminator: { kind: "return", value: 10, ...s },
    },
  ],
};

/** Runs the loads, stores, constants, `===` and control flow used here;
 * returns the result and the final slot contents. */
function run(
  fn: FunctionIR,
  args: readonly number[],
): { result: unknown; slots: unknown[] } {
  const slots: unknown[] = fn.slots.map((_, index) => args[index]);
  let block = fn.blocks[fn.entry]!;
  for (let steps = 0; steps < 100; steps++) {
    const values = new Map<number, unknown>();
    for (const op of block.instructions) {
      if (op.kind === "constant") values.set(op.id, op.value);
      else if (op.kind === "load") values.set(op.id, slots[op.slot]);
      else if (op.kind === "store") slots[op.slot] = values.get(op.value);
      else if (op.kind === "binary" && op.operator === "===")
        values.set(op.id, values.get(op.left) === values.get(op.right));
      else throw Error("unexpected " + op.kind);
    }
    const term = block.terminator;
    if (term.kind === "return")
      return { result: values.get(term.value!), slots };
    const next =
      term.kind === "jump"
        ? term.target
        : term.kind === "branch"
          ? values.get(term.condition)
            ? term.consequent
            : term.alternate
          : undefined;
    assert.ok(next !== undefined, "unexpected " + term.kind);
    block = fn.blocks[next]!;
  }
  throw Error("no return");
}

test("slot-carried booleans branch directly and edges skip decided thin blocks", () => {
  const module: ModuleIR = { functions: [carried] };
  assert.deepEqual(verify(module), { ok: true });
  const result = threadBranches(carried, 100000);
  assert.ok(result);
  assert.ok(result.rewritten > 0);
  const threaded = result.fn;
  assert.deepEqual(verify({ functions: [threaded] }), { ok: true });
  for (const x of [0, 1, 2])
    for (const y of [0, 1, 2])
      assert.deepEqual(
        run(threaded, [x, y]),
        run(carried, [x, y]),
        `${x} ${y}`,
      );
  // Only the two comparisons branch: every thin retest became unreachable.
  const branches = threaded.blocks.filter(
    (b) => b.terminator.kind === "branch",
  );
  assert.equal(branches.length, 2);
  for (const block of branches) {
    const term = block.terminator;
    assert.ok(term.kind === "branch");
    const compare = block.instructions.find(
      (op) => op.kind === "binary" && op.id === term.condition,
    );
    const reload = block.instructions.find(
      (op) => op.kind === "load" && op.id === term.condition,
    );
    // b0 tests its comparison; b1 tests its copied reload of slot 2, which
    // the sweep forwards to its comparison.
    assert.ok(compare !== undefined || reload !== undefined);
  }
});

test("undecided thin blocks, writes and exhausted budgets are left alone", () => {
  // Thin blocks testing a parameter slot no predecessor decides.
  const undecided: FunctionIR = {
    ...carried,
    parameters: [0, 1, 2],
    blocks: carried.blocks.map((block) => ({
      ...block,
      instructions: block.instructions.filter(
        (op) => op.kind !== "store" || op.slot !== 2,
      ),
    })),
  };
  assert.deepEqual(verify({ functions: [undecided] }), { ok: true });
  const result = threadBranches(undecided, 100000);
  assert.ok(result);
  for (const x of [0, 1])
    for (const y of [false, true]) {
      const args = [x, 0, y as unknown as number];
      assert.deepEqual(run(result.fn, args), run(undecided, args));
    }
  assert.equal(threadBranches(carried, 3), undefined);
  const generated = { ...carried, name: "__tint_reference_list_read$1" };
  assert.equal(threadBranches(generated, 100000)?.rewritten, 0);
});
