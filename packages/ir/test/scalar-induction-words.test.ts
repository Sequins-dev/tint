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
