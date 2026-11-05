import {
  formatISODate,
  formatISOTimePrecision,
} from "@tint/foundation/chrono/iso-date-time";
import { dateFields } from "./date-values.ts";

export function dateISOText(value: number): string | undefined {
  const fields = dateFields(value);
  if (fields === undefined) return undefined;
  return (
    formatISODate({
      year: fields.year,
      month: fields.month + 1,
      day: fields.day,
    }) +
    "T" +
    formatISOTimePrecision(
      {
        hour: fields.hour,
        minute: fields.minute,
        second: fields.second,
        nanosecond: fields.millisecond * 1000000,
      },
      3,
    ) +
    "Z"
  );
}
export function dateUTCText(value: number): string {
  const fields = dateFields(value);
  if (fields === undefined) return "Invalid Date";
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const weekday = weekdays[fields.weekday],
    month = months[fields.month];
  if (weekday === undefined || month === undefined) throw "DATE_TEXT_INVARIANT";
  return (
    weekday +
    ", " +
    String(fields.day).padStart(2, "0") +
    " " +
    month +
    " " +
    (fields.year < 0 ? "-" : "") +
    String(Math.abs(fields.year)).padStart(4, "0") +
    " " +
    String(fields.hour).padStart(2, "0") +
    ":" +
    String(fields.minute).padStart(2, "0") +
    ":" +
    String(fields.second).padStart(2, "0") +
    " GMT"
  );
}

export function dateLocalCalendarText(value: number): string {
  const fields = dateFields(value);
  if (fields === undefined) return "Invalid Date";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][
    fields.weekday
  ];
  const month = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ][fields.month];
  if (weekday === undefined || month === undefined) throw "DATE_TEXT_INVARIANT";
  return (
    weekday +
    " " +
    month +
    " " +
    String(fields.day).padStart(2, "0") +
    " " +
    (fields.year < 0 ? "-" : "") +
    String(Math.abs(fields.year)).padStart(4, "0")
  );
}
/** Keep the standard minute prefix and preserve historical seconds in the
 * optional, implementation-defined time-zone name for exact round trips. */
export function dateLocalClockText(
  value: number,
  offset: number,
): string | undefined {
  const fields = dateFields(value);
  if (fields === undefined) return "Invalid Date";
  if (!Number.isSafeInteger(offset) || offset % 1000 !== 0) return undefined;
  const seconds = Math.abs(offset) / 1000;
  const minutes = Math.floor(seconds / 60);
  const sign = offset < 0 ? "-" : "+";
  const hoursText = String(Math.floor(minutes / 60) % 24).padStart(2, "0");
  const minutesText = String(minutes % 60).padStart(2, "0");
  const label =
    seconds % 60 === 0 && minutes < 1440
      ? ""
      : " (UTC" +
        sign +
        String(Math.floor(minutes / 60)).padStart(2, "0") +
        ":" +
        minutesText +
        ":" +
        String(seconds % 60).padStart(2, "0") +
        ")";
  return (
    String(fields.hour).padStart(2, "0") +
    ":" +
    String(fields.minute).padStart(2, "0") +
    ":" +
    String(fields.second).padStart(2, "0") +
    " GMT" +
    sign +
    hoursText +
    minutesText +
    label
  );
}
