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
import {
  createStringBuilder,
  appendString,
  finishString,
} from "../../text/string-builder.ts";
export const unicodeVersion = "17.0.0";

function requiredProperty(name: string): string {
  const ranges = unicodePropertyRanges(name);
  if (ranges === undefined) throw "UNICODE_CASING_PROPERTY_INVARIANT";
  return ranges;
}
const cased = requiredProperty("Cased");
const ignorable = requiredProperty("Case_Ignorable");
const softDotted = requiredProperty("Soft_Dotted");

/** O(1) inline casing for common BMP European ranges (Latin-1, Latin Extended-A
 * 0x0100..0x0131, Greek 0x0386..0x03ce); returns 0 if unchanged, > 0 for single
 * code unit, or -1 to fall back to `mapping()` (special/multi-unit/outside). */
function quickBmpCase(point: number, upper: boolean): number {
  if (point < 0x100) {
    if (upper) {
      if ((point >= 0xe0 && point <= 0xf6) || (point >= 0xf8 && point <= 0xfe))
        return point - 32;
      if (point === 0xdf) return -1;
      if (point === 0xb5) return 0x039c;
      if (point === 0xff) return 0x0178;
      return 0;
    }
    if ((point >= 0xc0 && point <= 0xd6) || (point >= 0xd8 && point <= 0xde))
      return point + 32;
    return 0;
  }
  if (point <= 0x012f) {
    if (upper) return (point & 1) === 1 ? point - 1 : 0;
    return (point & 1) === 0 ? point + 1 : 0;
  }
  if (point === 0x0130) return upper ? 0 : -1;
  if (point === 0x0131) return upper ? 0x0049 : 0;
  if (point >= 0x0386 && point <= 0x03ce) {
    if (upper) {
      if (point >= 0x03b1 && point <= 0x03c1) return point - 32;
      if (point >= 0x03c3 && point <= 0x03cb) return point - 32;
      if (point === 0x03c2) return 0x03a3;
      if (point === 0x03ac) return 0x0386;
      if (point >= 0x03ad && point <= 0x03af) return point - 37;
      if (point === 0x03cc) return 0x038c;
      if (point === 0x03cd || point === 0x03ce) return point - 63;
      if (point === 0x0390 || point === 0x03b0) return -1;
      return 0;
    }
    if (point >= 0x0391 && point <= 0x03a1) return point + 32;
    if (point >= 0x03a3 && point <= 0x03ab) return point + 32;
    if (point === 0x0386) return 0x03ac;
    if (point >= 0x0388 && point <= 0x038a) return point + 37;
    if (point === 0x038c) return 0x03cc;
    if (point === 0x038e || point === 0x038f) return point + 63;
    return 0;
  }
  return -1;
}

function mapping(
  point: number,
  points: readonly number[],
  values: readonly string[],
): string | undefined {
  let low = 0,
    high = points.length;
  while (low < high) {
    const mid = (low + high) >>> 1,
      candidate = points[mid];
    if (candidate === undefined) throw "UNICODE_CASING_TABLE_INVARIANT";
    if (point < candidate) high = mid;
    else if (point > candidate) low = mid + 1;
    else return values[mid];
  }
  return undefined;
}
function isQuickAsciiNonIgnorable(point: number): number {
  // Returns 1 = cased, 0 = uncased & non-ignorable, -1 = fallback to tables.
  if ((point >= 65 && point <= 90) || (point >= 97 && point <= 122)) return 1;
  if (point === 32 || (point >= 48 && point <= 57)) return 0;
  return -1;
}
function precedingCased(text: string, offset: number): boolean {
  while (offset > 0) {
    let point = text.charCodeAt(--offset);
    if (point < 0x80) {
      const quick = isQuickAsciiNonIgnorable(point);
      if (quick >= 0) return quick === 1;
    } else if (point >= 0x0391 && point <= 0x03ce && point !== 0x03a2) {
      return true;
    } else if (point >= 0xdc00 && point <= 0xdfff && offset > 0) {
      const high = text.charCodeAt(offset - 1);
      if (high >= 0xd800 && high <= 0xdbff) {
        offset--;
        point = ((high - 0xd800) << 10) + (point - 0xdc00) + 0x10000;
      }
    }
    if (!containsUnicodeRangeSet(ignorable, point))
      return containsUnicodeRangeSet(cased, point);
  }
  return false;
}
function followingCased(text: string, offset: number): boolean {
  const length = text.length;
  while (offset < length) {
    let point = text.charCodeAt(offset++);
    if (point < 0x80) {
      const quick = isQuickAsciiNonIgnorable(point);
      if (quick >= 0) return quick === 1;
    } else if (point >= 0x0391 && point <= 0x03ce && point !== 0x03a2) {
      return true;
    } else if (point >= 0xd800 && point <= 0xdbff && offset < length) {
      const low = text.charCodeAt(offset);
      if (low >= 0xdc00 && low <= 0xdfff) {
        offset++;
        point = ((point - 0xd800) << 10) + (low - 0xdc00) + 0x10000;
      }
    }
    if (!containsUnicodeRangeSet(ignorable, point))
      return containsUnicodeRangeSet(cased, point);
  }
  return false;
}
function mapCodePoint(
  text: string,
  offset: number,
  length: number,
  point: number,
  upper: boolean,
  points: readonly number[],
  values: readonly string[],
): string | undefined {
  if (point <= 0x03ce) {
    if (
      !upper &&
      point === 0x03a3 &&
      precedingCased(text, offset) &&
      !followingCased(text, offset + 1)
    )
      return "\u03c2";
    if (upper && point === 0xdf) return "SS";
    if (!upper && point === 0x0130) return "i\u0307";
    const mapped = quickBmpCase(point, upper);
    if (mapped === 0) return undefined;
    if (mapped > 0) return String.fromCharCode(mapped);
    return mapping(point, points, values);
  }
  if (point >= 0x10400 && point <= 0x1044f) {
    let target = point;
    if (upper) {
      if (point < 0x10428) return undefined;
      target = point - 0x28;
    } else {
      if (point > 0x10427) return undefined;
      target = point + 0x28;
    }
    const adjusted = target - 0x10000;
    return String.fromCharCode(
      0xd800 + (adjusted >> 10),
      0xdc00 + (adjusted & 0x3ff),
    );
  }
  if (offset < length) return mapping(point, points, values);
  return undefined;
}
function convertShort(text: string, upper: boolean): string {
  const length = text.length,
    points = upper ? upperPoints : lowerPoints,
    values = upper ? upperMappings : lowerMappings;
  let out = "",
    runStart = 0,
    changed = false;
  for (let offset = 0; offset < length;) {
    let point = text.charCodeAt(offset);
    if (point < 0x80) {
      if (upper ? point >= 97 && point <= 122 : point >= 65 && point <= 90) {
        if (offset > runStart) out += text.slice(runStart, offset);
        const nextUnit = offset + 1 < length ? text.charCodeAt(offset + 1) : -1;
        if (
          nextUnit >= 0 &&
          (upper
            ? nextUnit >= 97 && nextUnit <= 122
            : nextUnit >= 65 && nextUnit <= 90)
        ) {
          const asciiEnd = asciiEndOfText(text, offset + 2, length);
          const span = text.slice(offset, asciiEnd);
          out += upper ? asciiUppercase(span) : asciiLowercase(span);
          runStart = asciiEnd;
          offset = asciiEnd;
        } else {
          out += String.fromCharCode(upper ? point - 32 : point + 32);
          runStart = offset + 1;
          offset++;
        }
        changed = true;
      } else {
        offset++;
      }
      continue;
    }
    let next = offset + 1;
    // Batch consecutive non-ASCII BMP single-unit mappings (e.g. Greek words
    // like "ΌΣΟΣ" -> "όσος") into a single String.fromCharCode allocation.
    if (point <= 0x03ce) {
      let c0 = -1;
      if (
        !upper &&
        point === 0x03a3 &&
        precedingCased(text, offset) &&
        !followingCased(text, next)
      ) {
        c0 = 0x03c2;
      } else {
        c0 = quickBmpCase(point, upper);
      }
      if (c0 === 0) {
        offset = next;
        continue;
      }
      if (c0 > 0) {
        if (offset > runStart) out += text.slice(runStart, offset);
        let c1 = -1,
          c2 = -1,
          c3 = -1;
        let runEnd = next;
        if (runEnd < length) {
          const p1 = text.charCodeAt(runEnd);
          if (p1 >= 0x80 && p1 <= 0x03ce) {
            const m1 =
              !upper &&
              p1 === 0x03a3 &&
              precedingCased(text, runEnd) &&
              !followingCased(text, runEnd + 1)
                ? 0x03c2
                : quickBmpCase(p1, upper);
            if (m1 > 0) {
              c1 = m1;
              runEnd++;
              if (runEnd < length) {
                const p2 = text.charCodeAt(runEnd);
                if (p2 >= 0x80 && p2 <= 0x03ce) {
                  const m2 =
                    !upper &&
                    p2 === 0x03a3 &&
                    precedingCased(text, runEnd) &&
                    !followingCased(text, runEnd + 1)
                      ? 0x03c2
                      : quickBmpCase(p2, upper);
                  if (m2 > 0) {
                    c2 = m2;
                    runEnd++;
                    if (runEnd < length) {
                      const p3 = text.charCodeAt(runEnd);
                      if (p3 >= 0x80 && p3 <= 0x03ce) {
                        const m3 =
                          !upper &&
                          p3 === 0x03a3 &&
                          precedingCased(text, runEnd) &&
                          !followingCased(text, runEnd + 1)
                            ? 0x03c2
                            : quickBmpCase(p3, upper);
                        if (m3 > 0) {
                          c3 = m3;
                          runEnd++;
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
        out +=
          c3 >= 0
            ? String.fromCharCode(c0, c1, c2, c3)
            : c2 >= 0
              ? String.fromCharCode(c0, c1, c2)
              : c1 >= 0
                ? String.fromCharCode(c0, c1)
                : String.fromCharCode(c0);
        changed = true;
        runStart = runEnd;
        offset = runEnd;
        continue;
      }
    }
    if (point >= 0xd800 && point <= 0xdbff && next < length) {
      const low = text.charCodeAt(next);
      if (low >= 0xdc00 && low <= 0xdfff) {
        next++;
        point = ((point - 0xd800) << 10) + (low - 0xdc00) + 0x10000;
      }
    }
    const converted = mapCodePoint(
      text,
      offset,
      length,
      point,
      upper,
      points,
      values,
    );
    if (converted !== undefined) {
      if (offset > runStart) out += text.slice(runStart, offset);
      out += converted;
      changed = true;
      runStart = next;
    }
    offset = next;
  }
  if (!changed) return text;
  if (runStart < length) out += text.slice(runStart, length);
  return out;
}
function convert(text: string, upper: boolean): string {
  // ASCII text maps letter by letter (no special or contextual casing),
  // through the bulk primitives.
  const length = text.length;
  if (asciiEndOfText(text, 0, length) === length)
    return upper ? asciiUppercase(text) : asciiLowercase(text);
  if (length <= 128) return convertShort(text, upper);
  const points = upper ? upperPoints : lowerPoints,
    values = upper ? upperMappings : lowerMappings;
  const builder = createStringBuilder();
  let runStart = 0;
  let changed = false;
  for (let offset = 0; offset < length;) {
    let point = text.charCodeAt(offset);
    if (point < 0x80) {
      if (upper ? point >= 97 && point <= 122 : point >= 65 && point <= 90) {
        if (offset > runStart)
          appendString(builder, text.slice(runStart, offset));
        const nextUnit = offset + 1 < length ? text.charCodeAt(offset + 1) : -1;
        if (
          nextUnit >= 0 &&
          (upper
            ? nextUnit >= 97 && nextUnit <= 122
            : nextUnit >= 65 && nextUnit <= 90)
        ) {
          const asciiEnd = asciiEndOfText(text, offset + 2, length);
          const span = text.slice(offset, asciiEnd);
          appendString(
            builder,
            upper ? asciiUppercase(span) : asciiLowercase(span),
          );
          runStart = asciiEnd;
          offset = asciiEnd;
        } else {
          appendString(
            builder,
            String.fromCharCode(upper ? point - 32 : point + 32),
          );
          runStart = offset + 1;
          offset++;
        }
        changed = true;
      } else {
        offset++;
      }
      continue;
    }
    let next = offset + 1;
    if (point >= 0xd800 && point <= 0xdbff && next < length) {
      const low = text.charCodeAt(next);
      if (low >= 0xdc00 && low <= 0xdfff) {
        next++;
        point = ((point - 0xd800) << 10) + (low - 0xdc00) + 0x10000;
      }
    }
    const converted = mapCodePoint(
      text,
      offset,
      length,
      point,
      upper,
      points,
      values,
    );
    if (converted !== undefined) {
      if (offset > runStart)
        appendString(builder, text.slice(runStart, offset));
      appendString(builder, converted);
      changed = true;
      runStart = next;
    }
    offset = next;
  }
  if (!changed) return text;
  if (runStart < length) appendString(builder, text.slice(runStart, length));
  return finishString(builder);
}
/** Unicode default full lowercase, including context-dependent final sigma. */
export function unicodeLowercase(text: string): string {
  return convert(text, false);
}
/** Unicode default full uppercase, including multi-character expansions. */
export function unicodeUppercase(text: string): string {
  return convert(text, true);
}
function followsSoftDotted(text: string, offset: number): boolean {
  while (offset > 0) {
    let point = text.charCodeAt(--offset);
    if (point >= 0xdc00 && point <= 0xdfff && offset > 0) {
      const high = text.charCodeAt(offset - 1);
      if (high >= 0xd800 && high <= 0xdbff) {
        offset--;
        point = ((high - 0xd800) << 10) + (point - 0xdc00) + 0x10000;
      }
    }
    const order = canonicalCombiningClass(point);
    if (order === 0) return containsUnicodeRangeSet(softDotted, point);
    if (order === 230) return false;
  }
  return false;
}
function moreAbove(text: string, offset: number): boolean {
  const length = text.length;
  while (offset < length) {
    let point = text.charCodeAt(offset++);
    if (point >= 0xd800 && point <= 0xdbff && offset < length) {
      const low = text.charCodeAt(offset);
      if (low >= 0xdc00 && low <= 0xdfff) {
        offset++;
        point = ((point - 0xd800) << 10) + (low - 0xdc00) + 0x10000;
      }
    }
    const order = canonicalCombiningClass(point);
    if (order === 0) return false;
    if (order === 230) return true;
  }
  return false;
}
function beforeDot(text: string, offset: number): boolean {
  const length = text.length;
  while (offset < length) {
    let point = text.charCodeAt(offset++);
    if (point >= 0xd800 && point <= 0xdbff && offset < length) {
      const low = text.charCodeAt(offset);
      if (low >= 0xdc00 && low <= 0xdfff) {
        offset++;
        point = ((point - 0xd800) << 10) + (low - 0xdc00) + 0x10000;
      }
    }
    if (point === 0x0307) return true;
    const order = canonicalCombiningClass(point);
    if (order === 0 || order === 230) return false;
  }
  return false;
}
function localeCasing(
  text: string,
  language: string,
  upper: boolean,
): string | undefined {
  if (language === "tr" || language === "az") {
    let out = "";
    for (let offset = 0; offset < text.length; offset++) {
      const unit = text.charCodeAt(offset);
      if (upper) {
        if (unit === 0x69) {
          out += "\u0130";
          continue;
        }
      } else {
        if (unit === 0x0130) {
          out += "i";
          continue;
        }
        if (
          unit === 0x0307 &&
          offset > 0 &&
          text.charCodeAt(offset - 1) === 0x49
        )
          continue;
        if (unit === 0x49) {
          out += beforeDot(text, offset + 1) ? "i" : "\u0131";
          continue;
        }
      }
      let next = offset + 1;
      if (unit >= 0xd800 && unit <= 0xdbff && next < text.length) {
        const low = text.charCodeAt(next);
        if (low >= 0xdc00 && low <= 0xdfff) next++;
      }
      out += convert(text.slice(offset, next), upper);
      offset = next - 1;
    }
    return out;
  }
  if (language === "lt") {
    let out = "";
    for (let offset = 0; offset < text.length; offset++) {
      const unit = text.charCodeAt(offset);
      if (upper) {
        if (unit === 0x0307 && followsSoftDotted(text, offset)) continue;
      } else {
        if (
          (unit === 0x49 || unit === 0x4a || unit === 0x012e) &&
          moreAbove(text, offset + 1)
        ) {
          out +=
            unit === 0x49
              ? "i\u0307"
              : unit === 0x4a
                ? "j\u0307"
                : "\u012f\u0307";
          continue;
        }
        if (unit === 0x00cc) {
          out += "i\u0307\u0300";
          continue;
        }
        if (unit === 0x00cd) {
          out += "i\u0307\u0301";
          continue;
        }
        if (unit === 0x0128) {
          out += "i\u0307\u0303";
          continue;
        }
      }
      let next = offset + 1;
      if (unit >= 0xd800 && unit <= 0xdbff && next < text.length) {
        const low = text.charCodeAt(next);
        if (low >= 0xdc00 && low <= 0xdfff) next++;
      }
      out += convert(text.slice(offset, next), upper);
      offset = next - 1;
    }
    return out;
  }
  return undefined;
}
/** Locale-sensitive full lowercase (Turkish/Azeri, Lithuanian, or default). */
export function unicodeLocaleLowercase(text: string, language: string): string {
  return localeCasing(text, language, false) ?? convert(text, false);
}
/** Locale-sensitive full uppercase (Turkish/Azeri, Lithuanian, or default). */
export function unicodeLocaleUppercase(text: string, language: string): string {
  return localeCasing(text, language, true) ?? convert(text, true);
}
