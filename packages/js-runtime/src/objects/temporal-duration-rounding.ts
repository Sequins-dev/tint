import { roundZonedClockDifference } from "./temporal-zoned-clock-rounding.ts";
import {
  add,
  multiply,
  divide,
  fromNumber,
  toNumber,
  type Integer,
} from "@tint/foundation/numeric/big-integer";
import {
  roundInteger,
  type RoundingMode,
} from "@tint/foundation/numeric/integer-rounding";
import { addGregorianDate } from "@tint/foundation/chrono/gregorian-calendar";
import {
  durationTimeNanoseconds,
  durationLargestUnit,
  createDuration,
  balanceTimeDuration,
  type Duration,
} from "@tint/foundation/chrono/temporal-duration";
import {
  readTemporalRelativeTo,
  type TemporalRelativeTo,
} from "./temporal-relative-to.ts";
import {
  normalizeTemporalDifferenceSettings,
  temporalDifferenceUnit,
  temporalDifferenceUnitNames,
  type TemporalDifferenceSettings,
} from "./temporal-time-difference.ts";
import {
  temporalRoundingIncrement,
  temporalRoundingMode,
  temporalTimeUnitNanoseconds,
} from "./temporal-rounding.ts";
import { optionValue } from "./options.ts";
import type { ObjectHooks } from "./operations.ts";
import { splitClockNanoseconds } from "./temporal-time-arithmetic.ts";
import { combineTemporalDateTime } from "./temporal-date-time-conversion.ts";
import { plainDateTimeDifference } from "./temporal-date-time-difference.ts";
import { temporalZonedData } from "./temporal-zoned-construction.ts";
import { zonedDateTimeArithmetic } from "./temporal-zoned-arithmetic.ts";
import { zonedDateTimeDifference } from "./temporal-zoned-difference.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
function integer(value: number): Integer {
  const result = fromNumber(value);
  if (result === undefined) throw "DURATION_ROUND_INTEGER_INVARIANT";
  return result;
}
/** Resolve calendar endpoints before rounding; context-free clock totals retain
 * exact integer arithmetic until the final independently rounded Number fields. */
export function roundDuration(
  data: Duration,
  settings: TemporalDifferenceSettings,
  relative: TemporalRelativeTo,
  realm: ErrorRealm,
): Duration {
  if (relative.kind === "zoned") {
    const end = zonedDateTimeArithmetic(
      relative.value,
      data,
      false,
      "constrain",
      realm,
    );
    if (
      relative.value.zone.kind === "named" &&
      temporalTimeUnitNanoseconds(settings.largestUnit) === undefined &&
      temporalTimeUnitNanoseconds(settings.smallestUnit) !== undefined &&
      (settings.smallestUnit !== "nanosecond" || settings.increment !== 1)
    )
      return roundZonedClockDifference(
        relative.value,
        end,
        settings,
        false,
        realm,
      );
    if (
      relative.value.zone.kind === "fixed" &&
      temporalTimeUnitNanoseconds(settings.largestUnit) === undefined &&
      temporalTimeUnitNanoseconds(settings.smallestUnit) !== undefined &&
      (settings.smallestUnit !== "nanosecond" || settings.increment !== 1)
    ) {
      const raw = plainDateTimeDifference(
        relative.value.dateTime,
        temporalZonedData(end, relative.value.zone, realm).dateTime,
        {
          largestUnit: settings.largestUnit,
          smallestUnit: "nanosecond",
          increment: 1,
          mode: "trunc",
        },
        false,
        realm,
      );
      const boundary = createDuration([
        raw.years,
        raw.months,
        raw.weeks,
        raw.days + (data.sign < 0 ? -1 : 1),
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
    return zonedDateTimeDifference(
      relative.value,
      { epoch: end, zone: relative.value.zone },
      settings,
      false,
      realm,
    );
  }
  const day = integer(86400000000000);
  const total = add(
    multiply(integer(data.days), day),
    durationTimeNanoseconds(data),
  );
  if (relative.kind === "plain") {
    if (data.sign === 0) return data;
    const split = splitClockNanoseconds(total);
    const target = addGregorianDate(
      relative.date,
      data.years,
      data.months,
      data.weeks,
      toNumber(split.days),
      "constrain",
    );
    if (target === undefined) throw createRuntimeError(realm, "range");
    const origin = combineTemporalDateTime(
      relative.date,
      { hour: 0, minute: 0, second: 0, nanosecond: 0 },
      realm,
    );
    return plainDateTimeDifference(
      origin,
      combineTemporalDateTime(target, split.time, realm),
      settings,
      false,
      realm,
    );
  }
  if (
    data.years !== 0 ||
    data.months !== 0 ||
    data.weeks !== 0 ||
    ["year", "month", "week"].includes(settings.largestUnit)
  )
    throw createRuntimeError(realm, "range");
  const smallest =
    settings.smallestUnit === "day"
      ? 86400000000000
      : temporalTimeUnitNanoseconds(settings.smallestUnit);
  if (smallest === undefined) throw createRuntimeError(realm, "range");
  const rounded = roundInteger(
    total,
    multiply(integer(smallest), integer(settings.increment)),
    settings.mode,
  );
  if (rounded === undefined) throw "DURATION_ROUND_QUANTUM_INVARIANT";
  if (settings.largestUnit === "day") {
    const split = divide(rounded, day);
    if (split === undefined) throw "DURATION_ROUND_DAY_INVARIANT";
    const clock = balanceTimeDuration(split.remainder, 0);
    if (clock === undefined) throw createRuntimeError(realm, "range");
    const result = createDuration([
      0,
      0,
      0,
      toNumber(split.quotient),
      clock.hours,
      clock.minutes,
      clock.seconds,
      clock.milliseconds,
      clock.microseconds,
      clock.nanoseconds,
    ]);
    if (result === undefined) throw createRuntimeError(realm, "range");
    return result;
  }
  const units = [
    "hour",
    "minute",
    "second",
    "millisecond",
    "microsecond",
    "nanosecond",
  ];
  const result = balanceTimeDuration(
    rounded,
    units.indexOf(settings.largestUnit),
  );
  if (result === undefined) throw createRuntimeError(realm, "range");
  return result;
}

/** Duration uses a different observable option order from date/time differences. */
export function temporalDurationRound(
  data: Duration,
  options: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): Duration {
  if (options === undefined) throw createRuntimeError(realm, "type");
  const shorthand = typeof options === "string";
  const largest = shorthand
    ? ""
    : temporalDifferenceUnit(options, "largestUnit", "", realm, hooks);
  const relative = readTemporalRelativeTo(
    shorthand ? undefined : optionValue(options, "relativeTo", realm, hooks),
    realm,
    hooks,
  );
  const increment = shorthand
    ? 1
    : temporalRoundingIncrement(options, realm, hooks);
  const mode: RoundingMode = shorthand
    ? "halfExpand"
    : temporalRoundingMode(options, "halfExpand", realm, hooks);
  // Validate shorthand through the same unit reader without observable getters.
  let smallest: string;
  if (typeof options === "string") {
    smallest = options;
    if (smallest === "auto" || !temporalDifferenceUnitNames.includes(smallest))
      throw createRuntimeError(realm, "range");
  } else
    smallest = temporalDifferenceUnit(
      options,
      "smallestUnit",
      "",
      realm,
      hooks,
    );
  if (largest === "" && smallest === "")
    throw createRuntimeError(realm, "range");
  const settings = normalizeTemporalDifferenceSettings(
    largest === "" ? "auto" : largest,
    smallest === "" ? "nanosecond" : smallest,
    durationLargestUnit(data),
    "date-time",
    increment,
    mode,
    realm,
  );
  if (
    increment > 1 &&
    settings.largestUnit !== settings.smallestUnit &&
    temporalTimeUnitNanoseconds(settings.smallestUnit) === undefined
  )
    throw createRuntimeError(realm, "range");
  return roundDuration(data, settings, relative, realm);
}
