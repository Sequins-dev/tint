import { totalZonedCalendarDifference } from "./temporal-zoned-calendar-difference.ts";
import { combineTemporalDateTime } from "./temporal-date-time-conversion.ts";
import {
  add,
  subtract,
  multiply,
  compare,
  negate,
  fromNumber,
  toNumber,
  divideToNumber,
  divide,
  type Integer,
} from "@tint/foundation/numeric/big-integer";
import {
  addGregorianDate,
  epochDayFromGregorian,
  type GregorianDate,
} from "@tint/foundation/chrono/gregorian-calendar";
import {
  durationTimeNanoseconds,
  createDuration,
  type Duration,
} from "@tint/foundation/chrono/temporal-duration";
import type { ISODateTime } from "@tint/foundation/chrono/iso-date-time";
import {
  readTemporalRelativeTo,
  type TemporalRelativeTo,
} from "./temporal-relative-to.ts";
import { temporalStringOption } from "./temporal-options.ts";
import { optionValue } from "./options.ts";
import { temporalTimeUnitNanoseconds } from "./temporal-rounding.ts";
import { zonedDateTimeArithmetic } from "./temporal-zoned-arithmetic.ts";
import { temporalEpochDateTime } from "./temporal-epoch.ts";
import { plainDateTimeDifference } from "./temporal-date-time-difference.ts";
import {
  clockNanoseconds,
  splitClockNanoseconds,
} from "./temporal-time-arithmetic.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
import type { ObjectHooks } from "./operations.ts";
const nsPerDay = 86400000000000;
function integer(value: number): Integer {
  const result = fromNumber(value);
  if (result === undefined) throw "DURATION_TOTAL_INTEGER_INVARIANT";
  return result;
}
function epochDay(date: GregorianDate): number {
  const day = epochDayFromGregorian(date.year, date.month, date.day);
  if (day === undefined) throw "DURATION_TOTAL_DATE_INVARIANT";
  return day;
}
function ratio(numerator: Integer, denominator: Integer): number {
  const result = divideToNumber(numerator, denominator);
  if (result === undefined) throw "DURATION_TOTAL_RATIO_INVARIANT";
  return result;
}
function dateTime(date: GregorianDate): ISODateTime {
  return {
    date,
    hasTime: true,
    hour: 0,
    minute: 0,
    second: 0,
    nanosecond: 0,
    utc: false,
    offsetNanoseconds: undefined,
    timeZone: undefined,
    calendar: "iso8601",
  };
}
function calendarTotal(
  one: ISODateTime,
  two: ISODateTime,
  unit: "year" | "month",
  realm: ErrorRealm,
): number {
  const delta = add(
    multiply(
      integer(epochDay(two.date) - epochDay(one.date)),
      integer(nsPerDay),
    ),
    subtract(clockNanoseconds(two), clockNanoseconds(one)),
  );
  const sign = compare(delta, integer(0));
  if (sign === 0) return 0;
  const difference = plainDateTimeDifference(
    one,
    two,
    {
      largestUnit: unit,
      smallestUnit: "nanosecond",
      increment: 1,
      mode: "trunc",
    },
    false,
    realm,
  );
  let count = unit === "year" ? difference.years : difference.months;
  function endpoint(value: number): GregorianDate {
    const date = addGregorianDate(
      one.date,
      unit === "year" ? value : 0,
      unit === "month" ? value : 0,
      0,
      0,
      "constrain",
    );
    if (date === undefined) throw createRuntimeError(realm, "range");
    return date;
  }
  let start = endpoint(count),
    end = endpoint(count + sign);
  const beyond = add(
    multiply(integer(epochDay(two.date) - epochDay(end)), integer(nsPerDay)),
    subtract(clockNanoseconds(two), clockNanoseconds(one)),
  );
  if (compare(beyond, integer(0)) * sign > 0) {
    count += sign;
    start = end;
    end = endpoint(count + sign);
  }
  const width = multiply(
    integer(Math.abs(epochDay(end) - epochDay(start))),
    integer(nsPerDay),
  );
  const offset = add(
    multiply(integer(epochDay(two.date) - epochDay(start)), integer(nsPerDay)),
    subtract(clockNanoseconds(two), clockNanoseconds(one)),
  );
  return ratio(add(multiply(integer(count), width), offset), width);
}
function requireTimeTotal(total: Integer, realm: ErrorRealm): void {
  const limit = multiply(integer(9007199254740992), integer(1000000000));
  if (compare(total.negative ? negate(total) : total, limit) >= 0)
    throw createRuntimeError(realm, "range");
}
/** Fixed-zone and plain ISO totals share exact integer arithmetic. Relative
 * conversion and observable option reads are performed by the adapter below. */
export function durationTotal(
  data: Duration,
  unit: string,
  relative: TemporalRelativeTo,
  realm: ErrorRealm,
): number {
  const factor =
    unit === "day"
      ? nsPerDay
      : unit === "week"
        ? 7 * nsPerDay
        : temporalTimeUnitNanoseconds(unit);
  const variable = data.years !== 0 || data.months !== 0 || data.weeks !== 0;
  if (relative.kind === "none") {
    if (variable || factor === undefined || unit === "week")
      throw createRuntimeError(realm, "range");
    const total = add(
      multiply(integer(data.days), integer(nsPerDay)),
      durationTimeNanoseconds(data),
    );
    return ratio(total, integer(factor));
  }
  if (relative.kind === "plain" && data.sign !== 0)
    combineTemporalDateTime(
      relative.date,
      { hour: 0, minute: 0, second: 0, nanosecond: 0 },
      realm,
    );
  if (
    relative.kind === "plain" &&
    !variable &&
    factor !== undefined &&
    unit !== "week"
  ) {
    const total = add(
      multiply(integer(data.days), integer(nsPerDay)),
      durationTimeNanoseconds(data),
    );
    return ratio(total, integer(factor));
  }
  let one: ISODateTime, two: ISODateTime, total: Integer;
  if (relative.kind === "zoned") {
    const end = zonedDateTimeArithmetic(
      relative.value,
      data,
      false,
      "constrain",
      realm,
    );
    if (relative.value.zone.kind === "named") {
      if (
        factor !== undefined &&
        temporalTimeUnitNanoseconds(unit) !== undefined
      )
        return ratio(
          subtract(end.integer, relative.value.epoch.integer),
          integer(factor),
        );
      return totalZonedCalendarDifference(relative.value, end, unit, realm);
    }
    const local = temporalEpochDateTime(
      end.integer,
      relative.value.offsetNanoseconds,
    );
    if (local === undefined) throw "DURATION_TOTAL_ZONED_INVARIANT";
    one = relative.value.dateTime;
    two = local;
    total = subtract(end.integer, relative.value.epoch.integer);
    if (unit === "day" || unit === "week") {
      const daysPerUnit = unit === "week" ? 7 : 1;
      const split = divide(total, integer(daysPerUnit * nsPerDay));
      if (split === undefined) throw "DURATION_TOTAL_DAY_WINDOW_INVARIANT";
      const count = toNumber(split.quotient),
        direction = total.negative ? -1 : 1;
      const boundary = createDuration([
        0,
        0,
        0,
        (count + direction) * daysPerUnit,
      ]);
      if (boundary === undefined) throw createRuntimeError(realm, "range");
      zonedDateTimeArithmetic(
        relative.value,
        boundary,
        false,
        "constrain",
        realm,
      );
    }
  } else {
    one = dateTime(relative.date);
    const added = addGregorianDate(
      relative.date,
      data.years,
      data.months,
      data.weeks,
      data.days,
      "constrain",
    );
    if (added === undefined) throw createRuntimeError(realm, "range");
    total = add(
      multiply(
        integer(epochDay(added) - epochDay(relative.date)),
        integer(nsPerDay),
      ),
      durationTimeNanoseconds(data),
    );
    requireTimeTotal(total, realm);
    if (factor !== undefined && unit !== "week")
      return ratio(total, integer(factor));
    const time = splitClockNanoseconds(durationTimeNanoseconds(data));
    const carry = toNumber(time.days);
    const end = addGregorianDate(added, 0, 0, 0, carry, "constrain");
    if (end === undefined) throw createRuntimeError(realm, "range");
    two = {
      ...dateTime(end),
      hour: time.time.hour,
      minute: time.time.minute,
      second: time.time.second,
      nanosecond: time.time.nanosecond,
    };
  }
  if (factor !== undefined) return ratio(total, integer(factor));
  if (unit !== "year" && unit !== "month")
    throw createRuntimeError(realm, "range");
  return calendarTotal(one, two, unit, realm);
}
export function temporalDurationTotal(
  data: Duration,
  options: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): number {
  if (options === undefined) throw createRuntimeError(realm, "type");
  const relative: TemporalRelativeTo =
    typeof options === "string"
      ? { kind: "none" }
      : readTemporalRelativeTo(
          optionValue(options, "relativeTo", realm, hooks),
          realm,
          hooks,
        );
  const unit =
    typeof options === "string"
      ? options
      : temporalStringOption(
          options,
          "unit",
          "",
          [
            "year",
            "years",
            "month",
            "months",
            "week",
            "weeks",
            "day",
            "days",
            "hour",
            "hours",
            "minute",
            "minutes",
            "second",
            "seconds",
            "millisecond",
            "milliseconds",
            "microsecond",
            "microseconds",
            "nanosecond",
            "nanoseconds",
          ],
          realm,
          hooks,
        );
  const canonical = unit.endsWith("s") ? unit.slice(0, -1) : unit;
  if (
    ![
      "year",
      "month",
      "week",
      "day",
      "hour",
      "minute",
      "second",
      "millisecond",
      "microsecond",
      "nanosecond",
    ].includes(canonical)
  )
    throw createRuntimeError(realm, "range");
  return durationTotal(data, canonical, relative, realm);
}
