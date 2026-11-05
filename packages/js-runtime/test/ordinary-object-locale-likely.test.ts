import { test } from "node:test";
import assert from "node:assert/strict";
import {
  maximizeLocaleId,
  minimizeLocaleId,
} from "../src/objects/locale-likely.ts";
import { canonicalizeLocaleId } from "../src/objects/locale-canonicalization.ts";
import { localeLikelySubtags } from "../src/objects/locale-data.ts";

test("likely subtags fill missing language, script and region while preserving explicit fields", () => {
  for (const [source, expected] of [
    ["zh", "zh-Hans-CN"],
    ["zh-TW", "zh-Hant-TW"],
    ["zh-Hant", "zh-Hant-TW"],
    ["en-GB", "en-Latn-GB"],
    ["und-TW", "zh-Hant-TW"],
    ["zh-Zzzz-SG", "zh-Hans-SG"],
    ["en-ZZ", "en-Latn-US"],
    ["abcdefgh", "abcdefgh"],
    ["abcdefgh-Latn-US", "abcdefgh-Latn-US"],
    [
      "iw-fonipa-u-ca-gregory-t-de-x-foo",
      "he-Hebr-IL-fonipa-t-de-u-ca-gregory-x-foo",
    ],
  ])
    assert.equal(maximizeLocaleId(source!), expected, source);
});

test("minimization favors region and preserves variants and extensions", () => {
  for (const [source, expected] of [
    ["zh-Hans-CN", "zh"],
    ["zh-Hant-TW", "zh-TW"],
    ["zh-Hant", "zh-TW"],
    ["de-Latn-DE", "de"],
    ["en-Latn-GB-fonipa-u-ca-gregory", "en-GB-fonipa-u-ca-gregory"],
    ["abcdefgh", "abcdefgh"],
  ])
    assert.equal(minimizeLocaleId(source!), expected, source);
});

test("invalid identifiers remain invalid in likely-subtag operations", () => {
  assert.equal(maximizeLocaleId("en_US"), undefined);
  assert.equal(minimizeLocaleId("x-private"), undefined);
});

test("every pinned CLDR likely-subtag mapping expands correctly and survives minimization", () => {
  let count = 0;
  for (const row of localeLikelySubtags.split("\n")) {
    const [source, target] = row.split("|");
    assert.ok(source && target, row);
    const expected = canonicalizeLocaleId(target);
    assert.equal(maximizeLocaleId(source), expected, source);
    const minimal = minimizeLocaleId(source);
    assert.ok(minimal, source);
    assert.equal(maximizeLocaleId(minimal), expected, "roundtrip: " + source);
    count++;
  }
  assert.equal(count, 7868);
});
