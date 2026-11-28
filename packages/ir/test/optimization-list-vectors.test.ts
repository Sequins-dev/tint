import assert from "node:assert/strict";
import test from "node:test";
import { verify } from "@tint/ir/scalar";
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
  assert.ok(result.rewritten >= 2);
  const rewritten = result.module.functions[2];
  assert.ok(rewritten !== undefined);
  assert.equal(rewritten.blocks[1]?.terminator.kind, "jump");
  assert.equal(rewritten.blocks[0]?.terminator.kind, "record");
  assert.ok((rewritten.integerSlots?.length ?? 0) === 1);
  // No unary:uint32 remains inside block 2: replaced with a direct load of the hoisted integer slot.
  assert.ok(
    !rewritten.blocks[2]?.instructions.some(
      (op) => op?.kind === "unary" && op.operator === "uint32",
    ),
  );
});

test("loop-invariant header length read and uint32 conversion hoist when header is unwritten", () => {
  // Loop header reads field 0 (length) of list header 0, block 2 converts via
  // uint32 and tests i < length, block 3 reads list[i] and increments i.
  const makeLoop = (id: number, withWrite: boolean): FunctionIR => ({
    id,
    name: "lenLoop" + String(id),
    exported: true,
    parameters: [0],
    slots: ["reference", "number", "number"], // 0: list, 1: i, 2: len
    returnType: "void",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "constant", id: 0, value: 0, ...s },
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
          alternate: 5,
          ...s,
        },
      },
      {
        id: 2,
        instructions: [
          { kind: "load", id: 2, slot: 1, ...s },
          { kind: "load", id: 3, slot: 2, ...s },
          { kind: "unary", id: 4, operator: "uint32", operand: 3, ...s },
          { kind: "binary", id: 5, operator: "<", left: 2, right: 4, ...s },
        ],
        terminator: {
          kind: "branch",
          condition: 5,
          consequent: 3,
          alternate: 4,
          ...s,
        },
      },
      {
        id: 3,
        instructions: [
          { kind: "load", id: 6, slot: 0, ...s },
          { kind: "load", id: 7, slot: 1, ...s },
          { kind: "call", id: 8, target: 0, arguments: [6, 7], ...s },
          ...(withWrite
            ? [
                { kind: "constant" as const, id: 12, value: 3, ...s },
                {
                  kind: "binary" as const,
                  id: 13,
                  operator: "===" as const,
                  left: 7,
                  right: 12,
                  ...s,
                },
              ]
            : [
                { kind: "constant" as const, id: 9, value: 1, ...s },
                {
                  kind: "binary" as const,
                  id: 10,
                  operator: "+" as const,
                  left: 7,
                  right: 9,
                  ...s,
                },
                { kind: "store" as const, slot: 1, value: 10, ...s },
              ]),
        ],
        terminator: withWrite
          ? { kind: "branch", condition: 13, consequent: 6, alternate: 7, ...s }
          : { kind: "jump", target: 1, ...s },
      },
      {
        id: 4,
        instructions: [],
        terminator: { kind: "return", value: undefined, ...s },
      },
      { id: 5, instructions: [], terminator: { kind: "trap", ...s } },
      ...(withWrite
        ? [
            {
              id: 6,
              instructions: [
                { kind: "load" as const, id: 14, slot: 0, ...s },
                {
                  kind: "call" as const,
                  id: undefined,
                  target: 1,
                  arguments: [14],
                  ...s,
                },
              ],
              terminator: { kind: "jump" as const, target: 7, ...s },
            },
            {
              id: 7,
              instructions: [
                { kind: "load" as const, id: 15, slot: 1, ...s },
                { kind: "constant" as const, id: 16, value: 1, ...s },
                {
                  kind: "binary" as const,
                  id: 17,
                  operator: "+" as const,
                  left: 15,
                  right: 16,
                  ...s,
                },
                { kind: "store" as const, slot: 1, value: 17, ...s },
              ],
              terminator: { kind: "jump" as const, target: 1, ...s },
            },
          ]
        : []),
    ],
  });
  const records = [
    {
      byteLength: 24,
      fields: [
        { offset: 8, type: "number" as const, mutable: true },
        { offset: 16, type: "optional-reference" as const, mutable: true },
      ],
    },
  ];
  const ro = cacheListVectors(
    { records, functions: [reader(0, 0), writer(1, 0), makeLoop(2, false)] },
    Number.MAX_SAFE_INTEGER,
  );
  assert.ok(ro !== undefined);
  const roFn = ro.module.functions[2]!;
  // Header block 1 no longer reads field 0; preheader 0 does, and block 2 reads
  // the hoisted uint32 slot instead of running unary:uint32 every iteration.
  assert.equal(roFn.blocks[1]?.terminator.kind, "jump");
  assert.equal(roFn.blocks[0]?.terminator.kind, "record");
  assert.ok(
    !roFn.blocks[2]?.instructions.some(
      (op) => op.kind === "unary" && op.operator === "uint32",
    ),
  );
  // When the loop may write header 0 on some path, length stays in header 1.
  const rw = cacheListVectors(
    { records, functions: [reader(0, 0), writer(1, 0), makeLoop(2, true)] },
    Number.MAX_SAFE_INTEGER,
  );
  assert.ok(rw !== undefined);
  assert.equal(rw.module.functions[2]?.blocks[1]?.terminator.kind, "record");
  // Preheader-guarded unchecked list reads fire for the read-only loop (i < len
  // starting at 0, reading list[i]), and NOT for the header-writing loop.
  assert.ok(
    ro.module.functions.some((f) =>
      f.name.startsWith("__tint_reference_list_readu$"),
    ),
  );
  assert.ok(
    !rw.module.functions.some((f) =>
      f.name.startsWith("__tint_reference_list_readu$"),
    ),
  );
});

test("preheader-guarded unchecked reads handle i-1 with start=1 and reject i-2", () => {
  const makeShiftLoop = (startVal: number, subOffset: number): FunctionIR => ({
    id: 1,
    name: "shiftLoop",
    exported: true,
    parameters: [0],
    slots: ["reference", "number", "number"],
    returnType: "void",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "constant", id: 0, value: startVal, ...s },
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
          alternate: 5,
          ...s,
        },
      },
      {
        id: 2,
        instructions: [
          { kind: "load", id: 2, slot: 1, ...s },
          { kind: "load", id: 3, slot: 2, ...s },
          { kind: "unary", id: 4, operator: "uint32", operand: 3, ...s },
          { kind: "binary", id: 5, operator: "<", left: 2, right: 4, ...s },
        ],
        terminator: {
          kind: "branch",
          condition: 5,
          consequent: 3,
          alternate: 4,
          ...s,
        },
      },
      {
        id: 3,
        instructions: [
          { kind: "load", id: 6, slot: 0, ...s },
          { kind: "load", id: 7, slot: 1, ...s },
          { kind: "constant", id: 8, value: subOffset, ...s },
          { kind: "binary", id: 9, operator: "-", left: 7, right: 8, ...s },
          { kind: "call", id: 10, target: 0, arguments: [6, 9], ...s },
          { kind: "constant", id: 11, value: 1, ...s },
          { kind: "binary", id: 12, operator: "+", left: 7, right: 11, ...s },
          { kind: "store", slot: 1, value: 12, ...s },
        ],
        terminator: { kind: "jump", target: 1, ...s },
      },
      {
        id: 4,
        instructions: [],
        terminator: { kind: "return", value: undefined, ...s },
      },
      { id: 5, instructions: [], terminator: { kind: "trap", ...s } },
    ],
  });
  const records = [
    {
      byteLength: 24,
      fields: [
        { offset: 8, type: "number" as const, mutable: true },
        { offset: 16, type: "optional-reference" as const, mutable: true },
      ],
    },
  ];
  const valid = cacheListVectors(
    { records, functions: [reader(0, 0), makeShiftLoop(1, 1)] },
    Number.MAX_SAFE_INTEGER,
  );
  assert.ok(valid !== undefined);
  assert.ok(
    valid.module.functions.some((f) =>
      f.name.startsWith("__tint_reference_list_readu$"),
    ),
  );
  const outOfRange = cacheListVectors(
    { records, functions: [reader(0, 0), makeShiftLoop(1, 2)] },
    Number.MAX_SAFE_INTEGER,
  );
  assert.ok(outOfRange !== undefined);
  assert.ok(
    !outOfRange.module.functions.some((f) =>
      f.name.startsWith("__tint_reference_list_readu$"),
    ),
  );
});

test("counted push loops pre-size fresh lists and omit growth check only when step is unconditional", () => {
  const records = [
    {
      byteLength: 24,
      fields: [
        { offset: 8, type: "number" as const, mutable: true },
        { offset: 16, type: "optional-reference" as const, mutable: true },
      ],
    },
  ];
  const denseWriter = (id: number): FunctionIR => ({
    id,
    name: "__tint_reference_list_write$" + String(id),
    exported: false,
    parameters: [0, 1, 2],
    slots: ["reference", "number", "optional-reference"],
    returnType: "void",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "load", id: 0, slot: 0, ...s },
          { kind: "load", id: 1, slot: 1, ...s },
          { kind: "load", id: 2, slot: 2, ...s },
          {
            kind: "reference-vector-write",
            vector: 0,
            index: 1,
            value: 2,
            ...s,
          },
        ],
        terminator: {
          kind: "record",
          object: 0,
          record: 0,
          field: 0,
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
  });
  const makePushLoop = (conditionalStep: boolean): FunctionIR => ({
    id: 1,
    name: conditionalStep ? "pushCondStep" : "pushExact",
    exported: true,
    parameters: [0, 1],
    slots: ["optional-reference", "boolean", "reference", "number", "number"],
    returnType: "reference",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "constant", id: 0, value: 0, ...s },
          { kind: "reference-none", id: 1, ...s },
          { kind: "record-new", id: 2, record: 0, arguments: [0, 1], ...s },
          { kind: "store", slot: 2, value: 2, ...s },
          { kind: "store", slot: 3, value: 0, ...s },
        ],
        terminator: { kind: "jump", target: 1, ...s },
      },
      {
        id: 1,
        instructions: [
          { kind: "load", id: 3, slot: 3, ...s },
          { kind: "constant", id: 4, value: 256, ...s },
          { kind: "binary", id: 5, operator: "<", left: 3, right: 4, ...s },
        ],
        terminator: {
          kind: "branch",
          condition: 5,
          consequent: 2,
          alternate: 5,
          ...s,
        },
      },
      {
        id: 2,
        instructions: [{ kind: "load", id: 6, slot: 2, ...s }],
        terminator: {
          kind: "record",
          object: 6,
          record: 0,
          field: 0,
          operation: "read",
          slot: 4,
          consequent: 3,
          alternate: 6,
          ...s,
        },
      },
      {
        id: 3,
        instructions: [
          { kind: "load", id: 7, slot: 2, ...s },
          { kind: "load", id: 8, slot: 4, ...s },
          { kind: "load", id: 9, slot: 0, ...s },
          {
            kind: "call",
            id: undefined,
            target: 0,
            arguments: [7, 8, 9],
            ...s,
          },
          ...(conditionalStep
            ? [{ kind: "load" as const, id: 10, slot: 1, ...s }]
            : []),
        ],
        terminator: conditionalStep
          ? {
              kind: "branch",
              condition: 10,
              consequent: 4,
              alternate: 1,
              ...s,
            }
          : { kind: "jump", target: 4, ...s },
      },
      {
        id: 4,
        instructions: [
          { kind: "load", id: 11, slot: 3, ...s },
          { kind: "constant", id: 12, value: 1, ...s },
          { kind: "binary", id: 13, operator: "+", left: 11, right: 12, ...s },
          { kind: "store", slot: 3, value: 13, ...s },
        ],
        terminator: { kind: "jump", target: 1, ...s },
      },
      {
        id: 5,
        instructions: [{ kind: "load", id: 14, slot: 2, ...s }],
        terminator: { kind: "return", value: 14, ...s },
      },
      { id: 6, instructions: [], terminator: { kind: "trap", ...s } },
    ],
  });

  const exactRes = cacheListVectors(
    { records, functions: [denseWriter(0), makePushLoop(false)] },
    Number.MAX_SAFE_INTEGER,
  );
  assert.ok(exactRes !== undefined && exactRes.rewritten > 0);
  assert.equal(verify(exactRes.module).ok, true);
  const exactFn = exactRes.module.functions[1]!;
  const exactInsts = exactFn.blocks.flatMap((b) => b.instructions);
  assert.ok(
    exactInsts.some((op) => op.kind === "reference-vector-new"),
    "exact counted push loop should pre-allocate its vector",
  );
  assert.ok(
    exactInsts.some((op) => op.kind === "call" && op.target !== 0),
    "exact counted push loop should call the unchecked writer",
  );
  assert.ok(
    !exactInsts.some((op) => op.kind === "call" && op.target === 0),
    "exact counted push loop should omit the slow growth call",
  );

  const condRes = cacheListVectors(
    { records, functions: [denseWriter(0), makePushLoop(true)] },
    Number.MAX_SAFE_INTEGER,
  );
  assert.ok(condRes !== undefined && condRes.rewritten > 0);
  assert.equal(verify(condRes.module).ok, true);
  const condFn = condRes.module.functions[1]!;
  const condInsts = condFn.blocks.flatMap((b) => b.instructions);
  assert.ok(
    condInsts.some((op) => op.kind === "reference-vector-new"),
    "conditional-step loop should still pre-allocate its vector",
  );
  assert.ok(
    condInsts.some((op) => op.kind === "call" && op.target === 0),
    "conditional-step loop must retain the slow growth fallback",
  );
});

test("nested read-only dense list loops peel hasSlot and emit preheader-guarded unchecked reads", () => {
  // Outer loop: for (round = 0; round < 10; round++)
  // Inner loop: for (i = 1; i < list.length; i++) { list[i - 1]; list[i]; }
  const records = [
    {
      byteLength: 24,
      fields: [
        { offset: 8, type: "number" as const, mutable: true },
        { offset: 16, type: "optional-reference" as const, mutable: true },
      ],
    },
  ];
  const nestedFn: FunctionIR = {
    id: 1,
    name: "nestedReads",
    exported: true,
    parameters: [0],
    // 0: list, 1: round, 2: i, 3: len
    slots: ["reference", "number", "number", "number"],
    returnType: "void",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "constant", id: 0, value: 0, ...s },
          { kind: "store", slot: 1, value: 0, ...s },
        ],
        terminator: { kind: "jump", target: 1, ...s },
      },
      {
        id: 1,
        instructions: [
          { kind: "load", id: 1, slot: 1, ...s },
          { kind: "constant", id: 2, value: 10, ...s },
          { kind: "binary", id: 3, operator: "<", left: 1, right: 2, ...s },
        ],
        terminator: {
          kind: "branch",
          condition: 3,
          consequent: 2,
          alternate: 7,
          ...s,
        },
      },
      {
        id: 2,
        instructions: [
          { kind: "constant", id: 4, value: 1, ...s },
          { kind: "store", slot: 2, value: 4, ...s },
        ],
        terminator: { kind: "jump", target: 3, ...s },
      },
      {
        id: 3,
        instructions: [{ kind: "load", id: 5, slot: 0, ...s }],
        terminator: {
          kind: "record",
          object: 5,
          record: 0,
          field: 0,
          operation: "read",
          slot: 3,
          consequent: 4,
          alternate: 8,
          ...s,
        },
      },
      {
        id: 4,
        instructions: [
          { kind: "load", id: 6, slot: 2, ...s },
          { kind: "load", id: 7, slot: 3, ...s },
          { kind: "unary", id: 8, operator: "uint32", operand: 7, ...s },
          { kind: "binary", id: 9, operator: "<", left: 6, right: 8, ...s },
        ],
        terminator: {
          kind: "branch",
          condition: 9,
          consequent: 5,
          alternate: 6,
          ...s,
        },
      },
      {
        id: 5,
        instructions: [
          { kind: "load", id: 10, slot: 0, ...s },
          { kind: "load", id: 11, slot: 2, ...s },
          { kind: "constant", id: 12, value: 1, ...s },
          { kind: "binary", id: 13, operator: "-", left: 11, right: 12, ...s },
          { kind: "call", id: 14, target: 0, arguments: [10, 13], ...s },
          { kind: "call", id: 15, target: 0, arguments: [10, 11], ...s },
          { kind: "binary", id: 16, operator: "+", left: 11, right: 12, ...s },
          { kind: "store", slot: 2, value: 16, ...s },
        ],
        terminator: { kind: "jump", target: 3, ...s },
      },
      {
        id: 6,
        instructions: [
          { kind: "load", id: 17, slot: 1, ...s },
          { kind: "constant", id: 18, value: 1, ...s },
          { kind: "binary", id: 19, operator: "+", left: 17, right: 18, ...s },
          { kind: "store", slot: 1, value: 19, ...s },
        ],
        terminator: { kind: "jump", target: 1, ...s },
      },
      {
        id: 7,
        instructions: [],
        terminator: { kind: "return", value: undefined, ...s },
      },
      { id: 8, instructions: [], terminator: { kind: "trap", ...s } },
    ],
  };
  const validReader: FunctionIR = {
    ...reader(0, 0),
    blocks: [
      {
        ...reader(0, 0).blocks[0]!,
        terminator: {
          kind: "record",
          object: 0,
          record: 0,
          field: 1,
          operation: "read",
          slot: 2,
          consequent: 1,
          alternate: 2,
          ...s,
        },
      },
      reader(0, 0).blocks[1]!,
      { id: 2, instructions: [], terminator: { kind: "trap", ...s } },
    ],
  };
  assert.equal(
    verify({ records, functions: [validReader, nestedFn] }).ok,
    true,
  );
  const res = cacheListVectors(
    { records, functions: [validReader, nestedFn] },
    Number.MAX_SAFE_INTEGER,
    true,
  );
  assert.ok(res !== undefined && res.rewritten > 0);
  assert.equal(verify(res.module).ok, true, JSON.stringify(verify(res.module)));
  const out = res.module.functions[1]!;
  // Inner loop header (block 3) has its isDense check peeled out: plain jump to block 4.
  assert.equal(out.blocks[3]?.terminator.kind, "jump");
  assert.equal(out.blocks[3]?.instructions.length, 0);
  // Hot inner body (block 5) calls unchecked reader for both list[i - 1] and list[i].
  const uncheckedCalls = calls(
    { ...out, blocks: [out.blocks[5]!] },
    "__tint_reference_list_readu$",
    res.module,
  );
  assert.equal(uncheckedCalls.length, 2);
  // Cold fallback copy still calls the checked vector reader.
  assert.ok(
    calls(out, "__tint_reference_list_readv$", res.module).length >= 2,
    "cold copy retains checked vector reads",
  );
});

test("versioning both an inner and outer read-only dense list loop leaves no unreachable blocks", () => {
  const records = [
    {
      byteLength: 24,
      fields: [
        { offset: 8, type: "number" as const, mutable: true },
        { offset: 16, type: "optional-reference" as const, mutable: true },
      ],
    },
  ];
  // Outer loop (block 1) iterates i = 0 .. outerList.length reading outerList[i];
  // inner loop (block 4) iterates j = 0 .. innerList.length reading innerList[j].
  // Both loops are versioned by cacheListVectors; outer cloning must include
  // the inner loop's newly inserted guard and cold-copy blocks.
  const nestedBoth: FunctionIR = {
    id: 1,
    name: "nestedBothLists",
    exported: true,
    parameters: [0, 1],
    slots: [
      "reference", // 0: outerList
      "reference", // 1: innerList
      "number", // 2: i
      "number", // 3: outerLen
      "number", // 4: j
      "number", // 5: innerLen
    ],
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
        instructions: [{ kind: "load", id: 1, slot: 0, ...s }],
        terminator: {
          kind: "record",
          object: 1,
          record: 0,
          field: 0,
          operation: "read",
          slot: 3,
          consequent: 2,
          alternate: 9,
          ...s,
        },
      },
      {
        id: 2,
        instructions: [
          { kind: "load", id: 2, slot: 2, ...s },
          { kind: "load", id: 3, slot: 3, ...s },
          { kind: "unary", id: 4, operator: "uint32", operand: 3, ...s },
          { kind: "binary", id: 5, operator: "<", left: 2, right: 4, ...s },
        ],
        terminator: {
          kind: "branch",
          condition: 5,
          consequent: 3,
          alternate: 8,
          ...s,
        },
      },
      {
        id: 3,
        instructions: [
          { kind: "load", id: 6, slot: 0, ...s },
          { kind: "load", id: 7, slot: 2, ...s },
          { kind: "call", id: 8, target: 0, arguments: [6, 7], ...s },
          { kind: "constant", id: 9, value: 0, ...s },
          { kind: "store", slot: 4, value: 9, ...s },
        ],
        terminator: { kind: "jump", target: 4, ...s },
      },
      {
        id: 4,
        instructions: [{ kind: "load", id: 10, slot: 1, ...s }],
        terminator: {
          kind: "record",
          object: 10,
          record: 0,
          field: 0,
          operation: "read",
          slot: 5,
          consequent: 5,
          alternate: 9,
          ...s,
        },
      },
      {
        id: 5,
        instructions: [
          { kind: "load", id: 11, slot: 4, ...s },
          { kind: "load", id: 12, slot: 5, ...s },
          { kind: "unary", id: 13, operator: "uint32", operand: 12, ...s },
          { kind: "binary", id: 14, operator: "<", left: 11, right: 13, ...s },
        ],
        terminator: {
          kind: "branch",
          condition: 14,
          consequent: 6,
          alternate: 7,
          ...s,
        },
      },
      {
        id: 6,
        instructions: [
          { kind: "load", id: 15, slot: 1, ...s },
          { kind: "load", id: 16, slot: 4, ...s },
          { kind: "call", id: 17, target: 0, arguments: [15, 16], ...s },
          { kind: "constant", id: 18, value: 1, ...s },
          { kind: "binary", id: 19, operator: "+", left: 16, right: 18, ...s },
          { kind: "store", slot: 4, value: 19, ...s },
        ],
        terminator: { kind: "jump", target: 4, ...s },
      },
      {
        id: 7,
        instructions: [
          { kind: "load", id: 20, slot: 2, ...s },
          { kind: "constant", id: 21, value: 1, ...s },
          { kind: "binary", id: 22, operator: "+", left: 20, right: 21, ...s },
          { kind: "store", slot: 2, value: 22, ...s },
        ],
        terminator: { kind: "jump", target: 1, ...s },
      },
      {
        id: 8,
        instructions: [],
        terminator: { kind: "return", value: undefined, ...s },
      },
      { id: 9, instructions: [], terminator: { kind: "trap", ...s } },
    ],
  };
  const validReader: FunctionIR = {
    ...reader(0, 0),
    blocks: [
      {
        ...reader(0, 0).blocks[0]!,
        terminator: {
          kind: "record",
          object: 0,
          record: 0,
          field: 1,
          operation: "read",
          slot: 2,
          consequent: 1,
          alternate: 2,
          ...s,
        },
      },
      reader(0, 0).blocks[1]!,
      { id: 2, instructions: [], terminator: { kind: "trap", ...s } },
    ],
  };
  assert.equal(
    verify({ records, functions: [validReader, nestedBoth] }).ok,
    true,
  );
  const res = cacheListVectors(
    { records, functions: [validReader, nestedBoth] },
    Number.MAX_SAFE_INTEGER,
    true,
  );
  assert.ok(res !== undefined && res.rewritten > 0);
  const verified = verify(res.module);
  assert.equal(verified.ok, true, JSON.stringify(verified));
  assert.ok(
    res.module.functions.some((f) =>
      f.name.startsWith("__tint_reference_list_readu$"),
    ),
  );
});
