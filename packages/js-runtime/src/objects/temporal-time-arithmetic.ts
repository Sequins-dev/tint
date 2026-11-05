import {
  fromNumber,
  divide,
  subtract,
  add,
  toNumber,
  type Integer,
} from "@tint/foundation/numeric/big-integer";
import type { ISOTime } from "@tint/foundation/chrono/iso-date-time";
export interface ClockSplit {
  readonly days: Integer;
  readonly time: ISOTime;
}
/** Convert a valid single-day clock without losing integer nanoseconds. */
export function clockNanoseconds(time: ISOTime): Integer {
  const value = fromNumber(
    time.hour * 3600000000000 +
      time.minute * 60000000000 +
      time.second * 1000000000 +
      time.nanosecond,
  );
  if (value === undefined) throw "TEMPORAL_CLOCK_INTEGER_INVARIANT";
  return value;
}
/** Euclidean day division works for arbitrary magnitudes, independent of Instant limits. */
export function splitClockNanoseconds(value: Integer): ClockSplit {
  const length = fromNumber(86400000000000),
    one = fromNumber(1);
  if (length === undefined || one === undefined)
    throw "TEMPORAL_CLOCK_CONSTANT";
  const split = divide(value, length);
  if (split === undefined) throw "TEMPORAL_CLOCK_DIVISION";
  const negative = split.remainder.negative;
  const days = negative ? subtract(split.quotient, one) : split.quotient;
  const remainder = toNumber(
    negative ? add(split.remainder, length) : split.remainder,
  );
  return {
    days,
    time: {
      hour: Math.floor(remainder / 3600000000000),
      minute: Math.floor(remainder / 60000000000) % 60,
      second: Math.floor(remainder / 1000000000) % 60,
      nanosecond: remainder % 1000000000,
    },
  };
}
