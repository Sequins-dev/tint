import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  decimalFromString,
  type DecimalQuantity,
} from "@tint/foundation/numeric/number-text";
import {
  createDecimalNumberFormatter,
  decimalNumberParts,
} from "../src/objects/decimal-number-format.ts";
import { resolveNumberFormatDigitOptions } from "../src/objects/intl-number-options.ts";
import { numberFormatLocaleData } from "../src/objects/number-format-profile.ts";
import { numberFormatLocaleRows } from "../src/objects/number-format-data.ts";
import {
  decimalNumberRangeParts,
  formatDecimalNumberRange,
  numberRangeSeparator,
  type NumberRangePart,
} from "../src/objects/number-ranges.ts";
import {
  numberRangeSeparators,
  numberRangeBindings,
  numberRangeLocales,
} from "../src/objects/number-range-data.ts";

function quantity(text: string): DecimalQuantity {
  if (text === "Infinity" || text === "-Infinity")
    return {
      kind: "infinity",
      negative: text.charAt(0) === "-",
      digits: "0",
      exponent: 0,
    };
  const value = decimalFromString(text);
  assert.ok(value);
  return value;
}
function formatter(locale: string, signDisplay: "auto" | "never" = "auto") {
  const digits = resolveNumberFormatDigitOptions(
    {
      read: () => undefined,
      number: Number,
      string: String,
      reject: (kind) => {
        throw new Error(kind);
      },
    },
    0,
    3,
    "standard",
  );
  const result = createDecimalNumberFormatter(
    locale,
    undefined,
    digits,
    "auto",
    signDisplay,
  );
  assert.ok(result);
  return result;
}

test("decimal ranges preserve exact endpoint values, locale separators and source records", () => {
  const f = formatter("en");
  assert.deepEqual(decimalNumberRangeParts(f, quantity("1"), quantity("2")), [
    { type: "integer", value: "1", source: "startRange" },
    { type: "literal", value: "–", source: "shared" },
    { type: "integer", value: "2", source: "endRange" },
  ] satisfies NumberRangePart[]);
  assert.equal(
    formatDecimalNumberRange(
      f,
      quantity("987654321987654321"),
      quantity("987654321987654322"),
    ),
    "987,654,321,987,654,321–987,654,321,987,654,322",
  );
  assert.equal(
    formatDecimalNumberRange(formatter("pt-PT"), quantity("1"), quantity("2")),
    "1 - 2",
  );
  assert.equal(
    formatDecimalNumberRange(formatter("ja"), quantity("1"), quantity("2")),
    "1～2",
  );
});

test("range approximation compares formatted strings including signs and rounding", () => {
  const f = formatter("en");
  assert.deepEqual(
    decimalNumberRangeParts(f, quantity("2.9999"), quantity("3.0001")),
    [
      { type: "approximatelySign", value: "~", source: "shared" },
      { type: "integer", value: "3", source: "shared" },
    ] satisfies NumberRangePart[],
  );
  assert.equal(
    formatDecimalNumberRange(f, quantity("0"), quantity("-0")),
    "0–-0",
  );
  assert.equal(
    formatDecimalNumberRange(
      formatter("en", "never"),
      quantity("0"),
      quantity("-0"),
    ),
    "~0",
  );
  assert.equal(
    formatDecimalNumberRange(formatter("fr"), quantity("1"), quantity("1")),
    "≃1",
  );
  assert.equal(
    formatDecimalNumberRange(formatter("ja"), quantity("1"), quantity("1")),
    "約1",
  );
  assert.equal(
    formatDecimalNumberRange(f, quantity("Infinity"), quantity("Infinity")),
    "~∞",
  );
});

test("reversed, infinite and negative ranges retain endpoint meaning", () => {
  const f = formatter("en");
  assert.equal(
    formatDecimalNumberRange(f, quantity("2"), quantity("1")),
    "2–1",
  );
  assert.equal(
    formatDecimalNumberRange(f, quantity("-2"), quantity("-1")),
    "-2 – -1",
  );
  assert.equal(
    formatDecimalNumberRange(f, quantity("Infinity"), quantity("-Infinity")),
    "∞–-∞",
  );
  assert.throws(() =>
    decimalNumberRangeParts(
      f,
      { kind: "nan", negative: false, digits: "0", exponent: 0 },
      quantity("1"),
    ),
  );
});

test("range result mutations cannot alter later results or formatter configuration", () => {
  const f = formatter("en"),
    x = quantity("1"),
    y = quantity("2");
  const a = decimalNumberRangeParts(f, x, y),
    b = decimalNumberRangeParts(f, x, y);
  assert.notEqual(a, b);
  for (let i = 0; i < a.length; i++) assert.notEqual(a[i], b[i]);
  a.splice(0, a.length);
  assert.equal(formatDecimalNumberRange(f, x, y), "1–2");
});

test("all numeric locale/system range mappings match independent CLDR extraction", () => {
  const locales = numberFormatLocaleRows
    .split("\n")
    .map((row) => row.slice(0, row.indexOf("|")));
  assert.equal(locales.length, 860);
  assert.deepEqual(
    numberRangeLocales.split("\n").map((row) => row.slice(0, row.indexOf("|"))),
    locales,
  );
  const hash = createHash("sha256");
  let count = 0;
  for (const locale of locales) {
    const metadata = numberFormatLocaleData(locale);
    assert.ok(metadata);
    for (const system of metadata.numberingSystems) {
      const separator = numberRangeSeparator(locale, system);
      assert.notEqual(separator, undefined);
      hash.update(JSON.stringify([locale, system, separator]) + "\n");
      count++;
    }
  }
  assert.equal(count, 67080);
  // Independent Python ElementTree extraction of CLDR49, resolved through the
  // numeric registry's structural owners; includes every locale/system pair.
  assert.equal(
    hash.digest("hex"),
    "447d87b2e73231f19532f1c6f6690753f867d1e5e614a3591edfc3c8ad6369f6",
  );
  assert.equal(numberRangeSeparator("en-u-nu-beng", "beng"), "–");
  assert.equal(numberRangeSeparator("zxx", "latn"), undefined);
  assert.equal(numberRangeSeparator("en", "roman"), undefined);
});

test("all supported default profiles preserve range source invariants across 6880 endpoint pairs", () => {
  const pairs = [
    ["1", "2"],
    ["-2", "-1"],
    ["2", "1"],
    ["0", "-0"],
    ["2.9999", "3.0001"],
    ["Infinity", "Infinity"],
    ["Infinity", "-Infinity"],
    ["987654321987654321", "987654321987654322"],
  ];
  let count = 0;
  for (const row of numberFormatLocaleRows.split("\n")) {
    const locale = row.slice(0, row.indexOf("|")),
      f = formatter(locale),
      separator = numberRangeSeparator(locale, f.numberingSystem);
    assert.ok(separator);
    for (const pair of pairs) {
      const x = quantity(pair[0]!),
        y = quantity(pair[1]!);
      const left = decimalNumberParts(f, x),
        right = decimalNumberParts(f, y);
      const leftText = left.map((p) => p.value).join(""),
        rightText = right.map((p) => p.value).join("");
      const parts = decimalNumberRangeParts(f, x, y);
      if (leftText === rightText) {
        assert.ok(parts.every((p) => p.source === "shared"));
        assert.equal(
          parts.map((p) => p.value).join(""),
          f.profile.symbols.approximatelySign + leftText,
        );
      } else {
        // Shared affixes belong to both endpoints; the separator belongs to
        // neither. Reconstruct each displayed endpoint independently of whether
        // presentation chooses to collapse its complete modifiers.
        const separators: { part: NumberRangePart; index: number }[] = parts
          .map((part, index) => ({ part, index }))
          .filter(
            ({ part }) =>
              part.type === "literal" &&
              part.source === "shared" &&
              [
                separator,
                " " + separator,
                separator + " ",
                " " + separator + " ",
              ].includes(part.value),
          );
        assert.equal(separators.length, 1, `${locale}/${pair}/separator`);
        const index: number = separators[0]!.index;
        for (const [source, expected] of [
          ["startRange", leftText],
          ["endRange", rightText],
        ] as const) {
          assert.equal(
            parts
              .filter(
                (part, at) =>
                  part.source === source ||
                  (part.source === "shared" && at !== index),
              )
              .map((part) => part.value)
              .join(""),
            expected,
            `${locale}/${pair}/${source}`,
          );
        }
      }
      assert.equal(
        formatDecimalNumberRange(f, x, y),
        parts.map((p) => p.value).join(""),
      );
      count++;
    }
  }
  assert.equal(count, 6880);
});

test("range data retains pinned numeric owners and formatted output provenance", () => {
  const manifest = JSON.parse(
    readFileSync(
      new URL("../number-range-data-manifest.json", import.meta.url),
      "utf8",
    ),
  );
  const source = readFileSync(
    new URL("../src/objects/number-range-data.ts", import.meta.url),
  );
  assert.equal(
    createHash("sha256").update(source).digest("hex"),
    manifest.output.sha256,
  );
  assert.equal(manifest.counts.advertisedLocaleSystemPairs, 67080);
  assert.equal(manifest.counts.rawLocaleSystemPairs, 72462);
  assert.equal(numberRangeSeparators.split("\n").length, 10);
  assert.equal(
    numberRangeBindings.split("\n").length,
    manifest.counts.bindingMaps,
  );
  const owners = new Map(
    numberRangeLocales.split("\n").map((row) => {
      const split = row.indexOf("|");
      return [row.slice(0, split), row.slice(split + 1).split(",")[0]];
    }),
  );
  const numericBytes = readFileSync(
    new URL("../number-format-data-manifest.json", import.meta.url),
  );
  assert.equal(
    createHash("sha256").update(numericBytes).digest("hex"),
    manifest.registry.sha256,
  );
  const numeric = JSON.parse(numericBytes.toString("utf8"));
  const numericSource = readFileSync(
    new URL("../src/objects/number-format-data.ts", import.meta.url),
  );
  assert.equal(
    createHash("sha256").update(numericSource).digest("hex"),
    manifest.registry.source.sha256,
  );
  const aliases = new Map<string, string>(
    numeric.aliases.map((row: { locale: string; source: string }) => [
      row.locale,
      row.source,
    ]),
  );
  for (const locale of owners.keys()) {
    let owner = locale;
    const seen = new Set<string>();
    while (aliases.has(owner)) {
      assert.equal(seen.has(owner), false);
      seen.add(owner);
      owner = aliases.get(owner)!;
    }
    assert.equal(owners.get(locale), owner);
  }
});

function currencyRangeFormatter(
  locale: string,
  label: string,
  signDisplay: "auto" | "always" = "auto",
  accounting = false,
  fractionDigits = 0,
) {
  const digits = resolveNumberFormatDigitOptions(
    {
      read: () => undefined,
      number: Number,
      string: String,
      reject: () => {
        throw 1;
      },
    },
    fractionDigits,
    fractionDigits,
    "standard",
  );
  const result = createDecimalNumberFormatter(
    locale,
    undefined,
    digits,
    "auto",
    signDisplay,
    "currency",
    "short",
    {
      code: "USD",
      display: "symbol",
      sign: accounting ? "accounting" : "standard",
      label,
    },
  );
  assert.ok(result);
  return result;
}
test("middle affix AUTO policy collapses full equal modifiers and spaces repeated symbols", () => {
  const usd = currencyRangeFormatter("en", "$");
  assert.equal(
    formatDecimalNumberRange(usd, quantity("3"), quantity("5")),
    "$3 – $5",
  );
  assert.deepEqual(decimalNumberRangeParts(usd, quantity("3"), quantity("5")), [
    { type: "currency", value: "$", source: "startRange" },
    { type: "integer", value: "3", source: "startRange" },
    { type: "literal", value: " – ", source: "shared" },
    { type: "currency", value: "$", source: "endRange" },
    { type: "integer", value: "5", source: "endRange" },
  ]);
  const plus = currencyRangeFormatter("en", "$", "always", false, 2);
  assert.equal(
    formatDecimalNumberRange(plus, quantity("2.9"), quantity("3.1")),
    "+$2.90–3.10",
  );
  assert.deepEqual(
    decimalNumberRangeParts(plus, quantity("2.9"), quantity("3.1")).slice(0, 2),
    [
      { type: "plusSign", value: "+", source: "shared" },
      { type: "currency", value: "$", source: "shared" },
    ],
  );
  assert.equal(
    formatDecimalNumberRange(
      currencyRangeFormatter("pt-PT", "€"),
      quantity("3"),
      quantity("5"),
    ),
    "3 - 5 €",
  );
  assert.equal(
    formatDecimalNumberRange(
      currencyRangeFormatter("en", "💰"),
      quantity("3"),
      quantity("5"),
    ),
    "💰3 – 💰5",
  );
});
test("range affixes preserve complete sign pairs, accounting literals and endpoint ownership", () => {
  const decimal = formatter("en");
  assert.equal(
    formatDecimalNumberRange(decimal, quantity("-3"), quantity("-1")),
    "-3 – -1",
  );
  assert.equal(
    formatDecimalNumberRange(decimal, quantity("3"), quantity("-1")),
    "3–-1",
  );
  assert.equal(
    formatDecimalNumberRange(decimal, quantity("-3"), quantity("1")),
    "-3 – 1",
  );
  const f = currencyRangeFormatter("en", "$", "auto", true);
  assert.equal(
    formatDecimalNumberRange(f, quantity("-3"), quantity("-5")),
    "($3–5)",
  );
  const mixed = decimalNumberRangeParts(f, quantity("-3"), quantity("5"));
  assert.equal(mixed.map((x) => x.value).join(""), "($3) – $5");
  assert.ok(
    mixed.some(
      (x) =>
        x.type === "literal" && x.value === ")" && x.source === "startRange",
    ),
  );
  assert.ok(
    mixed.some(
      (x) => x.type === "literal" && x.value === " – " && x.source === "shared",
    ),
  );
  const pt = decimalNumberRangeParts(
    currencyRangeFormatter("pt-PT", "€"),
    quantity("1"),
    quantity("2"),
  );
  assert.deepEqual(pt.slice(-2), [
    { type: "literal", value: " ", source: "shared" },
    { type: "currency", value: "€", source: "shared" },
  ]);
});

test("range presentation keeps direction controls, existing thin spaces and unit-layer boundaries", () => {
  const directional = currencyRangeFormatter("en", "\u200f$");
  const parts = decimalNumberRangeParts(
    directional,
    quantity("3"),
    quantity("5"),
  );
  assert.equal(parts.map((x) => x.value).join(""), "\u200f$3–5");
  assert.deepEqual(parts.slice(0, 2), [
    { type: "literal", value: "\u200f", source: "shared" },
    { type: "currency", value: "$", source: "shared" },
  ]);
  assert.equal(
    formatDecimalNumberRange(formatter("mk"), quantity("-3"), quantity("-1")),
    "-3 – -1",
  );
  const digits = resolveNumberFormatDigitOptions(
    {
      read: () => undefined,
      number: Number,
      string: String,
      reject: () => {
        throw 1;
      },
    },
    0,
    0,
    "standard",
  );
  const unit = createDecimalNumberFormatter(
    "en",
    undefined,
    digits,
    "auto",
    "auto",
    "unit",
    "long",
  )!;
  assert.equal(
    formatDecimalNumberRange(unit, quantity("-3"), quantity("-1")),
    "-3 percent–-1 percent",
  );
});
