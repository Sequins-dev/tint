import type { DateTimeFormatFields } from "./date-time-pattern.ts";
function present(options: DateTimeFormatFields, required: string): boolean {
  const date = required === "date" || required === "any",
    time = required === "time" || required === "any";
  return (
    (date && options.weekday !== undefined) ||
    ((date || required === "year-month") && options.year !== undefined) ||
    ((date || required === "year-month" || required === "month-day") &&
      options.month !== undefined) ||
    ((date || required === "month-day") && options.day !== undefined) ||
    (time &&
      (options.dayPeriod !== undefined ||
        options.hour !== undefined ||
        options.minute !== undefined ||
        options.second !== undefined ||
        options.fractionalSecondDigits !== undefined))
  );
}
/** Preserve raw options separately from each model's format. Era and zone labels
 * do not count as requested date/time components. */
export function resolveDateTimeFormatOptions(
  options: DateTimeFormatFields,
  required: string,
  defaults: string,
  inheritAll: boolean,
): DateTimeFormatFields | undefined {
  const date = required === "date" || required === "any",
    time = required === "time" || required === "any",
    yearMonth = required === "year-month",
    monthDay = required === "month-day";
  const result: DateTimeFormatFields = {
    weekday: inheritAll || date ? options.weekday : undefined,
    era: inheritAll || date || yearMonth ? options.era : undefined,
    year: inheritAll || date || yearMonth ? options.year : undefined,
    month:
      inheritAll || date || yearMonth || monthDay ? options.month : undefined,
    day: inheritAll || date || monthDay ? options.day : undefined,
    dayPeriod: inheritAll || time ? options.dayPeriod : undefined,
    hour: inheritAll || time ? options.hour : undefined,
    minute: inheritAll || time ? options.minute : undefined,
    second: inheritAll || time ? options.second : undefined,
    fractionalSecondDigits:
      inheritAll || time ? options.fractionalSecondDigits : undefined,
    timeZoneName: inheritAll ? options.timeZoneName : undefined,
  };
  if (!present(options, required)) {
    if (!inheritAll && present(options, "any")) return undefined;
    const all = defaults === "all" || defaults === "zoned-date-time";
    if (all || defaults === "date" || defaults === "year-month")
      result.year = "numeric";
    if (
      all ||
      defaults === "date" ||
      defaults === "year-month" ||
      defaults === "month-day"
    )
      result.month = "numeric";
    if (all || defaults === "date" || defaults === "month-day")
      result.day = "numeric";
    if (all || defaults === "time") {
      result.hour = "numeric";
      result.minute = "numeric";
      result.second = "numeric";
    }
    if (defaults === "zoned-date-time" && result.timeZoneName === undefined)
      result.timeZoneName = "short";
  }
  return result;
}
