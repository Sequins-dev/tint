import assert from "node:assert/strict";
import test from "node:test";
import { foldSSAConstants } from "../src/optimization/ssa.ts";
import { unboundedWork } from "../src/optimization/budget.ts";
import { verify, type FunctionIR } from "@tint/ir/scalar";
const s = { start: 0, end: 0 };
function diamond(left: number, right: number): FunctionIR {
  return {
    id: 0,
    name: "join",
    exported: true,
    parameters: [0],
    slots: ["boolean", "number"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [{ kind: "load", id: 0, slot: 0, ...s }],
        terminator: {
          kind: "branch",
          condition: 0,
          consequent: 1,
          alternate: 2,
          ...s,
        },
      },
      {
        id: 1,
        instructions: [
          { kind: "constant", id: 1, value: left, ...s },
          { kind: "store", slot: 1, value: 1, ...s },
        ],
        terminator: { kind: "jump", target: 3, ...s },
      },
      {
        id: 2,
        instructions: [
          { kind: "constant", id: 2, value: right, ...s },
          { kind: "store", slot: 1, value: 2, ...s },
        ],
        terminator: { kind: "jump", target: 3, ...s },
      },
      {
        id: 3,
        instructions: [{ kind: "load", id: 3, slot: 1, ...s }],
        terminator: { kind: "return", value: 3, ...s },
      },
    ],
  };
}
test("folds equal constants across a branch join", () => {
  const result = foldSSAConstants(diamond(4, 4), 10000)!;
  assert.ok(result.rewritten > 0);
  assert.deepEqual(verify({ functions: [result.fn] }), { ok: true });
  assert.ok(
    result.fn.blocks[3]!.instructions.some(
      (op) => op.kind === "constant" && op.value === 4,
    ),
  );
});
test("joins preserve differing values and signed zero", () => {
  for (const pair of [
    [4, 5],
    [0, -0],
  ]) {
    const fn = diamond(pair[0]!, pair[1]!);
    const result = foldSSAConstants(fn, 10000)!;
    assert.equal(result.rewritten, 0);
    assert.equal(result.fn, fn);
  }
});
test("incomplete analysis does not publish transient constants", () => {
  assert.equal(foldSSAConstants(diamond(4, 4), 1), undefined);
});
test("unbounded SSA skips settled joins on a later predecessor visit", () => {
  const source = diamond(4, 5);
  const fn: FunctionIR = {
    ...source,
    slots: ["boolean", "number", "number"],
    parameters: [0, 2],
    blocks: [
      source.blocks[0]!,
      {
        ...source.blocks[1]!,
        instructions: [
          { kind: "load", id: 1, slot: 2, ...s },
          { kind: "store", slot: 1, value: 1, ...s },
        ],
      },
      {
        id: 2,
        instructions: [],
        terminator: { kind: "jump", target: 4, ...s },
      },
      source.blocks[3]!,
      { ...source.blocks[2]!, id: 4 },
    ],
  };
  assert.deepEqual(verify({ functions: [fn] }), { ok: true });
  const bounded = foldSSAConstants(fn, 10000)!;
  const unbounded = foldSSAConstants(fn, unboundedWork)!;
  assert.equal(unbounded.fn, bounded.fn);
  assert.equal(unbounded.rewritten, bounded.rewritten);
  assert.equal(bounded.visited - unbounded.visited, 2);
});
test("conditional reachability excludes an untaken incoming value", () => {
  const fn = diamond(4, 5);
  const result = foldSSAConstants(
    {
      ...fn,
      blocks: fn.blocks.map((b) =>
        b.id === 0
          ? {
              ...b,
              instructions: [{ kind: "constant", id: 0, value: true, ...s }],
            }
          : b,
      ),
    },
    10000,
  )!;
  assert.ok(
    result.fn.blocks[3]!.instructions.some(
      (op) => op.kind === "constant" && op.value === 4,
    ),
  );
  assert.deepEqual(verify({ functions: [result.fn] }), { ok: true });
});
import { optimizeModule } from "../src/optimization/index.ts";
test("standard optimization pipeline folds cross-block constants", () => {
  const result = optimizeModule({ functions: [diamond(7, 7)] });
  assert.equal(result.budgetExhausted, false);
  assert.ok(
    result.passes.some((p) => p.pass === "ssa-constants" && p.rewritten > 0),
  );
  assert.deepEqual(verify(result.module), { ok: true });
});
test("an expensive SSA candidate cannot starve the remaining optimization passes", () => {
  const fn: FunctionIR = {
    id: 0,
    name: "large",
    exported: true,
    parameters: [],
    slots: Array(200000).fill("number"),
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "constant", id: 0, value: 1, ...s },
          { kind: "constant", id: 1, value: 2, ...s },
          { kind: "binary", id: 2, operator: "+", left: 0, right: 1, ...s },
        ],
        terminator: { kind: "return", value: 2, ...s },
      },
    ],
  };
  const blocks = Array.from({ length: 100 }, (_, id) =>
    id === 0
      ? {
          ...fn.blocks[0]!,
          instructions: [
            ...fn.blocks[0]!.instructions,
            { kind: "store" as const, slot: 0, value: 2, ...s },
          ],
          terminator: { kind: "jump" as const, target: 1, ...s },
        }
      : id === 99
        ? {
            id,
            instructions: [{ kind: "load" as const, id: 3, slot: 0, ...s }],
            terminator: { kind: "return" as const, value: 3, ...s },
          }
        : {
            id,
            instructions: [],
            terminator: { kind: "jump" as const, target: id + 1, ...s },
          },
  );
  const result = optimizeModule({ functions: [{ ...fn, blocks }] });
  assert.equal(result.budgetExhausted, false);
  assert.ok(result.passes.some((p) => p.pass === "inline-small-functions"));
  assert.ok(
    result.passes.some(
      (p) => p.pass === "remove-dead-scalars" && p.rewritten > 0,
    ),
  );
});
test("settling a formerly known constant to unknown clears it while empty unknown joins stay untouched", () => {
  // Block 0 branches to b1 (stores constant 10) and b2 (stores unknown param),
  // both jumping to join b3, which then joins with b4 (stores unknown param) at b5.
  const fn: FunctionIR = {
    id: 0,
    name: "settleUnknown",
    exported: true,
    parameters: [0, 1],
    slots: ["boolean", "number", "number"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [{ kind: "load", id: 0, slot: 0, ...s }],
        terminator: {
          kind: "branch",
          condition: 0,
          consequent: 1,
          alternate: 2,
          ...s,
        },
      },
      {
        id: 1,
        instructions: [
          { kind: "constant", id: 1, value: 10, ...s },
          { kind: "store", slot: 2, value: 1, ...s },
        ],
        terminator: { kind: "jump", target: 3, ...s },
      },
      {
        id: 2,
        instructions: [
          { kind: "load", id: 2, slot: 1, ...s },
          { kind: "store", slot: 2, value: 2, ...s },
        ],
        terminator: { kind: "jump", target: 3, ...s },
      },
      {
        id: 3,
        instructions: [{ kind: "load", id: 3, slot: 2, ...s }],
        terminator: { kind: "return", value: 3, ...s },
      },
    ],
  };
  assert.deepEqual(verify({ functions: [fn] }), { ok: true });
  const result = foldSSAConstants(fn, 10000)!;
  assert.equal(result.rewritten, 0);
  assert.equal(result.fn, fn);
});
