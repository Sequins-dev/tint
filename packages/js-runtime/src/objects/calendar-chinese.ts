import {
  epochDayFromGregorianCoordinate,
  gregorianCoordinateFromEpochDay,
  type GregorianDate,
  type GregorianDateDifference,
} from "@tint/foundation/chrono/gregorian-calendar";
import type {
  CalendarDateFields,
  CalendarMonthCode,
  CalendarInputFields,
  CalendarDateConversion,
} from "./calendar-records.ts";
import { resolveCalendarYear } from "./calendar-field-resolution.ts";
import { calendarISODateConversion } from "./calendar-date-limits.ts";
import {
  lunisolarDateAdd,
  lunisolarDateUntil,
  type LunisolarCalendarAlgorithms,
  type CalendarYearMonth,
} from "./calendar-lunisolar-arithmetic.ts";
import {
  calendarNewMoon,
  calendarWinterSolstice,
  calendarSolarLongitude,
  calendarAstronomicalMidnight,
  calendarSynodicMonth,
} from "./calendar-astronomy.ts";
import {
  eastAsianMonthDayReferences,
  chineseCalendarYears,
  dangiCalendarYears,
} from "./calendar-data.ts";
import { localeTableValue } from "./locale-canonicalization.ts";
export function isChineseCalendar(calendar: string): boolean {
  return calendar === "chinese" || calendar === "dangi";
}
interface YearRecord {
  readonly calendar: string;
  readonly year: number;
  readonly start: number;
  readonly end: number;
  readonly moons: readonly number[];
  readonly codes: readonly CalendarMonthCode[];
}
const records: YearRecord[] = [];
interface WinterWindow {
  readonly calendar: string;
  readonly label: number;
  readonly before: number;
  readonly after: number;
  readonly first: number;
  readonly leapMoon: number | undefined;
}
const windows: WinterWindow[] = [];
interface YearStart {
  readonly calendar: string;
  readonly year: number;
  readonly day: number;
}
const starts: YearStart[] = [];
interface PublishedYear {
  readonly start: number;
  readonly leap: number;
  readonly bits: string;
}
function publishedYear(
  calendar: string,
  year: number,
): PublishedYear | undefined {
  if (!isChineseCalendar(calendar) || year < 1900 || year > 2102)
    return undefined;
  const value = localeTableValue(
    calendar === "chinese" ? chineseCalendarYears : dangiCalendarYears,
    String(year),
  );
  if (value === undefined) throw "EAST_ASIAN_PUBLISHED_YEAR_INVARIANT";
  const parts = value.split(",");
  const startText = parts[0],
    leapText = parts[1],
    bits = parts[2];
  if (startText === undefined || leapText === undefined || bits === undefined)
    throw "EAST_ASIAN_PUBLISHED_ROW_INVARIANT";
  return { start: Number(startText), leap: Number(leapText), bits };
}
function winterWindow(calendar: string, label: number): WinterWindow {
  for (const cached of windows)
    if (cached.calendar === calendar && cached.label === label) return cached;
  const before = calendarWinterSolstice(calendar, label),
    after = calendarWinterSolstice(calendar, label + 1),
    first = calendarNewMoon(calendar, before + 1, true),
    last = calendarNewMoon(calendar, after + 1, false);
  let leapMoon: number | undefined;
  if (Math.round((last - first) / calendarSynodicMonth) === 12) {
    let candidate = first;
    for (let i = 0; i < 13 && candidate <= last; i++) {
      if (noMajorTerm(calendar, candidate)) {
        leapMoon = candidate;
        break;
      }
      candidate = calendarNewMoon(calendar, candidate + 25, true);
    }
  }
  const result: WinterWindow = {
    calendar,
    label,
    before,
    after,
    first,
    leapMoon,
  };
  if (windows.length >= 32) windows.shift();
  windows.push(result);
  return result;
}
function noMajorTerm(calendar: string, moon: number): boolean {
  const next = calendarNewMoon(calendar, moon + 25, true);
  const term = (day: number): number =>
    (Math.floor(
      (6 *
        calendarSolarLongitude(calendarAstronomicalMidnight(calendar, day))) /
        Math.PI,
    ) +
      2) %
    12;
  return term(moon) === term(next);
}
export function chineseCalendarYearStart(
  calendar: string,
  year: number,
): number | undefined {
  if (
    !isChineseCalendar(calendar) ||
    !Number.isSafeInteger(year) ||
    Math.abs(year) > 300000
  )
    return undefined;
  const published = publishedYear(calendar, year);
  if (published !== undefined) return published.start;
  for (const cached of starts)
    if (cached.calendar === calendar && cached.year === year) return cached.day;
  const window = winterWindow(calendar, year - 1),
    second = calendarNewMoon(calendar, window.first + 25, true);
  const day =
    window.leapMoon === window.first || window.leapMoon === second
      ? calendarNewMoon(calendar, second + 25, true)
      : second;
  if (starts.length >= 32) starts.shift();
  starts.push({ calendar, year, day });
  return day;
}
function codeAtMoon(
  calendar: string,
  year: number,
  moon: number,
): CalendarMonthCode {
  let label = year,
    window = winterWindow(calendar, label);
  while (moon < window.before) {
    label--;
    window = winterWindow(calendar, label);
  }
  while (moon >= window.after) {
    label++;
    window = winterWindow(calendar, label);
  }
  let month = Math.round((moon - window.first) / calendarSynodicMonth);
  if (window.leapMoon !== undefined && moon >= window.leapMoon) month--;
  if (month < 1) month += 12;
  return { month, leap: moon === window.leapMoon };
}

function yearRecord(calendar: string, year: number): YearRecord | undefined {
  for (const record of records)
    if (record.calendar === calendar && record.year === year) return record;
  const published = publishedYear(calendar, year);
  if (published !== undefined) {
    const moons: number[] = [],
      codes: CalendarMonthCode[] = [];
    let end = published.start;
    for (let i = 0; i < published.bits.length; i++) {
      const ordinal = i + 1,
        leap = ordinal === published.leap;
      moons.push(end);
      codes.push({
        month:
          ordinal - (published.leap !== 0 && ordinal >= published.leap ? 1 : 0),
        leap,
      });
      end += published.bits[i] === "1" ? 30 : 29;
    }
    const record: YearRecord = {
      calendar,
      year,
      start: published.start,
      end,
      moons,
      codes,
    };
    if (records.length >= 16) records.shift();
    records.push(record);
    return record;
  }
  const start = chineseCalendarYearStart(calendar, year),
    end = chineseCalendarYearStart(calendar, year + 1);
  if (start === undefined || end === undefined) return undefined;
  const moons: number[] = [],
    codes: CalendarMonthCode[] = [];
  let moon: number = start;
  while (moon < end && moons.length < 14) {
    moons.push(moon);
    codes.push(codeAtMoon(calendar, year, moon));
    const next = calendarNewMoon(calendar, moon + 25, true);
    if (next - moon !== 29 && next - moon !== 30)
      throw "CHINESE_MONTH_LENGTH_INVARIANT";
    moon = next;
  }
  if (moon !== end || (moons.length !== 12 && moons.length !== 13))
    throw "CHINESE_YEAR_MONTHS_INVARIANT";
  const record: YearRecord = { calendar, year, start, end, moons, codes };
  if (records.length >= 16) records.shift();
  records.push(record);
  return record;
}
function monthStart(record: YearRecord, index: number): number {
  const start = record.moons[index];
  if (start === undefined) throw "CHINESE_MONTH_START_INVARIANT";
  return start;
}
export function chineseCalendarMonthsInYear(
  calendar: string,
  year: number,
): number | undefined {
  return yearRecord(calendar, year)?.moons.length;
}
export function chineseCalendarDaysInMonth(
  calendar: string,
  year: number,
  month: number,
): number | undefined {
  const record = yearRecord(calendar, year);
  if (
    record === undefined ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > record.moons.length
  )
    return undefined;
  return (record.moons[month] ?? record.end) - monthStart(record, month - 1);
}
export function chineseCalendarEpochDay(
  calendar: string,
  year: number,
  month: number,
  day: number,
): number | undefined {
  const record = yearRecord(calendar, year),
    maximum = chineseCalendarDaysInMonth(calendar, year, month);
  return record === undefined ||
    maximum === undefined ||
    !Number.isInteger(day) ||
    day < 1 ||
    day > maximum
    ? undefined
    : monthStart(record, month - 1) + day - 1;
}
export function chineseCalendarFieldsAtEpoch(
  calendar: string,
  epoch: number,
): CalendarDateFields | undefined {
  if (!isChineseCalendar(calendar) || !Number.isSafeInteger(epoch))
    return undefined;
  const iso = gregorianCoordinateFromEpochDay(epoch);
  if (iso === undefined) return undefined;
  let year = iso.year;
  let record = yearRecord(calendar, year);
  if (record === undefined) return undefined;
  while (epoch < record.start) {
    year--;
    record = yearRecord(calendar, year);
    if (record === undefined) return undefined;
  }
  while (epoch >= record.end) {
    year++;
    record = yearRecord(calendar, year);
    if (record === undefined) return undefined;
  }
  let month = 1;
  while (month < record.moons.length && epoch >= monthStart(record, month))
    month++;
  return {
    year,
    month,
    day: epoch - monthStart(record, month - 1) + 1,
    era: undefined,
    eraYear: undefined,
  };
}
export function chineseCalendarFields(
  calendar: string,
  date: GregorianDate,
): CalendarDateFields | undefined {
  const epoch = epochDayFromGregorianCoordinate(
    date.year,
    date.month,
    date.day,
  );
  return epoch === undefined
    ? undefined
    : chineseCalendarFieldsAtEpoch(calendar, epoch);
}
export function chineseCalendarMonthCode(
  calendar: string,
  year: number,
  month: number,
): CalendarMonthCode | undefined {
  return Number.isInteger(month)
    ? yearRecord(calendar, year)?.codes[month - 1]
    : undefined;
}
function validMonthCode(code: CalendarMonthCode): boolean {
  return Number.isInteger(code.month) && code.month >= 1 && code.month <= 12;
}
export function chineseOrdinalFromMonthCode(
  calendar: string,
  year: number,
  code: CalendarMonthCode,
  overflow: "constrain" | "reject",
): number | undefined {
  if (!validMonthCode(code)) return undefined;
  const record = yearRecord(calendar, year);
  if (record === undefined) return undefined;
  let regular: number | undefined;
  for (let i = 0; i < record.codes.length; i++) {
    const c = record.codes[i];
    if (c === undefined) throw "CHINESE_MONTH_CODE_INVARIANT";
    if (c.month === code.month) {
      if (c.leap === code.leap) return i + 1;
      if (!c.leap) regular = i + 1;
    }
  }
  return overflow === "constrain" ? regular : undefined;
}
function monthDayReference(
  calendar: string,
  original: CalendarMonthCode,
  day: number,
  overflow: "constrain" | "reject",
): GregorianDate | undefined {
  let code = original;
  const key = (c: CalendarMonthCode): string =>
    `M${c.month < 10 ? "0" : ""}${c.month}${c.leap ? "L" : ""}`;
  const referenceYear = (c: CalendarMonthCode): number | undefined => {
    const entry = localeTableValue(eastAsianMonthDayReferences, key(c));
    if (entry === undefined) return undefined;
    const parts = entry.split(",");
    const result =
      day === 30
        ? parts[1]
        : c.leap && c.month === 11 && day >= 11
          ? "2034"
          : parts[0];
    if (calendar === "dangi" && !c.leap && c.month === 3 && day === 30)
      return 1968;
    return result === undefined || result === "-" ? undefined : Number(result);
  };
  let reference = referenceYear(code);
  if (reference === undefined && code.leap && overflow === "constrain") {
    code = { month: code.month, leap: false };
    reference = referenceYear(code);
  }
  if (reference === undefined) return undefined;
  const lower = epochDayFromGregorianCoordinate(reference, 1, 1),
    upper = epochDayFromGregorianCoordinate(reference, 12, 31);
  if (lower === undefined || upper === undefined)
    throw "CALENDAR_REFERENCE_DATE_INVARIANT";
  const first = chineseCalendarFieldsAtEpoch(calendar, lower),
    last = chineseCalendarFieldsAtEpoch(calendar, upper);
  if (first === undefined || last === undefined) return undefined;
  for (let year = last.year; year >= first.year; year--) {
    const month = chineseOrdinalFromMonthCode(calendar, year, code, "reject");
    if (month === undefined) continue;
    const epoch = chineseCalendarEpochDay(calendar, year, month, day);
    if (epoch !== undefined && epoch >= lower && epoch <= upper)
      return gregorianCoordinateFromEpochDay(epoch);
  }
  return undefined;
}
export function chineseCalendarDateFromFields(
  calendar: string,
  fields: CalendarInputFields,
  kind: "date" | "year-month" | "month-day",
  overflow: "constrain" | "reject",
): CalendarDateConversion {
  const failure = (
    error: "type" | "range" | "unsupported",
  ): CalendarDateConversion => ({ value: undefined, error });
  if (!isChineseCalendar(calendar)) return failure("unsupported");
  const resolved = resolveCalendarYear(calendar, fields, kind);
  if (resolved.error !== "none") return failure(resolved.error);
  const year = resolved.value;
  let month = fields.month,
    code = fields.monthCode;
  if (code !== undefined && !validMonthCode(code)) return failure("range");
  if (year === undefined) {
    if (code === undefined) return failure("type");
  } else {
    if (code !== undefined) {
      const ordinal = chineseOrdinalFromMonthCode(
        calendar,
        year,
        code,
        overflow,
      );
      if (ordinal === undefined || (month !== undefined && month !== ordinal))
        return failure("range");
      month = ordinal;
    }
    if (month === undefined) return failure("type");
    if (!Number.isInteger(month) || month <= 0) return failure("range");
    const count = chineseCalendarMonthsInYear(calendar, year);
    if (count === undefined) return failure("range");
    if (overflow === "constrain") month = Math.min(month, count);
    if (month > count) return failure("range");
    code = chineseCalendarMonthCode(calendar, year, month);
    if (kind === "month-day") {
      const first = chineseCalendarYearStart(calendar, year),
        next = chineseCalendarYearStart(calendar, year + 1);
      if (
        first === undefined ||
        next === undefined ||
        next <= -100000001 ||
        first > 100000000
      )
        return failure("range");
    }
  }
  if (code === undefined) throw "CHINESE_MONTH_CODE_INVARIANT";
  let day = kind === "year-month" ? 1 : fields.day;
  if (day === undefined) return failure("type");
  if (!Number.isInteger(day) || day <= 0) return failure("range");
  const maximum =
    year === undefined
      ? 30
      : month === undefined
        ? undefined
        : chineseCalendarDaysInMonth(calendar, year, month);
  if (maximum === undefined) return failure("range");
  if (overflow === "constrain") day = Math.min(day, maximum);
  if (day > maximum) return failure("range");
  if (kind === "month-day") {
    const date = monthDayReference(calendar, code, day, overflow);
    return date === undefined
      ? failure("range")
      : { value: date, error: "none" };
  }
  if (year === undefined || month === undefined)
    throw "CHINESE_DATE_FIELDS_INVARIANT";
  const epoch = chineseCalendarEpochDay(calendar, year, month, day);
  return epoch === undefined
    ? failure("range")
    : calendarISODateConversion(epoch, kind);
}

export function chineseMonthsBeforeYear(
  calendar: string,
  year: number,
): number | undefined {
  const start = chineseCalendarYearStart(calendar, year);
  return start === undefined
    ? undefined
    : Math.round((start - 10963) / calendarSynodicMonth);
}
export function chineseYearMonthAtIndex(
  calendar: string,
  index: number,
): CalendarYearMonth | undefined {
  if (!isChineseCalendar(calendar) || !Number.isSafeInteger(index))
    return undefined;
  const estimate = 10963 + index * calendarSynodicMonth;
  if (!Number.isFinite(estimate) || Math.abs(estimate) > 110000000)
    return undefined;
  const iso = gregorianCoordinateFromEpochDay(Math.floor(estimate));
  if (iso === undefined) return undefined;
  let year = iso.year;
  const initialStart = chineseMonthsBeforeYear(calendar, year),
    initialNext = chineseMonthsBeforeYear(calendar, year + 1);
  if (initialStart === undefined || initialNext === undefined) return undefined;
  let start: number = initialStart,
    next: number = initialNext;
  while (index < start) {
    year--;
    const previous = chineseMonthsBeforeYear(calendar, year);
    if (previous === undefined) return undefined;
    next = start;
    start = previous;
  }
  while (index >= next) {
    year++;
    const following = chineseMonthsBeforeYear(calendar, year + 1);
    if (following === undefined) return undefined;
    start = next;
    next = following;
  }
  return { year, month: index - start + 1 };
}
const arithmetic: LunisolarCalendarAlgorithms = {
  fields: chineseCalendarFields,
  monthsBeforeYear: chineseMonthsBeforeYear,
  yearMonthAtIndex: chineseYearMonthAtIndex,
  monthCode: chineseCalendarMonthCode,
  monthFromCode: chineseOrdinalFromMonthCode,
  daysInMonth: chineseCalendarDaysInMonth,
  epochDay: chineseCalendarEpochDay,
};
export function chineseCalendarDateAdd(
  calendar: string,
  date: GregorianDate,
  years: number,
  months: number,
  weeks: number,
  days: number,
  overflow: "constrain" | "reject",
): GregorianDate | undefined {
  return lunisolarDateAdd(
    calendar,
    date,
    years,
    months,
    weeks,
    days,
    overflow,
    arithmetic,
  );
}
export function chineseCalendarDateUntil(
  calendar: string,
  one: GregorianDate,
  two: GregorianDate,
  largest: "year" | "month" | "week" | "day",
): GregorianDateDifference | undefined {
  return lunisolarDateUntil(calendar, one, two, largest, arithmetic);
}
