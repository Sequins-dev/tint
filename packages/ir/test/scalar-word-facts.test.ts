import assert from "node:assert/strict";
import test from "node:test";
import { provenWordFacts } from "../src/scalar/word-facts.ts";
import type { FunctionIR } from "../src/scalar/model.ts";
const s = { start: 0, end: 0 };
function fixture(): FunctionIR {
  return {
    id: 0,
    name: "words",
    exported: true,
    parameters: [0],
    slots: ["Uint32Array", "optional-number", "number"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "load", id: 0, slot: 0, ...s },
          { kind: "constant", id: 1, value: 0, ...s },
          { kind: "array-read", id: 2, array: 0, index: 1, ...s },
          { kind: "store", slot: 1, value: 2, ...s },
        ],
        terminator: { kind: "jump", target: 1, ...s },
      },
      {
        id: 1,
        instructions: [
          { kind: "load", id: 3, slot: 1, ...s },
          { kind: "optional-value", id: 4, value: 3, ...s },
          { kind: "store", slot: 2, value: 4, ...s },
        ],
        terminator: { kind: "jump", target: 2, ...s },
      },
      {
        id: 2,
        instructions: [
          { kind: "constant", id: 5, value: 0, ...s },
          { kind: "store", slot: 2, value: 5, ...s },
          { kind: "load", id: 6, slot: 2, ...s },
        ],
        terminator: { kind: "return", value: 6, ...s },
      },
    ],
  };
}
test("word facts propagate through slots and retain optional NaN at joins", () => {
  const facts = provenWordFacts(fixture());
  assert.ok(facts);
  assert.equal(facts.slots[1], 9);
  assert.equal(facts.slots[2], 3);
});
test("every write contributes including late incompatible writes", () => {
  const fn = fixture(),
    last = fn.blocks[2]!;
  const changed = {
    ...fn,
    blocks: [
      ...fn.blocks.slice(0, 2),
      {
        ...last,
        instructions: [
          ...last.instructions,
          { kind: "constant" as const, id: 7, value: 0.5, ...s },
          { kind: "store" as const, slot: 2, value: 7, ...s },
        ],
      },
    ],
  };
  assert.equal(provenWordFacts(changed)?.slots[2], 7);
});
test("floating arrays and unknown parameters cannot establish word proofs", () => {
  const fn = fixture();
  assert.equal(
    provenWordFacts({
      ...fn,
      slots: ["Float64Array", "optional-number", "number"],
    })?.slots[2],
    7,
  );
  assert.equal(provenWordFacts({ ...fn, parameters: [0, 2] })?.slots[2], 7);
});
test("budget exhaustion publishes no partial proofs", () => {
  assert.equal(provenWordFacts(fixture(), 0), undefined);
  assert.equal(provenWordFacts(fixture(), NaN), undefined);
});

test("cyclic copies converge and unknown loop writes invalidate the whole cycle", () => {
  const fn: FunctionIR = {
    id: 0,
    name: "cycle",
    exported: true,
    parameters: [],
    slots: ["number", "number"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "constant", id: 0, value: 42, ...s },
          { kind: "store", slot: 0, value: 0, ...s },
        ],
        terminator: { kind: "jump", target: 1, ...s },
      },
      {
        id: 1,
        instructions: [
          { kind: "load", id: 1, slot: 0, ...s },
          { kind: "store", slot: 1, value: 1, ...s },
          { kind: "load", id: 2, slot: 1, ...s },
          { kind: "store", slot: 0, value: 2, ...s },
        ],
        terminator: { kind: "jump", target: 1, ...s },
      },
    ],
  };
  assert.deepEqual(Array.from(provenWordFacts(fn)?.slots ?? []), [1, 1]);
  assert.deepEqual(
    Array.from(provenWordFacts({ ...fn, parameters: [1] })?.slots ?? []),
    [7, 7],
  );
});
test("sparse SSA IDs use bounded indexing", () => {
  const fn: FunctionIR = {
    id: 0,
    name: "sparse",
    exported: true,
    parameters: [],
    slots: ["number"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "constant", id: 0x80000000, value: 42, ...s },
          { kind: "store", slot: 0, value: 0x80000000, ...s },
        ],
        terminator: { kind: "return", value: 0x80000000, ...s },
      },
    ],
  };
  assert.equal(provenWordFacts(fn)?.slots[0], 1);
});
test("opaque record reads invalidate an otherwise constant slot", () => {
  const fn = fixture(),
    first = fn.blocks[0]!;
  assert.equal(
    provenWordFacts({
      ...fn,
      parameters: [0, 3],
      slots: [...fn.slots, "reference"],
      blocks: [
        {
          ...first,
          instructions: [
            ...first.instructions,
            { kind: "load", id: 7, slot: 3, ...s },
          ],
          terminator: {
            kind: "record",
            object: 7,
            record: 0,
            field: 0,
            operation: "read",
            slot: 2,
            consequent: 1,
            alternate: 1,
            ...s,
          },
        },
        ...fn.blocks.slice(1),
      ],
    })?.slots[2],
    15,
  );
});

test("return summaries preserve possible NaN and only specialize direct proven callees", () => {
  const result = provenWordFacts(fixture());
  assert.equal(result?.returned, 3);
  const fn: FunctionIR = {
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
        instructions: [{ kind: "call", id: 0, target: 1, arguments: [], ...s }],
        terminator: { kind: "return", value: 0, ...s },
      },
    ],
  };
  assert.equal(provenWordFacts(fn)?.returned, 15);
  assert.equal(provenWordFacts(fn, 1000, new Uint8Array([0, 3]))?.returned, 3);
  assert.equal(provenWordFacts(fn, 1000, new Uint8Array([0, 0]))?.returned, 15);
});

test("call-site facts report propagated argument masks without assuming parameter types", () => {
  const fn: FunctionIR = {
    id: 0,
    name: "caller",
    exported: true,
    parameters: [0],
    slots: ["number"],
    returnType: "void",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "load", id: 0, slot: 0, ...s },
          { kind: "constant", id: 1, value: 17, ...s },
          { kind: "call", id: undefined, target: 1, arguments: [1, 0], ...s },
        ],
        terminator: { kind: "return", value: undefined, ...s },
      },
    ],
  };
  const result = provenWordFacts(
    fn,
    1000000,
    undefined,
    undefined,
    undefined,
    true,
  );
  assert.deepEqual(result?.calls, [
    { target: 1, masks: new Uint8Array([1, 7]) },
  ]);
  const refined = provenWordFacts(
    fn,
    1000000,
    undefined,
    undefined,
    new Uint8Array([1]),
    true,
  );
  assert.deepEqual(refined?.calls, [
    { target: 1, masks: new Uint8Array([1, 1]) },
  ]);
  assert.equal(provenWordFacts(fn)?.calls, undefined);
});
/** `array[0] ?? 0` as lowered: the optional is stored to slot 1 and tested;
 * the consequent unwraps a reload and the alternate stores the default. */
function coalesce(
  consequent: FunctionIR["blocks"][number]["instructions"] = [
    { kind: "load", id: 4, slot: 1, ...s },
    { kind: "optional-value", id: 5, value: 4, ...s },
    { kind: "store", slot: 2, value: 5, ...s },
  ],
  extraEntry = false,
): FunctionIR {
  return {
    id: 0,
    name: "coalesce",
    exported: true,
    parameters: [0],
    slots: ["Uint32Array", "optional-number", "number"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "load", id: 0, slot: 0, ...s },
          { kind: "constant", id: 1, value: 0, ...s },
          { kind: "array-read", id: 2, array: 0, index: 1, ...s },
          { kind: "store", slot: 1, value: 2, ...s },
          { kind: "optional-present", id: 3, value: 2, ...s },
        ],
        terminator: {
          kind: "branch",
          condition: 3,
          consequent: 1,
          alternate: 2,
          ...s,
        },
      },
      {
        id: 1,
        instructions: consequent,
        terminator: { kind: "jump", target: 3, ...s },
      },
      {
        id: 2,
        instructions: [
          { kind: "constant", id: 6, value: 0, ...s },
          { kind: "store", slot: 2, value: 6, ...s },
        ],
        terminator: extraEntry
          ? { kind: "jump", target: 1, ...s }
          : { kind: "jump", target: 3, ...s },
      },
      {
        id: 3,
        instructions: [{ kind: "load", id: 7, slot: 2, ...s }],
        terminator: { kind: "return", value: 7, ...s },
      },
    ],
  };
}
test("an unwrap reached only through its presence test cannot produce NaN", () => {
  assert.equal(provenWordFacts(coalesce())?.slots[2], 1);
});
test("unwraps with another entry or an intervening slot write keep possible NaN", () => {
  assert.equal(provenWordFacts(coalesce(undefined, true))?.slots[2], 3);
  assert.equal(
    provenWordFacts(
      coalesce([
        { kind: "undefined", id: 8, ...s },
        { kind: "store", slot: 1, value: 8, ...s },
        { kind: "load", id: 4, slot: 1, ...s },
        { kind: "optional-value", id: 5, value: 4, ...s },
        { kind: "store", slot: 2, value: 5, ...s },
      ]),
    )?.slots[2],
    3,
  );
});
test("negative zero constants are not proven 32-bit integers", () => {
  const fn = coalesce();
  const zeroed: FunctionIR = {
    ...fn,
    blocks: fn.blocks.map((b) =>
      b.id !== 2
        ? b
        : {
            ...b,
            instructions: [
              { kind: "constant", id: 6, value: -0, ...s },
              { kind: "store", slot: 2, value: 6, ...s },
            ],
          },
    ),
  };
  assert.equal(provenWordFacts(zeroed)?.slots[2], 5);
});
test("min and max carry the union of their operands' outcomes", () => {
  // Every instruction is a two-edge min, so the edge arrays must hold two
  // edges per instruction.
  const instructions: FunctionIR["blocks"][number]["instructions"][number][] = [
    { kind: "constant", id: 0, value: 7, ...s },
    { kind: "constant", id: 1, value: 4294967295, ...s },
  ];
  let last = 1;
  for (let i = 0; i < 8; i++) {
    instructions.push({
      kind: "binary",
      id: last + 1,
      operator: i % 2 === 0 ? "min" : "max",
      left: last,
      right: i % 3 === 0 ? 0 : 1,
      ...s,
    });
    last++;
  }
  instructions.push(
    { kind: "store", slot: 0, value: last, ...s },
    { kind: "constant", id: last + 1, value: 0.5, ...s },
    {
      kind: "binary",
      id: last + 2,
      operator: "max",
      left: last,
      right: last + 1,
      ...s,
    },
    { kind: "store", slot: 1, value: last + 2, ...s },
  );
  const fn: FunctionIR = {
    id: 0,
    name: "extrema",
    exported: true,
    parameters: [],
    slots: ["number", "number"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions,
        terminator: { kind: "return", value: last, ...s },
      },
    ],
  };
  const facts = provenWordFacts(fn);
  assert.ok(facts);
  assert.equal(facts.slots[0], 1);
  assert.equal(facts.slots[1], 5);
  assert.equal(facts.returned, 1);
});
