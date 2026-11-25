import { test } from "node:test";
import assert from "node:assert/strict";
import {
  verify,
  type Block,
  type FunctionIR,
  type Instruction,
  type ModuleIR,
} from "@tint/ir/scalar";
import { versionStringLoops } from "../src/optimization/string-loops.ts";

const span = { start: 0, end: 1 };

/** `let sum = 0; for (let i = 0; i < s.length; i++) sum += s.charCodeAt(i);
 * return sum;` with slots s0 s, s1 i, s2 sum. `extra` adds instructions
 * to the loop body. */
function unitLoop(extra: readonly Instruction[] = []): FunctionIR {
  const blocks: Block[] = [
    {
      id: 0,
      instructions: [
        { kind: "constant", id: 0, value: 0, ...span },
        { kind: "store", slot: 1, value: 0, ...span },
        { kind: "store", slot: 2, value: 0, ...span },
      ],
      terminator: { kind: "jump", target: 1, ...span },
    },
    {
      id: 1,
      instructions: [
        { kind: "load", id: 1, slot: 1, ...span },
        { kind: "load", id: 2, slot: 0, ...span },
        { kind: "string-length", id: 3, string: 2, ...span },
        { kind: "binary", id: 4, operator: "<", left: 1, right: 3, ...span },
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
        { kind: "load", id: 5, slot: 0, ...span },
        { kind: "load", id: 6, slot: 1, ...span },
        {
          kind: "string-code-unit",
          id: 7,
          string: 5,
          index: 6,
          inBounds: true,
          ...span,
        },
        { kind: "load", id: 8, slot: 2, ...span },
        { kind: "binary", id: 9, operator: "+", left: 8, right: 7, ...span },
        { kind: "store", slot: 2, value: 9, ...span },
        ...extra,
        { kind: "load", id: 10, slot: 1, ...span },
        { kind: "constant", id: 11, value: 1, ...span },
        { kind: "binary", id: 12, operator: "+", left: 10, right: 11, ...span },
        { kind: "store", slot: 1, value: 12, ...span },
      ],
      terminator: { kind: "jump", target: 1, ...span },
    },
    {
      id: 3,
      instructions: [{ kind: "load", id: 13, slot: 2, ...span }],
      terminator: { kind: "return", value: 13, ...span },
    },
  ];
  return {
    id: 0,
    name: "units",
    exported: true,
    parameters: [0],
    slots: ["string", "number", "number"],
    returnType: "number",
    entry: 0,
    blocks,
  };
}

function module(fn: FunctionIR): ModuleIR {
  return { functions: [fn] };
}

test("code-unit loops enter a copy for each flat string kind", () => {
  const input = unitLoop();
  assert.deepEqual(verify(module(input)), { ok: true });
  const result = versionStringLoops(input, 100000);
  assert.ok(result !== undefined);
  assert.equal(result.versioned, 1);
  assert.deepEqual(verify(module(result.fn)), { ok: true });
  // Two copies of the two loop blocks and the kind test.
  assert.equal(result.fn.blocks.length, input.blocks.length + 5);
  const kinds = new Map<string, number>();
  for (const block of result.fn.blocks)
    for (const op of block?.instructions ?? [])
      if (op?.kind === "string-code-unit")
        kinds.set(
          op.unitKind ?? "none",
          (kinds.get(op.unitKind ?? "none") ?? 0) + 1,
        );
  // The loop itself still reads slices with the dispatch.
  assert.deepEqual([...kinds].sort(), [
    ["none", 1],
    ["one-byte", 1],
    ["two-byte", 1],
  ]);
  // The preheader tests flatness, then the kind block tests the kind.
  const preheader = result.fn.blocks[0];
  assert.ok(preheader?.terminator.kind === "branch");
  assert.equal(preheader.terminator.alternate, 1);
  assert.ok(preheader.instructions.some((op) => op?.kind === "string-flat"));
  const kindBlock = result.fn.blocks[preheader.terminator.consequent];
  assert.ok(
    kindBlock?.instructions.some((op) => op?.kind === "string-two-byte"),
  );
  // Nothing is left to version.
  assert.equal(versionStringLoops(result.fn, 100000)?.versioned, 0);
});

test("loops that write the string, or are large, stay as they are", () => {
  const written = unitLoop([
    { kind: "string-literal", id: 20, value: "x", ...span },
    { kind: "store", slot: 0, value: 20, ...span },
  ]);
  assert.deepEqual(verify(module(written)), { ok: true });
  assert.equal(versionStringLoops(written, 100000)?.versioned, 0);
  const filler: Instruction[] = [];
  for (let index = 0; index < 100; index++)
    filler.push({ kind: "constant", id: 100 + index, value: index, ...span });
  const large = unitLoop(filler);
  assert.deepEqual(verify(module(large)), { ok: true });
  assert.equal(versionStringLoops(large, 100000)?.versioned, 0);
});

test("an exhausted budget abandons the pass", () => {
  assert.equal(versionStringLoops(unitLoop(), 3), undefined);
});
