import assert from "node:assert/strict";
import { test } from "node:test";
import {
  instructionResult,
  verify,
  type FunctionDebug,
  type FunctionIR,
  type ModuleIR,
} from "@tint/ir/scalar";
import {
  compactSlots,
  foldSSAConstants,
  optimizeModule,
} from "@tint/ir/optimization";
import { inlineSmallFunctions } from "../src/optimization/inline.ts";

function at(start: number) {
  return { start, end: start + 1 };
}
function debug(
  names: readonly [string, number][],
  parameters: number = 0,
): FunctionDebug {
  return {
    variables: names.map(([name], index) => ({
      name,
      ...at(100 + index),
      parameter: index < parameters,
    })),
    slots: names.map(([, slot], variable) => ({ slot, variable })),
    values: [],
    inlineSites: [],
  };
}
/** caller(n) = twice(n) + 1; twice(value) { const doubled = value * 2; return doubled }. */
function module(withDebug: boolean): ModuleIR {
  const caller: FunctionIR = {
    id: 0,
    name: "caller",
    exported: true,
    parameters: [0],
    slots: ["number"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "load", id: 0, slot: 0, ...at(10) },
          { kind: "call", id: 1, target: 1, arguments: [0], ...at(11) },
          { kind: "constant", id: 2, value: 1, ...at(12) },
          {
            kind: "binary",
            id: 3,
            operator: "+",
            left: 1,
            right: 2,
            ...at(13),
          },
        ],
        terminator: { kind: "return", value: 3, ...at(14) },
      },
    ],
    ...(withDebug ? { debug: debug([["n", 0]], 1) } : {}),
  };
  const callee: FunctionIR = {
    id: 1,
    name: "twice",
    exported: false,
    parameters: [0],
    slots: ["number", "number"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "load", id: 0, slot: 0, ...at(20) },
          { kind: "constant", id: 1, value: 2, ...at(21) },
          {
            kind: "binary",
            id: 2,
            operator: "*",
            left: 0,
            right: 1,
            ...at(22),
          },
          { kind: "store", slot: 1, value: 2, ...at(23) },
          { kind: "load", id: 3, slot: 1, ...at(24) },
        ],
        terminator: { kind: "return", value: 3, ...at(25) },
      },
    ],
    ...(withDebug
      ? {
          debug: debug(
            [
              ["value", 0],
              ["doubled", 1],
            ],
            1,
          ),
        }
      : {}),
  };
  return { functions: [caller, callee] };
}

test("inlining records the call site, keeps callee spans and adopts callee variables", () => {
  const inlined = inlineSmallFunctions(module(true), 10000);
  assert.ok(inlined !== undefined && inlined.inlined === 1);
  assert.deepEqual(verify(inlined.module), { ok: true });
  const caller = inlined.module.functions[0]!,
    info = caller.debug!;
  assert.deepEqual(info.inlineSites, [{ callee: "twice", ...at(11) }]);
  const copied = caller.blocks[0]!.instructions.filter(
    (op) => op.inline !== undefined,
  );
  assert.ok(copied.length > 0);
  for (const op of copied) {
    assert.equal(op.inline, 0);
    assert.ok(op.start >= 20 && op.start <= 25, "callee span retained");
  }
  assert.deepEqual(
    info.variables.map((variable) => [variable.name, variable.inline]),
    [
      ["n", undefined],
      ["value", 0],
      ["doubled", 0],
    ],
  );
  // `doubled` keeps its (copied) slot; the straight-line parameter `value`
  // is the argument value itself.
  const doubled = info.slots.find((binding) => binding.variable === 2)!;
  assert.equal(caller.slots[doubled.slot], "number");
  assert.deepEqual(info.values, [{ variable: 1, value: 0, after: -1 }]);
});

test("inlining without debug metadata keeps the call span and records nothing", () => {
  const inlined = inlineSmallFunctions(module(false), 10000);
  assert.ok(inlined !== undefined && inlined.inlined === 1);
  const caller = inlined.module.functions[0]!;
  assert.equal(caller.debug, undefined);
  for (const op of caller.blocks[0]!.instructions) {
    assert.equal(op.inline, undefined);
    if (op.start >= 20) assert.fail("callee span leaked into default output");
  }
});

test("nested inline sites chain to their enclosing call", () => {
  const base = module(true),
    outer: FunctionIR = {
      id: 2,
      name: "outer",
      exported: true,
      parameters: [0],
      slots: ["number"],
      returnType: "number",
      entry: 0,
      blocks: [
        {
          id: 0,
          instructions: [
            { kind: "load", id: 0, slot: 0, ...at(30) },
            { kind: "call", id: 1, target: 0, arguments: [0], ...at(31) },
          ],
          terminator: { kind: "return", value: 1, ...at(32) },
        },
      ],
      debug: debug([["m", 0]], 1),
    };
  const once = inlineSmallFunctions(
    { functions: [base.functions[0]!, base.functions[1]!, outer] },
    10000,
  )!;
  const twice = inlineSmallFunctions(once.module, 10000)!;
  assert.deepEqual(verify(twice.module), { ok: true });
  const sites = twice.module.functions[2]!.debug!.inlineSites;
  assert.deepEqual(sites, [
    { callee: "caller", ...at(31) },
    { callee: "twice", ...at(11), parent: 0 },
  ]);
});

test("slot compaction remaps named slots and drops removed ones", () => {
  const fn: FunctionIR = {
    ...module(true).functions[1]!,
    slots: ["number", "boolean", "number"],
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "load", id: 0, slot: 0, ...at(20) },
          { kind: "store", slot: 2, value: 0, ...at(21) },
          { kind: "load", id: 1, slot: 2, ...at(22) },
        ],
        terminator: { kind: "return", value: 1, ...at(23) },
      },
    ],
    debug: debug(
      [
        ["value", 0],
        ["unused", 1],
        ["copy", 2],
      ],
      1,
    ),
  };
  const compacted = compactSlots(fn, 1000)!;
  assert.equal(compacted.removed, 1);
  assert.deepEqual(compacted.fn.debug!.slots, [
    { slot: 0, variable: 0 },
    { slot: 1, variable: 2 },
  ]);
  assert.equal(compacted.fn.debug!.variables.length, 3);
});

test("removed stores leave value bindings to defined values", () => {
  const optimized = optimizeModule(module(true)).module;
  assert.deepEqual(verify(optimized), { ok: true });
  for (const fn of optimized.functions) {
    const info = fn.debug!,
      defined = new Set<number>();
    for (const block of fn.blocks)
      for (const op of block.instructions) {
        const id = instructionResult(op);
        if (id !== undefined) defined.add(id);
      }
    for (const binding of info.values) {
      assert.ok(defined.has(binding.value), "bound value is defined");
      assert.ok(binding.after === -1 || defined.has(binding.after));
    }
  }
  const callee = optimized.functions[1]!;
  // `doubled` lost its slot: it is the multiplication's value.
  const doubled = callee.debug!.values.find(
    (binding) => binding.variable === 1,
  );
  assert.ok(doubled !== undefined);
  const definition = callee.blocks[0]!.instructions.find(
    (op) => instructionResult(op) === doubled.value,
  );
  assert.equal(definition?.kind, "binary");
});

test("SSA promotion binds promoted variables to their values", () => {
  // let x = 1; if (flag) x = 1; return x + 1   (x folds to the constant 1)
  const fn: FunctionIR = {
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
        instructions: [
          { kind: "constant", id: 0, value: 1, ...at(1) },
          { kind: "store", slot: 1, value: 0, ...at(2) },
          { kind: "load", id: 1, slot: 0, ...at(3) },
        ],
        terminator: {
          kind: "branch",
          condition: 1,
          consequent: 1,
          alternate: 2,
          ...at(4),
        },
      },
      {
        id: 1,
        instructions: [
          { kind: "constant", id: 2, value: 1, ...at(5) },
          { kind: "store", slot: 1, value: 2, ...at(6) },
        ],
        terminator: { kind: "jump", target: 2, ...at(7) },
      },
      {
        id: 2,
        instructions: [
          { kind: "load", id: 3, slot: 1, ...at(8) },
          { kind: "constant", id: 4, value: 1, ...at(9) },
          {
            kind: "binary",
            id: 5,
            operator: "+",
            left: 3,
            right: 4,
            ...at(10),
          },
        ],
        terminator: { kind: "return", value: 5, ...at(11) },
      },
    ],
    debug: debug(
      [
        ["flag", 0],
        ["x", 1],
      ],
      1,
    ),
  };
  const folded = foldSSAConstants(fn, 100000);
  assert.ok(folded !== undefined && folded.rewritten > 0);
  assert.deepEqual(verify({ functions: [folded.fn] }), { ok: true });
  const info = folded.fn.debug!,
    bindings = info.values.filter((binding) => binding.variable === 1);
  // Both removed stores and the join's parameter now carry `x`.
  assert.ok(bindings.length >= 2);
  const defined = new Map<number, number>();
  for (const block of folded.fn.blocks)
    for (const op of block.instructions) {
      const id = instructionResult(op);
      if (id !== undefined) defined.set(id, block.id);
    }
  for (const binding of bindings) assert.ok(defined.has(binding.value));
  assert.ok(
    bindings.some((binding) => defined.get(binding.value) === 2),
    "the join block's value holds x",
  );
});

test("the verifier rejects malformed debug metadata", () => {
  const base = module(true),
    caller = base.functions[0]!;
  for (const changed of [
    { ...caller.debug!, slots: [{ slot: 9, variable: 0 }] },
    { ...caller.debug!, slots: [{ slot: 0, variable: 4 }] },
    { ...caller.debug!, values: [{ variable: 0, value: 0, after: -2 }] },
    {
      ...caller.debug!,
      variables: [{ name: "n", ...at(1), parameter: true, inline: 0 }],
    },
    {
      ...caller.debug!,
      inlineSites: [{ callee: "twice", ...at(1), parent: 0 }],
    },
  ])
    assert.equal(
      verify({ functions: [{ ...caller, debug: changed }, base.functions[1]!] })
        .ok,
      false,
    );
  const marked: FunctionIR = {
    ...caller,
    blocks: [
      {
        ...caller.blocks[0]!,
        instructions: [{ kind: "load", id: 0, slot: 0, ...at(10), inline: 0 }],
        terminator: { kind: "return", value: 0, ...at(14) },
      },
    ],
  };
  assert.equal(verify({ functions: [marked, base.functions[1]!] }).ok, false);
});
