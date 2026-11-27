import {
  createStringBuilder,
  appendString,
  finishString,
} from "@tint/foundation/text/string-builder";
import { latin1Text } from "@tint/foundation/text/latin1";

const hexDigits = "0123456789abcdef";
const hexBytes = [
  48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 97, 98, 99, 100, 101, 102,
];

let quoteLatin1Scratch: Uint8Array | undefined = undefined;

function getQuoteLatin1Scratch(needed: number): Uint8Array {
  const existing = quoteLatin1Scratch;
  if (existing !== undefined && existing.length >= needed) return existing;
  const created = new Uint8Array(needed > 1024 ? needed : 1024);
  quoteLatin1Scratch = created;
  return created;
}

function quoteJSONStringLatin1(
  value: string,
  first: number,
  length: number,
): string | undefined {
  // Worst case is 6 bytes per char (\u00XX) + 2 quotes.
  const bytes = getQuoteLatin1Scratch(length * 6 + 2);
  let out = 0;
  bytes[out++] = 34;
  for (let i = 0; i < first; i++) {
    const u = value.charCodeAt(i);
    if (u > 0xff) return undefined;
    bytes[out++] = u;
  }
  for (let i = first; i < length; i++) {
    const unit = value.charCodeAt(i);
    if (unit > 0xff) return undefined;
    if (unit >= 32 && unit !== 34 && unit !== 92) {
      bytes[out++] = unit;
    } else if (unit === 34) {
      bytes[out++] = 92;
      bytes[out++] = 34;
    } else if (unit === 92) {
      bytes[out++] = 92;
      bytes[out++] = 92;
    } else if (unit === 8) {
      bytes[out++] = 92;
      bytes[out++] = 98;
    } else if (unit === 9) {
      bytes[out++] = 92;
      bytes[out++] = 116;
    } else if (unit === 10) {
      bytes[out++] = 92;
      bytes[out++] = 110;
    } else if (unit === 12) {
      bytes[out++] = 92;
      bytes[out++] = 102;
    } else if (unit === 13) {
      bytes[out++] = 92;
      bytes[out++] = 114;
    } else {
      bytes[out++] = 92;
      bytes[out++] = 117;
      bytes[out++] = 48;
      bytes[out++] = 48;
      bytes[out++] = hexBytes[(unit >>> 4) & 15] ?? 48;
      bytes[out++] = hexBytes[unit & 15] ?? 48;
    }
  }
  bytes[out++] = 34;
  return latin1Text(bytes, 0, out);
}

/** Append a well-formed JSON-quoted string directly into `parts`, preserving
 * paired UTF-16 surrogates and escaping lone surrogates. */
export function pushQuotedJSONString(parts: string[], value: string): void {
  const length = value.length;
  let first = 0;
  for (; first < length; first++) {
    const unit = value.charCodeAt(first);
    if (
      unit < 32 ||
      unit === 34 ||
      unit === 92 ||
      (unit >= 0xd800 && unit <= 0xdfff)
    )
      break;
  }
  if (first === length) {
    parts.push('"', value, '"');
    return;
  }
  if (length <= 128) {
    const fast = quoteJSONStringLatin1(value, first, length);
    if (fast !== undefined) {
      parts.push(fast);
      return;
    }
  }
  parts.push('"');
  let start = 0;
  for (let i = first; i < length; i++) {
    const unit = value.charCodeAt(i);
    let escape = "";
    if (unit === 34) escape = '\\"';
    else if (unit === 92) escape = "\\\\";
    else if (unit === 8) escape = "\\b";
    else if (unit === 9) escape = "\\t";
    else if (unit === 10) escape = "\\n";
    else if (unit === 12) escape = "\\f";
    else if (unit === 13) escape = "\\r";
    else if (
      unit >= 0xd800 &&
      unit <= 0xdbff &&
      i + 1 < length &&
      value.charCodeAt(i + 1) >= 0xdc00 &&
      value.charCodeAt(i + 1) <= 0xdfff
    ) {
      i++;
      continue;
    } else if (unit < 32 || (unit >= 0xd800 && unit <= 0xdfff))
      escape =
        "\\u" +
        hexDigits.charAt(unit >>> 12) +
        hexDigits.charAt((unit >>> 8) & 15) +
        hexDigits.charAt((unit >>> 4) & 15) +
        hexDigits.charAt(unit & 15);
    if (escape !== "") {
      if (i > start) parts.push(value.slice(start, i));
      parts.push(escape);
      start = i + 1;
    }
  }
  if (start < length) parts.push(value.slice(start));
  parts.push('"');
}

/** Append an object property prefix (`[sep]"key":` or `[sep]"key": `) with
 * minimal `SparseList` pushes when `key` requires no JSON escaping. */
export function pushJSONPropertyKey(
  parts: string[],
  beforeQuote: string,
  key: string,
  afterQuote: string,
): void {
  const length = key.length;
  for (let i = 0; i < length; i++) {
    const unit = key.charCodeAt(i);
    if (
      unit < 32 ||
      unit === 34 ||
      unit === 92 ||
      (unit >= 0xd800 && unit <= 0xdfff)
    ) {
      if (beforeQuote.length > 1)
        parts.push(beforeQuote.slice(0, beforeQuote.length - 1));
      pushQuotedJSONString(parts, key);
      parts.push(afterQuote.slice(1));
      return;
    }
  }
  parts.push(beforeQuote, key, afterQuote);
}

/** JSON's well-formed string quoting preserves paired UTF16 and escapes lone surrogates. */
export function quoteJSONString(value: string): string {
  // A string with no unit to escape (and no surrogate to check) is quoted
  // whole, in one allocation.
  let first = 0;
  const length = value.length;
  for (; first < length; first++) {
    const unit = value.charCodeAt(first);
    if (
      unit < 32 ||
      unit === 34 ||
      unit === 92 ||
      (unit >= 0xd800 && unit <= 0xdfff)
    )
      break;
  }
  if (first === length) return '"' + value + '"';
  if (length <= 128) {
    const fast = quoteJSONStringLatin1(value, first, length);
    if (fast !== undefined) return fast;
    let out = '"';
    let start = 0;
    for (let i = first; i < length; i++) {
      const unit = value.charCodeAt(i);
      let escape = "";
      if (unit === 34) escape = '\\"';
      else if (unit === 92) escape = "\\\\";
      else if (unit === 8) escape = "\\b";
      else if (unit === 9) escape = "\\t";
      else if (unit === 10) escape = "\\n";
      else if (unit === 12) escape = "\\f";
      else if (unit === 13) escape = "\\r";
      else if (
        unit >= 0xd800 &&
        unit <= 0xdbff &&
        i + 1 < length &&
        value.charCodeAt(i + 1) >= 0xdc00 &&
        value.charCodeAt(i + 1) <= 0xdfff
      ) {
        i++;
        continue;
      } else if (unit < 32 || (unit >= 0xd800 && unit <= 0xdfff))
        escape =
          "\\u" +
          hexDigits.charAt(unit >>> 12) +
          hexDigits.charAt((unit >>> 8) & 15) +
          hexDigits.charAt((unit >>> 4) & 15) +
          hexDigits.charAt(unit & 15);
      if (escape !== "") {
        if (i > start) out += value.slice(start, i);
        out += escape;
        start = i + 1;
      }
    }
    if (start < length) out += value.slice(start);
    return out + '"';
  }
  const output = createStringBuilder();
  appendString(output, '"');
  let start = 0;
  for (let i = first; i < value.length; i++) {
    const unit = value.charCodeAt(i);
    let escape = "";
    if (unit === 34) escape = '\\"';
    else if (unit === 92) escape = "\\\\";
    else if (unit === 8) escape = "\\b";
    else if (unit === 9) escape = "\\t";
    else if (unit === 10) escape = "\\n";
    else if (unit === 12) escape = "\\f";
    else if (unit === 13) escape = "\\r";
    else if (
      unit >= 0xd800 &&
      unit <= 0xdbff &&
      value.charCodeAt(i + 1) >= 0xdc00 &&
      value.charCodeAt(i + 1) <= 0xdfff
    ) {
      i++;
      continue;
    } else if (unit < 32 || (unit >= 0xd800 && unit <= 0xdfff))
      escape =
        "\\u" +
        hexDigits.charAt(unit >>> 12) +
        hexDigits.charAt((unit >>> 8) & 15) +
        hexDigits.charAt((unit >>> 4) & 15) +
        hexDigits.charAt(unit & 15);
    if (escape !== "") {
      appendString(output, value.slice(start, i));
      appendString(output, escape);
      start = i + 1;
    }
  }
  appendString(output, value.slice(start));
  appendString(output, '"');
  return finishString(output);
}
