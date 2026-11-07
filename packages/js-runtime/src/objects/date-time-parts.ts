import {
  epochDayFromGregorianCoordinate,
  type GregorianDate,
} from "@tint/foundation/chrono/gregorian-calendar";
import { decimalFromNumber } from "@tint/foundation/numeric/number-text";
import {
  calendarFieldsFromISO,
  calendarMonthCode,
  calendarInLeapYear,
  type CalendarDateFields,
} from "./calendar.ts";
import {
  createDateTimeCalendarProfile,
  dateTimeCalendarValue,
  type DateTimeCalendarProfile,
} from "./date-time-calendar.ts";
import {
  createDateTimeZoneProfile,
  dateTimeDayPeriod,
  type DateTimeZoneProfile,
} from "./date-time-zone-data.ts";
import {
  createDecimalNumberFormatter,
  decimalNumberParts,
  type DecimalNumberFormatter,
} from "./decimal-number-format.ts";
import type { DateTimePatternToken } from "./date-time-pattern.ts";
import type { DecimalNumberPart } from "./decimal-number-parts.ts";
export interface DateTimeDisplayFields {
  readonly date: GregorianDate;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  readonly millisecond: number;
}
export interface DateTimePart {
  readonly type: string;
  readonly value: string;
}
export interface DateTimePartsFormatter {
  readonly calendar: DateTimeCalendarProfile;
  readonly gregorian: DateTimeCalendarProfile;
  readonly periods: DateTimeZoneProfile;
  readonly numeric: DecimalNumberFormatter;
  readonly twoDigits: DecimalNumberFormatter;
  readonly threeDigits: DecimalNumberFormatter;
}
function integerFormatter(
  locale: string,
  numberingSystem: string | undefined,
  minimumIntegerDigits: number,
): DecimalNumberFormatter | undefined {
  return createDecimalNumberFormatter(
    locale,
    numberingSystem,
    {
      minimumIntegerDigits,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
      minimumSignificantDigits: undefined,
      maximumSignificantDigits: undefined,
      roundingIncrement: 1,
      roundingMode: "halfExpand",
      roundingType: "fraction-digits",
      roundingPriority: "auto",
      trailingZeroDisplay: "auto",
    },
    false,
    "auto",
  );
}
export function createDateTimePartsFormatter(
  locale: string,
  calendar: string,
  numberingSystem: string | undefined,
): DateTimePartsFormatter | undefined {
  const data = createDateTimeCalendarProfile(locale, calendar),
    gregorian = createDateTimeCalendarProfile(locale, "gregory"),
    periods = createDateTimeZoneProfile(locale),
    numeric = integerFormatter(locale, numberingSystem, 1),
    twoDigits = integerFormatter(locale, numberingSystem, 2),
    threeDigits = integerFormatter(locale, numberingSystem, 3);
  if (
    data === undefined ||
    gregorian === undefined ||
    periods === undefined ||
    numeric === undefined ||
    twoDigits === undefined ||
    threeDigits === undefined
  )
    return undefined;
  return {
    calendar: data,
    gregorian,
    periods,
    numeric,
    twoDigits,
    threeDigits,
  };
}
function numberText(formatter: DecimalNumberFormatter, value: number): string {
  const parts = decimalNumberParts(formatter, decimalFromNumber(value));
  let text = "";
  for (let index = 0; index < parts.length; index++) {
    const part: DecimalNumberPart | undefined = parts[index];
    if (part === undefined) throw "DATE_TIME_NUMBER_PART_INVARIANT";
    text += part.value;
  }
  return text;
}
function numericField(
  formatter: DateTimePartsFormatter,
  value: number,
  width: number,
): string {
  return numberText(
    width === 2 ? formatter.twoDigits : formatter.numeric,
    width === 2 ? Math.abs(value) % 100 : value,
  );
}
function textWidth(width: number): string {
  return width >= 5 ? "narrow" : width === 4 ? "wide" : "abbreviated";
}
function appendPart(result: DateTimePart[], type: string, value: string): void {
  if (value === "") return;
  const last: DateTimePart | undefined = result[result.length - 1];
  if (type === "literal" && last !== undefined && last.type === "literal")
    result[result.length - 1] = { type, value: last.value + value };
  else result.push({ type, value });
}
function eraId(
  calendar: string,
  fields: CalendarDateFields,
): string | undefined {
  const era = fields.era;
  if (calendar === "chinese" || calendar === "dangi") return undefined;
  if (calendar === "gregory" || calendar === "iso8601")
    return fields.year > 0 ? "1" : "0";
  if (calendar === "japanese")
    return era === "reiwa"
      ? "236"
      : era === "heisei"
        ? "235"
        : era === "showa"
          ? "234"
          : era === "taisho"
            ? "233"
            : era === "meiji"
              ? "232"
              : undefined;
  if (calendar === "roc") return era === "roc" ? "1" : "0";
  if (calendar === "coptic") return "1";
  if (calendar === "ethiopic") return era === "am" ? "1" : "0";
  if (
    calendar === "islamic-civil" ||
    calendar === "islamic-tbla" ||
    calendar === "islamic-umalqura"
  )
    return era === "ah" ? "0" : "1";
  return "0";
}
function eraText(
  formatter: DateTimePartsFormatter,
  fields: CalendarDateFields,
  width: number,
): string | undefined {
  const calendar = formatter.calendar.calendar,
    id = eraId(calendar, fields);
  if (calendar === "japanese" && id === undefined)
    return dateTimeCalendarValue(
      formatter.gregorian,
      "eras",
      textWidth(width) + "." + (fields.year > 0 ? "1" : "0"),
    );
  return id === undefined
    ? undefined
    : dateTimeCalendarValue(
        formatter.calendar,
        "eras",
        textWidth(width) + "." + id,
      );
}
function monthText(
  formatter: DateTimePartsFormatter,
  input: DateTimeDisplayFields,
  fields: CalendarDateFields,
  symbol: string,
  width: number,
): string | undefined {
  const calendar = formatter.calendar.calendar,
    code = calendarMonthCode(calendar, input.date);
  if (code === undefined) return undefined;
  const context = symbol === "L" ? "stand-alone" : "format";
  let index = code.month;
  if (calendar === "hebrew")
    index = code.leap ? 6 : code.month >= 6 ? code.month + 1 : code.month;
  let value: string | undefined;
  if (width < 3)
    value = numericField(
      formatter,
      calendar === "hebrew" ? fields.month : code.month,
      width,
    );
  else {
    const leapAdar =
      calendar === "hebrew" &&
      code.month === 6 &&
      !code.leap &&
      calendarInLeapYear(calendar, fields.year) === true;
    const key =
      context +
      "." +
      textWidth(width) +
      "." +
      String(index) +
      (leapAdar ? "leap" : "");
    value = dateTimeCalendarValue(formatter.calendar, "months", key);
  }
  if (value === undefined) return undefined;
  if (code.leap && (calendar === "chinese" || calendar === "dangi")) {
    const pattern = dateTimeCalendarValue(
      formatter.calendar,
      "leapMonths",
      width < 3 ? "numeric" : context + "." + textWidth(width),
    );
    if (pattern === undefined) return undefined;
    const marker = pattern.indexOf("{0}");
    if (marker < 0 || pattern.indexOf("{0}", marker + 3) >= 0) return undefined;
    return pattern.slice(0, marker) + value + pattern.slice(marker + 3);
  }
  return value;
}
function periodText(
  formatter: DateTimePartsFormatter,
  input: DateTimeDisplayFields,
  symbol: string,
  width: number,
): string | undefined {
  const seconds =
    input.hour * 3600 +
    input.minute * 60 +
    input.second +
    input.millisecond / 1000;
  const half = input.hour < 12 ? "am" : "pm";
  let period: string = half;
  if (symbol === "B")
    period = dateTimeDayPeriod(formatter.periods, seconds) ?? half;
  else if (symbol === "b" && (seconds === 0 || seconds === 43200))
    period = seconds === 0 ? "midnight" : "noon";
  return (
    dateTimeCalendarValue(
      formatter.calendar,
      "dayPeriods",
      "format." + textWidth(width) + "." + period,
    ) ??
    dateTimeCalendarValue(
      formatter.calendar,
      "dayPeriods",
      "format." + textWidth(width) + "." + half,
    )
  );
}
/** Calendar storage is ISO; exposed fields and names come from the same shared
 * calendar services as Temporal. Zone labels are resolved for this exact input
 * by the time-zone formatter before rendering the pattern. */
export function dateTimePatternParts(
  formatter: DateTimePartsFormatter,
  tokens: readonly DateTimePatternToken[],
  input: DateTimeDisplayFields,
  zoneName: string | undefined,
): DateTimePart[] | undefined {
  const epochDay = epochDayFromGregorianCoordinate(
    input.date.year,
    input.date.month,
    input.date.day,
  );
  if (
    epochDay === undefined ||
    !Number.isInteger(input.hour) ||
    input.hour < 0 ||
    input.hour > 23 ||
    !Number.isInteger(input.minute) ||
    input.minute < 0 ||
    input.minute > 59 ||
    !Number.isInteger(input.second) ||
    input.second < 0 ||
    input.second > 59 ||
    !Number.isInteger(input.millisecond) ||
    input.millisecond < 0 ||
    input.millisecond > 999
  )
    return undefined;
  const fields = calendarFieldsFromISO(formatter.calendar.calendar, input.date);
  if (fields === undefined) return undefined;
  const result: DateTimePart[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const item: DateTimePatternToken | undefined = tokens[index];
    if (item === undefined) throw "DATE_TIME_PART_TOKEN_INVARIANT";
    const symbol = item.symbol,
      width = item.width;
    let type = "",
      value: string | undefined;
    if (symbol === "") {
      appendPart(result, "literal", item.literal);
      continue;
    }
    if (symbol === "G") {
      type = "era";
      value = eraText(formatter, fields, width);
      if (
        value === undefined &&
        (formatter.calendar.calendar === "chinese" ||
          formatter.calendar.calendar === "dangi")
      )
        continue;
    } else if (symbol === "y" || symbol === "u" || symbol === "Y") {
      type = "year";
      const raw = fields.eraYear ?? fields.year;
      value = numericField(
        formatter,
        raw <= 0 ? 1 - raw : raw,
        width === 2 ? 2 : 1,
      );
    } else if (symbol === "r") {
      type = "relatedYear";
      value = numberText(formatter.numeric, fields.year);
    } else if (symbol === "U") {
      type = "yearName";
      const cycle = ((((fields.year - 4) % 60) + 60) % 60) + 1;
      value = dateTimeCalendarValue(
        formatter.calendar,
        "cyclicYears",
        textWidth(width) + "." + String(cycle),
      );
    } else if (symbol === "M" || symbol === "L") {
      type = "month";
      value = monthText(formatter, input, fields, symbol, width);
    } else if (symbol === "d") {
      type = "day";
      value = numericField(formatter, fields.day, width);
    } else if (symbol === "E" || symbol === "e" || symbol === "c") {
      if (symbol !== "E" && width < 3) return undefined;
      const names: readonly string[] = [
        "sun",
        "mon",
        "tue",
        "wed",
        "thu",
        "fri",
        "sat",
      ];
      const day = names[(((epochDay + 4) % 7) + 7) % 7];
      if (day === undefined) throw "DATE_TIME_WEEKDAY_INVARIANT";
      type = "weekday";
      value = dateTimeCalendarValue(
        formatter.calendar,
        "days",
        (symbol === "c" ? "stand-alone" : "format") +
          "." +
          (width === 6 ? "short" : textWidth(width)) +
          "." +
          day,
      );
    } else if (
      symbol === "h" ||
      symbol === "H" ||
      symbol === "K" ||
      symbol === "k"
    ) {
      let hour = input.hour;
      if (symbol === "h" || symbol === "K") {
        hour %= 12;
        if (symbol === "h" && hour === 0) hour = 12;
      } else if (symbol === "k" && hour === 0) hour = 24;
      type = "hour";
      value = numericField(formatter, hour, width);
    } else if (symbol === "m") {
      type = "minute";
      value = numericField(formatter, input.minute, width);
    } else if (symbol === "s") {
      type = "second";
      value = numericField(formatter, input.second, width);
    } else if (symbol === "S") {
      if (width < 1 || width > 3) return undefined;
      const number = Math.floor(
        input.millisecond / (width === 1 ? 100 : width === 2 ? 10 : 1),
      );
      type = "fractionalSecond";
      value = numberText(
        width === 3
          ? formatter.threeDigits
          : width === 2
            ? formatter.twoDigits
            : formatter.numeric,
        number,
      );
    } else if (symbol === "a" || symbol === "b" || symbol === "B") {
      type = "dayPeriod";
      value = periodText(formatter, input, symbol, width);
    } else if ("zvVOZXx".includes(symbol)) {
      type = "timeZoneName";
      value = zoneName;
    } else return undefined;
    if (value === undefined) return undefined;
    appendPart(result, type, value);
  }
  return result;
}
