import {
  roundIntegerAsIfPositive,
  type RoundingMode,
} from "@tint/foundation/numeric/integer-rounding";
import { bigIntInteger, type BigIntValue } from "./bigints.ts";
import {
  temporalTimeZoneOffsetNanoseconds,
  temporalTimeZoneOffsetTextRounded,
  type TemporalTimeZone,
} from "./temporal-time-zone.ts";
import { temporalEpochDateTime, validTemporalEpoch } from "./temporal-epoch.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";
import {
  formatISODate,
  formatISOTimePrecision,
  type ISODateTime,
} from "@tint/foundation/chrono/iso-date-time";
import { temporalStringOption } from "./temporal-options.ts";
import {
  readTemporalPrecisionOptions,
  resolveTemporalPrecision,
  type TemporalPrecision,
} from "./temporal-precision.ts";
import { roundTemporalDateTime } from "./temporal-date-time-rounding.ts";
import type { ObjectHooks } from "./operations.ts";
export function plainDateTimeText(
  data: ISODateTime,
  options: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): string {
  const calendar = temporalStringOption(
    options,
    "calendarName",
    "auto",
    ["auto", "always", "never", "critical"],
    realm,
    hooks,
  );
  const settings = readTemporalPrecisionOptions(options, realm, hooks);
  const precision = resolveTemporalPrecision(settings, realm);
  const result = roundTemporalDateTime(
    data,
    { increment: precision.increment, mode: settings.mode },
    realm,
  );
  const suffix = temporalCalendarAnnotation(
    calendar,
    data.calendar ?? "iso8601",
  );
  return (
    formatISODate(result.date) +
    "T" +
    formatISOTimePrecision(result, precision.digits) +
    suffix
  );
}

export function temporalCalendarAnnotation(
  display: string,
  calendar: string = "iso8601",
): string {
  if (display === "never" || (display === "auto" && calendar === "iso8601"))
    return "";
  return "[" + (display === "critical" ? "!" : "") + "u-ca=" + calendar + "]";
}
export interface ZonedDateTimeFormat {
  readonly precision: TemporalPrecision;
  readonly mode: RoundingMode;
  readonly calendarName: string;
  readonly offset: string;
  readonly timeZoneName: string;
}
/** Formatting rounds the exact instant before converting to its local clock. */
export function formatZonedDateTime(
  epoch: BigIntValue,
  zone: TemporalTimeZone,
  options: ZonedDateTimeFormat,
  realm: ErrorRealm,
  calendar: string = "iso8601",
): string {
  const rounded = roundIntegerAsIfPositive(
    bigIntInteger(epoch),
    options.precision.increment,
    options.mode,
  );
  if (rounded === undefined) throw "ZONED_FORMAT_ROUNDING_INVARIANT";
  if (!validTemporalEpoch(rounded)) throw createRuntimeError(realm, "range");
  const offset = temporalTimeZoneOffsetNanoseconds(zone, rounded);
  if (offset === undefined) return rejectUnsupportedExecution(realm);
  const data = temporalEpochDateTime(rounded, offset);
  if (data === undefined) throw createRuntimeError(realm, "range");
  return (
    formatISODate(data.date) +
    "T" +
    formatISOTimePrecision(data, options.precision.digits) +
    (options.offset === "never"
      ? ""
      : temporalTimeZoneOffsetTextRounded(offset)) +
    (options.timeZoneName === "never"
      ? ""
      : "[" +
        (options.timeZoneName === "critical" ? "!" : "") +
        zone.identifier +
        "]") +
    temporalCalendarAnnotation(options.calendarName, calendar)
  );
}
