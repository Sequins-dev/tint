import { localeTableValue } from "./locale-canonicalization.ts";
import { lookupNumberFormatLocale } from "./number-format-profile.ts";
import type { PluralCategory } from "./plural-rules.ts";
import {
  numberAffixPatterns,
  numberAffixProfiles,
  numberAffixBindings,
  numberAffixLocaleRows,
  percentUnitPatterns,
  percentUnitProfiles,
  currencyFractions,
} from "./number-affix-data.ts";

export type NumberAffixTokenKind =
  "literal" | "number" | "plusSign" | "minusSign" | "percentSign" | "currency";
export interface NumberAffixToken {
  readonly kind: NumberAffixTokenKind;
  readonly value: string;
}
export interface NumberAffixPattern {
  readonly source: string;
  readonly positive: readonly NumberAffixToken[];
  readonly negative: readonly NumberAffixToken[];
  readonly primaryGrouping: number;
  readonly secondaryGrouping: number;
}
export interface NumberAffixProfile {
  readonly locale: string;
  readonly numberingSystem: string;
  readonly percent: NumberAffixPattern;
  readonly currencyStandard: NumberAffixPattern;
  readonly currencyAccounting: NumberAffixPattern;
  readonly currencyAlpha: NumberAffixPattern | undefined;
  readonly currencyAccountingAlpha: NumberAffixPattern | undefined;
}
export type NumberUnitWidth = "long" | "short" | "narrow";
function numeric(code: number): boolean {
  return code === 35 || code === 48 || code === 44 || code === 46;
}
function validSkeleton(text: string): boolean {
  const point = text.indexOf(".");
  if (point !== text.lastIndexOf(".") || !text.includes("0")) return false;
  const integer = point === -1 ? text : text.slice(0, point),
    fraction = point === -1 ? "" : text.slice(point + 1);
  if (integer === "" || (point !== -1 && fraction === "")) return false;
  let zero = false;
  for (const group of integer.split(",")) {
    if (group === undefined || group === "") return false;
    for (let i = 0; i < group.length; i++) {
      const code = group.charCodeAt(i);
      if (code === 48) zero = true;
      else if (code !== 35 || zero) return false;
    }
  }
  let optional = false;
  for (let i = 0; i < fraction.length; i++) {
    const code = fraction.charCodeAt(i);
    if (code === 35) optional = true;
    else if (code !== 48 || optional) return false;
  }
  return true;
}
function affixKind(code: number): NumberAffixTokenKind | undefined {
  if (code === 37) return "percentSign";
  if (code === 164) return "currency";
  if (code === 45) return "minusSign";
  if (code === 43) return "plusSign";
  return undefined;
}
function numberToken(
  tokens: readonly NumberAffixToken[],
): NumberAffixToken | undefined {
  let found: NumberAffixToken | undefined = undefined;
  for (const token of tokens) {
    if (token === undefined) throw "NUMBER_AFFIX_TOKEN_INVARIANT";
    if (token.kind === "number") {
      if (found !== undefined) return undefined;
      found = token;
    }
  }
  return found;
}
/** Restricted decimal-pattern parser: quoted literals/doubled apostrophes,
 * positive/negative subpatterns and explicit affix tokens. Unsupported numeric
 * skeletons fail rather than silently changing formatting behavior. */
export function parseNumberAffixPattern(
  source: string,
): NumberAffixPattern | undefined {
  const positive: NumberAffixToken[] = [],
    explicitNegative: NumberAffixToken[] = [];
  let tokens = positive,
    quoted = false,
    literal = "",
    negative = false;
  for (let index = 0; index < source.length; index++) {
    const code = source.charCodeAt(index),
      text = source.charAt(index);
    if (code === 39) {
      if (source.charCodeAt(index + 1) === 39) {
        literal += "'";
        index++;
      } else quoted = !quoted;
      continue;
    }
    if (quoted) {
      literal += text;
      continue;
    }
    if (code === 59) {
      if (negative) return undefined;
      if (literal !== "") {
        tokens.push({ kind: "literal", value: literal });
        literal = "";
      }
      negative = true;
      tokens = explicitNegative;
      continue;
    }
    if (numeric(code)) {
      if (literal !== "") {
        tokens.push({ kind: "literal", value: literal });
        literal = "";
      }
      const start = index;
      while (index + 1 < source.length && numeric(source.charCodeAt(index + 1)))
        index++;
      const skeleton = source.slice(start, index + 1);
      if (!validSkeleton(skeleton)) return undefined;
      tokens.push({ kind: "number", value: skeleton });
      continue;
    }
    const kind = affixKind(code);
    if (kind === undefined) literal += text;
    else {
      if (literal !== "") {
        tokens.push({ kind: "literal", value: literal });
        literal = "";
      }
      tokens.push({ kind, value: text });
    }
  }
  if (quoted) return undefined;
  if (literal !== "") tokens.push({ kind: "literal", value: literal });
  const number = numberToken(positive);
  if (number === undefined) return undefined;
  if (negative && numberToken(explicitNegative) === undefined) return undefined;
  const actualNegative: NumberAffixToken[] = [];
  if (negative) {
    for (const token of explicitNegative) {
      if (token === undefined) throw "NUMBER_NEGATIVE_AFFIX_INVARIANT";
      actualNegative.push(token);
    }
  } else {
    actualNegative.push({ kind: "minusSign", value: "-" });
    for (const token of positive) {
      if (token === undefined) throw "NUMBER_POSITIVE_AFFIX_INVARIANT";
      actualNegative.push(token);
    }
  }
  const point = number.value.indexOf("."),
    integer = point === -1 ? number.value : number.value.slice(0, point),
    groups = integer.split(",");
  const primary = groups.length > 1 ? groups[groups.length - 1] : undefined,
    secondary = groups.length > 2 ? groups[groups.length - 2] : primary;
  return {
    source,
    positive,
    negative: actualNegative,
    primaryGrouping: primary === undefined ? 0 : primary.length,
    secondaryGrouping: secondary === undefined ? 0 : secondary.length,
  };
}
function asciiLower(text: string): string {
  let result = "";
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    result += String.fromCharCode(code >= 65 && code <= 90 ? code + 32 : code);
  }
  return result;
}
function integer(text: string): number {
  let result = 0;
  for (let i = 0; i < text.length; i++)
    result = result * 10 + text.charCodeAt(i) - 48;
  return result;
}
function patternAt(
  ids: readonly string[],
  index: number,
): NumberAffixPattern | undefined {
  const id = ids[index];
  if (id === undefined) throw "NUMBER_AFFIX_PATTERN_ID_INVARIANT";
  if (id === "-") return undefined;
  const source = localeTableValue(numberAffixPatterns, id),
    pattern =
      source === undefined ? undefined : parseNumberAffixPattern(source);
  if (pattern === undefined) throw "NUMBER_AFFIX_PATTERN_DATA_INVARIANT";
  return pattern;
}
/** Percent and currency pattern metadata only. Localized currency labels and
 * actual style/option/number rendering remain separate adapter responsibilities. */
export function createNumberAffixProfile(
  locale: string,
  numberingSystem: string,
): NumberAffixProfile | undefined {
  const matched = lookupNumberFormatLocale(locale);
  if (matched === undefined) return undefined;
  const row = localeTableValue(numberAffixLocaleRows, asciiLower(matched));
  if (row === undefined) throw "NUMBER_AFFIX_LOCALE_INVARIANT";
  const bindings = localeTableValue(
    numberAffixBindings,
    row.slice(0, row.indexOf(",")),
  );
  if (bindings === undefined) throw "NUMBER_AFFIX_BINDING_INVARIANT";
  let id: string | undefined = undefined;
  for (const entry of bindings.split(";")) {
    if (entry === undefined) throw "NUMBER_AFFIX_SYSTEM_INVARIANT";
    const split = entry.indexOf(",");
    if (entry.slice(0, split) === numberingSystem) {
      id = entry.slice(split + 1);
      break;
    }
  }
  const encoded =
    id === undefined ? undefined : localeTableValue(numberAffixProfiles, id);
  if (encoded === undefined) return undefined;
  const ids = encoded.split(","),
    percent = patternAt(ids, 0),
    standard = patternAt(ids, 1),
    accounting = patternAt(ids, 2);
  if (
    percent === undefined ||
    standard === undefined ||
    accounting === undefined
  )
    throw "NUMBER_AFFIX_REQUIRED_PATTERN_INVARIANT";
  return {
    locale: matched,
    numberingSystem,
    percent,
    currencyStandard: standard,
    currencyAccounting: accounting,
    currencyAlpha: patternAt(ids, 3),
    currencyAccountingAlpha: patternAt(ids, 4),
  };
}
function categoryIndex(category: PluralCategory): number {
  if (category === "zero") return 0;
  if (category === "one") return 1;
  if (category === "two") return 2;
  if (category === "few") return 3;
  if (category === "many") return 4;
  return 5;
}
/** Resolved genuine concentr-percent unit templates. They never scale the input
 * by 100; root width aliases resolve the requested locale's short templates. */
export function percentUnitPattern(
  locale: string,
  width: NumberUnitWidth,
  category: PluralCategory,
): string | undefined {
  const matched = lookupNumberFormatLocale(locale);
  if (matched === undefined) return undefined;
  const row = localeTableValue(numberAffixLocaleRows, asciiLower(matched));
  if (row === undefined) throw "PERCENT_UNIT_LOCALE_INVARIANT";
  const profile = localeTableValue(
    percentUnitProfiles,
    row.slice(row.indexOf(",") + 1),
  );
  if (profile === undefined) throw "PERCENT_UNIT_PROFILE_INVARIANT";
  const ids = profile.split(","),
    index =
      (width === "long" ? 0 : width === "short" ? 1 : 2) * 6 +
      categoryIndex(category),
    id = ids[index];
  if (id === undefined) throw "PERCENT_UNIT_PATTERN_ID_INVARIANT";
  const value = localeTableValue(percentUnitPatterns, id);
  if (value === undefined) throw "PERCENT_UNIT_PATTERN_DATA_INVARIANT";
  return value;
}
/** Ordinary currency digits; cashDigits/cashRounding are intentionally not used.
 * The caller supplies an already validated uppercase ASCII currency code. */
export function currencyFractionDigits(currencyCode: string): number {
  const row =
    localeTableValue(currencyFractions, currencyCode) ??
    localeTableValue(currencyFractions, "DEFAULT");
  if (row === undefined) throw "CURRENCY_DEFAULT_DIGITS_INVARIANT";
  return integer(row.slice(0, row.indexOf(",")));
}
