import type { TemporalZonedDateTime } from "./temporal-zoned-date-time.ts";
import { createObject, type OrdinaryObject } from "./operations.ts";
import { temporalEpochDateTime } from "./temporal-epoch.ts";
import type { BigIntValue } from "./bigints.ts";
import {
  temporalTimeZoneOffsetNanoseconds,
  temporalTimeZoneOffsetText,
  type TemporalTimeZone,
} from "./temporal-time-zone.ts";
import { rejectUnsupportedExecution, type ErrorRealm } from "./errors.ts";
import type { ScriptPropertyKey } from "./symbols.ts";
/** Build a calendar-bearing object from an already validated epoch and zone. */
export function createTemporalZonedObject(
  epoch: BigIntValue,
  zone: TemporalTimeZone,
  parent: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  calendar: string = "iso8601",
): OrdinaryObject<ScriptPropertyKey, unknown> {
  const object = createObject<ScriptPropertyKey, unknown>(parent);
  object.internalTemporalZonedDateTime = temporalZonedData(
    epoch,
    zone,
    realm,
    calendar,
  );
  object.internalTemporalCalendar = calendar;
  return object;
}

/** Resolve slots independently of allocating a language-level wrapper. */
export function temporalZonedData(
  epoch: BigIntValue,
  zone: TemporalTimeZone,
  realm: ErrorRealm,
  calendar: string = "iso8601",
): TemporalZonedDateTime {
  const offset = temporalTimeZoneOffsetNanoseconds(zone, epoch.integer);
  if (offset === undefined) return rejectUnsupportedExecution(realm);
  const dateTime = temporalEpochDateTime(epoch.integer, offset, calendar);
  if (dateTime === undefined) throw "TEMPORAL_ZONED_RANGE_INVARIANT";
  return {
    epoch,
    zone,
    dateTime,
    timeZone: zone.identifier,
    offset: temporalTimeZoneOffsetText(offset),
    offsetNanoseconds: offset,
  };
}
