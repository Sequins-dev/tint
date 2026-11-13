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
