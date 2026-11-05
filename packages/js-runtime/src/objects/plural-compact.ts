import {
  localeTableValue,
  printLocaleLanguage,
} from "./locale-canonicalization.ts";
import { parseLocaleId } from "./locale-id.ts";
import {
  pluralServiceLocales,
  pluralCompactProfiles,
} from "./plural-compact-data.ts";
import { createPluralOperands, type PluralOperands } from "./plural-rules.ts";

export type PluralCompactStyle = "short" | "long";
function asciiLower(text: string): string {
  let result = "";
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index);
    result += String.fromCharCode(unit >= 65 && unit <= 90 ? unit + 32 : unit);
  }
  return result;
}
/** Available locale lookup for the real PluralRules service registry. Inputs
 * have passed canonicalization. Ignore Unicode extensions while preserving
 * private-use content and use RFC4647 prefix/singleton truncation. */
export function lookupPluralLocale(canonicalTag: string): string | undefined {
  const parts: string[] = [];
  let unicode = false,
    privateUse = false;
  for (const part of asciiLower(canonicalTag).split("-")) {
    if (part === undefined) throw "PLURAL_LOCALE_INVARIANT";
    if (!privateUse && part.length === 1) {
      if (part === "x") privateUse = true;
      unicode = part === "u";
    }
    if (!unicode) parts.push(part);
  }
  let candidate = parts.join("-");
  while (true) {
    if (localeTableValue(pluralServiceLocales, candidate) !== undefined) {
      const parsed = parseLocaleId(candidate);
      if (parsed === undefined || parsed.extensions.length !== 0)
        throw "PLURAL_LOCALE_DATA_INVARIANT";
      return printLocaleLanguage(parsed.language, false);
    }
    const index = candidate.lastIndexOf("-");
    if (index < 0) return undefined;
    candidate = candidate.slice(0, index);
    if (
      candidate.length >= 2 &&
      candidate.charCodeAt(candidate.length - 2) === 45
    )
      candidate = candidate.slice(0, -2);
  }
}
function integer(text: string): number {
  let value = 0;
  for (let index = 0; index < text.length; index++)
    value = value * 10 + text.charCodeAt(index) - 48;
  return value;
}
/** The latn `other` compact skeleton defines this implementation's PluralRules
 * exponent policy. This is scaling metadata, not NumberFormat rendering data.
 * Magnitude is computed from the already rounded full decimal quantity. */
export function pluralCompactExponent(
  locale: string,
  style: PluralCompactStyle,
  decimalMagnitude: number,
): number {
  if (!Number.isSafeInteger(decimalMagnitude))
    throw "PLURAL_COMPACT_MAGNITUDE_INVARIANT";
  const matched = lookupPluralLocale(locale);
  const id =
    matched === undefined
      ? undefined
      : localeTableValue(pluralServiceLocales, asciiLower(matched));
  const profile =
    id === undefined ? undefined : localeTableValue(pluralCompactProfiles, id);
  if (profile === undefined) throw "PLURAL_COMPACT_LOCALE_INVARIANT";
  const encoded = profile.split("|")[style === "short" ? 0 : 1];
  if (encoded === undefined) throw "PLURAL_COMPACT_PROFILE_INVARIANT";
  let exponent = 0;
  for (const row of encoded.split(";")) {
    if (row === undefined) throw "PLURAL_COMPACT_ROW_INVARIANT";
    const separator = row.indexOf(","),
      magnitude = integer(row.slice(0, separator));
    if (magnitude > decimalMagnitude) break;
    exponent = integer(row.slice(separator + 1));
  }
  return exponent;
}
/** ResolvePlural provides already expanded, rounded decimal text. Its n/i/f/v
 * operands must not be shifted a second time when attaching compact c/e metadata. */
export function createFormattedPluralOperands(
  displayedFullDecimal: string,
  compactExponent: number,
): PluralOperands | undefined {
  if (!Number.isSafeInteger(compactExponent) || compactExponent < 0)
    return undefined;
  const value = createPluralOperands(displayedFullDecimal, 0);
  if (value === undefined) return undefined;
  return {
    i: value.i,
    integerZeroes: value.integerZeroes,
    f: value.f,
    t: value.t,
    v: value.v,
    w: value.w,
    c: compactExponent,
    e: compactExponent,
    fractional: value.fractional,
  };
}
