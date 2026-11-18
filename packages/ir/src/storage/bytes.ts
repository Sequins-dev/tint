import { encodeFloat64, decodeFloat64 } from "@tint/foundation/binary/bytes";
/** A growable byte sink for the function store's packed encoding
 * (docs/compiler-memory.md, "Binary format"). */
export interface ByteWriter {
  bytes: Uint8Array;
  length: number;
  /** The previous span start: spans are written as deltas within a
   * function record. */
  spanBase: number;
}
export function createByteWriter(capacity: number = 256): ByteWriter {
  return {
    bytes: new Uint8Array(capacity < 16 ? 16 : capacity),
    length: 0,
    spanBase: 0,
  };
}
function reserve(writer: ByteWriter, count: number): void {
  const needed = writer.length + count;
  if (needed <= writer.bytes.length) return;
  let capacity = writer.bytes.length * 2;
  while (capacity < needed) capacity *= 2;
  const grown = new Uint8Array(capacity);
  grown.set(writer.bytes.subarray(0, writer.length));
  writer.bytes = grown;
}
export function writeByte(writer: ByteWriter, value: number): void {
  reserve(writer, 1);
  writer.bytes[writer.length] = value;
  writer.length++;
}
/** LEB128 over a non-negative safe integer (arithmetic, not 32-bit shifts). */
export function writeUnsigned(writer: ByteWriter, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw "packed IR unsigned invariant";
  reserve(writer, 8);
  let rest = value;
  while (rest >= 128) {
    writer.bytes[writer.length] = (rest % 128) + 128;
    writer.length++;
    rest = Math.floor(rest / 128);
  }
  writer.bytes[writer.length] = rest;
  writer.length++;
}
/** Zigzag LEB128 over a safe integer whose magnitude is below 2^52. */
export function writeSigned(writer: ByteWriter, value: number): void {
  if (!Number.isSafeInteger(value) || value > 4503599627370495)
    throw "packed IR signed invariant";
  if (value < -4503599627370496) throw "packed IR signed invariant";
  writeUnsigned(writer, value >= 0 ? value * 2 : -value * 2 - 1);
}
/** Any number, exactly: small integers in one tag byte plus zigzag, others as
 * binary64 (NaN canonical, -0 preserved). */
export function writeNumber(writer: ByteWriter, value: number): void {
  if (
    Number.isSafeInteger(value) &&
    !(value === 0 && 1 / value < 0) &&
    value <= 4503599627370495 &&
    value >= -4503599627370496
  ) {
    writeByte(writer, 0);
    writeSigned(writer, value);
    return;
  }
  writeByte(writer, 1);
  const word = encodeFloat64(value);
  writeWord32(writer, word.lo);
  writeWord32(writer, word.hi);
}
function writeWord32(writer: ByteWriter, value: number): void {
  reserve(writer, 4);
  let rest = value;
  for (let index = 0; index < 4; index++) {
    writer.bytes[writer.length] = rest % 256;
    writer.length++;
    rest = Math.floor(rest / 256);
  }
}
/** UTF-16 code units, so lone surrogates round-trip. */
export function writeString(writer: ByteWriter, value: string): void {
  writeUnsigned(writer, value.length);
  for (let index = 0; index < value.length; index++)
    writeUnsigned(writer, value.charCodeAt(index));
}
export function writtenBytes(writer: ByteWriter): Uint8Array {
  return writer.bytes.slice(0, writer.length);
}
export interface ByteReader {
  readonly bytes: Uint8Array;
  offset: number;
  readonly end: number;
  /** See ByteWriter.spanBase. */
  spanBase: number;
}
export function createByteReader(
  bytes: Uint8Array,
  offset: number = 0,
  end: number = bytes.length,
): ByteReader {
  return { bytes, offset, end, spanBase: 0 };
}
export function readByte(reader: ByteReader): number {
  if (reader.offset >= reader.end) throw "packed IR truncated";
  const value = reader.bytes[reader.offset] ?? 0;
  reader.offset++;
  return value;
}
export function readUnsigned(reader: ByteReader): number {
  let value = 0,
    scale = 1;
  for (;;) {
    const byte = readByte(reader);
    if (byte < 128) return value + byte * scale;
    value += (byte - 128) * scale;
    scale *= 128;
    if (scale > 9007199254740992) throw "packed IR varint overflow";
  }
}
export function readSigned(reader: ByteReader): number {
  const encoded = readUnsigned(reader);
  return encoded % 2 === 0 ? encoded / 2 : -(encoded + 1) / 2;
}
export function readNumber(reader: ByteReader): number {
  const tag = readByte(reader);
  if (tag === 0) return readSigned(reader);
  if (tag !== 1) throw "packed IR number tag";
  const lo = readWord32(reader),
    hi = readWord32(reader);
  const decoded = decodeFloat64({ lo, hi });
  if (!decoded.ok) throw "packed IR double";
  return decoded.value;
}
function readWord32(reader: ByteReader): number {
  let value = 0,
    scale = 1;
  for (let index = 0; index < 4; index++) {
    value += readByte(reader) * scale;
    scale *= 256;
  }
  return value;
}
export function readString(reader: ByteReader): string {
  const length = readUnsigned(reader);
  let value = "";
  for (let index = 0; index < length; index++)
    value += String.fromCharCode(readUnsigned(reader));
  return value;
}
