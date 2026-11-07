import {
  calendarDateAdd,
  calendarDateUntil,
  calendarDateAt,
  calendarFieldsFromISO,
} from "./calendar.ts";
import {
  epochDayFromGregorian,
  type GregorianDate,
  type GregorianDateDifference,
} from "@tint/foundation/chrono/gregorian-calendar";
import {
  fromNumber,
  toNumber,
  multiply,
  add,
  negate,
  divide,
  compare,
  type Integer,
} from "@tint/foundation/numeric/big-integer";
import { roundInteger } from "@tint/foundation/numeric/integer-rounding";
import {
  createDuration,
  type Duration,
} from "@tint/foundation/chrono/temporal-duration";
import { partialDateFrom } from "./temporal-partial-date-conversion.ts";
import { plainDateFrom } from "./temporal-plain-date-conversion.ts";
import {
  readTemporalDifferenceSettings,
  type TemporalDifferenceSettings,
} from "./temporal-time-difference.ts";
import { builtinFunction, builtinProperty } from "./intrinsics.ts";
import {
  createObject,
  type OrdinaryObject,
  type ObjectHooks,
} from "./operations.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";
import type { ScriptPropertyKey } from "./symbols.ts";
import { temporalCalendarSlot } from "./temporal-coercion.ts";
function dateDuration(fields: readonly number[], realm: ErrorRealm): Duration {
  const result = createDuration(fields);
  if (result === undefined) throw createRuntimeError(realm, "range");
  return result;
}
function checkDateDay(day: number, realm: ErrorRealm): void {
  if (day < -100000001 || day > 100000000)
    throw createRuntimeError(realm, "range");
}
/** Round between exact calendar endpoints without a floating-point fraction. */
export function roundCalendarDifference(
  one: GregorianDate,
  first: number,
  last: number,
  d: GregorianDateDifference,
  settings: TemporalDifferenceSettings,
  since: boolean,
  realm: ErrorRealm,
  clockRemainder?: Integer,
  calendar: string = "iso8601",
): Duration {
  const zero = fromNumber(0),
    length = fromNumber(clockRemainder === undefined ? 1 : 86400000000000);
  if (zero === undefined || length === undefined)
    throw "CALENDAR_ROUND_SCALE_INVARIANT";
  const fraction = clockRemainder ?? zero,
    unitLength = length;
  function distance(day: number): Integer {
    const days = fromNumber(last - day);
    if (days === undefined) throw "CALENDAR_ROUND_DISTANCE_INVARIANT";
    return add(multiply(days, unitLength), fraction);
  }
  const unit = settings.smallestUnit;
  if (unit !== "year" && unit !== "month" && unit !== "week")
    return rejectUnsupportedExecution(realm);
  const direction = compare(distance(first), zero) >= 0 ? 1 : -1,
    increment = settings.increment;
  const years = unit === "year" ? 0 : d.years,
    months = unit === "week" ? d.months : 0,
    count =
      unit === "year"
        ? d.years
        : unit === "month"
          ? d.months
          : d.weeks + Math.trunc(d.days / 7);
  let startCount = Math.trunc(count / increment) * increment;
  function endpoint(value: number): number {
    const date = calendarDateAdd(
      calendar,
      one,
      unit === "year" ? value : years,
      unit === "month" ? value : months,
      unit === "week" ? value : 0,
      0,
      "constrain",
    );
    if (date === undefined) throw createRuntimeError(realm, "range");
    const day = epochDayFromGregorian(date.year, date.month, date.day);
    if (day === undefined) throw "CALENDAR_ROUND_ENDPOINT_INVARIANT";
    checkDateDay(day, realm);
    return day;
  }
  // A zero count still includes any retained years/months. Plain dates have
  // exact integer endpoints, so compute that prefix instead of using origin.
  let start = endpoint(startCount),
    end = endpoint(startCount + direction * increment);
  let shifted = false;
  if (
    compare(distance(start), zero) * direction < 0 ||
    compare(distance(end), zero) * direction > 0
  ) {
    if (unit === "week") throw "CALENDAR_ROUND_WEEK_WINDOW_INVARIANT";
    startCount += direction * increment;
    start = endpoint(startCount);
    end = endpoint(startCount + direction * increment);
    shifted = true;
  }
  const daysWide = fromNumber(Math.abs(end - start));
  if (daysWide === undefined) throw "CALENDAR_ROUND_WIDTH_INVARIANT";
  const width = multiply(daysWide, length),
    base = fromNumber(startCount),
    signedOffset = distance(start),
    offset = signedOffset.negative ? negate(signedOffset) : signedOffset,
    step = fromNumber(direction * increment),
    quantum = fromNumber(increment);
  if (
    width === undefined ||
    base === undefined ||
    offset === undefined ||
    step === undefined ||
    quantum === undefined
  )
    throw "CALENDAR_ROUND_INTEGER_INVARIANT";
  const numerator = add(multiply(base, width), multiply(offset, step));
  const rounded = roundInteger(
    since ? negate(numerator) : numerator,
    multiply(width, quantum),
    settings.mode,
  );
  if (rounded === undefined) throw "CALENDAR_ROUND_RESULT_INVARIANT";
  const split = divide(rounded, width);
  if (split === undefined || split.remainder.digits.length !== 0)
    throw "CALENDAR_ROUND_DIVISION_INVARIANT";
  const value = (since ? -1 : 1) * toNumber(split.quotient);
  let y = unit === "year" ? value : years,
    m = unit === "month" ? value : months;
  const w = unit === "week" ? value : 0;
  if (
    unit === "month" &&
    settings.largestUnit === "year" &&
    (shifted || value === startCount + direction * increment)
  ) {
    const boundary = calendarDateAdd(
      calendar,
      one,
      y + direction,
      0,
      0,
      0,
      "constrain",
    );
    if (boundary === undefined) throw createRuntimeError(realm, "range");
    const boundaryDay = epochDayFromGregorian(
      boundary.year,
      boundary.month,
      boundary.day,
    );
    if (boundaryDay === undefined) throw "CALENDAR_ROUND_YEAR_INVARIANT";
    checkDateDay(boundaryDay, realm);
    const nudged = value === startCount ? start : end;
    if ((nudged - boundaryDay) * direction >= 0) {
      y += direction;
      m = 0;
    }
  }
  const sign = since ? -1 : 1;
  return dateDuration([sign * y, sign * m, sign * w, 0], realm);
}
/** Carry expanded days into permitted larger calendar units. */
export function bubbleCalendarDifference(
  one: GregorianDate,
  d: GregorianDateDifference,
  direction: number,
  nudgedDay: number,
  largest: string,
  realm: ErrorRealm,
  calendar: string = "iso8601",
): GregorianDateDifference {
  let years = d.years,
    months = d.months,
    weeks = d.weeks,
    days = d.days;
  for (const unit of ["week", "month", "year"]) {
    if (unit === "week" && largest !== "week") continue;
    if (unit === "month" && largest !== "month" && largest !== "year") continue;
    if (unit === "year" && largest !== "year") continue;
    const y = unit === "year" ? years + direction : years,
      m = unit === "year" ? 0 : unit === "month" ? months + direction : months,
      w = unit === "week" ? weeks + direction : 0;
    const boundary = calendarDateAdd(calendar, one, y, m, w, 0, "constrain");
    if (boundary === undefined) throw createRuntimeError(realm, "range");
    const boundaryDay = epochDayFromGregorian(
      boundary.year,
      boundary.month,
      boundary.day,
    );
    if (boundaryDay === undefined) throw "DATE_DIFFERENCE_BOUNDARY_INVARIANT";
    checkDateDay(boundaryDay, realm);
    if ((nudgedDay - boundaryDay) * direction < 0) break;
    years = y;
    months = m;
    weeks = w;
    days = 0;
  }
  return { years, months, weeks, days };
}
/** Settings are validated before this pure calendar/rounding operation.
 * Since negates a difference anchored at the receiver; swapping dates would
 * change month-end behavior. Calendar rounding compares exact date endpoints. */
export function plainDateDifference(
  one: GregorianDate,
  two: GregorianDate,
  settings: TemporalDifferenceSettings,
  since: boolean,
  realm: ErrorRealm,
  calendar: string = "iso8601",
): Duration {
  const first = epochDayFromGregorian(one.year, one.month, one.day),
    last = epochDayFromGregorian(two.year, two.month, two.day);
  if (first === undefined || last === undefined)
    throw createRuntimeError(realm, "range");
  if (first === last) return dateDuration([], realm);
  const largest = settings.largestUnit;
  if (
    largest !== "year" &&
    largest !== "month" &&
    largest !== "week" &&
    largest !== "day"
  )
    throw createRuntimeError(realm, "range");
  const sign = since ? -1 : 1;
  const d = calendarDateUntil(calendar, one, two, largest);
  if (d === undefined) throw createRuntimeError(realm, "range");
  if (settings.smallestUnit === "day" && settings.increment === 1) {
    return dateDuration(
      [sign * d.years, sign * d.months, sign * d.weeks, sign * d.days],
      realm,
    );
  }
  const day = settings.smallestUnit === "day";
  const week = largest === "week" && settings.smallestUnit === "week";
  if (!day && !week)
    return roundCalendarDifference(
      one,
      first,
      last,
      d,
      settings,
      since,
      realm,
      undefined,
      calendar,
    );
  const quantumDays = settings.increment * (week ? 7 : 1),
    delta = day ? d.days : last - first;
  if (week) {
    // Calendar rounding validates both candidates before choosing either one.
    const start = first + Math.trunc(delta / quantumDays) * quantumDays;
    checkDateDay(start, realm);
    checkDateDay(start + (delta > 0 ? 1 : -1) * quantumDays, realm);
  }
  const input = fromNumber(sign * delta),
    quantum = fromNumber(quantumDays);
  if (input === undefined || quantum === undefined)
    throw "DATE_DIFFERENCE_QUANTUM_INVARIANT";
  const result = roundInteger(input, quantum, settings.mode);
  if (result === undefined) throw "DATE_DIFFERENCE_ROUNDING_INVARIANT";
  const rounded = toNumber(result);
  if (week) {
    checkDateDay(first + sign * rounded, realm);
    return dateDuration([0, 0, rounded / 7, 0], realm);
  }
  let years = d.years,
    months = d.months,
    weeks = d.weeks,
    days = sign * rounded;
  // Uniform day rounding produces a duration, not a new date object. Its
  // endpoint can exceed the date range; only calendar boundary probes add dates.
  const anchor = calendarDateAdd(
    calendar,
    one,
    years,
    months,
    weeks,
    0,
    "constrain",
  );
  if (anchor === undefined) throw createRuntimeError(realm, "range");
  const anchorDay = epochDayFromGregorian(
    anchor.year,
    anchor.month,
    anchor.day,
  );
  if (anchorDay === undefined) throw "DATE_DIFFERENCE_NUDGE_INVARIANT";
  const nudgedDay = anchorDay + days;
  if (Math.abs(days) > Math.abs(d.days)) {
    const direction = last > first ? 1 : -1;
    const balanced = bubbleCalendarDifference(
      one,
      { years, months, weeks, days },
      direction,
      nudgedDay,
      largest,
      realm,
      calendar,
    );
    years = balanced.years;
    months = balanced.months;
    weeks = balanced.weeks;
    days = balanced.days;
  }
  return dateDuration(
    [sign * years, sign * months, sign * weeks, sign * days],
    realm,
  );
}
/** YearMonth differences compare complete reference dates before deriving first
 * days. The unrounded month result needs no out-of-range rounding candidates. */
export function plainYearMonthDifference(
  one: GregorianDate,
  two: GregorianDate,
  settings: TemporalDifferenceSettings,
  since: boolean,
  realm: ErrorRealm,
  calendar: string = "iso8601",
): Duration {
  if (one.year === two.year && one.month === two.month && one.day === two.day)
    return dateDuration([], realm);
  const a = calendarFieldsFromISO(calendar, one),
    b = calendarFieldsFromISO(calendar, two);
  const first =
      a === undefined
        ? undefined
        : calendarDateAt(calendar, a.year, a.month, 1),
    last =
      b === undefined
        ? undefined
        : calendarDateAt(calendar, b.year, b.month, 1);
  if (first === undefined || last === undefined)
    throw createRuntimeError(realm, "range");
  for (const date of [first, last]) {
    if (date === undefined) throw "YEAR_MONTH_DIFFERENCE_DATE_INVARIANT";
    const day = epochDayFromGregorian(date.year, date.month, date.day);
    if (day === undefined) throw createRuntimeError(realm, "range");
    checkDateDay(day, realm);
  }
  if (settings.smallestUnit === "month" && settings.increment === 1) {
    const largest = settings.largestUnit;
    if (largest !== "year" && largest !== "month")
      throw createRuntimeError(realm, "range");
    const difference = calendarDateUntil(calendar, first, last, largest);
    if (difference === undefined) throw createRuntimeError(realm, "range");
    const sign = since ? -1 : 1;
    return dateDuration(
      [sign * difference.years, sign * difference.months],
      realm,
    );
  }
  return plainDateDifference(first, last, settings, since, realm, calendar);
}
export function installDateDifferenceMethods(
  prototype: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  extract: (receiver: unknown) => GregorianDate,
  kind: "date" | "year-month",
): void {
  for (const name of ["until", "since"]) {
    if (name === undefined) throw "PLAIN_DATE_DIFFERENCE_METHOD_INVARIANT";
    builtinProperty(
      prototype,
      name,
      builtinFunction(
        realm.functionPrototype,
        name,
        1,
        (receiver, args): unknown => {
          const own = extract(receiver),
            other =
              kind === "year-month"
                ? partialDateFrom(args[0], undefined, true, realm, hooks)
                : plainDateFrom(args[0], undefined, realm, hooks);
          if (temporalCalendarSlot(receiver, realm) !== other.calendar)
            throw createRuntimeError(realm, "range");
          const settings = readTemporalDifferenceSettings(
            args[1],
            kind === "year-month" ? "year" : "day",
            kind,
            realm,
            hooks,
          );
          const duration =
            kind === "year-month"
              ? plainYearMonthDifference(
                  own,
                  other.date,
                  settings,
                  name === "since",
                  realm,
                  other.calendar,
                )
              : plainDateDifference(
                  own,
                  other.date,
                  settings,
                  name === "since",
                  realm,
                  other.calendar,
                );
          const object = createObject<ScriptPropertyKey, unknown>(
            realm.temporalDurationPrototype,
          );
          object.internalTemporalDuration = duration;
          return object;
        },
        hooks,
      ),
      true,
      true,
      hooks,
    );
  }
}
