import { calendarDateAdd } from "./calendar.ts";
import { compare, type Integer } from "@tint/foundation/numeric/big-integer";
import { epochDayFromGregorian } from "@tint/foundation/chrono/gregorian-calendar";
import type { TemporalRelativeTo } from "./temporal-relative-to.ts";
import { zonedDateTimeArithmetic } from "./temporal-zoned-arithmetic.ts";
import { compareBigIntValues } from "./bigints.ts";
import {
  add,
  negate,
  multiply,
  divide,
  fromNumber,
  toNumber,
} from "@tint/foundation/numeric/big-integer";
import {
  createDuration,
  durationTimeNanoseconds,
  durationFields,
  balanceTimeDuration,
  type Duration,
} from "@tint/foundation/chrono/temporal-duration";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
/** Context-free addition excludes calendar-dependent years, months and weeks.
 * Balancing retains the largest unit present in either input. */
export function addDurations(
  one: Duration,
  two: Duration,
  subtract: boolean,
  realm: ErrorRealm,
): Duration {
  if (
    one.years !== 0 ||
    one.months !== 0 ||
    one.weeks !== 0 ||
    two.years !== 0 ||
    two.months !== 0 ||
    two.weeks !== 0
  )
    throw createRuntimeError(realm, "range");
  const a = durationFields(one),
    b = durationFields(two);
  let largest = 9;
  for (let i = 3; i < 10; i++)
    if (a[i] !== 0 || b[i] !== 0) {
      largest = i;
      break;
    }
  const day = fromNumber(86400000000000),
    firstDays = fromNumber(one.days),
    secondDays = fromNumber(two.days);
  if (day === undefined || firstDays === undefined || secondDays === undefined)
    throw "DURATION_ADD_INTEGER_INVARIANT";
  const first = add(multiply(firstDays, day), durationTimeNanoseconds(one)),
    second = add(multiply(secondDays, day), durationTimeNanoseconds(two));
  const total = add(first, subtract ? negate(second) : second);
  if (largest !== 3) {
    const result = balanceTimeDuration(total, largest - 4);
    if (result === undefined) throw createRuntimeError(realm, "range");
    return result;
  }
  const split = divide(total, day);
  if (split === undefined) throw "DURATION_ADD_SPLIT_INVARIANT";
  const time = balanceTimeDuration(split.remainder, 0);
  if (time === undefined) throw createRuntimeError(realm, "range");
  const result = createDuration([
    0,
    0,
    0,
    toNumber(split.quotient),
    time.hours,
    time.minutes,
    time.seconds,
    time.milliseconds,
    time.microseconds,
    time.nanoseconds,
  ]);
  if (result === undefined) throw createRuntimeError(realm, "range");
  return result;
}

/** Compare exact elapsed totals, applying relative calendar context only when
 * needed. Identical fields compare equal after the adapter has read options. */
export function compareDurations(
  one: Duration,
  two: Duration,
  relative: TemporalRelativeTo,
  realm: ErrorRealm,
): number {
  const first = durationFields(one),
    second = durationFields(two);
  if (first.every((value, index) => value === second[index])) return 0;
  const calendar =
    one.years !== 0 ||
    one.months !== 0 ||
    one.weeks !== 0 ||
    two.years !== 0 ||
    two.months !== 0 ||
    two.weeks !== 0;
  if (
    relative.kind === "zoned" &&
    (calendar || one.days !== 0 || two.days !== 0)
  ) {
    const zoned = relative.value;
    const a = zonedDateTimeArithmetic(zoned, one, false, "constrain", realm),
      b = zonedDateTimeArithmetic(zoned, two, false, "constrain", realm);
    return compareBigIntValues(a, b);
  }
  if (calendar && relative.kind !== "plain")
    throw createRuntimeError(realm, "range");
  const day = fromNumber(86400000000000),
    limitSeconds = fromNumber(9007199254740992),
    billion = fromNumber(1000000000);
  if (day === undefined || limitSeconds === undefined || billion === undefined)
    throw "DURATION_COMPARE_CONSTANT_INVARIANT";
  const dayLength = day,
    limit = multiply(limitSeconds, billion);
  function elapsed(data: Duration): Integer {
    let days = data.days;
    if (calendar && relative.kind === "plain") {
      const start = relative.date,
        end = calendarDateAdd(
          relative.calendar ?? "iso8601",
          start,
          data.years,
          data.months,
          data.weeks,
          0,
          "constrain",
        );
      if (end === undefined) throw createRuntimeError(realm, "range");
      const a = epochDayFromGregorian(start.year, start.month, start.day),
        b = epochDayFromGregorian(end.year, end.month, end.day);
      if (a === undefined || b === undefined)
        throw "DURATION_COMPARE_DATE_INVARIANT";
      days += b - a;
    }
    const count = fromNumber(days);
    if (count === undefined) throw "DURATION_COMPARE_DAYS_INVARIANT";
    const value = add(
      multiply(count, dayLength),
      durationTimeNanoseconds(data),
    );
    if (compare(value.negative ? negate(value) : value, limit) >= 0)
      throw createRuntimeError(realm, "range");
    return value;
  }
  return compare(elapsed(one), elapsed(two));
}
