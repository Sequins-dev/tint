import { validByteWindow } from "./window.ts";
import type { BaseDecodeResult } from "./model.ts";
import {
  appendString,
  createStringBuilder,
  finishString,
} from "../string-builder.ts";

function hexDigit(code: number): number {
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 65 && code <= 70) return code - 55;
  if (code >= 97 && code <= 102) return code - 87;
  return -1;
}
/** Decode into an exclusively owned window, stopping at capacity. Odd lengths
 * fail before mutation; invalid pairs beyond capacity are not inspected. */
export function decodeHexInto(
  source: string,
  target: Uint8Array,
  offset: number,
  maxBytes: number,
): BaseDecodeResult {
  if (!validByteWindow(target, offset, maxBytes))
    return { read: 0, written: 0, error: "bounds" };
  if (source.length % 2 !== 0) return { read: 0, written: 0, error: "syntax" };
  const count = Math.min(source.length / 2, maxBytes);
  for (let index = 0; index < count; index++) {
    const high = hexDigit(source.charCodeAt(index * 2)),
      low = hexDigit(source.charCodeAt(index * 2 + 1));
    if (high < 0 || low < 0)
      return { read: index * 2, written: index, error: "syntax" };
    target[offset + index] = high * 16 + low;
  }
  return { read: count * 2, written: count, error: "none" };
}
/** Lowercase base16 for one byte window; undefined denotes invalid bounds. */
export function encodeHex(
  source: Uint8Array,
  offset: number,
  length: number,
): string | undefined {
  if (!validByteWindow(source, offset, length)) return undefined;
  const alphabet = "0123456789abcdef",
    builder = createStringBuilder();
  for (let index = 0; index < length; index++) {
    const byte = source[offset + index];
    if (byte === undefined) return undefined;
    appendString(
      builder,
      alphabet.charAt(byte >>> 4) + alphabet.charAt(byte & 15),
    );
  }
  return finishString(builder);
}
