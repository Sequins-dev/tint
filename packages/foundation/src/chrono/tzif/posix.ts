import { createScanner } from "../../text/text-scanner.ts";
export type PosixDateRule =
  | { readonly kind: "julian"; readonly day: number }
  | { readonly kind: "ordinal"; readonly day: number }
  | {
      readonly kind: "month-week-day";
      readonly month: number;
      readonly week: number;
      readonly weekday: number;
    };
export interface PosixTransitionRule {
  readonly date: PosixDateRule;
  readonly seconds: number;
}
export type PosixTimeZone =
  | {
      readonly kind: "fixed";
      readonly name: string;
      readonly offsetSeconds: number;
    }
  | {
      readonly kind: "alternating";
      readonly standardName: string;
      readonly standardOffsetSeconds: number;
      readonly daylightName: string;
      readonly daylightOffsetSeconds: number;
      readonly start: PosixTransitionRule;
      readonly end: PosixTransitionRule;
    };
export type PosixTimeZoneResult =
  | { readonly ok: true; readonly value: PosixTimeZone }
  | {
      readonly ok: false;
      readonly error: "INVALID_POSIX_TZ" | "DEFAULT_RULES_UNSUPPORTED";
    };
function letter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}
function digit(code: number): boolean {
  return code >= 48 && code <= 57;
}
/** Parse portable POSIX TZ syntax, with the signed 167-hour transition extension
 * only when explicitly authorized by the enclosing TZif version. No host defaults. */
export function readPosixTimeZone(
  text: string,
  extendedTimes: boolean = false,
): PosixTimeZoneResult {
  const scanner = createScanner(text);
  function invalid(): PosixTimeZoneResult {
    return { ok: false, error: "INVALID_POSIX_TZ" };
  }
  function name(): string | undefined {
    const quoted = scanner.match("<");
    const text = scanner.eatWhile(
      (code): boolean =>
        letter(code) || (quoted && (digit(code) || code === 43 || code === 45)),
    );
    if (text.length < 3 || (quoted && !scanner.match(">"))) return undefined;
    return text;
  }
  function unsigned(maxDigits: number, maximum: number): number | undefined {
    const text = scanner.eatWhile(digit);
    if (text.length === 0 || text.length > maxDigits) return undefined;
    let value = 0;
    for (let index = 0; index < text.length; index++)
      value = value * 10 + text.charCodeAt(index) - 48;
    return value > maximum ? undefined : value;
  }
  function clock(signed: boolean, maxHours: number): number | undefined {
    let sign = 1;
    if (scanner.peekCode() === 43 || scanner.peekCode() === 45) {
      if (!signed) return undefined;
      if (scanner.match("-")) sign = -1;
      else scanner.advance();
    }
    const hour = unsigned(maxHours > 99 ? 3 : 2, maxHours);
    if (hour === undefined) return undefined;
    let minute = 0,
      second = 0;
    if (scanner.match(":")) {
      const value = unsigned(2, 59);
      if (value === undefined) return undefined;
      minute = value;
      if (scanner.match(":")) {
        const value = unsigned(2, 59);
        if (value === undefined) return undefined;
        second = value;
      }
    }
    return sign * (hour * 3600 + minute * 60 + second) + 0;
  }
  function dateRule(): PosixDateRule | undefined {
    if (scanner.match("M")) {
      const month = unsigned(2, 12);
      if (month === undefined || month < 1 || !scanner.match("."))
        return undefined;
      const week = unsigned(1, 5);
      if (week === undefined || week < 1 || !scanner.match("."))
        return undefined;
      const weekday = unsigned(1, 6);
      if (weekday === undefined) return undefined;
      return { kind: "month-week-day", month, week, weekday };
    }
    const julian = scanner.match("J"),
      day = unsigned(3, 365);
    if (day === undefined || (julian && day < 1)) return undefined;
    return julian ? { kind: "julian", day } : { kind: "ordinal", day };
  }
  function rule(): PosixTransitionRule | undefined {
    const date = dateRule();
    if (date === undefined) return undefined;
    const seconds = scanner.match("/")
      ? clock(extendedTimes, extendedTimes ? 167 : 24)
      : 7200;
    return seconds === undefined ? undefined : { date, seconds };
  }
  const standardName = name();
  if (standardName === undefined) return invalid();
  const rawStandard = clock(true, 24);
  if (rawStandard === undefined) return invalid();
  const standardOffsetSeconds = -rawStandard + 0;
  if (scanner.done())
    return {
      ok: true,
      value: {
        kind: "fixed",
        name: standardName,
        offsetSeconds: standardOffsetSeconds,
      },
    };
  const daylightName = name();
  if (daylightName === undefined) return invalid();
  let daylightOffsetSeconds = standardOffsetSeconds + 3600;
  if (scanner.peekCode() !== 44 && !scanner.done()) {
    const raw = clock(true, 24);
    if (raw === undefined) return invalid();
    daylightOffsetSeconds = -raw + 0;
  }
  if (scanner.done()) return { ok: false, error: "DEFAULT_RULES_UNSUPPORTED" };
  if (!scanner.match(",")) return invalid();
  const start = rule();
  if (start === undefined || !scanner.match(",")) return invalid();
  const end = rule();
  if (end === undefined || !scanner.done()) return invalid();
  return {
    ok: true,
    value: {
      kind: "alternating",
      standardName,
      standardOffsetSeconds,
      daylightName,
      daylightOffsetSeconds,
      start,
      end,
    },
  };
}
