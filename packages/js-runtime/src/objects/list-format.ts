import {
  createStringBuilder,
  appendString,
  finishString,
} from "@tint/foundation/text/string-builder";
import { hasUnicodeProperty } from "@tint/foundation/unicode/properties";
import {
  localeTableValue,
  printLocaleLanguage,
} from "./locale-canonicalization.ts";
import { parseLocaleId } from "./locale-id.ts";
import {
  listFormatLocales,
  listFormatPatterns,
  listFormatProfiles,
  listFormatSpanishGrouping,
  listFormatCanonicalPrefixes,
} from "./list-format-data.ts";

export type ListFormatType = "conjunction" | "disjunction" | "unit";
export type ListFormatStyle = "long" | "short" | "narrow";
export interface ListFormatter {
  readonly locale: string;
  readonly type: ListFormatType;
  readonly style: ListFormatStyle;
  readonly pair: string;
  readonly start: string;
  readonly middle: string;
  readonly end: string;
}
export interface ListFormatPart {
  readonly type: "element" | "literal";
  readonly value: string;
}

function asciiLower(text: string): string {
  let result = "";
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index);
    result += String.fromCharCode(unit >= 65 && unit <= 90 ? unit + 32 : unit);
  }
  return result;
}

/** Ignore Unicode extensions, preserving private-use text containing apparent
 * singletons. Inputs have already passed CanonicalizeLocaleList. */
export function lookupListFormatLocale(tag: string): string | undefined {
  const parts: string[] = [];
  let unicode = false,
    privateUse = false;
  for (const part of asciiLower(tag).split("-")) {
    if (part === undefined) throw "LIST_LOCALE_INVARIANT";
    if (!privateUse && part.length === 1) {
      if (part === "x") privateUse = true;
      unicode = part === "u";
    }
    if (!unicode) parts.push(part);
  }
  let candidate = parts.join("-");
  while (true) {
    if (localeTableValue(listFormatLocales, candidate) !== undefined) {
      const parsed = parseLocaleId(candidate);
      if (parsed === undefined || parsed.extensions.length !== 0)
        throw "LIST_LOCALE_DATA_INVARIANT";
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

function requiredRow(rows: string, key: string): string {
  const value = localeTableValue(rows, key);
  if (value === undefined) throw "LIST_FORMAT_DATA_INVARIANT";
  return value;
}

function patternAt(profile: readonly string[], index: number): string {
  const id = profile[index];
  if (id === undefined) throw "LIST_FORMAT_DATA_INVARIANT";
  return requiredRow(listFormatPatterns, id);
}

export function createListFormatter(
  locale: string,
  type: ListFormatType,
  style: ListFormatStyle,
): ListFormatter | undefined {
  const id = localeTableValue(listFormatLocales, asciiLower(locale));
  if (id === undefined) return undefined;
  const typeIndex = type === "conjunction" ? 0 : type === "disjunction" ? 1 : 2;
  const styleIndex = style === "long" ? 0 : style === "short" ? 1 : 2;
  const profile = requiredRow(listFormatProfiles, id).split(","),
    index = typeIndex * 12 + styleIndex * 4;
  return {
    locale,
    type,
    style,
    pair: patternAt(profile, index),
    start: patternAt(profile, index + 1),
    middle: patternAt(profile, index + 2),
    end: patternAt(profile, index + 3),
  };
}

/** Bounded canonical decomposition for contextual initials, not normalization
 * of list elements. Generated from complete relevant Unicode17 decompositions. */
function canonicalPrefix(text: string): string {
  let result = "";
  for (let index = 0; index < text.length && result.length < 3;) {
    const point = text.codePointAt(index);
    if (point === undefined) throw "LIST_TEXT_INVARIANT";
    const length = point > 65535 ? 2 : 1;
    result +=
      localeTableValue(listFormatCanonicalPrefixes, String(point)) ??
      text.slice(index, index + length);
    index += length;
  }
  return asciiLower(result);
}

function useE(text: string): boolean {
  const prefix = canonicalPrefix(text).slice(0, 3);
  return (
    prefix.slice(0, 1) === "i" ||
    (prefix.slice(0, 2) === "hi" &&
      prefix.slice(2, 3) !== "a" &&
      prefix.slice(2, 3) !== "e")
  );
}

function digitAt(text: string, index: number): boolean {
  const unit = text.charCodeAt(index);
  return unit >= 48 && unit <= 57;
}

/** Classify leading eleven groups exactly as digit strings. This deliberately
 * does not trim/coerce arbitrary elements or round long numeric-looking text. */
function useU(text: string, locale: string): boolean {
  const prefix = canonicalPrefix(text).slice(0, 2);
  if (
    prefix.slice(0, 1) === "o" ||
    prefix === "ho" ||
    prefix.slice(0, 1) === "8"
  )
    return true;
  if (text.slice(0, 2) !== "11") return false;
  let index = 0;
  while (index < text.length && digitAt(text, index)) index++;
  let count = index;
  const group = requiredRow(listFormatSpanishGrouping, asciiLower(locale));
  while (group !== "" && text.slice(index, index + group.length) === group) {
    const start = index + group.length;
    let end = start;
    while (end < text.length && digitAt(text, end)) end++;
    if (end - start !== 3) break;
    count += 3;
    index = end;
  }
  return count % 3 === 2;
}

function selectedPattern(
  formatter: ListFormatter,
  pattern: string,
  text: string,
): string {
  const index = formatter.locale.indexOf("-"),
    language = formatter.locale.slice(
      0,
      index < 0 ? formatter.locale.length : index,
    );
  if (language === "es") {
    if (pattern === "{0} y {1}" && useE(text)) return "{0} e {1}";
    if (pattern === "{0} o {1}" && useU(text, formatter.locale))
      return "{0} u {1}";
  }
  if (language === "he" && pattern === "{0} ו{1}" && text !== "") {
    const point = text.codePointAt(0);
    if (point === undefined) throw "LIST_TEXT_INVARIANT";
    if (!hasUnicodeProperty("Script", "Hebrew", point)) return "{0} ו-{1}";
  }
  return pattern;
}

function splitPattern(pattern: string): {
  readonly before: string;
  readonly between: string;
  readonly after: string;
} {
  const zero = pattern.indexOf("{0}"),
    one = pattern.indexOf("{1}");
  if (zero < 0 || one < zero) throw "LIST_PATTERN_INVARIANT";
  return {
    before: pattern.slice(0, zero),
    between: pattern.slice(zero + 3, one),
    after: pattern.slice(one + 3),
  };
}

function elementAt(list: readonly string[], index: number): string {
  const value = list[index];
  if (value === undefined) throw "LIST_ELEMENT_INVARIANT";
  return value;
}

/** Generated template shapes permit linear append-only decomposition. Empty
 * elements remain records; only empty literal spans are omitted. */
export function formatListParts(
  formatter: ListFormatter,
  list: readonly string[],
): readonly ListFormatPart[] {
  const result: ListFormatPart[] = [];
  function literal(value: string): void {
    if (value !== "") result.push({ type: "literal", value });
  }
  function element(value: string): void {
    result.push({ type: "element", value });
  }
  if (list.length === 0) return result;
  if (list.length === 1) {
    element(elementAt(list, 0));
    return result;
  }
  if (list.length === 2) {
    const pattern = splitPattern(
      selectedPattern(formatter, formatter.pair, elementAt(list, 1)),
    );
    literal(pattern.before);
    element(elementAt(list, 0));
    literal(pattern.between);
    element(elementAt(list, 1));
    literal(pattern.after);
    return result;
  }
  const start = splitPattern(formatter.start),
    middle = splitPattern(formatter.middle),
    end = splitPattern(
      selectedPattern(
        formatter,
        formatter.end,
        elementAt(list, list.length - 1),
      ),
    );
  literal(start.before);
  element(elementAt(list, 0));
  for (let index = 1; index < list.length; index++) {
    literal(
      index === 1
        ? start.between
        : index === list.length - 1
          ? end.between
          : middle.between,
    );
    element(elementAt(list, index));
  }
  literal(end.after);
  return result;
}

export function formatList(
  formatter: ListFormatter,
  list: readonly string[],
): string {
  const builder = createStringBuilder();
  for (const part of formatListParts(formatter, list)) {
    if (part === undefined) throw "LIST_PART_INVARIANT";
    appendString(builder, part.value);
  }
  return finishString(builder);
}
