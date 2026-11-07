import { calendarDateAdd } from "./calendar.ts";
import { roundIntegerAsIfPositive } from "@tint/foundation/numeric/integer-rounding";
import { temporalZonedDayBounds } from "./temporal-zone-local.ts";
import {
  add,
  subtract as subtractInteger,
  negate,
  compareNumber,
  compare,
} from "@tint/foundation/numeric/big-integer";
import {
  durationTimeNanoseconds,
  type Duration,
} from "@tint/foundation/chrono/temporal-duration";
import { combineTemporalDateTime } from "./temporal-date-time-conversion.ts";
import { validTemporalEpoch } from "./temporal-epoch.ts";
import { createBigIntValue, type BigIntValue } from "./bigints.ts";
import { roundTemporalDateTime } from "./temporal-date-time-rounding.ts";
import { interpretZonedOffset } from "./temporal-zoned-conversion.ts";
import type { TemporalRounding } from "./temporal-rounding.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
import type { TemporalZonedDateTime } from "./temporal-zoned-date-time.ts";
/** Add calendar units in local time with compatible disambiguation, then exact clock units. */
export function zonedDateTimeArithmetic(
  data: TemporalZonedDateTime,
  duration: Duration,
  subtract: boolean,
  policy: string,
  realm: ErrorRealm,
): BigIntValue {
  let intermediate = data.epoch.integer;
  if (
    duration.years !== 0 ||
    duration.months !== 0 ||
    duration.weeks !== 0 ||
    duration.days !== 0
  ) {
    const sign = subtract ? -1 : 1;
    const date = calendarDateAdd(
      data.dateTime.calendar ?? "iso8601",
      data.dateTime.date,
      sign * duration.years,
      sign * duration.months,
      sign * duration.weeks,
      sign * duration.days,
      policy === "reject" ? "reject" : "constrain",
    );
    if (date === undefined) throw createRuntimeError(realm, "range");
    const local = combineTemporalDateTime(date, data.dateTime, realm);
    intermediate = interpretZonedOffset(
      local,
      data.zone,
      undefined,
      "ignore",
      realm,
    ).epoch.integer;
  }
  const delta = durationTimeNanoseconds(duration);
  const result = add(intermediate, subtract ? negate(delta) : delta);
  if (!validTemporalEpoch(result)) throw createRuntimeError(realm, "range");
  return createBigIntValue(result);
}

/** Day rounding uses exact elapsed time between local day boundaries. Other
 * units round the wall clock, preferring the original offset in overlaps. */
export function roundTemporalZonedDateTime(
  data: TemporalZonedDateTime,
  settings: TemporalRounding,
  realm: ErrorRealm,
): BigIntValue {
  if (compareNumber(settings.increment, 1) === 0) return data.epoch;
  if (compareNumber(settings.increment, 86400000000000) === 0) {
    const bounds = temporalZonedDayBounds(data.dateTime.date, data.zone, realm);
    const length = subtractInteger(bounds.end, bounds.start);
    const order = compareNumber(length, 0);
    if (order === undefined || order <= 0) throw "ZONED_DAY_LENGTH_INVARIANT";
    const elapsed = subtractInteger(data.epoch.integer, bounds.start);
    // A backward transition can revisit this date after the next date first
    // began. Rounding still selects its two calendar boundaries, never a later
    // multiple of the first interval's length.
    if (compare(elapsed, length) >= 0)
      return createBigIntValue(
        settings.mode === "floor" || settings.mode === "trunc"
          ? bounds.start
          : bounds.end,
      );
    const rounded = roundIntegerAsIfPositive(elapsed, length, settings.mode);
    if (rounded === undefined) throw "ZONED_DAY_ROUND_INVARIANT";
    return createBigIntValue(add(bounds.start, rounded));
  }
  const rounded = roundTemporalDateTime(data.dateTime, settings, realm);
  return interpretZonedOffset(
    rounded,
    data.zone,
    data.offsetNanoseconds,
    "prefer",
    realm,
  ).epoch;
}
