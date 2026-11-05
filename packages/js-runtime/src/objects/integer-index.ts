import {
  stringToNumber,
  numberToString,
} from "@tint/foundation/numeric/number-text";

/** CanonicalNumericIndexString includes NaN, infinities and negative zero.
 * Whether that numeric index is valid for a particular view is a separate check. */
export function canonicalNumericIndex(key: string): number | undefined {
  if (key === "-0") return -0;
  const index = stringToNumber(key);
  return numberToString(index) === key ? index : undefined;
}
