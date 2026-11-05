import assert from "node:assert/strict";
import test from "node:test";
import { createTypeIdentityIndex } from "../src/types/identities.ts";
import type { Type } from "../src/types/index.ts";

test("exact type identities retain original IDs and distinguish contracts", () => {
  const types: Type[] = [
    { kind: "number" },
    { kind: "number" },
    { kind: "object", properties: [{ name: "x", type: 0, readonly: false }] },
    { kind: "object", properties: [{ name: "x", type: 0, readonly: false }] },
    { kind: "object", properties: [{ name: "x", type: 0, readonly: true }] },
    {
      kind: "object",
      properties: [{ name: "x", type: 0, readonly: false, optional: true }],
    },
    { kind: "array", element: 0, readonly: false },
    { kind: "array", element: 1, readonly: false },
  ];
  const before = structuredClone(types),
    intern = createTypeIdentityIndex(types);
  assert.deepEqual(
    types.map((_, id) => intern(id)),
    [0, 0, 2, 2, 4, 5, 6, 7],
  );
  assert.deepEqual(types, before);
  types.push({
    kind: "object",
    properties: [{ name: "x", type: 0, readonly: false }],
  });
  assert.equal(intern(8), 2);
});

test("identity hash collisions never merge unequal literal types", () => {
  const types: Type[] = [
    { kind: "literal", value: 1 },
    { kind: "literal", value: 4294967297 },
    { kind: "literal", value: 1 },
  ];
  const intern = createTypeIdentityIndex(types);
  assert.deepEqual(
    types.map((_, id) => intern(id)),
    [0, 1, 0],
  );
});

test("recursive references and ordered union/function contracts remain exact", () => {
  const types: Type[] = [
    { kind: "object", properties: [{ name: "next", type: 0, readonly: true }] },
    { kind: "object", properties: [{ name: "next", type: 0, readonly: true }] },
    { kind: "union", members: [0, 1] },
    { kind: "union", members: [1, 0] },
    { kind: "function", parameters: [0], result: 0 },
    { kind: "function", parameters: [0], result: 0, minimumArguments: 1 },
    { kind: "function", parameters: [0], result: 0, minimumArguments: 0 },
  ];
  const intern = createTypeIdentityIndex(types);
  assert.deepEqual(
    types.map((_, id) => intern(id)),
    [0, 0, 2, 3, 4, 4, 6],
  );
});

test("object identity distinguishes independent call and construct signatures", () => {
  const types: Type[] = [
    { kind: "number" },
    { kind: "function", parameters: [], result: 0 },
    { kind: "object", properties: [] },
    { kind: "object", properties: [], call: 1 },
    { kind: "object", properties: [], construct: 1 },
    { kind: "object", properties: [], call: 1, construct: 1 },
    { kind: "object", properties: [], construct: 1 },
  ];
  const intern = createTypeIdentityIndex(types);
  assert.deepEqual(
    types.map((_, id) => intern(id)),
    [0, 1, 2, 3, 4, 5, 4],
  );
});
