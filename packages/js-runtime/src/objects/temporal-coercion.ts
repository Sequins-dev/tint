import { canonicalCalendarIdentifier } from "./calendar.ts";
import { viewObjectValue } from "./values.ts";
import {
  parseISODateTime,
  parseISOTimeString,
  parseISOYearMonthString,
  parseISOMonthDayString,
} from "@tint/foundation/chrono/iso-date-time";
import { numberValue } from "./coercion.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";
import {
  getProperty,
  type OrdinaryObject,
  type ObjectHooks,
} from "./operations.ts";
import type { ScriptPropertyKey } from "./symbols.ts";
export function temporalInteger(
  value: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): number {
  const converted = numberValue(value, hooks, realm);
  if (converted.error === "unsupported")
    return rejectUnsupportedExecution(realm);
  if (converted.error !== "none") throw createRuntimeError(realm, "type");
  if (!Number.isFinite(converted.value))
    throw createRuntimeError(realm, "range");
  const result = Math.trunc(converted.value);
  return result === 0 ? 0 : result;
}
/** Validate/canonicalize an identifier without claiming its calendar algorithms exist. */
export function canonicalTemporalCalendar(
  suppliedCalendar: unknown,
  realm: ErrorRealm,
): string {
  if (suppliedCalendar === undefined) return "iso8601";
  if (typeof suppliedCalendar !== "string")
    throw createRuntimeError(realm, "type");
  const calendar = canonicalCalendarIdentifier(suppliedCalendar);
  if (calendar !== undefined) return calendar;
  throw createRuntimeError(realm, "range");
}
export function requireISOCalendar(
  suppliedCalendar: unknown,
  realm: ErrorRealm,
): void {
  if (canonicalTemporalCalendar(suppliedCalendar, realm) !== "iso8601")
    return rejectUnsupportedExecution(realm);
}

/** Property-bag calendars also accept ISO date/time, year-month and month-day strings. */
export function temporalCalendarIdentifier(
  value: unknown,
  realm: ErrorRealm,
): string {
  const object = viewObjectValue(value, realm.objectPrototype);
  if (object !== undefined) {
    const identifier = object.internalTemporalCalendar;
    if (identifier !== undefined) {
      return canonicalTemporalCalendar(identifier, realm);
    }
  }

  if (value === undefined || typeof value !== "string") {
    return canonicalTemporalCalendar(value, realm);
  }
  const data =
    parseISODateTime(value).value ??
    parseISOTimeString(value).value ??
    parseISOYearMonthString(value).value ??
    parseISOMonthDayString(value).value;
  return canonicalTemporalCalendar(
    data === undefined ? value : data.calendar,
    realm,
  );
}

export function requireTemporalCalendar(
  value: unknown,
  realm: ErrorRealm,
): void {
  requireISOCalendar(temporalCalendarIdentifier(value, realm), realm);
}

/** Calendar-bearing Temporal objects bypass public calendar getters. */
export function objectTemporalCalendarIdentifier(
  object: OrdinaryObject<ScriptPropertyKey, unknown>,
  item: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): string {
  const calendar = object.internalTemporalCalendar;
  if (calendar !== undefined) {
    return canonicalTemporalCalendar(calendar, realm);
  }
  return temporalCalendarIdentifier(
    getProperty<ScriptPropertyKey, unknown>(object, "calendar", item, hooks),
    realm,
  );
}
