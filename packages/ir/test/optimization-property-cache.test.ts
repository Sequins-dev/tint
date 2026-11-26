import assert from "node:assert/strict";
import test from "node:test";
import {
  verify,
  type FunctionIR,
  type ModuleIR,
  type RecordLayout,
} from "@tint/ir/scalar";
import {
  analyzeModulePropertySites,
  cacheLoopProperties,
  forwardDominatingProperties,
} from "../src/optimization/property-cache.ts";

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

test("disambiguates disjoint property-store keys, chains 1-hop cached properties, and refreshes same-key stores", () => {
  // Additional record 8: SiteTable holding 3 immutable PropertySite refs
  // (field 0 = "v", field 1 = "size", field 2 = "c").
  // Record 9: StorePropertySite (shape, slot, transition, epoch, epochs).
  const extRecords: readonly RecordLayout[] = [
    ...records,
    {
      byteLength: 32,
      fields: [
        { offset: 8, type: "reference", mutable: false },
        { offset: 16, type: "reference", mutable: false },
        { offset: 24, type: "reference", mutable: false },
      ],
    },
    {
      byteLength: 48,
      fields: [
        { offset: 8, type: "reference", mutable: true },
        { offset: 16, type: "number", mutable: true },
        { offset: 24, type: "optional-reference", mutable: true },
        { offset: 32, type: "number", mutable: true },
        { offset: 40, type: "reference", mutable: true },
      ],
    },
  ];
  const storePropLayout = {
    ...propLayout,
    siteRecord: 9,
  };
  // Synthetic createScriptPropertyCache helper (returns a PropertySite ref).
  const createSiteHelper: FunctionIR = {
    id: 3,
    name: "createScriptPropertyCache",
    exported: false,
    parameters: [0],
    slots: ["string"],
    returnType: "reference",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [],
        terminator: { kind: "trap", ...s },
      },
    ],
  };
  // Initializer allocating SiteTable (record 8) from static string-literal keys.
  const initSites: FunctionIR = {
    id: 4,
    name: "initSites",
    exported: false,
    parameters: [],
    slots: [],
    returnType: "reference",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "string-literal", id: 0, value: "v", ...s },
          { kind: "call", id: 1, target: 3, arguments: [0], ...s },
          { kind: "string-literal", id: 2, value: "size", ...s },
          { kind: "call", id: 3, target: 3, arguments: [2], ...s },
          { kind: "string-literal", id: 4, value: "c", ...s },
          { kind: "call", id: 5, target: 3, arguments: [4], ...s },
          {
            kind: "record-new",
            id: 6,
            record: 8,
            arguments: [1, 3, 5],
            ...s,
          },
        ],
        terminator: { kind: "return", value: 6, ...s },
      },
    ],
  };
  // Loop reads `obj.v`, chains `v.size`, and performs an unconditional disjoint
  // `property-store` on key `"c"` plus a cold conflicting `property-store` on
  // key `"v"` (which must refresh outer `v` before inner `size`).
  // slots: 0=obj(gen), 1=sites(ref rec8), 2=n(num), 3=i(num), 4=siteV(ref),
  //        5=vVal(gen), 6=siteSize(ref), 7=siteC(ref), 8=out(gen)
  const fn: FunctionIR = {
    id: 0,
    name: "disjointStoreAndChain",
    exported: true,
    parameters: [0, 1, 2],
    slots: [
      "general",
      "reference",
      "number",
      "number",
      "reference",
      "general",
      "reference",
      "reference",
      "general",
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
          { kind: "store", slot: 8, value: 1, ...s },
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
          alternate: 8,
          ...s,
        },
      },
      // Read siteV (record 8, field 0 -> "v")
      {
        id: 2,
        instructions: [{ kind: "load", id: 5, slot: 1, ...s }],
        terminator: {
          kind: "record",
          operation: "read",
          object: 5,
          record: 8,
          field: 0,
          slot: 4,
          consequent: 3,
          alternate: 9,
          ...s,
        },
      },
      // Load obj.v -> slot 5, then read siteSize (record 8, field 1 -> "size")
      {
        id: 3,
        instructions: [
          { kind: "load", id: 6, slot: 0, ...s },
          { kind: "load", id: 7, slot: 4, ...s },
          {
            kind: "property-load",
            id: 8,
            object: 6,
            site: 7,
            ...propLayout,
            ...s,
          },
          { kind: "store", slot: 5, value: 8, ...s },
          { kind: "load", id: 9, slot: 1, ...s },
        ],
        terminator: {
          kind: "record",
          operation: "read",
          object: 9,
          record: 8,
          field: 1,
          slot: 6,
          consequent: 4,
          alternate: 9,
          ...s,
        },
      },
      // Load v.size -> slot 8, then read siteC (record 8, field 2 -> "c")
      {
        id: 4,
        instructions: [
          { kind: "load", id: 10, slot: 5, ...s },
          { kind: "load", id: 11, slot: 6, ...s },
          {
            kind: "property-load",
            id: 12,
            object: 10,
            site: 11,
            ...propLayout,
            ...s,
          },
          { kind: "store", slot: 8, value: 12, ...s },
          { kind: "load", id: 13, slot: 1, ...s },
        ],
        terminator: {
          kind: "record",
          operation: "read",
          object: 13,
          record: 8,
          field: 2,
          slot: 7,
          consequent: 5,
          alternate: 9,
          ...s,
        },
      },
      // Unconditional disjoint property-store on key "c", then cold branch to store "v".
      {
        id: 5,
        instructions: [
          { kind: "load", id: 14, slot: 0, ...s },
          { kind: "load", id: 15, slot: 7, ...s },
          { kind: "load", id: 16, slot: 8, ...s },
          {
            kind: "property-store",
            id: 17,
            object: 14,
            site: 15,
            value: 16,
            ...storePropLayout,
            ...s,
          },
          { kind: "load", id: 18, slot: 3, ...s },
          { kind: "constant", id: 19, value: 99, ...s },
          {
            kind: "binary",
            id: 20,
            operator: "===",
            left: 18,
            right: 19,
            ...s,
          },
        ],
        terminator: {
          kind: "branch",
          condition: 20,
          consequent: 6,
          alternate: 7,
          ...s,
        },
      },
      // Cold conflicting property-store on key "v".
      {
        id: 6,
        instructions: [
          { kind: "load", id: 21, slot: 0, ...s },
          { kind: "load", id: 22, slot: 4, ...s },
          { kind: "load", id: 23, slot: 8, ...s },
          {
            kind: "property-store",
            id: 24,
            object: 21,
            site: 22,
            value: 23,
            ...storePropLayout,
            ...s,
          },
        ],
        terminator: { kind: "jump", target: 7, ...s },
      },
      {
        id: 7,
        instructions: [
          { kind: "load", id: 25, slot: 3, ...s },
          { kind: "constant", id: 26, value: 1, ...s },
          { kind: "binary", id: 27, operator: "+", left: 25, right: 26, ...s },
          { kind: "store", slot: 3, value: 27, ...s },
        ],
        terminator: { kind: "jump", target: 1, ...s },
      },
      {
        id: 8,
        instructions: [{ kind: "load", id: 28, slot: 8, ...s }],
        terminator: { kind: "return", value: 28, ...s },
      },
      {
        id: 9,
        instructions: [],
        terminator: { kind: "trap", ...s },
      },
    ],
  };

  const module: ModuleIR = {
    records: extRecords,
    functions: [
      fn,
      epochWriterHelper,
      pureCollectionHelper,
      createSiteHelper,
      initSites,
    ],
  };
  assert.ok(verify(module).ok, JSON.stringify(verify(module)));
  const shared = analyzeModulePropertySites(module, 100000);
  assert.ok(shared !== undefined);
  assert.equal(shared.siteFieldName.get("8:0"), "v");
  assert.equal(shared.siteFieldName.get("8:1"), "size");
  assert.equal(shared.siteFieldName.get("8:2"), "c");

  const result = cacheLoopProperties(fn, module, 100000, undefined, shared);
  assert.ok(result !== undefined);
  assert.equal(result.rewritten, 2);
  const outModule: ModuleIR = {
    records: extRecords,
    functions: [
      result.fn,
      epochWriterHelper,
      pureCollectionHelper,
      createSiteHelper,
      initSites,
    ],
  };
  assert.ok(verify(outModule).ok, JSON.stringify(verify(outModule)));
  // Both hot loads (obj.v in block 3 and v.size in block 4) are hoisted.
  assert.equal(
    result.fn.blocks[3]!.instructions.some((op) => op.kind === "property-load"),
    false,
  );
  assert.equal(
    result.fn.blocks[4]!.instructions.some((op) => op.kind === "property-load"),
    false,
  );
  // Disjoint store on "c" in block 5 triggers NO refresh (stays straight-line).
  assert.equal(
    result.fn.blocks[5]!.instructions.some((op) => op.kind === "property-load"),
    false,
  );
  // Cold store on "v" in block 6 refreshes BOTH "v" and chained "size" (via
  // refresh chain blocks jumped to from block 6).
  assert.notEqual(
    result.fn.blocks[6]!.terminator.kind === "jump" &&
      result.fn.blocks[6]!.terminator.target,
    7,
  );
});

test("forwardDominatingProperties forwards redundant loads across disjoint stores and refreshes on sibling cold misses", () => {
  const extRecords: readonly RecordLayout[] = [
    ...records,
    {
      byteLength: 32,
      fields: [
        { offset: 8, type: "reference", mutable: false },
        { offset: 16, type: "reference", mutable: false },
        { offset: 24, type: "reference", mutable: false },
      ],
    },
    {
      byteLength: 48,
      fields: [
        { offset: 8, type: "reference", mutable: true },
        { offset: 16, type: "number", mutable: true },
        { offset: 24, type: "optional-reference", mutable: true },
        { offset: 32, type: "number", mutable: true },
        { offset: 40, type: "reference", mutable: true },
      ],
    },
  ];
  const storePropLayout = { ...propLayout, siteRecord: 9 };
  const createSiteHelper: FunctionIR = {
    id: 3,
    name: "createScriptPropertyCache",
    exported: false,
    parameters: [0],
    slots: ["string"],
    returnType: "reference",
    entry: 0,
    blocks: [{ id: 0, instructions: [], terminator: { kind: "trap", ...s } }],
  };
  const initSites: FunctionIR = {
    id: 4,
    name: "initSites",
    exported: false,
    parameters: [],
    slots: [],
    returnType: "reference",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "string-literal", id: 0, value: "a", ...s },
          { kind: "call", id: 1, target: 3, arguments: [0], ...s },
          { kind: "string-literal", id: 2, value: "b", ...s },
          { kind: "call", id: 3, target: 3, arguments: [2], ...s },
          { kind: "string-literal", id: 4, value: "c", ...s },
          { kind: "call", id: 5, target: 3, arguments: [4], ...s },
          {
            kind: "record-new",
            id: 6,
            record: 8,
            arguments: [1, 3, 5],
            ...s,
          },
        ],
        terminator: { kind: "return", value: 6, ...s },
      },
    ],
  };
  // Control flow:
  //   block 0: read siteA (slot 2), siteB (slot 3), siteC (slot 4) via record reads -> block 3
  //   block 3: dominating property-load obj.a (with cold miss block 4 -> block 5)
  //   block 5: disjoint property-store obj.c = val, then sibling property-load obj.b
  //            (with cold miss block 6 calling effectful getter -> block 7)
  //   block 7: dominated redundant property-load obj.a (must forward from probeSlot,
  //            while block 6 refreshes probeSlot!), then conflicting property-store obj.a
  //            followed by another property-load obj.a (must NOT forward).
  // slots: 0=obj(gen), 1=sites(ref rec8), 2=siteA(ref), 3=siteB(ref), 4=siteC(ref),
  //        5=val(gen), 6=a1(gen), 7=b1(gen), 8=a2(gen), 9=a3(gen), 10=epoch(ref rec2)
  const fn: FunctionIR = {
    id: 0,
    name: "dominatingForward",
    exported: true,
    parameters: [0, 1, 5, 10],
    slots: [
      "general",
      "reference",
      "reference",
      "reference",
      "reference",
      "general",
      "general",
      "general",
      "general",
      "general",
      "reference",
    ],
    returnType: "general",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [{ kind: "load", id: 0, slot: 1, ...s }],
        terminator: {
          kind: "record",
          operation: "read",
          object: 0,
          record: 8,
          field: 0,
          slot: 2,
          consequent: 1,
          alternate: 8,
          ...s,
        },
      },
      {
        id: 1,
        instructions: [{ kind: "load", id: 1, slot: 1, ...s }],
        terminator: {
          kind: "record",
          operation: "read",
          object: 1,
          record: 8,
          field: 1,
          slot: 3,
          consequent: 2,
          alternate: 8,
          ...s,
        },
      },
      {
        id: 2,
        instructions: [{ kind: "load", id: 2, slot: 1, ...s }],
        terminator: {
          kind: "record",
          operation: "read",
          object: 2,
          record: 8,
          field: 2,
          slot: 4,
          consequent: 3,
          alternate: 8,
          ...s,
        },
      },
      // Dominating load of obj.a
      {
        id: 3,
        instructions: [
          { kind: "load", id: 3, slot: 0, ...s },
          { kind: "load", id: 4, slot: 2, ...s },
          {
            kind: "property-load",
            id: 5,
            object: 3,
            site: 4,
            ...propLayout,
            ...s,
          },
          { kind: "store", slot: 6, value: 5, ...s },
          { kind: "general-is", id: 6, value: 5, type: "absent", ...s },
        ],
        terminator: {
          kind: "branch",
          condition: 6,
          consequent: 4,
          alternate: 5,
          ...s,
        },
      },
      // Cold miss for dominating obj.a
      {
        id: 4,
        instructions: [
          { kind: "load", id: 7, slot: 10, ...s },
          { kind: "call", id: 8, target: 1, arguments: [7], ...s },
          { kind: "load", id: 9, slot: 5, ...s },
          { kind: "store", slot: 6, value: 9, ...s },
        ],
        terminator: { kind: "jump", target: 5, ...s },
      },
      // Disjoint property-store on "c" + sibling property-load on "b"
      {
        id: 5,
        instructions: [
          { kind: "load", id: 10, slot: 0, ...s },
          { kind: "load", id: 11, slot: 4, ...s },
          { kind: "load", id: 12, slot: 5, ...s },
          {
            kind: "property-store",
            id: 13,
            object: 10,
            site: 11,
            value: 12,
            ...storePropLayout,
            ...s,
          },
          { kind: "load", id: 14, slot: 0, ...s },
          { kind: "load", id: 15, slot: 3, ...s },
          {
            kind: "property-load",
            id: 16,
            object: 14,
            site: 15,
            ...propLayout,
            ...s,
          },
          { kind: "store", slot: 7, value: 16, ...s },
          { kind: "general-is", id: 17, value: 16, type: "absent", ...s },
        ],
        terminator: {
          kind: "branch",
          condition: 17,
          consequent: 6,
          alternate: 7,
          ...s,
        },
      },
      // Cold miss for sibling obj.b (calls effectful getter!)
      {
        id: 6,
        instructions: [
          { kind: "load", id: 18, slot: 10, ...s },
          { kind: "call", id: 19, target: 1, arguments: [18], ...s },
          { kind: "load", id: 20, slot: 5, ...s },
          { kind: "store", slot: 7, value: 20, ...s },
        ],
        terminator: { kind: "jump", target: 7, ...s },
      },
      // Redundant load of obj.a (should forward), then conflicting store to "a",
      // then post-store load of obj.a (must NOT forward).
      {
        id: 7,
        instructions: [
          { kind: "load", id: 21, slot: 0, ...s },
          { kind: "load", id: 22, slot: 2, ...s },
          {
            kind: "property-load",
            id: 23,
            object: 21,
            site: 22,
            ...propLayout,
            ...s,
          },
          { kind: "store", slot: 8, value: 23, ...s },
          { kind: "load", id: 24, slot: 0, ...s },
          { kind: "load", id: 25, slot: 2, ...s },
          { kind: "load", id: 26, slot: 5, ...s },
          {
            kind: "property-store",
            id: 27,
            object: 24,
            site: 25,
            value: 26,
            ...storePropLayout,
            ...s,
          },
          { kind: "load", id: 28, slot: 0, ...s },
          { kind: "load", id: 29, slot: 2, ...s },
          {
            kind: "property-load",
            id: 30,
            object: 28,
            site: 29,
            ...propLayout,
            ...s,
          },
          { kind: "store", slot: 9, value: 30, ...s },
        ],
        terminator: { kind: "return", value: 30, ...s },
      },
      { id: 8, instructions: [], terminator: { kind: "trap", ...s } },
    ],
  };

  const module: ModuleIR = {
    records: extRecords,
    functions: [
      fn,
      epochWriterHelper,
      pureCollectionHelper,
      createSiteHelper,
      initSites,
    ],
  };
  assert.ok(verify(module).ok, JSON.stringify(verify(module)));
  const shared = analyzeModulePropertySites(module, 100000);
  assert.ok(shared !== undefined);
  const result = forwardDominatingProperties(
    fn,
    module,
    100000,
    undefined,
    shared,
  );
  assert.ok(result !== undefined);
  assert.equal(result.rewritten, 1);
  const outModule: ModuleIR = {
    records: extRecords,
    functions: [
      result.fn,
      epochWriterHelper,
      pureCollectionHelper,
      createSiteHelper,
      initSites,
    ],
  };
  assert.ok(verify(outModule).ok, JSON.stringify(verify(outModule)));
  // Block 7 keeps ONLY the post-conflicting-store property-load (id 30), not id 23.
  const block7Loads = result.fn.blocks[7]!.instructions.filter(
    (op) => op.kind === "property-load",
  );
  assert.equal(block7Loads.length, 1);
  assert.equal(block7Loads[0]!.id, 30);
  // Cold sibling miss block 6 refreshes probeSlot via a pure property-load.
  assert.equal(
    result.fn.blocks[6]!.instructions.some((op) => op.kind === "property-load"),
    true,
  );
});

test("analyzeModulePropertySites resolves 2-level chunked $pc provenance and shape-based mangled factories", () => {
  // Record 8 = 2-slot $pc chunk (reused for two distinct chunks with colliding leaf fields!)
  // Record 9 = closure environment holding chunk0 at field 0 and chunk1 at field 1.
  // Record 10 = inherited 1-entry PropertySite (shape, slot, general value, epoch, epochs, stringShape).
  const chunkRecords: readonly RecordLayout[] = [
    ...records,
    {
      byteLength: 24,
      fields: [
        { offset: 8, type: "reference", mutable: false },
        { offset: 16, type: "reference", mutable: false },
      ],
    },
    {
      byteLength: 24,
      fields: [
        { offset: 8, type: "reference", mutable: false },
        { offset: 16, type: "reference", mutable: false },
      ],
    },
    {
      byteLength: 64,
      fields: [
        { offset: 8, type: "reference", mutable: true },
        { offset: 16, type: "number", mutable: true },
        { offset: 24, type: "general", mutable: true },
        { offset: 40, type: "number", mutable: true },
        { offset: 48, type: "reference", mutable: true },
        { offset: 56, type: "reference", mutable: true },
      ],
    },
  ];
  const inhPropLayout = {
    ...propLayout,
    siteRecord: 10,
    inherited: true,
  };
  // Mangled factory name (not matching "createScriptPropertyCache"): detected by shape
  // (param 0 is optional-string, constructs record 1 = PropertySite).
  const mangledFactory: FunctionIR = {
    id: 1,
    name: "@44:value:23$906$direct",
    exported: false,
    parameters: [0, 1],
    slots: ["optional-string", "reference"],
    returnType: "reference",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "load", id: 0, slot: 1, ...s },
          { kind: "constant", id: 1, value: 0, ...s },
          { kind: "constant", id: 2, value: 0, ...s },
          {
            kind: "record-new",
            id: 3,
            record: 1,
            arguments: [0, 1, 2, 0, 0],
            ...s,
          },
        ],
        terminator: { kind: "return", value: 3, ...s },
      },
    ],
  };
  // Builds chunk0 = { "alpha", "beta" } and chunk1 = { "gamma", "delta" }
  // using the SAME RecordLayout 8, then stores both chunks into env RecordLayout 9.
  const initChunks: FunctionIR = {
    id: 2,
    name: "initChunkedSites",
    exported: false,
    parameters: [0],
    slots: ["reference"],
    returnType: "reference",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "load", id: 15, slot: 0, ...s },
          { kind: "string-literal", id: 0, value: "alpha", ...s },
          { kind: "string-wrap", id: 1, value: 0, ...s },
          { kind: "call", id: 2, target: 1, arguments: [1, 15], ...s },
          { kind: "string-literal", id: 3, value: "beta", ...s },
          { kind: "string-wrap", id: 4, value: 3, ...s },
          { kind: "call", id: 5, target: 1, arguments: [4, 15], ...s },
          { kind: "record-new", id: 6, record: 8, arguments: [2, 5], ...s },
          { kind: "string-literal", id: 7, value: "gamma", ...s },
          { kind: "string-wrap", id: 8, value: 7, ...s },
          { kind: "call", id: 9, target: 1, arguments: [8, 15], ...s },
          { kind: "string-literal", id: 10, value: "delta", ...s },
          { kind: "string-wrap", id: 11, value: 10, ...s },
          { kind: "call", id: 12, target: 1, arguments: [11, 15], ...s },
          { kind: "record-new", id: 13, record: 8, arguments: [9, 12], ...s },
          { kind: "record-new", id: 14, record: 9, arguments: [6, 13], ...s },
        ],
        terminator: { kind: "return", value: 14, ...s },
      },
    ],
  };
  // Consumer reads chunk0.0 ("alpha") and chunk1.0 ("gamma") via a single reused
  // temp slot (slot 3), probes own "alpha" then inherited "alpha" (must NOT forward
  // own -> inherited!), probes "gamma" (different key!), then probes own "alpha" via
  // copy-aliased slot 4 (MUST forward!).
  // slots: 0=obj(gen), 1=env(ref rec9), 2=chunk(ref rec8), 3=siteTmp(ref),
  //        4=aliasObj(gen), 5=out1(gen), 6=out2(gen), 7=out3(gen)
  const consumer: FunctionIR = {
    id: 0,
    name: "chunkedConsumer",
    exported: true,
    parameters: [0, 1],
    slots: [
      "general",
      "reference",
      "reference",
      "reference",
      "general",
      "general",
      "general",
      "general",
    ],
    returnType: "general",
    entry: 0,
    blocks: [
      // b0: aliasObj = obj; chunk = env.0 (chunk0) -> b1
      {
        id: 0,
        instructions: [
          { kind: "load", id: 0, slot: 0, ...s },
          { kind: "store", slot: 4, value: 0, ...s },
          { kind: "load", id: 1, slot: 1, ...s },
        ],
        terminator: {
          kind: "record",
          operation: "read",
          object: 1,
          record: 9,
          field: 0,
          slot: 2,
          consequent: 1,
          alternate: 7,
          ...s,
        },
      },
      // b1: siteTmp = chunk0.0 ("alpha") -> b2
      {
        id: 1,
        instructions: [{ kind: "load", id: 2, slot: 2, ...s }],
        terminator: {
          kind: "record",
          operation: "read",
          object: 2,
          record: 8,
          field: 0,
          slot: 3,
          consequent: 2,
          alternate: 7,
          ...s,
        },
      },
      // b2: own load obj.alpha (id 5), inherited load obj.alpha (id 8), chunk = env.1 -> b3
      {
        id: 2,
        instructions: [
          { kind: "load", id: 3, slot: 0, ...s },
          { kind: "load", id: 4, slot: 3, ...s },
          {
            kind: "property-load",
            id: 5,
            object: 3,
            site: 4,
            ...propLayout,
            inherited: false,
            ...s,
          },
          { kind: "store", slot: 5, value: 5, ...s },
          { kind: "load", id: 6, slot: 0, ...s },
          { kind: "load", id: 7, slot: 3, ...s },
          {
            kind: "property-load",
            id: 8,
            object: 6,
            site: 7,
            ...inhPropLayout,
            ...s,
          },
          { kind: "store", slot: 6, value: 8, ...s },
          { kind: "load", id: 9, slot: 1, ...s },
        ],
        terminator: {
          kind: "record",
          operation: "read",
          object: 9,
          record: 9,
          field: 1,
          slot: 2,
          consequent: 3,
          alternate: 7,
          ...s,
        },
      },
      // b3: siteTmp = chunk1.0 ("gamma") -> b4
      {
        id: 3,
        instructions: [{ kind: "load", id: 10, slot: 2, ...s }],
        terminator: {
          kind: "record",
          operation: "read",
          object: 10,
          record: 8,
          field: 0,
          slot: 3,
          consequent: 4,
          alternate: 7,
          ...s,
        },
      },
      // b4: own load obj.gamma (id 13), chunk = env.0 -> b5
      {
        id: 4,
        instructions: [
          { kind: "load", id: 11, slot: 0, ...s },
          { kind: "load", id: 12, slot: 3, ...s },
          {
            kind: "property-load",
            id: 13,
            object: 11,
            site: 12,
            ...propLayout,
            inherited: false,
            ...s,
          },
          { kind: "load", id: 14, slot: 1, ...s },
        ],
        terminator: {
          kind: "record",
          operation: "read",
          object: 14,
          record: 9,
          field: 0,
          slot: 2,
          consequent: 5,
          alternate: 7,
          ...s,
        },
      },
      // b5: siteTmp = chunk0.0 ("alpha") -> b6
      {
        id: 5,
        instructions: [{ kind: "load", id: 15, slot: 2, ...s }],
        terminator: {
          kind: "record",
          operation: "read",
          object: 15,
          record: 8,
          field: 0,
          slot: 3,
          consequent: 6,
          alternate: 7,
          ...s,
        },
      },
      // b6: redundant own load aliasObj.alpha (id 18) -> must forward!
      {
        id: 6,
        instructions: [
          { kind: "load", id: 16, slot: 4, ...s },
          { kind: "load", id: 17, slot: 3, ...s },
          {
            kind: "property-load",
            id: 18,
            object: 16,
            site: 17,
            ...propLayout,
            inherited: false,
            ...s,
          },
          { kind: "store", slot: 7, value: 18, ...s },
        ],
        terminator: { kind: "return", value: 18, ...s },
      },
      { id: 7, instructions: [], terminator: { kind: "trap", ...s } },
    ],
  };

  const module: ModuleIR = {
    records: chunkRecords,
    functions: [consumer, mangledFactory, initChunks],
  };
  assert.ok(verify(module).ok, JSON.stringify(verify(module)));
  const shared = analyzeModulePropertySites(module, 100000);
  assert.ok(shared !== undefined);
  // Colliding leaf keys `8:0` and `8:1` must be eliminated, while 2-level keys survive.
  assert.equal(shared.siteFieldName.get("8:0"), undefined);
  assert.equal(shared.siteFieldName.get("8:1"), undefined);
  assert.equal(shared.siteFieldName.get("9:0->8:0"), "alpha");
  assert.equal(shared.siteFieldName.get("9:0->8:1"), "beta");
  assert.equal(shared.siteFieldName.get("9:1->8:0"), "gamma");
  assert.equal(shared.siteFieldName.get("9:1->8:1"), "delta");

  const result = forwardDominatingProperties(
    consumer,
    module,
    100000,
    undefined,
    shared,
  );
  assert.ok(result !== undefined);
  // Only id 18 (redundant own load of aliasObj.alpha in b6) forwards; id 8 (inherited)
  // and id 13 (gamma) must both remain intact.
  assert.equal(result.rewritten, 1);
  const outModule: ModuleIR = {
    records: chunkRecords,
    functions: [result.fn, mangledFactory, initChunks],
  };
  assert.ok(verify(outModule).ok, JSON.stringify(verify(outModule)));
  assert.equal(
    result.fn.blocks[2]!.instructions.filter(
      (op) => op.kind === "property-load",
    ).length,
    2,
  );
  assert.equal(
    result.fn.blocks[4]!.instructions.filter(
      (op) => op.kind === "property-load",
    ).length,
    1,
  );
  assert.equal(
    result.fn.blocks[6]!.instructions.filter(
      (op) => op.kind === "property-load",
    ).length,
    0,
  );
});

test("forwardDominatingProperties forwards dominating global-cell probes and refreshes after cold miss", () => {
  const gcRecords: readonly RecordLayout[] = [
    ...records,
    {
      byteLength: 24,
      fields: [
        { offset: 8, type: "reference", mutable: false },
        { offset: 16, type: "reference", mutable: false },
      ],
    },
  ];
  // Helper that mutates Global.lexicalEpoch (record 4 field 0) to invalidate global-cell.
  const globalInvalidator: FunctionIR = {
    id: 1,
    name: "bumpLexicalEpoch",
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
          record: 4,
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
      { id: 2, instructions: [], terminator: { kind: "trap", ...s } },
    ],
  };
  // slots: 0=scope(ref), 1=gcHolder(ref rec8), 2=globalRef(ref rec4),
  //        3=cache0(ref), 4=cache1(ref), 5=c1(opt-ref), 6=c2(opt-ref), 7=c3(opt-ref),
  //        8=obj(general)
  const fn: FunctionIR = {
    id: 0,
    name: "dominatingGlobalCell",
    exported: true,
    parameters: [0, 1, 2, 8],
    slots: [
      "reference",
      "reference",
      "reference",
      "reference",
      "reference",
      "optional-reference",
      "optional-reference",
      "optional-reference",
      "general",
    ],
    returnType: "optional-reference",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "load", id: 0, slot: 1, ...s },
          { kind: "load", id: 16, slot: 8, ...s },
          {
            kind: "property-load",
            id: 17,
            object: 16,
            site: 0,
            ...propLayout,
            siteRecord: 1,
            ...s,
          },
        ],
        terminator: {
          kind: "record",
          operation: "read",
          object: 0,
          record: 8,
          field: 0,
          slot: 3,
          consequent: 1,
          alternate: 5,
          ...s,
        },
      },
      {
        id: 1,
        instructions: [{ kind: "load", id: 1, slot: 1, ...s }],
        terminator: {
          kind: "record",
          operation: "read",
          object: 1,
          record: 8,
          field: 1,
          slot: 4,
          consequent: 2,
          alternate: 5,
          ...s,
        },
      },
      {
        id: 2,
        instructions: [
          // First global-cell lookup for cache0
          { kind: "load", id: 3, slot: 0, ...s },
          { kind: "load", id: 4, slot: 3, ...s },
          {
            kind: "global-cell",
            id: 5,
            scope: 3,
            cache: 4,
            ...globalLayout,
            ...s,
          },
          { kind: "store", slot: 5, value: 5, ...s },
          // Sibling global-cell lookup for cache1 with a cold miss branch
          { kind: "load", id: 6, slot: 0, ...s },
          { kind: "load", id: 7, slot: 4, ...s },
          {
            kind: "global-cell",
            id: 8,
            scope: 6,
            cache: 7,
            ...globalLayout,
            ...s,
          },
          { kind: "store", slot: 6, value: 8, ...s },
          { kind: "reference-none", id: 9, ...s },
          { kind: "binary", id: 10, operator: "===", left: 8, right: 9, ...s },
        ],
        terminator: {
          kind: "branch",
          condition: 10,
          consequent: 3,
          alternate: 4,
          ...s,
        },
      },
      // Cold miss for cache1: calls epochWriterHelper (invalidating!)
      {
        id: 3,
        instructions: [
          { kind: "load", id: 11, slot: 2, ...s },
          { kind: "call", id: 12, target: 1, arguments: [11], ...s },
        ],
        terminator: { kind: "jump", target: 4, ...s },
      },
      // Second global-cell lookup for cache0: must forward from probeSlot while block 3 refreshes it.
      {
        id: 4,
        instructions: [
          { kind: "load", id: 13, slot: 0, ...s },
          { kind: "load", id: 14, slot: 3, ...s },
          {
            kind: "global-cell",
            id: 15,
            scope: 13,
            cache: 14,
            ...globalLayout,
            ...s,
          },
          { kind: "store", slot: 7, value: 15, ...s },
        ],
        terminator: { kind: "return", value: 15, ...s },
      },
      { id: 5, instructions: [], terminator: { kind: "trap", ...s } },
    ],
  };

  const module: ModuleIR = {
    records: gcRecords,
    functions: [fn, globalInvalidator],
  };
  assert.ok(verify(module).ok, JSON.stringify(verify(module)));
  const shared = analyzeModulePropertySites(module, 100000);
  assert.ok(shared !== undefined);
  const result = forwardDominatingProperties(
    fn,
    module,
    100000,
    undefined,
    shared,
  );
  assert.ok(result !== undefined);
  assert.equal(result.rewritten, 1);
  const outModule: ModuleIR = {
    records: gcRecords,
    functions: [result.fn, globalInvalidator],
  };
  assert.ok(verify(outModule).ok, JSON.stringify(verify(outModule)));
  // Block 4 should no longer execute global-cell; cold miss block 3 refreshes it.
  assert.equal(
    result.fn.blocks[4]!.instructions.some((op) => op.kind === "global-cell"),
    false,
  );
  assert.equal(
    result.fn.blocks[3]!.instructions.some((op) => op.kind === "global-cell"),
    true,
  );
});
