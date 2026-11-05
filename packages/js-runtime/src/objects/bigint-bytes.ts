import {
  add,
  multiply,
  fromNumber,
  truncateInteger,
} from "@tint/foundation/numeric/big-integer";
import {
  readWord64,
  writeWord64,
  type Endian,
} from "@tint/foundation/binary/bytes";
import { createBigIntValue, type BigIntValue } from "./bigints.ts";

/** Exact word conversion without routing a 64-bit integer through Number. */
export function readBigIntBytes(
  bytes: Uint8Array,
  offset: number,
  endian: Endian,
  signed: boolean,
): BigIntValue {
  const word = readWord64(bytes, offset, endian);
  if (!word.ok) throw "BIGINT_READ_BOUNDS";
  const hi = word.value.hi;
  const high = fromNumber(signed && hi >= 2147483648 ? hi - 4294967296 : hi);
  const low = fromNumber(word.value.lo);
  const base = fromNumber(4294967296);
  if (high === undefined || low === undefined || base === undefined)
    throw "BIGINT_WORD_INVARIANT";
  return createBigIntValue(add(multiply(high, base), low));
}
export function writeBigIntBytes(
  bytes: Uint8Array,
  offset: number,
  value: BigIntValue,
  endian: Endian,
): void {
  const integer = truncateInteger(value.integer, 64, false, 3);
  if (integer === undefined) throw "BIGINT_WIDTH_INVARIANT";
  const d0 = integer.digits[0] ?? 0;
  const d1 = integer.digits[1] ?? 0;
  const d2 = integer.digits[2] ?? 0;
  const lo = d0 + (d1 % 64) * 67108864;
  const hi = Math.floor(d1 / 64) + d2 * 1048576;
  if (!writeWord64(bytes, offset, { lo, hi }, endian).ok)
    throw "BIGINT_WRITE_BOUNDS";
}
