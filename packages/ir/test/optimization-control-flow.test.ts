import assert from "node:assert/strict";
import test from "node:test";
import {
  compactReachableBlocks,
  simplifyControlFlow,
} from "../src/optimization/control-flow.ts";
import { verify, type FunctionIR } from "@tint/ir/scalar";
const s = { start: 0, end: 0 };
test("constant branches remove unreachable paths and compact successor labels", () => {
  const fn: FunctionIR = {
    id: 0,
    name: "branch",
    exported: true,
    parameters: [],
    slots: [],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [{ kind: "constant", id: 0, value: false, ...s }],
        terminator: {
          kind: "branch",
          condition: 0,
          consequent: 1,
          alternate: 2,
          ...s,
        },
      },
      { id: 1, instructions: [], terminator: { kind: "trap", ...s } },
      {
        id: 2,
        instructions: [{ kind: "constant", id: 1, value: 42, ...s }],
        terminator: { kind: "return", value: 1, ...s },
      },
    ],
  };
  const result = simplifyControlFlow(fn, 1000)!;
  assert.ok(result);
  assert.equal(result.fn.blocks.length, 2);
  assert.deepEqual(result.fn.blocks[0]!.terminator, {
    kind: "jump",
    target: 1,
    ...s,
  });
  assert.deepEqual(verify({ functions: [result.fn] }), { ok: true });
  assert.equal(simplifyControlFlow(fn, 0), undefined);
});

test("compactReachableBlocks reuses unchanged blocks, terminators, and handlers by identity", () => {
  const fn: FunctionIR = {
    id: 0,
    name: "reuse",
    exported: true,
    parameters: [0],
    slots: ["boolean", "general"],
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
        exception: { target: 2, slot: 1 },
      },
      {
        id: 1,
        instructions: [{ kind: "constant", id: 1, value: 1, ...s }],
        terminator: { kind: "return", value: 1, ...s },
      },
      {
        id: 2,
        instructions: [{ kind: "constant", id: 2, value: 2, ...s }],
        terminator: { kind: "return", value: 2, ...s },
      },
    ],
  };
  assert.deepEqual(verify({ functions: [fn] }), { ok: true });

  // All blocks reachable with identical IDs/edges: entire FunctionIR reused.
  const unchanged = compactReachableBlocks(fn, fn.blocks, 1000);
  assert.ok(unchanged);
  assert.equal(unchanged.removed, 0);
  assert.equal(unchanged.fn, fn);
  assert.equal(unchanged.fn.blocks, fn.blocks);

  // When a trailing dead block is removed, earlier blocks whose IDs, edges,
  // and exception handlers are unchanged keep their exact object identities.
  const withDead: FunctionIR = {
    ...fn,
    blocks: [
      ...fn.blocks,
      { id: 3, instructions: [], terminator: { kind: "trap", ...s } },
    ],
  };
  const compacted = compactReachableBlocks(withDead, withDead.blocks, 1000);
  assert.ok(compacted);
  assert.equal(compacted.removed, 1);
  assert.equal(compacted.fn.blocks.length, 3);
  assert.equal(compacted.fn.blocks[0], withDead.blocks[0]);
  assert.equal(compacted.fn.blocks[1], withDead.blocks[1]);
  assert.equal(compacted.fn.blocks[2], withDead.blocks[2]);
  assert.deepEqual(verify({ functions: [compacted.fn] }), { ok: true });
});
