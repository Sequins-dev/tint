import { fromParts, type Word64 } from "./word64.ts";
export type Endian = "little" | "big";
export type Width = 1 | 2 | 4;
export type ByteError =
  | "INVALID_ALIGNMENT"
  | "INVALID_OFFSET"
  | "OUT_OF_BOUNDS"
  | "VALUE_OUT_OF_RANGE"
  | "INVALID_ENCODING"
  | "OVERFLOW";
export type ByteResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ByteError };
function safe(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER;
}
export function alignUp(offset: number, alignment: number): ByteResult<number> {
  if (!safe(offset)) return { ok: false, error: "INVALID_OFFSET" };
  if (!safe(alignment) || alignment === 0)
    return { ok: false, error: "INVALID_ALIGNMENT" };
  const remainder = offset % alignment;
  const padding = remainder === 0 ? 0 : alignment - remainder;
  if (padding > Number.MAX_SAFE_INTEGER - offset)
    return { ok: false, error: "OVERFLOW" };
  return { ok: true, value: offset + padding };
}
function check(
  bytes: Uint8Array,
  offset: number,
  width: number,
  endian: Endian,
): ByteResult<undefined> {
  if (endian !== "little" && endian !== "big")
    return { ok: false, error: "INVALID_ENCODING" };
  if (!safe(offset)) return { ok: false, error: "INVALID_OFFSET" };
  if (offset > bytes.length || width > bytes.length - offset)
    return { ok: false, error: "OUT_OF_BOUNDS" };
  return { ok: true, value: undefined };
}
function store(
  bytes: Uint8Array,
  offset: number,
  width: number,
  value: number,
  endian: Endian,
): void {
  for (let i = 0; i < width; i++) {
    const index = endian === "little" ? offset + i : offset + width - 1 - i;
    bytes[index] = value % 256;
    value = Math.floor(value / 256);
  }
}
/** Decode without bitwise coercion, preserving the full unsigned uint32 range. */
export function readUnsigned(
  bytes: Uint8Array,
  offset: number,
  width: Width,
  endian: Endian,
): ByteResult<number> {
  if (width !== 1 && width !== 2 && width !== 4)
    return { ok: false, error: "INVALID_ENCODING" };
  const checked = check(bytes, offset, width, endian);
  if (!checked.ok) return checked;
  let value = 0;
  for (let index = 0; index < width; index++) {
    const byte =
      bytes[endian === "big" ? offset + index : offset + width - index - 1];
    if (byte === undefined) return { ok: false, error: "OUT_OF_BOUNDS" };
    value = value * 256 + byte;
  }
  return { ok: true, value };
}
export function readSigned(
  bytes: Uint8Array,
  offset: number,
  width: Width,
  endian: Endian,
): ByteResult<number> {
  const value = readUnsigned(bytes, offset, width, endian);
  if (!value.ok) return value;
  const limit = width === 1 ? 128 : width === 2 ? 32768 : 2147483648;
  return {
    ok: true,
    value: value.value >= limit ? value.value - limit * 2 : value.value,
  };
}
export function writeUnsigned(
  bytes: Uint8Array,
  offset: number,
  width: Width,
  value: number,
  endian: Endian,
): ByteResult<undefined> {
  if (width !== 1 && width !== 2 && width !== 4)
    return { ok: false, error: "INVALID_ENCODING" };
  const checked = check(bytes, offset, width, endian);
  if (!checked.ok) return checked;
  const limit = width === 1 ? 256 : width === 2 ? 65536 : 0x100000000;
  if (!Number.isInteger(value) || value < 0 || value >= limit)
    return { ok: false, error: "VALUE_OUT_OF_RANGE" };
  store(bytes, offset, width, value, endian);
  return { ok: true, value: undefined };
}
export function writeSigned(
  bytes: Uint8Array,
  offset: number,
  width: Width,
  value: number,
  endian: Endian,
): ByteResult<undefined> {
  if (width !== 1 && width !== 2 && width !== 4)
    return { ok: false, error: "INVALID_ENCODING" };
  const limit = width === 1 ? 128 : width === 2 ? 32768 : 0x80000000;
  if (!Number.isInteger(value) || value < -limit || value >= limit)
    return { ok: false, error: "VALUE_OUT_OF_RANGE" };
  return writeUnsigned(
    bytes,
    offset,
    width,
    value < 0 ? value + limit * 2 : value,
    endian,
  );
}
export function writeWord64(
  bytes: Uint8Array,
  offset: number,
  value: Word64,
  endian: Endian,
): ByteResult<undefined> {
  const checked = check(bytes, offset, 8, endian);
  if (!checked.ok) return checked;
  if (!fromParts(value.lo, value.hi).ok)
    return { ok: false, error: "VALUE_OUT_OF_RANGE" };
  store(bytes, offset, 4, endian === "little" ? value.lo : value.hi, endian);
  store(
    bytes,
    offset + 4,
    4,
    endian === "little" ? value.hi : value.lo,
    endian,
  );
  return { ok: true, value: undefined };
}

/** Exact binary64 payload; NaNs use one canonical positive quiet encoding. */
export function encodeFloat64(value: number): Word64 {
  if (Number.isNaN(value)) return { lo: 0, hi: 0x7ff80000 };
  const sign = value < 0 || (value === 0 && 1 / value < 0) ? 0x80000000 : 0;
  let magnitude = value < 0 ? -value : value;
  if (magnitude === 1 / 0) return { lo: 0, hi: sign + 0x7ff00000 };
  if (magnitude === 0) return { lo: 0, hi: sign };
  let exponent = 0;
  let significand: number;
  if (magnitude < 2.2250738585072014e-308) {
    // Subnormal payloads count units of the smallest representable value.
    significand = magnitude / 5e-324;
  } else {
    exponent = 1023;
    // Scaling by powers of two is exact throughout the normal range.
    while (magnitude >= 2) {
      magnitude /= 2;
      exponent++;
    }
    while (magnitude < 1) {
      magnitude *= 2;
      exponent--;
    }
    significand = (magnitude - 1) * 4503599627370496;
  }
  return {
    lo: significand % 4294967296,
    hi: sign + exponent * 1048576 + Math.floor(significand / 4294967296),
  };
}

export function readWord64(
  bytes: Uint8Array,
  offset: number,
  endian: Endian,
): ByteResult<Word64> {
  const checked = check(bytes, offset, 8, endian);
  if (!checked.ok) return checked;
  const first = readUnsigned(bytes, offset, 4, endian),
    second = readUnsigned(bytes, offset + 4, 4, endian);
  if (!first.ok) return first;
  if (!second.ok) return second;
  return {
    ok: true,
    value:
      endian === "little"
        ? { lo: first.value, hi: second.value }
        : { lo: second.value, hi: first.value },
  };
}
export type FloatWidth = 2 | 4 | 8;
function scaleBinary(value: number, exponent: number): number {
  while (exponent > 0) {
    value *= 2;
    exponent--;
  }
  while (exponent < 0) {
    value /= 2;
    exponent++;
  }
  return value;
}
function roundEven(value: number): number {
  const lower = Math.floor(value),
    fraction = value - lower;
  return fraction > 0.5 || (fraction === 0.5 && lower % 2 !== 0)
    ? lower + 1
    : lower;
}
/** Encode directly from binary64, avoiding intermediate binary32 rounding for
 * binary16. Finite normal and subnormal results use round-to-nearest-even. */
function encodeSmallFloat(value: number, width: 2 | 4): number {
  const fractionBase = width === 2 ? 1024 : 8388608;
  const exponentLimit = width === 2 ? 31 : 255;
  const bias = width === 2 ? 15 : 127;
  const sign =
    value < 0 || (value === 0 && 1 / value < 0)
      ? fractionBase * (exponentLimit + 1)
      : 0;
  if (Number.isNaN(value))
    return exponentLimit * fractionBase + fractionBase / 2;
  let magnitude = value < 0 ? -value : value;
  if (magnitude === 1 / 0) return sign + exponentLimit * fractionBase;
  if (magnitude === 0) return sign;
  let exponent = 0;
  while (magnitude >= 2) {
    magnitude /= 2;
    exponent++;
  }
  while (magnitude < 1) {
    magnitude *= 2;
    exponent--;
  }
  let encodedExponent = exponent + bias;
  if (encodedExponent <= 0) {
    const fraction = roundEven(
      scaleBinary(magnitude, exponent + bias - 1) * fractionBase,
    );
    return sign + fraction;
  }
  let fraction = roundEven((magnitude - 1) * fractionBase);
  if (fraction === fractionBase) {
    fraction = 0;
    encodedExponent++;
  }
  if (encodedExponent >= exponentLimit)
    return sign + exponentLimit * fractionBase;
  return sign + encodedExponent * fractionBase + fraction;
}
export function decodeFloat64(word: Word64): ByteResult<number> {
  if (!fromParts(word.lo, word.hi).ok)
    return { ok: false, error: "VALUE_OUT_OF_RANGE" };
  const negative = word.hi >= 2147483648;
  const exponent = Math.floor(word.hi / 1048576) % 2048;
  const fraction = (word.hi % 1048576) * 4294967296 + word.lo;
  let value: number;
  if (exponent === 2047) value = fraction === 0 ? 1 / 0 : 0 / 0;
  else if (exponent === 0) value = fraction * 5e-324;
  else value = scaleBinary(1 + fraction / 4503599627370496, exponent - 1023);
  return { ok: true, value: negative ? -value : value };
}
export function readFloat(
  bytes: Uint8Array,
  offset: number,
  width: FloatWidth,
  endian: Endian,
): ByteResult<number> {
  if (width !== 2 && width !== 4 && width !== 8)
    return { ok: false, error: "INVALID_ENCODING" };
  if (width === 8) {
    const word = readWord64(bytes, offset, endian);
    if (!word.ok) return word;
    return decodeFloat64(word.value);
  }
  const encoded = readUnsigned(bytes, offset, width === 2 ? 2 : 4, endian);
  if (!encoded.ok) return encoded;
  return {
    ok: true,
    value: decodeSmallFloat(encoded.value, width === 2 ? 2 : 4),
  };
}
function decodeSmallFloat(encoded: number, width: 2 | 4): number {
  const fractionBase = width === 2 ? 1024 : 8388608,
    exponentLimit = width === 2 ? 31 : 255,
    bias = width === 2 ? 15 : 127;
  const negative = encoded >= fractionBase * (exponentLimit + 1);
  const exponent = Math.floor(encoded / fractionBase) % (exponentLimit + 1);
  const fraction = encoded % fractionBase;
  let value: number;
  if (exponent === exponentLimit) value = fraction === 0 ? 1 / 0 : 0 / 0;
  else if (exponent === 0)
    value = scaleBinary(fraction / fractionBase, 1 - bias);
  else value = scaleBinary(1 + fraction / fractionBase, exponent - bias);
  return negative ? -value : value;
}
/** Round binary64 directly to binary16/binary32 and back, without byte allocation. */
export function roundFloat(value: number, width: 2 | 4): number {
  return decodeSmallFloat(encodeSmallFloat(value, width), width);
}

export function writeFloat(
  bytes: Uint8Array,
  offset: number,
  width: FloatWidth,
  value: number,
  endian: Endian,
): ByteResult<undefined> {
  if (width !== 2 && width !== 4 && width !== 8)
    return { ok: false, error: "INVALID_ENCODING" };
  const checked = check(bytes, offset, width, endian);
  if (!checked.ok) return checked;
  if (width === 8)
    return writeWord64(bytes, offset, encodeFloat64(value), endian);
  store(
    bytes,
    offset,
    width,
    encodeSmallFloat(value, width === 2 ? 2 : 4),
    endian,
  );
  return { ok: true, value: undefined };
}
