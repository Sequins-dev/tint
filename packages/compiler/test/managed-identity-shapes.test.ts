import { test } from "node:test";
import assert from "node:assert/strict";
import * as compiler from "../src/native/index.ts";
import type { RecordLayout } from "@tint/ir/scalar";
const layout: RecordLayout = {
  byteLength: 64,
  fields: [
    { offset: 16, type: "reference", mutable: false },
    { offset: 24, type: "general", mutable: true },
    { offset: 40, type: "optional-number", mutable: true, presenceOffset: 56 },
  ],
};
test("identity readable windows derive from the physical descriptor shape rather than object size", () => {
  assert.equal(typeof compiler.managedIdentityByteLength, "function");
  assert.equal(
    compiler.managedIdentityByteLength({
      role: "function-brand",
      parameters: [],
      returnType: undefined,
    }),
    32,
  );
  assert.equal(
    compiler.managedIdentityByteLength({
      role: "signature",
      parameters: ["string", "general"],
      returnType: "number",
    }),
    48,
  );
  assert.equal(
    compiler.managedIdentityByteLength({
      role: "record",
      recordLayout: layout,
      parameters: [],
      returnType: undefined,
    }),
    40,
  );
  assert.notEqual(
    compiler.managedIdentityByteLength({
      role: "record",
      recordLayout: layout,
      parameters: [],
      returnType: undefined,
    }),
    layout.byteLength,
  );
  for (const value of [
    { role: "record" as const, parameters: [], returnType: undefined },
    {
      role: "record" as const,
      parameters: [],
      returnType: undefined,
      recordLayout: { ...layout, byteLength: 24 },
    },
    {
      role: "function-brand" as const,
      parameters: ["number" as const],
      returnType: undefined,
    },
    { role: "signature" as const, parameters: [], returnType: undefined },
  ])
    assert.equal(compiler.managedIdentityByteLength(value), undefined);
});
test("shared managed record comparison preserves field order, presence and mutability", () => {
  assert.equal(typeof compiler.sameManagedRecordLayout, "function");
  assert.equal(
    compiler.sameManagedRecordLayout(layout, {
      ...layout,
      fields: layout.fields.map((field) => ({ ...field })),
    }),
    true,
  );
  assert.equal(compiler.sameManagedRecordLayout(undefined, undefined), true);
  assert.equal(compiler.sameManagedRecordLayout(layout, undefined), false);
  for (const changed of [
    { ...layout, fields: layout.fields.slice().reverse() },
    { ...layout, byteLength: 80 },
    {
      ...layout,
      fields: layout.fields.map((field, index) =>
        index === 0 ? { ...field, mutable: !field.mutable } : field,
      ),
    },
  ])
    assert.equal(compiler.sameManagedRecordLayout(layout, changed), false);
});
