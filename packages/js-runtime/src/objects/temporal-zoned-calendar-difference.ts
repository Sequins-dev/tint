import { calendarDateAdd, calendarDateUntil } from "./calendar.ts";
import { bubbleZonedCalendarDuration } from "./temporal-zoned-calendar-bubble.ts";
import {
  roundInteger,
  type RoundingMode,
} from "@tint/foundation/numeric/integer-rounding";
import {
  compare,
  subtract,
  fromNumber,
  add,
  multiply,
  negate,
  divideToNumber,
  divide,
  toNumber,
  type Integer,
} from "@tint/foundation/numeric/big-integer";
import { type GregorianDate } from "@tint/foundation/chrono/gregorian-calendar";
import {
  balanceTimeDuration,
  durationFields,
  createDuration,
  type Duration,
} from "@tint/foundation/chrono/temporal-duration";
import type { BigIntValue } from "./bigints.ts";
import type { TemporalZonedDateTime } from "./temporal-zoned-date-time.ts";
import { zonedDateTimeArithmetic } from "./temporal-zoned-arithmetic.ts";
import { temporalZonedData } from "./temporal-zoned-construction.ts";
import { combineTemporalDateTime } from "./temporal-date-time-conversion.ts";
import { interpretZonedOffset } from "./temporal-zoned-conversion.ts";
import { clockNanoseconds } from "./temporal-time-arithmetic.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
/** DifferenceZonedDateTime: choose a local date at the origin's clock time, then
 * retain the exact epoch remainder. Local-clock subtraction alone loses overlaps. */
export function unroundedZonedCalendarDifference(
  own: TemporalZonedDateTime,
  end: BigIntValue,
  largest: string,
  realm: ErrorRealm,
): Duration {
  if (
    largest !== "year" &&
    largest !== "month" &&
    largest !== "week" &&
    largest !== "day"
  )
    throw createRuntimeError(realm, "range");
  const dateLargest = largest;
  const target = temporalZonedData(end, own.zone, realm),
    zero = fromNumber(0);
  if (zero === undefined) throw "ZONED_CALENDAR_ZERO_INVARIANT";
  const direction = compare(end.integer, own.epoch.integer);
  function result(date: GregorianDate, time: Integer): Duration {
    const dates = calendarDateUntil(
        own.dateTime.calendar ?? "iso8601",
        own.dateTime.date,
        date,
        dateLargest,
      ),
      clock = balanceTimeDuration(time, 0);
    if (dates === undefined || clock === undefined)
      throw createRuntimeError(realm, "range");
    const data = createDuration([
      dates.years,
      dates.months,
      dates.weeks,
      dates.days,
      clock.hours,
      clock.minutes,
      clock.seconds,
      clock.milliseconds,
      clock.microseconds,
      clock.nanoseconds,
    ]);
    if (data === undefined) throw createRuntimeError(realm, "range");
    return data;
  }
  const first = own.dateTime.date,
    last = target.dateTime.date;
  if (
    direction === 0 ||
    (first.year === last.year &&
      first.month === last.month &&
      first.day === last.day)
  )
    return result(first, subtract(end.integer, own.epoch.integer));
  const correctionSign = -direction;
  const clockSign = compare(
    subtract(clockNanoseconds(target.dateTime), clockNanoseconds(own.dateTime)),
    zero,
  );
  let correction = clockSign === correctionSign ? 1 : 0;
  const maximum = direction > 0 ? 2 : 1;
  while (correction <= maximum) {
    const date = calendarDateAdd(
      own.dateTime.calendar ?? "iso8601",
      last,
      0,
      0,
      0,
      correction * correctionSign,
      "constrain",
    );
    if (date === undefined) throw createRuntimeError(realm, "range");
    const local = combineTemporalDateTime(date, own.dateTime, realm);
    const candidate = interpretZonedOffset(
      local,
      own.zone,
      undefined,
      "ignore",
      realm,
    );
    const time = subtract(end.integer, candidate.epoch.integer);
    if (compare(time, zero) !== correctionSign) return result(date, time);
    correction++;
  }
  throw "ZONED_CALENDAR_DAY_CORRECTION_INVARIANT";
}

/** Exact fractional unit count on a calendar grid. Both endpoints are validated,
 * including an endpoint the eventual rounding mode will not select. */
function zonedCalendarFraction(
  own: TemporalZonedDateTime,
  end: BigIntValue,
  unit: string,
  increment: number,
  realm: ErrorRealm,
  largest: string = unit,
): {
  readonly numerator: Integer;
  readonly denominator: Integer;
  readonly years: number;
  readonly months: number;
  readonly weeks: number;
  readonly count: number;
  readonly direction: number;
  readonly shifted: boolean;
  readonly start: BigIntValue;
  readonly finish: BigIntValue;
} {
  const raw = unroundedZonedCalendarDifference(own, end, largest, realm);
  let count =
    unit === "year"
      ? raw.years
      : unit === "month"
        ? raw.months
        : unit === "week"
          ? raw.weeks + Math.trunc(raw.days / 7)
          : raw.days;
  count = Math.trunc(count / increment) * increment;
  const initialCount = count,
    years = unit === "year" ? 0 : raw.years,
    months = unit === "week" || unit === "day" ? raw.months : 0,
    weeks = unit === "day" ? raw.weeks : 0;
  const direction = compare(end.integer, own.epoch.integer) < 0 ? -1 : 1;
  const step = direction * increment;
  function endpoint(value: number): BigIntValue {
    const data = createDuration([
      unit === "year" ? value : years,
      unit === "month" ? value : months,
      unit === "week" ? value : weeks,
      unit === "day" ? value : 0,
    ]);
    if (data === undefined) throw createRuntimeError(realm, "range");
    return zonedDateTimeArithmetic(own, data, false, "constrain", realm);
  }
  let start = endpoint(count),
    finish = endpoint(count + step);
  while (compare(start.integer, end.integer) === direction) {
    count -= step;
    finish = start;
    start = endpoint(count);
  }
  while (compare(finish.integer, end.integer) === -direction) {
    count += step;
    start = finish;
    finish = endpoint(count + step);
  }
  const signedSpan = subtract(finish.integer, start.integer),
    span = signedSpan.negative ? negate(signedSpan) : signedSpan,
    whole = fromNumber(count),
    size = fromNumber(increment);
  if (whole === undefined || size === undefined)
    throw "ZONED_CALENDAR_TOTAL_COUNT_INVARIANT";
  if (span.len === 0) throw createRuntimeError(realm, "range");
  const numerator = add(
    multiply(whole, span),
    multiply(subtract(end.integer, start.integer), size),
  );
  return {
    numerator,
    denominator: span,
    years,
    months,
    weeks,
    count,
    direction,
    shifted: count !== initialCount,
    start,
    finish,
  };
}
export function totalZonedCalendarDifference(
  own: TemporalZonedDateTime,
  end: BigIntValue,
  unit: string,
  realm: ErrorRealm,
): number {
  const fraction = zonedCalendarFraction(own, end, unit, 1, realm);
  const result = divideToNumber(fraction.numerator, fraction.denominator);
  if (result === undefined) throw "ZONED_CALENDAR_TOTAL_INTERVAL_INVARIANT";
  return result;
}

/** Single-unit calendar rounding uses exact epoch distances, not a Number total. */
export function roundZonedCalendarUnit(
  own: TemporalZonedDateTime,
  end: BigIntValue,
  unit: string,
  increment: number,
  mode: RoundingMode,
  since: boolean,
  realm: ErrorRealm,
  largest: string = unit,
): Duration {
  const fraction = zonedCalendarFraction(
      own,
      end,
      unit,
      increment,
      realm,
      largest,
    ),
    size = fromNumber(increment);
  if (size === undefined) throw "ZONED_CALENDAR_ROUND_SIZE_INVARIANT";
  const rounded = roundInteger(
    since ? negate(fraction.numerator) : fraction.numerator,
    multiply(fraction.denominator, size),
    mode,
  );
  if (rounded === undefined) throw "ZONED_CALENDAR_ROUND_RESULT_INVARIANT";
  const divided = divide(rounded, fraction.denominator);
  if (divided === undefined) throw "ZONED_CALENDAR_ROUND_UNIT_INVARIANT";
  const count = (since ? -1 : 1) * toNumber(divided.quotient);
  let result = createDuration([
    unit === "year" ? count : fraction.years,
    unit === "month" ? count : fraction.months,
    unit === "week" ? count : fraction.weeks,
    unit === "day" ? count : 0,
  ]);
  if (result === undefined) throw createRuntimeError(realm, "range");
  const expanded = count === fraction.count + fraction.direction * increment;
  if (expanded || fraction.shifted)
    result = bubbleZonedCalendarDuration(
      own,
      result,
      (expanded ? fraction.finish : fraction.start).integer,
      largest,
      unit,
      fraction.direction,
      realm,
    );
  if (!since) return result;
  const fields = durationFields(result);
  for (let index = 0; index < fields.length; index++)
    fields[index] = -(fields[index] ?? 0);
  const negated = createDuration(fields);
  if (negated === undefined) throw "ZONED_CALENDAR_ROUND_NEGATION_INVARIANT";
  return negated;
}
