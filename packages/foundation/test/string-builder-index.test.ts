import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createStringBuilder,
  appendString,
  finishString,
} from "../src/text/string-builder.ts";
test("balanced accumulation preserves chunk order and UTF-16 code units", () => {
  const builder = createStringBuilder();
  const chunks = ["", "abc", "😀", "\ud800", "x", "\udc00", "é"];
  let expected = "";
  for (let i = 0; i < 20000; i++) {
    const chunk = chunks[i % chunks.length]!;
    appendString(builder, chunk);
    expected += chunk;
    if (i % 997 === 0) assert.equal(finishString(builder), expected);
  }
  assert.equal(finishString(builder), expected);
  assert.equal(finishString(builder), expected);
  assert.ok(builder.parts.length <= 15);
  appendString(builder, "tail");
  assert.equal(finishString(builder), expected + "tail");
});
test("empty chunks and snapshots do not consume the builder", () => {
  const builder = createStringBuilder();
  assert.equal(finishString(builder), "");
  appendString(builder, "");
  appendString(builder, "a");
  const snapshot = finishString(builder);
  appendString(builder, "b");
  assert.equal(snapshot, "a");
  assert.equal(finishString(builder), "ab");
});
