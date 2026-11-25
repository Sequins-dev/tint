import assert from "node:assert/strict";
import test from "node:test";
import {
  verify,
  type FunctionIR,
  type ModuleIR,
  type RecordLayout,
} from "@tint/ir/scalar";
import { cacheLoopProperties } from "../src/optimization/property-cache.ts";

const s = { start: 0, end: 0 };

// Minimal synthetic record layouts satisfying scalar IR verifier constraints
// for global-cell and property-load (record 0 = Object, 1 = PropertySite,
// 2 = PropertyEpoch, 3 = Scope, 4 = Global, 5 = GlobalCache, 6 = GlobalCell,
// 7 = Unwatched CollectionData).
const records: readonly RecordLayout[] = [
  // 0: Object (shape at field 0 offset 8, propertyEpoch at field 1 offset 16,
  //    inline general slots at fields 2..3)
  {
    byteLength: 56,
    fields: [
      { offset: 8, type: "optional-reference", mutable: true },
      { offset: 16, type: "number", mutable: true },
      { offset: 24, type: "general", mutable: true },
      { offset: 40, type: "general", mutable: true },
    ],
  },
  // 1: PropertySite (non-inherited 1-entry: shape at offset 8, slot at offset 16,
  //    epoch at offset 24, epochs ref at offset 32, plus an immutable ref at field 4)
  {
    byteLength: 48,
    fields: [
      { offset: 8, type: "reference", mutable: true },
      { offset: 16, type: "number", mutable: true },
      { offset: 24, type: "number", mutable: true },
      { offset: 32, type: "reference", mutable: true },
      { offset: 40, type: "reference", mutable: false },
    ],
  },
  // 2: PropertyEpoch (value at field 0)
  {
    byteLength: 16,
    fields: [{ offset: 8, type: "number", mutable: true }],
  },
  // 3: Scope (global at field 0, object at field 1, declarative at field 2)
  {
    byteLength: 32,
    fields: [
      { offset: 8, type: "reference", mutable: false },
      { offset: 16, type: "optional-reference", mutable: true },
      { offset: 24, type: "optional-reference", mutable: true },
    ],
  },
  // 4: Global (lexicalEpoch at field 0, globalObject at field 1)
  {
    byteLength: 24,
    fields: [
      { offset: 8, type: "number", mutable: true },
      { offset: 16, type: "reference", mutable: false },
    ],
  },
  // 5: GlobalCache (global, lexicalEpoch, objectEpoch, cell)
  {
    byteLength: 40,
    fields: [
      { offset: 8, type: "optional-reference", mutable: true },
      { offset: 16, type: "number", mutable: true },
      { offset: 24, type: "number", mutable: true },
      { offset: 32, type: "optional-reference", mutable: true },
    ],
  },
  // 6: GlobalCell (value: general at field 0)
  {
    byteLength: 24,
    fields: [{ offset: 8, type: "general", mutable: true }],
  },
  // 7: Unwatched CollectionData (dirty flag at field 0)
  {
    byteLength: 16,
    fields: [{ offset: 8, type: "boolean", mutable: true }],
  },
];

const propLayout = {
  record: 0,
  field: 2,
  count: 2,
  siteRecord: 1,
  siteField: 0,
  inherited: false,
  entries: 1,
  epochRecord: 2,
  epochField: 0,
};

const globalLayout = {
  scopeRecord: 3,
  declarativeField: 2,
  objectField: 1,
  globalField: 0,
  globalRecord: 4,
  lexicalEpochField: 0,
  globalObjectField: 1,
  globalObjectRecord: 0,
  propertyEpochField: 1,
  cacheRecord: 5,
  cacheGlobalField: 0,
  cacheLexicalEpochField: 1,
  cacheObjectEpochField: 2,
  cacheCellField: 3,
};

const epochWriterHelper: FunctionIR = {
  id: 1,
  name: "bumpEpoch",
  exported: false,
  parameters: [0],
  slots: ["reference", "number"],
  returnType: "number",
  entry: 0,
  blocks: [
    {
      id: 0,
      instructions: [
        { kind: "load", id: 0, slot: 0, ...s },
        { kind: "constant", id: 1, value: 1, ...s },
        { kind: "store", slot: 1, value: 1, ...s },
      ],
      terminator: {
        kind: "record",
        operation: "write",
        object: 0,
        record: 2,
        field: 0,
        slot: 1,
        consequent: 1,
        alternate: 2,
        ...s,
      },
    },
    {
      id: 1,
      instructions: [{ kind: "constant", id: 2, value: 0, ...s }],
      terminator: { kind: "return", value: 2, ...s },
    },
    {
      id: 2,
      instructions: [],
      terminator: { kind: "trap", ...s },
    },
  ],
};

const pureCollectionHelper: FunctionIR = {
  id: 2,
  name: "touchCollection",
  exported: false,
  parameters: [0],
  slots: ["reference", "boolean"],
  returnType: "number",
  entry: 0,
  blocks: [
    {
      id: 0,
      instructions: [
        { kind: "load", id: 0, slot: 0, ...s },
        { kind: "constant", id: 1, value: true, ...s },
        { kind: "store", slot: 1, value: 1, ...s },
      ],
      terminator: {
        kind: "record",
        operation: "write",
        object: 0,
        record: 7,
        field: 0,
        slot: 1,
        consequent: 1,
        alternate: 2,
        ...s,
      },
    },
    {
      id: 1,
      instructions: [{ kind: "constant", id: 2, value: 1, ...s }],
      terminator: { kind: "return", value: 2, ...s },
    },
    {
      id: 2,
      instructions: [],
      terminator: { kind: "trap", ...s },
    },
  ],
};

function runPass(
  fn: FunctionIR,
  extra: readonly FunctionIR[] = [epochWriterHelper, pureCollectionHelper],
): { fn: FunctionIR; rewritten: number; visited: number } {
  const module: ModuleIR = { records, functions: [fn, ...extra] };
  const inputCheck = verify(module);
  assert.ok(inputCheck.ok, "input IR invalid: " + JSON.stringify(inputCheck));
  const result = cacheLoopProperties(fn, module, 100000);
  assert.ok(result !== undefined);
  const outModule: ModuleIR = { records, functions: [result.fn, ...extra] };
  const verified = verify(outModule);
  assert.ok(verified.ok, "output IR invalid: " + JSON.stringify(verified));
  return result;
}

test("caches loop-invariant property-load with property-safe direct helper and refreshes after cold invalidating call", () => {
  // slots: 0=obj(general), 1=site(ref), 2=n(number), 3=i(number), 4=out(general),
  //        5=epochRef(ref), 6=collectionRef(ref)
  const fn: FunctionIR = {
    id: 0,
    name: "loopPropWithSafeCall",
    exported: true,
    parameters: [0, 1, 2, 5, 6],
    slots: [
      "general",
      "reference",
      "number",
      "number",
      "general",
      "reference",
      "reference",
    ],
    returnType: "general",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "constant", id: 0, value: 0, ...s },
          { kind: "store", slot: 3, value: 0, ...s },
          { kind: "general-none", id: 1, ...s },
          { kind: "store", slot: 4, value: 1, ...s },
        ],
        terminator: { kind: "jump", target: 1, ...s },
      },
      {
        id: 1,
        instructions: [
          { kind: "load", id: 2, slot: 3, ...s },
          { kind: "load", id: 3, slot: 2, ...s },
          { kind: "binary", id: 4, operator: "<", left: 2, right: 3, ...s },
        ],
        terminator: {
          kind: "branch",
          condition: 4,
          consequent: 2,
          alternate: 5,
          ...s,
        },
      },
      {
        id: 2,
        instructions: [
          { kind: "load", id: 5, slot: 0, ...s },
          { kind: "load", id: 6, slot: 1, ...s },
          {
            kind: "property-load",
            id: 7,
            object: 5,
            site: 6,
            ...propLayout,
            ...s,
          },
          { kind: "store", slot: 4, value: 7, ...s },
          { kind: "general-is", id: 8, value: 7, type: "absent", ...s },
        ],
        terminator: {
          kind: "branch",
          condition: 8,
          consequent: 3,
          alternate: 4,
          ...s,
        },
      },
      // Cold invalidating call (writes watched epoch record 2).
      {
        id: 3,
        instructions: [
          { kind: "load", id: 9, slot: 5, ...s },
          { kind: "call", id: 10, target: 1, arguments: [9], ...s },
        ],
        terminator: { kind: "jump", target: 4, ...s },
      },
      // Hot path calls pureCollectionHelper (writes unwatched record 7 only).
      {
        id: 4,
        instructions: [
          { kind: "load", id: 11, slot: 6, ...s },
          { kind: "call", id: 12, target: 2, arguments: [11], ...s },
          { kind: "load", id: 13, slot: 3, ...s },
          { kind: "constant", id: 14, value: 1, ...s },
          { kind: "binary", id: 15, operator: "+", left: 13, right: 14, ...s },
          { kind: "store", slot: 3, value: 15, ...s },
        ],
        terminator: { kind: "jump", target: 1, ...s },
      },
      {
        id: 5,
        instructions: [{ kind: "load", id: 16, slot: 4, ...s }],
        terminator: { kind: "return", value: 16, ...s },
      },
    ],
  };

  const { fn: out, rewritten } = runPass(fn);
  assert.equal(rewritten, 1);
  // Hot block 2 should no longer execute property-load; it loads the cached slot.
  assert.equal(
    out.blocks[2]!.instructions.some((op) => op.kind === "property-load"),
    false,
  );
  // Cold call block 3 should refresh the cached slot inline right after call 1.
  assert.equal(
    out.blocks[3]!.instructions.some((op) => op.kind === "property-load"),
    true,
  );
  // Preheader redirects through a refresh block before entering loop header 1.
  assert.notEqual(
    out.blocks[0]!.terminator.kind === "jump" &&
      out.blocks[0]!.terminator.target,
    1,
  );
});

test("caches global-cell, GlobalCell.value, and chained property-load across non-clobbering record read", () => {
  // Mirrors `Math.floor` pattern:
  // b0 -> b1 (header) -> b2 (global-cell; branch on present) ->
  //   b3 (record read GlobalCell.value -> slot 6) -> b4 (record read site -> slot 7) ->
  //   b5 (property-load(slot 6, slot 7); branch on absent) -> b6 (cold call) / b7 (latch).
  const fn: FunctionIR = {
    id: 0,
    name: "chainedGlobalProp",
    exported: true,
    parameters: [0, 1, 2, 3, 4],
    // 0:scope, 1:cache, 2:siteHolder(ref->rec1), 3:n, 4:epochRef,
    // 5:i, 6:mathVal(general), 7:site(ref), 8:cell(opt-ref), 9:out(general)
    slots: [
      "reference",
      "reference",
      "reference",
      "number",
      "reference",
      "number",
      "general",
      "reference",
      "optional-reference",
      "general",
    ],
    returnType: "general",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "constant", id: 0, value: 0, ...s },
          { kind: "store", slot: 5, value: 0, ...s },
          { kind: "general-none", id: 1, ...s },
          { kind: "store", slot: 9, value: 1, ...s },
        ],
        terminator: { kind: "jump", target: 1, ...s },
      },
      {
        id: 1,
        instructions: [
          { kind: "load", id: 2, slot: 5, ...s },
          { kind: "load", id: 3, slot: 3, ...s },
          { kind: "binary", id: 4, operator: "<", left: 2, right: 3, ...s },
        ],
        terminator: {
          kind: "branch",
          condition: 4,
          consequent: 2,
          alternate: 9,
          ...s,
        },
      },
      {
        id: 2,
        instructions: [
          { kind: "load", id: 5, slot: 0, ...s },
          { kind: "load", id: 6, slot: 1, ...s },
          {
            kind: "global-cell",
            id: 7,
            scope: 5,
            cache: 6,
            ...globalLayout,
            ...s,
          },
          { kind: "store", slot: 8, value: 7, ...s },
          { kind: "reference-none", id: 8, ...s },
          { kind: "binary", id: 9, operator: "!==", left: 7, right: 8, ...s },
        ],
        terminator: {
          kind: "branch",
          condition: 9,
          consequent: 3,
          alternate: 6,
          ...s,
        },
      },
      {
        id: 3,
        instructions: [
          { kind: "load", id: 10, slot: 8, ...s },
          { kind: "reference-value", id: 11, value: 10, ...s },
        ],
        terminator: {
          kind: "record",
          operation: "read",
          object: 11,
          record: 6,
          field: 0,
          slot: 6,
          consequent: 4,
          alternate: 10,
          ...s,
        },
      },
      // Non-clobbering record read (reads immutable site field into slot 7).
      {
        id: 4,
        instructions: [{ kind: "load", id: 12, slot: 2, ...s }],
        terminator: {
          kind: "record",
          operation: "read",
          object: 12,
          record: 1,
          field: 0,
          slot: 7,
          consequent: 5,
          alternate: 10,
          ...s,
        },
      },
      {
        id: 5,
        instructions: [
          { kind: "load", id: 13, slot: 6, ...s },
          { kind: "load", id: 14, slot: 7, ...s },
          {
            kind: "property-load",
            id: 15,
            object: 13,
            site: 14,
            ...propLayout,
            ...s,
          },
          { kind: "store", slot: 9, value: 15, ...s },
          { kind: "general-is", id: 16, value: 15, type: "absent", ...s },
        ],
        terminator: {
          kind: "branch",
          condition: 16,
          consequent: 7,
          alternate: 8,
          ...s,
        },
      },
      // Cold global miss.
      {
        id: 6,
        instructions: [
          { kind: "load", id: 17, slot: 4, ...s },
          { kind: "call", id: 18, target: 1, arguments: [17], ...s },
          { kind: "general-none", id: 19, ...s },
          { kind: "store", slot: 6, value: 19, ...s },
        ],
        terminator: { kind: "jump", target: 4, ...s },
      },
      // Cold property miss.
      {
        id: 7,
        instructions: [
          { kind: "load", id: 20, slot: 4, ...s },
          { kind: "call", id: 21, target: 1, arguments: [20], ...s },
        ],
        terminator: { kind: "jump", target: 8, ...s },
      },
      {
        id: 8,
        instructions: [
          { kind: "load", id: 22, slot: 5, ...s },
          { kind: "constant", id: 23, value: 1, ...s },
          { kind: "binary", id: 24, operator: "+", left: 22, right: 23, ...s },
          { kind: "store", slot: 5, value: 24, ...s },
        ],
        terminator: { kind: "jump", target: 1, ...s },
      },
      {
        id: 9,
        instructions: [{ kind: "load", id: 25, slot: 9, ...s }],
        terminator: { kind: "return", value: 25, ...s },
      },
      {
        id: 10,
        instructions: [],
        terminator: { kind: "trap", ...s },
      },
    ],
  };

  const { fn: out, rewritten } = runPass(fn);
  // All 3 accesses (global-cell, GlobalCell.value read, chained property-load) cached.
  assert.equal(rewritten, 3);
  assert.equal(
    out.blocks[2]!.instructions.some((op) => op.kind === "global-cell"),
    false,
  );
  assert.equal(out.blocks[3]!.terminator.kind, "jump");
  assert.equal(
    out.blocks[5]!.instructions.some((op) => op.kind === "property-load"),
    false,
  );
});

test("caches property-load on cold-written receiver slot and refreshes after the store", () => {
  // Mirrors `pushLength`: `if (cond) obj = replacement; obj.push(...)`.
  const fn: FunctionIR = {
    id: 0,
    name: "coldWrittenReceiver",
    exported: true,
    parameters: [0, 1, 2, 3],
    // 0:obj(general), 1:replacement(general), 2:site(ref), 3:n(number), 4:i(number), 5:out(general)
    slots: ["general", "general", "reference", "number", "number", "general"],
    returnType: "general",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "constant", id: 0, value: 0, ...s },
          { kind: "store", slot: 4, value: 0, ...s },
          { kind: "general-none", id: 1, ...s },
          { kind: "store", slot: 5, value: 1, ...s },
        ],
        terminator: { kind: "jump", target: 1, ...s },
      },
      {
        id: 1,
        instructions: [
          { kind: "load", id: 2, slot: 4, ...s },
          { kind: "load", id: 3, slot: 3, ...s },
          { kind: "binary", id: 4, operator: "<", left: 2, right: 3, ...s },
        ],
        terminator: {
          kind: "branch",
          condition: 4,
          consequent: 2,
          alternate: 5,
          ...s,
        },
      },
      {
        id: 2,
        instructions: [
          { kind: "load", id: 5, slot: 4, ...s },
          { kind: "constant", id: 6, value: 64, ...s },
          { kind: "binary", id: 7, operator: "===", left: 5, right: 6, ...s },
        ],
        terminator: {
          kind: "branch",
          condition: 7,
          consequent: 3,
          alternate: 4,
          ...s,
        },
      },
      // Cold reassignment of slot 0.
      {
        id: 3,
        instructions: [
          { kind: "load", id: 8, slot: 1, ...s },
          { kind: "store", slot: 0, value: 8, ...s },
        ],
        terminator: { kind: "jump", target: 4, ...s },
      },
      {
        id: 4,
        instructions: [
          { kind: "load", id: 9, slot: 0, ...s },
          { kind: "load", id: 10, slot: 2, ...s },
          {
            kind: "property-load",
            id: 11,
            object: 9,
            site: 10,
            ...propLayout,
            ...s,
          },
          { kind: "store", slot: 5, value: 11, ...s },
          { kind: "load", id: 12, slot: 4, ...s },
          { kind: "constant", id: 13, value: 1, ...s },
          { kind: "binary", id: 14, operator: "+", left: 12, right: 13, ...s },
          { kind: "store", slot: 4, value: 14, ...s },
        ],
        terminator: { kind: "jump", target: 1, ...s },
      },
      {
        id: 5,
        instructions: [{ kind: "load", id: 15, slot: 5, ...s }],
        terminator: { kind: "return", value: 15, ...s },
      },
    ],
  };

  const { fn: out, rewritten } = runPass(fn);
  assert.equal(rewritten, 1);
  // Hot block 4 loads cached propSlot; cold reassignment block 3 refreshes it.
  assert.equal(
    out.blocks[4]!.instructions.some((op) => op.kind === "property-load"),
    false,
  );
  assert.equal(
    out.blocks[3]!.instructions.some((op) => op.kind === "property-load"),
    true,
  );
});

test("rejects loops with unconditional invalidating calls and skips non-script functions", () => {
  const unconditional: FunctionIR = {
    id: 0,
    name: "everyIterInvalidates",
    exported: true,
    parameters: [0, 1, 2, 3],
    slots: ["general", "reference", "number", "reference", "number", "general"],
    returnType: "general",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "constant", id: 0, value: 0, ...s },
          { kind: "store", slot: 4, value: 0, ...s },
          { kind: "general-none", id: 1, ...s },
          { kind: "store", slot: 5, value: 1, ...s },
        ],
        terminator: { kind: "jump", target: 1, ...s },
      },
      {
        id: 1,
        instructions: [
          { kind: "load", id: 2, slot: 4, ...s },
          { kind: "load", id: 3, slot: 2, ...s },
          { kind: "binary", id: 4, operator: "<", left: 2, right: 3, ...s },
        ],
        terminator: {
          kind: "branch",
          condition: 4,
          consequent: 2,
          alternate: 3,
          ...s,
        },
      },
      {
        id: 2,
        instructions: [
          { kind: "load", id: 5, slot: 0, ...s },
          { kind: "load", id: 6, slot: 1, ...s },
          {
            kind: "property-load",
            id: 7,
            object: 5,
            site: 6,
            ...propLayout,
            ...s,
          },
          { kind: "store", slot: 5, value: 7, ...s },
          { kind: "load", id: 8, slot: 3, ...s },
          { kind: "call", id: 9, target: 1, arguments: [8], ...s },
          { kind: "load", id: 10, slot: 4, ...s },
          { kind: "constant", id: 11, value: 1, ...s },
          { kind: "binary", id: 12, operator: "+", left: 10, right: 11, ...s },
          { kind: "store", slot: 4, value: 12, ...s },
        ],
        terminator: { kind: "jump", target: 1, ...s },
      },
      {
        id: 3,
        instructions: [{ kind: "load", id: 13, slot: 5, ...s }],
        terminator: { kind: "return", value: 13, ...s },
      },
    ],
  };

  assert.equal(runPass(unconditional).rewritten, 0);

  // Non-script function (no general/script operations) exits immediately with 0 work.
  const typedFn: FunctionIR = {
    id: 0,
    name: "pureNumeric",
    exported: true,
    parameters: [0],
    slots: ["number"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [{ kind: "load", id: 0, slot: 0, ...s }],
        terminator: { kind: "return", value: 0, ...s },
      },
    ],
  };
  const typedOut = runPass(typedFn, []);
  assert.equal(typedOut.visited, 0);
  assert.equal(typedOut.rewritten, 0);
});
