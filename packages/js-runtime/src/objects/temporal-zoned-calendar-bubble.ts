import { compare, type Integer } from "@tint/foundation/numeric/big-integer";
import {
  createDuration,
  type Duration,
} from "@tint/foundation/chrono/temporal-duration";
import type { TemporalZonedDateTime } from "./temporal-zoned-date-time.ts";
import { zonedDateTimeArithmetic } from "./temporal-zoned-arithmetic.ts";
import { bigIntInteger } from "./bigints.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
/** BubbleRelativeDuration compares actual epoch boundaries for each permitted
 * larger calendar unit. Crossing one discards the fields below that boundary. */
export function bubbleZonedCalendarDuration(
  own: TemporalZonedDateTime,
  data: Duration,
  nudged: Integer,
  largest: string,
  smallest: string,
  sign: number,
  realm: ErrorRealm,
): Duration {
  if (largest === smallest) return data;
  let result = data;
  for (const unit of ["week", "month", "year"]) {
    if (unit === "week" && (largest !== "week" || smallest !== "day")) continue;
    if (
      unit === "month" &&
      ((largest !== "month" && largest !== "year") ||
        smallest === "month" ||
        smallest === "year")
    )
      continue;
    if (unit === "year" && (largest !== "year" || smallest === "year"))
      continue;
    const y = unit === "year" ? result.years + sign : result.years,
      m =
        unit === "year"
          ? 0
          : unit === "month"
            ? result.months + sign
            : result.months,
      w = unit === "week" ? result.weeks + sign : 0;
    const candidate = createDuration([y, m, w, 0]);
    if (candidate === undefined) throw createRuntimeError(realm, "range");
    const boundary = zonedDateTimeArithmetic(
      own,
      candidate,
      false,
      "constrain",
      realm,
    );
    if (compare(nudged, bigIntInteger(boundary)) === -sign) break;
    result = candidate;
  }
  return result;
}
