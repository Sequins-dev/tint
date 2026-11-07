import {
  epochDayFromGregorian,
  daysInGregorianMonth,
  type GregorianDate,
} from "@tint/foundation/chrono/gregorian-calendar";

import { japaneseGregorianEraData } from "./calendar-data.ts";
import { calendarYearForEra } from "./calendar-era.ts";
export interface GregorianCalendarDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly era: string | undefined;
  readonly eraYear: number | undefined;
}
export function isGregorianCalendar(calendar: string): boolean {
  return (
    calendar === "iso8601" ||
    calendar === "gregory" ||
    calendar === "buddhist" ||
    calendar === "roc" ||
    calendar === "japanese"
  );
}
export function gregorianCalendarISOYear(
  calendar: string,
  arithmeticYear: number,
): number | undefined {
  if (!isGregorianCalendar(calendar) || !Number.isSafeInteger(arithmeticYear))
    return undefined;
  const iso =
    calendar === "buddhist"
      ? arithmeticYear - 543
      : calendar === "roc"
        ? arithmeticYear + 1911
        : arithmeticYear;
  return Number.isSafeInteger(iso) ? iso : undefined;
}
export function gregorianCalendarFields(
  calendar: string,
  date: GregorianDate,
): GregorianCalendarDate | undefined {
  const maximum = daysInGregorianMonth(date.year, date.month);
  if (
    !isGregorianCalendar(calendar) ||
    maximum === 0 ||
    !Number.isInteger(date.day) ||
    date.day < 1 ||
    date.day > maximum
  )
    return undefined;
  const year =
    calendar === "buddhist"
      ? date.year + 543
      : calendar === "roc"
        ? date.year - 1911
        : date.year;
  let era: string | undefined, eraYear: number | undefined;
  if (calendar === "buddhist") {
    era = "be";
    eraYear = year;
  } else if (calendar === "roc") {
    era = year >= 1 ? "roc" : "broc";
    eraYear = year >= 1 ? year : 1 - year;
  } else if (calendar !== "iso8601") {
    era = year >= 1 ? "ce" : "bce";
    eraYear = year >= 1 ? year : 1 - year;
    if (calendar === "japanese") {
      const key = date.year * 10000 + date.month * 100 + date.day;
      for (const row of japaneseGregorianEraData.split(";")) {
        if (row === undefined) throw "CALENDAR_ERA_DATA_INVARIANT";
        const columns = row.split("|"),
          name = columns[0],
          firstYear = columns[1],
          firstMonth = columns[2],
          firstDay = columns[3],
          offset = columns[4];
        if (
          name === undefined ||
          firstYear === undefined ||
          firstMonth === undefined ||
          firstDay === undefined ||
          offset === undefined
        )
          throw "CALENDAR_ERA_DATA_INVARIANT";
        if (
          key >=
          Number(firstYear) * 10000 +
            Number(firstMonth) * 100 +
            Number(firstDay)
        ) {
          era = name;
          eraYear = year - Number(offset) + 1;
          break;
        }
      }
    }
  }
  return { year, month: date.month, day: date.day, era, eraYear };
}

export interface GregorianCalendarInput {
  readonly year?: number | undefined;
  readonly month?: number | undefined;
  readonly monthCode?:
    { readonly month: number; readonly leap: boolean } | undefined;
  readonly day?: number | undefined;
  readonly era?: string | undefined;
  readonly eraYear?: number | undefined;
}
export interface GregorianCalendarConversion {
  readonly value: GregorianDate | undefined;
  readonly error: "none" | "type" | "range" | "unsupported";
}
export function gregorianCalendarDateFromFields(
  calendar: string,
  fields: GregorianCalendarInput,
  kind: "date" | "year-month" | "month-day",
  overflow: "constrain" | "reject",
): GregorianCalendarConversion {
  const failure = (
    error: "type" | "range" | "unsupported",
  ): GregorianCalendarConversion => ({ value: undefined, error });
  if (!isGregorianCalendar(calendar)) return failure("unsupported");
  const nonISO = calendar !== "iso8601";
  const needsYear =
    kind !== "month-day" ||
    (nonISO && (fields.month !== undefined || fields.monthCode === undefined));
  const hasEra = fields.era !== undefined,
    hasEraYear = fields.eraYear !== undefined;
  // Missing required fields and incomplete era pairs precede consistency/ranges.
  if (
    needsYear &&
    fields.year === undefined &&
    (!nonISO || !hasEra || !hasEraYear)
  )
    return failure("type");
  if (nonISO && hasEra !== hasEraYear) return failure("type");
  if (kind !== "year-month" && fields.day === undefined) return failure("type");
  if (fields.month === undefined && fields.monthCode === undefined)
    return failure("type");
  let arithmeticYear = fields.year;
  if (nonISO && fields.era !== undefined && fields.eraYear !== undefined) {
    const year = calendarYearForEra(calendar, fields.era, fields.eraYear);
    if (
      year === undefined ||
      (arithmeticYear !== undefined && arithmeticYear !== year)
    )
      return failure("range");
    arithmeticYear = year;
  }
  let month = fields.month;
  const code = fields.monthCode;
  if (code !== undefined) {
    if (
      code.leap ||
      !Number.isInteger(code.month) ||
      code.month < 1 ||
      code.month > 12 ||
      (month !== undefined && month !== code.month)
    )
      return failure("range");
    month = code.month;
  }
  if (month === undefined) return failure("type");
  if (!Number.isInteger(month) || month <= 0) return failure("range");
  if (overflow === "constrain") month = Math.min(month, 12);
  if (month > 12) return failure("range");
  const isoYear =
    arithmeticYear === undefined
      ? 1972
      : gregorianCalendarISOYear(calendar, arithmeticYear);
  if (isoYear === undefined) return failure("range");
  if (kind === "year-month") {
    if (
      isoYear < -271821 ||
      isoYear > 275760 ||
      (isoYear === -271821 && month < 4) ||
      (isoYear === 275760 && month > 9)
    )
      return failure("range");
    return { value: { year: isoYear, month, day: 1 }, error: "none" };
  }
  if (
    nonISO &&
    arithmeticYear !== undefined &&
    (isoYear < -271821 || isoYear > 275760)
  )
    return failure("range");
  let day = fields.day;
  if (day === undefined) return failure("type");
  if (!Number.isInteger(day) || day <= 0) return failure("range");
  const maximum = daysInGregorianMonth(isoYear, month);
  if (maximum === 0) return failure("range");
  if (overflow === "constrain") day = Math.min(day, maximum);
  if (day > maximum) return failure("range");
  if (kind === "month-day")
    return { value: { year: 1972, month, day }, error: "none" };
  const epoch = epochDayFromGregorian(isoYear, month, day);
  if (epoch === undefined || epoch < -100000001 || epoch > 100000000)
    return failure("range");
  return { value: { year: isoYear, month, day }, error: "none" };
}
