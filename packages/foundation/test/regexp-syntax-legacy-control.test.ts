import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRegExp } from "../src/regexp/syntax/index.ts";
for (const pattern of [
  String.raw`\c`,
  String.raw`\c1`,
  String.raw`\c_`,
  String.raw`\c*`,
  String.raw`[\c]`,
  String.raw`[\c%]`,
  String.raw`[\c0]`,
  String.raw`[\c_]`,
])
  test(`legacy control escape ${pattern}`, () => {
    assert.doesNotThrow(() => new RegExp(pattern));
    assert.throws(() => new RegExp(pattern, "u"), SyntaxError);
    const parsed = parseRegExp(pattern, "");
    assert.ok(parsed.ok, JSON.stringify(parsed));
    const unicode = parseRegExp(pattern, "u");
    assert.equal(unicode.ok, false);
    if (!unicode.ok) assert.equal(unicode.error.kind, "syntax");
  });
test("invalid control escape leaves c as a separate quantifiable atom", () => {
  const parsed = parseRegExp(String.raw`\c*`, "");
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.value.body, {
    kind: "sequence",
    terms: [
      { kind: "character", value: 92 },
      {
        kind: "repeat",
        body: { kind: "character", value: 99 },
        min: 0,
        max: Infinity,
        greedy: true,
      },
    ],
  });
  assert.equal(new RegExp(String.raw`^\c*$`).test("\\"), true);
});
test("invalid class control escape retains both literal characters", () => {
  const parsed = parseRegExp(String.raw`[\c%]`, "");
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.value.body, {
    kind: "class",
    inverted: false,
    entries: [
      { kind: "range", from: 92, to: 92 },
      { kind: "range", from: 99, to: 99 },
      { kind: "range", from: 37, to: 37 },
    ],
  });
});
