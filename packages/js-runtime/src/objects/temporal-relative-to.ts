import { parseISODateTime } from "@tint/foundation/chrono/iso-date-time";
import type { GregorianDate } from "@tint/foundation/chrono/gregorian-calendar";
import {
  requireCalendarAlgorithms,
  temporalCalendarSlot,
  objectTemporalCalendarIdentifier,
} from "./temporal-coercion.ts";
import {
  readTemporalDateFields,
  regulateCalendarDateFields,
} from "./temporal-date-fields.ts";
import { regulateTemporalTime } from "./temporal-time-conversion.ts";
import { combineTemporalDateTime } from "./temporal-date-time-conversion.ts";
import { plainDateFrom } from "./temporal-plain-date-conversion.ts";
import { interpretZonedOffset } from "./temporal-zoned-conversion.ts";
import { temporalTimeZone } from "./temporal-time-zone.ts";
import { temporalZonedData } from "./temporal-zoned-construction.ts";
import type { TemporalZonedDateTime } from "./temporal-zoned-date-time.ts";
import { viewObjectValue } from "./values.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
import type { ObjectHooks } from "./operations.ts";
import { exoticSlots } from "./operations.ts";
export type TemporalRelativeTo =
  | { readonly kind: "none" }
  | {
      readonly kind: "plain";
      readonly date: GregorianDate;
      readonly calendar?: string;
    }
  | { readonly kind: "zoned"; readonly value: TemporalZonedDateTime };
/** Shared Duration relativeTo conversion. Property bags read and coerce the full
 * ordered field list even when the absence of timeZone ultimately selects a date. */
export function readTemporalRelativeTo(
  value: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): TemporalRelativeTo {
  if (value === undefined) return { kind: "none" };
  const object = viewObjectValue(value, realm.objectPrototype);
  if (object !== undefined) {
    const zoned = exoticSlots(object).internalTemporalZonedDateTime;
    if (zoned !== undefined) {
      return { kind: "zoned", value: zoned };
    }
    const date = exoticSlots(object).internalTemporalPlainDate;
    if (date !== undefined)
      return {
        kind: "plain",
        date,
        calendar: temporalCalendarSlot(value, realm),
      };
    const dateTime = exoticSlots(object).internalTemporalPlainDateTime;
    if (dateTime !== undefined)
      return {
        kind: "plain",
        date: dateTime.date,
        calendar: dateTime.calendar ?? "iso8601",
      };
    const calendar = objectTemporalCalendarIdentifier(
      object,
      value,
      realm,
      hooks,
    );
    const fields = readTemporalDateFields(
      object,
      value,
      "relative",
      realm,
      hooks,
      undefined,
      calendar,
    );
    requireCalendarAlgorithms(calendar, realm);
    const civil = regulateCalendarDateFields(
        fields,
        calendar,
        "date",
        "constrain",
        realm,
      ),
      time = regulateTemporalTime(fields.time, "constrain", realm),
      zone = fields.timeZone;
    if (zone === undefined) return { kind: "plain", date: civil, calendar };
    const data = combineTemporalDateTime(civil, time, realm, calendar);
    const input = interpretZonedOffset(
      data,
      zone,
      fields.offsetNanoseconds,
      "reject",
      realm,
    );
    return {
      kind: "zoned",
      value: temporalZonedData(input.epoch, input.zone, realm, calendar),
    };
  }
  if (typeof value !== "string") throw createRuntimeError(realm, "type");
  const parsed = parseISODateTime(value),
    data = parsed.value;
  if (parsed.error !== "none" || data === undefined)
    throw createRuntimeError(realm, "range");
  const calendar = requireCalendarAlgorithms(data.calendar, realm);
  if (data.timeZone === undefined)
    return {
      kind: "plain",
      date: plainDateFrom(value, undefined, realm, hooks).date,
      calendar,
    };
  const zone = temporalTimeZone(data.timeZone, realm);
  const input = interpretZonedOffset(
    data,
    zone,
    data.offsetNanoseconds,
    "reject",
    realm,
    "compatible",
    !parsed.offsetHasSeconds,
  );
  return {
    kind: "zoned",
    value: temporalZonedData(input.epoch, input.zone, realm, calendar),
  };
}
