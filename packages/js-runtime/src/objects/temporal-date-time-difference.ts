import {
  add,
  subtract,
  multiply,
  fromNumber,
  toNumber,
  negate,
  compare,
  divide,
} from "@tint/foundation/numeric/big-integer";
import {
  differenceGregorianDates,
  addGregorianDate,
  epochDayFromGregorian,
  gregorianFromEpochDay,
  type GregorianDateDifference,
} from "@tint/foundation/chrono/gregorian-calendar";
import {
  createDuration,
  balanceTimeDuration,
  type Duration,
} from "@tint/foundation/chrono/temporal-duration";
import { roundInteger } from "@tint/foundation/numeric/integer-rounding";
import type { ISODateTime } from "@tint/foundation/chrono/iso-date-time";
import { clockNanoseconds } from "./temporal-time-arithmetic.ts";
import { plainDateTimeFrom } from "./temporal-date-time-conversion.ts";
import {
  plainDateDifference,
  bubbleCalendarDifference,
  roundCalendarDifference,
} from "./temporal-date-difference.ts";
import {
  balanceTemporalTimeDifference,
  readTemporalDifferenceSettings,
  type TemporalDifferenceSettings,
} from "./temporal-time-difference.ts";
import { temporalTimeUnitNanoseconds } from "./temporal-rounding.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";
import { builtinFunction, builtinProperty } from "./intrinsics.ts";
import {
  createObject,
  type OrdinaryObject,
  type ObjectHooks,
} from "./operations.ts";
import type { ScriptPropertyKey } from "./symbols.ts";
/** Plain date-times use civil coordinates, which extend beyond Instant's bounds. */
export function plainDateTimeDifference(
  one: ISODateTime,
  two: ISODateTime,
  settings: TemporalDifferenceSettings,
  since: boolean,
  realm: ErrorRealm,
  separateDayClock: boolean = false,
): Duration {
  const first = epochDayFromGregorian(
      one.date.year,
      one.date.month,
      one.date.day,
    ),
    last = epochDayFromGregorian(two.date.year, two.date.month, two.date.day);
  const day = fromNumber(86400000000000);
  if (first === undefined || last === undefined || day === undefined)
    throw "DATE_TIME_DIFFERENCE_DATE_INVARIANT";
  const dayCount = fromNumber(last - first);
  if (dayCount === undefined) throw "DATE_TIME_DIFFERENCE_DAYS_INVARIANT";
  const clock = subtract(clockNanoseconds(two), clockNanoseconds(one)),
    delta = add(multiply(dayCount, day), clock);
  const signed = since ? negate(delta) : delta;
  if (temporalTimeUnitNanoseconds(settings.largestUnit) !== undefined)
    return balanceTemporalTimeDifference(signed, settings, realm);
  if (settings.largestUnit === "day") {
    const factor =
      settings.smallestUnit === "day"
        ? 86400000000000
        : temporalTimeUnitNanoseconds(settings.smallestUnit);
    if (factor === undefined) return rejectUnsupportedExecution(realm);
    const unit = fromNumber(factor),
      increment = fromNumber(settings.increment);
    if (unit === undefined || increment === undefined)
      throw "DATE_TIME_DIFFERENCE_QUANTUM_INVARIANT";
    // Zoned differences retain whole calendar days before rounding their clock
    // remainder, even in UTC. Plain differences round a uniform elapsed span.
    const wholeDays =
      separateDayClock && settings.smallestUnit !== "day"
        ? divide(signed, day)
        : undefined;
    const rounded = roundInteger(
      wholeDays === undefined ? signed : wholeDays.remainder,
      multiply(unit, increment),
      settings.mode,
    );
    if (rounded === undefined) throw "DATE_TIME_DIFFERENCE_ROUND_INVARIANT";
    const balanced =
      wholeDays === undefined
        ? rounded
        : add(multiply(wholeDays.quotient, day), rounded);
    const split = divide(balanced, day);
    if (split === undefined) throw "DATE_TIME_DIFFERENCE_SPLIT_INVARIANT";
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
  const zero = fromNumber(0);
  if (zero === undefined) throw "DATE_TIME_DIFFERENCE_ZERO_INVARIANT";
  const direction = compare(delta, zero),
    clockDirection = compare(clock, zero);
  if (
    clockDirection === 0 &&
    temporalTimeUnitNanoseconds(settings.smallestUnit) === undefined
  )
    return plainDateDifference(one.date, two.date, settings, since, realm);
  const largest = settings.largestUnit;
  if (largest !== "year" && largest !== "month" && largest !== "week")
    throw createRuntimeError(realm, "range");
  const borrowed = clockDirection !== 0 && clockDirection !== direction;
  const adjusted = gregorianFromEpochDay(last - (borrowed ? direction : 0));
  if (adjusted === undefined) throw createRuntimeError(realm, "range");
  const d = differenceGregorianDates(one.date, adjusted, largest);
  if (d === undefined) throw createRuntimeError(realm, "range");
  const carry = fromNumber(borrowed ? direction * 86400000000000 : 0);
  if (carry === undefined) throw "DATE_TIME_DIFFERENCE_CARRY_INVARIANT";
  const timeDelta = add(clock, carry);
  if (["year", "month", "week"].includes(settings.smallestUnit))
    return roundCalendarDifference(
      one.date,
      first,
      last - (borrowed ? direction : 0),
      d,
      settings,
      since,
      realm,
      timeDelta,
    );
  const factor =
    settings.smallestUnit === "day"
      ? 86400000000000
      : temporalTimeUnitNanoseconds(settings.smallestUnit);
  if (factor === undefined) return rejectUnsupportedExecution(realm);
  const factorValue = fromNumber(factor),
    increment = fromNumber(settings.increment),
    daysValue = fromNumber(d.days);
  if (
    factorValue === undefined ||
    increment === undefined ||
    daysValue === undefined
  )
    throw "DATE_TIME_CALENDAR_ROUND_INVARIANT";
  const residual = add(multiply(daysValue, day), timeDelta),
    sign = since ? -1 : 1;
  const separateTime = separateDayClock && settings.smallestUnit !== "day";
  const roundable = separateTime ? timeDelta : residual;
  const rounded = roundInteger(
    since ? negate(roundable) : roundable,
    multiply(factorValue, increment),
    settings.mode,
  );
  if (rounded === undefined) throw "DATE_TIME_CALENDAR_ROUND_RESULT_INVARIANT";
  const balanced = separateTime
    ? add(multiply(since ? negate(daysValue) : daysValue, day), rounded)
    : rounded;
  const split = divide(balanced, day);
  if (split === undefined) throw "DATE_TIME_CALENDAR_ROUND_SPLIT_INVARIANT";
  let dateFields: GregorianDateDifference = {
    years: d.years,
    months: d.months,
    weeks: d.weeks,
    days: sign * toNumber(split.quotient),
  };
  if (Math.abs(dateFields.days) > Math.abs(d.days)) {
    const anchor = addGregorianDate(
      one.date,
      d.years,
      d.months,
      d.weeks,
      0,
      "constrain",
    );
    if (anchor === undefined) throw createRuntimeError(realm, "range");
    const anchorDay = epochDayFromGregorian(
      anchor.year,
      anchor.month,
      anchor.day,
    );
    if (anchorDay === undefined) throw "DATE_TIME_CALENDAR_ANCHOR_INVARIANT";
    dateFields = bubbleCalendarDifference(
      one.date,
      dateFields,
      direction,
      anchorDay + dateFields.days,
      largest,
      realm,
    );
  }
  const time = balanceTimeDuration(split.remainder, 0);
  if (time === undefined) throw createRuntimeError(realm, "range");
  const result = createDuration([
    sign * dateFields.years,
    sign * dateFields.months,
    sign * dateFields.weeks,
    sign * dateFields.days,
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
export function installDateTimeDifferenceMethods(
  prototype: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  extract: (receiver: unknown) => ISODateTime,
): void {
  for (const name of ["until", "since"]) {
    if (name === undefined) throw "DATE_TIME_DIFFERENCE_METHOD_INVARIANT";
    builtinProperty(
      prototype,
      name,
      builtinFunction(
        realm.functionPrototype,
        name,
        1,
        (receiver, args): unknown => {
          const own = extract(receiver),
            other = plainDateTimeFrom(args[0], undefined, realm, hooks);
          const settings = readTemporalDifferenceSettings(
            args[1],
            "day",
            "date-time",
            realm,
            hooks,
          );
          const duration = plainDateTimeDifference(
            own,
            other,
            settings,
            name === "since",
            realm,
          );
          const result = createObject<ScriptPropertyKey, unknown>(
            realm.temporalDurationPrototype,
          );
          result.internalTemporalDuration = duration;
          return result;
        },
        hooks,
      ),
      true,
      true,
      hooks,
    );
  }
}
