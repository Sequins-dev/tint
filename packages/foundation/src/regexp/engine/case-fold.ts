import { containsUnicodeRangeSet } from "../../unicode/properties/index.ts";
import {
  legacyCase,
  legacyInverse,
  unicodeCase,
  unicodeInverse,
} from "./case-data.ts";
function lowerBound(table: readonly number[], key: number): number {
  let low = 0,
    high = table.length / 2;
  while (low < high) {
    const mid = Math.floor((low + high) / 2),
      value = table[mid * 2];
    if (value === undefined) throw "REGEXP_CASE_TABLE_INVARIANT";
    if (value < key) low = mid + 1;
    else high = mid;
  }
  return low * 2;
}
export function canonicalize(value: number, unicode: boolean): number {
  const table = unicode ? unicodeCase : legacyCase;
  const index = lowerBound(table, value);
  return table[index] === value ? (table[index + 1] ?? value) : value;
}
export function equalCharacter(
  a: number,
  b: number,
  ignoreCase: boolean,
  unicode: boolean,
): boolean {
  return (
    a === b ||
    (ignoreCase && canonicalize(a, unicode) === canonicalize(b, unicode))
  );
}
/** Test the complete equivalence class without enumerating a character range. */
export function foldedRange(
  value: number,
  from: number,
  to: number,
  unicode: boolean,
): boolean {
  const key = canonicalize(value, unicode);
  if (key >= from && key <= to) return true;
  const inverse = unicode ? unicodeInverse : legacyInverse;
  for (
    let index = lowerBound(inverse, key);
    inverse[index] === key;
    index += 2
  ) {
    const candidate = inverse[index + 1];
    if (candidate === undefined) throw "REGEXP_CASE_TABLE_INVARIANT";
    if (candidate >= from && candidate <= to) return true;
  }
  return false;
}

/** Inverted membership is applied before folding only for u-mode complements. */
export function foldedProperty(
  value: number,
  ranges: string,
  unicode: boolean,
  inverted: boolean,
): boolean {
  const key = canonicalize(value, unicode);
  if (containsUnicodeRangeSet(ranges, key) !== inverted) return true;
  const inverse = unicode ? unicodeInverse : legacyInverse;
  for (
    let index = lowerBound(inverse, key);
    inverse[index] === key;
    index += 2
  ) {
    const candidate = inverse[index + 1];
    if (candidate === undefined) throw "REGEXP_CASE_TABLE_INVARIANT";
    if (containsUnicodeRangeSet(ranges, candidate) !== inverted) return true;
  }
  return false;
}
