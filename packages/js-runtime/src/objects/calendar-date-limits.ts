import { gregorianCoordinateFromEpochDay } from "@tint/foundation/chrono/gregorian-calendar";
import type { CalendarDateConversion } from "./calendar-records.ts";
/** Date and YearMonth consumers impose different limits on ISO reference dates. */
export function calendarISODateConversion(
  epoch: number,
  kind: "date" | "year-month",
): CalendarDateConversion {
  const date = gregorianCoordinateFromEpochDay(epoch);
  if (date === undefined) return { value: undefined, error: "range" };
  if (kind === "date" && (epoch < -100000001 || epoch > 100000000))
    return { value: undefined, error: "range" };
  if (
    kind === "year-month" &&
    (date.year < -271821 ||
      date.year > 275760 ||
      (date.year === -271821 && date.month < 4) ||
      (date.year === 275760 && date.month > 9))
  )
    return { value: undefined, error: "range" };
  return { value: date, error: "none" };
}
