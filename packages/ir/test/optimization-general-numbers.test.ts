import assert from "node:assert/strict";
import test from "node:test";
import {
  verify,
  type FunctionIR,
  type Instruction,
  type ModuleIR,
} from "@tint/ir/scalar";
import { shadowGeneralNumbers } from "../src/optimization/general-numbers.ts";
const s = { start: 0, end: 0 };

function shadowed(fn: FunctionIR): FunctionIR {
  const result = shadowGeneralNumbers(fn, 100000);
  assert.ok(result !== undefined);
  const module: ModuleIR = { functions: [result.fn] };
  const verified = verify(module);
  assert.ok(verified.ok, JSON.stringify(verified));
  return result.fn;
}
function block(fn: FunctionIR, id: number): readonly Instruction[] {
  const found = fn.blocks[id];
  assert.ok(found !== undefined);
  return found.instructions;
}
function kinds(instructions: readonly Instruction[]): string[] {
  return instructions.map((op) =>
    op.kind === "general-value" && op.unchecked === true
      ? "general-value:unchecked"
      : op.kind,
  );
}

/** `s = 0; while (typeof s === "number") { if (typeof x !== "number") break;
 * s = s + x; } return s;` over general slots: s1 is the accumulator, s0 the
 * parameter x. */
const accumulate: FunctionIR = {
  id: 0,
  name: "accumulate",
  exported: true,
  parameters: [0],
  slots: ["general", "general"],
  returnType: "general",
  entry: 0,
  blocks: [
    {
      id: 0,
      instructions: [
        { kind: "constant", id: 0, value: 0, ...s },
        { kind: "general-wrap", id: 1, value: 0, ...s },
        { kind: "store", slot: 1, value: 1, ...s },
      ],
      terminator: { kind: "jump", target: 1, ...s },
    },
    {
      id: 1,
      instructions: [
        { kind: "load", id: 2, slot: 1, ...s },
        { kind: "general-is", id: 3, value: 2, type: "number", ...s },
      ],
      terminator: {
        kind: "branch",
        condition: 3,
        consequent: 2,
        alternate: 4,
        ...s,
      },
    },
    {
      id: 2,
      instructions: [
        { kind: "load", id: 4, slot: 1, ...s },
        { kind: "general-value", id: 5, value: 4, type: "number", ...s },
        { kind: "load", id: 6, slot: 0, ...s },
        { kind: "general-is", id: 7, value: 6, type: "number", ...s },
      ],
      terminator: {
        kind: "branch",
        condition: 7,
        consequent: 3,
        alternate: 4,
        ...s,
      },
    },
    {
      id: 3,
      instructions: [
        { kind: "load", id: 8, slot: 0, ...s },
        { kind: "general-value", id: 9, value: 8, type: "number", ...s },
        { kind: "load", id: 10, slot: 1, ...s },
        { kind: "general-value", id: 11, value: 10, type: "number", ...s },
        { kind: "binary", id: 12, operator: "+", left: 11, right: 9, ...s },
        { kind: "general-wrap", id: 13, value: 12, ...s },
        { kind: "store", slot: 1, value: 13, ...s },
      ],
      terminator: { kind: "jump", target: 1, ...s },
    },
    {
      id: 4,
      instructions: [{ kind: "load", id: 14, slot: 1, ...s }],
      terminator: { kind: "return", value: 14, ...s },
    },
  ],
};

test("a loop accumulator stored as wrapped numbers is proven around the back edge", () => {
  const fn = shadowed(accumulate);
  // Two shadows (presence and number) per shadowed slot.
  assert.deepEqual(fn.slots.slice(2), [
    "boolean",
    "number",
    "boolean",
    "number",
  ]);
  // Both stores of wrapped numbers write the shadows directly.
  assert.deepEqual(kinds(block(fn, 0)).slice(-6), [
    "constant",
    "general-wrap",
    "store",
    "store",
    "constant",
    "store",
  ]);
  // The loop test is constant: every edge into b1 stores a number.
  const test1 = block(fn, 1)[1];
  assert.ok(test1?.kind === "constant" && test1.value === true);
  // The parameter's test reads its presence shadow; its proven read and
  // the accumulator's proven reads no longer check the tag.
  const test2 = block(fn, 2)[3];
  assert.ok(test2?.kind === "load" && fn.slots[test2.slot] === "boolean");
  assert.ok(!kinds(block(fn, 2)).includes("general-value"));
  assert.ok(!kinds(block(fn, 3)).includes("general-value"));
  // The parameter's shadows start from its incoming value, unchecked.
  assert.ok(kinds(block(fn, 0)).includes("general-value:unchecked"));
});

/** `t = x; if (typeof t === "number") return t + 0;` where x is only copied:
 * the copy of an unshadowed value is tested and extracted at the store. */
test("stores of values of unknown category test them once", () => {
  const fn = shadowed({
    id: 0,
    name: "copy",
    exported: true,
    parameters: [0],
    slots: ["general", "general"],
    returnType: "general",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "load", id: 0, slot: 0, ...s },
          { kind: "store", slot: 1, value: 0, ...s },
          { kind: "load", id: 1, slot: 1, ...s },
          { kind: "general-is", id: 2, value: 1, type: "number", ...s },
        ],
        terminator: {
          kind: "branch",
          condition: 2,
          consequent: 1,
          alternate: 2,
          ...s,
        },
      },
      {
        id: 1,
        instructions: [
          { kind: "load", id: 3, slot: 1, ...s },
          { kind: "general-value", id: 4, value: 3, type: "number", ...s },
          { kind: "constant", id: 5, value: 0, ...s },
          { kind: "binary", id: 6, operator: "+", left: 4, right: 5, ...s },
          { kind: "general-wrap", id: 7, value: 6, ...s },
        ],
        terminator: { kind: "return", value: 7, ...s },
      },
      {
        id: 2,
        instructions: [{ kind: "load", id: 8, slot: 1, ...s }],
        terminator: { kind: "return", value: 8, ...s },
      },
    ],
  });
  assert.deepEqual(kinds(block(fn, 0)), [
    "load",
    "store",
    "general-is",
    "store",
    "general-value:unchecked",
    "store",
    "load",
    "load",
  ]);
  assert.deepEqual(kinds(block(fn, 1)), [
    "load",
    "load",
    "constant",
    "binary",
    "general-wrap",
  ]);
});

/** `t = x < 1; if (typeof t === "number") return t; return x;` with x a
 * number parameter: the wrapped comparison is never a Number, so the store
 * writes false and 0 to the shadows without testing the general value. */
test("stores of wrapped scalars of another category write the shadows directly", () => {
  const fn = shadowed({
    id: 0,
    name: "compare",
    exported: true,
    parameters: [0],
    slots: ["number", "general"],
    returnType: "general",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "load", id: 0, slot: 0, ...s },
          { kind: "constant", id: 1, value: 1, ...s },
          { kind: "binary", id: 2, operator: "<", left: 0, right: 1, ...s },
          { kind: "general-wrap", id: 3, value: 2, ...s },
          { kind: "store", slot: 1, value: 3, ...s },
          { kind: "load", id: 4, slot: 1, ...s },
          { kind: "general-is", id: 5, value: 4, type: "number", ...s },
        ],
        terminator: {
          kind: "branch",
          condition: 5,
          consequent: 1,
          alternate: 2,
          ...s,
        },
      },
      {
        id: 1,
        instructions: [
          { kind: "load", id: 6, slot: 1, ...s },
          { kind: "general-value", id: 7, value: 6, type: "number", ...s },
          { kind: "general-wrap", id: 8, value: 7, ...s },
        ],
        terminator: { kind: "return", value: 8, ...s },
      },
      {
        id: 2,
        instructions: [
          { kind: "load", id: 9, slot: 0, ...s },
          { kind: "general-wrap", id: 10, value: 9, ...s },
        ],
        terminator: { kind: "return", value: 10, ...s },
      },
    ],
  });
  assert.deepEqual(kinds(block(fn, 0)), [
    "load",
    "constant",
    "binary",
    "general-wrap",
    "store",
    "constant",
    "store",
    "constant",
    "store",
    "load",
    "load",
  ]);
  const presence = block(fn, 0)[5];
  assert.ok(presence?.kind === "constant" && presence.value === false);
});

test("a test of a value loaded before a store proves nothing about the slot", () => {
  const fn = shadowed({
    id: 0,
    name: "stale",
    exported: true,
    parameters: [0],
    slots: ["general"],
    returnType: "general",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "load", id: 0, slot: 0, ...s },
          { kind: "general-none", id: 1, ...s },
          { kind: "store", slot: 0, value: 1, ...s },
          { kind: "general-is", id: 2, value: 0, type: "number", ...s },
        ],
        terminator: {
          kind: "branch",
          condition: 2,
          consequent: 1,
          alternate: 2,
          ...s,
        },
      },
      {
        id: 1,
        instructions: [
          { kind: "load", id: 3, slot: 0, ...s },
          { kind: "general-value", id: 4, value: 3, type: "number", ...s },
          { kind: "general-wrap", id: 5, value: 4, ...s },
        ],
        terminator: { kind: "return", value: 5, ...s },
      },
      {
        id: 2,
        instructions: [{ kind: "load", id: 6, slot: 0, ...s }],
        terminator: { kind: "return", value: 6, ...s },
      },
    ],
  });
  // The old value keeps its own test; the read after the branch stays checked.
  assert.ok(kinds(block(fn, 0)).includes("general-is"));
  const read = block(fn, 1)[1];
  assert.ok(read?.kind === "general-value" && read.unchecked !== true);
});

test("slots written by exception edges keep their representation", () => {
  const result = shadowGeneralNumbers(
    {
      id: 0,
      name: "thrown",
      exported: true,
      parameters: [],
      slots: ["general"],
      returnType: "general",
      entry: 0,
      blocks: [
        {
          id: 0,
          instructions: [
            { kind: "load", id: 0, slot: 0, ...s },
            { kind: "general-is", id: 1, value: 0, type: "number", ...s },
          ],
          terminator: { kind: "return", value: 0, ...s },
          exception: { target: 1, slot: 0 },
        },
        {
          id: 1,
          instructions: [
            { kind: "load", id: 2, slot: 0, ...s },
            { kind: "general-is", id: 3, value: 2, type: "number", ...s },
          ],
          terminator: { kind: "return", value: 2, ...s },
        },
      ],
    },
    100000,
  );
  assert.equal(result?.shadowed, 0);
});

test("conditional dead edges and unshadowed merge temporaries keep loop counters proven", () => {
  const fn = shadowed({
    id: 0,
    name: "counted",
    exported: true,
    parameters: [0],
    slots: ["general", "general", "general"],
    returnType: "general",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "constant", id: 0, value: 0, ...s },
          { kind: "general-wrap", id: 1, value: 0, ...s },
          { kind: "store", slot: 1, value: 1, ...s },
        ],
        terminator: { kind: "jump", target: 1, ...s },
      },
      {
        id: 1,
        instructions: [
          { kind: "load", id: 2, slot: 1, ...s },
          { kind: "general-is", id: 3, value: 2, type: "number", ...s },
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
          { kind: "load", id: 4, slot: 1, ...s },
          { kind: "general-value", id: 5, value: 4, type: "number", ...s },
          { kind: "constant", id: 6, value: 1, ...s },
          { kind: "binary", id: 7, operator: "+", left: 5, right: 6, ...s },
          { kind: "general-wrap", id: 8, value: 7, ...s },
          { kind: "store", slot: 2, value: 8, ...s },
        ],
        terminator: { kind: "jump", target: 4, ...s },
      },
      {
        // Unreachable when slot 1 is proven a number; would otherwise poison slot 2.
        id: 3,
        instructions: [
          { kind: "load", id: 9, slot: 0, ...s },
          { kind: "store", slot: 2, value: 9, ...s },
        ],
        terminator: { kind: "jump", target: 4, ...s },
      },
      {
        id: 4,
        instructions: [
          { kind: "load", id: 10, slot: 2, ...s },
          { kind: "store", slot: 1, value: 10, ...s },
        ],
        terminator: { kind: "jump", target: 1, ...s },
      },
    ],
  });
  // Dead alternate edge b1 -> b3 is ignored, so b1's tag test folds to true.
  const test1 = block(fn, 1)[1];
  assert.ok(test1?.kind === "constant" && test1.value === true);
  // Store into slot 1 in b4 skips a checked general-is tag test.
  assert.ok(!kinds(block(fn, 4)).includes("general-is"));
});

test("element-load non-absent edge proves the loaded slot holds a number", () => {
  const result = shadowGeneralNumbers(
    {
      id: 0,
      name: "elemLoad",
      exported: true,
      parameters: [0, 1],
      slots: ["general", "number", "general"],
      returnType: "general",
      entry: 0,
      blocks: [
        {
          id: 0,
          instructions: [
            { kind: "load", id: 0, slot: 0, ...s },
            { kind: "load", id: 1, slot: 1, ...s },
            {
              kind: "element-load",
              id: 2,
              object: 0,
              index: 1,
              record: 0,
              field: 0,
              elementsRecord: 1,
              countField: 0,
              storageField: 1,
              ...s,
            },
            { kind: "store", slot: 2, value: 2, ...s },
            { kind: "general-is", id: 3, value: 2, type: "absent", ...s },
          ],
          terminator: {
            kind: "branch",
            condition: 3,
            consequent: 2,
            alternate: 1,
            ...s,
          },
        },
        {
          id: 1,
          instructions: [
            { kind: "load", id: 4, slot: 2, ...s },
            { kind: "general-is", id: 5, value: 4, type: "number", ...s },
            { kind: "general-value", id: 6, value: 4, type: "number", ...s },
            { kind: "general-wrap", id: 7, value: 6, ...s },
          ],
          terminator: { kind: "return", value: 7, ...s },
        },
        {
          id: 2,
          instructions: [{ kind: "general-none", id: 8, ...s }],
          terminator: { kind: "return", value: 8, ...s },
        },
      ],
    },
    100000,
  );
  assert.ok(result !== undefined);
  const hitTest = block(result.fn, 1)[2];
  assert.ok(hitTest?.kind === "constant" && hitTest.value === true);
  assert.ok(!kinds(block(result.fn, 1)).includes("general-value"));
  assert.ok(
    !block(result.fn, 1).some((op) => op.kind === "load" && op.slot === 2),
    "proven script load should materialize from the number shadow",
  );
});

test("merge temporaries feeding loop accumulators and element-store are shadowed", () => {
  const result = shadowGeneralNumbers(
    {
      id: 0,
      name: "mergeTemp",
      exported: true,
      parameters: [0, 1],
      slots: ["general", "general", "general", "general", "number"],
      returnType: "general",
      entry: 0,
      blocks: [
        {
          id: 0,
          instructions: [
            { kind: "constant", id: 0, value: 0, ...s },
            { kind: "general-wrap", id: 1, value: 0, ...s },
            { kind: "store", slot: 2, value: 1, ...s },
            { kind: "store", slot: 4, value: 0, ...s },
          ],
          terminator: { kind: "jump", target: 1, ...s },
        },
        {
          id: 1,
          instructions: [
            { kind: "load", id: 2, slot: 2, ...s },
            { kind: "general-is", id: 3, value: 2, type: "number", ...s },
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
            { kind: "load", id: 4, slot: 2, ...s },
            { kind: "general-value", id: 5, value: 4, type: "number", ...s },
            { kind: "constant", id: 6, value: 1, ...s },
            { kind: "binary", id: 7, operator: "+", left: 5, right: 6, ...s },
            { kind: "general-wrap", id: 8, value: 7, ...s },
            { kind: "store", slot: 3, value: 8, ...s },
          ],
          terminator: { kind: "jump", target: 4, ...s },
        },
        {
          // Two cold slow stores to slot 3 (e.g. string + and generic +).
          id: 3,
          instructions: [
            { kind: "load", id: 9, slot: 1, ...s },
            { kind: "store", slot: 3, value: 9, ...s },
            { kind: "load", id: 10, slot: 1, ...s },
            { kind: "store", slot: 3, value: 10, ...s },
          ],
          terminator: { kind: "jump", target: 4, ...s },
        },
        {
          id: 4,
          instructions: [
            { kind: "load", id: 11, slot: 3, ...s },
            { kind: "store", slot: 2, value: 11, ...s },
            { kind: "load", id: 12, slot: 0, ...s },
            { kind: "load", id: 13, slot: 4, ...s },
            {
              kind: "element-store",
              id: 14,
              object: 12,
              index: 13,
              value: 11,
              record: 0,
              field: 0,
              elementsRecord: 1,
              countField: 0,
              storageField: 1,
              ...s,
            },
          ],
          terminator: { kind: "jump", target: 1, ...s },
        },
      ],
    },
    100000,
  );
  assert.ok(result !== undefined);
  // Both accumulator slot 2 and merge temporary slot 3 are shadowed.
  assert.equal(result.shadowed, 2);
  // Copying slot 3 -> slot 2 in block 4 copies shadows with no general-is.
  assert.ok(!kinds(block(result.fn, 4)).includes("general-is"));
});
