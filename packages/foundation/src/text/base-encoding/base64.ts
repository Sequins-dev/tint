import {
  appendString,
  createStringBuilder,
  finishString,
} from "../string-builder.ts";
import { validByteWindow } from "./window.ts";
import type {
  BaseDecodeResult,
  Base64Alphabet,
  Base64LastChunkHandling,
} from "./model.ts";

function skipWhitespace(source: string, index: number): number {
  while (index < source.length) {
    const code = source.charCodeAt(index);
    if (code !== 9 && code !== 10 && code !== 12 && code !== 13 && code !== 32)
      break;
    index++;
  }
  return index;
}
function digit(code: number, alphabet: Base64Alphabet): number {
  if (code >= 65 && code <= 90) return code - 65;
  if (code >= 97 && code <= 122) return code - 71;
  if (code >= 48 && code <= 57) return code + 4;
  if (code === (alphabet === "base64url" ? 45 : 43)) return 62;
  if (code === (alphabet === "base64url" ? 95 : 47)) return 63;
  return -1;
}
function writeTail(
  target: Uint8Array,
  offset: number,
  accumulator: number,
  count: number,
): number {
  target[offset] = (accumulator >>> (count === 2 ? 4 : 10)) & 255;
  if (count === 3) target[offset + 1] = (accumulator >>> 2) & 255;
  return count - 1;
}
/** Decode complete chunks directly into a caller-owned byte window. Options
 * are validated by the caller. Final bytes commit only after padding/trailing
 * input/unused-bit validation. read is the last committed source boundary. */
export function decodeBase64Into(
  source: string,
  target: Uint8Array,
  offset: number,
  maxBytes: number,
  alphabet: Base64Alphabet,
  mode: Base64LastChunkHandling,
): BaseDecodeResult {
  if (!validByteWindow(target, offset, maxBytes))
    return { read: 0, written: 0, error: "bounds" };
  let index = 0,
    read = 0,
    written = 0,
    count = 0,
    accumulator = 0;
  if (maxBytes === 0) return { read, written, error: "none" };
  while (true) {
    index = skipWhitespace(source, index);
    if (index === source.length) {
      if (count !== 0) {
        if (mode === "stop-before-partial")
          return { read, written, error: "none" };
        if (mode === "strict" || count === 1)
          return { read, written, error: "syntax" };
        written += writeTail(target, offset + written, accumulator, count);
      }
      return { read: source.length, written, error: "none" };
    }
    let code = source.charCodeAt(index++);
    if (code === 61) {
      if (count < 2) return { read, written, error: "syntax" };
      index = skipWhitespace(source, index);
      if (count === 2) {
        if (index === source.length)
          return {
            read,
            written,
            error: mode === "stop-before-partial" ? "none" : "syntax",
          };
        code = source.charCodeAt(index);
        if (code === 61) {
          index++;
          index = skipWhitespace(source, index);
        }
      }
      if (index < source.length) return { read, written, error: "syntax" };
      if (
        mode === "strict" &&
        ((count === 2 && (accumulator & 15) !== 0) ||
          (count === 3 && (accumulator & 3) !== 0))
      )
        return { read, written, error: "syntax" };
      written += writeTail(target, offset + written, accumulator, count);
      return { read: source.length, written, error: "none" };
    }
    const value = digit(code, alphabet);
    if (value < 0) return { read, written, error: "syntax" };
    const remaining = maxBytes - written;
    if ((remaining === 1 && count === 2) || (remaining === 2 && count === 3))
      return { read, written, error: "none" };
    accumulator = (accumulator << 6) | value;
    count++;
    if (count === 4) {
      target[offset + written++] = (accumulator >>> 16) & 255;
      target[offset + written++] = (accumulator >>> 8) & 255;
      target[offset + written++] = accumulator & 255;
      count = 0;
      accumulator = 0;
      read = index;
      if (written === maxBytes) return { read, written, error: "none" };
    }
  }
}
export function encodeBase64(
  source: Uint8Array,
  offset: number,
  length: number,
  alphabet: Base64Alphabet,
  omitPadding: boolean,
): string | undefined {
  if (!validByteWindow(source, offset, length)) return undefined;
  const table =
    alphabet === "base64url"
      ? "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
      : "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const builder = createStringBuilder();
  for (let index = 0; index < length; index += 3) {
    const count = Math.min(3, length - index),
      first = source[offset + index];
    if (first === undefined) return undefined;
    const second = count > 1 ? source[offset + index + 1] : 0,
      third = count > 2 ? source[offset + index + 2] : 0;
    if (second === undefined || third === undefined) return undefined;
    const value = (first << 16) | (second << 8) | third;
    const tail = count > 2 ? table.charAt(value & 63) : omitPadding ? "" : "=";
    const middle =
      count > 1 ? table.charAt((value >>> 6) & 63) : omitPadding ? "" : "=";
    appendString(
      builder,
      table.charAt(value >>> 18) +
        table.charAt((value >>> 12) & 63) +
        middle +
        tail,
    );
  }
  return finishString(builder);
}
