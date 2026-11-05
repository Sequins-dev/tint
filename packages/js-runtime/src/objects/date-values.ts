import {
  daysInGregorianMonth,
  gregorianCoordinateFromEpochDay,
} from "@tint/foundation/chrono/gregorian-calendar";

export const millisecondsPerDay = 86400000;
/** Date's inclusive range is measured before truncation. TimeClip removes -0. */
export function clipDateTime(value: number): number {
  return !Number.isFinite(value) || Math.abs(value) > 8640000000000000
    ? NaN
    : Math.trunc(value) + 0;
}
/** MakeDay/MakeTime/MakeDate operate before TimeClip, allowing field overflow. */
export function makeDateTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  millisecond: number,
): number {
  for (const field of [year, month, day, hour, minute, second, millisecond])
    if (!Number.isFinite(field)) return NaN;
  const wholeMonth = Math.trunc(month);
  const balancedYear = Math.trunc(year) + Math.floor(wholeMonth / 12);
  const balancedMonth = ((wholeMonth % 12) + 12) % 12;
  if (!Number.isSafeInteger(balancedYear)) return NaN;
  let days =
    365 * (balancedYear - 1970) +
    Math.floor((balancedYear - 1969) / 4) -
    Math.floor((balancedYear - 1901) / 100) +
    Math.floor((balancedYear - 1601) / 400);
  for (let index = 0; index < balancedMonth; index++)
    days += daysInGregorianMonth(balancedYear, index + 1);
  days += Math.trunc(day) - 1;
  const time =
    Math.trunc(hour) * 3600000 +
    Math.trunc(minute) * 60000 +
    Math.trunc(second) * 1000 +
    Math.trunc(millisecond);
  return days * millisecondsPerDay + time;
}
export function fullDateYear(year: number): number {
  if (!Number.isFinite(year)) return year;
  const integer = Math.trunc(year);
  return integer >= 0 && integer <= 99 ? 1900 + integer : year;
}
export interface DateFields {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly weekday: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  readonly millisecond: number;
}
/** Split UTC or shifted local coordinates. API adapters own TimeClip; negative
 * milliseconds belong to the preceding day. */
export function dateFields(value: number): DateFields | undefined {
  if (!Number.isFinite(value)) return undefined;
  const epochDay = Math.floor(value / millisecondsPerDay);
  const date = gregorianCoordinateFromEpochDay(epochDay);
  if (date === undefined) return undefined;
  const clock = value - epochDay * millisecondsPerDay;
  return {
    year: date.year,
    month: date.month - 1,
    day: date.day,
    weekday: (((epochDay + 4) % 7) + 7) % 7,
    hour: Math.floor(clock / 3600000),
    minute: Math.floor(clock / 60000) % 60,
    second: Math.floor(clock / 1000) % 60,
    millisecond: clock % 1000,
  };
}
