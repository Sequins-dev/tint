import { createUTF8Decoder, decodeUTF8 } from "./date-time-service-helpers.ts";

const maximumDataBytes = 33554432;
interface PackedReader {
  readonly bytes: Uint8Array;
  position: number;
}
function byteAt(bytes: Uint8Array, index: number): number {
  const value = bytes[index];
  if (value === undefined) throw "CLDR_PACK_TRUNCATED";
  return value;
}
function readInteger(input: PackedReader): number {
  let value = 0,
    multiplier = 1;
  for (let index = 0; index < 5; index++) {
    const byte = byteAt(input.bytes, input.position++),
      unit = byte & 127;
    if (index === 4 && unit > 15) throw "CLDR_PACK_INTEGER";
    value += unit * multiplier;
    if (byte < 128) {
      if (index > 0 && unit === 0) throw "CLDR_PACK_INTEGER";
      return value;
    }
    multiplier *= 128;
  }
  throw "CLDR_PACK_INTEGER";
}
function headerInteger(bytes: Uint8Array, offset: number): number {
  return (
    byteAt(bytes, offset) +
    byteAt(bytes, offset + 1) * 256 +
    byteAt(bytes, offset + 2) * 65536 +
    byteAt(bytes, offset + 3) * 16777216
  );
}
/** Fifteen payload bits per valid BMP unit keep the native UTF-16 literal pool
 * compact. The alphabet excludes line separators and never uses surrogates. */
function unpackCharacters(payload: string, length: number): Uint8Array {
  if (
    !Number.isSafeInteger(length) ||
    length < 12 ||
    length > maximumDataBytes ||
    payload.length !== Math.ceil((length * 8) / 15)
  )
    throw "CLDR_PACK_LENGTH";
  const bytes = new Uint8Array(length);
  let bits = 0,
    value = 0,
    written = 0;
  for (let index = 0; index < payload.length; index++) {
    const character = payload.charCodeAt(index);
    if (
      character < 32 ||
      character > 32801 ||
      character === 0x2028 ||
      character === 0x2029
    )
      throw "CLDR_PACK_CHARACTER";
    const unit = character - 32 - (character > 0x2029 ? 2 : 0);
    value |= unit << bits;
    bits += 15;
    while (bits >= 8 && written < length) {
      bytes[written++] = value & 255;
      value >>>= 8;
      bits -= 8;
    }
  }
  if (written !== length || value !== 0) throw "CLDR_PACK_PADDING";
  return bytes;
}
/** Decode immutable generated CLDR tables on first service use. The frame has a
 * versioned header, bounded UTF-8 output, literal runs and overlapping backward
 * references. Table order and every UTF-16 code unit survive the round trip. */
export function unpackLocaleData(
  payload: string,
  packedByteLength: number,
): readonly string[] {
  const bytes = unpackCharacters(payload, packedByteLength);
  if (
    byteAt(bytes, 0) !== 67 ||
    byteAt(bytes, 1) !== 76 ||
    byteAt(bytes, 2) !== 68 ||
    byteAt(bytes, 3) !== 49
  )
    throw "CLDR_PACK_VERSION";
  const length = headerInteger(bytes, 4),
    count = headerInteger(bytes, 8);
  if (
    length > maximumDataBytes ||
    count > 65536 ||
    (length === 0 ? count > 1 : count === 0)
  )
    throw "CLDR_PACK_HEADER";
  const output = new Uint8Array(length),
    input: PackedReader = { bytes, position: 12 };
  let written = 0;
  while (written < length) {
    const literals = readInteger(input);
    if (literals > length - written || literals > bytes.length - input.position)
      throw "CLDR_PACK_LITERAL";
    for (let index = 0; index < literals; index++)
      output[written++] = byteAt(bytes, input.position++);
    if (written === length) break;
    const distance = readInteger(input),
      matchLength = readInteger(input);
    if (
      distance < 1 ||
      distance > written ||
      matchLength < 8 ||
      matchLength > length - written
    )
      throw "CLDR_PACK_REFERENCE";
    for (let index = 0; index < matchLength; index++) {
      output[written] = byteAt(output, written - distance);
      written++;
    }
  }
  if (input.position !== bytes.length) throw "CLDR_PACK_TRAILING";
  if (count === 0) return [];
  const text = decodeUTF8(createUTF8Decoder(true, true), output, false);
  if (text === undefined) throw "CLDR_PACK_UTF8";
  const tables = text.split("\0");
  if (tables.length !== count) throw "CLDR_PACK_TABLES";
  return tables;
}
