import { encodeFloat64 } from "../binary/bytes.ts";
import {
  add,
  subtract,
  compare,
  negate,
  fromNumber,
  toNumber,
  shift,
  type Integer,
} from "./big-integer.ts";

/** Exact finite sum in units of the smallest binary64 subnormal, plus exceptional state. */
export interface ExactSum {
  units: Integer;
  negativeZero: boolean;
  nan: boolean;
  positiveInfinity: boolean;
  negativeInfinity: boolean;
}
function integer(value: number): Integer {
  const result = fromNumber(value);
  if (result === undefined) throw "SUM_INTEGER_INVARIANT";
  return result;
}
function shifted(value: Integer, count: number): Integer {
  const capacity = value.digits.length + Math.ceil(Math.max(0, count) / 26) + 1;
  const result = shift(value, integer(count), capacity);
  if (result === undefined) throw "SUM_SHIFT_INVARIANT";
  return result;
}
export function createExactSum(): ExactSum {
  return {
    units: integer(0),
    negativeZero: true,
    nan: false,
    positiveInfinity: false,
    negativeInfinity: false,
  };
}
/** Accepts Numbers only. Iterable protocols and type validation belong to the caller. */
export function addExactSum(state: ExactSum, value: number): void {
  if (value !== 0 || 1 / value !== -Infinity) state.negativeZero = false;
  if (value !== value) {
    state.nan = true;
    return;
  }
  if (value === Infinity) {
    state.positiveInfinity = true;
    return;
  }
  if (value === -Infinity) {
    state.negativeInfinity = true;
    return;
  }
  if (
    value === 0 ||
    state.nan ||
    state.positiveInfinity ||
    state.negativeInfinity
  )
    return;
  const word = encodeFloat64(value);
  const exponent = Math.floor(word.hi / 1048576) % 2048;
  const fraction = (word.hi % 1048576) * 4294967296 + word.lo;
  const mantissa = integer(
    exponent === 0 ? fraction : fraction + 4503599627370496,
  );
  const units = shifted(mantissa, exponent === 0 ? 0 : exponent - 1);
  state.units = add(state.units, value < 0 ? negate(units) : units);
}
/** Round once to nearest/ties-to-even, after exact cancellation and overflow recovery. */
export function finishExactSum(state: ExactSum): number {
  if (state.nan || (state.positiveInfinity && state.negativeInfinity))
    return NaN;
  if (state.positiveInfinity) return Infinity;
  if (state.negativeInfinity) return -Infinity;
  const total = state.units;
  if (total.digits.length === 0) return state.negativeZero ? -0 : 0;
  const magnitude = total.negative ? negate(total) : total;
  let top = magnitude.digits[magnitude.digits.length - 1] ?? 0;
  let bits = (magnitude.digits.length - 1) * 26;
  while (top !== 0) {
    bits++;
    top = Math.floor(top / 2);
  }
  const discard = Math.max(0, bits - 53);
  const quotient = shifted(magnitude, -discard);
  let retained = toNumber(quotient);
  if (discard !== 0) {
    const remainder = subtract(magnitude, shifted(quotient, discard));
    const halfway = shifted(integer(1), discard - 1);
    const order = compare(remainder, halfway);
    if (order > 0 || (order === 0 && retained % 2 !== 0)) retained++;
  }
  let exponent = discard - 1074;
  while (exponent < 0) {
    retained /= 2;
    exponent++;
  }
  while (exponent > 0) {
    retained *= 2;
    exponent--;
  }
  return total.negative ? -retained : retained;
}
