import {
  displayNamesLocales,
  displayNamesLocaleTables,
  displayNamesTable,
} from "./display-names-data.ts";
import { parseLocaleId } from "./locale-id.ts";
import {
  canonicalizeLocaleId,
  canonicalLocaleType,
  localeTableValue,
  uppercaseAscii,
} from "./locale-canonicalization.ts";

/** Resolved Intl.DisplayNames state ([[Locale]], [[Style]], [[Type]],
 * [[Fallback]], [[LanguageDisplay]]) plus the locale's packed CLDR table. */
export interface DisplayNamesData {
  readonly locale: string;
  readonly style: string;
  readonly type: string;
  readonly fallback: string;
  readonly languageDisplay: string;
  readonly table: string;
}

function availableIndex(tag: string): number {
  const locales = displayNamesLocales.split(",");
  for (let index = 0; index < locales.length; index++)
    if (locales[index] === tag) return index;
  return -1;
}

/** Index of the best available locale for a canonical request (lookup by
 * truncation), or -1. */
export function displayNamesLocaleIndex(requested: string): number {
  let candidate = requested;
  const extension = candidate.indexOf("-u-");
  if (extension >= 0) candidate = candidate.slice(0, extension);
  while (candidate.length > 0) {
    const index = availableIndex(candidate);
    if (index >= 0) return index;
    const cut = candidate.lastIndexOf("-");
    if (cut < 0) break;
    candidate = candidate.slice(0, cut);
    // A trailing singleton cannot stand alone (RFC 4647 lookup).
    if (
      candidate.length >= 2 &&
      candidate.charCodeAt(candidate.length - 2) === 45
    )
      candidate = candidate.slice(0, candidate.length - 2);
  }
  return -1;
}

export function createDisplayNamesData(
  requested: readonly string[],
  style: string,
  type: string,
  fallback: string,
  languageDisplay: string,
): DisplayNamesData {
  let index = -1;
  for (const tag of requested) {
    if (tag === undefined) throw "DISPLAY_NAMES_REQUEST_INVARIANT";
    index = displayNamesLocaleIndex(tag);
    if (index >= 0) break;
  }
  // The default locale is the first available locale.
  if (index < 0) index = 0;
  const locale = displayNamesLocales.split(",")[index],
    tableIndex = displayNamesLocaleTables.split(",")[index],
    table =
      tableIndex === undefined
        ? undefined
        : displayNamesTable(Number(tableIndex));
  if (locale === undefined || table === undefined)
    throw "DISPLAY_NAMES_LOCALE_INVARIANT";
  return { locale, style, type, fallback, languageDisplay, table };
}

function alphanumeric(code: number): boolean {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122)
  );
}
function allLetters(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (!((code >= 65 && code <= 90) || (code >= 97 && code <= 122)))
      return false;
  }
  return value.length > 0;
}
function allDigits(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 48 || code > 57) return false;
  }
  return value.length > 0;
}
function lowercaseAscii(value: string): string {
  let result = "";
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    result += String.fromCharCode(code >= 65 && code <= 90 ? code + 32 : code);
  }
  return result;
}

const dateTimeFields =
  "|era|year|quarter|month|weekOfYear|weekday|day|dayPeriod|hour|minute|second|timeZoneName|";

/** CanonicalCodeForDisplayNames: the canonical code, or undefined where the
 * specification throws a RangeError. */
export function canonicalDisplayNamesCode(
  type: string,
  code: string,
): string | undefined {
  if (type === "language") {
    // unicode_language_id only: no extensions, and "root" is not allowed.
    const parsed = parseLocaleId(code);
    if (parsed === undefined || parsed.extensions.length !== 0)
      return undefined;
    if (lowercaseAscii(code) === "root") return undefined;
    return canonicalizeLocaleId(code);
  }
  if (type === "region") {
    if (
      !(code.length === 2 && allLetters(code)) &&
      !(code.length === 3 && allDigits(code))
    )
      return undefined;
    return uppercaseAscii(code);
  }
  if (type === "script") {
    if (code.length !== 4 || !allLetters(code)) return undefined;
    return uppercaseAscii(code.slice(0, 1)) + lowercaseAscii(code.slice(1));
  }
  if (type === "calendar") {
    // Unicode locale identifier "type": (alphanum{3,8})("-" alphanum{3,8})*.
    let length = 0;
    for (let index = 0; index <= code.length; index++) {
      const unit = index === code.length ? 45 : code.charCodeAt(index);
      if (unit === 45) {
        if (length < 3 || length > 8) return undefined;
        length = 0;
      } else if (!alphanumeric(unit)) return undefined;
      else length++;
    }
    return canonicalLocaleType("u", "ca", lowercaseAscii(code));
  }
  if (type === "dateTimeField")
    return dateTimeFields.includes("|" + code + "|") ? code : undefined;
  if (type === "currency") {
    if (code.length !== 3 || !allLetters(code)) return undefined;
    return uppercaseAscii(code);
  }
  throw "DISPLAY_NAMES_TYPE_INVARIANT";
}

function lookup(
  data: DisplayNamesData,
  prefix: string,
  code: string,
): string | undefined {
  if (data.style !== "long") {
    const styled = localeTableValue(
      data.table,
      prefix + code + "@" + data.style,
    );
    if (styled !== undefined) return styled;
    // Narrow falls back to short before the long name.
    if (data.style === "narrow") {
      const short = localeTableValue(data.table, prefix + code + "@short");
      if (short !== undefined) return short;
    }
  }
  return localeTableValue(data.table, prefix + code);
}

/** Substitute CLDR "{0}" and "{1}" placeholders (each occurs once). */
function fillPattern(template: string, first: string, second: string): string {
  const a = template.indexOf("{0}"),
    b = template.indexOf("{1}");
  if (a < 0 || b < 0) throw "DISPLAY_NAMES_TEMPLATE_INVARIANT";
  return a < b
    ? template.slice(0, a) +
        first +
        template.slice(a + 3, b) +
        second +
        template.slice(b + 3)
    : template.slice(0, b) +
        second +
        template.slice(b + 3, a) +
        first +
        template.slice(a + 3);
}

function pattern(data: DisplayNamesData, key: string): string {
  const value = localeTableValue(data.table, "p:" + key);
  if (value === undefined) throw "DISPLAY_NAMES_PATTERN_INVARIANT";
  return value;
}

/** Locale display name composed per UTS35 (dialect names first in "dialect"
 * mode), or undefined when the language itself has no name. */
function languageName(
  data: DisplayNamesData,
  canonical: string,
): string | undefined {
  const parsed = parseLocaleId(canonical);
  if (parsed === undefined) throw "DISPLAY_NAMES_CANONICAL_INVARIANT";
  // Parsed subtags are lowercase; CLDR keys use titlecase scripts and
  // uppercase regions.
  const language = parsed.language.language,
    rawScript = parsed.language.script,
    script =
      rawScript === ""
        ? ""
        : uppercaseAscii(rawScript.slice(0, 1)) +
          lowercaseAscii(rawScript.slice(1)),
    region = uppercaseAscii(parsed.language.region),
    variants = parsed.language.variants;
  let base: string | undefined = undefined;
  let usedScript = false,
    usedRegion = false;
  if (data.languageDisplay === "dialect") {
    const candidates: { key: string; script: boolean; region: boolean }[] = [];
    if (script !== "" && region !== "")
      candidates.push({
        key: language + "-" + script + "-" + region,
        script: true,
        region: true,
      });
    if (region !== "")
      candidates.push({
        key: language + "-" + region,
        script: false,
        region: true,
      });
    if (script !== "")
      candidates.push({
        key: language + "-" + script,
        script: true,
        region: false,
      });
    for (const candidate of candidates) {
      if (candidate === undefined) throw "DISPLAY_NAMES_CANDIDATE_INVARIANT";
      const found = lookup(data, "l:", candidate.key);
      if (found !== undefined) {
        base = found;
        usedScript = candidate.script;
        usedRegion = candidate.region;
        break;
      }
    }
  }
  const name = base ?? lookup(data, "l:", language);
  if (name === undefined) return undefined;
  const qualifiers: string[] = [];
  if (script !== "" && !usedScript)
    qualifiers.push(lookup(data, "s:", script) ?? script);
  if (region !== "" && !usedRegion)
    qualifiers.push(lookup(data, "r:", region) ?? region);
  for (const variant of variants) {
    if (variant === undefined) throw "DISPLAY_NAMES_VARIANT_INVARIANT";
    qualifiers.push(uppercaseAscii(variant));
  }
  if (qualifiers.length === 0) return name;
  const separator = pattern(data, "separator");
  const first = qualifiers[0];
  if (first === undefined) throw "DISPLAY_NAMES_QUALIFIER_INVARIANT";
  let joined: string = first;
  for (let index = 1; index < qualifiers.length; index++) {
    const next = qualifiers[index];
    if (next === undefined) throw "DISPLAY_NAMES_QUALIFIER_INVARIANT";
    joined = fillPattern(separator, joined, next);
  }
  return fillPattern(pattern(data, "locale"), name, joined);
}

/** The display name for an already canonical code, or undefined when the
 * locale data has none (callers apply [[Fallback]]). */
export function displayNameOf(
  data: DisplayNamesData,
  canonical: string,
): string | undefined {
  if (data.type === "language") return languageName(data, canonical);
  if (data.type === "region") return lookup(data, "r:", canonical);
  if (data.type === "script") return lookup(data, "s:", canonical);
  if (data.type === "currency") return lookup(data, "c:", canonical);
  if (data.type === "calendar")
    return localeTableValue(data.table, "k:" + canonical);
  if (data.type === "dateTimeField") return lookup(data, "f:", canonical);
  throw "DISPLAY_NAMES_TYPE_INVARIANT";
}
