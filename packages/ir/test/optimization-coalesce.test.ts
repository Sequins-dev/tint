import assert from "node:assert/strict";
import { test } from "node:test";
import {
  verify,
  type Block,
  type FunctionIR,
  type Instruction,
  type ModuleIR,
} from "@tint/ir/scalar";
import { coalesceOptionalDefaults } from "../src/optimization/coalesce.ts";
import { provenWordFacts } from "../src/scalar/word-facts.ts";

const s = { start: 0, end: 0 };

/** `array[index] ?? fallback` as lowering emits it, starting at block `at`
 * with value IDs from `base`: slot 1 holds the optional, slot 2 the result.
 * Returns the predecessor's tail instructions and the three new blocks. */
function diamond(
  at: number,
  base: number,
  fallback: number,
  join: number,
): { tail: Instruction[]; blocks: Block[] } {
  return {
    tail: [
      { kind: "load", id: base, slot: 0, ...s },
      { kind: "constant", id: base + 1, value: 0, ...s },
      { kind: "array-read", id: base + 2, array: base, index: base + 1, ...s },
      { kind: "store", slot: 1, value: base + 2, ...s },
      { kind: "optional-present", id: base + 3, value: base + 2, ...s },
    ],
    blocks: [
      {
        id: at,
        instructions: [
          { kind: "load", id: base + 4, slot: 1, ...s },
          { kind: "optional-value", id: base + 5, value: base + 4, ...s },
          { kind: "store", slot: 2, value: base + 5, ...s },
        ],
        terminator: { kind: "jump", target: join, ...s },
      },
      {
        id: at + 1,
        instructions: [
          { kind: "constant", id: base + 6, value: fallback, ...s },
          { kind: "store", slot: 2, value: base + 6, ...s },
        ],
        terminator: { kind: "jump", target: join, ...s },
      },
    ],
  };
}
function branch(base: number, at: number): Block["terminator"] {
  return {
    kind: "branch",
    condition: base + 3,
    consequent: at,
    alternate: at + 1,
    ...s,
  };
}
function fn(blocks: Block[]): FunctionIR {
  return {
    id: 0,
    name: "coalesce",
    exported: true,
    parameters: [0],
    slots: ["Uint32Array", "optional-number", "number"],
    returnType: "number",
    entry: 0,
    blocks,
  };
}
function single(fallback = 7): FunctionIR {
  const d = diamond(1, 0, fallback, 3);
  return fn([
    { id: 0, instructions: d.tail, terminator: branch(0, 1) },
    ...d.blocks,
    {
      id: 3,
      instructions: [{ kind: "load", id: 20, slot: 2, ...s }],
      terminator: { kind: "return", value: 20, ...s },
    },
  ]);
}
function ops(f: FunctionIR): Instruction[] {
  return f.blocks.flatMap((block) => block.instructions);
}
function valid(f: FunctionIR): void {
  const module: ModuleIR = { functions: [f] };
  const checked = verify(module);
  assert.ok(checked.ok, JSON.stringify(checked));
}

test("a lowered `x ?? constant` becomes one branch-free block", () => {
  const input = single();
  valid(input);
  const result = coalesceOptionalDefaults(input, 1000);
  assert.ok(result !== undefined);
  assert.equal(result.rewritten, 1);
  valid(result.fn);
  assert.equal(result.fn.blocks.length, 1);
  const body = ops(result.fn);
  const fused = body.find((op) => op.kind === "optional-value-or");
  assert.ok(fused !== undefined && fused.kind === "optional-value-or");
  assert.equal(fused.value, 2);
  const fallback = body.find(
    (op) => op.kind === "constant" && op.id === fused.fallback,
  );
  assert.ok(fallback !== undefined && fallback.kind === "constant");
  assert.equal(fallback.value, 7);
  // The result slot is still stored before the join's reload, and the
  // optional's own slot keeps its store; the presence test is gone.
  assert.ok(
    body.some(
      (op) => op.kind === "store" && op.slot === 2 && op.value === fused.id,
    ),
  );
  assert.ok(body.some((op) => op.kind === "store" && op.slot === 1));
  assert.ok(!body.some((op) => op.kind === "optional-present"));
  // The input is never mutated.
  assert.equal(input.blocks.length, 4);
});

test("chained coalesces collapse into a single block", () => {
  const first = diamond(1, 0, 1, 3),
    second = diamond(4, 30, 2, 6);
  const input = fn([
    { id: 0, instructions: first.tail, terminator: branch(0, 1) },
    ...first.blocks,
    {
      id: 3,
      instructions: [
        { kind: "load", id: 20, slot: 2, ...s },
        { kind: "store", slot: 2, value: 20, ...s },
        ...second.tail,
      ],
      terminator: branch(30, 4),
    },
    ...second.blocks,
    {
      id: 6,
      instructions: [{ kind: "load", id: 40, slot: 2, ...s }],
      terminator: { kind: "return", value: 40, ...s },
    },
  ]);
  valid(input);
  const result = coalesceOptionalDefaults(input, 1000);
  assert.ok(result !== undefined);
  assert.equal(result.rewritten, 2);
  valid(result.fn);
  assert.equal(result.fn.blocks.length, 1);
  assert.equal(
    ops(result.fn).filter((op) => op.kind === "optional-value-or").length,
    2,
  );
});

test("other join entries, different handlers and intervening slot writes are respected", () => {
  // A third entry into the join leaves the diamond intact.
  const shared = single();
  const extra = fn([
    ...shared.blocks.slice(0, 3),
    {
      id: 3,
      instructions: [{ kind: "load", id: 20, slot: 2, ...s }],
      terminator: { kind: "return", value: 20, ...s },
    },
    {
      id: 4,
      instructions: [],
      terminator: { kind: "jump", target: 3, ...s },
    },
  ]);
  const extraResult = coalesceOptionalDefaults(extra, 1000);
  assert.ok(extraResult !== undefined);
  // Block 4 is unreachable but still an entry; nothing is fused.
  assert.equal(extraResult.rewritten, 0);

  // A join with its own handler is reached by a jump instead of merged.
  const handled = single();
  const withHandler: FunctionIR = {
    ...fn([
      ...handled.blocks.slice(0, 3),
      { ...handled.blocks[3]!, exception: { target: 4, slot: 3 } },
      {
        id: 4,
        instructions: [{ kind: "constant", id: 30, value: -1, ...s }],
        terminator: { kind: "return", value: 30, ...s },
      },
    ]),
    slots: ["Uint32Array", "optional-number", "number", "general"],
  };
  valid(withHandler);
  const handledResult = coalesceOptionalDefaults(withHandler, 1000);
  assert.ok(handledResult !== undefined);
  assert.equal(handledResult.rewritten, 1);
  valid(handledResult.fn);
  assert.equal(handledResult.fn.blocks.length, 3);
  assert.equal(handledResult.fn.blocks[0]!.terminator.kind, "jump");

  // The optional's slot rewritten after its store: the reload would see the
  // later value, so the diamond is kept.
  const overwritten = single();
  const changed = fn([
    {
      ...overwritten.blocks[0]!,
      instructions: [
        ...overwritten.blocks[0]!.instructions,
        { kind: "undefined", id: 22, ...s },
        { kind: "store", slot: 1, value: 22, ...s },
      ],
    },
    ...overwritten.blocks.slice(1),
  ]);
  valid(changed);
  assert.equal(coalesceOptionalDefaults(changed, 1000)?.rewritten, 0);
});

test("budget exhaustion publishes nothing and functions without presence tests are free", () => {
  assert.equal(coalesceOptionalDefaults(single(), 3), undefined);
  assert.equal(coalesceOptionalDefaults(single(), -1), undefined);
  const plain = fn([
    {
      id: 0,
      instructions: [{ kind: "constant", id: 0, value: 1, ...s }],
      terminator: { kind: "return", value: 0, ...s },
    },
  ]);
  assert.deepEqual(coalesceOptionalDefaults(plain, 0), {
    fn: plain,
    visited: 0,
    rewritten: 0,
  });
});

test("the fused unwrap of a word array read with a word fallback is a 32-bit integer", () => {
  const result = coalesceOptionalDefaults(single(7), 1000);
  assert.ok(result !== undefined);
  assert.equal(provenWordFacts(result.fn)?.slots[2], 1);
  // A fractional fallback is not a word.
  const fractional = coalesceOptionalDefaults(single(0.5), 1000);
  assert.ok(fractional !== undefined);
  assert.equal(provenWordFacts(fractional.fn)?.slots[2], 5);
});

test("the verifier types both operands of optional-value-or", () => {
  const bad: FunctionIR = fn([
    {
      id: 0,
      instructions: [
        { kind: "constant", id: 0, value: 1, ...s },
        { kind: "optional-value-or", id: 1, value: 0, fallback: 0, ...s },
      ],
      terminator: { kind: "return", value: 1, ...s },
    },
  ]);
  assert.equal(verify({ functions: [bad] }).ok, false);
});
