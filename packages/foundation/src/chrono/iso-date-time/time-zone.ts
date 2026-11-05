import { parseISODateTime, isISOTimeZoneIdentifier } from "./date-time.ts";
import { parseISOTimeString } from "./time.ts";
import {
  parseISOYearMonthString,
  parseISOMonthDayString,
} from "./partial-date.ts";
/** Parse a zone identifier or ISO string carrying one. Availability/canonicalization
 * are adapter policies. An annotation overrides Z and any date-time UTC offset. */
export function parseISOTimeZoneString(text: string): string | undefined {
  if (isISOTimeZoneIdentifier(text)) return text;
  const date = parseISODateTime(text);
  const time = date.value === undefined ? parseISOTimeString(text) : undefined;
  const yearMonth =
    date.value === undefined && time?.value === undefined
      ? parseISOYearMonthString(text)
      : undefined;
  const monthDay =
    date.value === undefined &&
    time?.value === undefined &&
    yearMonth?.value === undefined
      ? parseISOMonthDayString(text)
      : undefined;
  const data = date.value ?? time?.value ?? yearMonth?.value ?? monthDay?.value;
  if (data === undefined) return undefined;
  if (data.timeZone !== undefined) return data.timeZone;
  if (data.utc) return "UTC";
  if (data.offsetNanoseconds === undefined) return undefined;
  const bracket = text.indexOf("[");
  const base = bracket < 0 ? text : text.slice(0, bracket);
  const start = Math.max(base.lastIndexOf("+"), base.lastIndexOf("-"));
  const offset = base.slice(start);
  return isISOTimeZoneIdentifier(offset) ? offset : undefined;
}
