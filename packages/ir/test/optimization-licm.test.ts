import { test } from "node:test";
import assert from "node:assert/strict";
import {
  verify,
  instructionResult,
  visitInstructionOperands,
  type Block,
  type FunctionIR,
  type Instruction,
  type ModuleIR,
} from "@tint/ir/scalar";
import { hoistLoopInvariants } from "@tint/ir/optimization";

const span = { start: 0, end: 0 };
/** run(n, k): b0 preheader; b1 header `i < n`; b2 body (given ops, then
 * i++); b3 exit returning slot 3. Slots: 0 n, 1 k, 2 i, 3 total, then any
 * extra slots. */
function loop(
  body: readonly Instruction[],
  options: {
    readonly slots?: readonly FunctionIR["slots"][number][];
    readonly bodyTerminator?: Block["terminator"];
    readonly extraBlocks?: readonly Block[];
    readonly records?: ModuleIR["records"];
    readonly secondEntry?: boolean;
  } = {},
): ModuleIR {
  const blocks: Block[] = [
    {
      id: 0,
      instructions: [
        { kind: "constant", id: 0, value: 0, ...span },
        { kind: "store", slot: 2, value: 0, ...span },
        { kind: "store", slot: 3, value: 0, ...span },
      ],
      terminator: options.secondEntry
        ? { kind: "branch", condition: 1, consequent: 1, alternate: 2, ...span }
        : { kind: "jump", target: 1, ...span },
    },
    {
      id: 1,
      instructions: [
        { kind: "load", id: 10, slot: 2, ...span },
        { kind: "load", id: 11, slot: 0, ...span },
        { kind: "binary", id: 12, operator: "<", left: 10, right: 11, ...span },
      ],
      terminator: {
        kind: "branch",
        condition: 12,
        consequent: 2,
        alternate: 3,
        ...span,
      },
    },
    {
      id: 2,
      instructions: [
        ...body,
        { kind: "load", id: 90, slot: 2, ...span },
        { kind: "constant", id: 91, value: 1, ...span },
        { kind: "binary", id: 92, operator: "+", left: 90, right: 91, ...span },
        { kind: "store", slot: 2, value: 92, ...span },
      ],
      terminator: options.bodyTerminator ?? {
        kind: "jump",
        target: 1,
        ...span,
      },
    },
    {
      id: 3,
      instructions: [{ kind: "load", id: 95, slot: 3, ...span }],
      terminator: { kind: "return", value: 95, ...span },
    },
    ...(options.extraBlocks ?? []),
  ];
  if (options.secondEntry) {
    const first = blocks[0]!;
    blocks[0] = {
      ...first,
      instructions: [
        ...first.instructions,
        { kind: "constant", id: 1, value: true, ...span },
      ],
    };
  }
  return {
    ...(options.records === undefined ? {} : { records: options.records }),
    functions: [
      {
        id: 0,
        name: "run",
        exported: true,
        parameters: options.slots === undefined ? [0, 1] : [0, 1, 4],
        slots: [
          "number",
          "number",
          "number",
          "number",
          ...(options.slots ?? []),
        ],
        returnType: "number",
        entry: 0,
        blocks,
      },
    ],
  };
}
const accumulate: Instruction[] = [
  { kind: "load", id: 20, slot: 1, ...span },
  { kind: "constant", id: 21, value: 48, ...span },
  { kind: "binary", id: 22, operator: "*", left: 20, right: 21, ...span },
  { kind: "load", id: 23, slot: 3, ...span },
  { kind: "binary", id: 24, operator: "+", left: 23, right: 22, ...span },
  { kind: "store", slot: 3, value: 24, ...span },
];
function hoist(module: ModuleIR): FunctionIR {
  assert.ok(verify(module).ok, JSON.stringify(verify(module)));
  const result = hoistLoopInvariants(module.functions[0]!, module, 100000);
  assert.ok(result);
  const after = {
    ...module,
    functions: module.functions.map((fn) => (fn.id === 0 ? result.fn : fn)),
  };
  assert.ok(verify(after).ok, JSON.stringify(verify(after)));
  // Every operand is defined earlier in its block (block-local values).
  for (const block of result.fn.blocks) {
    const defined = new Set<number>();
    for (const op of block.instructions) {
      visitInstructionOperands(op, (value) =>
        assert.ok(
          defined.has(value),
          "block " + block.id + " uses " + value + " early",
        ),
      );
      const id = instructionResult(op);
      if (id !== undefined) defined.add(id);
    }
  }
  return result.fn;
}
const kinds = (block: Block | undefined): string[] =>
  (block?.instructions ?? []).map(
    (op) => op.kind + ("operator" in op ? op.operator : ""),
  );

test("invariant arithmetic moves to the preheader and travels in a slot", () => {
  const fn = hoist(loop(accumulate));
  const preheader = fn.blocks.find((block) => block.id === 0);
  const body = fn.blocks.find((block) => block.id === 2);
  assert.ok(kinds(preheader).includes("binary*"));
  assert.ok(!kinds(body).includes("binary*"));
  assert.ok(fn.slots.length === 5 && fn.slots[4] === "number");
});

test("values the loop writes stay in the loop", () => {
  const fn = hoist(
    loop([
      { kind: "load", id: 20, slot: 3, ...span },
      { kind: "constant", id: 21, value: 2, ...span },
      { kind: "binary", id: 22, operator: "*", left: 20, right: 21, ...span },
      { kind: "store", slot: 3, value: 22, ...span },
    ]),
  );
  assert.ok(
    kinds(fn.blocks.find((block) => block.id === 2)).includes("binary*"),
  );
});

test("a loop entered from several places has no preheader and is unchanged", () => {
  const module = loop(accumulate, { secondEntry: true });
  assert.ok(verify(module).ok);
  const result = hoistLoopInvariants(module.functions[0]!, module, 100000);
  assert.ok(result);
  assert.equal(result.hoisted, 0);
});

test("invariant operations a kept operation still uses are kept", () => {
  // reference-value(function-environment(callee)) feeds a call that stays.
  const module: ModuleIR = loop(
    [
      { kind: "load", id: 30, slot: 4, ...span },
      { kind: "function-environment", id: 31, callee: 30, ...span },
      { kind: "reference-value", id: 32, value: 31, ...span },
      { kind: "call", id: undefined, target: 1, arguments: [32], ...span },
      ...accumulate,
    ],
    { slots: ["reference"] },
  );
  const withCallee: ModuleIR = {
    functions: [
      module.functions[0]!,
      {
        id: 1,
        name: "use",
        exported: false,
        parameters: [0],
        slots: ["reference"],
        returnType: "void",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [],
            terminator: { kind: "return", value: undefined, ...span },
          },
        ],
      },
    ],
  };
  hoist(withCallee);
});

test("typed-array lengths move unless the loop runs code that may change them", () => {
  // total += array.length, with or without a call in the body.
  const sum = (call: boolean): Instruction[] => [
    ...(call
      ? [
          {
            kind: "call",
            id: undefined,
            target: 1,
            arguments: [],
            ...span,
          } satisfies Instruction,
        ]
      : []),
    { kind: "load", id: 30, slot: 4, ...span },
    { kind: "array-length", id: 31, array: 30, ...span },
    { kind: "load", id: 32, slot: 3, ...span },
    { kind: "binary", id: 33, operator: "+", left: 32, right: 31, ...span },
    { kind: "store", slot: 3, value: 33, ...span },
  ];
  const callee: FunctionIR = {
    id: 1,
    name: "detach",
    exported: false,
    parameters: [],
    slots: [],
    returnType: "void",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [],
        terminator: { kind: "return", value: undefined, ...span },
      },
    ],
  };
  const lengthIn = (fn: FunctionIR, id: number): boolean =>
    kinds(fn.blocks.find((block) => block.id === id)).includes("array-length");
  const plain = hoist(loop(sum(false), { slots: ["Uint8Array"] }));
  assert.ok(lengthIn(plain, 0) && !lengthIn(plain, 2));
  // The call may detach a view of a realm ArrayBuffer: its length becomes 0.
  const module = loop(sum(true), { slots: ["Uint8Array"] });
  const calling = hoist({
    functions: [module.functions[0]!, callee],
  });
  assert.ok(!lengthIn(calling, 0) && lengthIn(calling, 2));
});

test("checked reads of immutable fields move with their check; mutable fields stay", () => {
  for (const mutable of [false, true]) {
    const module = loop(
      [
        { kind: "load", id: 40, slot: 4, ...span },
        { kind: "function-environment", id: 41, callee: 40, ...span },
        { kind: "reference-value", id: 42, value: 41, ...span },
      ],
      {
        slots: ["reference", "number"],
        records: [
          { byteLength: 32, fields: [{ offset: 16, type: "number", mutable }] },
        ],
        bodyTerminator: {
          kind: "record",
          object: 42,
          record: 0,
          field: 0,
          operation: "read",
          slot: 5,
          consequent: 4,
          alternate: 5,
          ...span,
        },
        extraBlocks: [
          {
            id: 4,
            instructions: [],
            terminator: { kind: "jump", target: 1, ...span },
          },
          { id: 5, instructions: [], terminator: { kind: "trap", ...span } },
        ],
      },
    );
    const fn = hoist(module);
    const preheader = fn.blocks.find((block) => block.id === 0)!;
    assert.equal(preheader.terminator.kind === "record", !mutable);
  }
});

test("unchecked reads of objects built in the same block do not block read hoisting", () => {
  // The exit block reads a field of a record it just constructed: that
  // read's layout comes from the construction, not from a loop check.
  const module = loop(
    [
      { kind: "load", id: 40, slot: 4, ...span },
      { kind: "function-environment", id: 41, callee: 40, ...span },
      { kind: "reference-value", id: 42, value: 41, ...span },
    ],
    {
      slots: ["reference", "number"],
      records: [
        {
          byteLength: 32,
          fields: [{ offset: 16, type: "number", mutable: false }],
        },
      ],
      bodyTerminator: {
        kind: "record",
        object: 42,
        record: 0,
        field: 0,
        operation: "read",
        slot: 5,
        consequent: 4,
        alternate: 5,
        ...span,
      },
      extraBlocks: [
        {
          id: 4,
          instructions: [],
          terminator: { kind: "jump", target: 1, ...span },
        },
        { id: 5, instructions: [], terminator: { kind: "trap", ...span } },
      ],
    },
  );
  const fn = module.functions[0]!;
  const exit = fn.blocks.find((block) => block.id === 3)!;
  const built: ModuleIR = {
    ...module,
    functions: [
      {
        ...fn,
        blocks: fn.blocks.map((block) =>
          block.id !== 3
            ? block
            : {
                ...exit,
                instructions: [
                  { kind: "constant", id: 96, value: 7, ...span },
                  {
                    kind: "record-new",
                    id: 97,
                    record: 0,
                    arguments: [96],
                    ...span,
                  },
                  {
                    kind: "record-read",
                    id: 98,
                    object: 97,
                    record: 0,
                    field: 0,
                    ...span,
                  },
                  ...exit.instructions,
                ],
              },
        ),
      },
    ],
  };
  const hoisted = hoist(built);
  assert.equal(
    hoisted.blocks.find((block) => block.id === 0)!.terminator.kind,
    "record",
  );
});

test("a check a direct read relies on through a slot copy stays in the loop", () => {
  // The body checks slot 4's layout, copies the object to slot 6 and reads
  // it unchecked: the read's proof runs through the copy back to the check
  // (as inlining produces), which the origin test alone does not see.
  const module = loop([{ kind: "load", id: 40, slot: 4, ...span }], {
    slots: ["reference", "number", "reference"],
    records: [
      {
        byteLength: 32,
        fields: [{ offset: 16, type: "number", mutable: false }],
      },
    ],
    bodyTerminator: {
      kind: "record",
      object: 40,
      record: 0,
      field: 0,
      operation: "read",
      slot: 5,
      consequent: 4,
      alternate: 5,
      ...span,
    },
    extraBlocks: [
      {
        id: 4,
        instructions: [
          { kind: "load", id: 50, slot: 4, ...span },
          { kind: "store", slot: 6, value: 50, ...span },
        ],
        terminator: { kind: "jump", target: 6, ...span },
      },
      { id: 5, instructions: [], terminator: { kind: "trap", ...span } },
      {
        id: 6,
        instructions: [
          { kind: "load", id: 60, slot: 6, ...span },
          {
            kind: "record-read",
            id: 61,
            object: 60,
            record: 0,
            field: 0,
            ...span,
          },
          { kind: "store", slot: 3, value: 61, ...span },
        ],
        terminator: { kind: "jump", target: 1, ...span },
      },
    ],
  });
  // hoist() verifies the result: the read keeps its proof.
  const fn = hoist(module);
  // The dependence test follows the copy, so the redo backstop (a visible
  // fallback) never fires.
  const redone = hoistLoopInvariants(
    module.functions[0]!,
    module,
    100000,
  )?.redone;
  assert.equal(redone, 0);
  assert.equal(
    fn.blocks.find((block) => block.id === 0)!.terminator.kind,
    "jump",
  );
  assert.equal(
    fn.blocks.find((block) => block.id === 2)!.terminator.kind,
    "record",
  );
});

test("loop motion preserves the checked layout used by a direct read", () => {
  const module = loop([{ kind: "load", id: 40, slot: 4, ...span }], {
    slots: ["reference", "number", "reference"],
    records: [
      {
        byteLength: 32,
        fields: [
          { offset: 16, type: "number", mutable: false },
          { offset: 24, type: "number", mutable: true },
        ],
      },
    ],
    bodyTerminator: {
      kind: "record",
      object: 40,
      record: 0,
      field: 0,
      operation: "read",
      slot: 5,
      consequent: 4,
      alternate: 5,
      ...span,
    },
    extraBlocks: [
      {
        id: 4,
        instructions: [
          { kind: "load", id: 41, slot: 4, ...span },
          { kind: "store", slot: 6, value: 41, ...span },
          { kind: "load", id: 42, slot: 6, ...span },
          {
            kind: "record-read",
            id: 43,
            object: 42,
            record: 0,
            field: 1,
            ...span,
          },
          { kind: "store", slot: 3, value: 43, ...span },
        ],
        terminator: { kind: "jump", target: 1, ...span },
      },
      { id: 5, instructions: [], terminator: { kind: "trap", ...span } },
    ],
  });
  hoist(module);
});

test("a union dispatch's later layout checks stay behind the earlier check", () => {
  // b2 tests layout 0 and, failing that, b6 tests layout 1 then traps. The
  // second check runs only for objects that are not layout 0, so hoisting it
  // would trap on every layout 0 object.
  const object = (base: number): Instruction[] => [
    { kind: "load", id: base, slot: 4, ...span },
    { kind: "function-environment", id: base + 1, callee: base, ...span },
    { kind: "reference-value", id: base + 2, value: base + 1, ...span },
  ];
  const check = (
    value: number,
    record: number,
    alternate: number,
  ): Block["terminator"] => ({
    kind: "record",
    object: value,
    record,
    field: 0,
    operation: "read",
    slot: 5,
    consequent: 4,
    alternate,
    ...span,
  });
  const field = { offset: 16, type: "number" as const, mutable: false };
  const module = loop(object(40), {
    slots: ["reference", "number"],
    records: [
      { byteLength: 32, fields: [field] },
      { byteLength: 32, fields: [field] },
    ],
    bodyTerminator: check(42, 0, 6),
    extraBlocks: [
      {
        id: 4,
        instructions: [],
        terminator: { kind: "jump", target: 1, ...span },
      },
      { id: 5, instructions: [], terminator: { kind: "trap", ...span } },
      { id: 6, instructions: object(60), terminator: check(62, 1, 5) },
    ],
  });
  const fn = hoist(module);
  assert.equal(
    fn.blocks.find((block) => block.id === 0)!.terminator.kind,
    "jump",
  );
  assert.equal(
    fn.blocks.find((block) => block.id === 6)!.terminator.kind,
    "record",
  );
});

test("union dispatch later layout checks stay conditional through jump bridges", () => {
  // b2 tests layout 0 and routes its failure edge through bridge block(s) to
  // b6 (layout 1 -> trap). Hoisting b6's check to the preheader would trap on
  // layout 0 objects before b2 runs.
  const object = (base: number): Instruction[] => [
    { kind: "load", id: base, slot: 4, ...span },
    { kind: "function-environment", id: base + 1, callee: base, ...span },
    { kind: "reference-value", id: base + 2, value: base + 1, ...span },
  ];
  const check = (
    value: number,
    record: number,
    alternate: number,
  ): Block["terminator"] => ({
    kind: "record",
    object: value,
    record,
    field: 0,
    operation: "read",
    slot: 5,
    consequent: 4,
    alternate,
    ...span,
  });
  const field = { offset: 16, type: "number" as const, mutable: false };
  for (const multiHop of [false, true]) {
    const extraBlocks: Block[] = [
      {
        id: 4,
        instructions: [],
        terminator: { kind: "jump", target: 1, ...span },
      },
      { id: 5, instructions: [], terminator: { kind: "trap", ...span } },
      { id: 6, instructions: object(60), terminator: check(62, 1, 5) },
      {
        id: 7,
        instructions: [],
        terminator: { kind: "jump", target: multiHop ? 8 : 6, ...span },
      },
      ...(multiHop
        ? [
            {
              id: 8,
              instructions: [],
              terminator: { kind: "jump" as const, target: 6, ...span },
            },
          ]
        : []),
    ];
    const module = loop(object(40), {
      slots: ["reference", "number"],
      records: [
        { byteLength: 32, fields: [field] },
        { byteLength: 32, fields: [field] },
      ],
      bodyTerminator: check(42, 0, 7),
      extraBlocks,
    });
    const fn = hoist(module);
    assert.equal(
      fn.blocks.find((block) => block.id === 0)!.terminator.kind,
      "jump",
    );
    assert.equal(
      fn.blocks.find((block) => block.id === 6)!.terminator.kind,
      "record",
    );
  }
});

test("branch-guarded and post-early-exit checked reads stay inside the loop", () => {
  const object = (base: number): Instruction[] => [
    { kind: "load", id: base, slot: 4, ...span },
    { kind: "function-environment", id: base + 1, callee: base, ...span },
    { kind: "reference-value", id: base + 2, value: base + 1, ...span },
  ];
  const check = (value: number, record: number): Block["terminator"] => ({
    kind: "record",
    object: value,
    record,
    field: 0,
    operation: "read",
    slot: 5,
    consequent: 4,
    alternate: 5,
    ...span,
  });
  const field = { offset: 16, type: "number" as const, mutable: false };
  // Branch-guarded layout dispatch: b2 branches to b6 (layout 0) or b7 (layout 1).
  const branched = loop(
    [
      { kind: "load", id: 30, slot: 1, ...span },
      { kind: "constant", id: 31, value: 0, ...span },
      { kind: "binary", id: 32, operator: "===", left: 30, right: 31, ...span },
    ],
    {
      slots: ["reference", "number"],
      records: [
        { byteLength: 32, fields: [field] },
        { byteLength: 32, fields: [field] },
      ],
      bodyTerminator: {
        kind: "branch",
        condition: 32,
        consequent: 6,
        alternate: 7,
        ...span,
      },
      extraBlocks: [
        {
          id: 4,
          instructions: [],
          terminator: { kind: "jump", target: 1, ...span },
        },
        { id: 5, instructions: [], terminator: { kind: "trap", ...span } },
        { id: 6, instructions: object(60), terminator: check(62, 0) },
        { id: 7, instructions: object(70), terminator: check(72, 1) },
      ],
    },
  );
  const branchedFn = hoist(branched);
  assert.equal(
    branchedFn.blocks.find((block) => block.id === 0)!.terminator.kind,
    "jump",
  );
  assert.equal(
    branchedFn.blocks.find((block) => block.id === 6)!.terminator.kind,
    "record",
  );
  assert.equal(
    branchedFn.blocks.find((block) => block.id === 7)!.terminator.kind,
    "record",
  );

  // Early loop exit before the checked read: b2 exits to b3 when k === 0.
  const earlyExit = loop(
    [
      { kind: "load", id: 30, slot: 1, ...span },
      { kind: "constant", id: 31, value: 0, ...span },
      { kind: "binary", id: 32, operator: "===", left: 30, right: 31, ...span },
    ],
    {
      slots: ["reference", "number"],
      records: [{ byteLength: 32, fields: [field] }],
      bodyTerminator: {
        kind: "branch",
        condition: 32,
        consequent: 3,
        alternate: 6,
        ...span,
      },
      extraBlocks: [
        {
          id: 4,
          instructions: [],
          terminator: { kind: "jump", target: 1, ...span },
        },
        { id: 5, instructions: [], terminator: { kind: "trap", ...span } },
        { id: 6, instructions: object(60), terminator: check(62, 0) },
      ],
    },
  );
  const earlyExitFn = hoist(earlyExit);
  assert.equal(
    earlyExitFn.blocks.find((block) => block.id === 0)!.terminator.kind,
    "jump",
  );
  assert.equal(
    earlyExitFn.blocks.find((block) => block.id === 6)!.terminator.kind,
    "record",
  );

  // Unconditional jump bridge before a checked read still hoists cleanly.
  const unconditionalBridge = loop([], {
    slots: ["reference", "number"],
    records: [{ byteLength: 32, fields: [field] }],
    bodyTerminator: { kind: "jump", target: 6, ...span },
    extraBlocks: [
      {
        id: 4,
        instructions: [],
        terminator: { kind: "jump", target: 1, ...span },
      },
      { id: 5, instructions: [], terminator: { kind: "trap", ...span } },
      { id: 6, instructions: object(60), terminator: check(62, 0) },
    ],
  });
  const hoistedBridgeFn = hoist(unconditionalBridge);
  assert.equal(
    hoistedBridgeFn.blocks.find((block) => block.id === 0)!.terminator.kind,
    "record",
  );
  assert.equal(
    hoistedBridgeFn.blocks.find((block) => block.id === 6)!.terminator.kind,
    "jump",
  );
});

test("scans the function-wide record proof inputs once for multiple loops", () => {
  function proofReads(includeSecondLoop: boolean): number {
    const original = loop([]).functions[0]!;
    let reads = 0;
    const entry = original.blocks[0]!;
    const sentinel: Instruction = {
      ...span,
      get kind() {
        reads++;
        return "constant" as const;
      },
      id: 100,
      value: 1,
    };
    const blocks = original.blocks.slice();
    blocks[0] = { ...entry, instructions: [...entry.instructions, sentinel] };
    if (includeSecondLoop) {
      blocks[3] = {
        ...blocks[3]!,
        terminator: { kind: "jump", target: 4, ...span },
      };
      blocks.push(
        {
          id: 4,
          instructions: [
            { kind: "load", id: 101, slot: 2, ...span },
            { kind: "load", id: 102, slot: 0, ...span },
            {
              kind: "binary",
              id: 103,
              operator: "<",
              left: 101,
              right: 102,
              ...span,
            },
          ],
          terminator: {
            kind: "branch",
            condition: 103,
            consequent: 5,
            alternate: 6,
            ...span,
          },
        },
        {
          id: 5,
          instructions: [
            { kind: "load", id: 104, slot: 2, ...span },
            { kind: "constant", id: 105, value: 1, ...span },
            {
              kind: "binary",
              id: 106,
              operator: "+",
              left: 104,
              right: 105,
              ...span,
            },
            { kind: "store", slot: 2, value: 106, ...span },
          ],
          terminator: { kind: "jump", target: 4, ...span },
        },
        {
          id: 6,
          instructions: [{ kind: "load", id: 107, slot: 3, ...span }],
          terminator: { kind: "return", value: 107, ...span },
        },
      );
    }
    const fn = { ...original, blocks };
    const module = { functions: [fn] };
    assert.deepEqual(verify(module), { ok: true });
    reads = 0;
    const result = hoistLoopInvariants(fn, module, 100000);
    assert.equal(result?.fn, fn);
    return reads;
  }

  assert.equal(proofReads(true), proofReads(false));
});

test("skips irreducible loops so hoisted slots are never read uninitialized", () => {
  // Entry branches to preheader (b1 -> b2) or directly into non-header loop
  // block b3, forming an irreducible cycle b2 <-> b3. Hoisting b3's invariant
  // comparison into b1 would leave its carried slot uninitialized on b0 -> b3.
  const fn: FunctionIR = {
    id: 0,
    name: "irreducible_licm",
    exported: true,
    parameters: [0, 1],
    returnType: "number",
    slots: ["boolean", "number", "number"],
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "constant", id: 0, value: 0, ...span },
          { kind: "store", slot: 2, value: 0, ...span },
          { kind: "load", id: 1, slot: 0, ...span },
        ],
        terminator: {
          kind: "branch",
          condition: 1,
          consequent: 1,
          alternate: 3,
          ...span,
        },
      },
      {
        id: 1,
        instructions: [],
        terminator: { kind: "jump", target: 2, ...span },
      },
      {
        id: 2,
        instructions: [
          { kind: "load", id: 2, slot: 2, ...span },
          { kind: "constant", id: 3, value: 10, ...span },
          { kind: "binary", id: 4, operator: "<", left: 2, right: 3, ...span },
        ],
        terminator: {
          kind: "branch",
          condition: 4,
          consequent: 3,
          alternate: 4,
          ...span,
        },
      },
      {
        id: 3,
        instructions: [
          { kind: "load", id: 5, slot: 1, ...span },
          { kind: "constant", id: 6, value: 0, ...span },
          { kind: "binary", id: 7, operator: ">", left: 5, right: 6, ...span },
          { kind: "load", id: 8, slot: 2, ...span },
          { kind: "constant", id: 9, value: 1, ...span },
          { kind: "binary", id: 10, operator: "+", left: 8, right: 9, ...span },
          { kind: "store", slot: 2, value: 10, ...span },
        ],
        terminator: {
          kind: "branch",
          condition: 7,
          consequent: 2,
          alternate: 4,
          ...span,
        },
      },
      {
        id: 4,
        instructions: [{ kind: "load", id: 11, slot: 2, ...span }],
        terminator: { kind: "return", value: 11, ...span },
      },
    ],
  };
  const module: ModuleIR = { functions: [fn] };
  assert.deepEqual(verify(module), { ok: true });
  const result = hoistLoopInvariants(fn, module, 100000);
  assert.ok(result !== undefined);
  assert.equal(result.hoisted, 0);
  assert.deepEqual(verify({ functions: [result.fn] }), { ok: true });
});
