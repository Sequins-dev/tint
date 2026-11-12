import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createGraph,
  newValue,
  createOp,
  createRegion,
  createBlock,
  createPatternSet,
  applyPatterns,
  verifyStructured,
  numberAttribute,
  type Graph,
  type Op,
  type Pattern,
  type Region,
} from "@tint/ir/structured";

/** A toy dialect: constants, additions, a summing loop and low-level ops. */
function constant(graph: Graph, value: number): Op {
  const op = createOp("toy.const", { results: [newValue(graph, "number")] });
  op.numbers.set("value", value);
  return op;
}
function add(graph: Graph, left: number, right: number): Op {
  return createOp("toy.add", {
    operands: [left, right],
    results: [newValue(graph, "number")],
  });
}
function result(op: Op): number {
  const value = op.results[0];
  if (value === undefined) throw "result";
  return value;
}
const fold: Pattern = {
  name: "fold-add",
  root: "toy.add",
  benefit: 3,
  match: (op, context) =>
    op.operands.every(
      (operand) => constantValue(context.graph, operand) !== undefined,
    ),
  rewrite: (op, context) => {
    const sum =
      (constantValue(context.graph, op.operands[0] ?? -1) ?? 0) +
      (constantValue(context.graph, op.operands[1] ?? -1) ?? 0);
    const folded = constant(context.graph, sum);
    definitions.set(result(folded), folded);
    return { ops: [folded], results: [result(folded)] };
  },
};
const identity: Pattern = {
  name: "add-zero",
  root: "toy.add",
  benefit: 2,
  match: (op, context) =>
    constantValue(context.graph, op.operands[1] ?? -1) === 0,
  rewrite: (op) => ({ ops: [], results: [op.operands[0] ?? -1] }),
};
const lower: Pattern = {
  name: "lower-add",
  root: "toy.add",
  benefit: 1,
  match: () => true,
  rewrite: (op, context) => {
    const low = createOp("low.add", {
      operands: op.operands,
      results: [newValue(context.graph, "number")],
    });
    return { ops: [low], results: [result(low)] };
  },
};
/** A double is specialized into two adds, which are then matched again. */
const expandDouble: Pattern = {
  name: "expand-double",
  root: "toy.double",
  benefit: 1,
  match: () => true,
  rewrite: (op, context) => {
    const operand = op.operands[0] ?? -1,
      first = add(context.graph, operand, operand);
    return { ops: [first], results: [result(first)] };
  },
};
const definitions = new Map<number, Op>();
function constantValue(_graph: Graph, value: number): number | undefined {
  const op = definitions.get(value);
  return op === undefined || op.kind !== "toy.const"
    ? undefined
    : numberAttribute(op, "value");
}
function track(ops: readonly Op[]): void {
  for (const op of ops)
    for (const value of op.results) definitions.set(value, op);
}
const lowLevel = {
  name: "low",
  legal: (kind: string) =>
    kind === "toy.const" ||
    kind === "low.add" ||
    kind === "toy.return" ||
    kind === "toy.loop",
};

test("patterns apply by benefit, recurse into replacements and forward results", () => {
  definitions.clear();
  const graph = createGraph(),
    input = newValue(graph, "number"),
    two = constant(graph, 2),
    three = constant(graph, 3),
    folded = add(graph, result(two), result(three)),
    zero = constant(graph, 0),
    same = add(graph, input, result(zero)),
    doubled = createOp("toy.double", {
      operands: [result(same)],
      results: [newValue(graph, "number")],
    }),
    sum = add(graph, result(folded), result(doubled)),
    ret = createOp("toy.return", { operands: [result(sum)] });
  const ops = [two, three, folded, zero, same, doubled, sum, ret];
  track(ops);
  const region: Region = createRegion([createBlock([input], ops)]);
  const outcome = applyPatterns(
    region,
    graph,
    createPatternSet([lower, identity, fold, expandDouble]),
    1000,
  );
  assert.equal(outcome.exhausted, false);
  assert.deepEqual(outcome.applied, [
    "fold-add",
    "add-zero",
    "expand-double",
    "lower-add",
    "lower-add",
  ]);
  const kinds = region.blocks[0]!.ops.map((op) => op.kind);
  assert.deepEqual(kinds, [
    "toy.const",
    "toy.const",
    "toy.const",
    "toy.const",
    "low.add",
    "low.add",
    "toy.return",
  ]);
  // The identity add forwarded to the input; the double's add reads it.
  const doubledAdd = region.blocks[0]!.ops[4]!;
  assert.deepEqual(doubledAdd.operands, [input, input]);
  const final = region.blocks[0]!.ops[5]!;
  assert.equal(final.operands[1], result(doubledAdd));
  assert.deepEqual(verifyStructured(region, graph, lowLevel), { ok: true });
});

test("patterns reach nested regions and the budget leaves valid IR", () => {
  definitions.clear();
  const graph = createGraph(),
    input = newValue(graph, "number"),
    element = newValue(graph, "number"),
    body = createRegion([createBlock([element], [add(graph, element, input)])]),
    loop = createOp("toy.loop", { operands: [input], regions: [body] });
  const region = createRegion([createBlock([input], [loop])]);
  const set = createPatternSet([lower]);
  const partial = applyPatterns(region, graph, set, 1);
  assert.equal(partial.exhausted, true);
  assert.deepEqual(partial.applied, []);
  const full = applyPatterns(region, graph, set, 100);
  assert.deepEqual(full.applied, ["lower-add"]);
  assert.equal(body.blocks[0]!.ops[0]!.kind, "low.add");
  assert.deepEqual(verifyStructured(region, graph, lowLevel), { ok: true });
});

test("the verifier rejects illegal kinds, undefined and duplicate values", () => {
  const graph = createGraph(),
    a = newValue(graph, "number"),
    stray = newValue(graph, "number");
  const illegal = createRegion([
    createBlock(
      [a],
      [
        createOp("toy.add", {
          operands: [a, a],
          results: [newValue(graph, "number")],
        }),
      ],
    ),
  ]);
  assert.equal(verifyStructured(illegal, graph, lowLevel).ok, false);
  const undefinedUse = createRegion([
    createBlock(
      [a],
      [
        createOp("low.add", {
          operands: [a, stray],
          results: [newValue(graph, "number")],
        }),
      ],
    ),
  ]);
  const message = verifyStructured(undefinedUse, graph, lowLevel);
  assert.equal(message.ok, false);
  const duplicate = createRegion([
    createBlock([a], [createOp("low.add", { operands: [a, a], results: [a] })]),
  ]);
  assert.equal(verifyStructured(duplicate, graph, lowLevel).ok, false);
  // A value defined in one sibling block is not visible in the next.
  const inner = newValue(graph, "number");
  const siblings = createRegion([
    createBlock([], [createOp("toy.const", { results: [inner] })]),
    createBlock([], [createOp("toy.return", { operands: [inner] })]),
  ]);
  assert.equal(verifyStructured(siblings, graph, lowLevel).ok, false);
});
