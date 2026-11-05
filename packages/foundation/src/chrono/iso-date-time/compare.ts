import type { ISOTime, ISODateTime } from "./date-time.ts";
/** Compare clock fields without offsets or calendar interpretation. */
export function compareISOTime(a: ISOTime, b: ISOTime): number {
  const difference =
    a.hour - b.hour ||
    a.minute - b.minute ||
    a.second - b.second ||
    a.nanosecond - b.nanosecond;
  return difference < 0 ? -1 : difference > 0 ? 1 : 0;
}
/** Compare local ISO date-times; offsets and annotations do not participate. */
export function compareISODateTime(a: ISODateTime, b: ISODateTime): number {
  const difference =
    a.date.year - b.date.year ||
    a.date.month - b.date.month ||
    a.date.day - b.date.day;
  return difference < 0 ? -1 : difference > 0 ? 1 : compareISOTime(a, b);
}
