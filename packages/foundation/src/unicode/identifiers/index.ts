import { startRanges, continueRanges } from "./ranges.ts";
/** Pinned Unicode properties, independent of JavaScript-specific $, _ and join controls. */
export const unicodeVersion = "17.0.0";
function contains(ranges: readonly number[], point: number): boolean {
  if (!Number.isInteger(point) || point < 0 || point > 0x10ffff) return false;
  var low = 0,
    high = ranges.length / 2;
  while (low < high) {
    const middle = Math.floor((low + high) / 2),
      start = ranges[middle * 2],
      end = ranges[middle * 2 + 1];
    if (start === undefined || end === undefined)
      throw "Unicode range invariant";
    if (point < start) high = middle;
    else if (point > end) low = middle + 1;
    else return true;
  }
  return false;
}
export function isIDStart(point: number): boolean {
  return contains(startRanges, point);
}
export function isIDContinue(point: number): boolean {
  return contains(continueRanges, point);
}
