import { test } from "node:test";
import assert from "node:assert/strict";
import { verify, type FunctionIR, type ModuleIR } from "../src/scalar/index.ts";
import {
  optimizeModule,
  scalarizeStencilLoops,
} from "../src/optimization/index.ts";
import { boundCountedLoops } from "../src/optimization/counted-loops.ts";

const span = { start: 0, end: 0 };

/** Builds a Float64Array 3-point stencil loop:
 * for (let i = 1; i < field.length - 1; i++) {
 *   const next = (field[i - 1] + field[i] * 2 + field[i + 1]) * 0.25;
 *   field[i] = next;
 * } */
function stencilFunction(
  arrayType: "Float64Array" | "Uint8Array" | "Float32Array",
  withCall = false,
): FunctionIR {
  return {
    id: 0,
    name: "stencil",
    exported: true,
    parameters: [0],
    slots: [arrayType, "number", "number"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "constant", id: 0, value: 1, ...span },
          { kind: "store", slot: 1, value: 0, ...span },
          { kind: "load", id: 1, slot: 0, ...span },
          { kind: "array-length", id: 2, array: 1, ...span },
          { kind: "constant", id: 3, value: 1, ...span },
          { kind: "binary", id: 4, operator: "-", left: 2, right: 3, ...span },
          { kind: "store", slot: 2, value: 4, ...span },
        ],
        terminator: { kind: "jump", target: 1, ...span },
      },
      {
        id: 1,
        instructions: [
          { kind: "load", id: 5, slot: 1, ...span },
          { kind: "load", id: 6, slot: 2, ...span },
          { kind: "binary", id: 7, operator: "<", left: 5, right: 6, ...span },
        ],
        terminator: {
          kind: "branch",
          condition: 7,
          consequent: 2,
          alternate: 3,
          ...span,
        },
      },
      {
        id: 2,
        instructions: [
          { kind: "load", id: 8, slot: 0, ...span },
          { kind: "load", id: 9, slot: 1, ...span },
          { kind: "constant", id: 10, value: 1, ...span },
          {
            kind: "binary",
            id: 11,
            operator: "-",
            left: 9,
            right: 10,
            ...span,
          },
          { kind: "array-element", id: 12, array: 8, index: 11, ...span },
          { kind: "array-element", id: 13, array: 8, index: 9, ...span },
          {
            kind: "binary",
            id: 14,
            operator: "+",
            left: 9,
            right: 10,
            ...span,
          },
          { kind: "array-element", id: 15, array: 8, index: 14, ...span },
          {
            kind: "binary",
            id: 16,
            operator: "+",
            left: 12,
            right: 13,
            ...span,
          },
          {
            kind: "binary",
            id: 17,
            operator: "+",
            left: 16,
            right: 15,
            ...span,
          },
          ...(withCall
            ? [
                {
                  kind: "call" as const,
                  id: undefined,
                  target: 1,
                  arguments: [],
                  ...span,
                },
              ]
            : []),
          { kind: "array-store", array: 8, index: 9, value: 17, ...span },
          { kind: "store", slot: 1, value: 14, ...span },
        ],
        terminator: { kind: "jump", target: 1, ...span },
      },
      {
        id: 3,
        instructions: [{ kind: "load", id: 18, slot: 1, ...span }],
        terminator: { kind: "return", value: 18, ...span },
      },
    ],
  };
}

test("scalarizeStencilLoops carries prev and curr on Float64Array stencil", () => {
  const fn = stencilFunction("Float64Array");
  const res = scalarizeStencilLoops(fn, 100000);
  assert.ok(res !== undefined);
  assert.equal(res.rewritten, 1);
  // Preheader guard + init added; body now has only 1 array-element (A[i+1]).
  const body = res.fn.blocks[2];
  assert.ok(body !== undefined);
  const elemLoads = body.instructions.filter(
    (op) => op.kind === "array-element",
  );
  assert.equal(elemLoads.length, 1);
  const v = verify({ functions: [res.fn] });
  assert.equal(v.ok, true, JSON.stringify(v));
});

test("scalarizeStencilLoops narrows carried prev on Uint8Array recurrence", () => {
  const fn = stencilFunction("Uint8Array");
  const res = scalarizeStencilLoops(fn, 100000);
  assert.ok(res !== undefined);
  assert.equal(res.rewritten, 1);
  const body = res.fn.blocks[2];
  assert.ok(body !== undefined);
  // Must emit `& 255` narrowing when storing back to prevSlot because sum wasn't masked.
  const masks = body.instructions.filter(
    (op) => op.kind === "binary" && op.operator === "&",
  );
  assert.equal(masks.length, 1);
  const v = verify({ functions: [res.fn] });
  assert.equal(v.ok, true, JSON.stringify(v));
});

test("scalarizeStencilLoops rejects Float32Array and loops with calls", () => {
  const f32 = scalarizeStencilLoops(stencilFunction("Float32Array"), 100000);
  assert.equal(f32?.rewritten, 0);
  const called = scalarizeStencilLoops(
    stencilFunction("Float64Array", true),
    100000,
  );
  assert.equal(called?.rewritten, 0);
});

test("boundCountedLoops promotes conditional (acc + x) | 0 with int32 entry proof and dynamic guard", () => {
  // Function with parameter `init` (unknown entry) and conditional update:
  // for (let i = 0; i < 16; i++) if ((i & 1) === 0) acc = (acc + i) | 0;
  const fn: FunctionIR = {
    id: 0,
    name: "condAcc",
    exported: true,
    parameters: [0],
    slots: ["number", "number"],
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
          { kind: "constant", id: 2, value: 16, ...span },
          { kind: "binary", id: 3, operator: "<", left: 1, right: 2, ...span },
        ],
        terminator: {
          kind: "branch",
          condition: 3,
          consequent: 2,
          alternate: 5,
          ...span,
        },
      },
      {
        id: 2,
        instructions: [
          { kind: "load", id: 4, slot: 1, ...span },
          { kind: "constant", id: 5, value: 1, ...span },
          { kind: "binary", id: 6, operator: "&", left: 4, right: 5, ...span },
          { kind: "constant", id: 7, value: 0, ...span },
          {
            kind: "binary",
            id: 8,
            operator: "===",
            left: 6,
            right: 7,
            ...span,
          },
        ],
        terminator: {
          kind: "branch",
          condition: 8,
          consequent: 3,
          alternate: 4,
          ...span,
        },
      },
      {
        id: 3,
        instructions: [
          { kind: "load", id: 9, slot: 0, ...span },
          { kind: "load", id: 10, slot: 1, ...span },
          {
            kind: "binary",
            id: 11,
            operator: "+",
            left: 9,
            right: 10,
            ...span,
          },
          { kind: "constant", id: 12, value: 0, ...span },
          {
            kind: "binary",
            id: 13,
            operator: "|",
            left: 11,
            right: 12,
            ...span,
          },
          { kind: "store", slot: 0, value: 13, ...span },
        ],
        terminator: { kind: "jump", target: 4, ...span },
      },
      {
        id: 4,
        instructions: [
          { kind: "load", id: 14, slot: 1, ...span },
          { kind: "constant", id: 15, value: 1, ...span },
          {
            kind: "binary",
            id: 16,
            operator: "+",
            left: 14,
            right: 15,
            ...span,
          },
          { kind: "store", slot: 1, value: 16, ...span },
        ],
        terminator: { kind: "jump", target: 1, ...span },
      },
      {
        id: 5,
        instructions: [{ kind: "load", id: 17, slot: 0, ...span }],
        terminator: { kind: "return", value: 17, ...span },
      },
    ],
  };
  const res = boundCountedLoops(fn, 100000);
  assert.ok(res !== undefined);
  assert.ok(res.bounded >= 1);
  // Dynamic guard emits `1 / acc > 0` check for `-0` safety on conditional updates.
  const hasDiv = res.fn.blocks.some((b) =>
    b.instructions.some((op) => op.kind === "binary" && op.operator === "/"),
  );
  assert.equal(hasDiv, true);
  const v = verify({ functions: [res.fn] });
  assert.equal(v.ok, true, JSON.stringify(v));
});

test("optimizeModule folds array-length(array-new(const)) and eliminates dead record-read", () => {
  const mod: ModuleIR = {
    records: [
      {
        byteLength: 16,
        fields: [{ offset: 8, type: "number", mutable: true }],
      },
    ],
    functions: [
      {
        id: 0,
        name: "foldLen",
        exported: true,
        parameters: [],
        slots: ["Float64Array", "reference"],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "constant", id: 0, value: 3, ...span },
              {
                kind: "array-new",
                id: 1,
                type: "Float64Array",
                length: 0,
                ...span,
              },
              { kind: "array-length", id: 2, array: 1, ...span },
              { kind: "record-new", id: 3, record: 0, arguments: [0], ...span },
              {
                kind: "record-read",
                id: 4,
                object: 3,
                record: 0,
                field: 0,
                ...span,
              },
            ],
            terminator: { kind: "return", value: 2, ...span },
          },
        ],
      },
    ],
  };
  const opt = optimizeModule(mod, 100000);
  assert.equal(opt.budgetExhausted, false);
  const fn = opt.module.functions[0];
  assert.ok(fn !== undefined);
  const ops = fn.blocks.flatMap((b) => b.instructions);
  assert.equal(
    ops.some((op) => op.kind === "array-length"),
    false,
  );
  assert.equal(
    ops.some((op) => op.kind === "record-read"),
    false,
  );
  const v = verify(opt.module);
  assert.equal(v.ok, true, JSON.stringify(v));
});
