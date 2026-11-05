import { test } from "node:test";
import assert from "node:assert/strict";

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  parseNumberAffixPattern,
  createNumberAffixProfile,
  percentUnitPattern,
  currencyFractionDigits,
} from "../src/objects/number-affixes.ts";
import {
  numberAffixLocaleRows,
  numberAffixPatterns,
  numberAffixProfiles,
  numberAffixBindings,
  percentUnitPatterns,
  percentUnitProfiles,
  currencyFractions,
} from "../src/objects/number-affix-data.ts";
import {
  lookupNumberFormatLocale,
  numberFormatLocaleData,
} from "../src/objects/number-format-profile.ts";

test("affix parsing preserves a percent prefix and the explicit sign position", () => {
  const pattern = parseNumberAffixPattern("% #,#0;% -#,#0");
  assert.ok(pattern);
  assert.equal(pattern.primaryGrouping, 2);
  assert.deepEqual(
    pattern.negative.map((token) => token.kind),
    ["percentSign", "literal", "minusSign", "number"],
  );
});

function locales(): string[] {
  return numberAffixLocaleRows
    .split("\n")
    .map((row) => {
      const tag = lookupNumberFormatLocale(row.slice(0, row.indexOf("|")));
      assert.ok(tag);
      return tag;
    })
    .sort();
}

test("all 67080 advertised affix profiles match independent ElementTree extraction", () => {
  const tags = locales();
  assert.equal(tags.length, 860);
  assert.equal(new Set(tags).size, 860);
  const hash = createHash("sha256");
  let count = 0;
  for (const locale of tags) {
    const metadata = numberFormatLocaleData(locale);
    assert.ok(metadata);
    for (const system of metadata.numberingSystems) {
      const profile = createNumberAffixProfile(locale, system);
      assert.ok(profile);
      const row = [
        locale,
        system,
        profile.percent.source,
        profile.currencyStandard.source,
        profile.currencyAccounting.source,
        profile.currencyAlpha?.source ?? null,
        profile.currencyAccountingAlpha?.source ?? null,
      ];
      hash.update(JSON.stringify(row) + "\n");
      count++;
      for (const pattern of [
        profile.percent,
        profile.currencyStandard,
        profile.currencyAccounting,
        profile.currencyAlpha,
        profile.currencyAccountingAlpha,
      ]) {
        if (pattern === undefined) continue;
        assert.equal(
          pattern.positive.filter((t) => t.kind === "number").length,
          1,
        );
        assert.equal(
          pattern.negative.filter((t) => t.kind === "number").length,
          1,
        );
      }
    }
  }
  assert.equal(count, 67080);
  assert.equal(
    hash.digest("hex"),
    "7ae99382fbc8d48ca8b4ee985ec22a010666a978b83fab1f1c2bb3f467470146",
  );
});

test("all resolved percent unit widths/categories preserve default grammatical forms", () => {
  const hash = createHash("sha256");
  let count = 0;
  for (const locale of locales())
    for (const width of ["long", "short", "narrow"] as const)
      for (const category of [
        "zero",
        "one",
        "two",
        "few",
        "many",
        "other",
      ] as const) {
        const value = percentUnitPattern(locale, width, category);
        assert.notEqual(value, undefined);
        hash.update(JSON.stringify([locale, width, category, value]) + "\n");
        count++;
      }
  assert.equal(count, 15480);
  assert.equal(
    hash.digest("hex"),
    "55bf192c349d2cb15247e1f260f70328d6f357dbb244181416c60ee05cfe4175",
  );
  assert.equal(percentUnitPattern("ro", "long", "one"), "{0} procent");
  assert.equal(percentUnitPattern("fi", "long", "one"), "{0} prosentti");
  assert.equal(percentUnitPattern("en", "long", "other"), "{0} percent");
  assert.equal(percentUnitPattern("en", "short", "one"), "{0}%");
  assert.equal(percentUnitPattern("zxx", "short", "one"), undefined);
});

test("quoted affix punctuation and doubled apostrophes are literal tokens", () => {
  const parsed = parseNumberAffixPattern("'a''b%'0'+';'-'0");
  assert.ok(parsed);
  assert.deepEqual(parsed.positive, [
    { kind: "literal", value: "a'b%" },
    { kind: "number", value: "0" },
    { kind: "literal", value: "+" },
  ]);
  assert.deepEqual(parsed.negative, [
    { kind: "literal", value: "-" },
    { kind: "number", value: "0" },
  ]);
  const literalCurrency = parseNumberAffixPattern("'¤'0");
  assert.ok(literalCurrency);
  assert.equal(literalCurrency.positive[0]?.kind, "literal");
});

test("accounting, signed suffixes and bidi literals retain their exact positions", () => {
  const accounting = parseNumberAffixPattern("‎¤ #,##0.00;‎(¤ #,##0.00)");
  assert.ok(accounting);
  assert.deepEqual(
    accounting.negative.map((t) => t.kind),
    ["literal", "currency", "literal", "number", "literal"],
  );
  assert.equal(accounting.negative[0]?.value, "\u200e(");
  const suffix = parseNumberAffixPattern("¤ #,##0.00;¤ #,##0.00-");
  assert.ok(suffix);
  assert.equal(suffix.negative.at(-1)?.kind, "minusSign");
  const implicit = parseNumberAffixPattern("#,##,##0%");
  assert.ok(implicit);
  assert.equal(implicit.primaryGrouping, 3);
  assert.equal(implicit.secondaryGrouping, 2);
  assert.equal(implicit.negative[0]?.kind, "minusSign");
});

test("unsupported or malformed affix numeric syntax fails without guessing", () => {
  for (const value of [
    "",
    "%",
    "#",
    "0'",
    "0;",
    "0;0;0",
    "0'x'0",
    "#,0#",
    "0.#0",
    "0,,0",
    "0.0.0",
    ".0",
    "0.",
  ])
    assert.equal(parseNumberAffixPattern(value), undefined, value);
  assert.equal(createNumberAffixProfile("zxx", "latn"), undefined);
  assert.equal(createNumberAffixProfile("en", "roman"), undefined);
});

test("every interned pattern is structurally valid and profiles remain native-friendly packed rows", () => {
  assert.equal(numberAffixPatterns.split("\n").length, 45);
  assert.equal(numberAffixProfiles.split("\n").length, 69);
  assert.equal(numberAffixBindings.split("\n").length, 68);
  assert.equal(percentUnitPatterns.split("\n").length, 134);
  assert.equal(percentUnitProfiles.split("\n").length, 107);
  for (const row of numberAffixPatterns.split("\n"))
    assert.ok(parseNumberAffixPattern(row.slice(row.indexOf("|") + 1)), row);
});

test("currency digits use ordinary metadata and leave cash-specific rounding separate", () => {
  assert.equal(currencyFractionDigits("USD"), 2);
  assert.equal(currencyFractionDigits("JPY"), 0);
  assert.equal(currencyFractionDigits("KWD"), 3);
  assert.equal(currencyFractionDigits("CLF"), 4);
  assert.equal(currencyFractionDigits("CHF"), 2);
  assert.equal(currencyFractionDigits("ZZZ"), 2);
  assert.equal(currencyFractions.split("\n").length, 76);
  const all = Object.fromEntries(
    currencyFractions.split("\n").map((row) => {
      const code = row.slice(0, row.indexOf("|"));
      return [code, currencyFractionDigits(code)];
    }),
  );
  assert.equal(
    createHash("sha256").update(JSON.stringify(all)).digest("hex"),
    "9d966f50c5c5edb8448e015970f36474dbb3d6dd61d6166e0cdd1afbf62c6c6d",
  );
});

test("affix metadata pins every input and explicitly excludes grammatical variants", () => {
  const manifest = JSON.parse(
    readFileSync(
      new URL("../number-affix-data-manifest.json", import.meta.url),
      "utf8",
    ),
  ) as {
    inputs: readonly { path: string; sha256: string }[];
    counts: {
      localeSystemPairs: number;
      rawPercentUnitPatterns: number;
      excludedUnitVariants: number;
      currencyFractionRecords: number;
    };
    policy: { units: string };
    output: { sha256: string };
  };
  const source = readFileSync(
    new URL("../src/objects/number-affix-data.ts", import.meta.url),
  );
  assert.equal(
    createHash("sha256").update(source).digest("hex"),
    manifest.output.sha256,
  );
  assert.equal(manifest.inputs.length, 931);
  assert.equal(new Set(manifest.inputs.map((r) => r.path)).size, 931);
  for (const input of manifest.inputs)
    assert.match(input.sha256, /^[0-9a-f]{64}$/);
  assert.equal(manifest.counts.localeSystemPairs, 72462);
  assert.equal(manifest.counts.rawPercentUnitPatterns, 382);
  assert.equal(manifest.counts.excludedUnitVariants, 270);
  assert.equal(manifest.counts.currencyFractionRecords, 76);
  assert.match(
    manifest.policy.units,
    /grammatical case\/gender\/alt variants excluded/,
  );
});
