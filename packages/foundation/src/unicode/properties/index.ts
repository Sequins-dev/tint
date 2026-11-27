import { propertyNames, propertyRanges } from "./data.ts";
export const unicodeVersion = "17.0.0";
/** Canonical UCD names only; an unknown property is distinct from an empty set. */
export function unicodePropertyRanges(
  property: string,
  value: string = "",
): string | undefined {
  const key = value === "" ? property : property + "=" + value;
  let low = 0,
    high = propertyNames.length;
  while (low < high) {
    const mid = (low + high) >>> 1,
      name = propertyNames[mid];
    if (name === undefined) throw "UNICODE_PROPERTY_INVARIANT";
    if (name < key) low = mid + 1;
    else if (name > key) high = mid;
    else return propertyRanges[mid];
  }
  return undefined;
}
/** Query an immutable range set returned by unicodePropertyRanges. */
export function containsUnicodeRangeSet(
  ranges: string,
  point: number,
): boolean {
  if (!Number.isInteger(point) || point < 0 || point > 0x10ffff) return false;
  let low = 0,
    high = ranges.length >>> 2;
  while (low < high) {
    const mid = (low + high) >>> 1,
      offset = mid << 2;
    const start =
      (ranges.charCodeAt(offset) << 16) | ranges.charCodeAt(offset + 1);
    const end =
      (ranges.charCodeAt(offset + 2) << 16) | ranges.charCodeAt(offset + 3);
    if (point < start) high = mid;
    else if (point > end) low = mid + 1;
    else return true;
  }
  return false;
}
export function hasUnicodeProperty(
  property: string,
  value: string,
  point: number,
): boolean | undefined {
  const ranges = unicodePropertyRanges(property, value);
  return ranges === undefined
    ? undefined
    : containsUnicodeRangeSet(ranges, point);
}
