import assert from "node:assert/strict";
import { test } from "node:test";
import type { FunctionIR, ModuleIR } from "../src/scalar/model.ts";
import {
  verify,
  verifierRecordBudget,
  verifierRecordWork,
} from "../src/scalar/index.ts";
import {
  provenRecordGuards,
  dataflowRecordGuards,
  stableRecordLayouts,
  stableDescriptors,
  trackedManagedWrites,
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
test("sparse result ids beyond the work budget do not exhaust read proofs", () => {
  // Inlining and unbounded optimization number large functions far beyond
  // their instruction count; the verifier's proof must charge visited
  // instructions, not the id range (a Test262 unit host regression).
  const loaded = 1_500_000,
    read = 1_500_001;
  const fn: FunctionIR = {
    id: 0,
    name: "sparse-ids",
    exported: true,
    parameters: [0],
    slots: ["reference", "number"],
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
        instructions: [
          { kind: "load", id: loaded, slot: 0, ...span },
          {
            kind: "record-read",
            id: read,
            object: loaded,
            record: 0,
            field: 0,
            ...span,
          },
        ],
        terminator: { kind: "return", value: read, ...span },
      },
      { id: 2, instructions: [], terminator: { kind: "trap", ...span } },
    ],
  };
  assert.equal(provenRecordReads(fn, 100)?.[read], 1);
  assert.equal(analyzeRecordAccesses(fn, 100)?.reads[read], 1);
  assert.ok(read > verifierRecordWork);
  checked(fn);
});
test("the verifier's read proof budget grows with the function", () => {
  // Ten receivers checked up front, read after 100 000 straight-line
  // instructions: each read's proof scans them all, past the fixed floor
  // (a Test262 unit host initializer grew there once closure factories
  // inlined into it, and every lowered read failed verification).
  const receivers = 10,
    fillerBlocks = 100,
    fillerSize = 1000;
  const blocks: FunctionIR["blocks"][number][] = [],
    slots: FunctionIR["slots"][number][] = ["number"],
    parameters: number[] = [];
  for (let r = 0; r < receivers; r++) {
    slots.push("reference");
    parameters.push(r + 1);
  }
  const trap = receivers + fillerBlocks + 1;
  for (let r = 0; r < receivers; r++)
    blocks.push({
      id: r,
      instructions: [{ kind: "load", id: r, slot: r + 1, ...span }],
      terminator: {
        kind: "record",
        object: r,
        record: 0,
        field: 0,
        operation: "read",
        slot: 0,
        consequent: r + 1,
        alternate: trap,
        ...span,
      },
    });
  let id = receivers;
  for (let b = 0; b < fillerBlocks; b++) {
    const instructions: FunctionIR["blocks"][number]["instructions"][number][] =
      [];
    for (let i = 0; i < fillerSize; i++)
      instructions.push({ kind: "constant", id: id++, value: i, ...span });
    blocks.push({
      id: receivers + b,
      instructions,
      terminator: { kind: "jump", target: receivers + b + 1, ...span },
    });
  }
  const reads: FunctionIR["blocks"][number]["instructions"][number][] = [];
  for (let r = 0; r < receivers; r++) {
    const loaded = id++;
    reads.push({ kind: "load", id: loaded, slot: r + 1, ...span });
    reads.push({
      kind: "record-read",
      id: id++,
      object: loaded,
      record: 0,
      field: 0,
      ...span,
    });
  }
  blocks.push({
    id: receivers + fillerBlocks,
    instructions: reads,
    terminator: { kind: "return", value: id - 1, ...span },
  });
  blocks.push({
    id: trap,
    instructions: [],
    terminator: { kind: "trap", ...span },
  });
  const fn: FunctionIR = {
    id: 0,
    name: "large",
    exported: true,
    parameters,
    slots,
    returnType: "number",
    entry: 0,
    blocks,
  };
  const needed = analyzeRecordAccesses(fn, 1e9, false, false)?.work ?? 0;
  assert.ok(needed > verifierRecordWork, String(needed));
  assert.ok(needed <= verifierRecordBudget(fn), String(needed));
  // The fixed floor alone fails every read; the verifier proves them all.
  assert.equal(provenRecordReads(fn, verifierRecordWork), undefined);
  checked(fn);
});
test("read proofs follow unique predecessor chains of any length", () => {
  // Inlined straight-line code can put the establishing check more than 32
  // blocks before a read (a Test262 Array.prototype.sort unit regression).
  const distance = 40,
    blocks: FunctionIR["blocks"][number][] = [
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
          alternate: distance + 2,
          ...span,
        },
      },
    ];
  for (let id = 1; id <= distance; id++)
    blocks.push({
      id,
      instructions: [],
      terminator: { kind: "jump", target: id + 1, ...span },
    });
  blocks.push({
    id: distance + 1,
    instructions: [
      { kind: "load", id: 1, slot: 0, ...span },
      { kind: "record-read", id: 2, object: 1, record: 0, field: 0, ...span },
    ],
    terminator: { kind: "return", value: 2, ...span },
  });
  blocks.push({
    id: distance + 2,
    instructions: [],
    terminator: { kind: "trap", ...span },
  });
  const fn: FunctionIR = {
    id: 0,
    name: "long-chain",
    exported: true,
    parameters: [0],
    slots: ["reference", "number"],
    returnType: "number",
    entry: 0,
    blocks,
  };
  assert.equal(provenRecordReads(fn)?.[2], 1);
  checked(fn);
  // Two unreachable blocks that only jump to each other form a unique
  // predecessor cycle; the walk still terminates, unproven.
  const looping: FunctionIR = {
    ...fn,
    blocks: [
      ...blocks,
      {
        id: distance + 3,
        instructions: [],
        terminator: { kind: "jump", target: distance + 4, ...span },
      },
      {
        id: distance + 4,
        instructions: [
          { kind: "load", id: 3, slot: 0, ...span },
          {
            kind: "record-read",
            id: 4,
            object: 3,
            record: 0,
            field: 0,
            ...span,
          },
        ],
        terminator: { kind: "jump", target: distance + 3, ...span },
      },
    ],
  };
  assert.equal(provenRecordReads(looping)?.[4], 0);
  assert.equal(provenRecordReads(looping)?.[2], 1);
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
test("isolate operations keep closed-module layout proofs", () => {
  // Worker threads re-enter the image's own hosted entry with a fresh heap,
  // and shared memory, parking words and unmapped mappings are outside every
  // managed heap (docs/design-worker-runtime.md).
  for (const operation of [
    "thread-start",
    "thread-join",
    "hosted-thread-entry",
    "memory-unmap",
    "word-park",
    "word-wake",
    "shared-read-unsigned",
    "shared-write-unsigned",
    "shared-read-word64",
    "shared-write-word64",
    "shared-compare-exchange-unsigned",
    "shared-compare-exchange-word64",
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
    assert.equal(stableRecordLayouts({ functions: [fn] }), true, operation);
    assert.equal(stableDescriptors({ functions: [fn] }), true, operation);
  }
  // Code entry outside the image's own entry still leaves the closed world.
  for (const operation of [
    "collector-worker-entry",
    "permanent-function-address",
    "executable-call-value",
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
    assert.equal(stableRecordLayouts({ functions: [fn] }), false, operation);
    assert.equal(stableDescriptors({ functions: [fn] }), true, operation);
  }
});
test("raw host memory effects prevent closed-module layout proofs", () => {
  for (const operation of [
    "memory-write-word",
    "memory-move",
    "generational-state",
    "external-memory-configure",
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
    assert.equal(stableDescriptors({ functions: [fn] }), false, operation);
  }
});
test("the generational write proof admits executable calls only under the trusted-code contract", () => {
  const withHost = (operation: string): ModuleIR => {
    const base = fixture();
    return {
      functions: [
        {
          ...base,
          blocks: base.blocks.map((block) =>
            block.id !== 1
              ? block
              : {
                  ...block,
                  instructions: [
                    {
                      kind: "host-call",
                      operation: operation as "executable-call-value",
                      id: 4,
                      arguments: [],
                      ...span,
                    },
                    ...block.instructions,
                  ],
                },
          ),
        },
      ],
    };
  };
  // Publishing code bytes is not a managed write.
  for (const operation of [
    "executable-map",
    "executable-write",
    "executable-unmap",
  ])
    assert.equal(
      trackedManagedWrites(withHost(operation), undefined, false),
      true,
      operation,
    );
  // The code a call enters is opaque: only the image's unit linker, which
  // rejects a differing barrier policy, can vouch for it.
  for (const operation of [
    "executable-call-number",
    "executable-call-value",
    "executable-call-managed",
  ]) {
    assert.equal(
      trackedManagedWrites(withHost(operation), undefined, false),
      false,
      operation,
    );
    assert.equal(
      trackedManagedWrites(withHost(operation), undefined, true),
      true,
      operation,
    );
  }
  // A raw word write or move could store an unbarriered reference.
  for (const operation of ["memory-write-word", "memory-move"])
    assert.equal(
      trackedManagedWrites(withHost(operation), undefined, true),
      false,
      operation,
    );
});
test("raw-window string images prevent closed-module layout proofs", () => {
  // string-flatten-into is an IR instruction, not a host call, but its
  // window may be any writable memory, like memory-write-bytes.
  const base = fixture();
  const fn: FunctionIR = {
    ...base,
    blocks: base.blocks.map((block) =>
      block.id !== 1
        ? block
        : {
            ...block,
            instructions: [
              {
                kind: "string-flatten-into",
                id: 4,
                address: 1,
                byteLength: 1,
                string: 0,
                ...span,
              },
              ...block.instructions,
            ],
          },
    ),
  };
  assert.equal(stableRecordLayouts({ functions: [fn] }), false);
  assert.equal(stableDescriptors({ functions: [fn] }), false);
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
/** block0 checks slot 0 then branches; both arms join at a second check. */
function diamond(
  arm: FunctionIR["blocks"][number]["instructions"],
): FunctionIR {
  return {
    id: 0,
    name: "joined",
    exported: true,
    parameters: [0, 2, 3],
    slots: ["reference", "number", "boolean", "reference"],
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
        instructions: [{ kind: "load", id: 1, slot: 2, ...span }],
        terminator: {
          kind: "branch",
          condition: 1,
          consequent: 3,
          alternate: 4,
          ...span,
        },
      },
      { id: 2, instructions: [], terminator: { kind: "trap", ...span } },
      {
        id: 3,
        instructions: [],
        terminator: { kind: "jump", target: 5, ...span },
      },
      {
        id: 4,
        instructions: arm,
        terminator: { kind: "jump", target: 5, ...span },
      },
      {
        id: 5,
        instructions: [{ kind: "load", id: 3, slot: 0, ...span }],
        terminator: {
          kind: "record",
          object: 3,
          record: 0,
          field: 0,
          operation: "read",
          slot: 1,
          consequent: 6,
          alternate: 2,
          ...span,
        },
      },
      {
        id: 6,
        instructions: [{ kind: "load", id: 4, slot: 1, ...span }],
        terminator: { kind: "return", value: 4, ...span },
      },
    ],
  };
}
test("join-crossing descriptor facts need the check on every incoming path", () => {
  const plain = diamond([]);
  checked(plain);
  assert.equal(provenRecordGuards(plain)?.[5], 0);
  assert.deepEqual(
    dataflowRecordGuards(plain),
    new Uint8Array([0, 0, 0, 0, 0, 1, 0]),
  );
  // Copies through another slot keep the fact; reassignment on one arm drops it.
  const copied = diamond([
    { kind: "load", id: 2, slot: 0, ...span },
    { kind: "store", slot: 3, value: 2, ...span },
    { kind: "load", id: 5, slot: 3, ...span },
    { kind: "store", slot: 0, value: 5, ...span },
  ]);
  checked(copied);
  assert.equal(dataflowRecordGuards(copied)?.[5], 1);
  const reassigned = diamond([
    { kind: "load", id: 2, slot: 3, ...span },
    { kind: "store", slot: 0, value: 2, ...span },
  ]);
  checked(reassigned);
  assert.equal(dataflowRecordGuards(reassigned)?.[5], 0);
  // A constructor on the reassigning arm re-establishes the same layout.
  const constructed = diamond([
    { kind: "constant", id: 6, value: 1, ...span },
    { kind: "record-new", id: 2, record: 0, arguments: [6], ...span },
    { kind: "store", slot: 0, value: 2, ...span },
  ]);
  checked(constructed);
  assert.equal(dataflowRecordGuards(constructed)?.[5], 1);
  // The sparse live lists of tables above the dense limit prove the same.
  for (const fn of [plain, copied, reassigned, constructed])
    assert.deepEqual(
      dataflowRecordGuards(fn, 2000000, false, 0),
      dataflowRecordGuards(fn),
    );
});
/** Two union field reads of one receiver: each tests layout 0, then the
 * continuation reloads the receiver and tests layout 1 (or, with `third`,
 * layout 2 after that) for the same read. */
function unionReads(third: boolean): FunctionIR {
  const guard = (
    id: number,
    record: number,
    consequent: number,
    alternate: number,
  ): FunctionIR["blocks"][number] => ({
    id,
    instructions: [{ kind: "load", id, slot: 0, ...span }],
    terminator: {
      kind: "record",
      object: id,
      record,
      field: 0,
      operation: "read",
      slot: 1,
      consequent,
      alternate,
      ...span,
    },
  });
  return {
    id: 0,
    name: "union",
    exported: true,
    parameters: [0],
    slots: ["reference", "number"],
    returnType: "number",
    entry: 0,
    blocks: [
      guard(0, 0, 2, 1),
      guard(1, 1, 2, third ? 6 : 5),
      guard(2, 0, 4, 3),
      guard(3, 1, 4, third ? 7 : 5),
      {
        id: 4,
        instructions: [{ kind: "load", id: 4, slot: 1, ...span }],
        terminator: { kind: "return", value: 4, ...span },
      },
      { id: 5, instructions: [], terminator: { kind: "trap", ...span } },
      ...(third ? [guard(6, 2, 2, 5), guard(7, 2, 4, 5)] : []),
    ],
  };
}
test("union dispatch joins keep both layouts and a failed test leaves the other", () => {
  const records = [16, 16, 24].map((offset) => ({
    byteLength: 32,
    fields: [{ offset, type: "number" as const, mutable: false }],
  }));
  for (const third of [false, true]) {
    const fn = unionReads(third);
    assert.ok(verify({ records, functions: [fn] }).ok);
    for (const dense of [undefined, 0]) {
      const pairs = new Map<number, readonly number[]>(),
        proven = dataflowRecordGuards(
          fn,
          2000000,
          false,
          dense,
          undefined,
          pairs,
        );
      if (!third) {
        // The second read's receiver is layout 0 or 1; after its failed
        // test of 0 only 1 remains.
        assert.deepEqual([...(proven ?? [])], [0, 0, 0, 1, 0, 0]);
        assert.deepEqual([...pairs], [[2, [0, 1]]]);
      } else {
        // Three layouts join to unknown: every test stays.
        assert.deepEqual([...(proven ?? [])], [0, 0, 0, 0, 0, 0, 0, 0]);
        assert.deepEqual([...pairs], []);
      }
    }
  }
});
test("join-crossing facts respect opaque calls, exception entries and budgets", () => {
  const called = diamond([
    { kind: "load", id: 2, slot: 0, ...span },
    { kind: "load", id: 7, slot: 2, ...span },
    { kind: "load", id: 8, slot: 3, ...span },
    { kind: "call", id: 5, target: 0, arguments: [2, 7, 8], ...span },
  ]);
  checked(called);
  assert.equal(dataflowRecordGuards(called)?.[5], 0);
  assert.equal(dataflowRecordGuards(called, 100000, true)?.[5], 1);
  assert.equal(dataflowRecordGuards(called, 100000, true, 0)?.[5], 1);
  const base = diamond([]);
  const exceptional: FunctionIR = {
    ...base,
    slots: ["reference", "number", "boolean", "reference", "general"],
    blocks: base.blocks.map((b) =>
      b.id !== 3 ? b : { ...b, exception: { target: 5, slot: 4 } },
    ),
  };
  checked(exceptional);
  assert.equal(dataflowRecordGuards(exceptional, 100000, true)?.[5], 0);
  assert.equal(dataflowRecordGuards(base, 0), undefined);
  assert.equal(dataflowRecordGuards(base, 20), undefined);
});
test("join-crossing facts never transfer an overwritten receiver or invent loop facts", () => {
  // The first check reads its field into the receiver slot itself.
  const base = diamond([]);
  const replaced: FunctionIR = {
    ...base,
    blocks: base.blocks.map((b) =>
      b.id !== 0 || b.terminator.kind !== "record"
        ? b
        : { ...b, terminator: { ...b.terminator, slot: 0 } },
    ),
    slots: ["reference", "reference", "boolean", "reference"],
  };
  // A loop whose back edge reassigns the slot keeps the header check.
  const loop: FunctionIR = {
    id: 0,
    name: "loop",
    exported: true,
    parameters: [0, 2, 3],
    slots: ["reference", "number", "boolean", "reference"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [],
        terminator: { kind: "jump", target: 1, ...span },
      },
      {
        id: 1,
        instructions: [{ kind: "load", id: 0, slot: 0, ...span }],
        terminator: {
          kind: "record",
          object: 0,
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
        instructions: [
          { kind: "load", id: 1, slot: 3, ...span },
          { kind: "store", slot: 0, value: 1, ...span },
          { kind: "load", id: 2, slot: 2, ...span },
        ],
        terminator: {
          kind: "branch",
          condition: 2,
          consequent: 1,
          alternate: 4,
          ...span,
        },
      },
      {
        id: 4,
        instructions: [{ kind: "load", id: 3, slot: 1, ...span }],
        terminator: { kind: "return", value: 3, ...span },
      },
    ],
  };
  checked(loop);
  assert.deepEqual(dataflowRecordGuards(loop), new Uint8Array(5));
  // Without the reassignment the header check repeats only its own proof:
  // the entry edge carries no fact, so it stays.
  const steady: FunctionIR = {
    ...loop,
    blocks: loop.blocks.map((b) =>
      b.id !== 3 ? b : { ...b, instructions: b.instructions.slice(2) },
    ),
  };
  checked(steady);
  assert.deepEqual(dataflowRecordGuards(steady), new Uint8Array(5));
  assert.equal(dataflowRecordGuards(replaced)?.[5], 0);
});
test("join-crossing proofs include every chain proof on the existing fixtures", () => {
  const fn = fixture();
  const cases: FunctionIR[] = [fn, diamond([])];
  for (const candidate of cases) {
    const chain = provenRecordGuards(candidate, 100000, true),
      joined = dataflowRecordGuards(candidate, 100000, true);
    assert.ok(chain !== undefined && joined !== undefined);
    for (let block = 0; block < chain.length; block++)
      if (chain[block] === 1) assert.equal(joined[block], 1, String(block));
  }
});
test("Test262 and JIT host operations preserve descriptors", () => {
  // None of these can replace a managed object's descriptor: JIT entries are
  // verified managed code, executable and shared-memory writes target
  // non-heap mappings, unmapping releases non-heap mappings, collections
  // preserve layouts, and the rest read or schedule.
  for (const operation of [
    "executable-map",
    "executable-write",
    "executable-call-number",
    "executable-call-value",
    "executable-call-managed",
    "executable-unmap",
    "memory-unmap",
    "external-memory-register",
    "native-function-descriptor",
    "native-function-signature",
    "native-value-function-descriptor",
    "native-value-function-signature",
    "thread-start",
    "thread-join",
    "hosted-thread-entry",
    "word-park",
    "word-wake",
    "shared-read-unsigned",
    "shared-write-unsigned",
    "shared-read-word64",
    "shared-write-word64",
    "shared-compare-exchange-unsigned",
    "shared-compare-exchange-word64",
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
    // Signature queries and isolate operations also keep the closed world.
    assert.equal(
      stableRecordLayouts({ functions: [fn] }),
      operation === "native-function-signature" ||
        (!operation.startsWith("executable-") &&
          !operation.startsWith("native-") &&
          operation !== "external-memory-register"),
      operation,
    );
    assert.equal(stableDescriptors({ functions: [fn] }), true, operation);
    // A guard after such a call stays proven from the earlier check.
    assert.equal(
      provenRecordGuards(
        fn,
        100000,
        stableDescriptors({ functions: [fn] }),
      )?.[1],
      1,
      operation,
    );
  }
});
