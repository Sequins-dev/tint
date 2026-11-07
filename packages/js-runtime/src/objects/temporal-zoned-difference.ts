import { roundZonedClockDifference } from "./temporal-zoned-clock-rounding.ts";
import {
  roundZonedCalendarUnit,
  unroundedZonedCalendarDifference,
} from "./temporal-zoned-calendar-difference.ts";
import { zonedDateTimeArithmetic } from "./temporal-zoned-arithmetic.ts";
import { plainDateTimeDifference } from "./temporal-date-time-difference.ts";
import { temporalZonedData } from "./temporal-zoned-construction.ts";
import { temporalTimeZonesEqual } from "./temporal-time-zone.ts";
import { subtract } from "@tint/foundation/numeric/big-integer";
import {
  createDuration,
  durationFields,
  type Duration,
} from "@tint/foundation/chrono/temporal-duration";
import {
  createObject,
  type OrdinaryObject,
  type ObjectHooks,
} from "./operations.ts";
import { builtinFunction, builtinProperty } from "./intrinsics.ts";
import {
  readTemporalDifferenceSettings,
  balanceTemporalTimeDifference,
  type TemporalDifferenceSettings,
} from "./temporal-time-difference.ts";
import { temporalTimeUnitNanoseconds } from "./temporal-rounding.ts";
import {
  zonedDateTimeFrom,
  type TemporalZonedPosition,
} from "./temporal-zoned-conversion.ts";
import { compareBigIntValues } from "./bigints.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";
import type { TemporalZonedDateTime } from "./temporal-zoned-date-time.ts";
import type { ScriptPropertyKey } from "./symbols.ts";
/** Fixed-offset civil arithmetic shares the plain calendar implementation. Named
 * calendar spans retain their separate, variable-day contract. */
export function zonedDateTimeDifference(
  own: TemporalZonedDateTime,
  other: TemporalZonedPosition,
  settings: TemporalDifferenceSettings,
  since: boolean,
  realm: ErrorRealm,
): Duration {
  if (temporalTimeUnitNanoseconds(settings.largestUnit) !== undefined) {
    const delta = since
      ? subtract(own.epoch.integer, other.epoch.integer)
      : subtract(other.epoch.integer, own.epoch.integer);
    return balanceTemporalTimeDifference(delta, settings, realm);
  }
  if (!temporalTimeZonesEqual(own.zone, other.zone, realm))
    throw createRuntimeError(realm, "range");
  if (compareBigIntValues(own.epoch, other.epoch) === 0) {
    const zero = createDuration([]);
    if (zero === undefined) throw "ZONED_ZERO_DURATION_INVARIANT";
    return zero;
  }
  if (
    own.zone.kind === "named" &&
    temporalTimeUnitNanoseconds(settings.smallestUnit) === undefined
  )
    return roundZonedCalendarUnit(
      own,
      other.epoch,
      settings.smallestUnit,
      settings.increment,
      settings.mode,
      since,
      realm,
      settings.largestUnit,
    );
  if (
    own.zone.kind === "named" &&
    settings.smallestUnit === "nanosecond" &&
    settings.increment === 1
  ) {
    const raw = unroundedZonedCalendarDifference(
      own,
      other.epoch,
      settings.largestUnit,
      realm,
    );
    if (!since) return raw;
    const fields = durationFields(raw);
    for (let index = 0; index < fields.length; index++)
      fields[index] = -(fields[index] ?? 0);
    const result = createDuration(fields);
    if (result === undefined) throw "ZONED_CALENDAR_NEGATION_INVARIANT";
    return result;
  }
  if (
    own.zone.kind === "named" &&
    temporalTimeUnitNanoseconds(settings.smallestUnit) !== undefined
  )
    return roundZonedClockDifference(own, other.epoch, settings, since, realm);
  if (own.zone.kind === "fixed" && other.zone.kind === "fixed") {
    const target = temporalZonedData(other.epoch, other.zone, realm).dateTime;
    const direction = compareBigIntValues(other.epoch, own.epoch);
    if (settings.smallestUnit === "day" && direction !== 0) {
      const raw = plainDateTimeDifference(
        own.dateTime,
        target,
        {
          largestUnit: settings.largestUnit,
          smallestUnit: "nanosecond",
          increment: 1,
          mode: "trunc",
        },
        false,
        realm,
      );
      const start =
        Math.trunc(raw.days / settings.increment) * settings.increment;
      // Plain civil coordinates have wider bounds. A zoned nudge must validate
      // both exact endpoints, including an endpoint the rounding mode won't select.
      for (const days of [start, start + direction * settings.increment]) {
        if (days === undefined) throw "ZONED_NUDGE_DAY_INVARIANT";
        const boundary = createDuration([
          raw.years,
          raw.months,
          raw.weeks,
          days,
        ]);
        if (boundary === undefined) throw createRuntimeError(realm, "range");
        zonedDateTimeArithmetic(own, boundary, false, "constrain", realm);
      }
    }
    return plainDateTimeDifference(
      own.dateTime,
      target,
      settings,
      since,
      realm,
      true,
    );
  }
  return rejectUnsupportedExecution(realm);
}

/** Read observable arguments before applying the shared difference policy. */
export function installZonedDifferenceMethods(
  prototype: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  extract: (receiver: unknown) => TemporalZonedDateTime,
): void {
  for (const name of ["until", "since"]) {
    if (name === undefined) throw "ZONED_DIFFERENCE_METHOD_INVARIANT";
    builtinProperty(
      prototype,
      name,
      builtinFunction(
        realm.functionPrototype,
        name,
        1,
        (receiver, args): unknown => {
          const own = extract(receiver),
            other = zonedDateTimeFrom(args[0], undefined, realm, hooks);
          if ((own.dateTime.calendar ?? "iso8601") !== other.calendar)
            throw createRuntimeError(realm, "range");
          const settings = readTemporalDifferenceSettings(
            args[1],
            "hour",
            "date-time",
            realm,
            hooks,
          );
          const object = createObject<ScriptPropertyKey, unknown>(
            realm.temporalDurationPrototype,
          );
          object.internalTemporalDuration = zonedDateTimeDifference(
            own,
            other,
            settings,
            name === "since",
            realm,
          );
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
