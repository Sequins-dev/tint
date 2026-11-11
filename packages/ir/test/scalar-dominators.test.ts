import assert from "node:assert/strict";
import { test } from "node:test";
import {
  immediateDominators,
  dominates,
  type Block,
  type FunctionIR,
} from "@tint/ir/scalar";

const s = { start: 0, end: 0 };
function fn(blocks: Block[]): FunctionIR {
  return {
    id: 0,
    name: "graph",
    exported: true,
    parameters: [],
    slots: ["boolean", "general"],
    returnType: "void",
    entry: 0,
    blocks,
  };
}
function branch(id: number, consequent: number, alternate: number): Block {
  return {
    id,
    instructions: [{ kind: "load", id: 100 + id, slot: 0, ...s }],
    terminator: {
      kind: "branch",
      condition: 100 + id,
      consequent,
      alternate,
      ...s,
    },
  };
}
function jump(id: number, target: number): Block {
  return { id, instructions: [], terminator: { kind: "jump", target, ...s } };
}
const exit = (id: number): Block => ({
  id,
  instructions: [],
  terminator: { kind: "return", value: undefined, ...s },
});

test("a diamond's join is dominated by the fork, not by either arm", () => {
  // 0 -> {1, 2} -> 3; 1 -> 2 as well, so 2 has two predecessors.
  const graph = fn([branch(0, 1, 2), branch(1, 2, 3), jump(2, 3), exit(3)]);
  const tree = immediateDominators(graph, 1000);
  assert.ok(tree !== undefined);
  assert.deepEqual(Array.from(tree.idom), [1, 1, 1, 1]);
  assert.ok(dominates(tree, 0, 0, 3));
  assert.ok(!dominates(tree, 0, 1, 2));
  assert.ok(!dominates(tree, 0, 1, 3));
  assert.ok(dominates(tree, 0, 2, 2));
});

test("loop bodies are dominated by their header and exits by the header too", () => {
  // 0 -> 1 (header) -> {2 (body), 4 (exit)}; 2 -> 3 -> 1.
  const graph = fn([
    jump(0, 1),
    branch(1, 2, 4),
    jump(2, 3),
    jump(3, 1),
    exit(4),
  ]);
  const tree = immediateDominators(graph, 1000);
  assert.ok(tree !== undefined);
  assert.deepEqual(Array.from(tree.idom), [1, 1, 2, 3, 2]);
  assert.ok(dominates(tree, 0, 1, 3));
  assert.ok(!dominates(tree, 0, 2, 4));
});

test("exceptional edges count and unreachable blocks dominate nothing", () => {
  // 0 -> 1; 0 may also throw to 2; 1 -> 2; 3 is unreachable.
  const graph = fn([
    { ...jump(0, 1), exception: { target: 2, slot: 1 } },
    jump(1, 2),
    exit(2),
    jump(3, 2),
  ]);
  const tree = immediateDominators(graph, 1000);
  assert.ok(tree !== undefined);
  assert.equal(tree.idom[2], 1);
  assert.equal(tree.idom[3], 0);
  assert.ok(!dominates(tree, 0, 1, 2));
  assert.ok(!dominates(tree, 0, 3, 2));
  assert.ok(!dominates(tree, 0, 0, 3));
});

test("budget exhaustion publishes no tree", () => {
  assert.equal(immediateDominators(fn([jump(0, 1), exit(1)]), 1), undefined);
});
