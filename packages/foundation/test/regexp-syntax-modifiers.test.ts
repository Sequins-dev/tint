import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRegExp } from "../src/regexp/syntax/index.ts";
for (const prefix of [
  "i",
  "m",
  "s",
  "ims",
  "i-m",
  "-ims",
  "im-s",
  "i-",
  "s-im",
])
  test(`modifier group ${prefix}`, () => {
    const pattern = `(?${prefix}:a.(b))`;
    assert.doesNotThrow(() => new RegExp(pattern, "u"));
    const result = parseRegExp(pattern, "u");
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.value.captures, 1);
    const body = result.value.body;
    assert.equal(body.kind, "modifiers");
    if (body.kind === "modifiers") {
      const [enabled, disabled = ""] = prefix.split("-");
      assert.equal(body.enable, enabled);
      assert.equal(body.disable, disabled);
    }
  });
for (const prefix of [
  "-",
  "ii",
  "mm",
  "ss",
  "i-i",
  "im-m",
  "-ii",
  "g",
  "u",
  "v",
  "d",
  "y",
  "I",
  "i--m",
  "is-sm",
  "i m",
])
  test(`invalid modifier group ${prefix}`, () => {
    const pattern = `(?${prefix}:a)`;
    assert.throws(() => new RegExp(pattern), SyntaxError);
    const result = parseRegExp(pattern, "");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, "syntax");
  });
for (const pattern of ["(?i)", "(?i-a)", "(?i", "(?i:a"])
  test(`incomplete modifier group ${pattern}`, () => {
    assert.throws(() => new RegExp(pattern), SyntaxError);
    const result = parseRegExp(pattern, "");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, "syntax");
  });
test("nested modifier groups preserve their local flag operations", () => {
  const result = parseRegExp("(?i:a(?-i:b))c", "m");
  assert.ok(result.ok);
  assert.equal(result.value.flags.ignoreCase, false);
  assert.equal(result.value.flags.multiline, true);
  const body = result.value.body;
  assert.equal(body.kind, "sequence");
  if (body.kind !== "sequence") return;
  const outer = body.terms[0];
  assert.equal(outer?.kind, "modifiers");
  if (outer?.kind !== "modifiers") return;
  assert.equal(outer.enable, "i");
  assert.equal(outer.body.kind, "sequence");
  if (outer.body.kind !== "sequence") return;
  const inner = outer.body.terms[1];
  assert.equal(inner?.kind, "modifiers");
  if (inner?.kind !== "modifiers") return;
  assert.equal(inner.enable, "");
  assert.equal(inner.disable, "i");
});
