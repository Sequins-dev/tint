import assert from "node:assert/strict";
import test from "node:test";
import type { Type } from "../src/types/index.ts";
import { createDiscriminantIndex } from "../src/types/discriminants.ts";
const types: Type[] = [
  { kind: "literal", value: "left" },
  { kind: "literal", value: "right" },
  { kind: "string" },
  { kind: "object", properties: [{ name: "kind", type: 0, readonly: true }] },
  { kind: "object", properties: [{ name: "kind", type: 1, readonly: true }] },
  {
    kind: "object",
    properties: [
      { name: "kind", type: 0, readonly: true },
      { name: "value", type: 2, readonly: true },
    ],
  },
  { kind: "union", members: [4, 3, 5] },
  { kind: "object", properties: [{ name: "kind", type: 2, readonly: true }] },
  {
    kind: "object",
    properties: [{ name: "kind", type: 0, readonly: true, optional: true }],
  },
  { kind: "union", members: [3, 8] },
  { kind: "union", members: [2, 3] },
  { kind: "literal", value: "other" },
  { kind: "object", properties: [{ name: "kind", type: 11, readonly: true }] },
];
test("discriminants preserve every possible matching variant and its order", () => {
  const index = createDiscriminantIndex(types);
  assert.deepEqual(index.candidates(3, 6), [3, 5]);
  assert.deepEqual(index.candidates(5, 6), [3, 5]);
  assert.deepEqual(index.candidates(4, 6), [4]);
  assert.deepEqual(index.candidates(12, 6), []);
  assert.equal(index.candidates(7, 6), undefined);
  assert.equal(index.candidates(8, 6), undefined);
  assert.equal(index.candidates(6, 6), undefined);
});
test("unproven and optional discriminants retain the general relation path", () => {
  const index = createDiscriminantIndex(types);
  for (const union of [9, 10, 3, 100])
    assert.equal(index.candidates(3, union), undefined);
  assert.equal(index.candidates(100, 6), undefined);
});
test("append-only graphs reuse immutable union indexes without losing new unions", () => {
  const graph = types.slice(),
    index = createDiscriminantIndex(graph);
  const original = index.candidates(3, 6);
  graph.push({ kind: "union", members: [5, 4, 3] });
  assert.deepEqual(index.candidates(3, 13), [5, 3]);
  assert.equal(index.candidates(3, 6), original);
});
