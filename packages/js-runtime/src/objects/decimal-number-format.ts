import {
  partitionCurrencyNumber,
  type CurrencyNumberConfiguration,
  type CurrencyNumberOptions,
} from "./currency-number.ts";
import type { DecimalQuantity } from "@tint/foundation/numeric/number-text";
import {
  appendString,
  createStringBuilder,
  finishString,
} from "@tint/foundation/text/string-builder";
import {
  createNumberFormatProfile,
  type NumberFormatProfile,
} from "./number-format-profile.ts";
import {
  decodeNumberingDigits,
  partitionDecimalNumber,
  type DecimalNumberPart,
  type NumberGrouping,
  type NumberSignDisplay,
  type DecimalGrouping,
} from "./decimal-number-parts.ts";
import {
  formatIntlDecimal,
  type NumberFormatDigitOptions,
} from "./intl-number-options.ts";

import {
  createNumberAffixProfile,
  percentUnitPattern,
  type NumberAffixProfile,
  type NumberAffixPattern,
  type PercentUnitWidth,
} from "./number-affixes.ts";
import {
  renderNumberAffixes,
  renderPercentUnit,
} from "./number-affix-rendering.ts";
import {
  createPluralRuleSet,
  createPluralOperands,
  selectPluralCategory,
  type PluralRuleSet,
  type PluralCategory,
} from "./plural-rules.ts";

export type DecimalNumberStyle = "decimal" | "percent" | "unit" | "currency";
export type {
  NumberGrouping,
  NumberSignDisplay,
} from "./decimal-number-parts.ts";
/** Standard-decimal configuration and an embedding-owned callable cache. Keeping
 * that cache unknown avoids coupling the pure formatter to the Script object ABI. */
export interface DecimalNumberFormatter {
  readonly currency: CurrencyNumberConfiguration | undefined;
  readonly locale: string;
  readonly style: DecimalNumberStyle;
  readonly unitDisplay: PercentUnitWidth;
  readonly affixProfile: NumberAffixProfile | undefined;
  readonly pluralRules: PluralRuleSet | undefined;
  readonly numberingSystem: string;
  readonly profile: NumberFormatProfile;
  readonly digits: string[];
  readonly digitOptions: NumberFormatDigitOptions;
  readonly useGrouping: NumberGrouping;
  readonly signDisplay: NumberSignDisplay;
  boundFormat: unknown;
}
export function createDecimalNumberFormatter(
  locale: string,
  numberingSystem: string | undefined,
  digitOptions: NumberFormatDigitOptions,
  useGrouping: NumberGrouping,
  signDisplay: NumberSignDisplay,
  style: DecimalNumberStyle = "decimal",
  unitDisplay: PercentUnitWidth = "short",
  currencyOptions: CurrencyNumberOptions | undefined = undefined,
): DecimalNumberFormatter | undefined {
  const profile = createNumberFormatProfile(locale, numberingSystem);
  if (profile === undefined) return undefined;
  const digits = decodeNumberingDigits(profile.digits);
  if (digits === undefined) throw "NUMBER_FORMAT_DIGITS_INVARIANT";
  const affixProfile =
    style === "percent" || style === "currency"
      ? createNumberAffixProfile(locale, profile.numberingSystem)
      : undefined;
  const pluralRules =
    style === "unit" ? createPluralRuleSet(locale, "cardinal") : undefined;
  if (style === "percent" && affixProfile === undefined)
    throw "NUMBER_PERCENT_PROFILE_INVARIANT";
  if (style === "unit" && pluralRules === undefined)
    throw "NUMBER_UNIT_PLURAL_RULES_INVARIANT";
  let currency: CurrencyNumberConfiguration | undefined = undefined;
  if (style === "currency") {
    if (affixProfile === undefined || currencyOptions === undefined)
      throw "NUMBER_CURRENCY_CONFIGURATION_INVARIANT";
    currency = {
      code: currencyOptions.code,
      display: currencyOptions.display,
      sign: currencyOptions.sign,
      label: currencyOptions.label,
      profile: affixProfile,
    };
  }
  return {
    currency,
    locale,
    style,
    unitDisplay,
    affixProfile,
    pluralRules,
    numberingSystem: profile.numberingSystem,
    profile,
    digits,
    digitOptions,
    useGrouping,
    signDisplay,
    boundFormat: undefined,
  };
}
/** Exact percent scaling precedes numerical rounding; zero retains its canonical
 * exponent and negative sign. Nonfinite inputs are never arithmetically scaled. */
function percentQuantity(value: DecimalQuantity): DecimalQuantity {
  if (value.kind !== "finite" || value.digits === "0") return value;
  const exponent = value.exponent + 2;
  if (!Number.isSafeInteger(exponent)) throw "PERCENT_EXPONENT_INVARIANT";
  return {
    kind: "finite",
    negative: value.negative,
    digits: value.digits,
    exponent,
  };
}
function numericParts(
  formatter: DecimalNumberFormatter,
  value: DecimalQuantity,
  text: string,
  pattern: NumberAffixPattern | undefined,
  signDisplay: NumberSignDisplay,
): DecimalNumberPart[] {
  const grouping: DecimalGrouping = {
    primaryGrouping:
      pattern === undefined
        ? formatter.profile.primaryGrouping
        : pattern.primaryGrouping,
    secondaryGrouping:
      pattern === undefined
        ? formatter.profile.secondaryGrouping
        : pattern.secondaryGrouping,
    minimumGroupingDigits: formatter.profile.minimumGroupingDigits,
  };
  return partitionDecimalNumber(
    value,
    text,
    formatter.profile.symbols,
    formatter.digits,
    grouping,
    formatter.useGrouping,
    signDisplay,
  );
}
export function decimalNumberParts(
  formatter: DecimalNumberFormatter,
  value: DecimalQuantity,
): DecimalNumberPart[] {
  const input = formatter.style === "percent" ? percentQuantity(value) : value;
  const rounded =
    input.kind === "finite"
      ? formatIntlDecimal(input, formatter.digitOptions)
      : undefined;
  if (input.kind === "finite" && rounded === undefined)
    throw "NUMBER_FORMAT_ROUNDING_INVARIANT";
  const quantity = rounded === undefined ? input : rounded.quantity,
    text = rounded === undefined ? "" : rounded.text;
  if (formatter.style === "currency") {
    const currency = formatter.currency;
    if (currency === undefined) throw "NUMBER_CURRENCY_CONFIGURATION_INVARIANT";
    return partitionCurrencyNumber(
      currency,
      quantity,
      text,
      formatter.profile,
      formatter.digits,
      formatter.useGrouping,
      formatter.signDisplay,
    );
  }
  if (formatter.style === "percent") {
    const profile = formatter.affixProfile;
    if (profile === undefined) throw "NUMBER_PERCENT_PROFILE_INVARIANT";
    const core = numericParts(
      formatter,
      quantity,
      text,
      profile.percent,
      "never",
    );
    return renderNumberAffixes(
      profile.percent,
      quantity,
      formatter.signDisplay,
      core,
      formatter.profile.symbols,
    );
  }
  const core = numericParts(
    formatter,
    quantity,
    text,
    undefined,
    formatter.signDisplay,
  );
  if (formatter.style !== "unit") return core;
  let category: PluralCategory = "other";
  if (quantity.kind === "finite") {
    const rules = formatter.pluralRules,
      operands = createPluralOperands(text);
    if (rules === undefined || operands === undefined)
      throw "NUMBER_UNIT_PLURAL_OPERANDS_INVARIANT";
    category = selectPluralCategory(rules, operands);
  }
  const template = percentUnitPattern(
    formatter.locale,
    formatter.unitDisplay,
    category,
  );
  if (template === undefined) throw "NUMBER_PERCENT_UNIT_TEMPLATE_INVARIANT";
  return renderPercentUnit(
    template,
    core,
    formatter.profile.symbols.percentSign,
  );
}
export function formatDecimalNumber(
  formatter: DecimalNumberFormatter,
  value: DecimalQuantity,
): string {
  const builder = createStringBuilder();
  for (const part of decimalNumberParts(formatter, value)) {
    if (part === undefined) throw "NUMBER_FORMAT_PART_INVARIANT";
    appendString(builder, part.value);
  }
  return finishString(builder);
}
