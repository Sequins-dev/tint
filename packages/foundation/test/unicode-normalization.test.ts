import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeUnicode } from "../src/unicode/normalization/index.ts";

test("normalization covers recursive decomposition, exclusion, ordering, Hangul and UTF-16", () => {
  const sample = "\u1e9b\u0323";
  assert.equal(normalizeUnicode(sample, "NFC"), "\u1e9b\u0323");
  assert.equal(normalizeUnicode(sample, "NFD"), "\u017f\u0323\u0307");
  assert.equal(normalizeUnicode(sample, "NFKC"), "\u1e69");
  assert.equal(normalizeUnicode(sample, "NFKD"), "s\u0323\u0307");
  assert.equal(normalizeUnicode("A\u030a\u0301"), "\u01fa");
  assert.equal(normalizeUnicode("\uac01", "NFD"), "\u1100\u1161\u11a8");
  assert.equal(normalizeUnicode("\u1100\u1161\u11a8"), "\uac01");
  assert.equal(normalizeUnicode("\u0958"), "\u0915\u093c");
  assert.equal(normalizeUnicode("\u0344"), "\u0308\u0301");
  for (const form of ["NFC", "NFD", "NFKC", "NFKD"])
    assert.equal(normalizeUnicode("\ud800a\udfff", form), "\ud800a\udfff");
  assert.equal(normalizeUnicode("a", "nfc"), undefined);
});

test("long combining runs use bounded table work without stream-safe insertions", () => {
  const count = 1024,
    input = "a" + "\u0301\u0327".repeat(count);
  const original = String.prototype.charCodeAt;
  let reads = 0;
  String.prototype.charCodeAt = function (index: number): number {
    reads++;
    return original.call(this, index);
  };
  let result: string | undefined;
  try {
    result = normalizeUnicode(input, "NFD");
  } finally {
    String.prototype.charCodeAt = original;
  }
  assert.equal(result, "a" + "\u0327".repeat(count) + "\u0301".repeat(count));
  assert.ok(
    reads < input.length * 100,
    `combining lookup work grew too far: ${reads} reads for ${input.length} units`,
  );
});

test("normalization preserves blocking, equal-class order and leading marks", () => {
  assert.equal(normalizeUnicode("A\u034f\u030a"), "A\u034f\u030a");
  assert.equal(normalizeUnicode("\u0301\u0327a", "NFD"), "\u0327\u0301a");
  assert.equal(normalizeUnicode("A\u0305\u030a"), "A\u0305\u030a");
});
