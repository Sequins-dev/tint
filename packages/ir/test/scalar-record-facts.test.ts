import assert from "node:assert/strict";
import { test } from "node:test";
import type { FunctionIR, ModuleIR } from "../src/scalar/model.ts";
import { verify } from "../src/scalar/index.ts";
import {
  provenRecordGuards,
  stableRecordLayouts,
  analyzeRecordAccesses,
  provenRecordReads,
} from "../src/scalar/record-facts.ts";
const span = { start: 0, end: 1 };
test("read verification does not spend its budget analyzing redundant guards", () => {
  const blocks: FunctionIR["blocks"][number][] = [];
  for (let id = 0; id < 100; id++)
    blocks.push({
      id,
      instructions: [{ kind: "load", id, slot: 0, ...span }],
      terminator: {
        kind: "record",
        object: id,
        record: 0,
        field: 0,
        operation: "read",
        slot: 1,
        consequent: id + 1,
        alternate: 101,
        ...span,
      },
    });
  blocks.push({
    id: 100,
    instructions: [
      { kind: "load", id: 100, slot: 0, ...span },
      {
        kind: "record-read",
        id: 101,
        object: 100,
        record: 0,
        field: 0,
        ...span,
      },
    ],
    terminator: { kind: "return", value: undefined, ...span },
  });
  blocks.push({
    id: 101,
    instructions: [],
    terminator: { kind: "trap", ...span },
  });
  const fn: FunctionIR = {
    id: 0,
    name: "guard-chain",
    exported: false,
    parameters: [0],
    slots: ["reference", "number"],
    returnType: "void",
    entry: 0,
    blocks,
  };
  assert.equal(analyzeRecordAccesses(fn, 500), undefined);
  assert.equal(provenRecordReads(fn, 500)?.[101], 1);
});
test("closed modules preserve descriptor proofs across calls", () => {
  const base = fixture();
  const fn: FunctionIR = {
    ...base,
    blocks: base.blocks.map((block) =>
      block.id !== 1
        ? block
        : {
            ...block,
            instructions: [
              { kind: "load", id: 4, slot: 0, ...span },
              { kind: "call", id: 5, target: 0, arguments: [4], ...span },
              ...block.instructions,
            ],
          },
    ),
  };
  checked(fn);
  const module: ModuleIR = { functions: [fn] };
  assert.equal(stableRecordLayouts(module), true);
  assert.equal(provenRecordGuards(fn)?.[1], 0);
  assert.equal(
    provenRecordGuards(fn, 100000, stableRecordLayouts(module))?.[1],
    1,
  );
});
test("raw host memory effects prevent closed-module layout proofs", () => {
  for (const operation of [
    "memory-write-word",
    "memory-move",
    "memory-unmap",
    "allocation-state",
  ] as const) {
    const base = fixture();
    const fn: FunctionIR = {
      ...base,
      blocks: base.blocks.map((block) =>
        block.id !== 1
          ? block
          : {
              ...block,
              instructions: [
                { kind: "host-call", operation, id: 4, arguments: [], ...span },
                ...block.instructions,
              ],
            },
      ),
    };
    // Effect discovery does not replace IR signature verification.
    assert.equal(stableRecordLayouts({ functions: [fn] }), false);
  }
});
function fixture(): FunctionIR {
  return {
    id: 0,
    name: "access",
    exported: true,
    parameters: [0],
    slots: ["reference", "number", "reference"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [{ kind: "load", id: 0, slot: 0, ...span }],
        terminator: {
          kind: "record",
          object: 0,
          record: 0,
          field: 0,
          operation: "read",
          slot: 1,
          consequent: 1,
          alternate: 2,
          ...span,
        },
      },
      {
        id: 1,
        instructions: [{ kind: "load", id: 1, slot: 0, ...span }],
        terminator: {
          kind: "record",
          object: 1,
          record: 0,
          field: 0,
          operation: "read",
          slot: 1,
          consequent: 3,
          alternate: 2,
          ...span,
        },
      },
      { id: 2, instructions: [], terminator: { kind: "trap", ...span } },
      {
        id: 3,
        instructions: [{ kind: "load", id: 2, slot: 1, ...span }],
        terminator: { kind: "return", value: 2, ...span },
      },
    ],
  };
}
function checked(fn: FunctionIR): void {
  const module: ModuleIR = {
    records: [
      {
        byteLength: 32,
        fields: [{ offset: 16, type: "number", mutable: true }],
      },
    ],
    functions: [fn],
  };
  assert.ok(verify(module).ok);
}
test("successful descriptor checks prove repeated accesses through local aliases", () => {
  const fn = fixture();
  checked(fn);
  assert.deepEqual(provenRecordGuards(fn), new Uint8Array([0, 1, 0, 0]));
  const block = fn.blocks[1]!;
  const aliased = {
    ...fn,
    blocks: fn.blocks.map((b) =>
      b.id !== 1
        ? b
        : {
            ...block,
            instructions: [
              { kind: "load" as const, id: 4, slot: 0, ...span },
              { kind: "store" as const, slot: 2, value: 4, ...span },
              { kind: "load" as const, id: 1, slot: 2, ...span },
            ],
          },
    ),
  };
  checked(aliased);
  assert.equal(provenRecordGuards(aliased)?.[1], 1);
  assert.equal(provenRecordGuards(fn, 0), undefined);
});
test("different incoming paths and slot reassignment retain checks", () => {
  const fn = fixture(),
    b = fn.blocks[0]!;
  const joined = {
    ...fn,
    blocks: fn.blocks.map((x) =>
      x.id !== 0
        ? x
        : {
            ...b,
            terminator: {
              kind: "branch" as const,
              condition: 5,
              consequent: 1,
              alternate: 1,
              ...span,
            },
            instructions: [
              { kind: "constant" as const, id: 5, value: true, ...span },
            ],
          },
    ),
  };
  checked(joined);
  assert.equal(provenRecordGuards(joined)?.[1], 0);
  assert.equal(provenRecordGuards(joined, 100000, true)?.[1], 0);
  const reassigned = {
    ...fn,
    parameters: [0, 2],
    blocks: fn.blocks.map((x) =>
      x.id !== 1
        ? x
        : {
            ...x,
            instructions: [
              { kind: "load" as const, id: 5, slot: 2, ...span },
              { kind: "store" as const, slot: 0, value: 5, ...span },
              { kind: "load" as const, id: 1, slot: 0, ...span },
            ],
          },
    ),
  };
  checked(reassigned);
  assert.equal(provenRecordGuards(reassigned)?.[1], 0);
  assert.equal(provenRecordGuards(reassigned, 100000, true)?.[1], 0);
});
test("constructors establish exact descriptor facts", () => {
  const fn = fixture();
  const constructed = {
    ...fn,
    blocks: fn.blocks.map((b) =>
      b.id !== 0
        ? b
        : {
            ...b,
            instructions: [
              { kind: "constant" as const, id: 5, value: 42, ...span },
              {
                kind: "record-new" as const,
                id: 0,
                record: 0,
                arguments: [5],
                ...span,
              },
            ],
          },
    ),
  };
  checked(constructed);
  assert.equal(provenRecordGuards(constructed)?.[0], 1);
});
test("opaque calls and overwritten snapshots do not establish descriptor proofs", () => {
  const fn = fixture();
  const called = {
    ...fn,
    blocks: fn.blocks.map((b) =>
      b.id !== 1
        ? b
        : {
            ...b,
            instructions: [
              ...b.instructions,
              {
                kind: "call" as const,
                id: 5,
                target: 0,
                arguments: [1],
                ...span,
              },
            ],
          },
    ),
  };
  checked(called);
  assert.equal(provenRecordGuards(called)?.[1], 0);
  const overwritten = {
    ...fn,
    parameters: [0, 2],
    blocks: fn.blocks.map((b) =>
      b.id !== 0
        ? b
        : {
            ...b,
            instructions: [
              ...b.instructions,
              { kind: "load" as const, id: 5, slot: 2, ...span },
              { kind: "store" as const, slot: 0, value: 5, ...span },
            ],
          },
    ),
  };
  checked(overwritten);
  assert.equal(provenRecordGuards(overwritten)?.[1], 0);
  assert.equal(provenRecordGuards(overwritten, 100000, true)?.[1], 0);
});
test("a field read replacing the receiver does not transfer its descriptor", () => {
  const fn = fixture();
  const replaced = {
    ...fn,
    blocks: fn.blocks.map((b) =>
      b.id !== 0 && b.id !== 1
        ? b
        : {
            ...b,
            terminator: {
              ...b.terminator,
              field: b.id === 0 ? 0 : 1,
              slot: b.id === 0 ? 0 : 1,
            },
          },
    ),
  } as FunctionIR;
  assert.ok(
    verify({
      records: [
        {
          byteLength: 32,
          fields: [
            { offset: 16, type: "reference", mutable: true },
            { offset: 24, type: "number", mutable: true },
          ],
        },
      ],
      functions: [replaced],
    }).ok,
  );
  assert.equal(provenRecordGuards(replaced)?.[1], 0);
  assert.equal(provenRecordGuards(replaced, 100000, true)?.[1], 0);
});
test("exception entry cannot inherit a normal-path descriptor proof", () => {
  const fn = fixture();
  const exceptional: FunctionIR = {
    ...fn,
    slots: ["reference", "number", "general"],
    blocks: fn.blocks.map((b) =>
      b.id !== 0 ? b : { ...b, exception: { target: 1, slot: 2 } },
    ),
  };
  checked(exceptional);
  assert.equal(provenRecordGuards(exceptional)?.[1], 0);
  assert.equal(provenRecordGuards(exceptional, 100000, true)?.[1], 0);
});

test("reading the monotonic clock preserves managed layouts", () => {
  const base = fixture(),
    first = base.blocks[0]!;
  const fn: FunctionIR = {
    ...base,
    blocks: [
      {
        ...first,
        instructions: [
          {
            kind: "host-call",
            operation: "monotonic-time",
            id: 100,
            arguments: [],
            ...span,
          },
          ...first.instructions,
        ],
      },
      ...base.blocks.slice(1),
    ],
  };
  checked(fn);
  assert.equal(stableRecordLayouts({ functions: [fn] }), true);
});

test("direct read checkpoints do not certify overwritten receiver slots", () => {
  const base = fixture();
  const fn: FunctionIR = {
    ...base,
    parameters: [0, 2],
    blocks: base.blocks.map((block) =>
      block.id !== 1
        ? block
        : {
            ...block,
            instructions: [
              { kind: "load", id: 1, slot: 0, ...span },
              { kind: "load", id: 5, slot: 2, ...span },
              { kind: "store", slot: 0, value: 5, ...span },
              {
                kind: "record-read",
                id: 6,
                object: 1,
                record: 0,
                field: 0,
                ...span,
              },
              { kind: "load", id: 7, slot: 0, ...span },
            ],
            terminator: {
              ...block.terminator,
              object: 7,
            } as FunctionIR["blocks"][number]["terminator"],
          },
    ),
  };
  checked(fn);
  assert.equal(provenRecordGuards(fn)?.[1], 0);
});

test("direct read checkpoints cannot invent a proof in a cycle", () => {
  const base = fixture();
  const fn: FunctionIR = {
    ...base,
    blocks: [
      {
        id: 0,
        instructions: [],
        terminator: { kind: "jump", target: 1, ...span },
      },
      {
        id: 1,
        instructions: [
          { kind: "load", id: 0, slot: 0, ...span },
          {
            kind: "record-read",
            id: 1,
            object: 0,
            record: 0,
            field: 0,
            ...span,
          },
        ],
        terminator: { kind: "jump", target: 1, ...span },
      },
    ],
  };
  const result = verify({
    functions: [fn],
    records: [
      {
        byteLength: 32,
        fields: [{ offset: 16, type: "number", mutable: true }],
      },
    ],
  });
  assert.equal(result.ok, false);
  if (!result.ok)
    assert.equal(result.error.message, "record read lacks a proven layout");
});

test("opaque effects invalidate direct read checkpoints", () => {
  const base = fixture();
  const fn: FunctionIR = {
    ...base,
    blocks: base.blocks.map((block) =>
      block.id !== 1
        ? block
        : {
            ...block,
            instructions: [
              ...block.instructions,
              {
                kind: "record-read",
                id: 5,
                object: 1,
                record: 0,
                field: 0,
                ...span,
              },
              { kind: "call", id: 6, target: 0, arguments: [1], ...span },
            ],
          },
    ),
  };
  checked(fn);
  assert.equal(provenRecordGuards(fn, 100000, false)?.[1], 0);
  assert.equal(provenRecordGuards(fn, 100000, true)?.[1], 1);
});
