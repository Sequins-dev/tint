import {
  dateTimeCalendarEntries,
  dateTimeCalendarValue,
  type DateTimeCalendarProfile,
  type DateTimeCalendarEntry,
} from "./date-time-calendar.ts";
import {
  parseDateTimePattern,
  dateTimePatternFields,
  type DateTimePatternToken,
  type DateTimeFormatFields,
} from "./date-time-pattern.ts";
export interface ResolvedDateTimePattern {
  readonly tokens: readonly DateTimePatternToken[];
  readonly fields: DateTimeFormatFields;
  readonly skeleton: string;
}
function component(symbol: string): number {
  if (symbol === "y" || symbol === "u" || symbol === "r" || symbol === "U")
    return 0;
  if (symbol === "M" || symbol === "L") return 1;
  if (symbol === "d") return 2;
  if (symbol === "G") return 3;
  if (symbol === "E" || symbol === "e" || symbol === "c") return 4;
  if (symbol === "h" || symbol === "H" || symbol === "K" || symbol === "k")
    return 5;
  if (symbol === "m") return 6;
  if (symbol === "s") return 7;
  if (symbol === "B" || symbol === "b" || symbol === "a") return 8;
  if ("zvVOZXx".includes(symbol) && symbol !== "") return 9;
  if (symbol === "S") return 10;
  return -1;
}
function clock12(symbol: string): boolean {
  return symbol === "h" || symbol === "K";
}
function alphabetic(token: DateTimePatternToken): boolean {
  const field = component(token.symbol);
  return field === 1
    ? token.width >= 3
    : field === 3 ||
        field === 4 ||
        field === 8 ||
        field === 9 ||
        token.symbol === "U";
}
function fieldTokens(
  tokens: readonly DateTimePatternToken[],
): (DateTimePatternToken | undefined)[] {
  const result: (DateTimePatternToken | undefined)[] = [];
  for (let index = 0; index < 11; index++) result.push(undefined);
  for (let index = 0; index < tokens.length; index++) {
    const token: DateTimePatternToken | undefined = tokens[index];
    if (token === undefined) throw "DATE_TIME_SKELETON_TOKEN_INVARIANT";
    const field = component(token.symbol);
    if (field < 0) continue;
    // Cyclic year names accompany the numeric related year in Chinese patterns.
    if (token.symbol === "U" && result[field] !== undefined) continue;
    result[field] = token;
  }
  return result;
}
function token(symbol: string, width: number): DateTimePatternToken {
  return { symbol, width, literal: "" };
}
function literal(text: string): DateTimePatternToken {
  return { symbol: "", width: 0, literal: text };
}
/** Some locale patterns use LDML week-year Y for a calendar-year skeleton.
 * ECMA-402's year component is the calendar year from ToLocalTime. */
function calendarYearPattern(
  tokens: readonly DateTimePatternToken[],
): DateTimePatternToken[] {
  const result: DateTimePatternToken[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const item: DateTimePatternToken | undefined = tokens[index];
    if (item === undefined) throw "DATE_TIME_YEAR_PATTERN_INVARIANT";
    result.push(item.symbol === "Y" ? token("y", item.width) : item);
  }
  return result;
}
function descriptor(
  tokens: readonly DateTimePatternToken[],
): ResolvedDateTimePattern | undefined {
  const fields = dateTimePatternFields(tokens);
  if (fields === undefined) return undefined;
  const values = fieldTokens(tokens);
  let skeleton = "";
  for (let index = 0; index < values.length; index++) {
    const value: DateTimePatternToken | undefined = values[index];
    if (value === undefined) continue;
    if (value.symbol === "a" || value.symbol === "b") continue;
    skeleton += value.symbol.repeat(value.width);
  }
  return { tokens, fields, skeleton };
}
/** Glue patterns are LDML patterns, so quoted words and doubled apostrophes are
 * interpreted before inserting component patterns. Label text remains literal. */
export function combineDateTimePatterns(
  pattern: string,
  values: readonly (readonly DateTimePatternToken[])[],
  label: string | undefined,
): DateTimePatternToken[] | undefined {
  const parsed = parseDateTimePattern(pattern);
  if (parsed === undefined) return undefined;
  const result: DateTimePatternToken[] = [];
  for (let index = 0; index < parsed.length; index++) {
    const part: DateTimePatternToken | undefined = parsed[index];
    if (part === undefined) throw "DATE_TIME_GLUE_TOKEN_INVARIANT";
    if (part.symbol !== "") {
      result.push(part);
      continue;
    }
    let cursor = 0;
    while (cursor < part.literal.length) {
      const start = part.literal.indexOf("{", cursor);
      if (start < 0) {
        result.push(literal(part.literal.slice(cursor)));
        break;
      }
      if (start > cursor)
        result.push(literal(part.literal.slice(cursor, start)));
      const end = part.literal.indexOf("}", start + 1);
      if (end < 0) return undefined;
      const key = part.literal.slice(start + 1, end);
      if (key === "2") {
        if (label === undefined) return undefined;
        result.push(literal(label));
      } else {
        if (key !== "0" && key !== "1") return undefined;
        const inserted = values[Number(key)];
        if (inserted === undefined) return undefined;
        for (let offset = 0; offset < inserted.length; offset++) {
          const item: DateTimePatternToken | undefined = inserted[offset];
          if (item === undefined) throw "DATE_TIME_GLUE_VALUE_INVARIANT";
          result.push(item);
        }
      }
      cursor = end + 1;
    }
  }
  return result;
}
interface Candidate {
  readonly skeleton: readonly DateTimePatternToken[];
  readonly pattern: readonly DateTimePatternToken[];
}
function score(
  request: readonly (DateTimePatternToken | undefined)[],
  candidate: readonly (DateTimePatternToken | undefined)[],
): number | undefined {
  let matched = 0,
    priority = 0,
    distance = 0;
  for (let index = 0; index < 11; index++) {
    const want: DateTimePatternToken | undefined = request[index],
      have: DateTimePatternToken | undefined = candidate[index];
    if (have === undefined) continue;
    if (want === undefined) {
      return undefined;
    }
    if (index === 5 && clock12(want.symbol) !== clock12(have.symbol))
      return undefined;
    matched++;
    priority += Math.pow(2, 10 - index);
    distance +=
      Math.abs(want.width - have.width) +
      (alphabetic(want) !== alphabetic(have) ? 100 : 0) +
      (index === 9 && want.symbol !== have.symbol ? 20 : 0);
  }
  return matched === 0
    ? undefined
    : matched * 100000000 + priority * 10000 - distance;
}
function adjustPattern(
  source: readonly DateTimePatternToken[],
  original: readonly (DateTimePatternToken | undefined)[],
  request: readonly (DateTimePatternToken | undefined)[],
  decimal: string,
): DateTimePatternToken[] {
  const result: DateTimePatternToken[] = [];
  for (let index = 0; index < source.length; index++) {
    const item: DateTimePatternToken | undefined = source[index];
    if (item === undefined) throw "DATE_TIME_ADJUST_TOKEN_INVARIANT";
    const field = component(item.symbol),
      want: DateTimePatternToken | undefined = request[field],
      old: DateTimePatternToken | undefined = original[field];
    if (want === undefined || field < 0 || item.symbol === "U") {
      result.push(item);
      continue;
    }
    let symbol = item.symbol,
      width = item.width;
    if (field === 5) symbol = want.symbol;
    else if (field === 9) {
      symbol = want.symbol;
      width = want.width;
    } else if (field === 8) {
      symbol = want.symbol;
      width = want.width;
    } else if (field === 10) width = want.width;
    else if (
      old !== undefined &&
      old.width !== want.width &&
      alphabetic(old) === alphabetic(item)
    )
      width = want.width;
    // LDML gives time field padding priority to the locale's pattern.
    if (field === 5 || field === 6 || field === 7) width = item.width;
    result.push(token(symbol, width));
    const fraction: DateTimePatternToken | undefined = request[10];
    if (field === 7 && fraction !== undefined && original[10] === undefined) {
      result.push(literal(decimal));
      result.push(fraction);
    }
  }
  return result;
}
function appendRequest(field: number): string {
  if (field === 0) return "Year";
  if (field === 1) return "Month";
  if (field === 2) return "Day";
  if (field === 3) return "Era";
  if (field === 4) return "Day-Of-Week";
  if (field === 5) return "Hour";
  if (field === 6) return "Minute";
  if (field === 7) return "Second";
  if (field === 9) return "Timezone";
  throw "DATE_TIME_APPEND_FIELD_INVARIANT";
}
function selectPart(
  profile: DateTimeCalendarProfile,
  request: readonly (DateTimePatternToken | undefined)[],
  candidates: readonly Candidate[],
  decimal: string,
): DateTimePatternToken[] | undefined {
  let bestIndex = -1,
    bestScore = -Infinity,
    bestFields: readonly (DateTimePatternToken | undefined)[] = [];
  for (let index = 0; index < candidates.length; index++) {
    const candidate: Candidate | undefined = candidates[index];
    if (candidate === undefined) throw "DATE_TIME_CANDIDATE_INVARIANT";
    const fields = fieldTokens(candidate.skeleton),
      hour: DateTimePatternToken | undefined = fields[5];
    // A twelve-hour skeleton implicitly has 'a'; B may match and replace it.
    if (
      request[8] !== undefined &&
      fields[8] === undefined &&
      hour !== undefined &&
      clock12(hour.symbol)
    )
      fields[8] = token("a", 1);
    const value = score(request, fields);
    if (value !== undefined && value > bestScore) {
      bestScore = value;
      bestIndex = index;
      bestFields = fields;
    }
  }
  if (bestIndex < 0) return undefined;
  const best: Candidate | undefined = candidates[bestIndex];
  if (best === undefined) throw "DATE_TIME_BEST_CANDIDATE_INVARIANT";
  let result = adjustPattern(best.pattern, bestFields, request, decimal);
  const present = fieldTokens(result);
  for (let index = 0; index < 11; index++) {
    const missing: DateTimePatternToken | undefined = request[index];
    if (missing === undefined || present[index] !== undefined) continue;
    // Standalone period/fraction fields have implicit single-field patterns and
    // therefore cannot reach appendItems, which has no such field labels.
    if (index === 8 || index === 10) return undefined;
    const name = appendRequest(index),
      glue = dateTimeCalendarValue(profile, "appendItems", name),
      label = dateTimeCalendarValue(profile, "appendItems", "label." + name);
    if (glue === undefined) return undefined;
    const addition: DateTimePatternToken[] = [missing];
    const fraction: DateTimePatternToken | undefined = request[10];
    if (index === 7 && fraction !== undefined) {
      addition.push(literal(decimal));
      addition.push(fraction);
      present[10] = fraction;
    }
    const combined = combineDateTimePatterns(glue, [result, addition], label);
    if (combined === undefined) return undefined;
    result = combined;
  }
  return result;
}
/** CLDR matching considers field-set coverage before width distance. Date and
 * time fields are resolved independently, expanded, then joined by locale glue. */
export function resolveDateTimeSkeleton(
  profile: DateTimeCalendarProfile,
  skeleton: string,
  decimal: string,
): ResolvedDateTimePattern | undefined {
  const parsed = parseDateTimePattern(skeleton);
  if (
    parsed === undefined ||
    parsed.length === 0 ||
    dateTimePatternFields(parsed) === undefined
  )
    return undefined;
  const seen: number[] = [];
  for (let index = 0; index < parsed.length; index++) {
    const item: DateTimePatternToken | undefined = parsed[index];
    if (item === undefined || item.symbol === "") return undefined;
    const field = component(item.symbol);
    if (field < 0 || seen.includes(field)) return undefined;
    seen.push(field);
  }
  const requested = fieldTokens(parsed),
    hour: DateTimePatternToken | undefined = requested[5];
  if (hour !== undefined && !clock12(hour.symbol)) requested[8] = undefined;
  const candidates: Candidate[] = [];
  let hasYearPattern = false,
    allYearsHaveEra = true;
  const entries = dateTimeCalendarEntries(profile, "patterns");
  for (let index = 0; index < entries.length; index++) {
    const entry: DateTimeCalendarEntry | undefined = entries[index];
    if (entry === undefined) throw "DATE_TIME_SKELETON_ENTRY_INVARIANT";
    const key = parseDateTimePattern(entry.key),
      pattern = parseDateTimePattern(entry.value);
    if (key === undefined || pattern === undefined) return undefined;
    const normalized = calendarYearPattern(pattern);
    const fields = fieldTokens(normalized);
    if (fields[0] !== undefined) {
      hasYearPattern = true;
      if (fields[3] === undefined) allYearsHaveEra = false;
    }
    candidates.push({ skeleton: key, pattern: normalized });
  }
  if (
    requested[0] !== undefined &&
    requested[3] === undefined &&
    hasYearPattern &&
    allYearsHaveEra
  )
    requested[3] = token("G", 3);
  // LDML pattern generators also have single-field formats, including standalone
  // day periods and fractional seconds absent from availableFormats.
  for (let index = 0; index < requested.length; index++) {
    const item: DateTimePatternToken | undefined = requested[index];
    if (item === undefined) continue;
    candidates.push({ skeleton: [item], pattern: [item] });
  }
  const date: (DateTimePatternToken | undefined)[] = [],
    time: (DateTimePatternToken | undefined)[] = [];
  let hasDate = false,
    hasTime = false;
  for (let index = 0; index < 11; index++) {
    const item: DateTimePatternToken | undefined = requested[index];
    date.push(index < 5 ? item : undefined);
    time.push(index >= 5 ? item : undefined);
    if (item !== undefined) {
      if (index < 5) hasDate = true;
      else hasTime = true;
    }
  }
  const datePattern = hasDate
      ? selectPart(profile, date, candidates, decimal)
      : undefined,
    timePattern = hasTime
      ? selectPart(profile, time, candidates, decimal)
      : undefined;
  if (
    (hasDate && datePattern === undefined) ||
    (hasTime && timePattern === undefined)
  )
    return undefined;
  if (datePattern === undefined)
    return timePattern === undefined ? undefined : descriptor(timePattern);
  if (timePattern === undefined) return descriptor(datePattern);
  let glue: string | undefined;
  if (
    requested[9] !== undefined &&
    !hasFields(requested, 5, 9) &&
    requested[10] === undefined
  ) {
    glue = dateTimeCalendarValue(profile, "appendItems", "Date-Timezone");
    if (glue === undefined) return undefined;
    const joined = combineDateTimePatterns(
      glue,
      [datePattern, timePattern],
      undefined,
    );
    return joined === undefined ? undefined : descriptor(joined);
  } else if (requested[4] !== undefined && !hasFields(requested, 0, 4)) {
    glue = dateTimeCalendarValue(profile, "appendItems", "Time-Day-Of-Week");
    if (glue === undefined) return undefined;
    const joined = combineDateTimePatterns(
      glue,
      [timePattern, datePattern],
      undefined,
    );
    return joined === undefined ? undefined : descriptor(joined);
  } else {
    const month: DateTimePatternToken | undefined = requested[1];
    const style =
      month !== undefined && month.width >= 4
        ? requested[4] !== undefined
          ? "full"
          : "long"
        : month !== undefined && month.width === 3
          ? "medium"
          : "short";
    glue = dateTimeCalendarValue(profile, "styles", "C." + style);
  }
  if (glue === undefined) return undefined;
  const joined = combineDateTimePatterns(
    glue,
    [timePattern, datePattern],
    undefined,
  );
  return joined === undefined ? undefined : descriptor(joined);
}
function hasFields(
  fields: readonly (DateTimePatternToken | undefined)[],
  start: number,
  end: number,
): boolean {
  for (let index = start; index < end; index++)
    if (fields[index] !== undefined) return true;
  return false;
}
function hourSymbol(cycle: string): string {
  return cycle === "h11"
    ? "K"
    : cycle === "h12"
      ? "h"
      : cycle === "h23"
        ? "H"
        : cycle === "h24"
          ? "k"
          : "";
}
export function resolveDateTimeStylePattern(
  profile: DateTimeCalendarProfile,
  dateStyle: string | undefined,
  timeStyle: string | undefined,
  hourCycle: string,
): ResolvedDateTimePattern | undefined {
  if (dateStyle === undefined && timeStyle === undefined) return undefined;
  const dateSource =
      dateStyle === undefined
        ? undefined
        : dateTimeCalendarValue(profile, "styles", "D." + dateStyle),
    timeSource =
      timeStyle === undefined
        ? undefined
        : dateTimeCalendarValue(profile, "styles", "T." + timeStyle);
  if (
    (dateStyle !== undefined && dateSource === undefined) ||
    (timeStyle !== undefined && timeSource === undefined)
  )
    return undefined;
  const parsedDate =
    dateSource === undefined ? undefined : parseDateTimePattern(dateSource);
  const date =
    parsedDate === undefined ? undefined : calendarYearPattern(parsedDate);
  let time =
    timeSource === undefined ? undefined : parseDateTimePattern(timeSource);
  if (time !== undefined) {
    const target = hourSymbol(hourCycle);
    if (target === "") return undefined;
    const fields = fieldTokens(time),
      current: DateTimePatternToken | undefined = fields[5];
    if (current !== undefined && clock12(current.symbol) !== clock12(target)) {
      let skeleton = "";
      for (let index = 5; index < fields.length; index++) {
        const item: DateTimePatternToken | undefined = fields[index];
        if (item === undefined || index === 8) continue;
        skeleton += (index === 5 ? target : item.symbol).repeat(item.width);
      }
      const resolved = resolveDateTimeSkeleton(profile, skeleton, ".");
      if (resolved === undefined) return undefined;
      time = [...resolved.tokens];
    } else {
      const changed: DateTimePatternToken[] = [];
      for (let index = 0; index < time.length; index++) {
        const item: DateTimePatternToken | undefined = time[index];
        if (item === undefined) throw "DATE_TIME_STYLE_TOKEN_INVARIANT";
        changed.push(
          component(item.symbol) === 5 ? token(target, item.width) : item,
        );
      }
      time = changed;
    }
  }
  if (date === undefined)
    return time === undefined ? undefined : descriptor(time);
  if (time === undefined) return descriptor(date);
  const glue =
    dateTimeCalendarValue(profile, "styles", "A." + dateStyle) ??
    dateTimeCalendarValue(profile, "styles", "C." + dateStyle);
  if (glue === undefined) return undefined;
  const joined = combineDateTimePatterns(glue, [time, date], undefined);
  return joined === undefined ? undefined : descriptor(joined);
}
