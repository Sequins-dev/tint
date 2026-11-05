import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canonicalizeLocaleId } from "../src/objects/locale-canonicalization.ts";
import {
  localeLikelySubtags,
  localeSubdivisionAliases,
  localeTypeAliases,
} from "../src/objects/locale-data.ts";

test("locale canonicalization applies context-sensitive aliases and Unicode type data", () => {
  const cases = [
    ["EN-latn-us", "en-Latn-US"],
    ["iw-IL", "he-IL"],
    ["sh-Cyrl", "sr-Cyrl"],
    ["hy-arevmda", "hyw"],
    ["ja-Latn-hepburn-heploc", "ja-Latn-alalc97"],
    ["en-u-ca-islamicc", "en-u-ca-islamic-civil"],
    ["en-u-ca-ethiopic-amete-alem", "en-u-ca-ethioaa"],
    ["en-u-kn-yes", "en-u-kn"],
    ["en-u-ka-yes", "en-u-ka-yes"],
    ["en-u-foo-foo-ca-buddhist-ca-gregory", "en-u-foo-ca-buddhist"],
    ["en-t-iw-m0-names", "en-t-he-m0-prprname"],
    ["en-t-m0-true", "en-t-m0-true"],
    ["hy-SU", "hy-AM"],
    ["az-NT", "az-SA"],
    ["und-u-rg-fi01", "und-u-rg-axzzzz"],
    ["en-x-u-a-a-1", "en-x-u-a-a-1"],
    [
      "en-u-ca-islamicc-t-iw-a-foo-x-BAR",
      "en-a-foo-t-he-u-ca-islamic-civil-x-bar",
    ],
  ];
  for (const [source, expected] of cases) {
    assert.equal(canonicalizeLocaleId(source!), expected, source);
    assert.equal(canonicalizeLocaleId(expected!), expected, expected);
  }
});

test("invalid locale identifiers are not repaired by canonicalization", () => {
  for (const source of ["en_US", "i-klingon", "en-u-a0-foo", "en-rozaj-ROZAJ"])
    assert.equal(canonicalizeLocaleId(source), undefined, source);
});

test("territory aliases do not infer a different language from an unknown language's script", () => {
  for (const source of ["qaa-Armn-SU", "zz-Armn-SU", "zz-Geor-SU"])
    assert.equal(
      canonicalizeLocaleId(source),
      source.replace(/SU$/, "RU"),
      source,
    );
  assert.equal(canonicalizeLocaleId("hy-Armn-SU"), "hy-Armn-AM");
});

test("canonicalization matches every official pinned CLDR 49 corpus vector", () => {
  const corpus = readFileSync(
    new URL("./fixtures/locale-canonicalization.txt", import.meta.url),
    "utf8",
  );
  let count = 0;
  for (const line of corpus.split("\n")) {
    const content = line.split("#")[0]!.trim();
    if (content === "") continue;
    const [source, expected] = content
      .split(";")
      .map((value) => value.trim().replaceAll("_", "-"));
    assert.ok(source && expected, content);
    assert.equal(canonicalizeLocaleId(source), expected, source);
    assert.equal(
      canonicalizeLocaleId(expected),
      expected,
      "idempotence: " + expected,
    );
    count++;
  }
  assert.equal(count, 1777);
});

test("generated lookup tables have unique strictly sorted keys", () => {
  for (const table of [
    localeLikelySubtags,
    localeSubdivisionAliases,
    localeTypeAliases,
  ]) {
    let previous = "";
    for (const row of table.split("\n")) {
      const key = row.slice(0, row.indexOf("|"));
      assert.ok(key > previous, key);
      previous = key;
    }
  }
});
