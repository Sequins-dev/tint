import assert from "node:assert/strict";
import test from "node:test";
import { createKeyIndex } from "@tint/foundation/collections/key-index";
import { syntaxHash, type Span } from "../src/syntax/index.ts";

test("syntax indexes distinguish repeated traversal ordinals across source spans", () => {
  const nodes: Span[] = [];
  for (let module = 0; module < 256; module++)
    for (let local = 0; local < 64; local++) {
      const start = (module * 131 + local * 17) % 50000;
      nodes.push({ start, end: start + 1 + (module % 19), nodeHash: local });
    }
  let comparisons = 0;
  const index = createKeyIndex<Span, number>(syntaxHash, (left, right) => {
    comparisons++;
    return left === right;
  });
  for (let position = 0; position < nodes.length; position++)
    index.set(nodes[position]!, position);
  for (let position = 0; position < nodes.length; position++)
    assert.equal(index.get(nodes[position]!), position);
  assert.ok(
    comparisons < nodes.length * 12,
    `${comparisons} equality checks for ${nodes.length} independently located nodes`,
  );
});

test("syntax hashes remain stable and leave source spans unchanged", () => {
  for (const node of [
    { start: 0, end: 0 },
    { start: 5, end: 30, nodeHash: 0 },
    { start: 5, end: 30, nodeHash: 2147483648 },
    { start: 4294967295, end: 4294967295, nodeHash: 4294967295 },
  ]) {
    const before = { ...node },
      first = syntaxHash(node);
    assert.equal(syntaxHash(node), first);
    assert.equal(first >>> 0, first);
    assert.deepEqual(node, before);
  }
});
