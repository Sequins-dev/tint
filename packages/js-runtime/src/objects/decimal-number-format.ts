import {
  createUnitFormatProfile,
  unitFormatPattern,
  type UnitFormatProfile,
} from "./unit-format.ts";
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
  type NumberNotation,
} from "./intl-number-options.ts";

import {
  createNumberAffixProfile,
  percentUnitPattern,
  type NumberAffixProfile,
  type NumberAffixPattern,
  type NumberUnitWidth,
} from "./number-affixes.ts";
import {
  renderNumberAffixes,
  renderPercentUnit,
  renderUnitPattern,
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
  readonly unitDisplay: NumberUnitWidth;
  readonly unit: string;
  readonly unitProfile: UnitFormatProfile | undefined;
  readonly affixProfile: NumberAffixProfile | undefined;
  readonly pluralRules: PluralRuleSet | undefined;
  readonly numberingSystem: string;
  readonly profile: NumberFormatProfile;
  readonly digits: string[];
  readonly digitOptions: NumberFormatDigitOptions;
  readonly useGrouping: NumberGrouping;
  readonly signDisplay: NumberSignDisplay;
  readonly notation: NumberNotation;
  readonly compactDisplay: "short" | "long";
  boundFormat: unknown;
}
export function createDecimalNumberFormatter(
  locale: string,
  numberingSystem: string | undefined,
  digitOptions: NumberFormatDigitOptions,
  useGrouping: NumberGrouping,
  signDisplay: NumberSignDisplay,
  style: DecimalNumberStyle = "decimal",
  unitDisplay: NumberUnitWidth = "short",
  currencyOptions: CurrencyNumberOptions | undefined = undefined,
  unit: string = "percent",
  notation: NumberNotation = "standard",
  compactDisplay: "short" | "long" = "short",
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
  const unitProfile =
    style === "unit" && unit !== "percent"
      ? createUnitFormatProfile(locale)
      : undefined;
  if (style === "unit" && unit !== "percent" && unitProfile === undefined)
    throw "NUMBER_UNIT_PROFILE_INVARIANT";
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
    unit,
    unitProfile,
    affixProfile,
    pluralRules,
    numberingSystem: profile.numberingSystem,
    profile,
    digits,
    digitOptions,
    useGrouping,
    signDisplay,
    notation,
    compactDisplay,
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
/** Exact multiplication by 10^places; zero and nonfinite values are unchanged. */
function shiftQuantity(
  value: DecimalQuantity,
  places: number,
): DecimalQuantity {
  if (value.kind !== "finite" || value.digits === "0" || places === 0)
    return value;
  const exponent = value.exponent + places;
  if (!Number.isSafeInteger(exponent))
    throw "NUMBER_NOTATION_EXPONENT_INVARIANT";
  return {
    kind: "finite",
    negative: value.negative,
    digits: value.digits,
    exponent,
  };
}
/** floor(log10(|value|)) for a finite nonzero quantity. */
function magnitudeOf(value: DecimalQuantity): number {
  return value.digits.length - 1 + value.exponent;
}
/** ComputeExponentForMagnitude for scientific and engineering notation. */
function exponentForMagnitude(
  formatter: DecimalNumberFormatter,
  magnitude: number,
): number {
  if (formatter.notation === "scientific") return magnitude;
  if (formatter.notation === "engineering")
    return Math.floor(magnitude / 3) * 3;
  return 0;
}
/** ComputeExponent: rounding can carry into the next magnitude (9.99 -> 10),
 * so the exponent is chosen again from the rounded result. */
function computeExponent(
  formatter: DecimalNumberFormatter,
  value: DecimalQuantity,
): number {
  if (value.kind !== "finite" || value.digits === "0") return 0;
  const magnitude = magnitudeOf(value),
    exponent = exponentForMagnitude(formatter, magnitude);
  const rounded = formatIntlDecimal(
    shiftQuantity(value, -exponent),
    formatter.digitOptions,
  );
  if (rounded === undefined) throw "NUMBER_FORMAT_ROUNDING_INVARIANT";
  if (rounded.quantity.digits === "0") return exponent;
  if (magnitudeOf(rounded.quantity) === magnitude - exponent) return exponent;
  return exponentForMagnitude(formatter, magnitude + 1);
}
/** The exponent subpattern of the locale's scientific format: separator,
 * a minus sign for negative exponents and localized exponent digits. */
function exponentParts(
  formatter: DecimalNumberFormatter,
  exponent: number,
): DecimalNumberPart[] {
  const parts: DecimalNumberPart[] = [
    { type: "exponentSeparator", value: formatter.profile.symbols.exponential },
  ];
  if (exponent < 0)
    parts.push({
      type: "exponentMinusSign",
      value: formatter.profile.symbols.minusSign,
    });
  const text = String(Math.abs(exponent));
  let digits = "";
  for (let i = 0; i < text.length; i++) {
    const digit = formatter.digits[text.charCodeAt(i) - 48];
    if (digit === undefined) throw "NUMBER_EXPONENT_DIGIT_INVARIANT";
    digits += digit;
  }
  parts.push({ type: "exponentInteger", value: digits });
  return parts;
}
export function decimalNumberParts(
  formatter: DecimalNumberFormatter,
  value: DecimalQuantity,
): DecimalNumberPart[] {
  const scaledInput =
    formatter.style === "percent" ? percentQuantity(value) : value;
  const exponent =
    formatter.notation === "scientific" || formatter.notation === "engineering"
      ? computeExponent(formatter, scaledInput)
      : 0;
  const input = shiftQuantity(scaledInput, -exponent);
  const suffix =
    input.kind === "finite" &&
    (formatter.notation === "scientific" ||
      formatter.notation === "engineering")
      ? exponentParts(formatter, exponent)
      : [];
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
      suffix,
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
    for (const part of suffix) core.push(part);
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
  for (const part of suffix) core.push(part);
  if (formatter.style !== "unit") return core;
  let category: PluralCategory = "other";
  if (quantity.kind === "finite") {
    const rules = formatter.pluralRules,
      operands = createPluralOperands(text);
    if (rules === undefined || operands === undefined)
      throw "NUMBER_UNIT_PLURAL_OPERANDS_INVARIANT";
    category = selectPluralCategory(rules, operands);
  }
  if (formatter.unit === "percent") {
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
  const profile = formatter.unitProfile,
    template =
      profile === undefined
        ? undefined
        : unitFormatPattern(
            profile,
            formatter.unitDisplay,
            formatter.unit,
            category,
          );
  if (template === undefined) throw "NUMBER_UNIT_TEMPLATE_INVARIANT";
  return renderUnitPattern(template, core);
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
