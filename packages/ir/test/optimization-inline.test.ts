import assert from "node:assert/strict";
import { test } from "node:test";
import {
  verify,
  type ModuleIR,
  type FunctionIR,
  type Instruction,
} from "@tint/ir/scalar";
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
test("CFG expansion rematerializes crossing loads in the continuation block", () => {
  const input = fixture(),
    caller = input.functions[0]!,
    first = caller.blocks[0]!;
  // Value 0 (a load of slot 0) is used after the call by the return.
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
  assert.equal(result.inlined, 1);
  assert.deepEqual(verify(result.module), { ok: true });
  const blocks = result.module.functions[0]!.blocks;
  const exit = blocks.find((block) => block.terminator.kind === "return");
  assert.ok(exit !== undefined && exit.terminator.kind === "return");
  const returned = exit.terminator.value;
  // The returned value is a fresh reload of slot 0 in the exit block.
  assert.ok(
    exit.instructions.some(
      (op) => op.kind === "load" && op.id === returned && op.slot === 0,
    ),
  );
});

test("CFG expansion carries computed pre-call values across the expansion in a slot", () => {
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
            instructions: [
              first.instructions[0]!,
              { kind: "unary", id: 9, operator: "-", operand: 0, ...span },
              { kind: "call", id: 1, target: 1, arguments: [0], ...span },
            ],
            terminator: { kind: "return", value: 9, ...span },
          },
        ],
      },
      input.functions[1]!,
    ],
  };
  assert.equal(verify(module).ok, true);
  const result = inlineSmallFunctions(module, 10000);
  assert.ok(result);
  assert.equal(result.inlined, 1);
  assert.ok(verify(result.module).ok, JSON.stringify(verify(result.module)));
  const inlined = result.module.functions[0]!;
  // The negation is stored before the expansion and reloaded after it.
  const stored = inlined.blocks[0]!.instructions.find(
    (op) => op.kind === "store" && op.value === 9,
  );
  assert.ok(stored?.kind === "store");
  const spill = stored.slot;
  assert.ok(spill >= caller.slots.length);
  assert.equal(inlined.slots[spill], "number");
  const exit = inlined.blocks.find(
    (block) => block.terminator.kind === "return",
  )!;
  assert.ok(
    exit.instructions.some((op) => op.kind === "load" && op.slot === spill),
  );
});

test("a value crossing two expansions in one block is spilled under its current name", () => {
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
            instructions: [
              first.instructions[0]!,
              { kind: "unary", id: 9, operator: "-", operand: 0, ...span },
              { kind: "call", id: 1, target: 1, arguments: [0], ...span },
              { kind: "call", id: 2, target: 1, arguments: [0], ...span },
            ],
            terminator: { kind: "return", value: 9, ...span },
          },
        ],
      },
      input.functions[1]!,
    ],
  };
  assert.equal(verify(module).ok, true);
  const result = inlineSmallFunctions(module, 10000);
  assert.ok(result);
  assert.equal(result.inlined, 2);
  assert.ok(verify(result.module).ok, JSON.stringify(verify(result.module)));
});

/** A caller that loads a record from slot 1 (value 12), stores the slot
 * again before an expanded call, and uses the loaded value after it: stored
 * into the slot, or read directly. */
function crossingRecord(use: "store" | "record-read"): ModuleIR {
  const input = fixture(),
    caller = input.functions[0]!,
    first = caller.blocks[0]!;
  return {
    records: [
      {
        byteLength: 32,
        fields: [{ offset: 16, type: "number", mutable: true }],
      },
    ],
    functions: [
      {
        ...caller,
        slots: ["number", "reference"],
        blocks: [
          {
            ...first,
            instructions: [
              first.instructions[0]!,
              { kind: "record-new", id: 9, record: 0, arguments: [0], ...span },
              { kind: "store", slot: 1, value: 9, ...span },
              { kind: "load", id: 12, slot: 1, ...span },
              { kind: "store", slot: 1, value: 9, ...span },
              { kind: "call", id: 1, target: 1, arguments: [0], ...span },
              use === "store"
                ? { kind: "store", slot: 1, value: 12, ...span }
                : {
                    kind: "record-read",
                    id: 10,
                    object: 12,
                    record: 0,
                    field: 0,
                    ...span,
                  },
            ],
            terminator: {
              kind: "return",
              value: use === "store" ? 1 : 10,
              ...span,
            },
          },
        ],
      },
      input.functions[1]!,
    ],
  };
}
test("CFG expansion carries a load whose slot is stored again across the expansion", () => {
  const module = crossingRecord("store");
  assert.equal(verify(module).ok, true, JSON.stringify(verify(module)));
  const result = inlineSmallFunctions(module, 10000);
  assert.ok(result);
  assert.equal(result.inlined, 1);
  assert.ok(verify(result.module).ok, JSON.stringify(verify(result.module)));
  const inlined = result.module.functions[0]!;
  const spill = inlined.blocks[0]!.instructions.find(
    (op) => op.kind === "store" && op.value === 12,
  );
  assert.ok(spill?.kind === "store");
  assert.ok(spill.slot >= 2);
  assert.equal(inlined.slots[spill.slot], "reference");
});

test("CFG expansion retains calls whose crossing record is read directly after them", () => {
  // A direct read's layout proof follows unique-predecessor chains, which
  // the expansion's joins would break.
  const module = crossingRecord("record-read");
  assert.equal(verify(module).ok, true, JSON.stringify(verify(module)));
  const result = inlineSmallFunctions(module, 10000);
  assert.ok(result);
  assert.equal(result.inlined, 0);
  assert.equal(result.module, module);
});

test("CFG expansion retains calls when a crossing value has no slot type", () => {
  const input = fixture(),
    caller = input.functions[0]!,
    first = caller.blocks[0]!;
  const module: ModuleIR = {
    records: [
      {
        byteLength: 32,
        fields: [{ offset: 16, type: "number", mutable: true }],
      },
    ],
    functions: [
      {
        ...caller,
        slots: ["number", "reference"],
        blocks: [
          {
            ...first,
            instructions: [
              first.instructions[0]!,
              { kind: "record-new", id: 9, record: 0, arguments: [0], ...span },
              { kind: "call", id: 1, target: 1, arguments: [0], ...span },
              { kind: "store", slot: 1, value: 9, ...span },
            ],
            terminator: { kind: "return", value: 1, ...span },
          },
        ],
      },
      input.functions[1]!,
    ],
  };
  assert.equal(verify(module).ok, true, JSON.stringify(verify(module)));
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

test("inlines guarded record reads and writes while retaining the failure edge", () => {
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
  // A checked write clones like a read: the guarded store stays, with its
  // failure edge.
  const written = inlineSmallFunctions(write, 10000)!;
  assert.equal(written.inlined, 1);
  assert.deepEqual(verify(written.module), { ok: true });
  assert.ok(
    written.module.functions[0]!.blocks.some(
      (b) =>
        b.terminator.kind === "record" && b.terminator.operation === "write",
    ),
  );
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
      blocks: Array.from({ length: 140 }, (_, id) => ({
        id,
        instructions:
          id === 139
            ? [{ kind: "load" as const, id: 0, slot: 0, ...span }]
            : [],
        terminator:
          id === 139
            ? { kind: "return" as const, value: 0, ...span }
            : { kind: "jump" as const, target: id + 1, ...span },
      })),
    };
  const module = { functions: [input.functions[0]!, callee] };
  assert.deepEqual(verify(module), { ok: true });
  assert.equal(inlineSmallFunctions(module, 10000)!.inlined, 0);
  assert.equal(inlineSmallFunctions(module, 20), undefined);
});

test("direct immutable record reads retain their object and layout after cloning", () => {
  const module: ModuleIR = {
    records: [
      {
        byteLength: 32,
        fields: [{ offset: 16, type: "optional-reference", mutable: false }],
      },
    ],
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
        name: "reader",
        exported: false,
        parameters: [0],
        slots: ["reference", "optional-reference"],
        returnType: "optional-reference",
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
            instructions: [
              { kind: "load", id: 1, slot: 0, ...span },
              {
                kind: "record-read",
                id: 2,
                object: 1,
                record: 0,
                field: 0,
                ...span,
              },
            ],
            terminator: { kind: "return", value: 2, ...span },
          },
          { id: 2, instructions: [], terminator: { kind: "trap", ...span } },
        ],
      },
    ],
  };
  assert.deepEqual(verify(module), { ok: true });
  const result = inlineSmallFunctions(module, 10000)!;
  assert.equal(result.inlined, 1);
  assert.deepEqual(verify(result.module), { ok: true });
  const read = result.module.functions[0]!.blocks.flatMap(
    (b) => b.instructions,
  ).find((op) => op.kind === "record-read");
  assert.ok(read?.kind === "record-read");
  assert.deepEqual([read.record, read.field], [0, 0]);
  assert.ok(
    result.module.functions[0]!.blocks.some((b) =>
      b.instructions.some(
        (op) => op.kind === "load" && op.id === read.object && op.slot !== 0,
      ),
    ),
  );
});

function allocatingCaller(name: string): ModuleIR {
  return {
    functions: [
      {
        id: 0,
        name,
        exported: true,
        parameters: [0],
        slots: ["reference"],
        returnType: "optional-reference",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "constant", id: 0, value: 1, ...span },
              {
                kind: "array-new",
                id: 1,
                type: "Uint8Array",
                length: 0,
                ...span,
              },
              { kind: "load", id: 2, slot: 0, ...span },
              { kind: "call", id: 3, target: 1, arguments: [2], ...span },
            ],
            terminator: { kind: "return", value: 3, ...span },
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
}
test("reference expansion also reaches allocating callers", () => {
  const module = allocatingCaller("caller");
  assert.deepEqual(verify(module), { ok: true });
  const result = inlineSmallFunctions(module, 10000);
  assert.ok(result);
  assert.equal(result.inlined, 1);
  assert.deepEqual(verify(result.module), { ok: true });
  const caller = result.module.functions[0]!;
  assert.ok(
    caller.blocks.every((b) => b.instructions.every((i) => i.kind !== "call")),
  );
});

test("allocating list accessors keep the calls that would hide their emitted shape", () => {
  const module = allocatingCaller("__tint_reference_list_write$7");
  assert.deepEqual(verify(module), { ok: true });
  assert.equal(inlineSmallFunctions(module, 10000)!.inlined, 0);
});

test("existing scalar candidates retain their original size policy", () => {
  const input = fixture();
  let id = 0;
  const callee: FunctionIR = {
    ...input.functions[1]!,
    blocks: Array.from({ length: 12 }, (_, block) => ({
      id: block,
      instructions:
        block === 11
          ? [{ kind: "load" as const, id: id++, slot: 0, ...span }]
          : Array.from({ length: 5 }, () => ({
              kind: "constant" as const,
              id: id++,
              value: 7,
              ...span,
            })),
      terminator:
        block === 11
          ? { kind: "return" as const, value: id - 1, ...span }
          : { kind: "jump" as const, target: block + 1, ...span },
    })),
  };
  const module = { functions: [input.functions[0]!, callee] };
  assert.deepEqual(verify(module), { ok: true });
  assert.equal(inlineSmallFunctions(module, 10000)!.inlined, 2);
});

test("new reference expansion has a fixed per-caller budget", () => {
  const module: ModuleIR = {
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
              ...Array.from({ length: 40 }, (_, i) => ({
                kind: "call" as const,
                id: i + 1,
                target: 1,
                arguments: [i],
                ...span,
              })),
            ],
            terminator: { kind: "return", value: 40, ...span },
          },
        ],
      },
      {
        id: 1,
        name: "identity",
        exported: false,
        parameters: [0],
        slots: ["reference"],
        returnType: "reference",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [{ kind: "load", id: 0, slot: 0, ...span }],
            terminator: { kind: "return", value: 0, ...span },
          },
        ],
      },
    ],
  };
  assert.deepEqual(verify(module), { ok: true });
  const result = inlineSmallFunctions(module, 10000)!;
  assert.equal(result.inlined, 32);
  assert.deepEqual(verify(result.module), { ok: true });
  assert.equal(
    result.module.functions[0]!.blocks[0]!.instructions.filter(
      (op) => op.kind === "call",
    ).length,
    8,
  );
});

test("incremental inlining retains complete callers when a later function exhausts work", () => {
  const input = fixture();
  const large: FunctionIR = {
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
  };
  const module = { functions: [...input.functions, large] },
    snapshot = structuredClone(module);
  const result = inlineSmallFunctions(module, 180, false, true);
  assert.ok(result);
  assert.equal(result.budgetExhausted, true);
  assert.equal(result.inlined, 2);
  assert.ok(result.visited <= 180);
  assert.deepEqual(verify(result.module), { ok: true });
  assert.equal(result.module.functions[2], large);
  assert.deepEqual(module, snapshot);
  for (const n of [-3, 0, 7])
    assert.equal(evaluate(result.module, 0, [n]), evaluate(module, 0, [n]));
});

test("incremental exhaustion rolls back an unfinished caller as a whole", () => {
  const module = fixture();
  for (let budget = 0; budget < 100; budget++) {
    const result = inlineSmallFunctions(module, budget, false, true);
    assert.ok(result);
    assert.ok(result.visited <= budget);
    assert.ok(result.inlined === 0 || result.inlined === 2);
    assert.deepEqual(verify(result.module), { ok: true });
    if (result.inlined === 0) assert.equal(result.module, module);
  }
});
test("the optimizer inlines wrappers whose own callees were inlined first", async () => {
  const { optimizeModule } = await import("../src/optimization/index.ts");
  // caller -> wrapper -> leaf: the wrapper only becomes a leaf once the
  // first round inlines `leaf` into it.
  const unary = (
    id: number,
    name: string,
    body: FunctionIR["blocks"][number]["instructions"],
    result: number,
  ): FunctionIR => ({
    id,
    name,
    exported: id === 0,
    parameters: [0],
    slots: ["number"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [{ kind: "load", id: 0, slot: 0, ...span }, ...body],
        terminator: { kind: "return", value: result, ...span },
      },
    ],
  });
  const module: ModuleIR = {
    functions: [
      unary(
        0,
        "caller",
        [{ kind: "call", id: 1, target: 1, arguments: [0], ...span }],
        1,
      ),
      unary(
        1,
        "wrapper",
        [{ kind: "call", id: 1, target: 2, arguments: [0], ...span }],
        1,
      ),
      unary(
        2,
        "leaf",
        [
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
        2,
      ),
    ],
  };
  const optimized = optimizeModule(module);
  assert.notEqual(optimized.budgetExhausted, true);
  const caller = optimized.module.functions[0]!;
  assert.ok(verify(optimized.module).ok);
  assert.equal(
    caller.blocks.some((block) =>
      block.instructions.some((op) => op.kind === "call"),
    ),
    false,
  );
});
test("raw memory word writes inline like reads and keep their host call", () => {
  const module: ModuleIR = {
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
              {
                kind: "call",
                id: undefined,
                target: 1,
                arguments: [0],
                ...span,
              },
            ],
            terminator: { kind: "return", value: 0, ...span },
          },
        ],
      },
      {
        id: 1,
        name: "write",
        exported: false,
        parameters: [0],
        slots: ["number"],
        returnType: "void",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load", id: 0, slot: 0, ...span },
              { kind: "constant", id: 1, value: 8, ...span },
              { kind: "constant", id: 2, value: 0, ...span },
              {
                kind: "host-call",
                id: 3,
                operation: "memory-write-word",
                arguments: [0, 1, 2, 0],
                ...span,
              },
            ],
            terminator: { kind: "return", value: undefined, ...span },
          },
        ],
      },
    ],
  };
  assert.ok(verify(module).ok);
  const result = inlineSmallFunctions(module, 1000);
  assert.ok(result !== undefined && result.inlined === 1);
  const caller = result.module.functions[0];
  assert.ok(caller !== undefined && verify(result.module).ok);
  const ops = caller.blocks.flatMap((block) => block.instructions);
  assert.equal(ops.filter((op) => op.kind === "call").length, 0);
  assert.deepEqual(
    ops.flatMap((op) => (op.kind === "host-call" ? [op.operation] : [])),
    ["memory-write-word"],
  );
});

/** caller(x) = wrapper(x); wrapper(x) = -absolute(x), so wrapper calls. */
function callingWrapper(name: string): ModuleIR {
  const absolute = { ...fixture().functions[1]!, id: 2 };
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
            ],
            terminator: { kind: "return", value: 1, ...span },
          },
        ],
      },
      {
        id: 1,
        name,
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
              { kind: "call", id: 1, target: 2, arguments: [0], ...span },
              { kind: "unary", id: 2, operator: "-", operand: 1, ...span },
            ],
            terminator: { kind: "return", value: 2, ...span },
          },
        ],
      },
      absolute,
    ],
  };
}

test("callees that call inline with their calls moved into the caller", () => {
  const input = callingWrapper("wrapper");
  assert.deepEqual(verify(input), { ok: true });
  const result = inlineSmallFunctions(input, 100000);
  assert.ok(result);
  assert.ok(result.inlined >= 1);
  assert.deepEqual(verify(result.module), { ok: true });
  const caller = result.module.functions[0]!;
  const targets = caller.blocks.flatMap((b) =>
    b.instructions.flatMap((op) => (op.kind === "call" ? [op.target] : [])),
  );
  assert.ok(!targets.includes(1), "the wrapper itself is inlined");
  for (const x of [-3, 0, 5])
    assert.equal(evaluate(result.module, 0, [x]), -Math.abs(x));
});

test("generated list accessors are never inlined", () => {
  const input = callingWrapper("__tint_reference_list_read$1");
  const result = inlineSmallFunctions(input, 100000);
  assert.ok(result);
  const caller = result.module.functions[0]!;
  assert.ok(
    caller.blocks.some((b) =>
      b.instructions.some((op) => op.kind === "call" && op.target === 1),
    ),
  );
});

test("typed-array writes inline with their operands remapped", () => {
  const module: ModuleIR = {
    functions: [
      {
        id: 0,
        name: "caller",
        exported: true,
        parameters: [0],
        slots: ["Uint8Array"],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load", id: 0, slot: 0, ...span },
              { kind: "constant", id: 1, value: 7, ...span },
              { kind: "call", id: 2, target: 1, arguments: [0, 1], ...span },
            ],
            terminator: { kind: "return", value: 2, ...span },
          },
        ],
      },
      {
        id: 1,
        name: "store",
        exported: false,
        parameters: [0, 1],
        slots: ["Uint8Array", "number"],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load", id: 0, slot: 0, ...span },
              { kind: "load", id: 1, slot: 1, ...span },
              { kind: "constant", id: 2, value: 0, ...span },
              { kind: "array-write", array: 0, index: 2, value: 1, ...span },
            ],
            terminator: { kind: "return", value: 1, ...span },
          },
        ],
      },
    ],
  };
  assert.deepEqual(verify(module), { ok: true });
  const result = inlineSmallFunctions(module, 10000)!;
  assert.equal(result.inlined, 1);
  assert.deepEqual(verify(result.module), { ok: true });
  const ops = result.module.functions[0]!.blocks.flatMap((b) => b.instructions);
  assert.ok(ops.some((op) => op.kind === "array-write"));
  assert.ok(!ops.some((op) => op.kind === "call"));
});

test("callees with local string slots inline", () => {
  const module: ModuleIR = {
    functions: [
      {
        id: 0,
        name: "caller",
        exported: true,
        parameters: [0, 1],
        slots: ["string", "string"],
        returnType: "boolean",
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
        name: "same",
        exported: false,
        parameters: [0, 1],
        // Slot 2 is a local string (a key loaded from an entry, say).
        slots: ["string", "string", "string"],
        returnType: "boolean",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load", id: 0, slot: 0, ...span },
              { kind: "store", slot: 2, value: 0, ...span },
              { kind: "load", id: 1, slot: 2, ...span },
              { kind: "load", id: 2, slot: 1, ...span },
              {
                kind: "binary",
                id: 3,
                operator: "===",
                left: 1,
                right: 2,
                ...span,
              },
            ],
            terminator: { kind: "return", value: 3, ...span },
          },
        ],
      },
    ],
  };
  assert.deepEqual(verify(module), { ok: true });
  const result = inlineSmallFunctions(module, 10000)!;
  assert.equal(result.inlined, 1);
  assert.deepEqual(verify(result.module), { ok: true });
  assert.ok(
    !result.module.functions[0]!.blocks.some((block) =>
      block.instructions.some((op) => op.kind === "call"),
    ),
  );
});

test("bound Latin-1 scans and copies inline with their operands remapped", () => {
  // Bodies as bindHostOperations leaves them: parameter loads, the
  // instruction and a return. The allocating string-from-latin1 stays a call.
  function bound(
    id: number,
    name: string,
    slots: FunctionIR["slots"],
    op: Instruction,
    returnType: FunctionIR["returnType"],
  ): FunctionIR {
    const instructions: Instruction[] = [];
    for (let slot = 0; slot < slots.length; slot++)
      instructions.push({ kind: "load", id: slot, slot, ...span });
    instructions.push(op);
    return {
      id,
      name,
      exported: false,
      parameters: slots.map((_, slot) => slot),
      slots,
      returnType,
      entry: 0,
      blocks: [
        {
          id: 0,
          instructions,
          terminator: { kind: "return", value: slots.length, ...span },
        },
      ],
    };
  }
  const module: ModuleIR = {
    functions: [
      {
        id: 0,
        name: "caller",
        exported: true,
        parameters: [0, 1],
        slots: ["string", "Uint8Array"],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load", id: 0, slot: 0, ...span },
              { kind: "load", id: 1, slot: 1, ...span },
              { kind: "constant", id: 2, value: 0, ...span },
              { kind: "constant", id: 3, value: 4, ...span },
              { kind: "call", id: 4, target: 1, arguments: [0, 2, 3], ...span },
              { kind: "call", id: 5, target: 2, arguments: [1, 2, 3], ...span },
              {
                kind: "call",
                id: 6,
                target: 3,
                arguments: [0, 2, 4, 1, 2],
                ...span,
              },
              { kind: "call", id: 7, target: 4, arguments: [1, 2, 5], ...span },
              {
                kind: "binary",
                id: 8,
                operator: "+",
                left: 4,
                right: 6,
                ...span,
              },
            ],
            terminator: { kind: "return", value: 8, ...span },
          },
        ],
      },
      bound(
        1,
        "asciiEndOfText",
        ["string", "number", "number"],
        {
          kind: "string-ascii-prefix",
          id: 3,
          string: 0,
          begin: 1,
          limit: 2,
          ...span,
        },
        "number",
      ),
      bound(
        2,
        "asciiEndOfBytes",
        ["Uint8Array", "number", "number"],
        {
          kind: "bytes-ascii-prefix",
          id: 3,
          bytes: 0,
          begin: 1,
          limit: 2,
          ...span,
        },
        "number",
      ),
      bound(
        3,
        "copyLatin1",
        ["string", "number", "number", "Uint8Array", "number"],
        {
          kind: "string-copy-latin1",
          id: 5,
          string: 0,
          begin: 1,
          limit: 2,
          bytes: 3,
          offset: 4,
          ...span,
        },
        "number",
      ),
      bound(
        4,
        "latin1Text",
        ["Uint8Array", "number", "number"],
        {
          kind: "string-from-latin1",
          id: 3,
          bytes: 0,
          begin: 1,
          limit: 2,
          ...span,
        },
        "string",
      ),
    ],
  };
  assert.deepEqual(verify(module), { ok: true });
  const result = inlineSmallFunctions(module, 10000)!;
  assert.equal(result.inlined, 3);
  assert.deepEqual(verify(result.module), { ok: true });
  const ops = result.module.functions[0]!.blocks.flatMap((b) => b.instructions);
  const scan = ops.find((op) => op.kind === "string-ascii-prefix"),
    bytes = ops.find((op) => op.kind === "bytes-ascii-prefix"),
    copy = ops.find((op) => op.kind === "string-copy-latin1");
  assert.ok(scan?.kind === "string-ascii-prefix");
  assert.deepEqual([scan.string, scan.begin, scan.limit], [0, 2, 3]);
  assert.ok(bytes?.kind === "bytes-ascii-prefix");
  assert.deepEqual([bytes.bytes, bytes.begin, bytes.limit], [1, 2, 3]);
  assert.ok(copy?.kind === "string-copy-latin1");
  assert.equal(copy.string, 0);
  assert.equal(copy.bytes, 1);
  assert.deepEqual(
    ops
      .filter((op) => op.kind === "call")
      .map((op) => op.kind === "call" && op.target),
    [4],
  );
});
