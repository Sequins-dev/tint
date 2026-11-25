import assert from "node:assert/strict";
import test from "node:test";
import {
  verify,
  type FunctionIR,
  type ModuleIR,
  type RecordLayout,
} from "@tint/ir/scalar";
import { cacheElementStorage } from "../src/optimization/element-cache.ts";

const s = { start: 0, end: 0 };
const records: readonly RecordLayout[] = [
  {
    byteLength: 24,
    fields: [
      { offset: 8, type: "optional-reference", mutable: true },
      { offset: 16, type: "optional-reference", mutable: true },
    ],
  },
  {
    byteLength: 32,
    fields: [
      { offset: 8, type: "number", mutable: true },
      { offset: 16, type: "Float64Array", mutable: true },
    ],
  },
];
const layout = {
  record: 0,
  field: 1,
  elementsRecord: 1,
  countField: 0,
  storageField: 1,
};

function runPass(fn: FunctionIR, helper?: FunctionIR): FunctionIR {
  const result = cacheElementStorage(fn, 100000);
  assert.ok(result !== undefined);
  const module: ModuleIR = {
    records,
    functions: helper === undefined ? [result.fn] : [result.fn, helper],
  };
  const verified = verify(module);
  assert.ok(verified.ok, JSON.stringify(verified));
  return result.fn;
}

const helperFn: FunctionIR = {
  id: 1,
  name: "mutate",
  exported: false,
  parameters: [0],
  slots: ["general"],
  returnType: "number",
  entry: 0,
  blocks: [
    {
      id: 0,
      instructions: [{ kind: "constant", id: 0, value: 0, ...s }],
      terminator: { kind: "return", value: 0, ...s },
    },
  ],
};

test("caches loop-invariant element-load and element-store in preheader and invalidates after cold call", () => {
  const fn: FunctionIR = {
    id: 0,
    name: "loopAccess",
    exported: true,
    parameters: [0, 1],
    slots: ["general", "number", "number", "general"],
    returnType: "general",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "constant", id: 0, value: 0, ...s },
          { kind: "store", slot: 2, value: 0, ...s },
          { kind: "general-none", id: 1, ...s },
          { kind: "store", slot: 3, value: 1, ...s },
        ],
        terminator: { kind: "jump", target: 1, ...s },
      },
      {
        id: 1,
        instructions: [
          { kind: "load", id: 2, slot: 2, ...s },
          { kind: "load", id: 3, slot: 1, ...s },
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
          { kind: "load", id: 6, slot: 2, ...s },
          { kind: "element-load", id: 7, object: 5, index: 6, ...layout, ...s },
          { kind: "store", slot: 3, value: 7, ...s },
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
      {
        id: 3,
        instructions: [
          { kind: "load", id: 9, slot: 0, ...s },
          { kind: "call", id: 10, target: 1, arguments: [9], ...s },
        ],
        terminator: { kind: "jump", target: 4, ...s },
      },
      {
        id: 4,
        instructions: [
          { kind: "load", id: 11, slot: 0, ...s },
          { kind: "load", id: 12, slot: 2, ...s },
          { kind: "load", id: 13, slot: 3, ...s },
          {
            kind: "element-store",
            id: 14,
            object: 11,
            index: 12,
            value: 13,
            ...layout,
            ...s,
          },
          { kind: "constant", id: 15, value: 1, ...s },
          { kind: "binary", id: 16, operator: "+", left: 12, right: 15, ...s },
          { kind: "store", slot: 2, value: 16, ...s },
        ],
        terminator: { kind: "jump", target: 1, ...s },
      },
      {
        id: 5,
        instructions: [{ kind: "load", id: 17, slot: 3, ...s }],
        terminator: { kind: "return", value: 17, ...s },
      },
    ],
  };
  const out = runPass(fn, helperFn);
  assert.deepEqual(out.slots.slice(4), ["optional-reference", "number"]);
  const preheaderKinds = out.blocks[0]!.instructions.map((op) => op.kind);
  assert.ok(preheaderKinds.includes("element-storage"));
  assert.ok(preheaderKinds.includes("element-count"));
  const loadOp = out.blocks[2]!.instructions.find(
    (op) => op.kind === "element-load",
  );
  assert.ok(
    loadOp?.kind === "element-load" && loadOp.cachedStorage !== undefined,
  );
  const storeOp = out.blocks[4]!.instructions.find(
    (op) => op.kind === "element-store",
  );
  assert.ok(
    storeOp?.kind === "element-store" && storeOp.cachedStorage !== undefined,
  );
  // Cold call block invalidates countSlot (slot 5) to 0 immediately after the call.
  const callOps = out.blocks[3]!.instructions;
  assert.equal(callOps[callOps.length - 1]?.kind, "store");
  const invStore = callOps[callOps.length - 1]!;
  assert.ok(invStore.kind === "store" && invStore.slot === 5);
});

test("skips loops where an invalidating call runs on every iteration or with internal exception handlers", () => {
  const everyIter: FunctionIR = {
    id: 0,
    name: "everyCall",
    exported: true,
    parameters: [0, 1],
    slots: ["general", "number", "number", "general"],
    returnType: "general",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "constant", id: 0, value: 0, ...s },
          { kind: "store", slot: 2, value: 0, ...s },
          { kind: "general-none", id: 1, ...s },
          { kind: "store", slot: 3, value: 1, ...s },
        ],
        terminator: { kind: "jump", target: 1, ...s },
      },
      {
        id: 1,
        instructions: [
          { kind: "load", id: 2, slot: 2, ...s },
          { kind: "load", id: 3, slot: 1, ...s },
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
          { kind: "load", id: 6, slot: 2, ...s },
          { kind: "element-load", id: 7, object: 5, index: 6, ...layout, ...s },
          { kind: "store", slot: 3, value: 7, ...s },
          { kind: "call", id: 8, target: 1, arguments: [5], ...s },
          { kind: "constant", id: 9, value: 1, ...s },
          { kind: "binary", id: 10, operator: "+", left: 6, right: 9, ...s },
          { kind: "store", slot: 2, value: 10, ...s },
        ],
        terminator: { kind: "jump", target: 1, ...s },
      },
      {
        id: 3,
        instructions: [{ kind: "load", id: 11, slot: 3, ...s }],
        terminator: { kind: "return", value: 11, ...s },
      },
    ],
  };
  const result = cacheElementStorage(everyIter, 100000);
  assert.ok(result !== undefined);
  assert.equal(result.rewritten, 0);
});

test("hoists loop-invariant element cache to the outermost valid enclosing loop", () => {
  const nested: FunctionIR = {
    id: 0,
    name: "nestedLoop",
    exported: true,
    parameters: [0, 1],
    slots: ["general", "number", "number", "number", "general"],
    returnType: "general",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "constant", id: 0, value: 0, ...s },
          { kind: "store", slot: 2, value: 0, ...s },
          { kind: "general-none", id: 1, ...s },
          { kind: "store", slot: 4, value: 1, ...s },
        ],
        terminator: { kind: "jump", target: 1, ...s },
      },
      // Outer loop header (j < n).
      {
        id: 1,
        instructions: [
          { kind: "load", id: 2, slot: 2, ...s },
          { kind: "load", id: 3, slot: 1, ...s },
          { kind: "binary", id: 4, operator: "<", left: 2, right: 3, ...s },
        ],
        terminator: {
          kind: "branch",
          condition: 4,
          consequent: 2,
          alternate: 6,
          ...s,
        },
      },
      // Inner loop preheader (i = 0).
      {
        id: 2,
        instructions: [
          { kind: "constant", id: 5, value: 0, ...s },
          { kind: "store", slot: 3, value: 5, ...s },
        ],
        terminator: { kind: "jump", target: 3, ...s },
      },
      // Inner loop header (i < n).
      {
        id: 3,
        instructions: [
          { kind: "load", id: 6, slot: 3, ...s },
          { kind: "load", id: 7, slot: 1, ...s },
          { kind: "binary", id: 8, operator: "<", left: 6, right: 7, ...s },
        ],
        terminator: {
          kind: "branch",
          condition: 8,
          consequent: 4,
          alternate: 5,
          ...s,
        },
      },
      // Inner loop body: element-load on slot 0.
      {
        id: 4,
        instructions: [
          { kind: "load", id: 9, slot: 0, ...s },
          { kind: "load", id: 10, slot: 3, ...s },
          {
            kind: "element-load",
            id: 11,
            object: 9,
            index: 10,
            ...layout,
            ...s,
          },
          { kind: "store", slot: 4, value: 11, ...s },
          { kind: "constant", id: 12, value: 1, ...s },
          { kind: "binary", id: 13, operator: "+", left: 10, right: 12, ...s },
          { kind: "store", slot: 3, value: 13, ...s },
        ],
        terminator: { kind: "jump", target: 3, ...s },
      },
      // Outer loop latch (j++).
      {
        id: 5,
        instructions: [
          { kind: "load", id: 14, slot: 2, ...s },
          { kind: "constant", id: 15, value: 1, ...s },
          { kind: "binary", id: 16, operator: "+", left: 14, right: 15, ...s },
          { kind: "store", slot: 2, value: 16, ...s },
        ],
        terminator: { kind: "jump", target: 1, ...s },
      },
      {
        id: 6,
        instructions: [{ kind: "load", id: 17, slot: 4, ...s }],
        terminator: { kind: "return", value: 17, ...s },
      },
    ],
  };
  const out = runPass(nested);
  // Cached in the outer loop preheader (block 0), NOT the inner preheader (block 2).
  assert.ok(
    out.blocks[0]!.instructions.some((op) => op.kind === "element-storage"),
  );
  assert.ok(
    out.blocks[0]!.instructions.some((op) => op.kind === "element-count"),
  );
  assert.ok(
    !out.blocks[2]!.instructions.some((op) => op.kind === "element-storage"),
  );
  const loadOp = out.blocks[4]!.instructions.find(
    (op) => op.kind === "element-load",
  );
  assert.ok(
    loadOp?.kind === "element-load" && loadOp.cachedStorage !== undefined,
  );
});

test("rejects outer loops with an unconditional diamond call and caches in the inner loop instead", () => {
  const diamond: FunctionIR = {
    id: 0,
    name: "outerDiamondCall",
    exported: true,
    parameters: [0, 1],
    slots: ["general", "number", "number", "number", "general"],
    returnType: "general",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "constant", id: 0, value: 0, ...s },
          { kind: "store", slot: 2, value: 0, ...s },
          { kind: "general-none", id: 1, ...s },
          { kind: "store", slot: 4, value: 1, ...s },
        ],
        terminator: { kind: "jump", target: 1, ...s },
      },
      // Outer loop header (k < n).
      {
        id: 1,
        instructions: [
          { kind: "load", id: 2, slot: 2, ...s },
          { kind: "load", id: 3, slot: 1, ...s },
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
      // Inner loop preheader (i = 0).
      {
        id: 2,
        instructions: [
          { kind: "constant", id: 5, value: 0, ...s },
          { kind: "store", slot: 3, value: 5, ...s },
        ],
        terminator: { kind: "jump", target: 3, ...s },
      },
      // Inner loop header (i < n).
      {
        id: 3,
        instructions: [
          { kind: "load", id: 6, slot: 3, ...s },
          { kind: "load", id: 7, slot: 1, ...s },
          { kind: "binary", id: 8, operator: "<", left: 6, right: 7, ...s },
        ],
        terminator: {
          kind: "branch",
          condition: 8,
          consequent: 4,
          alternate: 5,
          ...s,
        },
      },
      // Inner loop body: element-load on slot 0.
      {
        id: 4,
        instructions: [
          { kind: "load", id: 9, slot: 0, ...s },
          { kind: "load", id: 10, slot: 3, ...s },
          {
            kind: "element-load",
            id: 11,
            object: 9,
            index: 10,
            ...layout,
            ...s,
          },
          { kind: "store", slot: 4, value: 11, ...s },
          { kind: "constant", id: 12, value: 1, ...s },
          { kind: "binary", id: 13, operator: "+", left: 10, right: 12, ...s },
          { kind: "store", slot: 3, value: 13, ...s },
        ],
        terminator: { kind: "jump", target: 3, ...s },
      },
      // After inner loop: diamond where BOTH arms call a helper (like a lowered JS call).
      {
        id: 5,
        instructions: [
          { kind: "load", id: 14, slot: 2, ...s },
          { kind: "constant", id: 15, value: 0, ...s },
          { kind: "binary", id: 16, operator: "==", left: 14, right: 15, ...s },
        ],
        terminator: {
          kind: "branch",
          condition: 16,
          consequent: 6,
          alternate: 7,
          ...s,
        },
      },
      {
        id: 6,
        instructions: [
          { kind: "load", id: 17, slot: 0, ...s },
          { kind: "call", id: 18, target: 1, arguments: [17], ...s },
        ],
        terminator: { kind: "jump", target: 8, ...s },
      },
      {
        id: 7,
        instructions: [
          { kind: "load", id: 19, slot: 0, ...s },
          { kind: "call", id: 20, target: 1, arguments: [19], ...s },
        ],
        terminator: { kind: "jump", target: 8, ...s },
      },
      // Outer loop latch (k++).
      {
        id: 8,
        instructions: [
          { kind: "load", id: 21, slot: 2, ...s },
          { kind: "constant", id: 22, value: 1, ...s },
          { kind: "binary", id: 23, operator: "+", left: 21, right: 22, ...s },
          { kind: "store", slot: 2, value: 23, ...s },
        ],
        terminator: { kind: "jump", target: 1, ...s },
      },
      {
        id: 9,
        instructions: [{ kind: "load", id: 24, slot: 4, ...s }],
        terminator: { kind: "return", value: 24, ...s },
      },
    ],
  };
  const out = runPass(diamond, helperFn);
  // Outer preheader (block 0) must NOT cache because every outer iteration calls.
  assert.ok(
    !out.blocks[0]!.instructions.some((op) => op.kind === "element-storage"),
  );
  // Inner preheader (block 2) MUST cache cleanly.
  assert.ok(
    out.blocks[2]!.instructions.some((op) => op.kind === "element-storage"),
  );
  assert.ok(
    out.blocks[2]!.instructions.some((op) => op.kind === "element-count"),
  );
  const loadOp = out.blocks[4]!.instructions.find(
    (op) => op.kind === "element-load",
  );
  assert.ok(
    loadOp?.kind === "element-load" && loadOp.cachedStorage !== undefined,
  );
});
