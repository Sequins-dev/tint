import {
  unicodePropertyRanges,
  containsUnicodeRangeSet,
} from "../properties/index.ts";
import { canonicalCombiningClass } from "../normalization/index.ts";
import {
  lowerPoints,
  lowerMappings,
  upperPoints,
  upperMappings,
} from "./data.ts";
import {
  asciiEndOfText,
  asciiLowercase,
  asciiUppercase,
} from "../../text/latin1.ts";
export const unicodeVersion = "17.0.0";

function requiredProperty(name: string): string {
  const ranges = unicodePropertyRanges(name);
  if (ranges === undefined) throw "UNICODE_CASING_PROPERTY_INVARIANT";
  return ranges;
}
const cased = requiredProperty("Cased");
const ignorable = requiredProperty("Case_Ignorable");
const softDotted = requiredProperty("Soft_Dotted");

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
  // ASCII text maps letter by letter (no special or contextual casing),
  // through the bulk primitives.
  if (asciiEndOfText(text, 0, text.length) === text.length)
    return upper ? asciiUppercase(text) : asciiLowercase(text);
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

function beforeDot(text: string, offset: number): boolean {
  while (offset < text.length) {
    const point = text.codePointAt(offset);
    if (point === undefined) throw "UNICODE_CASING_OFFSET_INVARIANT";
    if (point === 0x0307) return true;
    const combining = canonicalCombiningClass(point);
    if (combining === 0 || combining === 230) return false;
    offset += point > 65535 ? 2 : 1;
  }
  return false;
}
function moreAbove(text: string, offset: number): boolean {
  while (offset < text.length) {
    const point = text.codePointAt(offset);
    if (point === undefined) throw "UNICODE_CASING_OFFSET_INVARIANT";
    const combining = canonicalCombiningClass(point);
    if (combining === 230) return true;
    if (combining === 0) return false;
    offset += point > 65535 ? 2 : 1;
  }
  return false;
}
function afterBase(text: string, offset: number, dotted: boolean): boolean {
  while (offset > 0) {
    let point = text.charCodeAt(--offset);
    if (point >= 0xdc00 && point <= 0xdfff && offset > 0) {
      const high = text.charCodeAt(offset - 1);
      if (high >= 0xd800 && high <= 0xdbff) {
        offset--;
        point = (high - 0xd800) * 1024 + point - 0xdc00 + 65536;
      }
    }
    if (dotted ? containsUnicodeRangeSet(softDotted, point) : point === 0x0049)
      return true;
    const combining = canonicalCombiningClass(point);
    if (combining === 0 || combining === 230) return false;
  }
  return false;
}
/** SpecialCasing contexts are evaluated on the original text. The default full
 * mapping then retains its existing final-sigma and expansion behavior. */
function localeText(text: string, language: string, upper: boolean): string {
  const turkic = language === "tr" || language === "az";
  if (!turkic && language !== "lt") return text;
  const pieces: string[] = [];
  for (let offset = 0; offset < text.length;) {
    const point = text.codePointAt(offset);
    if (point === undefined) throw "UNICODE_CASING_OFFSET_INVARIANT";
    const next = offset + (point > 65535 ? 2 : 1);
    let replacement: string | undefined;
    if (turkic) {
      if (upper && point === 0x0069) replacement = "\u0130";
      else if (!upper) {
        if (point === 0x0130) replacement = "i";
        else if (point === 0x0049 && !beforeDot(text, next))
          replacement = "\u0131";
        else if (point === 0x0307 && afterBase(text, offset, false))
          replacement = "";
      }
    } else if (upper) {
      if (point === 0x0307 && afterBase(text, offset, true)) replacement = "";
    } else if (
      (point === 0x0049 || point === 0x004a || point === 0x012e) &&
      moreAbove(text, next)
    ) {
      replacement =
        (point === 0x0049 ? "i" : point === 0x004a ? "j" : "\u012f") + "\u0307";
    } else if (point === 0x00cc) replacement = "i\u0307\u0300";
    else if (point === 0x00cd) replacement = "i\u0307\u0301";
    else if (point === 0x0128) replacement = "i\u0307\u0303";
    pieces.push(
      replacement === undefined ? text.slice(offset, next) : replacement,
    );
    offset = next;
  }
  return pieces.join("");
}
/** Full locale lowercase for a canonical primary language subtag. */
export function unicodeLocaleLowercase(text: string, language: string): string {
  return unicodeLowercase(localeText(text, language, false));
}
/** Full locale uppercase for a canonical primary language subtag. */
export function unicodeLocaleUppercase(text: string, language: string): string {
  return unicodeUppercase(localeText(text, language, true));
}
