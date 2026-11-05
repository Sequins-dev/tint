import { formatZonedDateTime } from "./temporal-date-time-format.ts";
import {
  temporalFractionalSecondDigits,
  temporalPrecisionUnit,
  resolveTemporalPrecision,
} from "./temporal-precision.ts";
import { temporalStringOption } from "./temporal-options.ts";
import { temporalRoundingMode } from "./temporal-rounding.ts";
import type { TemporalZonedDateTime } from "./temporal-zoned-date-time.ts";
import type { ErrorRealm } from "./errors.ts";
import type { ObjectHooks } from "./operations.ts";
/** Zoned string options interleave offset and time-zone display with precision.
 * Algorithmic unit validation follows the last observable option read. */
export function zonedDateTimeText(
  data: TemporalZonedDateTime,
  options: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): string {
  const calendarName = temporalStringOption(
    options,
    "calendarName",
    "auto",
    ["auto", "always", "never", "critical"],
    realm,
    hooks,
  );
  const fractionalDigits = temporalFractionalSecondDigits(
    options,
    realm,
    hooks,
  );
  const offset = temporalStringOption(
    options,
    "offset",
    "auto",
    ["auto", "never"],
    realm,
    hooks,
  );
  const mode = temporalRoundingMode(options, "trunc", realm, hooks);
  const smallestUnit = temporalPrecisionUnit(options, realm, hooks);
  const timeZoneName = temporalStringOption(
    options,
    "timeZoneName",
    "auto",
    ["auto", "never", "critical"],
    realm,
    hooks,
  );
  const precision = resolveTemporalPrecision(
    { fractionalDigits, smallestUnit, mode },
    realm,
  );
  return formatZonedDateTime(
    data.epoch,
    data.zone,
    { precision, mode, calendarName, offset, timeZoneName },
    realm,
  );
}
