/** LDML pattern syntax and ECMA-402 BasicFormatMatcher, independent of host Intl. */
export interface DateTimePatternToken {
  readonly literal: string;
  readonly symbol: string;
  readonly width: number;
}
export interface DateTimeFormatFields {
  weekday: string | undefined;
  era: string | undefined;
  year: string | undefined;
  month: string | undefined;
  day: string | undefined;
  dayPeriod: string | undefined;
  hour: string | undefined;
  minute: string | undefined;
  second: string | undefined;
  fractionalSecondDigits: number | undefined;
  timeZoneName: string | undefined;
}
export interface DateTimePatternFormat {
  readonly pattern: string;
  readonly fields: DateTimeFormatFields;
}
export function parseDateTimePattern(
  pattern: string,
): DateTimePatternToken[] | undefined {
  const tokens: DateTimePatternToken[] = [];
  let literal = "",
    quoted = false,
    index = 0;
  while (index < pattern.length) {
    const symbol = pattern.charAt(index),
      code = pattern.charCodeAt(index);
    if (symbol === "'") {
      if (pattern.charAt(index + 1) === "'") {
        literal += "'";
        index += 2;
      } else {
        quoted = !quoted;
        index++;
      }
    } else if (
      !quoted &&
      ((code >= 65 && code <= 90) || (code >= 97 && code <= 122))
    ) {
      if (literal !== "") {
        tokens.push({ literal, symbol: "", width: 0 });
        literal = "";
      }
      let end = index + 1;
      while (end < pattern.length && pattern.charAt(end) === symbol) end++;
      tokens.push({ literal: "", symbol, width: end - index });
      index = end;
    } else {
      literal += symbol;
      index++;
    }
  }
  if (quoted) return undefined;
  if (literal !== "") tokens.push({ literal, symbol: "", width: 0 });
  return tokens;
}
function textWidth(width: number): string {
  return width >= 5 ? "narrow" : width === 4 ? "long" : "short";
}
function numericWidth(width: number): string {
  return width === 2 ? "2-digit" : "numeric";
}
export function dateTimePatternFields(
  tokens: readonly DateTimePatternToken[],
): DateTimeFormatFields | undefined {
  const fields: DateTimeFormatFields = {
    weekday: undefined,
    era: undefined,
    year: undefined,
    month: undefined,
    day: undefined,
    dayPeriod: undefined,
    hour: undefined,
    minute: undefined,
    second: undefined,
    fractionalSecondDigits: undefined,
    timeZoneName: undefined,
  };
  for (let index = 0; index < tokens.length; index++) {
    const token: DateTimePatternToken | undefined = tokens[index];
    if (token === undefined) throw "DATE_TIME_PATTERN_TOKEN_INVARIANT";
    const symbol = token.symbol,
      width = token.width;
    if (symbol === "") continue;
    if (width < 1 || !Number.isInteger(width)) return undefined;
    if (symbol === "G") fields.era = textWidth(width);
    else if (symbol === "y" || symbol === "u" || symbol === "r")
      fields.year = numericWidth(width);
    else if (symbol === "U") fields.year = "numeric";
    else if (symbol === "M" || symbol === "L")
      fields.month = width < 3 ? numericWidth(width) : textWidth(width);
    else if (symbol === "d") fields.day = numericWidth(width);
    else if (symbol === "E" || symbol === "e" || symbol === "c") {
      if (symbol !== "E" && width < 3) return undefined;
      fields.weekday = textWidth(width === 6 ? 3 : width);
    } else if (symbol === "B") fields.dayPeriod = textWidth(width);
    // AM/PM belongs to the twelve-hour pattern, not the flexible dayPeriod option.
    else if (symbol === "a" || symbol === "b") continue;
    else if (
      symbol === "h" ||
      symbol === "H" ||
      symbol === "K" ||
      symbol === "k"
    )
      fields.hour = numericWidth(width);
    else if (symbol === "m") fields.minute = numericWidth(width);
    else if (symbol === "s") fields.second = numericWidth(width);
    else if (symbol === "S") {
      if (width > 3) return undefined;
      fields.fractionalSecondDigits = width;
    } else if (symbol === "z")
      fields.timeZoneName = width >= 4 ? "long" : "short";
    else if (symbol === "v" || symbol === "V")
      fields.timeZoneName = width >= 4 ? "longGeneric" : "shortGeneric";
    else if (
      symbol === "O" ||
      symbol === "Z" ||
      symbol === "X" ||
      symbol === "x"
    )
      fields.timeZoneName = width >= 4 ? "longOffset" : "shortOffset";
    else return undefined;
  }
  return fields;
}
function componentValue(
  fields: DateTimeFormatFields,
  name: string,
): string | undefined {
  if (name === "weekday") return fields.weekday;
  if (name === "era") return fields.era;
  if (name === "year") return fields.year;
  if (name === "month") return fields.month;
  if (name === "day") return fields.day;
  if (name === "dayPeriod") return fields.dayPeriod;
  if (name === "hour") return fields.hour;
  if (name === "minute") return fields.minute;
  if (name === "second") return fields.second;
  if (name === "fractionalSecondDigits")
    return fields.fractionalSecondDigits === undefined
      ? undefined
      : String(fields.fractionalSecondDigits);
  if (name === "timeZoneName") return fields.timeZoneName;
  throw "DATE_TIME_COMPONENT_INVARIANT";
}
function zonePenalty(requested: string, offered: string): number {
  if (requested === offered) return 0;
  if (requested === "short" || requested === "shortGeneric") {
    if (offered === "shortOffset") return 1;
    if (offered === "longOffset") return 4;
    if (
      (requested === "short" && offered === "long") ||
      (requested === "shortGeneric" && offered === "longGeneric")
    )
      return 3;
  } else if (requested === "long" || requested === "longGeneric") {
    if (offered === "longOffset") return 1;
    if (offered === "shortOffset") return 9;
    if (
      (requested === "long" && offered === "short") ||
      (requested === "longGeneric" && offered === "shortGeneric")
    )
      return 8;
  } else if (requested === "shortOffset" && offered === "longOffset") return 3;
  else if (requested === "longOffset" && offered === "shortOffset") return 8;
  return 120;
}
export function basicDateTimeFormatScore(
  requested: DateTimeFormatFields,
  offered: DateTimeFormatFields,
): number {
  let score = 0;
  // Table 16 order also supplies the stable tie policy used by the selector.
  for (const name of [
    "weekday",
    "era",
    "year",
    "month",
    "day",
    "dayPeriod",
    "hour",
    "minute",
    "second",
    "fractionalSecondDigits",
    "timeZoneName",
  ]) {
    const want = componentValue(requested, name),
      have = componentValue(offered, name);
    if (want === have) continue;
    if (want === undefined) score -= 20;
    else if (have === undefined) score -= 120;
    else if (name === "timeZoneName") score -= zonePenalty(want, have);
    else {
      const values =
        name === "fractionalSecondDigits"
          ? ["1", "2", "3"]
          : ["2-digit", "numeric", "narrow", "short", "long"];
      const wanted = values.indexOf(want),
        found = values.indexOf(have);
      if (wanted < 0 || found < 0) throw "DATE_TIME_WIDTH_INVARIANT";
      const delta = Math.max(-2, Math.min(found - wanted, 2));
      score -=
        delta === 2
          ? 6
          : delta === 1
            ? 3
            : delta === -1
              ? 6
              : delta === -2
                ? 8
                : 0;
    }
  }
  return score;
}
export function selectBasicDateTimeFormat(
  requested: DateTimeFormatFields,
  formats: readonly DateTimePatternFormat[],
): DateTimePatternFormat | undefined {
  let best: DateTimePatternFormat | undefined,
    score = -Infinity;
  for (let index = 0; index < formats.length; index++) {
    const format: DateTimePatternFormat | undefined = formats[index];
    if (format === undefined) throw "DATE_TIME_FORMAT_RECORD_INVARIANT";
    const candidate = basicDateTimeFormatScore(requested, format.fields);
    if (candidate > score) {
      best = format;
      score = candidate;
    }
  }
  return best;
}
function intervalField(symbol: string): string {
  if (symbol === "M" || symbol === "L") return "month";
  if (symbol === "G") return "era";
  if (symbol === "y" || symbol === "u") return "year";
  if (symbol === "U") return "yearName";
  if (symbol === "r") return "relatedYear";
  if (symbol === "d") return "day";
  if (symbol === "E" || symbol === "e" || symbol === "c") return "weekday";
  if (symbol === "a" || symbol === "b" || symbol === "B") return "dayPeriod";
  if (symbol === "H" || symbol === "h" || symbol === "K" || symbol === "k")
    return "hour";
  if (symbol === "m") return "minute";
  if (symbol === "s") return "second";
  if (symbol === "S") return "fractionalSecond";
  if (
    symbol === "z" ||
    symbol === "v" ||
    symbol === "V" ||
    symbol === "O" ||
    symbol === "Z" ||
    symbol === "X" ||
    symbol === "x"
  )
    return "timeZoneName";
  return symbol;
}
export interface DateTimeIntervalPattern {
  readonly first: readonly DateTimePatternToken[];
  readonly second: readonly DateTimePatternToken[];
  readonly field: string;
}
/** CLDR interval patterns start the second endpoint at the first repeated field. */
export function splitDateTimeIntervalPattern(
  tokens: readonly DateTimePatternToken[],
): DateTimeIntervalPattern | undefined {
  const seen: string[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const token: DateTimePatternToken | undefined = tokens[index];
    if (token === undefined) throw "DATE_TIME_PATTERN_TOKEN_INVARIANT";
    if (token.symbol === "") continue;
    const field = intervalField(token.symbol);
    if (seen.includes(field))
      return {
        first: tokens.slice(0, index),
        second: tokens.slice(index),
        field,
      };
    seen.push(field);
  }
  return undefined;
}
