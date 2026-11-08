import {
  stringToNumber,
  numberToString,
} from "@tint/foundation/numeric/number-text";

/** CanonicalNumericIndexString includes NaN, infinities and negative zero.
 * Whether that numeric index is valid for a particular view is a separate check.
 * Canonical spellings start with "-", a decimal digit, "I" or "N". A decimal
 * integer of at most 15 digits without a leading zero is its own canonical
 * spelling and exactly representable, so it skips the shortest-digits
 * round-trip that every other candidate takes. */
export function canonicalNumericIndex(key: string): number | undefined {
  const length = key.length;
  if (length === 0) return undefined;
  const first = key.charCodeAt(0);
  if (first >= 48 && first <= 57) {
    if (length <= 15 && (first !== 48 || length === 1)) {
      let value = 0,
        i = 0;
      for (; i < length; i++) {
        const unit = key.charCodeAt(i);
        if (unit < 48 || unit > 57) break;
        value = value * 10 + (unit - 48);
      }
      if (i === length) return value;
    }
  } else if (first !== 45 && first !== 73 && first !== 78) return undefined;
  if (key === "-0") return -0;
  const index = stringToNumber(key);
  return numberToString(index) === key ? index : undefined;
}
