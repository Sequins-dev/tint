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
