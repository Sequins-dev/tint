import {
  add,
  divide,
  fromNumber,
  negate,
  toNumber,
} from "@tint/foundation/numeric/big-integer";
import {
  addGregorianDate,
  epochDayFromGregorian,
  type GregorianDate,
} from "@tint/foundation/chrono/gregorian-calendar";
import type { ISODateTime } from "@tint/foundation/chrono/iso-date-time";
import {
  durationTimeNanoseconds,
  type Duration,
} from "@tint/foundation/chrono/temporal-duration";
import { combineTemporalDateTime } from "./temporal-date-time-conversion.ts";
import {
  clockNanoseconds,
  splitClockNanoseconds,
} from "./temporal-time-arithmetic.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
function calendarAdd(
  date: GregorianDate,
  duration: Duration,
  days: number,
  subtract: boolean,
  policy: string,
  realm: ErrorRealm,
): GregorianDate {
  const sign = subtract ? -1 : 1;
  const result = addGregorianDate(
    date,
    sign * duration.years,
    sign * duration.months,
    sign * duration.weeks,
    sign * duration.days + days,
    policy === "reject" ? "reject" : "constrain",
  );
  if (result === undefined) throw createRuntimeError(realm, "range");
  return result;
}
export function plainDateArithmetic(
  date: GregorianDate,
  duration: Duration,
  subtract: boolean,
  policy: string,
  realm: ErrorRealm,
): GregorianDate {
  const day = fromNumber(86400000000000);
  if (day === undefined) throw "TEMPORAL_DAY_FACTOR_INVARIANT";
  const split = divide(durationTimeNanoseconds(duration), day);
  if (split === undefined) throw "TEMPORAL_DATE_DURATION_DIVISION_INVARIANT";
  const days = toNumber(split.quotient) * (subtract ? -1 : 1);
  const result = calendarAdd(date, duration, days, subtract, policy, realm);
  const epoch = epochDayFromGregorian(result.year, result.month, result.day);
  if (epoch === undefined || epoch < -100000001 || epoch > 100000000)
    throw createRuntimeError(realm, "range");
  return result;
}
/** YearMonth addition operates on the first day, independently of its stored
 * reference day. Lower units are rejected before deriving that date. */
export function plainYearMonthArithmetic(
  date: GregorianDate,
  duration: Duration,
  subtract: boolean,
  policy: string,
  realm: ErrorRealm,
): GregorianDate {
  if (
    duration.weeks !== 0 ||
    duration.days !== 0 ||
    duration.hours !== 0 ||
    duration.minutes !== 0 ||
    duration.seconds !== 0 ||
    duration.milliseconds !== 0 ||
    duration.microseconds !== 0 ||
    duration.nanoseconds !== 0
  )
    throw createRuntimeError(realm, "range");
  return plainDateArithmetic(
    { year: date.year, month: date.month, day: 1 },
    duration,
    subtract,
    policy,
    realm,
  );
}
export function plainDateTimeArithmetic(
  dateTime: ISODateTime,
  duration: Duration,
  subtract: boolean,
  policy: string,
  realm: ErrorRealm,
): ISODateTime {
  const delta = durationTimeNanoseconds(duration);
  const time = splitClockNanoseconds(
    add(clockNanoseconds(dateTime), subtract ? negate(delta) : delta),
  );
  const date = calendarAdd(
    dateTime.date,
    duration,
    toNumber(time.days),
    subtract,
    policy,
    realm,
  );
  return combineTemporalDateTime(date, time.time, realm);
}
