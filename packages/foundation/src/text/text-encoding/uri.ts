import {
  createStringBuilder,
  appendString,
  finishString,
} from "../string-builder.ts";
import { isWellFormedUTF16 } from "./well-formed.ts";

export interface URIEncodingResult {
  readonly error: "none" | "malformed";
  readonly value: string;
}
function reserved(byte: number): boolean {
  return ";/?:@&=+$,#".includes(String.fromCharCode(byte));
}
/** ECMAScript URI escaping, with UTF8 provided by the standard encoding globals. */
export function encodeURIString(
  value: string,
  component: boolean,
): URIEncodingResult {
  if (!isWellFormedUTF16(value)) return { error: "malformed", value: "" };
  const bytes = new TextEncoder().encode(value),
    output = createStringBuilder();
  const hex = "0123456789ABCDEF";
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    if (byte === undefined) throw "URI_BYTE_INVARIANT";
    const character = String.fromCharCode(byte);
    if (
      (byte >= 65 && byte <= 90) ||
      (byte >= 97 && byte <= 122) ||
      (byte >= 48 && byte <= 57) ||
      "-_.!~*'()".includes(character) ||
      (!component && reserved(byte))
    )
      appendString(output, character);
    else
      appendString(
        output,
        "%" + hex.charAt(byte >>> 4) + hex.charAt(byte & 15),
      );
  }
  return { error: "none", value: finishString(output) };
}
function hexDigit(unit: number): number {
  if (unit >= 48 && unit <= 57) return unit - 48;
  if (unit >= 65 && unit <= 70) return unit - 55;
  if (unit >= 97 && unit <= 102) return unit - 87;
  return -1;
}
function escapedByte(value: string, index: number): number {
  const high = hexDigit(value.charCodeAt(index + 1)),
    low = hexDigit(value.charCodeAt(index + 2));
  return high < 0 || low < 0 ? -1 : high * 16 + low;
}
/** Decode contiguous percent octets strictly; unescaped UTF16 remains untouched. */
export function decodeURIString(
  value: string,
  component: boolean,
): URIEncodingResult {
  const output = createStringBuilder(),
    decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  let index = 0;
  while (index < value.length) {
    if (value.charCodeAt(index) !== 37) {
      const start = index;
      while (index < value.length && value.charCodeAt(index) !== 37) index++;
      appendString(output, value.slice(start, index));
      continue;
    }
    const first = escapedByte(value, index);
    if (first < 0) return { error: "malformed", value: "" };
    if (!component && reserved(first)) {
      appendString(output, value.slice(index, index + 3));
      index += 3;
      continue;
    }
    const octets: number[] = [];
    while (index < value.length && value.charCodeAt(index) === 37) {
      const byte = escapedByte(value, index);
      if (byte < 0) return { error: "malformed", value: "" };
      if (!component && reserved(byte)) break;
      octets.push(byte);
      index += 3;
    }
    const bytes = new Uint8Array(octets.length);
    for (let i = 0; i < octets.length; i++) {
      const byte = octets[i];
      if (byte === undefined) throw "URI_BYTE_INVARIANT";
      bytes[i] = byte;
    }
    try {
      appendString(output, decoder.decode(bytes));
    } catch {
      return { error: "malformed", value: "" };
    }
  }
  return { error: "none", value: finishString(output) };
}
