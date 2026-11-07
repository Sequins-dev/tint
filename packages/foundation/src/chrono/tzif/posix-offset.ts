import {
  gregorianCoordinateFromEpochDay,
  gregorianYearStartEpochDay,
  daysInGregorianMonth,
  maximumCalendarEpochDay,
} from "../gregorian-calendar/index.ts";
import type { PosixTimeZone, PosixTransitionRule } from "./posix.ts";
function weekday(day: number): number {
  return (((day + 4) % 7) + 7) % 7;
}
/** Convert a wall-clock rule using the offset in effect BEFORE the transition. */
export function posixTransitionEpochSeconds(
  rule: PosixTransitionRule,
  year: number,
  offset: number,
): number | undefined {
  const first = gregorianYearStartEpochDay(year);
  if (first === undefined) return undefined;
  const date = rule.date;
  let day = first;
  if (!Number.isInteger(rule.seconds) || Math.abs(rule.seconds) > 604799)
    return undefined;
  if (date.kind === "month-week-day") {
    if (
      !Number.isInteger(date.month) ||
      date.month < 1 ||
      date.month > 12 ||
      !Number.isInteger(date.week) ||
      date.week < 1 ||
      date.week > 5 ||
      !Number.isInteger(date.weekday) ||
      date.weekday < 0 ||
      date.weekday > 6
    )
      return undefined;
    for (let month = 1; month < date.month; month++)
      day += daysInGregorianMonth(year, month);
    let number =
      1 + ((date.weekday - weekday(day) + 7) % 7) + (date.week - 1) * 7;
    if (number > daysInGregorianMonth(year, date.month)) number -= 7;
    day += number - 1;
  } else {
    if (
      !Number.isInteger(date.day) ||
      date.day < 0 ||
      date.day > 365 ||
      (date.kind === "julian" && date.day === 0)
    )
      return undefined;
    day += date.kind === "julian" ? date.day - 1 : date.day;
    if (
      date.kind === "julian" &&
      date.day >= 60 &&
      daysInGregorianMonth(year, 2) === 29
    )
      day++;
  }
  const value = day * 86400 + rule.seconds - offset;
  return Number.isSafeInteger(value) ? value : undefined;
}
/** Include a two-day probe window around the clipped calendar domain: resolving
 * local coordinates tests offsets before the caller clips the final instant.
 * At this bounded magnitude, second arithmetic and adjacent rule years are exact.
 * All-year DST ties prefer its start. */
export function posixDaylightSavingAt(
  zone: PosixTimeZone,
  epochSeconds: number,
): boolean | undefined {
  if (!Number.isSafeInteger(epochSeconds)) return undefined;
  if (zone.kind === "fixed")
    return Number.isInteger(zone.offsetSeconds) &&
      Math.abs(zone.offsetSeconds) <= 93599
      ? false
      : undefined;
  const day = Math.floor(epochSeconds / 86400);
  if (Math.abs(day) > maximumCalendarEpochDay + 2) return undefined;
  if (
    !Number.isInteger(zone.standardOffsetSeconds) ||
    Math.abs(zone.standardOffsetSeconds) > 93599 ||
    !Number.isInteger(zone.daylightOffsetSeconds) ||
    Math.abs(zone.daylightOffsetSeconds) > 93599
  )
    return undefined;
  const date = gregorianCoordinateFromEpochDay(day);
  if (date === undefined) return undefined;
  let last = -Infinity,
    priority = -1,
    result = false;
  for (let year = date.year - 1; year <= date.year + 1; year++) {
    const start = posixTransitionEpochSeconds(
        zone.start,
        year,
        zone.standardOffsetSeconds,
      ),
      end = posixTransitionEpochSeconds(
        zone.end,
        year,
        zone.daylightOffsetSeconds,
      );
    if (start === undefined || end === undefined) return undefined;
    if (end <= epochSeconds && end > last) {
      last = end;
      priority = 0;
      result = false;
    }
    if (
      start <= epochSeconds &&
      (start > last || (start === last && priority < 1))
    ) {
      last = start;
      priority = 1;
      result = true;
    }
  }
  return result;
}
/** Offset equality cannot identify the seasonal state: POSIX permits equal
 * standard/daylight offsets and negative daylight adjustments. */
export function posixOffsetSecondsAt(
  zone: PosixTimeZone,
  epochSeconds: number,
): number | undefined {
  const daylight = posixDaylightSavingAt(zone, epochSeconds);
  if (daylight === undefined) return undefined;
  return zone.kind === "fixed"
    ? zone.offsetSeconds
    : daylight
      ? zone.daylightOffsetSeconds
      : zone.standardOffsetSeconds;
}
