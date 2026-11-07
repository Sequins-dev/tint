import assert from "node:assert/strict";
import test from "node:test";
import { verify, type FunctionIR, type ModuleIR } from "@tint/ir/scalar";
import { optimizeModule } from "../src/optimization/index.ts";

const span = { start: 0, end: 0 };
function copies(id: number): FunctionIR {
  return {
    id,
    name: "copies" + id,
    exported: true,
    parameters: [0],
    slots: ["number", "number"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "load", id: 0, slot: 0, ...span },
          { kind: "store", slot: 1, value: 0, ...span },
          { kind: "load", id: 1, slot: 1, ...span },
        ],
        terminator: { kind: "return", value: 1, ...span },
      },
    ],
  };
}
test("large graphs retain completed local cleanup within the total work bound", () => {
  const input: ModuleIR = {
    functions: Array.from({ length: 50 }, (_, id) => copies(id)),
  };
  const original = structuredClone(input);
  assert.deepEqual(verify(input), { ok: true });
  const output = optimizeModule(input, 500);
  assert.deepEqual(verify(output.module), { ok: true });
  assert.deepEqual(input, original);
  assert.equal(output.budgetExhausted, true);
  assert.ok(output.passes.reduce((n, pass) => n + pass.visited, 0) <= 500);
  const first = output.module.functions[0]!;
  assert.deepEqual(first.slots, ["number"]);
  assert.deepEqual(first.blocks[0]!.instructions, [
    { kind: "load", id: 0, slot: 0, ...span },
  ]);
  assert.deepEqual(first.blocks[0]!.terminator, {
    kind: "return",
    value: 0,
    ...span,
  });
  assert.equal(output.module.functions.at(-1), input.functions.at(-1));
});
test("an oversized function does not discard cleanup in later small functions", () => {
  const large = copies(0);
  const input: ModuleIR = {
    functions: [
      {
        ...large,
        blocks: [
          {
            id: 0,
            instructions: Array.from({ length: 25000 }, (_, id) => ({
              kind: "constant" as const,
              id,
              value: id,
              ...span,
            })),
            terminator: { kind: "return", value: 24999, ...span },
          },
        ],
      },
      copies(1),
    ],
  };
  const output = optimizeModule(input, 60000);
  assert.deepEqual(verify(output.module), { ok: true });
  assert.equal(output.budgetExhausted, true);
  assert.ok(output.passes.reduce((n, pass) => n + pass.visited, 0) <= 60000);
  assert.deepEqual(output.module.functions[1]!.slots, ["number"]);
});
test("a budget smaller than one graph scan preserves the original module", () => {
  const input: ModuleIR = {
    functions: Array.from({ length: 50 }, (_, id) => copies(id)),
  };
  for (const budget of [0, 100]) {
    const output = optimizeModule(input, budget);
    assert.equal(output.module, input);
    assert.equal(output.budgetExhausted, true);
    assert.equal(output.passes[0]?.pass, "fold-constants");
    assert.equal(output.passes[0]?.visited, budget);
  }
});
test("completed cleanup retains observable host effects and ABI slots", () => {
  const base = copies(0);
  const effectful: FunctionIR = {
    ...base,
    parameters: [0, 1],
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "load", id: 0, slot: 0, ...span },
          { kind: "load", id: 1, slot: 0, ...span },
          {
            kind: "host-call",
            id: 2,
            operation: "argument-count",
            arguments: [],
            ...span,
          },
        ],
        terminator: { kind: "return", value: 1, ...span },
      },
    ],
  };
  const input: ModuleIR = {
    functions: [
      effectful,
      ...Array.from({ length: 49 }, (_, id) => copies(id + 1)),
    ],
  };
  const output = optimizeModule(input, 500);
  assert.deepEqual(verify(output.module), { ok: true });
  const fn = output.module.functions[0]!;
  assert.deepEqual(fn.parameters, [0, 1]);
  assert.deepEqual(fn.slots, ["number", "number"]);
  assert.deepEqual(
    fn.blocks[0]!.instructions.map((op) => op.kind),
    ["load", "host-call"],
  );
});

test("local cleanup preserves guarded transfers and abrupt-completion storage", () => {
  const fn: FunctionIR = {
    ...copies(0),
    parameters: [1],
    slots: ["number", "reference", "number", "general"],
    blocks: [
      {
        id: 0,
        instructions: [{ kind: "load", id: 0, slot: 1, ...span }],
        exception: { target: 2, slot: 3 },
        terminator: {
          kind: "record",
          object: 0,
          record: 0,
          field: 0,
          operation: "read",
          slot: 2,
          consequent: 1,
          alternate: 2,
          ...span,
        },
      },
      {
        id: 1,
        instructions: [{ kind: "load", id: 1, slot: 2, ...span }],
        terminator: { kind: "return", value: 1, ...span },
      },
      { id: 2, instructions: [], terminator: { kind: "trap", ...span } },
    ],
  };
  const input: ModuleIR = {
    records: [
      {
        byteLength: 32,
        fields: [{ offset: 16, type: "number", mutable: true }],
      },
    ],
    functions: [fn, ...Array.from({ length: 49 }, (_, id) => copies(id + 1))],
  };
  assert.deepEqual(verify(input), { ok: true });
  const output = optimizeModule(input, 500);
  assert.deepEqual(verify(output.module), { ok: true });
  const cleaned = output.module.functions[0]!;
  assert.deepEqual(cleaned.parameters, [0]);
  assert.deepEqual(cleaned.slots, ["reference", "number", "general"]);
  assert.deepEqual(cleaned.blocks[0]!.exception, { target: 2, slot: 2 });
  const term = cleaned.blocks[0]!.terminator;
  assert.equal(term.kind, "record");
  if (term.kind === "record") {
    assert.equal(term.slot, 1);
    assert.equal(term.consequent, 1);
    assert.equal(term.alternate, 2);
  }
});

test("large graphs retain bounded call inlining before local cleanup", () => {
  const input: ModuleIR = {
    functions: [
      {
        ...copies(0),
        slots: ["number"],
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load", id: 0, slot: 0, ...span },
              { kind: "call", id: 1, target: 1, arguments: [0], ...span },
            ],
            terminator: { kind: "return", value: 1, ...span },
          },
        ],
      },
      {
        ...copies(1),
        slots: ["number"],
        blocks: [
          {
            id: 0,
            instructions: [{ kind: "load", id: 0, slot: 0, ...span }],
            terminator: { kind: "return", value: 0, ...span },
          },
        ],
      },
      {
        id: 2,
        name: "large",
        exported: true,
        parameters: [],
        slots: [],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: Array.from({ length: 500 }, (_, id) => ({
              kind: "constant" as const,
              id,
              value: id,
              ...span,
            })),
            terminator: { kind: "return", value: 499, ...span },
          },
        ],
      },
    ],
  };
  assert.deepEqual(verify(input), { ok: true });
  const snapshot = structuredClone(input),
    output = optimizeModule(input, 1000);
  assert.deepEqual(verify(output.module), { ok: true });
  assert.ok(
    output.passes.some(
      (p) => p.pass === "inline-small-functions" && p.rewritten === 1,
    ),
  );
  assert.ok(output.passes.reduce((n, p) => n + p.visited, 0) <= 1000);
  assert.ok(
    output.module.functions[0]!.blocks.every((b) =>
      b.instructions.every((op) => op.kind !== "call"),
    ),
  );
  assert.deepEqual(input, snapshot);
});

test("copy cleanup exposes bounded reference helpers before large-graph inlining", () => {
  const instructions: import("@tint/ir/scalar").Instruction[] = [
    { kind: "load", id: 0, slot: 0, ...span },
  ];
  for (let i = 0; i < 35; i++)
    instructions.push(
      { kind: "store", slot: 1, value: i, ...span },
      { kind: "load", id: i + 1, slot: 1, ...span },
    );
  const input: ModuleIR = {
    functions: [
      {
        id: 0,
        name: "caller",
        exported: true,
        parameters: [0],
        slots: ["reference"],
        returnType: "reference",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load", id: 0, slot: 0, ...span },
              { kind: "call", id: 1, target: 1, arguments: [0], ...span },
            ],
            terminator: { kind: "return", value: 1, ...span },
          },
        ],
      },
      {
        id: 1,
        name: "copies",
        exported: false,
        parameters: [0],
        slots: ["reference", "reference"],
        returnType: "reference",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions,
            terminator: { kind: "return", value: 35, ...span },
          },
        ],
      },
      {
        id: 2,
        name: "large",
        exported: true,
        parameters: [],
        slots: [],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: Array.from({ length: 500 }, (_, id) => ({
              kind: "constant" as const,
              id,
              value: id,
              ...span,
            })),
            terminator: { kind: "return", value: 499, ...span },
          },
        ],
      },
    ],
  };
  assert.deepEqual(verify(input), { ok: true });
  const result = optimizeModule(input, 2000);
  assert.deepEqual(verify(result.module), { ok: true });
  assert.ok(result.passes.reduce((n, p) => n + p.visited, 0) <= 2000);
  assert.ok(
    result.module.functions[0]!.blocks.every((b) =>
      b.instructions.every((op) => op.kind !== "call"),
    ),
  );
});
