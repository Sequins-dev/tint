import {
  asciiEndOfBytes,
  copyLatin1,
  latin1Text,
} from "@tint/foundation/text/latin1";
import {
  decodeBase64Into,
  decodeHexInto,
  encodeBase64,
  encodeHex,
} from "@tint/foundation/text/base-encoding";
import {
  appendString,
  createStringBuilder,
  finishString,
} from "@tint/foundation/text/string-builder";
import {
  createUTF8Decoder,
  decodeUTF8,
  encodeUTF8,
} from "@tint/foundation/text/text-encoding";

import type { NodeBufferEncoding } from "./buffer-encoding.ts";
export { bufferEncoding, type NodeBufferEncoding } from "./buffer-encoding.ts";

/** Buffer's binary decoders take the low byte of each input code unit.
 * For base64 both alphabets are accepted, other characters are ignored,
 * and anything after the first padding character is outside the input. */
function baseSource(text: string, hex: boolean): string {
  const builder = createStringBuilder();
  const end = hex ? text.length - (text.length % 2) : text.length;
  for (let index = 0; index < end; index++) {
    const code = text.charCodeAt(index) & 255;
    if (hex) appendString(builder, String.fromCharCode(code));
    else if (code === 61) break;
    else if (code === 45 || code === 95)
      appendString(builder, code === 45 ? "+" : "/");
    else if (
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      (code >= 48 && code <= 57) ||
      code === 43 ||
      code === 47
    )
      appendString(builder, String.fromCharCode(code));
  }
  return finishString(builder);
}

export function bufferBytes(
  text: string,
  encoding: NodeBufferEncoding,
): Uint8Array {
  if (encoding === "utf8") return encodeUTF8(text);
  if (encoding === "hex" || encoding === "base64" || encoding === "base64url") {
    const hex = encoding === "hex";
    const input = baseSource(text, hex);
    const capacity = Math.floor(input.length * (hex ? 0.5 : 0.75));
    const bytes = new Uint8Array(capacity);
    const result = hex
      ? decodeHexInto(input, bytes, 0, capacity)
      : decodeBase64Into(input, bytes, 0, capacity, "base64", "loose");
    return result.written === capacity
      ? bytes
      : bytes.subarray(0, result.written);
  }
  const width = encoding === "utf16le" ? 2 : 1;
  const bytes = new Uint8Array(text.length * width);
  if (width === 1 && copyLatin1(text, 0, text.length, bytes, 0) === text.length)
    return bytes;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    bytes[index * width] = code & 255;
    if (width === 2) bytes[index * width + 1] = code >>> 8;
  }
  return bytes;
}

export function bufferText(
  bytes: Uint8Array,
  encoding: NodeBufferEncoding,
): string {
  switch (encoding) {
    case "utf8":
      return decodeUTF8(createUTF8Decoder(false, true), bytes) ?? "";
    case "latin1":
      return latin1Text(bytes, 0, bytes.length);
    case "ascii":
      if (asciiEndOfBytes(bytes, 0, bytes.length) === bytes.length)
        return latin1Text(bytes, 0, bytes.length);
      break;
    case "hex":
      return encodeHex(bytes, 0, bytes.length) ?? "";
    case "base64":
    case "base64url":
      return (
        encodeBase64(
          bytes,
          0,
          bytes.length,
          encoding,
          encoding === "base64url",
        ) ?? ""
      );
  }
  const builder = createStringBuilder();
  const width = encoding === "utf16le" ? 2 : 1;
  let chunk = "";
  for (let index = 0; index + width <= bytes.length; index += width) {
    const low = bytes[index] ?? 0;
    const code =
      width === 2
        ? low + (bytes[index + 1] ?? 0) * 256
        : encoding === "ascii"
          ? low & 127
          : low;
    chunk += String.fromCharCode(code);
    if (chunk.length >= 32) {
      appendString(builder, chunk);
      chunk = "";
    }
  }
  appendString(builder, chunk);
  return finishString(builder);
}
