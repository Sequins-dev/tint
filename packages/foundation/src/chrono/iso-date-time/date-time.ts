import { createScanner, type TextScanner } from "../../text/text-scanner.ts";
import {
  daysInGregorianMonth,
  type GregorianDate,
} from "../gregorian-calendar/index.ts";

export interface ISOTime {
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  /** Fraction of a second on the integer nanosecond grid. */
  readonly nanosecond: number;
}
export interface ISODateTime extends ISOTime {
  readonly date: GregorianDate;
  readonly hasTime: boolean;
  readonly utc: boolean;
  readonly offsetNanoseconds: number | undefined;
  readonly timeZone: string | undefined;
  readonly calendar: string | undefined;
}
export interface ISODateTimeResult {
  readonly error: "none" | "invalid";
  readonly value: ISODateTime | undefined;
  readonly offset: number;
  /** Distinguishes minute matching from an explicitly exact string offset. */
  readonly offsetHasSeconds: boolean;
}
function digit(code: number): boolean {
  return code >= 48 && code <= 57;
}
function digits(scanner: TextScanner, count: number): number {
  let value = 0;
  for (let i = 0; i < count; i++) {
    const code = scanner.peekCode();
    if (!digit(code)) return -1;
    value = value * 10 + code - 48;
    scanner.advance();
  }
  return value;
}
interface ParsedClock extends ISOTime {
  readonly hasSeconds: boolean;
}
function clock(scanner: TextScanner, offset: boolean): ParsedClock | undefined {
  const hour = digits(scanner, 2);
  if (hour < 0 || hour > 23) return undefined;
  let minute = 0,
    second = 0,
    nanosecond = 0,
    hasSeconds = false;
  const colon = scanner.match(":");
  if (colon || digit(scanner.peekCode())) {
    minute = digits(scanner, 2);
    if (minute < 0 || minute > 59) return undefined;
    if (colon ? scanner.match(":") : digit(scanner.peekCode())) {
      second = digits(scanner, 2);
      hasSeconds = true;
      if (second < 0 || second > (offset ? 59 : 60)) return undefined;
    }
  }
  if (scanner.match(".") || scanner.match(",")) {
    if (!hasSeconds) return undefined;
    let count = 0;
    while (digit(scanner.peekCode())) {
      if (count === 9) return undefined;
      nanosecond = nanosecond * 10 + scanner.peekCode() - 48;
      scanner.advance();
      count++;
    }
    if (count === 0) return undefined;
    for (let i = count; i < 9; i++) nanosecond *= 10;
  }
  return { hour, minute, second: Math.min(second, 59), nanosecond, hasSeconds };
}
function annotationKey(text: string): boolean {
  if (text.length === 0) return false;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if ((code >= 97 && code <= 122) || code === 95) continue;
    if (i > 0 && (digit(code) || code === 45)) continue;
    return false;
  }
  return true;
}
function annotationValue(text: string): boolean {
  if (text.length === 0) return false;
  let separator = true;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 45) {
      if (separator) return false;
      separator = true;
    } else if (
      digit(code) ||
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122)
    )
      separator = false;
    else return false;
  }
  return !separator;
}
export function isISOTimeZoneIdentifier(text: string): boolean {
  if (text === "Z" || text === "z") return false;
  if (text.charAt(0) === "+" || text.charAt(0) === "-") {
    if (text.length !== 3 && text.length !== 5 && text.length !== 6)
      return false;
    const scanner = createScanner(text.slice(1)),
      value = clock(scanner, true);
    return value !== undefined && scanner.done();
  }
  if (text.length === 0) return false;
  let start = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text.charAt(i) === "/") {
      const part = text.slice(start, i);
      if (part.length === 0 || part === "." || part === "..") return false;
      start = i + 1;
      continue;
    }
    const code = text.charCodeAt(i);
    if (
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      code === 46 ||
      code === 95 ||
      code === 45 ||
      code === 43
    )
      continue;
    if (i > start && digit(code)) continue;
    return false;
  }
  return true;
}
/** Parse a full ISO calendar date with optional time, UTC offset and annotations.
 * Calendar/zone availability and API-specific UTC/range restrictions belong to adapters. */
export function parseISODateTime(text: string): ISODateTimeResult {
  const scanner = createScanner(text);
  function invalid(): ISODateTimeResult {
    return {
      error: "invalid",
      value: undefined,
      offset: scanner.offset(),
      offsetHasSeconds: false,
    };
  }
  let sign = 1,
    extended = false;
  if (scanner.match("+")) extended = true;
  else if (scanner.match("-")) {
    extended = true;
    sign = -1;
  }
  const magnitude = digits(scanner, extended ? 6 : 4);
  if (magnitude < 0 || (extended && sign < 0 && magnitude === 0))
    return invalid();
  const year = sign * magnitude,
    hyphen = scanner.match("-");
  const month = digits(scanner, 2);
  if (hyphen && !scanner.match("-")) return invalid();
  const day = digits(scanner, 2),
    length = daysInGregorianMonth(year, month);
  if (length === 0 || day < 1 || day > length) return invalid();
  let hasTime = false,
    hour = 0,
    minute = 0,
    second = 0,
    nanosecond = 0,
    utc = false;
  let offsetNanoseconds: number | undefined = undefined;
  let offsetHasSeconds = false;
  if (scanner.match("T") || scanner.match("t") || scanner.match(" ")) {
    hasTime = true;
    const time = clock(scanner, false);
    if (time === undefined) return invalid();
    hour = time.hour;
    minute = time.minute;
    second = time.second;
    nanosecond = time.nanosecond;
    if (scanner.match("Z") || scanner.match("z")) utc = true;
    else if (scanner.peekCode() === 43 || scanner.peekCode() === 45) {
      const negative = scanner.match("-");
      if (!negative) scanner.match("+");
      const offset = clock(scanner, true);
      if (offset === undefined) return invalid();
      offsetHasSeconds = offset.hasSeconds;
      offsetNanoseconds =
        ((offset.hour * 60 + offset.minute) * 60 + offset.second) * 1000000000 +
        offset.nanosecond;
      if (negative) offsetNanoseconds = -offsetNanoseconds;
    }
  }
  let calendar: string | undefined = undefined,
    timeZone: string | undefined = undefined;
  let calendarCritical = false,
    annotations = false;
  while (scanner.match("[")) {
    const critical = scanner.match("!");
    const body = scanner.eatWhile(
      (code): boolean =>
        code >= 33 && code <= 126 && code !== 91 && code !== 93,
    );
    if (!scanner.match("]")) return invalid();
    const equals = body.indexOf("=");
    if (equals < 0) {
      if (
        timeZone !== undefined ||
        annotations ||
        !isISOTimeZoneIdentifier(body)
      )
        return invalid();
      timeZone = body;
    } else {
      annotations = true;
      const key = body.slice(0, equals),
        value = body.slice(equals + 1);
      if (!annotationKey(key) || !annotationValue(value)) return invalid();
      if (key === "u-ca") {
        if (calendar !== undefined) {
          if (critical || calendarCritical) return invalid();
        } else {
          calendar = value;
          calendarCritical = critical;
        }
      } else if (critical) return invalid();
    }
  }
  if (!scanner.done()) return invalid();
  return {
    error: "none",
    offsetHasSeconds,
    value: {
      date: { year, month, day },
      hasTime,
      hour,
      minute,
      second,
      nanosecond,
      utc,
      offsetNanoseconds,
      timeZone,
      calendar,
    },
    offset: scanner.offset(),
  };
}

/** Format a valid full ISO date; domain/range policy remains with callers. */
export function formatISODate(date: GregorianDate): string {
  const length = daysInGregorianMonth(date.year, date.month);
  if (
    length === 0 ||
    date.day < 1 ||
    date.day > length ||
    Math.floor(date.day) !== date.day ||
    Math.abs(date.year) > 999999
  )
    throw "INVALID_ISO_DATE";
  const year = date.year;
  return (
    (year >= 0 && year <= 9999
      ? String(year).padStart(4, "0")
      : (year < 0 ? "-" : "+") + String(Math.abs(year)).padStart(6, "0")) +
    "-" +
    String(date.month).padStart(2, "0") +
    "-" +
    String(date.day).padStart(2, "0")
  );
}
/** Default second-precision layout with an exact, trailing-zero-trimmed fraction. */
export function formatISOTime(time: ISOTime): string {
  if (
    !Number.isInteger(time.hour) ||
    time.hour < 0 ||
    time.hour > 23 ||
    !Number.isInteger(time.minute) ||
    time.minute < 0 ||
    time.minute > 59 ||
    !Number.isInteger(time.second) ||
    time.second < 0 ||
    time.second > 59 ||
    !Number.isInteger(time.nanosecond) ||
    time.nanosecond < 0 ||
    time.nanosecond >= 1000000000
  )
    throw "INVALID_ISO_TIME";
  let text =
    String(time.hour).padStart(2, "0") +
    ":" +
    String(time.minute).padStart(2, "0") +
    ":" +
    String(time.second).padStart(2, "0");
  if (time.nanosecond !== 0) {
    let fraction = String(time.nanosecond).padStart(9, "0");
    while (fraction.endsWith("0")) fraction = fraction.slice(0, -1);
    text += "." + fraction;
  }
  return text;
}

/** Format an already-rounded clock: -2 minute precision, -1 automatic, or 0..9 digits. */
export function formatISOTimePrecision(time: ISOTime, digits: number): string {
  if (!Number.isInteger(digits) || digits < -2 || digits > 9)
    throw "INVALID_ISO_PRECISION";
  const automatic = formatISOTime(time);
  if (digits === -1) return automatic;
  if (digits === -2) return automatic.slice(0, 5);
  const seconds = automatic.slice(0, 8);
  return digits === 0
    ? seconds
    : seconds + "." + String(time.nanosecond).padStart(9, "0").slice(0, digits);
}
