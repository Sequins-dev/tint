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
