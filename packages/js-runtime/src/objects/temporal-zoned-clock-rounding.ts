import { calendarDateAdd } from "./calendar.ts";
import { bubbleZonedCalendarDuration } from "./temporal-zoned-calendar-bubble.ts";
import {
  add,
  subtract,
  compare,
  negate,
  fromNumber,
  type Integer,
} from "@tint/foundation/numeric/big-integer";
import { roundInteger } from "@tint/foundation/numeric/integer-rounding";
import {
  createDuration,
  durationFields,
  durationTimeNanoseconds,
  balanceTimeDuration,
  type Duration,
} from "@tint/foundation/chrono/temporal-duration";
import { bigIntInteger, type BigIntValue } from "./bigints.ts";
import type { TemporalZonedDateTime } from "./temporal-zoned-date-time.ts";
import type { TemporalDifferenceSettings } from "./temporal-time-difference.ts";
import { unroundedZonedCalendarDifference } from "./temporal-zoned-calendar-difference.ts";
import { temporalTimeUnitNanoseconds } from "./temporal-rounding.ts";
import { combineTemporalDateTime } from "./temporal-date-time-conversion.ts";
import { interpretZonedOffset } from "./temporal-zoned-conversion.ts";
import { validTemporalEpoch } from "./temporal-epoch.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
/** NudgeToZonedTime separates calendar days, rounds the exact clock, then rounds
 * again if crossing the adjacent variable-length day leaves a new remainder. */
export function roundZonedClockDifference(
  own: TemporalZonedDateTime,
  end: BigIntValue,
  settings: TemporalDifferenceSettings,
  since: boolean,
  realm: ErrorRealm,
): Duration {
  const raw = unroundedZonedCalendarDifference(
    own,
    end,
    settings.largestUnit,
    realm,
  );
  const sign = raw.sign < 0 ? -1 : 1;
  const factor = temporalTimeUnitNanoseconds(settings.smallestUnit);
  if (factor === undefined) throw createRuntimeError(realm, "range");
  const quantum = fromNumber(factor * settings.increment),
    zero = fromNumber(0);
  if (quantum === undefined || zero === undefined)
    throw "ZONED_CLOCK_QUANTUM_INVARIANT";
  const roundingQuantum = quantum;
  function rounded(value: Integer): Integer {
    const result = roundInteger(
      since ? negate(value) : value,
      roundingQuantum,
      settings.mode,
    );
    if (result === undefined) throw "ZONED_CLOCK_ROUND_INVARIANT";
    return since ? negate(result) : result;
  }
  const startDate = calendarDateAdd(
    own.dateTime.calendar ?? "iso8601",
    own.dateTime.date,
    raw.years,
    raw.months,
    raw.weeks,
    raw.days,
    "constrain",
  );
  if (startDate === undefined) throw createRuntimeError(realm, "range");
  const endDate = calendarDateAdd(
    own.dateTime.calendar ?? "iso8601",
    startDate,
    0,
    0,
    0,
    sign,
    "constrain",
  );
  if (endDate === undefined) throw createRuntimeError(realm, "range");
  const start = interpretZonedOffset(
    combineTemporalDateTime(startDate, own.dateTime, realm),
    own.zone,
    undefined,
    "ignore",
    realm,
  );
  const finish = interpretZonedOffset(
    combineTemporalDateTime(endDate, own.dateTime, realm),
    own.zone,
    undefined,
    "ignore",
    realm,
  );
  const startInt = bigIntInteger(start.epoch),
    finishInt = bigIntInteger(finish.epoch);
  const span = subtract(finishInt, startInt);
  if (compare(span, zero) !== sign) throw "ZONED_CLOCK_DAY_SPAN_INVARIANT";
  let clock = rounded(durationTimeNanoseconds(raw));
  const beyond = subtract(clock, span),
    expanded = compare(beyond, zero) !== -sign;
  if (expanded) clock = rounded(beyond);
  const nudged = add(expanded ? finishInt : startInt, clock);
  if (!validTemporalEpoch(nudged)) throw createRuntimeError(realm, "range");
  const time = balanceTimeDuration(clock, 0);
  if (time === undefined) throw createRuntimeError(realm, "range");
  let data = createDuration([
    raw.years,
    raw.months,
    raw.weeks,
    raw.days + (expanded ? sign : 0),
    time.hours,
    time.minutes,
    time.seconds,
    time.milliseconds,
    time.microseconds,
    time.nanoseconds,
  ]);
  if (data === undefined) throw createRuntimeError(realm, "range");
  if (expanded)
    data = bubbleZonedCalendarDuration(
      own,
      data,
      nudged,
      settings.largestUnit,
      "day",
      sign,
      realm,
    );
  if (!since) return data;
  const fields = durationFields(data);
  for (let index = 0; index < fields.length; index++)
    fields[index] = -(fields[index] ?? 0);
  const result = createDuration(fields);
  if (result === undefined) throw "ZONED_CLOCK_NEGATION_INVARIANT";
  return result;
}
