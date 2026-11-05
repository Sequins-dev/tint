import type { NumberSignDisplay } from "../src/objects/decimal-number-parts.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { decimalFromNumber } from "@tint/foundation/numeric/number-text";
import * as currency from "../src/objects/currency-number.ts";
import { createNumberAffixProfile } from "../src/objects/number-affixes.ts";
import { createNumberFormatProfile } from "../src/objects/number-format-profile.ts";

function parts(
  locale: string,
  label: string,
  amount: number,
  sign: NumberSignDisplay = "auto",
  accounting = false,
) {
  const profile = createNumberFormatProfile(locale)!;
  return currency.partitionCurrencyNumber(
    {
      code: "ZZZ",
      display: "code",
      sign: accounting ? "accounting" : "standard",
      label,
      profile: createNumberAffixProfile(locale, profile.numberingSystem)!,
    },
    decimalFromNumber(amount),
    String(Math.abs(amount)),
    profile,
    ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"],
    false,
    sign,
  );
}
test("currency numbers preserve real patterns, spacing and accounting plus layout", () => {
  assert.equal(
    parts("en", "$", 12)
      .map((x) => x.value)
      .join(""),
    "$12",
  );
  assert.equal(
    parts("en", "ZZZ", 12)
      .map((x) => x.value)
      .join(""),
    "ZZZ 12",
  );
  assert.equal(
    parts("de", "€", -12)
      .map((x) => x.value)
      .join(""),
    "-12 €",
  );
  assert.equal(
    parts("en", "$", -12, "auto", true)
      .map((x) => x.value)
      .join(""),
    "($12)",
  );
  assert.equal(
    parts("en", "$", 12, "always", true)
      .map((x) => x.value)
      .join(""),
    "+$12",
  );
  assert.equal(
    parts("en", "ZZZ", NaN)
      .map((x) => x.value)
      .join(""),
    "ZZZNaN",
  );
  assert.deepEqual(
    parts("en", "ZZZ", 12).map((x) => x.type),
    ["currency", "literal", "integer"],
  );
});
