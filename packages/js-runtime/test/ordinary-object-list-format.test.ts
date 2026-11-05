import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { canonicalizeLocaleId } from "../src/objects/locale-canonicalization.ts";
import {
  listFormatLocales,
  listFormatCanonicalPrefixes,
} from "../src/objects/list-format-data.ts";
import {
  createListFormatter,
  lookupListFormatLocale,
  formatListParts,
  formatList,
  type ListFormatType,
  type ListFormatter,
  type ListFormatPart,
} from "../src/objects/list-format.ts";

test("service locale lookup supports actual patterns and canonical prefix fallback", () => {
  assert.equal(lookupListFormatLocale("en-US-u-ca-gregory"), "en-US");
  assert.equal(lookupListFormatLocale("fr-CA-x-test"), "fr-CA");
  assert.equal(lookupListFormatLocale("zxx"), undefined);
});

test("list patterns preserve elements and distinguish English regional punctuation", () => {
  const en = createListFormatter("en", "conjunction", "long");
  const gb = createListFormatter("en-GB", "conjunction", "long");
  assert.ok(en && gb);
  assert.equal(formatList(en, ["A", "B", "C"]), "A, B, and C");
  assert.equal(formatList(gb, ["A", "B", "C"]), "A, B and C");
  assert.deepEqual(formatListParts(en, ["", "{0}"]), [
    { type: "element", value: "" },
    { type: "literal", value: " and " },
    { type: "element", value: "{0}" },
  ]);
  assert.deepEqual(formatListParts(en, [""]), [{ type: "element", value: "" }]);
  assert.deepEqual(formatListParts(en, []), []);
});

test("Spanish contexts use canonical prefixes and exact grouped integer spelling", () => {
  for (const [locale, type, value, expected] of [
    ["es", "conjunction", "iglesia", "A e iglesia"],
    ["es", "conjunction", "hijos", "A e hijos"],
    ["es", "conjunction", "hielo", "A y hielo"],
    ["es", "conjunction", "hiato", "A y hiato"],
    ["es", "conjunction", "Ítaca", "A e Ítaca"],
    ["es", "conjunction", "híbrido", "A e híbrido"],
    ["es", "conjunction", "hi\u0301brido", "A e hi\u0301brido"],
    ["es", "disjunction", "Ópera", "A u Ópera"],
    ["es", "disjunction", "8", "A u 8"],
    ["es", "disjunction", "11.000", "A u 11.000"],
    ["es-MX", "disjunction", "11,000", "A u 11,000"],
    ["es", "disjunction", "111", "A o 111"],
    ["es", "disjunction", " 8", "A o  8"],
  ] as const) {
    const formatter = createListFormatter(
      locale,
      type satisfies ListFormatType,
      "long",
    );
    assert.ok(formatter);
    assert.equal(formatList(formatter, ["A", value]), expected);
  }
});

test("Hebrew conjunction uses Unicode script rather than a narrow letter range", () => {
  const formatter = createListFormatter("he", "conjunction", "long");
  assert.ok(formatter);
  assert.equal(formatList(formatter, ["A", "B"]), "A ו-B");
  assert.equal(formatList(formatter, ["A", "ב"]), "A וב");
  assert.equal(formatList(formatter, ["A", "\u05b0"]), "A ו\u05b0");
  assert.equal(formatList(formatter, ["A", "😀"]), "A ו-😀");
});

/** Independent specification-style right fold, distinct from the production
 * append-only linearization. Neutral final elements leave context rules aside. */
function referenceParts(
  formatter: ListFormatter,
  values: readonly string[],
): readonly ListFormatPart[] {
  if (values.length === 0) return [];
  let result: ListFormatPart[] = [{ type: "element", value: values.at(-1)! }];
  for (let index = values.length - 2; index >= 0; index--) {
    const pattern =
      values.length === 2
        ? formatter.pair
        : index === 0
          ? formatter.start
          : index === values.length - 2
            ? formatter.end
            : formatter.middle;
    const next: ListFormatPart[] = [];
    let previous = 0;
    for (const token of pattern.matchAll(/\{([01])\}/g)) {
      if (token.index > previous)
        next.push({
          type: "literal",
          value: pattern.slice(previous, token.index),
        });
      if (token[1] === "0")
        next.push({ type: "element", value: values[index]! });
      else next.push(...result);
      previous = token.index + 3;
    }
    if (previous < pattern.length)
      next.push({ type: "literal", value: pattern.slice(previous) });
    result = next;
  }
  return result;
}

test("every supported locale and style agrees with independent template folding", () => {
  let count = 0;
  for (const row of listFormatLocales.split("\n")) {
    const locale = canonicalizeLocaleId(row.slice(0, row.indexOf("|")));
    assert.ok(locale);
    assert.equal(lookupListFormatLocale(locale), locale);
    for (const type of ["conjunction", "disjunction", "unit"] as const) {
      for (const style of ["long", "short", "narrow"] as const) {
        const formatter = createListFormatter(locale, type, style);
        assert.ok(formatter);
        for (const values of [
          [],
          [""],
          ["A", ""],
          ["{0}", "B", ""],
          ["A", "B", "C", "D", "א"],
        ]) {
          const expected = referenceParts(formatter, values);
          assert.deepEqual(
            formatListParts(formatter, values),
            expected,
            locale + "/" + type + "/" + style,
          );
          assert.equal(
            formatList(formatter, values),
            expected.map((part) => part.value).join(""),
          );
          count++;
        }
      }
    }
  }
  assert.equal(count, 33705);
});

test("all generated canonical prefixes choose equivalent Spanish separators without changing elements", () => {
  for (const type of ["conjunction", "disjunction"] as const) {
    const formatter = createListFormatter("es", type, "long");
    assert.ok(formatter);
    for (const row of listFormatCanonicalPrefixes.split("\n")) {
      const separator = row.indexOf("|"),
        point = Number(row.slice(0, separator));
      const original = String.fromCodePoint(point) + "x",
        decomposed = row.slice(separator + 1) + "x";
      const a = formatListParts(formatter, ["A", original]),
        b = formatListParts(formatter, ["A", decomposed]);
      assert.deepEqual(
        a.filter((part) => part.type === "literal"),
        b.filter((part) => part.type === "literal"),
        row,
      );
      assert.equal(a.at(-1)?.value, original);
      assert.equal(b.at(-1)?.value, decomposed);
    }
  }
});

test("generated ListFormat source matches its pinned-data provenance manifest", () => {
  const manifest = JSON.parse(
    readFileSync(
      new URL("../list-format-data-manifest.json", import.meta.url),
      "utf8",
    ),
  );
  const source = readFileSync(
    new URL("../src/objects/list-format-data.ts", import.meta.url),
  );
  assert.equal(
    createHash("sha256").update(source).digest("hex"),
    manifest.outputSha256,
  );
  assert.equal(manifest.counts.availableLocales, 749);
  assert.equal(manifest.counts.patterns, 329);
});
