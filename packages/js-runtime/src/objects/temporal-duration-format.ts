import { toNumber } from "@tint/foundation/numeric/big-integer";
import type { RoundingMode } from "@tint/foundation/numeric/integer-rounding";
import {
  createDuration,
  durationFields,
  durationLargestUnit,
  durationText,
  type Duration,
} from "@tint/foundation/chrono/temporal-duration";
import { roundDuration } from "./temporal-duration-rounding.ts";
import {
  readTemporalPrecisionOptions,
  resolveTemporalPrecision,
  type TemporalPrecision,
} from "./temporal-precision.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
import type { ObjectHooks } from "./operations.ts";
/** Calendar fields remain independent. Only rounded clock overflow can carry into
 * days; it never carries into weeks, months or years. */
export function formatRoundedDuration(
  data: Duration,
  precision: TemporalPrecision,
  mode: RoundingMode,
  realm: ErrorRealm,
): string {
  const increment = toNumber(precision.increment);
  if (increment === 1) return durationText(data, precision.digits);
  const fields = durationFields(data);
  fields[0] = 0;
  fields[1] = 0;
  fields[2] = 0;
  fields[3] = 0;
  const clock = createDuration(fields);
  if (clock === undefined) throw "DURATION_FORMAT_CLOCK_INVARIANT";
  const largest = durationLargestUnit(data);
  const largestUnit = ["year", "month", "week", "day"].includes(largest)
    ? "day"
    : largest === "hour"
      ? "hour"
      : largest === "minute"
        ? "minute"
        : "second";
  const rounded = roundDuration(
    clock,
    { largestUnit, smallestUnit: "nanosecond", increment, mode },
    { kind: "none" },
    realm,
  );
  const result = createDuration([
    data.years,
    data.months,
    data.weeks,
    data.days + rounded.days,
    rounded.hours,
    rounded.minutes,
    rounded.seconds,
    rounded.milliseconds,
    rounded.microseconds,
    rounded.nanoseconds,
  ]);
  if (result === undefined) throw createRuntimeError(realm, "range");
  return durationText(result, precision.digits);
}
export function temporalDurationText(
  data: Duration,
  options: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): string {
  const settings = readTemporalPrecisionOptions(options, realm, hooks);
  const precision = resolveTemporalPrecision(settings, realm);
  if (precision.digits === -2) throw createRuntimeError(realm, "range");
  return formatRoundedDuration(data, precision, settings.mode, realm);
}
