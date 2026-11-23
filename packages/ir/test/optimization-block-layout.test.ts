import assert from "node:assert/strict";
import test from "node:test";
import { layoutBlocks } from "../src/optimization/block-layout.ts";
import {
  verify,
  type Block,
  type FunctionIR,
  type Terminator,
} from "@tint/ir/scalar";
const s = { start: 0, end: 0 };

function block(id: number, terminator: Terminator, value?: number): Block {
  return {
    id,
    instructions:
      value === undefined
        ? []
        : [{ kind: "constant", id: 100 + id, value, ...s }],
    terminator,
  };
}
const ret = (value: number): Terminator => ({ kind: "return", value, ...s });

// A guard trapping to 1, then while (p) { body } return: the test (2) and
// exit (4) come after the trap and the body (3) jumps back to the test.
function loop(): FunctionIR {
  return {
    id: 0,
    name: "loop",
    exported: true,
    parameters: [0],
    slots: ["boolean"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [{ kind: "load", id: 1, slot: 0, ...s }],
        terminator: {
          kind: "branch",
          condition: 1,
          consequent: 2,
          alternate: 1,
          ...s,
        },
      },
      block(1, { kind: "trap", ...s }),
      {
        id: 2,
        instructions: [{ kind: "load", id: 0, slot: 0, ...s }],
        terminator: {
          kind: "branch",
          condition: 0,
          consequent: 3,
          alternate: 4,
          ...s,
        },
      },
      block(3, { kind: "jump", target: 2, ...s }),
      block(4, ret(104), 7),
    ],
  };
}

/** Each block's edges, in emission order. */
function edges(fn: FunctionIR): string[] {
  const names: string[] = [];
  for (const b of fn.blocks) {
    const t = b.terminator;
    names.push(
      t.kind === "jump"
        ? b.id + "->" + t.target
        : t.kind === "branch"
          ? b.id + "->" + t.consequent + "|" + t.alternate
          : b.id + ":" + t.kind,
    );
  }
  return names;
}

test("each block is followed by its preferred successor and cold blocks go last", () => {
  const before = loop();
  assert.deepEqual(verify({ functions: [before] }).ok, true);
  const result = layoutBlocks(before, 1000);
  assert.ok(result !== undefined);
  // Entry, test, body, exit; the trap moves to the end.
  assert.deepEqual(edges(result.fn), [
    "0->1|4",
    "1->2|3",
    "2->1",
    "3:return",
    "4:trap",
  ]);
  assert.equal(result.fn.entry, 0);
  assert.equal(result.moved, 4);
  assert.deepEqual(verify({ functions: [result.fn] }).ok, true);
  // The exit's constant moved with it.
  const exit = result.fn.blocks[3];
  assert.equal(exit?.instructions[0]?.kind, "constant");
  // An order that already falls through is returned unchanged.
  const again = layoutBlocks(result.fn, 1000);
  assert.equal(again?.moved, 0);
  assert.equal(again?.fn, result.fn);
});

test("a branch prefers its earlier successor and the budget is exact", () => {
  const fn: FunctionIR = {
    ...loop(),
    blocks: [
      {
        id: 0,
        instructions: [],
        terminator: { kind: "jump", target: 2, ...s },
      },
      block(1, ret(101), 1),
      block(2, {
        kind: "branch",
        condition: 0,
        consequent: 4,
        alternate: 1,
        ...s,
      }),
      block(3, { kind: "throw-literal", value: "cold", ...s }),
      block(4, ret(104), 4),
    ],
  };
  const laid = layoutBlocks(fn, 1000);
  assert.ok(laid !== undefined);
  // The branch prefers its earlier successor (1) over 4; the throw is last.
  assert.deepEqual(edges(laid.fn), [
    "0->1",
    "1->3|2",
    "2:return",
    "3:return",
    "4:throw-literal",
  ]);
  assert.equal(layoutBlocks(fn, 3), undefined);
});

test("a cached property access falls through to its hit, not its miss", () => {
  // 0 tests a general slot for absent (true only on a property-load miss):
  // the miss (1) comes first in source order, the hit (2) follows it.
  const fn: FunctionIR = {
    id: 0,
    name: "hit",
    exported: true,
    parameters: [0],
    slots: ["general"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "load", id: 0, slot: 0, ...s },
          { kind: "general-is", id: 1, value: 0, type: "absent", ...s },
        ],
        terminator: {
          kind: "branch",
          condition: 1,
          consequent: 1,
          alternate: 2,
          ...s,
        },
      },
      block(1, ret(101), 1),
      block(2, ret(102), 2),
    ],
  };
  assert.deepEqual(verify({ functions: [fn] }).ok, true);
  const laid = layoutBlocks(fn, 1000);
  assert.ok(laid !== undefined);
  assert.deepEqual(edges(laid.fn), ["0->2|1", "1:return", "2:return"]);
  assert.equal(laid.fn.blocks[1]?.instructions[0]?.kind, "constant");
  assert.deepEqual(verify({ functions: [laid.fn] }).ok, true);
  // Any other test keeps the earlier successor.
  const other: FunctionIR = {
    ...fn,
    blocks: fn.blocks.map((b: Block): Block =>
      b.id === 0
        ? {
            ...b,
            instructions: [
              { kind: "load", id: 0, slot: 0, ...s },
              { kind: "general-is", id: 1, value: 0, type: "number", ...s },
            ],
          }
        : b,
    ),
  };
  assert.equal(layoutBlocks(other, 1000)?.moved, 0);
});
