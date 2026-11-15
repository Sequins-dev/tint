import assert from "node:assert/strict";
import test from "node:test";
import type { FunctionIR, Instruction, ModuleIR } from "@tint/ir/scalar";
import { cacheListVectors } from "../src/optimization/list-vectors.ts";
const s = { start: 0, end: 0 };

// The pass recognizes dense readers by name and shape: the entry reads the
// header's root (field 1) and a later block tests for a stored undefined.
function reader(id: number, header: number): FunctionIR {
  return {
    id,
    name: "__tint_reference_list_read$" + String(id),
    exported: false,
    parameters: [0, 1],
    slots: ["reference", "number", "optional-reference"],
    returnType: "optional-reference",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [{ kind: "load", id: 0, slot: 0, ...s }],
        terminator: {
          kind: "record",
          object: 0,
          record: header,
          field: 1,
          operation: "read",
          slot: 2,
          consequent: 1,
          alternate: 1,
          ...s,
        },
      },
      {
        id: 1,
        instructions: [
          { kind: "load", id: 1, slot: 2, ...s },
          { kind: "binary", id: 2, operator: "===", left: 1, right: 1, ...s },
          { kind: "reference-none", id: 3, ...s },
        ],
        terminator: { kind: "return", value: 3, ...s },
      },
    ],
  };
}

/** Writes the root of a list with header record `header`. */
function writer(id: number, header: number): FunctionIR {
  return {
    id,
    name: "write" + String(id),
    exported: false,
    parameters: [0],
    slots: ["reference", "optional-reference"],
    returnType: "void",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "load", id: 0, slot: 0, ...s },
          { kind: "reference-none", id: 1, ...s },
          { kind: "store", slot: 1, value: 1, ...s },
        ],
        terminator: {
          kind: "record",
          object: 0,
          record: header,
          field: 1,
          operation: "write",
          slot: 1,
          consequent: 1,
          alternate: 1,
          ...s,
        },
      },
      {
        id: 1,
        instructions: [],
        terminator: { kind: "return", value: undefined, ...s },
      },
    ],
  };
}

/** Calls `callee` with its parameter. */
function forwarder(id: number, callee: number): FunctionIR {
  return {
    id,
    name: "forward" + String(id),
    exported: false,
    parameters: [0],
    slots: ["reference"],
    returnType: "void",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "load", id: 0, slot: 0, ...s },
          { kind: "call", id: undefined, target: callee, arguments: [0], ...s },
        ],
        terminator: { kind: "return", value: undefined, ...s },
      },
    ],
  };
}

/** for (i = 0; i < 10; i++) { list[i]; if (i === 3) call(other) } */
function loop(id: number, read: number, call: number): FunctionIR {
  return {
    id,
    name: "loop" + String(id),
    exported: false,
    parameters: [0, 1],
    slots: ["reference", "reference", "number"],
    returnType: "void",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "constant", id: 0, value: 0, ...s },
          { kind: "store", slot: 2, value: 0, ...s },
        ],
        terminator: { kind: "jump", target: 1, ...s },
      },
      {
        id: 1,
        instructions: [
          { kind: "load", id: 1, slot: 2, ...s },
          { kind: "constant", id: 2, value: 10, ...s },
          { kind: "binary", id: 3, operator: "<", left: 1, right: 2, ...s },
        ],
        terminator: {
          kind: "branch",
          condition: 3,
          consequent: 2,
          alternate: 5,
          ...s,
        },
      },
      {
        id: 2,
        instructions: [
          { kind: "load", id: 4, slot: 0, ...s },
          { kind: "load", id: 5, slot: 2, ...s },
          { kind: "call", id: 6, target: read, arguments: [4, 5], ...s },
          { kind: "constant", id: 7, value: 3, ...s },
          { kind: "binary", id: 8, operator: "===", left: 5, right: 7, ...s },
        ],
        terminator: {
          kind: "branch",
          condition: 8,
          consequent: 3,
          alternate: 4,
          ...s,
        },
      },
      {
        id: 3,
        instructions: [
          { kind: "load", id: 9, slot: 1, ...s },
          { kind: "call", id: undefined, target: call, arguments: [9], ...s },
        ],
        terminator: { kind: "jump", target: 4, ...s },
      },
      {
        id: 4,
        instructions: [
          { kind: "load", id: 10, slot: 2, ...s },
          { kind: "constant", id: 11, value: 1, ...s },
          { kind: "binary", id: 12, operator: "+", left: 10, right: 11, ...s },
          { kind: "store", slot: 2, value: 12, ...s },
        ],
        terminator: { kind: "jump", target: 1, ...s },
      },
      {
        id: 5,
        instructions: [],
        terminator: { kind: "return", value: undefined, ...s },
      },
    ],
  };
}

function calls(
  fn: FunctionIR | undefined,
  prefix: string,
  module: ModuleIR,
): Instruction[] {
  const found: Instruction[] = [];
  for (const block of fn?.blocks ?? [])
    for (const op of block.instructions)
      if (
        op.kind === "call" &&
        module.functions[op.target]?.name.startsWith(prefix)
      )
        found.push(op);
  return found;
}

test("cached list vectors refresh only after calls that may write that header", () => {
  // 33 header records: header 31 sets the sign bit of the first mask word,
  // which the call-graph summary must still propagate to a fixed point.
  const functions: FunctionIR[] = [];
  for (let header = 0; header < 33; header++)
    functions.push(reader(functions.length, header));
  const writes31 = functions.length;
  functions.push(writer(writes31, 31));
  const forwards31 = functions.length;
  functions.push(forwarder(forwards31, writes31));
  const unrelated = functions.length;
  functions.push(loop(unrelated, 0, forwards31));
  const related = functions.length;
  functions.push(loop(related, 31, forwards31));
  const module: ModuleIR = { functions };
  const result = cacheListVectors(module, Number.MAX_SAFE_INTEGER);
  assert.ok(result !== undefined);
  assert.equal(result.rewritten, 2);
  const out = result.module;
  // Both loops read through the cached vector.
  for (const id of [unrelated, related])
    assert.equal(
      calls(out.functions[id], "__tint_reference_list_readv$", out).length,
      1,
    );
  // A call that writes only header 31 leaves header 0's cache alone: its
  // only vector read is ahead of the loop.
  assert.equal(
    calls(out.functions[unrelated], "__tint_reference_list_vector$", out)
      .length,
    1,
  );
  // Header 31's cache is refreshed right after the call.
  const fn = out.functions[related];
  assert.equal(calls(fn, "__tint_reference_list_vector$", out).length, 2);
  const site = fn?.blocks[3]?.instructions ?? [];
  assert.equal(site[1]?.kind === "call" && site[1].target, forwards31);
  const refresh = site.slice(2).map((op) => op.kind);
  assert.deepEqual(refresh, ["load", "reference-wrap", "call", "store"]);
});

test("loops that write a cached header on every iteration keep ordinary reads", () => {
  const functions: FunctionIR[] = [reader(0, 0), writer(1, 0)];
  const always: FunctionIR = loop(2, 0, 1);
  // Make the write unconditional: block 2 always continues to block 3.
  const blocks = always.blocks.slice();
  const body = blocks[2];
  assert.ok(body !== undefined);
  blocks[2] = { ...body, terminator: { kind: "jump", target: 3, ...s } };
  functions.push({ ...always, blocks });
  const result = cacheListVectors({ functions }, Number.MAX_SAFE_INTEGER);
  assert.equal(result?.rewritten, 0);
});
