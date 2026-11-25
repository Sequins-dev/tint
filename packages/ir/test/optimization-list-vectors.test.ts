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

/** Does nothing with its parameter. */
function noop(id: number, parameters: number): FunctionIR {
  const slots: FunctionIR["slots"][number][] = ["reference"];
  for (let index = 1; index < parameters; index++) slots.push("number");
  return {
    id,
    name: "noop" + String(id),
    exported: false,
    parameters: slots.map((_, index) => index),
    slots,
    returnType: "void",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [],
        terminator: { kind: "return", value: undefined, ...s },
      },
    ],
  };
}

/** Passes closures over `passed` (with its list parameter) to `loop`, and
 * takes the address of `created` (closures used nowhere) and `entry` (raw
 * entry addresses). */
function addresses(
  id: number,
  loop: number,
  passed: readonly number[],
  created: readonly number[],
  entry: readonly number[] = [],
): FunctionIR {
  const instructions: Instruction[] = [{ kind: "load", id: 0, slot: 0, ...s }];
  let next = 1;
  for (const target of passed) {
    instructions.push({ kind: "function-new", id: next, target, ...s });
    instructions.push({
      kind: "call",
      id: undefined,
      target: loop,
      arguments: [0, next++],
      ...s,
    });
  }
  for (const target of created)
    instructions.push({ kind: "function-new", id: next++, target, ...s });
  for (const target of entry)
    instructions.push({
      kind: "function-address",
      id: next++,
      target,
      part: "entry",
      ...s,
    });
  return {
    id,
    name: "addresses" + String(id),
    exported: true,
    parameters: [0],
    slots: ["reference"],
    returnType: "void",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions,
        terminator: { kind: "return", value: undefined, ...s },
      },
    ],
  };
}

/** The loop of `loop`, calling the function value in its second parameter
 * with `witness` as the indirect call's signature witness. */
function indirectLoop(id: number, read: number, witness: number): FunctionIR {
  const direct = loop(id, read, witness),
    blocks = direct.blocks.slice(),
    site = blocks[3];
  assert.ok(site !== undefined);
  blocks[3] = {
    ...site,
    instructions: [
      { kind: "load", id: 9, slot: 1, ...s },
      { kind: "load", id: 13, slot: 0, ...s },
      {
        kind: "call-indirect",
        id: undefined,
        target: witness,
        callee: 9,
        arguments: [13],
        ...s,
      },
    ],
  };
  return { ...direct, blocks };
}

/** The list-vector refreshes in the indirect loop (function 4) of: a reader
 * (0), a header writer (1, signature (reference) => void), a no-op witness
 * (2) with that signature or (`otherSignature`) an extra number parameter,
 * and the function (3) passing the no-op to the loop, and the writer too
 * when it is `passed`, else taking its address. */
function indirectRefreshes(
  closedCalls: boolean,
  writes: "passed" | "created" | "entry" | "unused",
  otherSignature: boolean,
): number {
  const functions: FunctionIR[] = [
    reader(0, 0),
    writer(1, 0),
    noop(2, otherSignature ? 2 : 1),
    addresses(
      3,
      4,
      writes === "passed" ? [2, 1] : [2],
      writes === "created" ? [1] : [],
      writes === "entry" ? [1] : [],
    ),
  ];
  const fn = indirectLoop(4, 0, 2);
  if (otherSignature) {
    // Pass the extra number argument the witness takes.
    const blocks = fn.blocks.slice(),
      site = blocks[3];
    assert.ok(site !== undefined);
    const instructions = site.instructions.slice(),
      call = instructions[2];
    assert.ok(call?.kind === "call-indirect");
    instructions.splice(
      2,
      1,
      { kind: "constant", id: 14, value: 1, ...s },
      {
        ...call,
        arguments: [13, 14],
      },
    );
    blocks[3] = { ...site, instructions };
    functions.push({ ...fn, blocks });
  } else functions.push(fn);
  const result = cacheListVectors(
    { functions },
    Number.MAX_SAFE_INTEGER,
    closedCalls,
  );
  assert.ok(result !== undefined);
  assert.equal(result.rewritten, 1);
  // One vector read ahead of the loop, plus one per refresh.
  return (
    calls(
      result.module.functions[4],
      "__tint_reference_list_vector$",
      result.module,
    ).length - 1
  );
}

test("indirect calls refresh cached lists only when a target may write the header", () => {
  // Without the closed-calls contract an indirect call may reach every
  // address-taken function, the header writer among them.
  assert.equal(indirectRefreshes(false, "created", false), 1);
  assert.equal(indirectRefreshes(false, "unused", false), 0);
  // A closed program: the writer shares the witness's signature but never
  // reaches the call.
  assert.equal(indirectRefreshes(true, "created", false), 0);
  // The writer reaches the call.
  assert.equal(indirectRefreshes(true, "passed", false), 1);
  // It reaches the call, but its signature differs from the witness's: the
  // call would trap instead.
  assert.equal(indirectRefreshes(true, "passed", true), 0);
  // An exposed entry address may be paired with any signature and value.
  assert.equal(indirectRefreshes(true, "entry", true), 1);
});

test("an indirect call that may write the header on every iteration keeps ordinary reads", () => {
  const always = indirectLoop(4, 0, 2),
    blocks = always.blocks.slice(),
    body = blocks[2];
  assert.ok(body !== undefined);
  blocks[2] = { ...body, terminator: { kind: "jump", target: 3, ...s } };
  const functions: FunctionIR[] = [
    reader(0, 0),
    writer(1, 0),
    noop(2, 1),
    addresses(3, 4, [1, 2], []),
    { ...always, blocks },
  ];
  const result = cacheListVectors({ functions }, Number.MAX_SAFE_INTEGER, true);
  assert.equal(result?.rewritten, 0);
});

test("cached list vectors cover optional-string dense list readers", () => {
  const base = reader(0, 0),
    stringReader: FunctionIR = {
      ...base,
      returnType: "optional-string",
      blocks: [
        base.blocks[0]!,
        {
          id: 1,
          instructions: [
            { kind: "load", id: 1, slot: 2, ...s },
            { kind: "binary", id: 2, operator: "===", left: 1, right: 1, ...s },
            { kind: "string-none", id: 3, ...s },
          ],
          terminator: { kind: "return", value: 3, ...s },
        },
      ],
    };
  const functions: FunctionIR[] = [stringReader, noop(1, 1), loop(2, 0, 1)];
  const result = cacheListVectors({ functions }, Number.MAX_SAFE_INTEGER);
  assert.ok(result !== undefined);
  assert.equal(result.rewritten, 1);
  const readCalls = calls(
    result.module.functions[2],
    "__tint_reference_list_readv$",
    result.module,
  );
  assert.equal(readCalls.length, 1);
  const cachedFn =
    readCalls[0]?.kind === "call"
      ? result.module.functions[readCalls[0].target]
      : undefined;
  assert.equal(cachedFn?.returnType, "optional-string");
});

test("cached list vectors hoist proven length reads for unmodified headers", () => {
  const fn: FunctionIR = {
    id: 2,
    name: "loopWithLength",
    exported: false,
    parameters: [],
    slots: ["reference", "number", "number"],
    returnType: "void",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "constant", id: 0, value: 0, ...s },
          { kind: "reference-none", id: 11, ...s },
          { kind: "record-new", id: 12, record: 0, arguments: [0, 11], ...s },
          { kind: "store", slot: 0, value: 12, ...s },
          { kind: "store", slot: 1, value: 0, ...s },
        ],
        terminator: { kind: "jump", target: 1, ...s },
      },
      {
        id: 1,
        instructions: [{ kind: "load", id: 1, slot: 0, ...s }],
        terminator: {
          kind: "record",
          object: 1,
          record: 0,
          field: 0,
          operation: "read",
          slot: 2,
          consequent: 2,
          alternate: 4,
          ...s,
        },
      },
      {
        id: 2,
        instructions: [
          { kind: "load", id: 2, slot: 2, ...s },
          { kind: "unary", id: 3, operator: "uint32", operand: 2, ...s },
          { kind: "load", id: 4, slot: 1, ...s },
          { kind: "binary", id: 5, operator: "<", left: 4, right: 3, ...s },
        ],
        terminator: {
          kind: "branch",
          condition: 5,
          consequent: 3,
          alternate: 5,
          ...s,
        },
      },
      {
        id: 3,
        instructions: [
          { kind: "load", id: 6, slot: 0, ...s },
          { kind: "load", id: 7, slot: 1, ...s },
          { kind: "call", id: 8, target: 0, arguments: [6, 7], ...s },
          { kind: "constant", id: 9, value: 1, ...s },
          { kind: "binary", id: 10, operator: "+", left: 7, right: 9, ...s },
          { kind: "store", slot: 1, value: 10, ...s },
        ],
        terminator: { kind: "jump", target: 1, ...s },
      },
      {
        id: 4,
        instructions: [],
        terminator: { kind: "trap", ...s },
      },
      {
        id: 5,
        instructions: [],
        terminator: { kind: "return", value: undefined, ...s },
      },
    ],
  };
  const result = cacheListVectors(
    { functions: [reader(0, 0), noop(1, 0), fn] },
    Number.MAX_SAFE_INTEGER,
  );
  assert.ok(result !== undefined);
  assert.equal(result.rewritten, 2);
  const rewritten = result.module.functions[2];
  assert.ok(rewritten !== undefined);
  assert.equal(rewritten.blocks[1]?.terminator.kind, "branch");
  assert.ok(
    calls(rewritten, "__tint_list_length$", result.module).length === 1,
  );
  assert.ok((rewritten.integerSlots?.length ?? 0) === 1);
  // No unary:uint32 remains inside block 2: replaced with a direct load of the hoisted integer slot.
  assert.ok(
    !rewritten.blocks[2]?.instructions.some(
      (op) => op?.kind === "unary" && op.operator === "uint32",
    ),
  );
});
