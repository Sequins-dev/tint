import { daysInGregorianMonth } from "../gregorian-calendar/index.ts";
import { parseISODateTime, type ISOTime } from "./date-time.ts";
export interface ISOTimeString extends ISOTime {
  readonly utc: boolean;
  readonly offsetNanoseconds: number | undefined;
  readonly timeZone: string | undefined;
  readonly calendar: string | undefined;
}
export interface ISOTimeStringResult {
  readonly error: "none" | "invalid";
  readonly value: ISOTimeString | undefined;
  readonly offset: number;
}
function ambiguous(text: string): boolean {
  const bracket = text.indexOf("[");
  const base = bracket < 0 ? text : text.slice(0, bracket);
  if (base.length === 4 || (base.length === 5 && base.charAt(2) === "-")) {
    const month = Number(base.slice(0, 2)),
      day = Number(base.slice(base.length - 2));
    if (
      month >= 1 &&
      month <= 12 &&
      day >= 1 &&
      day <= daysInGregorianMonth(1972, month)
    )
      return true;
  }
  if (base.length === 6 || (base.length === 7 && base.charAt(4) === "-")) {
    const year = Number(base.slice(0, 4)),
      month = Number(base.slice(base.length - 2));
    if (Number.isInteger(year) && year >= 0 && month >= 1 && month <= 12)
      return true;
  }
  return false;
}
/** ISO time strings may include a full date. Bare ambiguous forms need a T prefix. */
export function parseISOTimeString(text: string): ISOTimeStringResult {
  let parsed = parseISODateTime(text),
    prefix = 0;
  if (parsed.error !== "none") {
    const explicit = text.startsWith("T") || text.startsWith("t");
    if (!explicit && ambiguous(text))
      return { error: "invalid", value: undefined, offset: 0 };
    prefix = explicit ? 10 : 11;
    parsed = parseISODateTime(
      "1972-01-01T" + (explicit ? text.slice(1) : text),
    );
  }
  const value = parsed.value;
  const offset = Math.max(0, parsed.offset - prefix);
  if (parsed.error !== "none" || value === undefined || !value.hasTime)
    return { error: "invalid", value: undefined, offset };
  return {
    error: "none",
    value: {
      hour: value.hour,
      minute: value.minute,
      second: value.second,
      nanosecond: value.nanosecond,
      utc: value.utc,
      offsetNanoseconds: value.offsetNanoseconds,
      timeZone: value.timeZone,
      calendar: value.calendar,
    },
    offset,
  };
}
