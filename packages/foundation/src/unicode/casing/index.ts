import {
  unicodePropertyRanges,
  containsUnicodeRangeSet,
} from "../properties/index.ts";
import {
  lowerPoints,
  lowerMappings,
  upperPoints,
  upperMappings,
} from "./data.ts";
export const unicodeVersion = "17.0.0";

function requiredProperty(name: string): string {
  const ranges = unicodePropertyRanges(name);
  if (ranges === undefined) throw "UNICODE_CASING_PROPERTY_INVARIANT";
  return ranges;
}
const cased = requiredProperty("Cased");
const ignorable = requiredProperty("Case_Ignorable");

function mapping(
  point: number,
  points: readonly number[],
  values: readonly string[],
): string | undefined {
  let low = 0,
    high = points.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2),
      candidate = points[mid];
    if (candidate === undefined) throw "UNICODE_CASING_TABLE_INVARIANT";
    if (point < candidate) high = mid;
    else if (point > candidate) low = mid + 1;
    else return values[mid];
  }
  return undefined;
}
function followingCased(text: string, offset: number): boolean {
  while (offset < text.length) {
    const point = text.codePointAt(offset);
    if (point === undefined) throw "UNICODE_CASING_OFFSET_INVARIANT";
    if (!containsUnicodeRangeSet(ignorable, point))
      return containsUnicodeRangeSet(cased, point);
    offset += point > 65535 ? 2 : 1;
  }
  return false;
}
function convert(text: string, upper: boolean): string {
  const pieces: string[] = [];
  let beforeCased = false;
  for (let offset = 0; offset < text.length;) {
    const point = text.codePointAt(offset);
    if (point === undefined) throw "UNICODE_CASING_OFFSET_INVARIANT";
    const next = offset + (point > 65535 ? 2 : 1);
    const converted =
      !upper && point === 0x03a3 && beforeCased && !followingCased(text, next)
        ? "\u03c2"
        : mapping(
            point,
            upper ? upperPoints : lowerPoints,
            upper ? upperMappings : lowerMappings,
          );
    pieces.push(converted === undefined ? text.slice(offset, next) : converted);
    // Context is taken from the original text. Case-ignorable characters do not
    // terminate the preceding cased run, even when also classified as Cased.
    if (!containsUnicodeRangeSet(ignorable, point))
      beforeCased = containsUnicodeRangeSet(cased, point);
    offset = next;
  }
  return pieces.join("");
}
/** Unicode default full lowercase, including context-dependent final sigma. */
export function unicodeLowercase(text: string): string {
  return convert(text, false);
}
/** Unicode default full uppercase, including one-to-many mappings. */
export function unicodeUppercase(text: string): string {
  return convert(text, true);
}
