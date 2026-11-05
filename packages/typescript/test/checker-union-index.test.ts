import { test } from "node:test";
import assert from "node:assert/strict";
import type { Type } from "@tint/typescript/types";
import { createUnionIndex } from "../src/checker/union-index.ts";

test("union index preserves earliest unordered exact membership across appends and hash collisions", () => {
  const types: Type[] = [
    { kind: "number" },
    { kind: "union", members: [1, 4] },
    { kind: "union", members: [2, 3] },
    { kind: "union", members: [4, 1] },
    { kind: "union", members: [1, 1] },
  ];
  const index = createUnionIndex(types);
  assert.equal(index.find([4, 1]), 1);
  assert.equal(index.find([3, 2]), 2);
  assert.equal(index.find([1, 2]), undefined);
  types.push({ kind: "union", members: [1, 2] });
  assert.equal(index.find([2, 1]), 5);
  assert.equal(index.find([1]), undefined);
});
test("indexed unique union queries agree with a full scan", () => {
  const types: Type[] = [];
  const index = createUnionIndex(types);
  for (let n = 0; n < 100; n++) {
    types.push(
      { kind: "number" },
      { kind: "union", members: [n % 13, (n * 3 + 1) % 17] },
    );
    for (let a = 0; a < 17; a++)
      for (let b = a + 1; b < 17; b++) {
        const members = [b, a];
        const found = types.findIndex(
          (t) =>
            t.kind === "union" &&
            t.members.length === members.length &&
            members.every((m) => t.members.includes(m)),
        );
        assert.equal(index.find(members), found < 0 ? undefined : found);
      }
  }
});
