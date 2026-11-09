import type { DecimalQuantity } from "@tint/foundation/numeric/number-text";
import { hasUnicodeProperty } from "@tint/foundation/unicode/properties";
import type { NumberFormatProfile } from "./number-format-profile.ts";
import type {
  NumberAffixPattern,
  NumberAffixProfile,
  NumberAffixToken,
} from "./number-affixes.ts";
import { renderNumberAffixes } from "./number-affix-rendering.ts";
import {
  partitionDecimalNumber,
  type DecimalNumberPart,
  type NumberGrouping,
  type NumberSignDisplay,
} from "./decimal-number-parts.ts";

export interface CurrencyNumberOptions {
  readonly code: string;
  readonly display: "symbol" | "narrowSymbol" | "code";
  readonly sign: "standard" | "accounting";
  readonly label: string;
}
export interface CurrencyNumberConfiguration extends CurrencyNumberOptions {
  readonly profile: NumberAffixProfile;
}
function boundary(text: string, first: boolean): number {
  if (text === "") return -1;
  let index = first ? 0 : text.length - 1;
  const last = text.charCodeAt(index);
  if (!first && last >= 56320 && last <= 57343 && index > 0) index--;
  const point = text.codePointAt(index);
  return point === undefined ? -1 : point;
}
function letter(point: number): boolean {
  return hasUnicodeProperty("General_Category", "Letter", point) === true;
}
function alphaPattern(pattern: NumberAffixPattern, label: string): boolean {
  const tokens = pattern.positive;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token === undefined) throw "CURRENCY_PATTERN_TOKEN_INVARIANT";
    if (token.kind !== "currency") continue;
    const before = tokens[index - 1],
      after = tokens[index + 1];
    if (before !== undefined && before.kind === "number")
      return letter(boundary(label, true));
    if (after !== undefined && after.kind === "number")
      return letter(boundary(label, false));
  }
  return false;
}
function currencyMatch(point: number): boolean {
  return (
    point >= 0 &&
    hasUnicodeProperty("General_Category", "Symbol", point) === false &&
    hasUnicodeProperty("General_Category", "Separator", point) === false
  );
}
function digit(point: number): boolean {
  return (
    hasUnicodeProperty("General_Category", "Decimal_Number", point) === true
  );
}
/** Closed CLDR49 currencySpacing policy: [^S & ^Z] beside [:digit:] inserts
 * NBSP. Explicit pattern literals prevent adjacency and therefore double spacing. */
function spacedTokens(
  tokens: readonly NumberAffixToken[],
  label: string,
  first: number,
  last: number,
): NumberAffixToken[] {
  const result: NumberAffixToken[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token === undefined) throw "CURRENCY_SPACING_TOKEN_INVARIANT";
    const previous = tokens[index - 1];
    if (
      previous !== undefined &&
      ((previous.kind === "currency" &&
        token.kind === "number" &&
        currencyMatch(boundary(label, false)) &&
        digit(first)) ||
        (previous.kind === "number" &&
          token.kind === "currency" &&
          digit(last) &&
          currencyMatch(boundary(label, true))))
    )
      result.push({ kind: "literal", value: " " });
    result.push(token);
  }
  return result;
}
function spacedPattern(
  pattern: NumberAffixPattern,
  label: string,
  first: number,
  last: number,
): NumberAffixPattern {
  return {
    source: pattern.source,
    positive: spacedTokens(pattern.positive, label, first, last),
    negative: spacedTokens(pattern.negative, label, first, last),
    primaryGrouping: pattern.primaryGrouping,
    secondaryGrouping: pattern.secondaryGrouping,
  };
}
export function partitionCurrencyNumber(
  configuration: CurrencyNumberConfiguration,
  quantity: DecimalQuantity,
  text: string,
  profile: NumberFormatProfile,
  digits: readonly string[],
  useGrouping: NumberGrouping,
  signDisplay: NumberSignDisplay,
  /** Notation parts (an exponent) that follow the number inside the pattern. */
  suffix: readonly DecimalNumberPart[] = [],
): DecimalNumberPart[] {
  const affixes = configuration.profile;
  let pattern =
    configuration.sign === "accounting"
      ? affixes.currencyAccounting
      : affixes.currencyStandard;
  let standard = affixes.currencyStandard;
  if (
    quantity.kind === "finite" &&
    alphaPattern(pattern, configuration.label)
  ) {
    const alternative =
      configuration.sign === "accounting"
        ? affixes.currencyAccountingAlpha
        : affixes.currencyAlpha;
    if (alternative !== undefined) pattern = alternative;
    const plus = affixes.currencyAlpha;
    if (plus !== undefined) standard = plus;
  }
  const symbols = profile.symbols;
  const parts = partitionDecimalNumber(
    quantity,
    text,
    {
      decimal: symbols.currencyDecimal,
      group: symbols.currencyGroup,
      plusSign: symbols.plusSign,
      minusSign: symbols.minusSign,
      nan: symbols.nan,
      infinity: symbols.infinity,
    },
    digits,
    {
      primaryGrouping: pattern.primaryGrouping,
      secondaryGrouping: pattern.secondaryGrouping,
      minimumGroupingDigits: profile.minimumGroupingDigits,
    },
    useGrouping,
    "never",
  );
  for (const part of suffix) {
    if (part === undefined) throw "NUMBER_NOTATION_PART_INVARIANT";
    parts.push(part);
  }
  const firstPart = parts[0],
    lastPart = parts[parts.length - 1];
  const first = firstPart === undefined ? -1 : boundary(firstPart.value, true),
    last = lastPart === undefined ? -1 : boundary(lastPart.value, false);
  return renderNumberAffixes(
    spacedPattern(pattern, configuration.label, first, last),
    quantity,
    signDisplay,
    parts,
    symbols,
    {
      currency: configuration.label,
      standardForPlus: spacedPattern(
        standard,
        configuration.label,
        first,
        last,
      ),
    },
  );
}
