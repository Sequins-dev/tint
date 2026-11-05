import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createFunctionBuilder,
  verify,
  type RecordLayout,
} from "@tint/ir/scalar";
import * as api from "../src/closure/lowering/index.ts";
const span = { start: 0, end: 1 };
const records: RecordLayout[] = [
  {
    byteLength: 32,
    fields: [{ offset: 24, stateOffset: 16, type: "reference", mutable: true }],
  },
  {
    byteLength: 48,
    fields: [
      { offset: 16, type: "reference", mutable: false },
      { offset: 32, stateOffset: 24, type: "reference", mutable: false },
    ],
  },
  {
    byteLength: 32,
    fields: [{ offset: 16, type: "reference", mutable: false }],
  },
  {
    byteLength: 32,
    fields: [16, 24].map((offset) => ({
      offset,
      type: "reference",
      mutable: false,
    })),
  },
  {
    byteLength: 32,
    fields: [
      { offset: 24, stateOffset: 16, type: "reference", mutable: false },
    ],
  },
];
const plan = {
  id: 0,
  name: "defineC",
  environment: 3,
  prototype: { record: 0, constructorField: 0, methods: [] },
  state: { record: 1, prototypeField: 0, constructionField: 1, methods: [] },
  callTarget: 1,
  construction: { target: 2, record: 2, receiverField: 0, entries: [] },
  statics: { target: 3, record: 2, receiverField: 0, entries: [] },
  innerBinding: { source: 0, record: 4, field: 0 },
  outerBinding: { source: 1, record: 4, field: 0 },
  ...span,
};
const signatures = [
  { parameters: [], returnType: "reference" },
  { parameters: [], returnType: "void" },
  { parameters: [], returnType: "reference" },
  { parameters: [], returnType: "void" },
] as const;
test("class definition connects cyclic state and publishes the outer binding after statics", () => {
  assert.equal(typeof api.buildClassDefinition, "function");
  const fn = api.buildClassDefinition(plan, records, signatures);
  const call = createFunctionBuilder(1, "classCall", [], "void");
  call.end({ kind: "trap", ...span });
  const construct = createFunctionBuilder(2, "construct", [], "reference");
  const env = construct.next();
  construct.emit({ kind: "closure-environment", id: env, ...span });
  construct.end({ kind: "return", value: env, ...span });
  const statics = createFunctionBuilder(3, "statics", [], "void");
  statics.end({ kind: "return", value: undefined, ...span });
  const result = verify({
    records,
    functions: [
      fn,
      { ...call.finish(), closureEnvironment: 1 },
      { ...construct.finish(), closureEnvironment: 2 },
      { ...statics.finish(), closureEnvironment: 2 },
    ],
  });
  assert.ok(result.ok, JSON.stringify(result));
  const initializationBlocks = fn.blocks.filter(
    (b) => b.terminator.kind === "record-cell" && b.terminator.record === 4,
  );
  assert.equal(initializationBlocks.length, 2);
  const staticCall = fn.blocks.find((b) =>
    b.instructions.some((op) => op.kind === "call-indirect" && op.target === 3),
  );
  assert.ok(staticCall);
  // The caller cannot publish its outer cell before a throwing static phase returns.
  assert.equal(staticCall.terminator.kind, "record");
});
