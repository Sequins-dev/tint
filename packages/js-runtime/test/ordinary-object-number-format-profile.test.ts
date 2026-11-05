import { test } from "node:test";
import assert from "node:assert/strict";

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  createNumberFormatProfile,
  lookupNumberFormatLocale,
  numberFormatLocaleData,
  type NumberSymbols,
} from "../src/objects/number-format-profile.ts";
import {
  numberFormatLocaleRows,
  numberFormatProfiles,
  numberFormatBindings,
  numberingSystemDigits,
} from "../src/objects/number-format-data.ts";

test("numeric profiles resolve genuine Indian grouping with a complete digit mapping", () => {
  const profile = createNumberFormatProfile("en-IN", "beng");
  assert.ok(profile);
  assert.equal(profile.primaryGrouping, 3);
  assert.equal(profile.secondaryGrouping, 2);
  assert.equal(profile.digits, "০১২৩৪৫৬৭৮৯");
});

const symbolNames: readonly (keyof NumberSymbols)[] = [
  "decimal",
  "group",
  "percentSign",
  "plusSign",
  "minusSign",
  "exponential",
  "infinity",
  "nan",
  "approximatelySign",
  "currencyDecimal",
  "currencyGroup",
];

test("every numeric locale/system profile matches independent ElementTree extraction", () => {
  const locales = numberFormatLocaleRows
    .split("\n")
    .map((row) => {
      const result = lookupNumberFormatLocale(row.slice(0, row.indexOf("|")));
      assert.ok(result);
      return result;
    })
    .sort();
  assert.equal(locales.length, 860);
  assert.equal(new Set(locales).size, 860);
  const hash = createHash("sha256");
  let count = 0;
  for (const locale of locales) {
    const metadata = numberFormatLocaleData(locale);
    assert.ok(metadata);
    assert.equal(metadata.numberingSystems.length, 78);
    assert.deepEqual(
      metadata.numberingSystems,
      metadata.numberingSystems.slice().sort(),
    );
    for (const system of metadata.numberingSystems) {
      const profile = createNumberFormatProfile(locale, system);
      assert.ok(profile);
      assert.equal(profile.locale, locale);
      assert.equal(profile.numberingSystem, system);
      const digits = [...profile.digits];
      assert.equal(digits.length, 10);
      assert.equal(new Set(digits).size, 10);
      const row = [
        locale,
        system,
        metadata.defaultNumberingSystem,
        profile.digits,
        ...symbolNames.map((name) => profile.symbols[name]),
        profile.primaryGrouping,
        profile.secondaryGrouping,
        profile.minimumGroupingDigits,
        profile.pattern,
      ];
      hash.update(JSON.stringify(row) + "\n");
      count++;
    }
  }
  assert.equal(count, 67080);
  // Independent Python ElementTree extractor over the pinned CLDR49 archive;
  // this covers every symbol, digit map, grouping value and locale assignment.
  assert.equal(
    hash.digest("hex"),
    "c959e343c6d96d0373b07970f20e9129d7008e755941d5eaf71c125810c0deea",
  );
});

test("numeric locale availability and explicit numbering-system selection remain distinct", () => {
  assert.equal(lookupNumberFormatLocale("ar-EG-u-nu-latn"), "ar-EG");
  assert.equal(lookupNumberFormatLocale("en-x-u-test"), "en");
  assert.equal(
    lookupNumberFormatLocale("fr-CA-a-test-u-nu-arab-x-foo"),
    "fr-CA",
  );
  assert.equal(lookupNumberFormatLocale("zxx"), undefined);
  assert.equal(lookupNumberFormatLocale("zz-ZZ"), undefined);
  assert.equal(createNumberFormatProfile("zxx", "latn"), undefined);
  assert.equal(createNumberFormatProfile("en", "roman"), undefined);
  assert.equal(createNumberFormatProfile("en", "armn"), undefined);
  assert.equal(numberFormatLocaleData("ar-EG")?.defaultNumberingSystem, "arab");
  assert.equal(createNumberFormatProfile("ar-EG")?.numberingSystem, "arab");
  assert.equal(
    createNumberFormatProfile("ar-EG", "latn")?.numberingSystem,
    "latn",
  );
  // The adapter, not data lookup, owns Unicode-extension option negotiation.
  assert.equal(
    createNumberFormatProfile("ar-EG-u-nu-latn")?.numberingSystem,
    "arab",
  );
});

test("container aliases preserve language symbols and complete unusual grouping metadata", () => {
  const bengali = createNumberFormatProfile("de", "beng"),
    toki = createNumberFormatProfile("tok", "latn"),
    posix = createNumberFormatProfile("en-US-POSIX", "latn"),
    ewe = createNumberFormatProfile("ee", "latn");
  assert.ok(bengali && toki && posix && ewe);
  assert.equal(bengali.symbols.decimal, ",");
  assert.equal(bengali.symbols.group, ".");
  assert.equal(toki.primaryGrouping, 2);
  assert.equal(toki.secondaryGrouping, 2);
  assert.equal(posix.primaryGrouping, 0);
  assert.equal(posix.secondaryGrouping, 0);
  assert.equal(ewe.minimumGroupingDigits, 3);
});

test("all pinned draft grades and non-digit symbol characters are retained", () => {
  assert.equal(
    createNumberFormatProfile("fr", "arab")?.symbols.minusSign,
    "\u200f−",
  );
  assert.equal(
    createNumberFormatProfile("fr", "arabext")?.symbols.minusSign,
    "\u200e−",
  );
  assert.ok(
    createNumberFormatProfile("lo", "latn")?.symbols.nan.includes("\u200b"),
  );
  const adlam = createNumberFormatProfile("en", "adlm");
  assert.ok(adlam);
  assert.equal(adlam.digits.length, 20);
  assert.equal([...adlam.digits].length, 10);
  assert.equal(
    createNumberFormatProfile("en", "hanidec")?.digits,
    "〇一二三四五六七八九",
  );
});

test("decoded availability results are fresh and do not expose shared tables", () => {
  const first = numberFormatLocaleData("en"),
    second = numberFormatLocaleData("en");
  assert.ok(first && second);
  assert.notEqual(first, second);
  assert.notEqual(first.numberingSystems, second.numberingSystems);
  assert.deepEqual(first, second);
  const a = createNumberFormatProfile("en", "latn"),
    b = createNumberFormatProfile("en", "latn");
  assert.ok(a && b);
  assert.notEqual(a, b);
  assert.notEqual(a.symbols, b.symbols);
  assert.deepEqual(a, b);
});

test("numeric metadata is packed and matches its complete pinned input provenance", () => {
  assert.equal(numberFormatProfiles.split("\n").length, 143);
  assert.equal(numberFormatBindings.split("\n").length, 107);
  assert.equal(numberingSystemDigits.split("\n").length, 78);
  const manifest = JSON.parse(
    readFileSync(
      new URL("../number-format-data-manifest.json", import.meta.url),
      "utf8",
    ),
  ) as {
    inputs: readonly { path: string; sha256: string }[];
    counts: {
      localeSystemPairs: number;
      numericSystems: number;
      algorithmicSystems: number;
      availableLocales: number;
    };
    policy: { grades: string };
    output: { sha256: string };
  };
  const source = readFileSync(
    new URL("../src/objects/number-format-data.ts", import.meta.url),
  );
  assert.equal(
    createHash("sha256").update(source).digest("hex"),
    manifest.output.sha256,
  );
  assert.equal(manifest.inputs.length, 931);
  assert.equal(new Set(manifest.inputs.map((row) => row.path)).size, 931);
  assert.equal(
    manifest.inputs.filter((row) => row.path.startsWith("common/main/")).length,
    929,
  );
  for (const input of manifest.inputs)
    assert.match(input.sha256, /^[0-9a-f]{64}$/);
  assert.equal(manifest.counts.localeSystemPairs, 72462);
  assert.equal(manifest.counts.numericSystems, 78);
  assert.equal(manifest.counts.algorithmicSystems, 19);
  assert.equal(manifest.counts.availableLocales, 860);
  assert.match(manifest.policy.grades, /all pinned CLDR draft grades/);
});
