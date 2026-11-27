import type { Endian } from "@tint/foundation/binary/bytes";
import {
  createInlineInteger,
  integerZero,
} from "@tint/foundation/numeric/big-integer";
import { createBigIntValue, type BigIntValue } from "./bigints.ts";

/** Exact word conversion without routing a 64-bit integer through Number. */
export function readBigIntBytes(
  bytes: Uint8Array,
  offset: number,
  endian: Endian,
  signed: boolean,
): BigIntValue {
  if (!(offset >= 0 && offset + 8 <= bytes.length)) throw "BIGINT_READ_BOUNDS";
  const b0 = bytes[offset] ?? 0;
  const b1 = bytes[offset + 1] ?? 0;
  const b2 = bytes[offset + 2] ?? 0;
  const b3 = bytes[offset + 3] ?? 0;
  const b4 = bytes[offset + 4] ?? 0;
  const b5 = bytes[offset + 5] ?? 0;
  const b6 = bytes[offset + 6] ?? 0;
  const b7 = bytes[offset + 7] ?? 0;
  let lo = 0;
  let hi = 0;
  if (endian === "little") {
    lo = (b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)) >>> 0;
    hi = (b4 | (b5 << 8) | (b6 << 16) | (b7 << 24)) >>> 0;
  } else {
    hi = (b3 | (b2 << 8) | (b1 << 16) | (b0 << 24)) >>> 0;
    lo = (b7 | (b6 << 8) | (b5 << 16) | (b4 << 24)) >>> 0;
  }
  if (lo === 0 && hi === 0) return createBigIntValue(integerZero());
  let negative = false;
  if (signed && (hi & 0x80000000) !== 0) {
    negative = true;
    if (lo === 0) hi = -hi >>> 0;
    else {
      lo = -lo >>> 0;
      hi = ~hi >>> 0;
    }
  }
  const d0 = lo & 67108863;
  const d1 = (lo >>> 26) | ((hi & 1048575) << 6);
  const d2 = hi >>> 20;
  return createBigIntValue(
    createInlineInteger(
      negative,
      d2 !== 0 ? 3 : d1 !== 0 ? 2 : 1,
      d0,
      d1,
      d2,
      0,
    ),
  );
}
export function writeBigIntBytes(
  bytes: Uint8Array,
  offset: number,
  value: BigIntValue,
  endian: Endian,
): void {
  if (!(offset >= 0 && offset + 8 <= bytes.length)) throw "BIGINT_WRITE_BOUNDS";
  const integer = value.integer;
  const d0 = integer.d0;
  const d1 = integer.d1;
  const d2 = integer.d2;
  let lo = (d0 | ((d1 & 63) << 26)) >>> 0;
  let hi = ((d1 >>> 6) | ((d2 & 4095) << 20)) >>> 0;
  if (integer.negative && (lo !== 0 || hi !== 0)) {
    if (lo === 0) hi = -hi >>> 0;
    else {
      lo = -lo >>> 0;
      hi = ~hi >>> 0;
    }
  }
  if (endian === "little") {
    bytes[offset] = lo & 255;
    bytes[offset + 1] = (lo >>> 8) & 255;
    bytes[offset + 2] = (lo >>> 16) & 255;
    bytes[offset + 3] = lo >>> 24;
    bytes[offset + 4] = hi & 255;
    bytes[offset + 5] = (hi >>> 8) & 255;
    bytes[offset + 6] = (hi >>> 16) & 255;
    bytes[offset + 7] = hi >>> 24;
  } else {
    bytes[offset] = hi >>> 24;
    bytes[offset + 1] = (hi >>> 16) & 255;
    bytes[offset + 2] = (hi >>> 8) & 255;
    bytes[offset + 3] = hi & 255;
    bytes[offset + 4] = lo >>> 24;
    bytes[offset + 5] = (lo >>> 16) & 255;
    bytes[offset + 6] = (lo >>> 8) & 255;
    bytes[offset + 7] = lo & 255;
  }
}
