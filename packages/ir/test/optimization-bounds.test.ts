import { test } from "node:test";
import assert from "node:assert/strict";
import { verify, type FunctionIR, type Instruction } from "@tint/ir/scalar";
import { selectArrayAccesses } from "@tint/ir/optimization";

const span = { start: 0, end: 0 };
/** `sum(n)`: a = new Float64Array(length); for (i = 0; i <op> bound; i++)
 * total += a[index(i)] ?? 0; return total. Slots: 0 n, 1 a, 2 i, 3 total. */
function loop(options: {
  readonly length: number;
  readonly operator: "<" | "<=";
  /** "min"/"max": Math.min/Math.max of the uint32 parameter and `limit`. */
  readonly bound: "constant" | "parameter" | "length" | "min" | "max";
  readonly limit: number;
  readonly offset?: number;
}): FunctionIR {
  const body: Instruction[] = [
    { kind: "load", id: 20, slot: 1, ...span },
    { kind: "load", id: 21, slot: 2, ...span },
    { kind: "constant", id: 22, value: options.offset ?? 0, ...span },
    { kind: "binary", id: 23, operator: "+", left: 21, right: 22, ...span },
    { kind: "array-read", id: 24, array: 20, index: 23, ...span },
    { kind: "constant", id: 25, value: 0, ...span },
    { kind: "optional-value-or", id: 26, value: 24, fallback: 25, ...span },
    { kind: "load", id: 27, slot: 3, ...span },
    { kind: "binary", id: 28, operator: "+", left: 27, right: 26, ...span },
    { kind: "store", slot: 3, value: 28, ...span },
    { kind: "array-write", array: 20, index: 23, value: 26, ...span },
    { kind: "constant", id: 29, value: 1, ...span },
    { kind: "binary", id: 30, operator: "+", left: 21, right: 29, ...span },
    { kind: "store", slot: 2, value: 30, ...span },
  ];
  return {
    id: 0,
    name: "sum",
    exported: true,
    parameters: [0],
    slots: ["number", "Float64Array", "number", "number"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "constant", id: 0, value: options.length, ...span },
          {
            kind: "array-new",
            id: 1,
            type: "Float64Array",
            length: 0,
            ...span,
          },
          { kind: "store", slot: 1, value: 1, ...span },
          { kind: "constant", id: 2, value: 0, ...span },
          { kind: "store", slot: 2, value: 2, ...span },
          { kind: "store", slot: 3, value: 2, ...span },
        ],
        terminator: { kind: "jump", target: 1, ...span },
      },
      {
        id: 1,
        instructions: [
          ...(options.bound === "length"
            ? [{ kind: "load" as const, id: 13, slot: 0, ...span }]
            : options.bound === "min" || options.bound === "max"
              ? [
                  { kind: "load" as const, id: 13, slot: 0, ...span },
                  {
                    kind: "unary" as const,
                    id: 14,
                    operator: "uint32",
                    operand: 13,
                    ...span,
                  },
                  {
                    kind: "constant" as const,
                    id: 15,
                    value: options.limit,
                    ...span,
                  },
                ]
              : []),
          { kind: "load", id: 10, slot: 2, ...span },
          options.bound === "min" || options.bound === "max"
            ? {
                kind: "binary",
                id: 11,
                operator: options.bound,
                left: 14,
                right: 15,
                ...span,
              }
            : options.bound === "constant"
              ? { kind: "constant", id: 11, value: options.limit, ...span }
              : options.bound === "length"
                ? {
                    kind: "unary",
                    id: 11,
                    operator: "uint32",
                    operand: 13,
                    ...span,
                  }
                : { kind: "load", id: 11, slot: 0, ...span },
          {
            kind: "binary",
            id: 12,
            operator: options.operator,
            left: 10,
            right: 11,
            ...span,
          },
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
        instructions: body,
        terminator: { kind: "jump", target: 1, ...span },
      },
      {
        id: 3,
        instructions: [{ kind: "load", id: 40, slot: 3, ...span }],
        terminator: { kind: "return", value: 40, ...span },
      },
    ],
  };
}
function kinds(fn: FunctionIR): string[] {
  return fn.blocks.flatMap((block) => block.instructions.map((op) => op.kind));
}
function select(fn: FunctionIR): FunctionIR {
  assert.ok(
    verify({ functions: [fn] }).ok,
    JSON.stringify(verify({ functions: [fn] })),
  );
  const result = selectArrayAccesses(fn, 1000000);
  assert.ok(result);
  assert.ok(
    verify({ functions: [result.fn] }).ok,
    JSON.stringify(verify({ functions: [result.fn] })),
  );
  return result.fn;
}

test("a guarded induction index within a fixed length selects unchecked accesses", () => {
  const fn = select(
    loop({ length: 16, operator: "<", bound: "constant", limit: 16 }),
  );
  const body = kinds(fn);
  assert.ok(body.includes("array-element"));
  assert.ok(body.includes("array-store"));
  assert.ok(!body.includes("array-read") && !body.includes("array-write"));
  // `?? 0` of an element that is always present folds away.
  assert.ok(
    !body.includes("optional-value-or") && !body.includes("optional-wrap"),
  );
});

test("an index that can reach the length keeps its checks", () => {
  for (const fn of [
    loop({ length: 16, operator: "<=", bound: "constant", limit: 16 }),
    loop({
      length: 16,
      operator: "<",
      bound: "constant",
      limit: 16,
      offset: 1,
    }),
    loop({ length: 16, operator: "<", bound: "constant", limit: 17 }),
  ]) {
    const selected = select(fn);
    assert.ok(kinds(selected).includes("array-read"));
    assert.ok(!kinds(selected).includes("array-element"));
  }
});

test("Math.min with a fixed length bounds an induction index; Math.max does not", () => {
  const min = select(
    loop({ length: 16, operator: "<", bound: "min", limit: 16 }),
  );
  assert.ok(kinds(min).includes("array-element"));
  assert.ok(!kinds(min).includes("array-read"));
  for (const fn of [
    loop({ length: 16, operator: "<", bound: "max", limit: 16 }),
    loop({ length: 16, operator: "<", bound: "min", limit: 17 }),
  ]) {
    const selected = select(fn);
    assert.ok(kinds(selected).includes("array-read"));
    assert.ok(!kinds(selected).includes("array-element"));
  }
});

test("bounds from unknown values prove nothing", () => {
  const selected = select(
    loop({ length: 16, operator: "<", bound: "parameter", limit: 0 }),
  );
  assert.ok(kinds(selected).includes("array-read"));
  assert.ok(kinds(selected).includes("array-write"));
});

test("negative offsets are rejected", () => {
  const selected = select(
    loop({
      length: 16,
      operator: "<",
      bound: "constant",
      limit: 16,
      offset: -1,
    }),
  );
  assert.ok(!kinds(selected).includes("array-element"));
});

test("slots whose every write is a proven 32-bit integer are published", () => {
  // i is 0 or i + 1 below 16; total accumulates doubles; n is a parameter.
  const bounded = select(
    loop({ length: 16, operator: "<", bound: "constant", limit: 16 }),
  );
  assert.deepEqual(bounded.integerSlots, [2]);
  // Against an unknown bound the counter is unbounded above (and widening
  // leaves no 32-bit proof), so nothing is published.
  const unbounded = select(
    loop({ length: 16, operator: "<", bound: "parameter", limit: 0 }),
  );
  assert.ok(!(unbounded.integerSlots ?? []).includes(2));
  assert.ok(!(unbounded.integerSlots ?? []).includes(0));
});

/** `x = <expression>; return x < 1 ? x : x` over constants: whether slot 0
 * (x) is published as an integer slot. */
function storedSlotIsInteger(
  operands: readonly number[],
  combine: (ids: readonly number[]) => Instruction,
): boolean {
  const constants: Instruction[] = operands.map((value, id) => ({
    kind: "constant",
    id,
    value,
    ...span,
  }));
  const ids = operands.map((_, id) => id);
  const fn: FunctionIR = {
    id: 0,
    name: "zero",
    exported: true,
    parameters: [],
    slots: ["number"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          ...constants,
          combine(ids),
          { kind: "store", slot: 0, value: 10, ...span },
          { kind: "load", id: 11, slot: 0, ...span },
          { kind: "constant", id: 12, value: 1, ...span },
          {
            kind: "binary",
            id: 13,
            operator: "<",
            left: 11,
            right: 12,
            ...span,
          },
        ],
        terminator: { kind: "return", value: 11, ...span },
      },
    ],
  };
  return (select(fn).integerSlots ?? []).includes(0);
}

test("integer slots never hold -0", () => {
  const binary =
    (operator: string) =>
    (ids: readonly number[]): Instruction => ({
      kind: "binary",
      id: 10,
      operator,
      left: ids[0] ?? 0,
      right: ids[1] ?? 0,
      ...span,
    });
  const negate = (ids: readonly number[]): Instruction => ({
    kind: "unary",
    id: 10,
    operator: "-",
    operand: ids[0] ?? 0,
    ...span,
  });
  // Each expression may evaluate to -0, which an int64 slot would turn into
  // +0 (observable through 1 / x and Object.is).
  for (const [operands, combine, label] of [
    [[0, -1], binary("*"), "0 * -1"],
    [[-1, 0], binary("*"), "-1 * 0"],
    [[-0, 3], binary("*"), "-0 * 3"],
    [[0], negate, "-0 via negation"],
    [[-0, -0], binary("+"), "-0 + -0"],
    [[-0, 0], binary("-"), "-0 - 0"],
    [[-0, 3], binary("%"), "-0 % 3"],
    [[0, -0], binary("min"), "Math.min(0, -0)"],
    [[-0, -1], binary("max"), "Math.max(-0, -1)"],
  ] as const)
    assert.equal(storedSlotIsInteger(operands, combine), false, label);
  // Neither operand pairing can produce -0.
  for (const [operands, combine, label] of [
    [[-0, 0], binary("+"), "-0 + 0"],
    [[0, 2], binary("*"), "0 * 2"],
    [[5, -1], binary("*"), "5 * -1"],
    [[5], negate, "-5"],
    [[0, -0], binary("-"), "0 - -0"],
    [[0, 3], binary("min"), "Math.min(0, 3)"],
  ] as const)
    assert.equal(storedSlotIsInteger(operands, combine), true, label);
  // A literal -0 is not an integer slot value either.
  assert.equal(
    storedSlotIsInteger([-0], (ids) => ({
      kind: "unary",
      id: 10,
      operator: "+",
      operand: ids[0] ?? 0,
      ...span,
    })),
    false,
  );
});

test("a counter bounded by a uint32 length is a 32-bit integer slot", () => {
  const fn = select(
    loop({ length: 16, operator: "<", bound: "length", limit: 0 }),
  );
  assert.deepEqual(fn.integerSlots, [2]);
  // The unknown length proves nothing about the fixed array's bounds.
  assert.ok(kinds(fn).includes("array-read"));
});

test("a counter running to a string's length inclusive stays a 32-bit slot", () => {
  // for (i = 0; i <= s.length; i++) {}  Slots: 0 s, 1 i.
  const fn: FunctionIR = {
    id: 0,
    name: "scan",
    exported: true,
    parameters: [0],
    slots: ["string", "number"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "constant", id: 0, value: 0, ...span },
          { kind: "store", slot: 1, value: 0, ...span },
        ],
        terminator: { kind: "jump", target: 1, ...span },
      },
      {
        id: 1,
        instructions: [
          { kind: "load", id: 1, slot: 1, ...span },
          { kind: "load", id: 2, slot: 0, ...span },
          { kind: "string-length", id: 3, string: 2, ...span },
          { kind: "binary", id: 4, operator: "<=", left: 1, right: 3, ...span },
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
          { kind: "load", id: 5, slot: 1, ...span },
          { kind: "constant", id: 6, value: 1, ...span },
          { kind: "binary", id: 7, operator: "+", left: 5, right: 6, ...span },
          { kind: "store", slot: 1, value: 7, ...span },
        ],
        terminator: { kind: "jump", target: 1, ...span },
      },
      {
        id: 3,
        instructions: [{ kind: "load", id: 8, slot: 1, ...span }],
        terminator: { kind: "return", value: 8, ...span },
      },
    ],
  };
  assert.deepEqual(select(fn).integerSlots, [1]);
});

test("safe integer slots carry the largest magnitude written", () => {
  // Slot 0 holds a product of a 32-bit integer slot and 2^40, or -5; slot 1
  // is a 32-bit integer slot; slot 2 holds 2^53, slot 3 -0 and slot 4 a
  // fraction, none of them safe integers other than -0. Remainders make
  // every slot relevant.
  const fn: FunctionIR = {
    id: 0,
    name: "wide",
    exported: true,
    parameters: [],
    slots: ["number", "number", "number", "number", "number"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "constant", id: 0, value: 7, ...span },
          { kind: "store", slot: 1, value: 0, ...span },
          { kind: "load", id: 1, slot: 1, ...span },
          { kind: "constant", id: 2, value: 1099511627776, ...span },
          { kind: "binary", id: 3, operator: "*", left: 1, right: 2, ...span },
          { kind: "store", slot: 0, value: 3, ...span },
          { kind: "constant", id: 4, value: -5, ...span },
          { kind: "store", slot: 0, value: 4, ...span },
          { kind: "constant", id: 5, value: 9007199254740992, ...span },
          { kind: "store", slot: 2, value: 5, ...span },
          { kind: "constant", id: 6, value: -0, ...span },
          { kind: "store", slot: 3, value: 6, ...span },
          { kind: "constant", id: 7, value: 0.5, ...span },
          { kind: "store", slot: 4, value: 7, ...span },
          { kind: "load", id: 8, slot: 0, ...span },
          { kind: "load", id: 9, slot: 2, ...span },
          { kind: "load", id: 10, slot: 3, ...span },
          { kind: "load", id: 11, slot: 4, ...span },
          { kind: "binary", id: 12, operator: "%", left: 8, right: 9, ...span },
          {
            kind: "binary",
            id: 13,
            operator: "%",
            left: 10,
            right: 11,
            ...span,
          },
          {
            kind: "binary",
            id: 14,
            operator: "%",
            left: 12,
            right: 13,
            ...span,
          },
        ],
        terminator: { kind: "return", value: 14, ...span },
      },
    ],
  };
  const selected = select(fn);
  assert.deepEqual(selected.integerSlots, [1]);
  assert.deepEqual(selected.safeIntegerSlots, [0]);
  assert.deepEqual(selected.safeIntegerBounds, [7696581394432]);
  // A rerun replaces the facts whole: once slot 0's writes fit 32 bits it
  // is an integer slot only.
  const narrowed = select({
    ...selected,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "constant", id: 0, value: 7, ...span },
          { kind: "store", slot: 0, value: 0, ...span },
          { kind: "load", id: 8, slot: 0, ...span },
          { kind: "binary", id: 9, operator: "%", left: 8, right: 0, ...span },
        ],
        terminator: { kind: "return", value: 9, ...span },
      },
    ],
  });
  assert.deepEqual(narrowed.integerSlots, [0]);
  assert.deepEqual(narrowed.safeIntegerSlots, []);
  assert.deepEqual(narrowed.safeIntegerBounds, []);
});

/** `sum(s, t)`: i = start; [n = s.length;] while (i <op> bound) { [late
 * write]; total += read.charCodeAt(i); i++ }. Slots: 0 s, 1 t, 2 i, 3
 * total, 4 n. */
function codeUnitLoop(options: {
  readonly start?: number;
  readonly operator?: "<" | "<=" | ">";
  /** "length": compare with s.length directly; "hoisted": with slot n;
   * "stored": with slot n, the length of a fresh string stored to s (as
   * LICM leaves a call result's length); "restored": like "stored", but s
   * is stored again after its length was taken; "copied": with slot n2, a
   * copy of slot n (as counted-loop preheaders copy hoisted lengths). */
  readonly bound?: "length" | "hoisted" | "stored" | "restored" | "copied";
  /** Which string the body reads. */
  readonly read?: 0 | 1;
  /** A write in the body before the read: to i or to s. */
  readonly write?: "index" | "string";
}): FunctionIR {
  const start = options.start ?? 0,
    operator = options.operator ?? "<",
    stored = options.bound === "stored" || options.bound === "restored",
    copied = options.bound === "copied",
    hoisted = options.bound === "hoisted" || stored || copied;
  const late: Instruction[] =
    options.write === "index"
      ? [
          { kind: "constant", id: 40, value: 1, ...span },
          {
            kind: "binary",
            id: 41,
            operator: "+",
            left: 21,
            right: 40,
            ...span,
          },
          { kind: "store", slot: 2, value: 41, ...span },
        ]
      : options.write === "string"
        ? [
            { kind: "load", id: 40, slot: 1, ...span },
            { kind: "store", slot: 0, value: 40, ...span },
          ]
        : [];
  const indexValue = options.write === "index" ? 42 : 21;
  const comparison: Instruction[] = [
    { kind: "load", id: 10, slot: 2, ...span },
    ...(hoisted
      ? [{ kind: "load" as const, id: 11, slot: copied ? 5 : 4, ...span }]
      : [
          { kind: "load" as const, id: 12, slot: 0, ...span },
          { kind: "string-length" as const, id: 11, string: 12, ...span },
        ]),
    operator === ">"
      ? { kind: "binary", id: 13, operator: ">", left: 11, right: 10, ...span }
      : { kind: "binary", id: 13, operator, left: 10, right: 11, ...span },
  ];
  return {
    id: 0,
    name: "sum",
    exported: true,
    parameters: [0, 1],
    slots: ["string", "string", "number", "number", "number", "number"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "constant", id: 0, value: start, ...span },
          { kind: "store", slot: 2, value: 0, ...span },
          { kind: "constant", id: 1, value: 0, ...span },
          { kind: "store", slot: 3, value: 1, ...span },
          ...(stored
            ? [
                {
                  kind: "string-literal" as const,
                  id: 5,
                  value: "abcdef",
                  ...span,
                },
                { kind: "store" as const, slot: 0, value: 5, ...span },
                { kind: "string-length" as const, id: 3, string: 5, ...span },
                { kind: "store" as const, slot: 4, value: 3, ...span },
                ...(options.bound === "restored"
                  ? [
                      { kind: "load" as const, id: 6, slot: 1, ...span },
                      { kind: "store" as const, slot: 0, value: 6, ...span },
                    ]
                  : []),
              ]
            : hoisted
              ? [
                  { kind: "load" as const, id: 2, slot: 0, ...span },
                  { kind: "string-length" as const, id: 3, string: 2, ...span },
                  { kind: "store" as const, slot: 4, value: 3, ...span },
                  ...(copied
                    ? [
                        { kind: "load" as const, id: 7, slot: 4, ...span },
                        { kind: "store" as const, slot: 5, value: 7, ...span },
                      ]
                    : []),
                ]
              : []),
        ],
        terminator: { kind: "jump", target: 1, ...span },
      },
      {
        id: 1,
        instructions: comparison,
        terminator: {
          kind: "branch",
          condition: 13,
          consequent: 2,
          alternate: 3,
          ...span,
        },
      },
      {
        id: 2,
        instructions: [
          { kind: "load", id: 21, slot: 2, ...span },
          ...late,
          ...(options.write === "index"
            ? [{ kind: "load" as const, id: 42, slot: 2, ...span }]
            : []),
          { kind: "load", id: 20, slot: options.read ?? 0, ...span },
          {
            kind: "string-code-unit",
            id: 22,
            string: 20,
            index: indexValue,
            ...span,
          },
          { kind: "load", id: 23, slot: 3, ...span },
          {
            kind: "binary",
            id: 24,
            operator: "+",
            left: 23,
            right: 22,
            ...span,
          },
          { kind: "store", slot: 3, value: 24, ...span },
          { kind: "constant", id: 25, value: 1, ...span },
          {
            kind: "binary",
            id: 26,
            operator: "+",
            left: indexValue,
            right: 25,
            ...span,
          },
          { kind: "store", slot: 2, value: 26, ...span },
        ],
        terminator: { kind: "jump", target: 1, ...span },
      },
      {
        id: 3,
        instructions: [{ kind: "load", id: 30, slot: 3, ...span }],
        terminator: { kind: "return", value: 30, ...span },
      },
    ],
  };
}
function codeUnitInBounds(fn: FunctionIR): boolean {
  assert.ok(
    verify({ functions: [fn] }).ok,
    JSON.stringify(verify({ functions: [fn] })),
  );
  const result = selectArrayAccesses(fn, 100000);
  assert.ok(result);
  assert.ok(verify({ functions: [result.fn] }).ok);
  for (const block of result.fn.blocks)
    for (const op of block!.instructions)
      if (op!.kind === "string-code-unit") return op!.inBounds === true;
  throw Error("no code unit");
}

test("code units indexed below their string's length are in bounds", () => {
  assert.equal(codeUnitInBounds(codeUnitLoop({})), true);
  assert.equal(codeUnitInBounds(codeUnitLoop({ bound: "hoisted" })), true);
  assert.equal(codeUnitInBounds(codeUnitLoop({ operator: ">" })), true);
  // The length of a string stored to its slot in the same block.
  assert.equal(codeUnitInBounds(codeUnitLoop({ bound: "stored" })), true);
  // A copy of the slot holding the length.
  assert.equal(codeUnitInBounds(codeUnitLoop({ bound: "copied" })), true);
});

test("code units stay checked without the length relation", () => {
  // Another string's length bounds the index.
  assert.equal(codeUnitInBounds(codeUnitLoop({ read: 1 })), false);
  // The index may equal the length.
  assert.equal(codeUnitInBounds(codeUnitLoop({ operator: "<=" })), false);
  // The index or the string changes after the comparison.
  assert.equal(codeUnitInBounds(codeUnitLoop({ write: "index" })), false);
  assert.equal(codeUnitInBounds(codeUnitLoop({ write: "string" })), false);
  // The string slot is stored again after its length was taken.
  assert.equal(codeUnitInBounds(codeUnitLoop({ bound: "restored" })), false);
  // A negative index is below the length too.
  assert.equal(codeUnitInBounds(codeUnitLoop({ start: -1 })), false);
  assert.equal(
    codeUnitInBounds(codeUnitLoop({ start: -1, bound: "hoisted" })),
    false,
  );
});

/** `stencil(a)` over a parameter array of unknown length: for (i = start;
 * i + indexDelta OP a.length - lengthOffset; i++) total += a[i + d] ?? 0
 * for each read delta d, then a[i + write] = total. With `hoisted`, the bound
 * a.length - lengthOffset is computed once into slot 2 before the loop.
 * Slots: 0 a, 1 i, 2 bound, 3 total. */
function stencil(options: {
  readonly start: number;
  readonly operator: "<" | "<=" | ">" | ">=";
  readonly lengthOffset: number;
  readonly indexDelta?: number;
  readonly reads: readonly number[];
  readonly write?: number;
  readonly hoisted?: boolean;
  readonly reassign?: boolean;
}): FunctionIR {
  let next = 100;
  const id = (): number => next++;
  function lengthMinus(into: Instruction[]): number {
    const array = id(),
      length = id(),
      offset = id(),
      bound = id();
    into.push(
      { kind: "load", id: array, slot: 0, ...span },
      { kind: "array-length", id: length, array, ...span },
      { kind: "constant", id: offset, value: options.lengthOffset, ...span },
      {
        kind: "binary",
        id: bound,
        operator: "-",
        left: length,
        right: offset,
        ...span,
      },
    );
    return bound;
  }
  function indexPlus(into: Instruction[], delta: number): number {
    const index = id(),
      amount = id(),
      sum = id();
    into.push(
      { kind: "load", id: index, slot: 1, ...span },
      { kind: "constant", id: amount, value: Math.abs(delta), ...span },
      {
        kind: "binary",
        id: sum,
        operator: delta < 0 ? "-" : "+",
        left: index,
        right: amount,
        ...span,
      },
    );
    return sum;
  }
  const entry: Instruction[] = [
    { kind: "constant", id: 0, value: options.start, ...span },
    { kind: "store", slot: 1, value: 0, ...span },
    { kind: "constant", id: 1, value: 0, ...span },
    { kind: "store", slot: 3, value: 1, ...span },
  ];
  if (options.hoisted === true)
    entry.push({ kind: "store", slot: 2, value: lengthMinus(entry), ...span });
  const header: Instruction[] = [];
  const index = indexPlus(header, options.indexDelta ?? 0);
  let bound: number;
  if (options.hoisted === true) {
    bound = id();
    header.push({ kind: "load", id: bound, slot: 2, ...span });
  } else bound = lengthMinus(header);
  const condition = id();
  // `>`/`>=` compare with the bound on the left: `bound > index`.
  const boundLeft = options.operator === ">" || options.operator === ">=";
  header.push({
    kind: "binary",
    id: condition,
    operator: options.operator,
    left: boundLeft ? bound : index,
    right: boundLeft ? index : bound,
    ...span,
  });
  const body: Instruction[] = [];
  for (const delta of options.reads) {
    const array = id(),
      read = id(),
      fallback = id(),
      value = id(),
      total = id(),
      sum = id();
    body.push({ kind: "load", id: array, slot: 0, ...span });
    const at = indexPlus(body, delta);
    body.push(
      { kind: "array-read", id: read, array, index: at, ...span },
      { kind: "constant", id: fallback, value: 0, ...span },
      { kind: "optional-value-or", id: value, value: read, fallback, ...span },
      { kind: "load", id: total, slot: 3, ...span },
      {
        kind: "binary",
        id: sum,
        operator: "+",
        left: total,
        right: value,
        ...span,
      },
      { kind: "store", slot: 3, value: sum, ...span },
    );
  }
  if (options.reassign === true) {
    const length = id(),
      fresh = id();
    body.push(
      { kind: "constant", id: length, value: 2, ...span },
      { kind: "array-new", id: fresh, type: "Float64Array", length, ...span },
      { kind: "store", slot: 0, value: fresh, ...span },
    );
  }
  if (options.write !== undefined) {
    const array = id(),
      total = id();
    body.push({ kind: "load", id: array, slot: 0, ...span });
    const at = indexPlus(body, options.write);
    body.push(
      { kind: "load", id: total, slot: 3, ...span },
      { kind: "array-write", array, index: at, value: total, ...span },
    );
  }
  const step = indexPlus(body, 1);
  body.push({ kind: "store", slot: 1, value: step, ...span });
  const result = id();
  return {
    id: 0,
    name: "stencil",
    exported: true,
    parameters: [0],
    slots: ["Float64Array", "number", "number", "number"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: entry,
        terminator: { kind: "jump", target: 1, ...span },
      },
      {
        id: 1,
        instructions: header,
        terminator: {
          kind: "branch",
          condition,
          consequent: 2,
          alternate: 3,
          ...span,
        },
      },
      {
        id: 2,
        instructions: body,
        terminator: { kind: "jump", target: 1, ...span },
      },
      {
        id: 3,
        instructions: [{ kind: "load", id: result, slot: 3, ...span }],
        terminator: { kind: "return", value: result, ...span },
      },
    ],
  };
}
function checked(fn: FunctionIR): number {
  return kinds(select(fn)).filter(
    (kind) => kind === "array-read" || kind === "array-write",
  ).length;
}

test("an index below an array's length minus c proves offsets up to c", () => {
  for (const hoisted of [false, true]) {
    const fn = select(
      stencil({
        start: 1,
        operator: "<",
        lengthOffset: 1,
        reads: [-1, 0, 1],
        write: 0,
        hoisted,
      }),
    );
    assert.equal(
      kinds(fn).filter((kind) => kind === "array-element").length,
      3,
    );
    assert.equal(kinds(fn).filter((kind) => kind === "array-store").length, 1);
    assert.ok(!kinds(fn).includes("array-read"));
    assert.ok(!kinds(fn).includes("array-write"));
  }
  // `i + 1 < a.length` and `a.length - 1 > i` prove the same.
  assert.equal(
    checked(
      stencil({
        start: 0,
        operator: "<",
        lengthOffset: 0,
        indexDelta: 1,
        reads: [0, 1],
      }),
    ),
    0,
  );
  assert.equal(
    checked(
      stencil({ start: 0, operator: ">", lengthOffset: 1, reads: [0, 1] }),
    ),
    0,
  );
  // `i <= a.length - 2` is `i < a.length - 1`.
  assert.equal(
    checked(stencil({ start: 0, operator: "<=", lengthOffset: 2, reads: [1] })),
    0,
  );
});

test("offsets beyond the proven margin, negative indexes and reassignment stay checked", () => {
  // a[i + 2] may be a[a.length] when i < a.length - 1.
  assert.equal(
    checked(stencil({ start: 1, operator: "<", lengthOffset: 1, reads: [2] })),
    1,
  );
  // `i <= a.length - 1` admits i = a.length - 1, so a[i + 1] may be past
  // the end; `i <= a.length` proves nothing.
  assert.equal(
    checked(
      stencil({ start: 0, operator: "<=", lengthOffset: 1, reads: [0, 1] }),
    ),
    1,
  );
  assert.equal(
    checked(stencil({ start: 0, operator: "<=", lengthOffset: 0, reads: [0] })),
    1,
  );
  // From i = 0, a[i - 1] reads index -1.
  assert.equal(
    checked(stencil({ start: 0, operator: "<", lengthOffset: 1, reads: [-1] })),
    1,
  );
  // A new array in the slot ends the relation for later accesses.
  assert.equal(
    checked(
      stencil({
        start: 0,
        operator: "<",
        lengthOffset: 0,
        reads: [0],
        write: 0,
        reassign: true,
      }),
    ),
    1,
  );
  // `>=` with the bound on the left is `i <= a.length - c`.
  assert.equal(
    checked(stencil({ start: 0, operator: ">=", lengthOffset: 1, reads: [1] })),
    1,
  );
});

test("bitwise AND with a non-negative length-1 mask selects unchecked reads and integer probe slots", () => {
  // Slots: 0 slots (optional-reference -> Uint32Array), 1 hash, 2 cap, 3 mask, 4 at, 5 probe.
  function probe(guardUpperBound: boolean): FunctionIR {
    return {
      id: 0,
      name: "probe",
      exported: true,
      parameters: [0, 1],
      slots: [
        "optional-reference",
        "number",
        "number",
        "number",
        "number",
        "number",
      ],
      returnType: "number",
      entry: 0,
      blocks: [
        {
          id: 0,
          instructions: [
            { kind: "load", id: 0, slot: 0, ...span },
            {
              kind: "reference-value",
              id: 1,
              value: 0,
              type: "Uint32Array",
              ...span,
            },
            { kind: "array-length", id: 2, array: 1, ...span },
            { kind: "constant", id: 3, value: 1, ...span },
            {
              kind: "binary",
              id: 4,
              operator: "<",
              left: 2,
              right: 3,
              ...span,
            },
            { kind: "store", slot: 2, value: 2, ...span },
          ],
          terminator: {
            kind: "branch",
            condition: 4,
            consequent: 5,
            alternate: 1,
            ...span,
          },
        },
        {
          id: 1,
          instructions: [
            { kind: "load", id: 5, slot: 2, ...span },
            {
              kind: "constant",
              id: 6,
              value: guardUpperBound ? 0x40000000 : 0xffffffff,
              ...span,
            },
            {
              kind: "binary",
              id: 7,
              operator: ">",
              left: 5,
              right: 6,
              ...span,
            },
          ],
          terminator: {
            kind: "branch",
            condition: 7,
            consequent: 5,
            alternate: 2,
            ...span,
          },
        },
        {
          id: 2,
          instructions: [
            { kind: "load", id: 8, slot: 2, ...span },
            { kind: "constant", id: 9, value: 1, ...span },
            {
              kind: "binary",
              id: 10,
              operator: "-",
              left: 8,
              right: 9,
              ...span,
            },
            { kind: "store", slot: 3, value: 10, ...span },
            { kind: "load", id: 11, slot: 1, ...span },
            {
              kind: "binary",
              id: 12,
              operator: "&",
              left: 11,
              right: 10,
              ...span,
            },
            { kind: "store", slot: 4, value: 12, ...span },
          ],
          terminator: { kind: "jump", target: 3, ...span },
        },
        {
          id: 3,
          instructions: [
            { kind: "load", id: 13, slot: 0, ...span },
            {
              kind: "reference-value",
              id: 14,
              value: 13,
              type: "Uint32Array",
              ...span,
            },
            { kind: "load", id: 15, slot: 4, ...span },
            { kind: "array-read", id: 16, array: 14, index: 15, ...span },
            { kind: "constant", id: 17, value: 0, ...span },
            {
              kind: "optional-value-or",
              id: 18,
              value: 16,
              fallback: 17,
              ...span,
            },
            { kind: "store", slot: 5, value: 18, ...span },
            { kind: "load", id: 26, slot: 5, ...span },
            {
              kind: "binary",
              id: 19,
              operator: "<=",
              left: 26,
              right: 17,
              ...span,
            },
          ],
          terminator: {
            kind: "branch",
            condition: 19,
            consequent: 5,
            alternate: 4,
            ...span,
          },
        },
        {
          id: 4,
          instructions: [
            { kind: "load", id: 20, slot: 4, ...span },
            { kind: "constant", id: 21, value: 1, ...span },
            {
              kind: "binary",
              id: 22,
              operator: "+",
              left: 20,
              right: 21,
              ...span,
            },
            { kind: "load", id: 23, slot: 3, ...span },
            {
              kind: "binary",
              id: 24,
              operator: "&",
              left: 22,
              right: 23,
              ...span,
            },
            { kind: "store", slot: 4, value: 24, ...span },
          ],
          terminator: { kind: "jump", target: 3, ...span },
        },
        {
          id: 5,
          instructions: [{ kind: "constant", id: 25, value: 0, ...span }],
          terminator: { kind: "return", value: 25, ...span },
        },
      ],
    };
  }
  const guarded = select(probe(true));
  assert.ok(kinds(guarded).includes("array-element"));
  assert.ok(!kinds(guarded).includes("array-read"));
  assert.ok(guarded.integerSlots?.includes(4));
  assert.ok(guarded.integerSlots?.includes(5));

  // Without bounding `cap <= 2^31`, `cap - 1` may have bit 31 set, so `&`
  // can produce negative int32 results and the read stays checked.
  const unguarded = select(probe(false));
  assert.ok(kinds(unguarded).includes("array-read"));
});

test("nonzero equality refinement proves probe - 1 >= 0 for guarded array reads", () => {
  // Slots: 0 hashes (Uint32Array), 1 probe (number), 2 entry (number)
  const fn: FunctionIR = {
    id: 0,
    name: "nonzeroProbe",
    exported: true,
    parameters: [0],
    slots: ["Uint32Array", "number", "number"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "load", id: 0, slot: 0, ...span },
          { kind: "array-length", id: 1, array: 0, ...span },
          { kind: "store", slot: 1, value: 1, ...span },
          { kind: "constant", id: 2, value: 0, ...span },
          {
            kind: "binary",
            id: 3,
            operator: "===",
            left: 1,
            right: 2,
            ...span,
          },
        ],
        terminator: {
          kind: "branch",
          condition: 3,
          consequent: 3,
          alternate: 1,
          ...span,
        },
      },
      {
        id: 1,
        instructions: [
          { kind: "load", id: 4, slot: 1, ...span },
          { kind: "constant", id: 5, value: 1, ...span },
          {
            kind: "binary",
            id: 6,
            operator: "-",
            left: 4,
            right: 5,
            ...span,
          },
          { kind: "store", slot: 2, value: 6, ...span },
          { kind: "load", id: 7, slot: 0, ...span },
          { kind: "array-length", id: 8, array: 7, ...span },
          {
            kind: "binary",
            id: 9,
            operator: "<",
            left: 6,
            right: 8,
            ...span,
          },
        ],
        terminator: {
          kind: "branch",
          condition: 9,
          consequent: 2,
          alternate: 3,
          ...span,
        },
      },
      {
        id: 2,
        instructions: [
          { kind: "load", id: 10, slot: 0, ...span },
          { kind: "load", id: 11, slot: 2, ...span },
          { kind: "array-read", id: 12, array: 10, index: 11, ...span },
          { kind: "constant", id: 13, value: 0, ...span },
          {
            kind: "optional-value-or",
            id: 14,
            value: 12,
            fallback: 13,
            ...span,
          },
        ],
        terminator: { kind: "return", value: 14, ...span },
      },
      {
        id: 3,
        instructions: [{ kind: "constant", id: 15, value: 0, ...span }],
        terminator: { kind: "return", value: 15, ...span },
      },
    ],
  };
  const selected = select(fn);
  assert.ok(kinds(selected).includes("array-element"));
  assert.ok(!kinds(selected).includes("array-read"));
  assert.ok(selected.integerSlots?.includes(2));
});

test("safe-integer multiplication feeding only bitwise ops lowers to imul", () => {
  // Slots: 0 arr (Uint32Array), 1 round (number = arr.length in [0, 2^32-1]), 2 i (number in [0, 511])
  const fn: FunctionIR = {
    id: 0,
    name: "mulMask",
    exported: true,
    parameters: [0],
    slots: ["Uint32Array", "number", "number"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "load", id: 0, slot: 0, ...span },
          { kind: "array-length", id: 1, array: 0, ...span },
          { kind: "store", slot: 1, value: 1, ...span },
          { kind: "constant", id: 2, value: 511, ...span },
          { kind: "store", slot: 2, value: 2, ...span },
          { kind: "load", id: 3, slot: 1, ...span },
          { kind: "load", id: 4, slot: 2, ...span },
          {
            kind: "binary",
            id: 5,
            operator: "*",
            left: 3,
            right: 4,
            ...span,
          },
          { kind: "constant", id: 6, value: 1023, ...span },
          {
            kind: "binary",
            id: 7,
            operator: "&",
            left: 5,
            right: 6,
            ...span,
          },
        ],
        terminator: { kind: "return", value: 7, ...span },
      },
    ],
  };
  const selected = select(fn);
  const ops = selected.blocks[0]!.instructions.filter(
    (op) => op.kind === "binary",
  );
  assert.ok(ops.some((op) => op.kind === "binary" && op.operator === "imul"));
  assert.ok(!ops.some((op) => op.kind === "binary" && op.operator === "*"));
});

test("uint32 threshold widening keeps 0-or-array-length cap and incremented len in integerSlots", () => {
  // Slots: 0 cond, 1 arr (Float64Array), 2 len, 3 cap
  const fn: FunctionIR = {
    id: 0,
    name: "pushCapWiden",
    exported: true,
    parameters: [0, 1],
    slots: ["boolean", "Float64Array", "number", "number"],
    returnType: "number",
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
          alternate: 2,
          ...span,
        },
      },
      {
        id: 1,
        instructions: [
          { kind: "load", id: 2, slot: 1, ...span },
          { kind: "array-length", id: 3, array: 2, ...span },
          { kind: "store", slot: 3, value: 3, ...span },
        ],
        terminator: { kind: "jump", target: 3, ...span },
      },
      {
        id: 2,
        instructions: [
          { kind: "constant", id: 4, value: 0, ...span },
          { kind: "store", slot: 3, value: 4, ...span },
        ],
        terminator: { kind: "jump", target: 3, ...span },
      },
      {
        id: 3,
        instructions: [
          { kind: "load", id: 5, slot: 2, ...span },
          { kind: "load", id: 6, slot: 3, ...span },
          {
            kind: "binary",
            id: 7,
            operator: "<",
            left: 5,
            right: 6,
            ...span,
          },
        ],
        terminator: {
          kind: "branch",
          condition: 7,
          consequent: 4,
          alternate: 5,
          ...span,
        },
      },
      {
        id: 4,
        instructions: [
          { kind: "load", id: 8, slot: 2, ...span },
          { kind: "constant", id: 9, value: 1, ...span },
          {
            kind: "binary",
            id: 10,
            operator: "+",
            left: 8,
            right: 9,
            ...span,
          },
          { kind: "store", slot: 2, value: 10, ...span },
        ],
        terminator: { kind: "jump", target: 3, ...span },
      },
      {
        id: 5,
        instructions: [{ kind: "load", id: 11, slot: 2, ...span }],
        terminator: { kind: "return", value: 11, ...span },
      },
    ],
  };
  const selected = select(fn);
  assert.ok(selected.integerSlots?.includes(2));
  assert.ok(selected.integerSlots?.includes(3));
});

test("slice bound slots stay tracked as integer slots", () => {
  const fn: FunctionIR = {
    id: 0,
    name: "sliceSlot",
    exported: true,
    parameters: [0],
    slots: ["string", "number"],
    returnType: "string",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "load", id: 0, slot: 0, ...span },
          { kind: "string-length", id: 1, string: 0, ...span },
          { kind: "constant", id: 2, value: 4, ...span },
          { kind: "binary", id: 3, operator: "+", left: 1, right: 2, ...span },
          { kind: "store", slot: 1, value: 3, ...span },
        ],
        terminator: { kind: "jump", target: 1, ...span },
      },
      {
        id: 1,
        instructions: [
          { kind: "load", id: 4, slot: 0, ...span },
          { kind: "load", id: 5, slot: 1, ...span },
          { kind: "undefined", id: 6, ...span },
          {
            kind: "string-slice",
            id: 7,
            string: 4,
            begin: 5,
            limit: 6,
            ...span,
          },
        ],
        terminator: { kind: "return", value: 7, ...span },
      },
    ],
  };
  assert.ok(verify({ functions: [fn] }).ok);
  const result = selectArrayAccesses(fn, 100000);
  assert.ok(result);
  assert.deepEqual(result.fn.integerSlots, [1]);
});

test("reused substitution table resets per block and handles empty-replacement rewrites", () => {
  // Block 1 rewrites an in-bounds array-read + optional-value-or (substituting
  // id 14 -> fresh element id); block 2 rewrites a safe multiplication to imul
  // with zero value substitutions; block 3 rewrites another in-bounds
  // array-read + optional-value-or in a separate block without leaking block 1's
  // substitution entry.
  const fn: FunctionIR = {
    id: 0,
    name: "reuseSub",
    exported: true,
    parameters: [0],
    slots: ["Float64Array", "number", "number", "number"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "constant", id: 0, value: 0, ...span },
          { kind: "store", slot: 3, value: 0, ...span },
          { kind: "load", id: 1, slot: 3, ...span },
          { kind: "load", id: 2, slot: 0, ...span },
          { kind: "array-length", id: 3, array: 2, ...span },
          {
            kind: "binary",
            id: 4,
            operator: "<",
            left: 1,
            right: 3,
            ...span,
          },
        ],
        terminator: {
          kind: "branch",
          condition: 4,
          consequent: 1,
          alternate: 4,
          ...span,
        },
      },
      {
        id: 1,
        instructions: [
          { kind: "load", id: 10, slot: 0, ...span },
          { kind: "load", id: 11, slot: 3, ...span },
          { kind: "array-read", id: 12, array: 10, index: 11, ...span },
          { kind: "constant", id: 13, value: 0, ...span },
          {
            kind: "optional-value-or",
            id: 14,
            value: 12,
            fallback: 13,
            ...span,
          },
          { kind: "store", slot: 1, value: 14, ...span },
        ],
        terminator: { kind: "jump", target: 2, ...span },
      },
      {
        id: 2,
        instructions: [
          { kind: "constant", id: 20, value: 7, ...span },
          { kind: "constant", id: 21, value: 9, ...span },
          {
            kind: "binary",
            id: 22,
            operator: "*",
            left: 20,
            right: 21,
            ...span,
          },
          { kind: "constant", id: 23, value: 255, ...span },
          {
            kind: "binary",
            id: 24,
            operator: "&",
            left: 22,
            right: 23,
            ...span,
          },
          { kind: "store", slot: 2, value: 24, ...span },
        ],
        terminator: { kind: "jump", target: 3, ...span },
      },
      {
        id: 3,
        instructions: [
          { kind: "load", id: 30, slot: 0, ...span },
          { kind: "load", id: 31, slot: 3, ...span },
          { kind: "array-read", id: 32, array: 30, index: 31, ...span },
          { kind: "constant", id: 33, value: 0, ...span },
          {
            kind: "optional-value-or",
            id: 34,
            value: 32,
            fallback: 33,
            ...span,
          },
          { kind: "load", id: 35, slot: 1, ...span },
          {
            kind: "binary",
            id: 36,
            operator: "+",
            left: 34,
            right: 35,
            ...span,
          },
        ],
        terminator: { kind: "return", value: 36, ...span },
      },
      {
        id: 4,
        instructions: [{ kind: "constant", id: 40, value: 0, ...span }],
        terminator: { kind: "return", value: 40, ...span },
      },
    ],
  };
  assert.deepEqual(verify({ functions: [fn] }), { ok: true });
  const selected = select(fn);
  assert.ok(
    selected.blocks[1]!.instructions.some((op) => op.kind === "array-element"),
  );
  assert.ok(
    selected.blocks[2]!.instructions.some(
      (op) => op.kind === "binary" && op.operator === "imul",
    ),
  );
  assert.ok(
    selected.blocks[3]!.instructions.some((op) => op.kind === "array-element"),
  );
});

test("bounds folds identity >>> 0 and decided (idx >>> 0) !== idx comparisons", () => {
  const fn: FunctionIR = {
    id: 0,
    name: "uint32IdentityFold",
    exported: true,
    parameters: [0],
    slots: ["number", "number"],
    returnType: "boolean",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "load", id: 0, slot: 0, ...span },
          { kind: "constant", id: 1, value: 0x3fff, ...span },
          { kind: "binary", id: 2, operator: "&", left: 0, right: 1, ...span },
          { kind: "store", slot: 1, value: 2, ...span },
          { kind: "load", id: 3, slot: 1, ...span },
          { kind: "constant", id: 4, value: 0, ...span },
          {
            kind: "binary",
            id: 5,
            operator: ">>>",
            left: 3,
            right: 4,
            ...span,
          },
          {
            kind: "binary",
            id: 6,
            operator: "!==",
            left: 5,
            right: 3,
            ...span,
          },
        ],
        terminator: { kind: "return", value: 6, ...span },
      },
    ],
  };
  assert.deepEqual(verify({ functions: [fn] }), { ok: true });
  const selected = select(fn);
  const ops = selected.blocks[0]!.instructions;
  assert.ok(
    !ops.some((op) => op.kind === "binary" && op.operator === ">>>"),
    "expected proven uint32 `idx >>> 0` to fold away",
  );
  assert.ok(
    ops.some(
      (op) => op.kind === "constant" && op.id === 6 && op.value === false,
    ),
    "expected `(idx >>> 0) !== idx` to fold to constant false",
  );
});
