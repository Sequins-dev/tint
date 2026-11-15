import assert from "node:assert/strict";
import test from "node:test";
import { verify, type FunctionIR, type ModuleIR } from "@tint/ir/scalar";
import { promoteLoopCells } from "../src/optimization/cell-promotion.ts";

/** count(n): a fresh number cell (record 0) in slot 1, incremented n times
 * in a loop (b2 header, b3 body), then read and returned. With `closure`,
 * the body also calls a closure over the cell (function 1, whose
 * environment holds it). Slots: 0 n, 1 cell, 2 i, 3 cell value, 4 closure. */
function counter(closure: boolean): ModuleIR {
  const body: FunctionIR["blocks"][number]["instructions"][number][] = [
    { kind: "load", id: 20, slot: 3, start: 0, end: 0 },
    { kind: "constant", id: 21, value: 1, start: 0, end: 0 },
    {
      kind: "binary",
      id: 22,
      operator: "+",
      left: 20,
      right: 21,
      start: 0,
      end: 0,
    },
    { kind: "store", slot: 3, value: 22, start: 0, end: 0 },
  ];
  if (closure) {
    body.push({ kind: "load", id: 23, slot: 4, start: 0, end: 0 });
    body.push({
      kind: "call-indirect",
      id: undefined,
      target: 1,
      callee: 23,
      arguments: [],
      start: 0,
      end: 0,
    });
  }
  body.push({ kind: "load", id: 24, slot: 1, start: 0, end: 0 });
  const entry: FunctionIR["blocks"][number]["instructions"][number][] = [
    { kind: "constant", id: 0, value: 0, start: 0, end: 0 },
    { kind: "record-new", id: 1, record: 0, arguments: [0], start: 0, end: 0 },
    { kind: "store", slot: 1, value: 1, start: 0, end: 0 },
    { kind: "store", slot: 2, value: 0, start: 0, end: 0 },
  ];
  if (closure) {
    entry.push({ kind: "load", id: 2, slot: 1, start: 0, end: 0 });
    entry.push({
      kind: "record-new",
      id: 3,
      record: 1,
      arguments: [2],
      start: 0,
      end: 0,
    });
    entry.push({
      kind: "function-new",
      id: 4,
      target: 1,
      environment: 3,
      start: 0,
      end: 0,
    });
    entry.push({ kind: "store", slot: 4, value: 4, start: 0, end: 0 });
  }
  const main: FunctionIR = {
    id: 0,
    name: "count",
    exported: true,
    parameters: [0],
    slots: ["number", "reference", "number", "number", "reference"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: entry,
        terminator: { kind: "jump", target: 1, start: 0, end: 0 },
      },
      {
        // Proves the cell initialized before the loop.
        id: 1,
        instructions: [{ kind: "load", id: 10, slot: 1, start: 0, end: 0 }],
        terminator: {
          kind: "record-cell",
          object: 10,
          record: 0,
          field: 0,
          operation: "read",
          slot: 3,
          consequent: 8,
          alternate: 6,
          start: 0,
          end: 0,
        },
      },
      {
        id: 2,
        instructions: [
          { kind: "load", id: 11, slot: 2, start: 0, end: 0 },
          { kind: "load", id: 12, slot: 0, start: 0, end: 0 },
          {
            kind: "binary",
            id: 13,
            operator: "<",
            left: 11,
            right: 12,
            start: 0,
            end: 0,
          },
        ],
        terminator: {
          kind: "branch",
          condition: 13,
          consequent: 3,
          alternate: 5,
          start: 0,
          end: 0,
        },
      },
      {
        id: 3,
        instructions: body,
        terminator: {
          kind: "record-cell",
          object: 24,
          record: 0,
          field: 0,
          operation: "write",
          slot: 3,
          consequent: 4,
          alternate: 6,
          initialized: true,
          start: 0,
          end: 0,
        },
      },
      {
        id: 4,
        instructions: [
          { kind: "load", id: 30, slot: 2, start: 0, end: 0 },
          { kind: "constant", id: 31, value: 1, start: 0, end: 0 },
          {
            kind: "binary",
            id: 32,
            operator: "+",
            left: 30,
            right: 31,
            start: 0,
            end: 0,
          },
          { kind: "store", slot: 2, value: 32, start: 0, end: 0 },
          { kind: "load", id: 33, slot: 1, start: 0, end: 0 },
        ],
        terminator: {
          kind: "record-cell",
          object: 33,
          record: 0,
          field: 0,
          operation: "read",
          slot: 3,
          consequent: 2,
          alternate: 6,
          initialized: true,
          start: 0,
          end: 0,
        },
      },
      {
        id: 5,
        instructions: [{ kind: "load", id: 40, slot: 1, start: 0, end: 0 }],
        terminator: {
          kind: "record-cell",
          object: 40,
          record: 0,
          field: 0,
          operation: "read",
          slot: 3,
          consequent: 7,
          alternate: 6,
          initialized: true,
          start: 0,
          end: 0,
        },
      },
      {
        id: 6,
        instructions: [],
        terminator: { kind: "trap", start: 0, end: 0 },
      },
      {
        id: 7,
        instructions: [{ kind: "load", id: 50, slot: 3, start: 0, end: 0 }],
        terminator: { kind: "return", value: 50, start: 0, end: 0 },
      },
      // The loop preheader.
      {
        id: 8,
        instructions: [],
        terminator: { kind: "jump", target: 2, start: 0, end: 0 },
      },
    ],
  };
  const functions: FunctionIR[] = [main];
  // The closure over the cell: reads it through its environment.
  functions.push({
    id: 1,
    name: "peek",
    exported: false,
    parameters: [],
    slots: ["reference", "number"],
    returnType: "void",
    entry: 0,
    closureEnvironment: 1,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "closure-environment", id: 0, start: 0, end: 0 },
        ],
        terminator: {
          kind: "record",
          object: 0,
          record: 1,
          field: 0,
          operation: "read",
          slot: 0,
          consequent: 1,
          alternate: 3,
          start: 0,
          end: 0,
        },
      },
      {
        id: 1,
        instructions: [{ kind: "load", id: 1, slot: 0, start: 0, end: 0 }],
        terminator: {
          kind: "record-cell",
          object: 1,
          record: 0,
          field: 0,
          operation: "read",
          slot: 1,
          consequent: 2,
          alternate: 3,
          start: 0,
          end: 0,
        },
      },
      {
        id: 2,
        instructions: [],
        terminator: { kind: "return", value: undefined, start: 0, end: 0 },
      },
      {
        id: 3,
        instructions: [],
        terminator: { kind: "trap", start: 0, end: 0 },
      },
    ],
  });
  return {
    records: [
      {
        byteLength: 32,
        fields: [
          { offset: 24, stateOffset: 16, type: "number", mutable: true },
        ],
      },
      {
        byteLength: 32,
        fields: [{ offset: 16, type: "reference", mutable: false }],
      },
    ],
    functions,
  };
}

test("a local cell counted in a loop lives in a slot there and is written back at the exit", () => {
  const module = counter(false);
  assert.deepEqual(verify(module), { ok: true });
  const result = promoteLoopCells(module, 1000000);
  assert.ok(result);
  assert.equal(result.promoted, 1);
  const fn = result.module.functions[0]!;
  assert.deepEqual(verify(result.module), { ok: true });
  // The loop's accesses became copies: the cell is read once before the
  // loop and written once on the exit edge, besides the reads outside it.
  const writes = fn.blocks.filter(
    (b) =>
      b.terminator.kind === "record-cell" && b.terminator.operation === "write",
  );
  assert.equal(writes.length, 1);
  const reads = fn.blocks.filter(
    (b) =>
      b.terminator.kind === "record-cell" && b.terminator.operation === "read",
  );
  // The proving read, the entry read and the read after the loop.
  assert.equal(reads.length, 3);
});

test("a loop calling a closure over the cell keeps its cell accesses", () => {
  const module = counter(true);
  assert.deepEqual(verify(module), { ok: true });
  const result = promoteLoopCells(module, 1000000);
  assert.ok(result);
  assert.equal(result.promoted, 0);
  assert.equal(promoteLoopCells(module, 2), undefined);
});

/** sum(cell): adds 0, 1, ... while below the cell's value, which the loop
 * header (b1) reads with a state test on every iteration, unproven. b0 is
 * the preheader; b4 the read's failure: a trap or a throw. `copy` puts a
 * slot store in the header before the read. Slots: 0 cell, 1 i, 2 bound,
 * 3 sum, 4 copy. */
function headerRead(failure: "trap" | "throw", copy: boolean): ModuleIR {
  const header: FunctionIR["blocks"][number]["instructions"][number][] = [];
  if (copy) {
    header.push({ kind: "load", id: 9, slot: 1, start: 0, end: 0 });
    header.push({ kind: "store", slot: 4, value: 9, start: 0, end: 0 });
  }
  header.push({ kind: "load", id: 10, slot: 0, start: 0, end: 0 });
  const main: FunctionIR = {
    id: 0,
    name: "sum",
    exported: true,
    parameters: [0],
    slots: ["reference", "number", "number", "number", "number"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "constant", id: 0, value: 0, start: 0, end: 0 },
          { kind: "store", slot: 1, value: 0, start: 0, end: 0 },
          { kind: "store", slot: 3, value: 0, start: 0, end: 0 },
        ],
        terminator: { kind: "jump", target: 1, start: 0, end: 0 },
      },
      {
        id: 1,
        instructions: header,
        terminator: {
          kind: "record-cell",
          object: 10,
          record: 0,
          field: 0,
          operation: "read",
          slot: 2,
          consequent: 2,
          alternate: 4,
          start: 5,
          end: 9,
        },
      },
      {
        id: 2,
        instructions: [
          { kind: "load", id: 11, slot: 1, start: 0, end: 0 },
          { kind: "load", id: 12, slot: 2, start: 0, end: 0 },
          {
            kind: "binary",
            id: 13,
            operator: "<",
            left: 11,
            right: 12,
            start: 0,
            end: 0,
          },
        ],
        terminator: {
          kind: "branch",
          condition: 13,
          consequent: 3,
          alternate: 5,
          start: 0,
          end: 0,
        },
      },
      {
        id: 3,
        instructions: [
          { kind: "load", id: 20, slot: 3, start: 0, end: 0 },
          { kind: "load", id: 21, slot: 1, start: 0, end: 0 },
          {
            kind: "binary",
            id: 22,
            operator: "+",
            left: 20,
            right: 21,
            start: 0,
            end: 0,
          },
          { kind: "store", slot: 3, value: 22, start: 0, end: 0 },
          { kind: "constant", id: 23, value: 1, start: 0, end: 0 },
          {
            kind: "binary",
            id: 24,
            operator: "+",
            left: 21,
            right: 23,
            start: 0,
            end: 0,
          },
          { kind: "store", slot: 1, value: 24, start: 0, end: 0 },
        ],
        terminator: { kind: "jump", target: 1, start: 0, end: 0 },
      },
      {
        id: 4,
        instructions: [],
        terminator:
          failure === "trap"
            ? { kind: "trap", start: 0, end: 0 }
            : {
                kind: "throw-literal",
                value: "uninitialized",
                start: 0,
                end: 0,
              },
      },
      {
        id: 5,
        instructions: [{ kind: "load", id: 30, slot: 3, start: 0, end: 0 }],
        terminator: { kind: "return", value: 30, start: 0, end: 0 },
      },
    ],
  };
  return {
    records: [
      {
        byteLength: 32,
        fields: [
          { offset: 24, stateOffset: 16, type: "number", mutable: true },
        ],
      },
    ],
    functions: [main],
  };
}

test("an unproven read heading every iteration is taken over by one checked entry read", () => {
  for (const [failure, copy] of [
    ["throw", false],
    ["trap", false],
    // Slot stores before the read are unobservable when the read traps.
    ["trap", true],
  ] as const) {
    const module = headerRead(failure, copy);
    assert.deepEqual(verify(module), { ok: true });
    const result = promoteLoopCells(module, 1000000);
    assert.ok(result);
    assert.equal(result.promoted, 1, failure + " " + String(copy));
    assert.deepEqual(verify(result.module), { ok: true });
    const fn = result.module.functions[0]!;
    const reads = fn.blocks.filter((b) => b.terminator.kind === "record-cell");
    // Only the preheader reads the cell, keeping the state test and the
    // failure edge of the header's read.
    assert.equal(reads.length, 1);
    const read = reads[0]!.terminator;
    assert.ok(read.kind === "record-cell");
    assert.notEqual(read.initialized, true);
    assert.equal(reads[0]!.id, 0);
    const target = fn.blocks[read.alternate]!;
    assert.equal(
      target.terminator.kind,
      failure === "trap" ? "trap" : "throw-literal",
    );
    assert.equal(read.start, 5);
  }
});

test("an unproven header read after observable work stays in the loop", () => {
  // The header stores a slot before the read; a failure path that does
  // not trap may run code reading that slot.
  const module = headerRead("throw", true);
  assert.deepEqual(verify(module), { ok: true });
  const result = promoteLoopCells(module, 1000000);
  assert.ok(result);
  assert.equal(result.promoted, 0);
});
