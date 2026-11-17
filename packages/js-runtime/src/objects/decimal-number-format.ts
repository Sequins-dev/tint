import {
  createNumberUnitProfile,
  numberUnitPattern,
  type NumberUnitProfile,
} from "./number-unit.ts";
import { currencyLongName, currencyUnitPattern } from "./currency-names.ts";
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
  createCompactNotationProfile,
  compactExponent,
  compactPattern,
  compactTokens,
  compactCurrencyAffixTokens,
  compactTextParts,
  type CompactNotationProfile,
  type CompactPatternSet,
  type CompactToken,
} from "./number-notation.ts";
import {
  decodeNumberingDigits,
  partitionDecimalNumber,
  appendNumberPart,
  appendNumberSymbol,
  decimalNumberSign,
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
  readonly unitProfile: NumberUnitProfile | undefined;
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
  readonly compactProfile: CompactNotationProfile | undefined;
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
    style === "unit" ||
    notation === "compact" ||
    (style === "currency" &&
      currencyOptions !== undefined &&
      currencyOptions.display === "name")
      ? createPluralRuleSet(locale, "cardinal")
      : undefined;
  const compactProfile =
    notation === "compact"
      ? createCompactNotationProfile(profile.locale, profile.numberingSystem)
      : undefined;
  if (notation === "compact" && compactProfile === undefined)
    throw "NUMBER_COMPACT_PROFILE_INVARIANT";
  if (notation === "compact" && pluralRules === undefined)
    throw "NUMBER_COMPACT_PLURAL_RULES_INVARIANT";
  if (style === "percent" && affixProfile === undefined)
    throw "NUMBER_PERCENT_PROFILE_INVARIANT";
  if (style === "unit" && pluralRules === undefined)
    throw "NUMBER_UNIT_PLURAL_RULES_INVARIANT";
  const unitProfile =
    style === "unit" && unit !== "percent"
      ? createNumberUnitProfile(locale)
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
    compactProfile,
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
  if (formatter.notation === "compact")
    return compactExponent(compactSet(formatter), magnitude);
  return 0;
}
/** Currency uses CLDR's short compact currency patterns for both displays
 * (CLDR has no long currency compact data); other styles follow compactDisplay. */
function compactSet(formatter: DecimalNumberFormatter): CompactPatternSet {
  const profile = formatter.compactProfile;
  if (profile === undefined) throw "NUMBER_COMPACT_PROFILE_INVARIANT";
  if (
    formatter.style === "currency" &&
    formatter.currency !== undefined &&
    formatter.currency.display !== "name"
  )
    return profile.currency;
  return formatter.compactDisplay === "long" ? profile.long : profile.short;
}
/** ComputeExponent: rounding can carry into the next magnitude (9.99 -> 10),
 * so the exponent is chosen again from the rounded result. The signed value is
 * rounded, as V8/ICU do. ECMA-402 step 2 rounds |x| instead, which predates the
 * sign-dependent rounding modes: under ceil or floor it chooses the exponent
 * with the opposite rounding direction from the mantissa, so -9.1 would format
 * as -0E1 (ceil) or -10E0 (floor). See docs/intl-runtime.md. */
function computeExponent(
  formatter: DecimalNumberFormatter,
  value: DecimalQuantity,
): { readonly exponent: number; readonly magnitude: number } {
  if (value.kind !== "finite" || value.digits === "0")
    return { exponent: 0, magnitude: 0 };
  const magnitude = magnitudeOf(value),
    exponent = exponentForMagnitude(formatter, magnitude);
  const rounded = formatIntlDecimal(
    shiftQuantity(value, -exponent),
    formatter.digitOptions,
  );
  if (rounded === undefined) throw "NUMBER_FORMAT_ROUNDING_INVARIANT";
  if (
    rounded.quantity.digits === "0" ||
    magnitudeOf(rounded.quantity) === magnitude - exponent
  )
    return { exponent, magnitude };
  return {
    exponent: exponentForMagnitude(formatter, magnitude + 1),
    magnitude: magnitude + 1,
  };
}
function pluralCategory(
  formatter: DecimalNumberFormatter,
  quantity: DecimalQuantity,
  text: string,
  exponent: number,
): PluralCategory {
  if (quantity.kind !== "finite") return "other";
  const rules = formatter.pluralRules,
    operands = createPluralOperands(text, exponent);
  if (rules === undefined || operands === undefined)
    throw "NUMBER_PLURAL_OPERANDS_INVARIANT";
  return selectPluralCategory(rules, operands);
}
/** currencyDisplay "name": the decimal number (with any notation) inside the
 * locale's currency unit pattern, with the long name for its plural category. */
function currencyNameParts(
  formatter: DecimalNumberFormatter,
  code: string,
  quantity: DecimalQuantity,
  text: string,
  exponent: number,
  pattern: string | undefined,
  suffix: readonly DecimalNumberPart[],
): DecimalNumberPart[] {
  let number: DecimalNumberPart[];
  if (pattern === undefined)
    number = numericParts(
      formatter,
      quantity,
      text,
      undefined,
      formatter.signDisplay,
    );
  else
    number = compactParts(
      formatter,
      compactTokens(
        pattern,
        decimalNumberSign(quantity, formatter.signDisplay) !== 0,
      ),
      quantity,
      numericParts(formatter, quantity, text, undefined, "never"),
      formatter.signDisplay,
    );
  for (const part of suffix) {
    if (part === undefined) throw "NUMBER_NOTATION_PART_INVARIANT";
    number.push(part);
  }
  const category = pluralCategory(formatter, quantity, text, exponent);
  const template = currencyUnitPattern(
    formatter.locale,
    formatter.numberingSystem,
    category,
  );
  const name = currencyLongName(formatter.locale, code, category);
  const parts: DecimalNumberPart[] = [];
  let index = 0;
  while (index < template.length) {
    const open = template.indexOf("{", index);
    const end = open < 0 ? template.length : open;
    if (end > index)
      appendNumberPart(parts, {
        type: "literal",
        value: template.slice(index, end),
      });
    if (open < 0) break;
    const placeholder = template.slice(open, open + 3);
    if (placeholder === "{0}")
      for (const part of number) {
        if (part === undefined) throw "NUMBER_CURRENCY_NAME_PART_INVARIANT";
        appendNumberPart(parts, part);
      }
    else if (placeholder === "{1}")
      appendNumberPart(parts, { type: "currency", value: name });
    else throw "NUMBER_CURRENCY_NAME_TEMPLATE_INVARIANT";
    index = open + 3;
  }
  return parts;
}
/** Render compact pattern tokens around the already-rounded number parts. */
function compactParts(
  formatter: DecimalNumberFormatter,
  tokens: readonly CompactToken[],
  quantity: DecimalQuantity,
  number: readonly DecimalNumberPart[],
  signDisplay: NumberSignDisplay,
): DecimalNumberPart[] {
  const parts: DecimalNumberPart[] = [],
    sign = decimalNumberSign(quantity, signDisplay);
  for (const token of tokens) {
    if (token === undefined) throw "COMPACT_TOKEN_INVARIANT";
    if (token.kind === "number")
      for (const part of number) {
        if (part === undefined) throw "COMPACT_NUMBER_PART_INVARIANT";
        appendNumberPart(parts, part);
      }
    else if (token.kind === "sign") {
      if (sign < 0)
        appendNumberSymbol(
          parts,
          formatter.profile.symbols.minusSign,
          "minusSign",
        );
      else if (sign > 0)
        appendNumberSymbol(
          parts,
          formatter.profile.symbols.plusSign,
          "plusSign",
        );
    } else if (token.kind === "text")
      for (const part of compactTextParts(token.value)) {
        if (part === undefined) throw "COMPACT_TEXT_PART_INVARIANT";
        appendNumberPart(parts, part);
      }
    else throw "COMPACT_CURRENCY_TOKEN_INVARIANT";
  }
  return parts;
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
  const notation = formatter.notation,
    scaled = notation !== "standard",
    exponentRecord = scaled
      ? computeExponent(formatter, scaledInput)
      : { exponent: 0, magnitude: 0 },
    exponent = exponentRecord.exponent;
  const input = shiftQuantity(scaledInput, -exponent);
  const suffix =
    input.kind === "finite" &&
    (notation === "scientific" || notation === "engineering")
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
  // Compact notation selects its pattern from the magnitude and the plural
  // category of the displayed mantissa itself ("1 million", "1,5 million",
  // Italian "mille"), as ICU does. Applying CLDR's compact exponent operand
  // here would select categories (French "many" for 1c6) that compact data
  // does not provide. Unit plurals below do use the full compact value.
  const pattern =
    notation === "compact" && quantity.kind === "finite"
      ? compactPattern(
          compactSet(formatter),
          exponentRecord.magnitude,
          pluralCategory(formatter, quantity, text, 0),
        )
      : undefined;
  if (
    formatter.style === "currency" &&
    formatter.currency !== undefined &&
    formatter.currency.display === "name"
  )
    return currencyNameParts(
      formatter,
      formatter.currency.code,
      quantity,
      text,
      exponent,
      pattern,
      suffix,
    );
  if (formatter.style === "currency") {
    const currency = formatter.currency;
    if (currency === undefined) throw "NUMBER_CURRENCY_CONFIGURATION_INVARIANT";
    const prefix: DecimalNumberPart[] = [];
    if (pattern !== undefined) {
      let beforeNumber = true;
      for (const token of compactCurrencyAffixTokens(pattern)) {
        if (token === undefined) throw "COMPACT_TOKEN_INVARIANT";
        if (token.kind === "number") beforeNumber = false;
        else if (token.kind === "text")
          for (const part of compactTextParts(token.value)) {
            if (part === undefined) throw "COMPACT_TEXT_PART_INVARIANT";
            if (beforeNumber) prefix.push(part);
            else suffix.push(part);
          }
      }
    }
    return partitionCurrencyNumber(
      currency,
      quantity,
      text,
      formatter.profile,
      formatter.digits,
      formatter.useGrouping,
      formatter.signDisplay,
      suffix,
      prefix,
    );
  }
  if (formatter.style === "percent") {
    const profile = formatter.affixProfile;
    if (profile === undefined) throw "NUMBER_PERCENT_PROFILE_INVARIANT";
    let core = numericParts(
      formatter,
      quantity,
      text,
      profile.percent,
      "never",
    );
    if (pattern !== undefined)
      core = compactParts(
        formatter,
        compactTokens(pattern, false),
        quantity,
        core,
        "never",
      );
    for (const part of suffix) {
      if (part === undefined) throw "NUMBER_NOTATION_PART_INVARIANT";
      core.push(part);
    }
    return renderNumberAffixes(
      profile.percent,
      quantity,
      formatter.signDisplay,
      core,
      formatter.profile.symbols,
    );
  }
  let core: DecimalNumberPart[];
  if (pattern === undefined) {
    core = numericParts(
      formatter,
      quantity,
      text,
      undefined,
      formatter.signDisplay,
    );
  } else {
    const signed = decimalNumberSign(quantity, formatter.signDisplay) !== 0;
    core = compactParts(
      formatter,
      compactTokens(pattern, signed),
      quantity,
      numericParts(formatter, quantity, text, undefined, "never"),
      formatter.signDisplay,
    );
  }
  for (const part of suffix) {
    if (part === undefined) throw "NUMBER_NOTATION_PART_INVARIANT";
    core.push(part);
  }
  if (formatter.style !== "unit") return core;
  const category = pluralCategory(formatter, quantity, text, exponent);
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
        : numberUnitPattern(
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
