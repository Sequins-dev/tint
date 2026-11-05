import { test } from "node:test";
import assert from "node:assert/strict";

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  createPluralRuleSet,
  createPluralOperands,
  selectPluralCategory,
  selectPluralRange,
  type PluralRuleType,
} from "../src/objects/plural-rules.ts";

test("plural decisions preserve rounded visible fractional zeros", () => {
  const rules = createPluralRuleSet("en", "cardinal");
  assert.ok(rules);
  const integer = createPluralOperands("1"),
    decimal = createPluralOperands("1.00");
  assert.ok(integer && decimal);
  assert.equal(selectPluralCategory(rules, integer), "one");
  assert.equal(selectPluralCategory(rules, decimal), "other");
});

function selected(
  locale: string,
  displayed: string,
  type: PluralRuleType = "cardinal",
  exponent = 0,
): string {
  const rules = createPluralRuleSet(locale, type),
    operands = createPluralOperands(displayed, exponent);
  assert.ok(rules && operands);
  return selectPluralCategory(rules, operands);
}

test("all 3907 CLDR49 sample vectors retain exact visible operands", () => {
  const rows = readFileSync(
    new URL("./fixtures/plural-rule-samples.txt", import.meta.url),
    "utf8",
  )
    .trim()
    .split("\n")
    .slice(1);
  assert.equal(rows.length, 3907);
  for (const row of rows) {
    const [type, locale, expected, sample] = row.split("|");
    assert.ok(type === "cardinal" || type === "ordinal");
    assert.ok(locale && sample);
    const [digits, exponent = "0"] = sample.split("c");
    assert.ok(digits);
    assert.equal(
      selected(locale, digits, type, Number(exponent)),
      expected,
      row,
    );
  }
});

test("fractional range membership is integer-only and negates the entire range", () => {
  for (const n of ["2.5", "3.5", "4.5"])
    assert.equal(selected("cs", n), "many");
  assert.equal(selected("ar", "3.5"), "other");
  assert.equal(selected("ar", "3"), "few");
});

test("huge integer and fraction digits preserve exact plural modulo", () => {
  assert.equal(selected("ru", "9".repeat(100) + "21"), "one");
  assert.equal(selected("ru", "9".repeat(100) + "11"), "many");
  assert.equal(selected("is", "0." + "0".repeat(100) + "21"), "one");
  assert.equal(selected("is", "0." + "0".repeat(100) + "11"), "other");
  assert.equal(selected("lv", "0." + "0".repeat(100) + "11"), "one");
  assert.equal(selected("lv", "0.11"), "zero");
});

test("compact decimal shifts preserve zeroes and avoid exponent-sized allocations", () => {
  assert.deepEqual(createPluralOperands("1.20050", 3), {
    i: "1200",
    integerZeroes: 0,
    f: "50",
    t: "5",
    v: 2,
    w: 1,
    c: 3,
    e: 3,
    fractional: true,
  });
  assert.equal(selected("fr", "1.5", "cardinal", 6), "many");
  assert.equal(selected("fr", "1500000"), "other");
  assert.equal(selected("en", "1", "cardinal", 1_000_000_000), "other");
  assert.equal(selected("fr", "1", "cardinal", 1_000_000_000), "many");
});

test("plural data uses its own parent component rather than formatter parents", () => {
  assert.equal(selected("pt", "0"), "one");
  assert.equal(selected("pt-PT", "0"), "other");
  assert.equal(selected("pt-AO", "0"), "one");
  assert.equal(selected("pt-MZ", "0"), "one");
  assert.equal(selected("pt-Latn-PT", "0"), "other");
  assert.equal(selected("hi-Latn", "0"), "one");
  assert.equal(createPluralRuleSet("zz", "cardinal")?.sourceLocale, "root");
  assert.equal(createPluralRuleSet("en_US", "cardinal"), undefined);
});

test("category order is independent of predicate order and returned per rule set", () => {
  assert.deepEqual(createPluralRuleSet("ar", "cardinal")?.categories, [
    "zero",
    "one",
    "two",
    "few",
    "many",
    "other",
  ]);
  assert.deepEqual(createPluralRuleSet("en", "ordinal")?.categories, [
    "one",
    "two",
    "few",
    "other",
  ]);
  assert.equal(selected("en", "21", "ordinal"), "one");
  assert.equal(selected("en", "12", "ordinal"), "other");
});

test("range matrices and explicit missing-pair policies remain separate from endpoint formatting", () => {
  const en = createPluralRuleSet("en", "cardinal"),
    de = createPluralRuleSet("de", "cardinal"),
    ordinal = createPluralRuleSet("en", "ordinal");
  assert.ok(en && de && ordinal);
  assert.equal(selectPluralRange(en, "other", "one"), "other");
  assert.equal(selectPluralRange(de, "other", "one"), "one");
  assert.equal(selectPluralRange(en, "one", "one"), "one");
  assert.equal(selectPluralRange(ordinal, "few", "one"), "one");
});

test("displayed operand parsing rejects nondecimal syntax and invalid compact exponents", () => {
  for (const input of [
    "",
    "-",
    ".1",
    "1.",
    "1.2.3",
    "1e3",
    "NaN",
    "Infinity",
    " 1",
    "0xff",
  ])
    assert.equal(createPluralOperands(input), undefined, input);
  for (const exp of [-1, 0.5, Infinity, NaN])
    assert.equal(createPluralOperands("1", exp), undefined);
  assert.deepEqual(
    createPluralOperands("-0.00"),
    createPluralOperands("+0.00"),
  );
});

test("generated rule data and sample corpus match pinned provenance", () => {
  const manifest = JSON.parse(
    readFileSync(
      new URL("../plural-rules-data-manifest.json", import.meta.url),
      "utf8",
    ),
  ) as {
    output: { sha256: string };
    fixture: { sha256: string; samples: number };
    parentOverrides: number;
  };
  const source = readFileSync(
      new URL("../src/objects/plural-rule-data.ts", import.meta.url),
    ),
    fixture = readFileSync(
      new URL("./fixtures/plural-rule-samples.txt", import.meta.url),
    );
  assert.equal(
    createHash("sha256").update(source).digest("hex"),
    manifest.output.sha256,
  );
  assert.equal(
    createHash("sha256").update(fixture).digest("hex"),
    manifest.fixture.sha256,
  );
  assert.equal(manifest.fixture.samples, 3907);
  assert.equal(manifest.parentOverrides, 0);
});
