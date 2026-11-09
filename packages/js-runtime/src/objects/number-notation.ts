import { localeTableValue } from "./locale-canonicalization.ts";
import type { DecimalNumberPart } from "./decimal-number-parts.ts";
import { numberFormatLocaleKey } from "./number-format-profile.ts";
import {
  numberNotationLocaleRows,
  numberNotationProfiles,
  numberNotationFields,
  numberNotationStrings,
} from "./number-notation-data.ts";

/** One compact pattern set: a packed field row of sorted
 * "magnitude.category:stringId" entries. A row string rather than a Map keeps
 * NumberFormat state free of collection types, so it adds nothing to the core
 * Script surface that every runtime-compiled eval/Function prepares. */
export type CompactPatternSet = string;
export interface CompactNotationProfile {
  readonly short: CompactPatternSet;
  readonly long: CompactPatternSet;
  readonly currency: CompactPatternSet;
}
function patternSet(id: string | undefined): CompactPatternSet {
  const row =
    id === undefined ? undefined : localeTableValue(numberNotationFields, id);
  if (row === undefined) throw "COMPACT_NOTATION_PROFILE_INVARIANT";
  return row;
}
/** The pattern for an exact "magnitude.category" key, or undefined. */
function patternText(set: CompactPatternSet, key: string): string | undefined {
  const marker = "," + key + ":",
    start = ("," + set).indexOf(marker);
  if (start < 0) return undefined;
  const from = start + marker.length - 1,
    end = set.indexOf(",", from);
  const text = localeTableValue(
    numberNotationStrings,
    end < 0 ? set.slice(from) : set.slice(from, end),
  );
  if (text === undefined) throw "COMPACT_NOTATION_TEXT_INVARIANT";
  return text;
}
/** Compact patterns for a resolved NumberFormat locale and numbering system. */
export function createCompactNotationProfile(
  locale: string,
  numberingSystem: string,
): CompactNotationProfile | undefined {
  const row = localeTableValue(
    numberNotationLocaleRows,
    numberFormatLocaleKey(locale),
  );
  if (row === undefined) return undefined;
  // "base;system:id,..." lists only numbering systems that differ from base.
  const split = row.indexOf(";");
  let id = split < 0 ? row : row.slice(0, split);
  if (split >= 0)
    for (const exception of row.slice(split + 1).split(",")) {
      if (exception === undefined) throw "COMPACT_NOTATION_ROW_INVARIANT";
      const colon = exception.indexOf(":");
      if (exception.slice(0, colon) === numberingSystem)
        id = exception.slice(colon + 1);
    }
  const groups = localeTableValue(numberNotationProfiles, id);
  if (groups === undefined) return undefined;
  const ids = groups.split(",");
  return {
    short: patternSet(ids[0]),
    long: patternSet(ids[1]),
    currency: patternSet(ids[2]),
  };
}

/** Largest pattern magnitude <= magnitude (CLDR provides 10^3..10^14). */
function patternMagnitude(set: CompactPatternSet, magnitude: number): number {
  for (let m = magnitude > 14 ? 14 : magnitude; m >= 3; m--)
    if (patternText(set, m + ".other") !== undefined) return m;
  return -1;
}
/** Text of a subpattern with quoting removed; "''" is a literal quote. */
function unquoted(pattern: string): string {
  let result = "",
    quoted = false;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern.charAt(i);
    if (c === "'") {
      if (pattern.charAt(i + 1) === "'") {
        result += "'";
        i++;
      } else quoted = !quoted;
    } else result += c;
  }
  return result;
}
function positiveSubpattern(pattern: string): string {
  const split = pattern.indexOf(";");
  return split < 0 ? pattern : pattern.slice(0, split);
}
function zeroRun(pattern: string): number {
  let longest = 0,
    run = 0,
    quoted = false;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern.charAt(i);
    if (c === "'") quoted = !quoted;
    else if (!quoted && c === "0") {
      run++;
      if (run > longest) longest = run;
    } else run = 0;
  }
  return longest;
}
/** ComputeExponentForMagnitude for compact notation: the selected pattern's
 * magnitude less its extra integer digits; a bare "0" pattern is uncompacted. */
export function compactExponent(
  set: CompactPatternSet,
  magnitude: number,
): number {
  const m = patternMagnitude(set, magnitude);
  if (m < 0) return 0;
  const pattern = patternText(set, m + ".other");
  if (pattern === undefined) throw "COMPACT_NOTATION_OTHER_INVARIANT";
  const positive = positiveSubpattern(pattern);
  if (unquoted(positive) === "0") return 0;
  return m - (zeroRun(positive) - 1);
}
/** The pattern for a magnitude and the rounded mantissa's plural category. */
export function compactPattern(
  set: CompactPatternSet,
  magnitude: number,
  category: string,
): string | undefined {
  const m = patternMagnitude(set, magnitude);
  if (m < 0) return undefined;
  const pattern =
    patternText(set, m + "." + category) ?? patternText(set, m + ".other");
  if (pattern === undefined) throw "COMPACT_NOTATION_OTHER_INVARIANT";
  return unquoted(positiveSubpattern(pattern)) === "0" ? undefined : pattern;
}

export type CompactTokenKind = "number" | "sign" | "currency" | "text";
/** `value` is the literal text of a "text" token and empty otherwise. */
export interface CompactToken {
  readonly kind: CompactTokenKind;
  readonly value: string;
}
function whitespace(c: string): boolean {
  return c === " " || c === " " || c === " ";
}
/** Tokens of one subpattern: the zero run is the number, '-' a sign slot,
 * '¤' the currency label and other unquoted or quoted text literal text. */
function subpatternTokens(subpattern: string): CompactToken[] {
  const tokens: CompactToken[] = [];
  let text = "",
    quoted = false,
    number = false;
  function flush(): void {
    if (text !== "") tokens.push({ kind: "text", value: text });
    text = "";
  }
  for (let i = 0; i < subpattern.length; i++) {
    const c = subpattern.charAt(i);
    if (c === "'") {
      if (subpattern.charAt(i + 1) === "'") {
        text += "'";
        i++;
      } else quoted = !quoted;
    } else if (!quoted && c === "0") {
      if (!number) {
        flush();
        tokens.push({ kind: "number", value: "" });
        number = true;
      }
    } else if (!quoted && c === "-") {
      flush();
      tokens.push({ kind: "sign", value: "" });
    } else if (!quoted && c === "¤") {
      flush();
      tokens.push({ kind: "currency", value: "" });
    } else text += c;
  }
  flush();
  return tokens;
}
/** Tokens for rendering a value. A negative subpattern decides where a sign
 * goes; otherwise the sign immediately precedes the number. */
export function compactTokens(
  pattern: string,
  signed: boolean,
): CompactToken[] {
  const split = pattern.indexOf(";");
  if (signed && split >= 0) return subpatternTokens(pattern.slice(split + 1));
  const tokens = subpatternTokens(
    split < 0 ? pattern : pattern.slice(0, split),
  );
  if (!signed) return tokens;
  // The sign precedes the number; a pattern that omits the number (Italian
  // "mille") carries the sign at its start.
  let hasNumber = false;
  for (const token of tokens) {
    if (token === undefined) throw "COMPACT_TOKEN_INVARIANT";
    if (token.kind === "number") hasNumber = true;
  }
  const result: CompactToken[] = hasNumber ? [] : [{ kind: "sign", value: "" }];
  for (const token of tokens) {
    if (token === undefined) throw "COMPACT_TOKEN_INVARIANT";
    if (token.kind === "number") result.push({ kind: "sign", value: "" });
    result.push(token);
  }
  return result;
}
/** Currency compact patterns contribute only their compact affix: the label
 * and the whitespace beside it come from the standard currency pattern. */
export function compactCurrencyAffixTokens(pattern: string): CompactToken[] {
  const tokens = subpatternTokens(positiveSubpattern(pattern)),
    result: CompactToken[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === undefined) throw "COMPACT_TOKEN_INVARIANT";
    if (token.kind === "currency") continue;
    if (token.kind === "text") {
      let value = token.value;
      const before = tokens[i - 1],
        after = tokens[i + 1];
      if (before !== undefined && before.kind === "currency")
        while (value !== "" && whitespace(value.charAt(0)))
          value = value.slice(1);
      if (after !== undefined && after.kind === "currency")
        while (value !== "" && whitespace(value.charAt(value.length - 1)))
          value = value.slice(0, -1);
      if (value !== "") result.push({ kind: "text", value });
    } else result.push(token);
  }
  return result;
}
/** Split compact text into whitespace literals and compact symbol runs. */
export function compactTextParts(text: string): DecimalNumberPart[] {
  const parts: DecimalNumberPart[] = [];
  let run = "",
    space = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i),
      isSpace = whitespace(c);
    if (run !== "" && isSpace !== space) {
      parts.push({ type: space ? "literal" : "compact", value: run });
      run = "";
    }
    space = isSpace;
    run += c;
  }
  if (run !== "")
    parts.push({ type: space ? "literal" : "compact", value: run });
  return parts;
}
