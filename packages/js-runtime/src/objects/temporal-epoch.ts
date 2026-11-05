import { splitClockNanoseconds } from "./temporal-time-arithmetic.ts";
import {
  parseInteger,
  divide,
  compare,
  negate,
  toNumber,
  fromNumber,
  add,
  multiply,
  type Integer,
} from "@tint/foundation/numeric/big-integer";
import {
  gregorianFromEpochDay,
  epochDayFromGregorian,
} from "@tint/foundation/chrono/gregorian-calendar";
import type { ISODateTime } from "@tint/foundation/chrono/iso-date-time";

/** Split a valid instant exactly before converting the bounded day/remainder to Number. */
export function temporalEpochDateTime(
  epoch: Integer,
  offsetNanoseconds: number,
): ISODateTime | undefined {
  if (!validTemporalEpoch(epoch)) return undefined;
  const offset = fromNumber(offsetNanoseconds);
  if (offset === undefined) return undefined;
  const split = splitClockNanoseconds(add(epoch, offset));
  const day = toNumber(split.days),
    time = split.time;
  const date = gregorianFromEpochDay(day);
  if (date === undefined) return undefined;
  return {
    date,
    hasTime: true,
    hour: time.hour,
    minute: time.minute,
    second: time.second,
    nanosecond: time.nanosecond,
    utc: false,
    offsetNanoseconds,
    timeZone: undefined,
    calendar: "iso8601",
  };
}

/** Inclusive Temporal.Instant nanosecond bounds, independent of local date limits. */
export function validTemporalEpoch(epoch: Integer): boolean {
  const limit = parseInteger("8640000000000000000000", 10);
  if (limit === undefined) throw "TEMPORAL_EPOCH_CONSTANT";
  return compare(epoch, limit) <= 0 && compare(epoch, negate(limit)) >= 0;
}
/** Convert validated ISO components using exact day multiplication and a bounded clock. */
function dateTimeCoordinate(
  data: ISODateTime,
  offsetNanoseconds: number,
): Integer | undefined {
  const day = epochDayFromGregorian(
    data.date.year,
    data.date.month,
    data.date.day,
  );
  if (day === undefined) return undefined;
  const days = fromNumber(day),
    length = fromNumber(86400000000000);
  const clock = fromNumber(
    data.hour * 3600000000000 +
      data.minute * 60000000000 +
      data.second * 1000000000 +
      data.nanosecond -
      offsetNanoseconds,
  );
  if (days === undefined || length === undefined || clock === undefined)
    return undefined;
  return add(multiply(days, length), clock);
}

/** A local coordinate may lie outside Instant bounds until its zone is applied. */
export function temporalDateTimeCoordinate(
  data: ISODateTime,
): Integer | undefined {
  return dateTimeCoordinate(data, 0);
}
export function temporalDateTimeEpoch(
  data: ISODateTime,
  offsetNanoseconds: number,
): Integer | undefined {
  const epoch = dateTimeCoordinate(data, offsetNanoseconds);
  return epoch !== undefined && validTemporalEpoch(epoch) ? epoch : undefined;
}

/** Floor before separating the nonnegative fractional second, including -1 ns. */
export function splitTemporalEpochSecond(
  epoch: Integer,
):
  | { readonly seconds: number; readonly fractionNanoseconds: number }
  | undefined {
  const billion = fromNumber(1000000000);
  if (billion === undefined) throw "TEMPORAL_SECOND_CONSTANT";
  const split = divide(epoch, billion);
  if (split === undefined) throw "TEMPORAL_SECOND_DIVISION";
  const negative = split.remainder.negative;
  const seconds = toNumber(split.quotient) - (negative ? 1 : 0);
  if (!Number.isSafeInteger(seconds)) return undefined;
  const fractionNanoseconds = toNumber(
    negative ? add(split.remainder, billion) : split.remainder,
  );
  return { seconds, fractionNanoseconds };
}

/** Epoch milliseconds round toward negative infinity, including sub-millisecond negatives. */
export function temporalEpochMilliseconds(epoch: Integer): number {
  const divisor = parseInteger("1000000", 10);
  if (divisor === undefined) throw "TEMPORAL_MILLISECOND_CONSTANT";
  const division = divide(epoch, divisor);
  if (division === undefined) throw "TEMPORAL_MILLISECOND_DIVISION";
  return toNumber(division.quotient) - (division.remainder.negative ? 1 : 0);
}

/** Convert integral epoch milliseconds exactly, enforcing Instant's inclusive bounds. */
export function temporalEpochFromMilliseconds(
  value: number,
): Integer | undefined {
  const milliseconds = fromNumber(value),
    factor = fromNumber(1000000);
  if (milliseconds === undefined) return undefined;
  if (factor === undefined) throw "TEMPORAL_MILLISECOND_CONSTANT";
  const epoch = multiply(milliseconds, factor);
  return validTemporalEpoch(epoch) ? epoch : undefined;
}
