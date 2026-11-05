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
  let calendar = "";
  for (let i = 0; i < suppliedCalendar.length; i++) {
    const code = suppliedCalendar.charCodeAt(i);
    calendar += String.fromCharCode(
      code >= 65 && code <= 90 ? code + 32 : code,
    );
  }
  if (
    [
      "iso8601",
      "gregory",
      "buddhist",
      "chinese",
      "coptic",
      "dangi",
      "ethioaa",
      "ethiopic",
      "hebrew",
      "indian",
      "islamic",
      "islamic-rgsa",
      "islamic-civil",
      "islamic-tbla",
      "islamic-umalqura",
      "japanese",
      "persian",
      "roc",
    ].includes(calendar)
  )
    return calendar;
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
export function requireTemporalCalendar(
  value: unknown,
  realm: ErrorRealm,
): void {
  const object = viewObjectValue(value, realm.objectPrototype);
  if (object !== undefined) {
    const identifier = object.internalTemporalCalendar;
    if (identifier !== undefined) {
      requireISOCalendar(identifier, realm);
      return;
    }
  }

  if (value === undefined || typeof value !== "string") {
    requireISOCalendar(value, realm);
    return;
  }
  const data =
    parseISODateTime(value).value ??
    parseISOTimeString(value).value ??
    parseISOYearMonthString(value).value ??
    parseISOMonthDayString(value).value;
  requireISOCalendar(data === undefined ? value : data.calendar, realm);
}

/** Calendar-bearing Temporal objects bypass public calendar getters. */
export function requireObjectTemporalCalendar(
  object: OrdinaryObject<ScriptPropertyKey, unknown>,
  item: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  const calendar = object.internalTemporalCalendar;
  if (calendar !== undefined) {
    requireISOCalendar(calendar, realm);
    return;
  }
  requireTemporalCalendar(
    getProperty<ScriptPropertyKey, unknown>(object, "calendar", item, hooks),
    realm,
  );
}
