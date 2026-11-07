/** Proleptic Gregorian dates use astronomical years (including year zero). */
export interface GregorianDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}
/** Includes the extra boundary day needed by Temporal's plain-date domain. */
export const maximumCalendarEpochDay = 100000001;

export function daysInGregorianMonth(year: number, month: number): number {
  if (
    !Number.isSafeInteger(year) ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12
  )
    return 0;
  if (month === 2)
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

function startOfYear(year: number): number {
  return (
    365 * (year - 1970) +
    Math.floor((year - 1969) / 4) -
    Math.floor((year - 1901) / 100) +
    Math.floor((year - 1601) / 400)
  );
}

/** Year-start coordinate without Date/Temporal clipping, for transition rules
 * whose adjacent-year anchors can lie beyond the consumer's permitted dates.
 * Reject inputs whose intermediate integer arithmetic cannot remain exact. */
export function gregorianYearStartEpochDay(year: number): number | undefined {
  if (!Number.isSafeInteger(year)) return undefined;
  const bound =
    365 * Math.abs(year - 1970) +
    Math.abs(Math.floor((year - 1969) / 4)) +
    Math.abs(Math.floor((year - 1901) / 100)) +
    Math.abs(Math.floor((year - 1601) / 400));
  return Number.isSafeInteger(bound) ? startOfYear(year) : undefined;
}

/** Unclipped inverse of gregorianCoordinateFromEpochDay. Calendar reference
 * dates may extend beyond a consumer's final Date/Temporal range. */
export function epochDayFromGregorianCoordinate(
  year: number,
  month: number,
  day: number,
): number | undefined {
  const length = daysInGregorianMonth(year, month);
  if (length === 0 || !Number.isInteger(day) || day < 1 || day > length)
    return undefined;
  const start = gregorianYearStartEpochDay(year);
  if (start === undefined) return undefined;
  let epochDay = start + day - 1;
  for (let current = 1; current < month; current++)
    epochDay += daysInGregorianMonth(year, current);
  return Number.isSafeInteger(epochDay) ? epochDay : undefined;
}

/** Convert a valid date; overflow normalization and time zones belong to callers. */
export function epochDayFromGregorian(
  year: number,
  month: number,
  day: number,
): number | undefined {
  if (Math.abs(year) > 1971 + Math.ceil(maximumCalendarEpochDay / 365))
    return undefined;
  const epochDay = epochDayFromGregorianCoordinate(year, month, day);
  return epochDay !== undefined && Math.abs(epochDay) <= maximumCalendarEpochDay
    ? epochDay
    : undefined;
}

/** Convert an integral epoch day within the Date/Temporal calendar domain. */
export function gregorianFromEpochDay(
  epochDay: number,
): GregorianDate | undefined {
  if (
    !Number.isInteger(epochDay) ||
    Math.abs(epochDay) > maximumCalendarEpochDay
  )
    return undefined;
  return gregorianCoordinateFromEpochDay(epochDay);
}

/** Exact civil coordinates independent of Date/Temporal clipping. Used for local
 * time-zone shifts; reject values whose year-boundary arithmetic is not exact. */
export function gregorianCoordinateFromEpochDay(
  epochDay: number,
): GregorianDate | undefined {
  if (!Number.isSafeInteger(epochDay)) return undefined;
  // The average-year estimate is corrected against exact Gregorian boundaries.
  let year = 1970 + Math.floor(epochDay / 365.2425);
  const first = gregorianYearStartEpochDay(year);
  const following = gregorianYearStartEpochDay(year + 1);
  if (first === undefined || following === undefined) return undefined;
  let start: number = first,
    next: number = following;
  while (start > epochDay) {
    year--;
    const candidate = gregorianYearStartEpochDay(year);
    if (candidate === undefined) return undefined;
    next = start;
    start = candidate;
  }
  while (next <= epochDay) {
    year++;
    const candidate = gregorianYearStartEpochDay(year + 1);
    if (candidate === undefined) return undefined;
    start = next;
    next = candidate;
  }
  let remaining = epochDay - start;
  let month = 1;
  while (remaining >= daysInGregorianMonth(year, month)) {
    remaining -= daysInGregorianMonth(year, month);
    month++;
  }
  return { year, month, day: remaining + 1 };
}

/** ISO week fields: Monday=1, Sunday=7; the week year may differ from the date year. */
export interface ISOWeekDate {
  readonly year: number;
  readonly week: number;
  readonly weekday: number;
}
function isoWeekday(epochDay: number): number {
  return ((((epochDay + 3) % 7) + 7) % 7) + 1;
}
function weeksInISOYear(year: number): number {
  const first = isoWeekday(startOfYear(year));
  return first === 4 || (first === 3 && daysInGregorianMonth(year, 2) === 29)
    ? 53
    : 52;
}
/** Uses arithmetic within the containing year, including clipped-domain edge dates. */
export function isoWeekFromEpochDay(epochDay: number): ISOWeekDate | undefined {
  const date = gregorianFromEpochDay(epochDay);
  if (date === undefined) return undefined;
  const weekday = isoWeekday(epochDay);
  const ordinal = epochDay - startOfYear(date.year) + 1;
  let year = date.year,
    week = Math.floor((ordinal - weekday + 10) / 7);
  if (week < 1) {
    year--;
    week = weeksInISOYear(year);
  } else if (week > weeksInISOYear(year)) {
    year++;
    week = 1;
  }
  return { year, week, weekday };
}

/** Add years/months as one calendar step, regulate the day, then add weeks/days.
 * Inputs, intermediate month result and final result stay in the supported domain. */
export function addGregorianDate(
  date: GregorianDate,
  years: number,
  months: number,
  weeks: number,
  days: number,
  overflow: "constrain" | "reject",
): GregorianDate | undefined {
  if (epochDayFromGregorian(date.year, date.month, date.day) === undefined)
    return undefined;
  for (const value of [years, months, weeks, days])
    if (!Number.isSafeInteger(value)) return undefined;
  const monthIndex = date.month - 1 + months;
  const year = date.year + years + Math.floor(monthIndex / 12);
  const month = (((monthIndex % 12) + 12) % 12) + 1;
  const length = daysInGregorianMonth(year, month);
  if (length === 0 || (overflow === "reject" && date.day > length))
    return undefined;
  const start = epochDayFromGregorian(year, month, Math.min(date.day, length));
  if (start === undefined) return undefined;
  return gregorianFromEpochDay(start + weeks * 7 + days);
}

export interface GregorianDateDifference {
  readonly years: number;
  readonly months: number;
  readonly weeks: number;
  readonly days: number;
}
/** Whole calendar units compare the original day before constraining the final
 * year/month anchor. This differs from repeatedly adding clamped months. */
export function differenceGregorianDates(
  one: GregorianDate,
  two: GregorianDate,
  largestUnit: "year" | "month" | "week" | "day",
): GregorianDateDifference | undefined {
  const first = epochDayFromGregorian(one.year, one.month, one.day),
    last = epochDayFromGregorian(two.year, two.month, two.day);
  if (first === undefined || last === undefined) return undefined;
  const sign = last > first ? 1 : last < first ? -1 : 0;
  let years = 0,
    months = 0,
    weeks = 0,
    days = last - first;
  if (sign !== 0 && (largestUnit === "year" || largestUnit === "month")) {
    // Jump to the target year/month; at most one unregulated anniversary
    // surpasses the endpoint. No walk proportional to the date span is needed.
    let span = (two.year - one.year) * 12 + two.month - one.month;
    if (sign * (one.day - two.day) > 0) span -= sign;
    years = largestUnit === "year" ? Math.trunc(span / 12) : 0;
    months = span - years * 12;
    const anchor = addGregorianDate(one, years, months, 0, 0, "constrain");
    if (anchor === undefined) return undefined;
    const epoch = epochDayFromGregorian(anchor.year, anchor.month, anchor.day);
    if (epoch === undefined) return undefined;
    days = last - epoch;
  } else if (largestUnit === "week") {
    weeks = Math.trunc(days / 7);
    days %= 7;
  }
  return {
    years: years === 0 ? 0 : years,
    months: months === 0 ? 0 : months,
    weeks: weeks === 0 ? 0 : weeks,
    days: days === 0 ? 0 : days,
  };
}
