import { test } from "node:test";
import assert from "node:assert/strict";
import {
  verify,
  type ModuleIR,
  type FunctionIR,
  type Instruction,
} from "@tint/ir/scalar";
import { optimizeModule } from "../src/optimization/index.ts";
const span = { start: 2, end: 7 };
function module(
  instructions: readonly Instruction[],
  result: number,
): ModuleIR {
  return {
    functions: [
      {
        id: 0,
        name: "run",
        exported: true,
        parameters: [],
        slots: ["number"],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions,
            terminator: { kind: "return", value: result, ...span },
          },
        ],
      },
    ],
  };
}
test("constant folding and local propagation preserve IDs and spans", () => {
  const input = module(
    [
      { kind: "constant", id: 0, value: 6, ...span },
      { kind: "store", slot: 0, value: 0, ...span },
      { kind: "load", id: 1, slot: 0, ...span },
      { kind: "constant", id: 2, value: 7, ...span },
      { kind: "binary", id: 3, operator: "*", left: 1, right: 2, ...span },
    ],
    3,
  );
  assert.ok(verify(input).ok);
  const result = optimizeModule(input);
  assert.equal(result.budgetExhausted, false);
  assert.equal(result.passes[0]?.rewritten, 2);
  assert.ok(verify(result.module).ok);
  assert.deepEqual(
    result.module.functions[0]?.blocks[0]?.instructions.find(
      (op) => "id" in op && op.id === 3,
    ),
    {
      kind: "constant",
      id: 3,
      value: 42,
      ...span,
    },
  );
  assert.equal(input.functions[0]?.blocks[0]?.instructions[4]?.kind, "binary");
  assert.equal(optimizeModule(result.module).passes[0]?.rewritten, 0);
});
test("folding preserves signed zero, NaN, infinities and JavaScript bitwise conversion", () => {
  const cases: [number, string, number, number][] = [
    [-0, "*", 3, -0],
    [0, "/", 0, NaN],
    [1, "/", 0, Infinity],
    [-5, "%", 2, -1],
    [4294967295, ">>>", 0, 4294967295],
    [4294967295, "|", 0, -1],
    [1, "<<", 33, 2],
    [0.1, "+", 0.2, 0.1 + 0.2],
    [Infinity, "-", Infinity, NaN],
  ];
  for (const [left, operator, right, want] of cases) {
    const input = module(
      [
        { kind: "constant", id: 0, value: left, ...span },
        { kind: "constant", id: 1, value: right, ...span },
        { kind: "binary", id: 2, operator, left: 0, right: 1, ...span },
      ],
      2,
    );
    const output = optimizeModule(input).module;
    assert.ok(verify(output).ok);
    const op = output.functions[0]?.blocks[0]?.instructions.find(
      (op) => "id" in op && op.id === 2,
    );
    assert.ok(op?.kind === "constant");
    assert.ok(Object.is(op.value, want), operator);
  }
});
test("budget exhaustion returns the original module without partial rewrites", () => {
  const input = module(
    [
      { kind: "constant", id: 0, value: 1, ...span },
      { kind: "unary", id: 1, operator: "-", operand: 0, ...span },
    ],
    1,
  );
  const output = optimizeModule(input, 1);
  assert.equal(output.module, input);
  assert.equal(output.budgetExhausted, true);
  assert.equal(output.passes[0]?.visited, 1);
  assert.equal(output.passes[0]?.rewritten, 0);
});

test("host effects and unknown stores invalidate local facts", () => {
  for (const barrier of [
    [
      {
        kind: "host-call",
        id: 1,
        operation: "argument-count",
        arguments: [],
        ...span,
      },
    ],
    [
      {
        kind: "host-call",
        id: 1,
        operation: "argument-count",
        arguments: [],
        ...span,
      },
      { kind: "store", slot: 0, value: 1, ...span },
    ],
  ] satisfies Instruction[][]) {
    const input = module(
      [
        { kind: "constant", id: 0, value: 42, ...span },
        { kind: "store", slot: 0, value: 0, ...span },
        ...barrier,
        { kind: "load", id: 2, slot: 0, ...span },
        { kind: "unary", id: 3, operator: "-", operand: 0, ...span },
        { kind: "store", slot: 0, value: 3, ...span },
      ],
      2,
    );
    assert.ok(verify(input).ok);
    const output = optimizeModule(input).module;
    assert.ok(verify(output).ok);
    const instructions = output.functions[0]!.blocks[0]!.instructions;
    if (barrier.length === 1) {
      assert.equal(
        instructions.find((op) => "id" in op && op.id === 2)?.kind,
        "load",
      );
      assert.deepEqual(
        instructions.find((op) => "id" in op && op.id === 3),
        {
          kind: "constant",
          id: 3,
          value: -42,
          ...span,
        },
      );
    } else {
      // The post-call store establishes a new snapshot, not the old constant.
      assert.equal(instructions.length, 1);
      assert.equal(instructions[0]?.kind, "host-call");
      assert.deepEqual(output.functions[0]!.blocks[0]!.terminator, {
        kind: "return",
        value: 1,
        ...span,
      });
    }
  }
});

test("SSA slot facts cross control-flow boundaries", () => {
  const base = module(
    [
      { kind: "constant", id: 0, value: 42, ...span },
      { kind: "store", slot: 0, value: 0, ...span },
    ],
    0,
  );
  const fn = base.functions[0]!;
  const input: ModuleIR = {
    functions: [
      {
        ...fn,
        blocks: [
          {
            ...fn.blocks[0]!,
            terminator: { kind: "jump", target: 1, ...span },
          },
          {
            id: 1,
            instructions: [{ kind: "load", id: 1, slot: 0, ...span }],
            terminator: { kind: "return", value: 1, ...span },
          },
        ],
      },
    ],
  };
  assert.ok(verify(input).ok);
  const output = optimizeModule(input).module;
  assert.deepEqual(verify(output), { ok: true });
  assert.ok(
    output.functions[0]!.blocks[1]!.instructions.some(
      (op) => op.kind === "constant" && op.value === 42,
    ),
  );
});

test("invalid budgets fail explicitly", () => {
  const input = module([{ kind: "constant", id: 0, value: 1, ...span }], 0);
  for (const budget of [-1, 0.5, NaN, Infinity])
    assert.throws(
      () => optimizeModule(input, budget),
      /INVALID_OPTIMIZATION_BUDGET/,
    );
});

test("dead scalar chains disappear but effectful instructions and their operands survive", () => {
  const input = module(
    [
      { kind: "constant", id: 0, value: 6, ...span },
      { kind: "constant", id: 1, value: 7, ...span },
      { kind: "binary", id: 2, operator: "*", left: 0, right: 1, ...span },
      { kind: "host-call", id: 3, operation: "close", arguments: [0], ...span },
      { kind: "constant", id: 4, value: 99, ...span },
      { kind: "unary", id: 5, operator: "-", operand: 4, ...span },
    ],
    2,
  );
  const output = optimizeModule(input);
  assert.ok(verify(output.module).ok);
  assert.deepEqual(output.module.functions[0]!.blocks[0]!.instructions, [
    input.functions[0]!.blocks[0]!.instructions[0],
    { kind: "constant", id: 2, value: 42, ...span },
    input.functions[0]!.blocks[0]!.instructions[3],
  ]);
  assert.equal(
    output.passes.find((p) => p.pass === "remove-dead-scalars")?.rewritten,
    3,
  );
});

test("a budget exhausted by the second pass preserves the completed first pass", () => {
  const input = module(
    [
      { kind: "constant", id: 0, value: 2, ...span },
      { kind: "unary", id: 1, operator: "-", operand: 0, ...span },
    ],
    1,
  );
  const result = optimizeModule(input, 3);
  assert.notEqual(result.module, input);
  assert.equal(result.budgetExhausted, true);
  assert.equal(
    result.passes.reduce((sum, p) => sum + p.visited, 0),
    3,
  );
  assert.equal(result.passes[0]?.rewritten, 1);
  assert.equal(result.passes[1]?.rewritten, 0);
  assert.deepEqual(result.module.functions[0]!.blocks[0]!.instructions[1], {
    kind: "constant",
    id: 1,
    value: -2,
    ...span,
  });
  assert.ok(verify(result.module).ok);
  assert.equal(input.functions[0]!.blocks[0]!.instructions[1]!.kind, "unary");
});

test("stores to unread private slots disappear while allocation effects remain", () => {
  const input: ModuleIR = {
    functions: [
      {
        id: 0,
        name: "allocate",
        exported: true,
        parameters: [],
        slots: ["Uint8Array"],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "constant", id: 0, value: 3000, ...span },
              {
                kind: "array-new",
                id: 1,
                type: "Uint8Array",
                length: 0,
                ...span,
              },
              { kind: "store", slot: 0, value: 1, ...span },
              { kind: "constant", id: 2, value: 42, ...span },
            ],
            terminator: { kind: "return", value: 2, ...span },
          },
        ],
      },
    ],
  };
  assert.ok(verify(input).ok);
  const result = optimizeModule(input);
  assert.ok(verify(result.module).ok);
  const instructions = result.module.functions[0]!.blocks[0]!.instructions;
  assert.ok(instructions.some((op) => op.kind === "array-new"));
  assert.ok(!instructions.some((op) => op.kind === "store"));
});

test("every exhausted phase retains completed phase statistics and valid IR", () => {
  const input = module(
    [
      { kind: "constant", id: 0, value: 6, ...span },
      { kind: "store", slot: 0, value: 0, ...span },
      { kind: "load", id: 1, slot: 0, ...span },
      { kind: "constant", id: 2, value: 7, ...span },
      { kind: "binary", id: 3, operator: "*", left: 1, right: 2, ...span },
    ],
    3,
  );
  const full = optimizeModule(input);
  let budget = 0;
  for (let phase = 0; phase < full.passes.length; phase++) {
    const limited = optimizeModule(input, budget);
    assert.equal(limited.budgetExhausted, true);
    assert.ok(verify(limited.module).ok);
    assert.deepEqual(
      limited.passes.slice(0, phase),
      full.passes.slice(0, phase),
    );
    assert.equal(limited.passes[phase]?.rewritten, 0);
    assert.equal(
      limited.passes.reduce((n, p) => n + p.visited, 0),
      budget,
    );
    if (phase > 0) assert.notEqual(limited.module, input);
    budget += full.passes[phase]!.visited;
  }
});

test("a second bounded inlining round exposes leaf wrappers and preserves its completed checkpoint", () => {
  const input: ModuleIR = {
    functions: [0, 1, 2].map((id): FunctionIR => ({
      id,
      name: "nested" + id,
      exported: id === 0,
      parameters: [0],
      slots: ["number"],
      returnType: "number",
      entry: 0,
      blocks: [
        {
          id: 0,
          instructions:
            id === 2
              ? [
                  { kind: "load", id: 0, slot: 0, ...span },
                  { kind: "unary", id: 1, operator: "-", operand: 0, ...span },
                ]
              : [
                  { kind: "load", id: 0, slot: 0, ...span },
                  {
                    kind: "call",
                    id: 1,
                    target: id + 1,
                    arguments: [0],
                    ...span,
                  },
                ],
          terminator: { kind: "return", value: 1, ...span },
        },
      ],
    })),
  };
  assert.deepEqual(verify(input), { ok: true });
  const result = optimizeModule(input, 10000000, { inlining: "guarded" });
  assert.deepEqual(verify(result.module), { ok: true });
  assert.ok(
    !result.module.functions[0]!.blocks.some((b) =>
      b.instructions.some((op) => op.kind === "call"),
    ),
  );
  const rounds = result.passes.filter(
    (p) => p.pass === "inline-small-functions",
  );
  assert.equal(rounds.length, 2);
  const firstInline = result.passes.findIndex(
    (p) => p.pass === "inline-small-functions",
  );
  const beforeLast = result.passes
    .slice(0, firstInline + 1)
    .reduce((n, p) => n + p.visited, 0);
  const limited = optimizeModule(input, beforeLast, { inlining: "guarded" });
  assert.equal(limited.budgetExhausted, true);
  assert.deepEqual(verify(limited.module), { ok: true });
  assert.ok(
    limited.module.functions[0]!.blocks.some((b) =>
      b.instructions.some((op) => op.kind === "call"),
    ),
  );
  assert.ok(
    !limited.module.functions[1]!.blocks.some((b) =>
      b.instructions.some((op) => op.kind === "call"),
    ),
  );
});

test("inlined scalar bodies receive constant and copy cleanup", () => {
  const input: ModuleIR = {
    functions: [
      {
        id: 0,
        name: "caller",
        exported: true,
        parameters: [],
        slots: [],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "constant", id: 0, value: 21, ...span },
              { kind: "call", id: 1, target: 1, arguments: [0], ...span },
            ],
            terminator: { kind: "return", value: 1, ...span },
          },
        ],
      },
      {
        id: 1,
        name: "double",
        exported: false,
        parameters: [0],
        slots: ["number"],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load", id: 0, slot: 0, ...span },
              { kind: "constant", id: 1, value: 2, ...span },
              {
                kind: "binary",
                id: 2,
                operator: "*",
                left: 0,
                right: 1,
                ...span,
              },
            ],
            terminator: { kind: "return", value: 2, ...span },
          },
        ],
      },
    ],
  };
  assert.ok(verify(input).ok);
  const output = optimizeModule(input);
  assert.ok(verify(output.module).ok, JSON.stringify(verify(output.module)));
  const caller = output.module.functions[0]!;
  assert.ok(
    caller.blocks
      .flatMap((b) => b.instructions)
      .every((op) => op.kind === "constant"),
  );
  assert.ok(
    caller.blocks
      .flatMap((b) => b.instructions)
      .some((op) => op.kind === "constant" && op.value === 42),
  );
});

test("square-root folding preserves signed zero and exceptional numeric results", () => {
  for (const value of [
    -0,
    0,
    -1,
    NaN,
    Infinity,
    -Infinity,
    2,
    Number.MIN_VALUE,
    Number.MAX_VALUE,
  ]) {
    const input = module(
      [
        { kind: "constant", id: 0, value, ...span },
        { kind: "unary", id: 1, operator: "sqrt", operand: 0, ...span },
      ],
      1,
    );
    assert.ok(verify(input).ok);
    const output = optimizeModule(input).module;
    assert.ok(verify(output).ok);
    const folded = output.functions[0]?.blocks[0]?.instructions.find(
      (op) => "id" in op && op.id === 1,
    );
    assert.ok(folded?.kind === "constant");
    assert.ok(Object.is(folded.value, Math.sqrt(value)), String(value));
  }
});

test("unused embedded strings and value packing disappear while opaque operands remain", () => {
  const input = module(
    [
      { kind: "constant", id: 0, value: 1, ...span },
      { kind: "general-wrap", id: 1, value: 0, ...span },
      { kind: "string-literal", id: 2, value: "use strict", ...span },
      { kind: "general-null", id: 3, ...span },
      { kind: "general-none", id: 4, ...span },
      {
        kind: "host-call",
        id: 5,
        operation: "random-word",
        arguments: [],
        ...span,
      },
      { kind: "general-wrap", id: 6, value: 5, ...span },
      { kind: "constant", id: 7, value: 42, ...span },
    ],
    7,
  );
  assert.ok(verify(input).ok);
  const optimized = optimizeModule(input).module;
  assert.ok(verify(optimized).ok);
  const instructions = optimized.functions[0]!.blocks.flatMap(
    (block) => block.instructions,
  );
  assert.deepEqual(
    instructions.map((op) => op.kind),
    ["host-call", "constant"],
  );
});
