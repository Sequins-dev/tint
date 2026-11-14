import assert from "node:assert/strict";
import test from "node:test";
import type { FunctionIR, Instruction } from "../src/scalar/model.ts";
import { provenInductionWords } from "../src/scalar/induction-words.ts";
const s = { start: 0, end: 0 };
function fixture(initial = 0, step = 1): FunctionIR {
  return {
    id: 0,
    name: "loop",
    exported: true,
    parameters: [],
    slots: ["number"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "constant", id: 0, value: initial, ...s },
          { kind: "store", slot: 0, value: 0, ...s },
        ],
        terminator: { kind: "jump", target: 1, ...s },
      },
      {
        id: 1,
        instructions: [
          { kind: "load", id: 1, slot: 0, ...s },
          { kind: "constant", id: 2, value: 64, ...s },
          { kind: "binary", id: 3, operator: "<", left: 1, right: 2, ...s },
        ],
        terminator: {
          kind: "branch",
          condition: 3,
          consequent: 2,
          alternate: 3,
          ...s,
        },
      },
      {
        id: 2,
        instructions: [
          { kind: "load", id: 4, slot: 0, ...s },
          { kind: "constant", id: 5, value: step, ...s },
          { kind: "binary", id: 6, operator: "+", left: 4, right: 5, ...s },
          { kind: "store", slot: 0, value: 6, ...s },
        ],
        terminator: { kind: "jump", target: 1, ...s },
      },
      {
        id: 3,
        instructions: [{ kind: "load", id: 7, slot: 0, ...s }],
        terminator: { kind: "return", value: 7, ...s },
      },
    ],
  };
}
test("bounded unit-step induction proves the full slot is a signed/unsigned word", () => {
  assert.equal(provenInductionWords(fixture())?.[0], 1);
  assert.equal(provenInductionWords(fixture(-2147483648))?.[0], 1);
});
test("fractions, unknown entry parameters, larger steps and unguarded increments retain checks", () => {
  assert.equal(provenInductionWords(fixture(0.5))?.[0], 0);
  assert.equal(provenInductionWords(fixture(0, 2))?.[0], 0);
  assert.equal(provenInductionWords({ ...fixture(), parameters: [0] })?.[0], 0);
  const fn = fixture();
  assert.equal(
    provenInductionWords({
      ...fn,
      blocks: fn.blocks.map((b) =>
        b.id === 1
          ? { ...b, terminator: { kind: "jump", target: 2, ...s } }
          : b,
      ),
    })?.[0],
    0,
  );
});
test("mutations after the guard invalidate the guard snapshot", () => {
  const fn = fixture(),
    body = fn.blocks[2]!;
  const extra: Instruction[] = [
    { kind: "constant", id: 8, value: 4294967295, ...s },
    { kind: "store", slot: 0, value: 8, ...s },
  ];
  assert.equal(
    provenInductionWords({
      ...fn,
      blocks: fn.blocks.map((b) =>
        b.id === 2
          ? { ...body, instructions: [...extra, ...body.instructions] }
          : b,
      ),
    })?.[0],
    0,
  );
});
test("budget exhaustion publishes no induction proof", () => {
  assert.equal(provenInductionWords(fixture(), 0), undefined);
  assert.equal(provenInductionWords(fixture(), NaN), undefined);
});

test("induction certificates refine ordinary numeric word propagation", async () => {
  const { provenWordFacts } = await import("../src/scalar/word-facts.ts");
  const fn = fixture();
  assert.equal(provenWordFacts(fn)?.slots[0], 15);
  assert.equal(
    provenWordFacts(fn, 1000000, undefined, provenInductionWords(fn))?.slots[0],
    1,
  );
});

test("inclusive and reversed guards cannot certify a bounded increment", () => {
  const fn = fixture();
  for (const inclusive of [false, true]) {
    const changed: FunctionIR = {
      ...fn,
      blocks: fn.blocks.map((b) =>
        b.id !== 1
          ? b
          : {
              ...b,
              instructions: b.instructions.map((op): Instruction =>
                inclusive && op.kind === "binary"
                  ? { ...op, operator: "<=" }
                  : op,
              ),
              terminator: {
                kind: "branch",
                condition: 3,
                consequent: inclusive ? 2 : 3,
                alternate: inclusive ? 3 : 2,
                ...s,
              },
            },
      ),
    };
    assert.equal(provenInductionWords(changed)?.[0], 0);
  }
});
test("a bound outside the word range retains checks", () => {
  const fn = fixture();
  assert.equal(
    provenInductionWords({
      ...fn,
      blocks: fn.blocks.map((b) => ({
        ...b,
        instructions: b.instructions.map((op): Instruction =>
          op.kind === "constant" && op.id === 2
            ? { ...op, value: 4294967296 }
            : op,
        ),
      })),
    })?.[0],
    0,
  );
});
test("exception entry cannot inherit a normal predecessor guard", () => {
  const fn = fixture();
  assert.equal(
    provenInductionWords({
      ...fn,
      blocks: fn.blocks.map((b) =>
        b.id === 0 ? { ...b, exception: { target: 2, slot: 0 } } : b,
      ),
    })?.[0],
    0,
  );
});
/** A loop whose body branches on an unrelated condition and joins before
 * the increment; `arm` instructions run on the consequent arm. `latch` is the
 * increment block's terminator. */
function diamond(
  arm: Instruction[] = [],
  latch: FunctionIR["blocks"][number]["terminator"] = {
    kind: "jump",
    target: 1,
    ...s,
  },
): FunctionIR {
  const fn = fixture();
  const loopExit = fn.blocks[3]!;
  return {
    ...fn,
    slots: ["number", "boolean"],
    blocks: [
      fn.blocks[0]!,
      fn.blocks[1]!,
      {
        id: 2,
        instructions: [{ kind: "load", id: 10, slot: 1, ...s }],
        terminator: {
          kind: "branch",
          condition: 10,
          consequent: 4,
          alternate: 5,
          ...s,
        },
      },
      loopExit,
      {
        id: 4,
        instructions: arm,
        terminator: { kind: "jump", target: 5, ...s },
      },
      {
        id: 5,
        instructions: [
          { kind: "load", id: 4, slot: 0, ...s },
          { kind: "constant", id: 5, value: 1, ...s },
          { kind: "binary", id: 6, operator: "+", left: 4, right: 5, ...s },
          { kind: "store", slot: 0, value: 6, ...s },
        ],
        terminator: latch,
      },
    ],
  };
}
test("a guard dominating the increment across joins in the loop body proves the slot", () => {
  assert.equal(provenInductionWords(diamond())?.[0], 1);
});
test("a write on any guard-to-increment path or an increment cycle avoiding the guard retains checks", () => {
  assert.equal(
    provenInductionWords(
      diamond([
        { kind: "constant", id: 11, value: 4294967295, ...s },
        { kind: "store", slot: 0, value: 11, ...s },
      ]),
    )?.[0],
    0,
  );
  // The increment block branches back to itself: repeated unguarded steps.
  assert.equal(
    provenInductionWords(
      diamond([], {
        kind: "branch",
        condition: 10,
        consequent: 5,
        alternate: 1,
        ...s,
      }),
    )?.[0],
    0,
  );
  // An inner cycle through the arm re-enters the increment without the guard.
  assert.equal(
    provenInductionWords(
      diamond([], {
        kind: "branch",
        condition: 10,
        consequent: 4,
        alternate: 1,
        ...s,
      }),
    )?.[0],
    0,
  );
});
test("an increment reachable from entry around the guard edge retains checks", () => {
  const fn = diamond();
  assert.equal(
    provenInductionWords({
      ...fn,
      blocks: fn.blocks.map((b) =>
        b.id === 0
          ? {
              ...b,
              instructions: [
                ...b.instructions,
                { kind: "load", id: 12, slot: 1, ...s },
              ],
              terminator: {
                kind: "branch",
                condition: 12,
                consequent: 1,
                alternate: 5,
                ...s,
              },
            }
          : b,
      ),
    })?.[0],
    0,
  );
});
test("negative zero never initializes an induction word", () => {
  assert.equal(provenInductionWords(fixture(-0))?.[0], 0);
});

test("string and array lengths bound an induction word", () => {
  // `i < s.length` (or an array's length) is below 2^31, so the counter
  // stays a word.
  for (const length of ["string-length", "array-length"] as const) {
    const base = fixture();
    const header = base.blocks[1]!;
    const fn: FunctionIR = {
      ...base,
      parameters: [1],
      slots: ["number", length === "string-length" ? "string" : "Uint8Array"],
      blocks: base.blocks.map((block) =>
        block.id !== 1
          ? block
          : {
              ...header,
              instructions: [
                { kind: "load", id: 1, slot: 0, ...s },
                { kind: "load", id: 8, slot: 1, ...s },
                length === "string-length"
                  ? { kind: "string-length", id: 2, string: 8, ...s }
                  : { kind: "array-length", id: 2, array: 8, ...s },
                {
                  kind: "binary",
                  id: 3,
                  operator: "<",
                  left: 1,
                  right: 2,
                  ...s,
                },
              ],
            },
      ),
    };
    assert.equal(provenInductionWords(fn)?.[0], 1, length);
  }
});

test("a hoisted length carried in a slot still bounds an induction word", () => {
  // LICM moves `s.length` to the preheader and carries it in a fresh slot;
  // any other store to that slot keeps the counter a double.
  for (const stray of [false, true]) {
    const base = fixture();
    const fn: FunctionIR = {
      ...base,
      parameters: [1],
      slots: ["number", "string", "number"],
      blocks: base.blocks.map((block) => {
        if (block.id === 0)
          return {
            ...block,
            instructions: [
              ...block.instructions,
              { kind: "load", id: 8, slot: 1, ...s },
              { kind: "string-length", id: 9, string: 8, ...s },
              { kind: "store", slot: 2, value: 9, ...s },
              ...(stray
                ? [
                    { kind: "constant", id: 10, value: 2 ** 40, ...s } as const,
                    { kind: "store", slot: 2, value: 10, ...s } as const,
                  ]
                : []),
            ],
          };
        if (block.id === 1)
          return {
            ...block,
            instructions: [
              { kind: "load", id: 1, slot: 0, ...s },
              { kind: "load", id: 2, slot: 2, ...s },
              { kind: "binary", id: 3, operator: "<", left: 1, right: 2, ...s },
            ],
          };
        return block;
      }),
    };
    assert.equal(
      provenInductionWords(fn)?.[0] ?? 0,
      stray ? 0 : 1,
      String(stray),
    );
  }
});

test("a uint32 conversion bounds an induction word", () => {
  // Array lengths lower as `uint32(length)` (and `x >>> 0` is a uint32
  // too), whatever the converted value: the bound stays below 2^32.
  for (const conversion of ["uint32", ">>>"] as const) {
    const base = fixture();
    const fn: FunctionIR = {
      ...base,
      parameters: [1],
      slots: ["number", "number"],
      blocks: base.blocks.map((block) =>
        block.id !== 1
          ? block
          : {
              ...block,
              instructions: [
                { kind: "load", id: 1, slot: 0, ...s },
                { kind: "load", id: 8, slot: 1, ...s },
                { kind: "constant", id: 9, value: 0, ...s },
                conversion === "uint32"
                  ? {
                      kind: "unary",
                      id: 2,
                      operator: "uint32",
                      operand: 8,
                      ...s,
                    }
                  : {
                      kind: "binary",
                      id: 2,
                      operator: ">>>",
                      left: 8,
                      right: 9,
                      ...s,
                    },
                {
                  kind: "binary",
                  id: 3,
                  operator: "<",
                  left: 1,
                  right: 2,
                  ...s,
                },
              ],
            },
      ),
    };
    assert.equal(provenInductionWords(fn)?.[0], 1, conversion);
  }
});
