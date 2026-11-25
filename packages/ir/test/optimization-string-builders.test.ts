import { test } from "node:test";
import assert from "node:assert/strict";
import {
  verify,
  type Block,
  type FunctionIR,
  type Instruction,
  type ModuleIR,
} from "@tint/ir/scalar";
import { buildLoopStrings } from "../src/optimization/string-builders.ts";

const span = { start: 0, end: 1 };

/** `let s = ""; for (let i = 0; i < n; i++) s += "ab"; return s;` with
 * slots s0 n, s1 s, s2 i. `extra` adds instructions to the loop body. */
function appendLoop(extra: readonly Instruction[] = []): FunctionIR {
  const blocks: Block[] = [
    {
      id: 0,
      instructions: [
        { kind: "string-literal", id: 0, value: "", ...span },
        { kind: "store", slot: 1, value: 0, ...span },
        { kind: "constant", id: 1, value: 0, ...span },
        { kind: "store", slot: 2, value: 1, ...span },
      ],
      terminator: { kind: "jump", target: 1, ...span },
    },
    {
      id: 1,
      instructions: [
        { kind: "load", id: 2, slot: 2, ...span },
        { kind: "load", id: 3, slot: 0, ...span },
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
      instructions: [
        { kind: "string-literal", id: 5, value: "ab", ...span },
        { kind: "load", id: 6, slot: 1, ...span },
        { kind: "string-concat", id: 7, left: 6, right: 5, ...span },
        { kind: "store", slot: 1, value: 7, ...span },
        ...extra,
        { kind: "load", id: 8, slot: 2, ...span },
        { kind: "constant", id: 9, value: 1, ...span },
        { kind: "binary", id: 10, operator: "+", left: 8, right: 9, ...span },
        { kind: "store", slot: 2, value: 10, ...span },
      ],
      terminator: { kind: "jump", target: 1, ...span },
    },
    {
      id: 3,
      instructions: [{ kind: "load", id: 11, slot: 1, ...span }],
      terminator: { kind: "return", value: 11, ...span },
    },
  ];
  return {
    id: 0,
    name: "build",
    exported: true,
    parameters: [0],
    slots: ["number", "string", "number"],
    returnType: "string",
    entry: 0,
    blocks,
  };
}

function module(fn: FunctionIR): ModuleIR {
  return { functions: [fn] };
}

function instructions(fn: FunctionIR): Instruction[] {
  const all: Instruction[] = [];
  for (const block of fn.blocks)
    for (const op of block?.instructions ?? [])
      if (op !== undefined) all.push(op);
  return all;
}

test("appends in a loop write into a buffer and store the prefix at exits", () => {
  const input = appendLoop();
  assert.deepEqual(verify(module(input)), { ok: true });
  const result = buildLoopStrings(input, 100000);
  assert.ok(result !== undefined);
  assert.equal(result.rewritten, 1);
  assert.deepEqual(verify(module(result.fn)), { ok: true });
  const ops = instructions(result.fn);
  // One exact concatenation (the first growths) and the buffer path: an
  // allocation that copies the old buffer, and the piece's write.
  assert.equal(ops.filter((op) => op.kind === "string-concat").length, 1);
  assert.equal(ops.filter((op) => op.kind === "string-allocate").length, 1);
  assert.equal(ops.filter((op) => op.kind === "string-write").length, 2);
  assert.equal(ops.filter((op) => op.kind === "string-slice").length, 1);
  // The slot is read only before the loop: the concatenation joins the
  // buffer and the piece.
  const concat = ops.find((op) => op.kind === "string-concat");
  assert.ok(concat?.kind === "string-concat");
  const buffers = new Set(
    ops.flatMap((op) => (op.kind === "load" && op.slot === 3 ? [op.id] : [])),
  );
  assert.ok(buffers.has(concat.left));
  // The string slot is written only before the loop and at the exit.
  const loopBlocks = new Set([1, 2]);
  for (const block of result.fn.blocks) {
    if (block === undefined || !loopBlocks.has(block.id)) continue;
    for (const op of block.instructions)
      assert.ok(!(op?.kind === "store" && op.slot === 1));
  }
  // The exit block is entered through the builder's exit.
  const header = result.fn.blocks.find((block) => block?.id === 1);
  assert.ok(header?.terminator.kind === "branch");
  assert.notEqual(header.terminator.alternate, 3);
  // A second run finds nothing left to rewrite.
  const again = buildLoopStrings(result.fn, 100000);
  assert.equal(again?.rewritten, 0);
});

test("other reads of the string in the loop keep the concatenation", () => {
  const input = appendLoop([
    { kind: "load", id: 20, slot: 1, ...span },
    { kind: "string-length", id: 21, string: 20, ...span },
  ]);
  assert.deepEqual(verify(module(input)), { ok: true });
  const result = buildLoopStrings(input, 100000);
  assert.equal(result?.rewritten, 0);
  assert.equal(result?.fn, input);
});

test("values read across an append's split keep the concatenation", () => {
  // The piece is read again after the store: splitting the block there
  // would read it in another block.
  const input = appendLoop([
    { kind: "string-length", id: 22, string: 5, ...span },
  ]);
  assert.deepEqual(verify(module(input)), { ok: true });
  assert.equal(buildLoopStrings(input, 100000)?.rewritten, 0);
});

test("exception edges and debug bindings of the slot keep the concatenation", () => {
  const base = appendLoop();
  const handler: Block = {
    id: 4,
    instructions: [{ kind: "load", id: 30, slot: 1, ...span }],
    terminator: { kind: "return", value: 30, ...span },
  };
  const throwing: FunctionIR = {
    ...base,
    slots: [...base.slots, "general"],
    blocks: [
      ...base.blocks.map((block) =>
        block.id === 2
          ? { ...block, exception: { target: 4, slot: 3 } }
          : block,
      ),
      handler,
    ],
  };
  assert.deepEqual(verify(module(throwing)), { ok: true });
  assert.equal(buildLoopStrings(throwing, 100000)?.rewritten, 0);
  const debugged: FunctionIR = {
    ...base,
    debug: {
      variables: [{ name: "s", start: 0, end: 1, parameter: false }],
      slots: [{ slot: 1, variable: 0 }],
      values: [],
      inlineSites: [],
    },
  };
  assert.equal(buildLoopStrings(debugged, 100000)?.rewritten, 0);
});

test("an exhausted budget abandons the pass", () => {
  assert.equal(buildLoopStrings(appendLoop(), 3), undefined);
});
