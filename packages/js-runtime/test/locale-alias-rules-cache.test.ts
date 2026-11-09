import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalizeLocaleId,
  localeAliasRuleSet,
} from "../src/objects/locale-canonicalization.ts";

// The CLDR alias table (~800 rows) is immutable. Re-parsing it on every
// canonicalization made each Intl supportedLocalesOf call cost ~7.7e7 native
// instructions (intl402/supportedLocalesOf-unicode-extensions-ignored.js,
// 23,040 calls, timed out). It is parsed once and reused.
test("locale alias rules are parsed once and shared", () => {
  const first = localeAliasRuleSet();
  assert.ok(first.length > 700);
  assert.equal(localeAliasRuleSet(), first);
});
test("canonicalization results are unchanged by the shared rule set", () => {
  for (const [input, expected] of [
    ["en-us", "en-US"],
    ["iw", "he"],
    ["sh", "sr-Latn"],
    ["zh-hakka", "hak"],
    ["und-x-private", "und-x-private"],
    ["de-u-co-phonebk-nu-latn", "de-u-co-phonebk-nu-latn"],
    ["sgn-GR", "gss"],
    ["en-u-nu-invalid", "en-u-nu-invalid"],
  ] as const) {
    assert.equal(canonicalizeLocaleId(input), expected, input);
    assert.equal(canonicalizeLocaleId(input), expected, input + " (repeat)");
  }
});
