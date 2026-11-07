import assert from "node:assert/strict";
import test from "node:test";
import { compareCollation } from "../src/objects/collation-engine.ts";
const root = {
  profile: "root/standard",
  sensitivity: "variant",
  caseFirst: "false",
  numeric: false,
  ignorePunctuation: false,
} as const;
test("root ordering, decomposition and discontiguous contractions", () => {
  assert.ok(compareCollation("a", "b", root) < 0);
  assert.ok(compareCollation("a", "A", root) < 0);
  assert.equal(compareCollation("ä\u0323", "a\u0323\u0308", root), 0);
  assert.equal(compareCollation("\u1111\u1171\u11b6", "퓛", root), 0);
  assert.ok(compareCollation("🈷", "⺝", root) < 0);
});
test("sensitivity and caseFirst retain the correct comparison levels", () => {
  assert.equal(
    compareCollation("áA", "Aa", { ...root, sensitivity: "base" }),
    0,
  );
  assert.equal(
    compareCollation("áA", "aA", { ...root, sensitivity: "accent" }),
    1,
  );
  assert.equal(
    compareCollation("Aã", "Aa", { ...root, sensitivity: "case" }),
    0,
  );
  assert.notEqual(
    compareCollation("aA", "Aa", { ...root, sensitivity: "case" }),
    0,
  );
  assert.ok(compareCollation("A", "a", { ...root, caseFirst: "upper" }) < 0);
  assert.ok(compareCollation("A", "a", { ...root, caseFirst: "lower" }) > 0);
});
test("numeric ordering uses arbitrary-length decimal runs in every Nd block", () => {
  const options = { ...root, numeric: true };
  assert.ok(compareCollation("2", "10", options) < 0);
  assert.equal(compareCollation("000٢", "２", options), 0);
  assert.ok(
    compareCollation("9".repeat(300), "1" + "0".repeat(300), options) < 0,
  );
  assert.ok(compareCollation("2a", "2b", options) < 0);
  assert.ok(compareCollation("2", "²", options) < 0);
});
test("punctuation shifting includes expansions and primary-ignorable followers", () => {
  const options = { ...root, ignorePunctuation: true };
  assert.equal(compareCollation("a- b", "ab", options), 0);
  assert.equal(compareCollation("", "*", options), 0);
  assert.equal(compareCollation("", "-\u0301", options), 0);
  assert.notEqual(compareCollation("a$b", "ab", options), 0);
});

test("root references replace only the selected fields and preserve script boundaries", () => {
  assert.ok(compareCollation("⺝", "月\u0301", root) > 0);
  assert.ok(compareCollation("🈷", "月\u0301", root) < 0);
  assert.ok(compareCollation("\ufdd1L", "A", root) < 0);
  assert.ok(compareCollation("\ufdd1Ω", "Ω", root) < 0);
});

test("implicit Han values follow their group boundary", () => {
  assert.ok(compareCollation("\ufdd1字", "一", root) < 0);
});
