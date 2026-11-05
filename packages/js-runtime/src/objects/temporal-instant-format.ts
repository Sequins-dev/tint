import { roundIntegerAsIfPositive } from "@tint/foundation/numeric/integer-rounding";
import {
  formatISODate,
  formatISOTimePrecision,
} from "@tint/foundation/chrono/iso-date-time";
import {
  readTemporalPrecisionOptions,
  resolveTemporalPrecision,
} from "./temporal-precision.ts";
import { optionValue } from "./options.ts";
import {
  temporalTimeZoneLike,
  temporalTimeZoneOffsetNanoseconds,
  temporalTimeZoneOffsetTextRounded,
} from "./temporal-time-zone.ts";
import { temporalEpochDateTime, validTemporalEpoch } from "./temporal-epoch.ts";
import type { BigIntValue } from "./bigints.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";
import type { ObjectHooks } from "./operations.ts";
export function instantText(
  epoch: BigIntValue,
  options: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): string {
  const settings = readTemporalPrecisionOptions(options, realm, hooks);
  const zoneValue = optionValue(options, "timeZone", realm, hooks);
  const zone =
    zoneValue === undefined
      ? undefined
      : temporalTimeZoneLike(zoneValue, realm);
  const precision = resolveTemporalPrecision(settings, realm);
  const rounded = roundIntegerAsIfPositive(
    epoch.integer,
    precision.increment,
    settings.mode,
  );
  if (rounded === undefined) throw "INSTANT_FORMAT_ROUNDING_INVARIANT";
  if (!validTemporalEpoch(rounded)) throw createRuntimeError(realm, "range");
  const offset =
    zone === undefined ? 0 : temporalTimeZoneOffsetNanoseconds(zone, rounded);
  if (offset === undefined) return rejectUnsupportedExecution(realm);
  const data = temporalEpochDateTime(rounded, offset);
  if (data === undefined) throw createRuntimeError(realm, "range");
  return (
    formatISODate(data.date) +
    "T" +
    formatISOTimePrecision(data, precision.digits) +
    (zone === undefined ? "Z" : temporalTimeZoneOffsetTextRounded(offset))
  );
}
