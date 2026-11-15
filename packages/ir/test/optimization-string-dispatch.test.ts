import { test } from "node:test";
import assert from "node:assert/strict";
import {
  verify,
  type Block,
  type FunctionIR,
  type ModuleIR,
} from "@tint/ir/scalar";
import { dispatchStringChains } from "../src/optimization/string-dispatch.ts";

const span = { start: 0, end: 1 };

/** `switch (s0)` over `literals`: case i returns i + 1, no match returns 0.
 * With `copied`, each test after the first reads a copy of the value made
 * just before it (the shape `||` chains lower to); `readCopy` makes the
 * exit return the length of the last copy instead. */
function chain(
  literals: readonly string[],
  options: { copied?: boolean; readCopy?: boolean; notEqual?: boolean } = {},
): FunctionIR {
  const blocks: Block[] = [];
  const slots: FunctionIR["slots"][number][] = ["string"];
  let value = 0;
  // Block ids: returns first, then tests (and copies), then the exit.
  const returns: number[] = [];
  for (let index = 0; index < literals.length; index++) {
    const result = value++;
    returns.push(blocks.length);
    blocks.push({
      id: blocks.length,
      instructions: [
        { kind: "constant", id: result, value: index + 1, ...span },
      ],
      terminator: { kind: "return", value: result, ...span },
    });
  }
  const exit = blocks.length;
  const exitValue = value++,
    exitLength = value++;
  const lastCopy = literals.length - 1;
  blocks.push({
    id: exit,
    instructions:
      options.readCopy === true
        ? [
            { kind: "load", id: exitValue, slot: lastCopy, ...span },
            {
              kind: "string-length",
              id: exitLength,
              string: exitValue,
              ...span,
            },
          ]
        : [{ kind: "constant", id: exitLength, value: 0, ...span }],
    terminator: { kind: "return", value: exitLength, ...span },
  });
  const entry = blocks.length;
  for (let index = 0; index < literals.length; index++) {
    const literal = literals[index];
    if (literal === undefined) throw "literal";
    let slot = 0;
    if (options.copied === true && index > 0) {
      slot = slots.length;
      slots.push("string");
      const copy = value++;
      // A copy block, then the test reading the copy.
      blocks.push({
        id: blocks.length,
        instructions: [
          { kind: "load", id: copy, slot: 0, ...span },
          { kind: "store", slot, value: copy, ...span },
        ],
        terminator: { kind: "jump", target: blocks.length + 1, ...span },
      });
    }
    const loaded = value++,
      text = value++,
      equal = value++;
    const id = blocks.length;
    const notEqual = options.notEqual === true && index % 2 === 1;
    const next = index + 1 === literals.length ? exit : id + 1;
    const match = returns[index];
    if (match === undefined) throw "return";
    blocks.push({
      id,
      instructions: [
        { kind: "load", id: loaded, slot, ...span },
        { kind: "string-literal", id: text, value: literal, ...span },
        {
          kind: "binary",
          id: equal,
          operator: notEqual ? "!==" : "===",
          left: loaded,
          right: text,
          ...span,
        },
      ],
      terminator: {
        kind: "branch",
        condition: equal,
        consequent: notEqual ? next : match,
        alternate: notEqual ? match : next,
        ...span,
      },
    });
  }
  return {
    id: 0,
    name: "chain",
    exported: true,
    parameters: [0],
    slots,
    returnType: "number",
    entry,
    blocks,
  };
}

function module(fn: FunctionIR): ModuleIR {
  return { functions: [fn] };
}

function literalTests(fn: FunctionIR): string[] {
  const result: string[] = [];
  for (const block of fn.blocks)
    for (const op of block.instructions)
      if (op.kind === "string-literal") result.push(op.value);
  return result;
}

test("literal test chains dispatch on the string length", () => {
  const literals = ["add", "branch", "sub", "move", "ldr", "compare", "x"];
  for (const notEqual of [false, true]) {
    const input = chain(literals, { notEqual });
    assert.deepEqual(verify(module(input)), { ok: true });
    const result = dispatchStringChains(input, 1000000);
    assert.ok(result !== undefined);
    assert.equal(result.rewritten, 1);
    assert.deepEqual(verify(module(result.fn)), { ok: true });
    // Every literal is still tested exactly once, after a length test.
    assert.deepEqual(literalTests(result.fn).sort(), [...literals].sort());
    const lengths = result.fn.blocks.flatMap((block) =>
      block.instructions.filter((op) => op.kind === "string-length"),
    );
    assert.equal(lengths.length, 1);
    assert.equal(result.fn.integerSlots?.length, 1);
  }
});

test("a repeated literal keeps only its first test", () => {
  const result = dispatchStringChains(
    chain(["store", "load", "store", "array-write", "if"]),
    1000000,
  );
  assert.ok(result !== undefined);
  assert.equal(result.rewritten, 1);
  assert.deepEqual(literalTests(result.fn).sort(), [
    "array-write",
    "if",
    "load",
    "store",
  ]);
  // The first "store" test (returning 1) is the one kept.
  const store = result.fn.blocks.find((block) =>
    block.instructions.some(
      (op) => op.kind === "string-literal" && op.value === "store",
    ),
  );
  assert.ok(store !== undefined && store.terminator.kind === "branch");
  const target = result.fn.blocks[store.terminator.consequent];
  assert.ok(target !== undefined);
  assert.deepEqual(
    target.instructions.map((op) => (op.kind === "constant" ? op.value : -1)),
    [1],
  );
});

test("copies of the value between tests are skipped when dead", () => {
  const literals = ["store", "array-write", "array-store", "string-write"];
  const result = dispatchStringChains(chain(literals, { copied: true }), 1e6);
  assert.ok(result !== undefined);
  assert.equal(result.rewritten, 1);
  assert.deepEqual(verify(module(result.fn)), { ok: true });
  assert.deepEqual(literalTests(result.fn).sort(), [...literals].sort());
});

test("chains whose skipped copies are read afterwards are kept", () => {
  const input = chain(["store", "array-write", "string-write"], {
    copied: true,
    readCopy: true,
  });
  const result = dispatchStringChains(input, 1e6);
  assert.ok(result !== undefined);
  assert.equal(result.rewritten, 0);
  assert.equal(result.fn, input);
});

test("chains whose literals mostly share a length are left alone", () => {
  for (const literals of [
    // One length dominates (the shape of a switch over short kinds).
    ["num", "var", "add", "sub", "mul", "if"],
    // Only two lengths.
    ["store", "label", "array-write", "array-store"],
  ]) {
    const input = chain(literals);
    const result = dispatchStringChains(input, 1e6);
    assert.ok(result !== undefined);
    assert.equal(result.rewritten, 0, literals.join(","));
    assert.equal(result.fn, input);
  }
});

test("short chains are left alone", () => {
  const input = chain(["store", "load"]);
  const result = dispatchStringChains(input, 1e6);
  assert.ok(result !== undefined);
  assert.equal(result.rewritten, 0);
});
