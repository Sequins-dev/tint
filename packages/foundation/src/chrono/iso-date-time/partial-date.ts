import { parseISODateTime, type ISODateTimeResult } from "./date-time.ts";
function result(text: string, normalized: string): ISODateTimeResult {
  const parsed = parseISODateTime(normalized);
  const value = parsed.value;
  if (value !== undefined && value.calendar !== undefined) {
    const calendar = value.calendar,
      expected = "iso8601";
    if (calendar.length !== expected.length)
      return {
        error: "invalid",
        value: undefined,
        offset: 0,
        offsetHasSeconds: false,
      };
    for (let i = 0; i < calendar.length; i++) {
      const code = calendar.charCodeAt(i),
        folded = code >= 65 && code <= 90 ? code + 32 : code;
      if (folded !== expected.charCodeAt(i))
        return {
          error: "invalid",
          value: undefined,
          offset: 0,
          offsetHasSeconds: false,
        };
    }
  }
  return {
    error: parsed.error,
    offsetHasSeconds: parsed.offsetHasSeconds,
    value: parsed.value,
    offset:
      parsed.error === "none"
        ? text.length
        : Math.min(text.length, parsed.offset),
  };
}
/** Omitted day is represented as 1; full strings retain their reference components. */
export function parseISOYearMonthString(text: string): ISODateTimeResult {
  const full = parseISODateTime(text);
  if (full.error === "none") return full;
  const bracket = text.indexOf("["),
    base = bracket < 0 ? text : text.slice(0, bracket),
    suffix = bracket < 0 ? "" : text.slice(bracket);
  const yearLength = base.startsWith("+") || base.startsWith("-") ? 7 : 4;
  const separated = base.charAt(yearLength) === "-";
  if (base.length !== yearLength + (separated ? 3 : 2)) return full;
  return result(text, base + (separated ? "-01" : "01") + suffix);
}
/** Omitted year uses leap reference year 1972; full strings retain their reference year. */
export function parseISOMonthDayString(text: string): ISODateTimeResult {
  const full = parseISODateTime(text);
  if (full.error === "none") return full;
  const bracket = text.indexOf("["),
    raw = bracket < 0 ? text : text.slice(0, bracket),
    suffix = bracket < 0 ? "" : text.slice(bracket);
  const base = raw.startsWith("--") ? raw.slice(2) : raw;
  if (base.length === 5 && base.charAt(2) === "-")
    return result(text, "1972-" + base + suffix);
  if (base.length === 4) return result(text, "1972" + base + suffix);
  return full;
}
