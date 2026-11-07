import assert from "node:assert/strict";
import { test } from "node:test";
import { verify, type ModuleIR, type FunctionIR } from "@tint/ir/scalar";
import { inlineSmallFunctions } from "../src/optimization/inline.ts";
const span = { start: 0, end: 1 };
function fixture(): ModuleIR {
  return {
    functions: [
      {
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
              { kind: "load", id: 0, slot: 0, ...span },
              { kind: "call", id: 1, target: 1, arguments: [0], ...span },
              { kind: "call", id: 2, target: 1, arguments: [1], ...span },
            ],
            terminator: { kind: "return", value: 2, ...span },
          },
        ],
      },
      {
        id: 1,
        name: "absolute",
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
              { kind: "constant", id: 1, value: 0, ...span },
              {
                kind: "binary",
                id: 2,
                operator: "<",
                left: 0,
                right: 1,
                ...span,
              },
            ],
            terminator: {
              kind: "branch",
              condition: 2,
              consequent: 1,
              alternate: 2,
              ...span,
            },
          },
          {
            id: 1,
            instructions: [
              { kind: "load", id: 3, slot: 0, ...span },
              { kind: "unary", id: 4, operator: "-", operand: 3, ...span },
            ],
            terminator: { kind: "return", value: 4, ...span },
          },
          {
            id: 2,
            instructions: [{ kind: "load", id: 5, slot: 0, ...span }],
            terminator: { kind: "return", value: 5, ...span },
          },
        ],
      },
    ],
  };
}
function evaluate(module: ModuleIR, id: number, args: number[]): number {
  const fn = module.functions[id]!,
    slots: number[] = [],
    values: number[] = [];
  fn.parameters.forEach((slot, i) => (slots[slot] = args[i]!));
  let block = fn.entry;
  for (let steps = 0; steps < 1000; steps++) {
    const b = fn.blocks.find((b) => b.id === block)!;
    for (const op of b.instructions) {
      if (op.kind === "load") values[op.id] = slots[op.slot]!;
      else if (op.kind === "store") slots[op.slot] = values[op.value]!;
      else if (op.kind === "constant") values[op.id] = Number(op.value);
      else if (op.kind === "unary") values[op.id] = -values[op.operand]!;
      else if (op.kind === "binary")
        values[op.id] = Number(values[op.left]! < values[op.right]!);
      else if (op.kind === "call")
        values[op.id!] = evaluate(
          module,
          op.target,
          op.arguments.map((v) => values[v]!),
        );
      else throw Error(op.kind);
    }
    const t = b.terminator;
    if (t.kind === "return") return values[t.value!]!;
    if (t.kind === "branch")
      block = values[t.condition] ? t.consequent : t.alternate;
    else if (t.kind === "jump") block = t.target;
    else throw Error(t.kind);
  }
  throw Error("execution bound");
}
test("CFG inlining remaps repeated calls, branches, parameters and return values", () => {
  const input = fixture(),
    snapshot = structuredClone(input);
  assert.equal(verify(input).ok, true, JSON.stringify(verify(input)));
  const result = inlineSmallFunctions(input, 10000);
  assert.ok(result);
  assert.equal(result.inlined, 2);
  assert.equal(
    verify(result.module).ok,
    true,
    JSON.stringify(verify(result.module)),
  );
  assert.ok(
    result.module.functions[0]!.blocks.every((b) =>
      b.instructions.every((op) => op.kind !== "call"),
    ),
  );
  for (const n of [-Infinity, -100, -0, 0, 3, Infinity, NaN])
    assert.ok(
      Object.is(evaluate(input, 0, [n]), evaluate(result.module, 0, [n])),
    );
  assert.deepEqual(input, snapshot);
});
test("budget exhaustion rolls back and allocating, recursive or environment-bearing callees are retained", () => {
  const input = fixture();
  assert.equal(inlineSmallFunctions(input, 1), undefined);
  const original = input.functions[1]!;
  const variants: FunctionIR[] = [
    { ...original, environment: { byteLength: 0, cells: [] } },
    {
      ...original,
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
      ...original,
      blocks: [
        {
          id: 0,
          instructions: [
            { kind: "load", id: 0, slot: 0, ...span },
            {
              kind: "array-new",
              id: 1,
              type: "Uint8Array",
              length: 0,
              ...span,
            },
          ],
          terminator: { kind: "return", value: 0, ...span },
        },
      ],
    },
  ];
  for (const callee of variants) {
    const result = inlineSmallFunctions(
      { functions: [input.functions[0]!, callee] },
      10000,
    );
    assert.ok(result);
    assert.equal(result.inlined, 0);
  }
});
test("inlined throwing exits inherit the caller exception destination", () => {
  const input = fixture();
  const caller = input.functions[0]!;
  const module: ModuleIR = {
    functions: [
      {
        ...caller,
        slots: ["number", "general"],
        blocks: [
          { ...caller.blocks[0]!, exception: { target: 1, slot: 1 } },
          {
            id: 1,
            instructions: [{ kind: "constant", id: 3, value: 42, ...span }],
            terminator: { kind: "return", value: 3, ...span },
          },
        ],
      },
      {
        ...input.functions[1]!,
        blocks: input.functions[1]!.blocks.map((block) =>
          block.id === 1
            ? {
                ...block,
                instructions: [],
                terminator: {
                  kind: "throw-literal",
                  value: "failure",
                  ...span,
                },
              }
            : block,
        ),
      },
    ],
  };
  assert.equal(verify(module).ok, true);
  const result = inlineSmallFunctions(module, 10000);
  assert.ok(result);
  assert.equal(
    verify(result.module).ok,
    true,
    JSON.stringify(verify(result.module)),
  );
  const throwing = result.module.functions[0]!.blocks.filter(
    (b) => b.terminator.kind === "throw-literal",
  );
  assert.equal(throwing.length, 2);
  for (const block of throwing)
    assert.deepEqual(block.exception, { target: 1, slot: 1 });
});

test("straight-line leaves inline without splitting live caller temporaries", () => {
  const input = fixture(),
    callee = input.functions[1]!;
  const module: ModuleIR = {
    functions: [
      input.functions[0]!,
      {
        ...callee,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load", id: 0, slot: 0, ...span },
              { kind: "unary", id: 1, operator: "-", operand: 0, ...span },
            ],
            terminator: { kind: "return", value: 1, ...span },
          },
        ],
      },
    ],
  };
  const result = inlineSmallFunctions(module, 10000);
  assert.ok(result);
  assert.equal(result.inlined, 2);
  assert.equal(result.module.functions[0]!.blocks.length, 1);
  assert.equal(
    verify(result.module).ok,
    true,
    JSON.stringify(verify(result.module)),
  );
  for (const value of [-Infinity, -100, -0, 0, Infinity, NaN])
    assert.ok(
      Object.is(
        evaluate(module, 0, [value]),
        evaluate(result.module, 0, [value]),
      ),
    );
});
test("CFG expansion retains calls when pre-call values would cross an IR block boundary", () => {
  const input = fixture(),
    caller = input.functions[0]!,
    first = caller.blocks[0]!;
  const module: ModuleIR = {
    functions: [
      {
        ...caller,
        blocks: [
          {
            ...first,
            instructions: first.instructions.slice(0, 2),
            terminator: { kind: "return", value: 0, ...span },
          },
        ],
      },
      input.functions[1]!,
    ],
  };
  assert.equal(verify(module).ok, true);
  const result = inlineSmallFunctions(module, 10000);
  assert.ok(result);
  assert.equal(result.inlined, 0);
  assert.equal(result.module, module);
});

test("inlines a checked typed-array reader with a local view alias", () => {
  const module: ModuleIR = {
    functions: [
      {
        id: 0,
        name: "caller",
        exported: true,
        parameters: [0, 1],
        slots: ["Uint32Array", "number"],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load", id: 0, slot: 0, ...span },
              { kind: "load", id: 1, slot: 1, ...span },
              { kind: "call", id: 2, target: 1, arguments: [0, 1], ...span },
            ],
            terminator: { kind: "return", value: 2, ...span },
          },
        ],
      },
      {
        id: 1,
        name: "word",
        exported: false,
        parameters: [0, 1],
        slots: ["Uint32Array", "number", "Uint32Array", "optional-number"],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load", id: 0, slot: 0, ...span },
              { kind: "store", slot: 2, value: 0, ...span },
              { kind: "load", id: 1, slot: 2, ...span },
              { kind: "load", id: 2, slot: 1, ...span },
              { kind: "array-read", id: 3, array: 1, index: 2, ...span },
              { kind: "store", slot: 3, value: 3, ...span },
              { kind: "optional-present", id: 4, value: 3, ...span },
            ],
            terminator: {
              kind: "branch",
              condition: 4,
              consequent: 1,
              alternate: 2,
              ...span,
            },
          },
          {
            id: 1,
            instructions: [
              { kind: "load", id: 5, slot: 3, ...span },
              { kind: "optional-value", id: 6, value: 5, ...span },
            ],
            terminator: { kind: "return", value: 6, ...span },
          },
          {
            id: 2,
            instructions: [],
            terminator: {
              kind: "throw-literal",
              value: "missing word",
              ...span,
            },
          },
        ],
      },
    ],
  };
  assert.deepEqual(verify(module), { ok: true });
  const result = inlineSmallFunctions(module, 10000)!;
  assert.equal(result.inlined, 1);
  assert.deepEqual(verify(result.module), { ok: true });
  const caller = result.module.functions[0]!;
  assert.ok(
    !caller.blocks.some((b) => b.instructions.some((op) => op.kind === "call")),
  );
  assert.ok(caller.slots.filter((type) => type === "Uint32Array").length >= 3);
  assert.ok(caller.blocks.some((b) => b.terminator.kind === "throw-literal"));
});

test("inlines guarded record reads while retaining the failure edge and rejecting writes", () => {
  const module: ModuleIR = {
    records: [
      {
        byteLength: 32,
        fields: [{ offset: 16, type: "number", mutable: true }],
      },
    ],
    functions: [
      {
        id: 0,
        name: "caller",
        exported: true,
        parameters: [0],
        slots: ["reference"],
        returnType: "number",
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
        name: "reader",
        exported: false,
        parameters: [0],
        slots: ["reference", "number"],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [{ kind: "load", id: 0, slot: 0, ...span }],
            terminator: {
              kind: "record",
              object: 0,
              record: 0,
              field: 0,
              operation: "read",
              slot: 1,
              consequent: 1,
              alternate: 2,
              ...span,
            },
          },
          {
            id: 1,
            instructions: [{ kind: "load", id: 1, slot: 1, ...span }],
            terminator: { kind: "return", value: 1, ...span },
          },
          {
            id: 2,
            instructions: [],
            terminator: {
              kind: "throw-literal",
              value: "invalid record",
              ...span,
            },
          },
        ],
      },
    ],
  };
  assert.deepEqual(verify(module), { ok: true });
  const result = inlineSmallFunctions(module, 10000)!;
  assert.equal(result.inlined, 1);
  assert.deepEqual(verify(result.module), { ok: true });
  const blocks = result.module.functions[0]!.blocks;
  assert.ok(blocks.some((b) => b.terminator.kind === "record"));
  assert.ok(blocks.some((b) => b.terminator.kind === "throw-literal"));
  const reader = module.functions[1]!,
    first = reader.blocks[0]!;
  assert.equal(first.terminator.kind, "record");
  if (first.terminator.kind !== "record") throw Error("fixture");
  const write: ModuleIR = {
    ...module,
    functions: [
      module.functions[0]!,
      {
        ...reader,
        blocks: [
          {
            ...first,
            instructions: [
              ...first.instructions,
              { kind: "constant", id: 2, value: 42, ...span },
              { kind: "store", slot: 1, value: 2, ...span },
            ],
            terminator: { ...first.terminator, operation: "write" },
          },
          ...reader.blocks.slice(1),
        ],
      },
    ],
  };
  assert.deepEqual(verify(write), { ok: true });
  assert.equal(inlineSmallFunctions(write, 10000)!.inlined, 0);
});

test("CFG parameter assignments stay private to each inline expansion", () => {
  const input = fixture(),
    callee = input.functions[1]!;
  const module: ModuleIR = {
    functions: [
      input.functions[0]!,
      {
        ...callee,
        blocks: callee.blocks.map((block) =>
          block.id !== 1
            ? block
            : {
                ...block,
                instructions: [
                  ...block.instructions,
                  { kind: "store", slot: 0, value: 4, ...span },
                  { kind: "load", id: 6, slot: 0, ...span },
                ],
                terminator: { kind: "return", value: 6, ...span },
              },
        ),
      },
    ],
  };
  assert.deepEqual(verify(module), { ok: true });
  const result = inlineSmallFunctions(module, 10000)!;
  assert.equal(result.inlined, 2);
  assert.deepEqual(verify(result.module), { ok: true });
  for (const n of [-7, -0, 0, 9, Infinity, NaN])
    assert.ok(
      Object.is(evaluate(module, 0, [n]), evaluate(result.module, 0, [n])),
    );
});

test("reference results use traced result slots and preserve wrapper operands", () => {
  const module: ModuleIR = {
    functions: [
      {
        id: 0,
        name: "caller",
        exported: true,
        parameters: [0],
        slots: ["reference"],
        returnType: "optional-reference",
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
        name: "wrap",
        exported: false,
        parameters: [0],
        slots: ["reference"],
        returnType: "optional-reference",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load", id: 0, slot: 0, ...span },
              { kind: "reference-wrap", id: 1, value: 0, ...span },
            ],
            terminator: { kind: "return", value: 1, ...span },
          },
        ],
      },
    ],
  };
  assert.deepEqual(verify(module), { ok: true });
  const snapshot = structuredClone(module),
    result = inlineSmallFunctions(module, 10000)!;
  assert.equal(result.inlined, 1);
  assert.deepEqual(verify(result.module), { ok: true });
  assert.equal(result.module.functions[0]!.slots.at(-1), "optional-reference");
  assert.ok(
    result.module.functions[0]!.blocks[0]!.instructions.some(
      (op) => op.kind === "reference-wrap",
    ),
  );
  assert.deepEqual(module, snapshot);
});

test("straight-line parameter stores retain their call instead of aliasing caller values", () => {
  const input = fixture(),
    callee: FunctionIR = {
      ...input.functions[1]!,
      blocks: [
        {
          id: 0,
          instructions: [
            { kind: "constant", id: 0, value: 42, ...span },
            { kind: "store", slot: 0, value: 0, ...span },
            { kind: "load", id: 1, slot: 0, ...span },
          ],
          terminator: { kind: "return", value: 1, ...span },
        },
      ],
    };
  const module = { functions: [input.functions[0]!, callee] };
  assert.deepEqual(verify(module), { ok: true });
  assert.equal(inlineSmallFunctions(module, 10000)!.inlined, 0);
});

test("empty CFG blocks consume expansion cost and the analysis budget", () => {
  const input = fixture(),
    callee: FunctionIR = {
      ...input.functions[1]!,
      blocks: Array.from({ length: 70 }, (_, id) => ({
        id,
        instructions:
          id === 69 ? [{ kind: "load" as const, id: 0, slot: 0, ...span }] : [],
        terminator:
          id === 69
            ? { kind: "return" as const, value: 0, ...span }
            : { kind: "jump" as const, target: id + 1, ...span },
      })),
    };
  const module = { functions: [input.functions[0]!, callee] };
  assert.deepEqual(verify(module), { ok: true });
  assert.equal(inlineSmallFunctions(module, 10000)!.inlined, 0);
  assert.equal(inlineSmallFunctions(module, 20), undefined);
});
