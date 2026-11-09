import type {
  DateTimeRangeToken as RangeToken,
  DateTimeTemplateChunk as TemplateChunk,
} from "./date-time-service-contracts.ts";
import type { DateTimeRangePart } from "./date-time-service-contracts.ts";
export type { DateTimeRangePart } from "./date-time-service-contracts.ts";
import { calendarFieldsFromISO, type CalendarDateFields } from "./calendar.ts";
import {
  dateTimeCalendarEntries,
  dateTimeCalendarValue,
  type DateTimeCalendarEntry,
} from "./date-time-calendar.ts";
import {
  dateTimePatternParts,
  type DateTimePartsFormatter,
  type DateTimeDisplayFields,
  type DateTimePart,
} from "./date-time-parts.ts";
import {
  adaptDateTimePatternTokens,
  type ResolvedDateTimePattern,
} from "./date-time-skeleton.ts";
import {
  parseDateTimePattern,
  dateTimePatternFields,
  dateTimePatternField,
  splitDateTimeIntervalPattern,
  basicDateTimeFormatScore,
  type DateTimePatternToken,
} from "./date-time-pattern.ts";

function literal(text: string): DateTimePatternToken {
  return { symbol: "", width: 0, literal: text };
}
function chunks(pattern: string): TemplateChunk[] | undefined {
  const result: TemplateChunk[] = [];
  let cursor = 0;
  while (cursor < pattern.length) {
    const start = pattern.indexOf("{", cursor);
    if (start < 0) {
      result.push({ slot: -1, literal: pattern.slice(cursor) });
      break;
    }
    if (start > cursor)
      result.push({ slot: -1, literal: pattern.slice(cursor, start) });
    const marker = pattern.slice(start, start + 3);
    if (marker !== "{0}" && marker !== "{1}") return undefined;
    result.push({ slot: marker === "{0}" ? 0 : 1, literal: "" });
    cursor = start + 3;
  }
  return result;
}
function append(
  result: DateTimeRangePart[],
  part: DateTimePart,
  source: string,
): void {
  if (part.value === "") return;
  const last: DateTimeRangePart | undefined = result[result.length - 1];
  if (
    part.type === "literal" &&
    last !== undefined &&
    last.type === "literal" &&
    last.source === source
  )
    result[result.length - 1] = {
      type: "literal",
      value: last.value + part.value,
      source,
    };
  else result.push({ type: part.type, value: part.value, source });
}
function tagged(
  tokens: readonly DateTimePatternToken[],
  source: string,
): RangeToken[] {
  const result: RangeToken[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const token: DateTimePatternToken | undefined = tokens[index];
    if (token === undefined) throw "DATE_TIME_RANGE_TOKEN_INVARIANT";
    result.push({ token, source });
  }
  return result;
}
function fallback(
  pattern: string,
  first: readonly DateTimePart[],
  last: readonly DateTimePart[],
): DateTimeRangePart[] | undefined {
  const template = chunks(pattern);
  if (template === undefined) return undefined;
  const result: DateTimeRangePart[] = [];
  for (let index = 0; index < template.length; index++) {
    const chunk: TemplateChunk | undefined = template[index];
    if (chunk === undefined) throw "DATE_TIME_RANGE_TEMPLATE_INVARIANT";
    if (chunk.slot < 0) {
      append(result, { type: "literal", value: chunk.literal }, "shared");
      continue;
    }
    const parts = chunk.slot === 0 ? first : last,
      source = chunk.slot === 0 ? "startRange" : "endRange";
    for (let offset = 0; offset < parts.length; offset++) {
      const part: DateTimePart | undefined = parts[offset];
      if (part === undefined) throw "DATE_TIME_RANGE_FALLBACK_PART_INVARIANT";
      append(result, part, source);
    }
  }
  return result;
}
function combine(
  pattern: string,
  values: readonly (readonly RangeToken[])[],
): RangeToken[] | undefined {
  const parsed = parseDateTimePattern(pattern);
  if (parsed === undefined) return undefined;
  let raw = "";
  for (let index = 0; index < parsed.length; index++) {
    const token: DateTimePatternToken | undefined = parsed[index];
    if (token === undefined) throw "DATE_TIME_RANGE_GLUE_INVARIANT";
    if (token.symbol !== "") return undefined;
    raw += token.literal;
  }
  return combineRaw(raw, values);
}
function combineRaw(
  pattern: string,
  values: readonly (readonly RangeToken[])[],
): RangeToken[] | undefined {
  const template = chunks(pattern);
  if (template === undefined) return undefined;
  const result: RangeToken[] = [];
  for (let index = 0; index < template.length; index++) {
    const chunk: TemplateChunk | undefined = template[index];
    if (chunk === undefined) throw "DATE_TIME_RANGE_GLUE_CHUNK_INVARIANT";
    if (chunk.slot < 0) {
      result.push({ token: literal(chunk.literal), source: "shared" });
      continue;
    }
    const inserted = values[chunk.slot];
    if (inserted === undefined) return undefined;
    for (let offset = 0; offset < inserted.length; offset++) {
      const item: RangeToken | undefined = inserted[offset];
      if (item === undefined) throw "DATE_TIME_RANGE_GLUE_VALUE_INVARIANT";
      result.push(item);
    }
  }
  return result;
}
function fieldBit(symbol: string): number {
  if (symbol === "" || symbol === "a" || symbol === "b") return 0;
  const field = dateTimePatternField(symbol);
  if (field === "era") return 1;
  if (field === "year" || field === "relatedYear" || field === "yearName")
    return 2;
  if (field === "month") return 4;
  if (field === "day") return 8;
  if (field === "weekday") return 16;
  if (field === "dayPeriod") return 32;
  if (field === "hour") return 64;
  if (field === "minute") return 128;
  if (field === "second") return 256;
  if (field === "fractionalSecond") return 512;
  if (field === "timeZoneName") return 1024;
  return 0;
}
function mask(tokens: readonly DateTimePatternToken[]): number {
  let value = 0;
  for (let index = 0; index < tokens.length; index++) {
    const item: DateTimePatternToken | undefined = tokens[index];
    if (item === undefined) throw "DATE_TIME_RANGE_MASK_INVARIANT";
    value |= fieldBit(item.symbol);
  }
  return value;
}
function hourFamily(tokens: readonly DateTimePatternToken[]): number {
  for (let index = 0; index < tokens.length; index++) {
    const item: DateTimePatternToken | undefined = tokens[index];
    if (item === undefined) throw "DATE_TIME_RANGE_HOUR_INVARIANT";
    if (item.symbol === "h" || item.symbol === "K") return 1;
    if (item.symbol === "H" || item.symbol === "k") return 0;
  }
  return -1;
}
function precision(tokens: readonly DateTimePatternToken[]): number {
  let rank = -1;
  for (let index = 0; index < tokens.length; index++) {
    const item: DateTimePatternToken | undefined = tokens[index];
    if (item === undefined) throw "DATE_TIME_RANGE_PRECISION_INVARIANT";
    const field = dateTimePatternField(item.symbol);
    const value =
      field === "era"
        ? 0
        : field === "year" || field === "relatedYear" || field === "yearName"
          ? 1
          : field === "month"
            ? 2
            : field === "day" || field === "weekday"
              ? 3
              : item.symbol === "a"
                ? 4
                : field === "dayPeriod"
                  ? 5
                  : field === "hour"
                    ? 6
                    : field === "minute"
                      ? 7
                      : field === "second"
                        ? 8
                        : field === "fractionalSecond"
                          ? 9
                          : -1;
    rank = Math.max(rank, value);
  }
  return rank < 0 ? 9 : rank;
}
function hasSymbol(
  tokens: readonly DateTimePatternToken[],
  symbol: string,
): boolean {
  for (let index = 0; index < tokens.length; index++) {
    const item: DateTimePatternToken | undefined = tokens[index];
    if (item === undefined) throw "DATE_TIME_RANGE_SYMBOL_INVARIANT";
    if (item.symbol === symbol) return true;
  }
  return false;
}
function partValue(
  parts: readonly DateTimePart[],
  type: string,
): string | undefined {
  for (let index = 0; index < parts.length; index++) {
    const part: DateTimePart | undefined = parts[index];
    if (part === undefined) throw "DATE_TIME_RANGE_PART_INVARIANT";
    if (part.type === type) return part.value;
  }
  return undefined;
}
function era(calendar: string, fields: CalendarDateFields): string {
  return calendar === "iso8601"
    ? fields.year > 0
      ? "ce"
      : "bce"
    : (fields.era ?? "");
}
function firstDifference(
  formatter: DateTimePartsFormatter,
  pattern: ResolvedDateTimePattern,
  first: DateTimeDisplayFields,
  last: DateTimeDisplayFields,
  firstParts: readonly DateTimePart[],
  lastParts: readonly DateTimePart[],
): number | undefined {
  const one = calendarFieldsFromISO(formatter.calendar.calendar, first.date),
    two = calendarFieldsFromISO(formatter.calendar.calendar, last.date);
  if (one === undefined || two === undefined) return undefined;
  const maximum = precision(pattern.tokens);
  if (
    era(formatter.calendar.calendar, one) !==
    era(formatter.calendar.calendar, two)
  )
    return 0;
  if (maximum >= 1 && one.year !== two.year) return 1;
  if (maximum >= 2 && one.month !== two.month) return 2;
  if (maximum >= 3 && one.day !== two.day) return 3;
  if (
    maximum >= 4 &&
    hasSymbol(pattern.tokens, "a") &&
    first.hour < 12 !== last.hour < 12
  )
    return 4;
  if (
    maximum >= 5 &&
    (hasSymbol(pattern.tokens, "B") || hasSymbol(pattern.tokens, "b")) &&
    partValue(firstParts, "dayPeriod") !== partValue(lastParts, "dayPeriod")
  )
    return 5;
  if (maximum >= 6 && first.hour !== last.hour) return 6;
  if (maximum >= 7 && first.minute !== last.minute) return 7;
  if (maximum >= 8 && first.second !== last.second) return 8;
  if (maximum >= 9) {
    const digits = pattern.fields.fractionalSecondDigits ?? 3,
      divisor = digits === 1 ? 100 : digits === 2 ? 10 : 1;
    if (
      Math.floor(first.millisecond / divisor) !==
      Math.floor(last.millisecond / divisor)
    )
      return 9;
  }
  return -1;
}
function equalParts(
  first: readonly DateTimePart[],
  last: readonly DateTimePart[],
): boolean {
  if (first.length !== last.length) return false;
  for (let index = 0; index < first.length; index++) {
    const one: DateTimePart | undefined = first[index],
      two: DateTimePart | undefined = last[index];
    if (one === undefined || two === undefined)
      throw "DATE_TIME_RANGE_EQUAL_PART_INVARIANT";
    if (one.type !== two.type || one.value !== two.value) return false;
  }
  return true;
}
function intervalTokens(
  formatter: DateTimePartsFormatter,
  tokens: readonly DateTimePatternToken[],
  first: DateTimeDisplayFields,
  last: DateTimeDisplayFields,
  firstZone: string | undefined,
  lastZone: string | undefined,
  firstIsEnd: boolean,
): RangeToken[] | undefined {
  const split = splitDateTimeIntervalPattern(tokens);
  if (split === undefined) return undefined;
  const left: string[] = [],
    right: string[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const item: DateTimePatternToken | undefined = tokens[index];
    if (item === undefined) throw "DATE_TIME_RANGE_INTERVAL_TOKEN_INVARIANT";
    if (item.symbol === "") continue;
    const fields = index < split.first.length ? left : right,
      name = dateTimePatternField(item.symbol);
    if (!fields.includes(name)) fields.push(name);
  }
  const sources: (string | undefined)[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const item: DateTimePatternToken | undefined = tokens[index];
    if (item === undefined) throw "DATE_TIME_RANGE_INTERVAL_SOURCE_INVARIANT";
    if (item.symbol === "") {
      sources.push(undefined);
      continue;
    }
    const name = dateTimePatternField(item.symbol);
    if (left.includes(name) && right.includes(name)) {
      const end = index < split.first.length ? firstIsEnd : !firstIsEnd;
      sources.push(end ? "endRange" : "startRange");
    } else {
      const one = dateTimePatternParts(formatter, [item], first, firstZone),
        two = dateTimePatternParts(formatter, [item], last, lastZone);
      if (one === undefined || two === undefined || !equalParts(one, two))
        return undefined;
      sources.push("shared");
    }
  }
  const result: RangeToken[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const item: DateTimePatternToken | undefined = tokens[index];
    if (item === undefined) throw "DATE_TIME_RANGE_INTERVAL_LITERAL_INVARIANT";
    const assigned = sources[index];
    if (assigned !== undefined) {
      result.push({ token: item, source: assigned });
      continue;
    }
    let before: string | undefined, after: string | undefined;
    for (let probe = index - 1; probe >= 0; probe--) {
      const value = sources[probe];
      if (value !== undefined) {
        before = value;
        break;
      }
    }
    for (let probe = index + 1; probe < sources.length; probe++) {
      const value = sources[probe];
      if (value !== undefined) {
        after = value;
        break;
      }
    }
    const source =
      before === after
        ? (before ?? "shared")
        : before === undefined
          ? (after ?? "shared")
          : after === undefined
            ? before
            : "shared";
    result.push({ token: item, source });
  }
  return result;
}
function render(
  formatter: DateTimePartsFormatter,
  tokens: readonly RangeToken[],
  first: DateTimeDisplayFields,
  last: DateTimeDisplayFields,
  firstZone: string | undefined,
  lastZone: string | undefined,
): DateTimeRangePart[] | undefined {
  const result: DateTimeRangePart[] = [];
  let cursor = 0;
  while (cursor < tokens.length) {
    const initial: RangeToken | undefined = tokens[cursor];
    if (initial === undefined) throw "DATE_TIME_RANGE_RENDER_INVARIANT";
    const source = initial.source,
      group: DateTimePatternToken[] = [];
    while (cursor < tokens.length) {
      const item: RangeToken | undefined = tokens[cursor];
      if (item === undefined) throw "DATE_TIME_RANGE_RENDER_TOKEN_INVARIANT";
      if (item.source !== source) break;
      group.push(item.token);
      cursor++;
    }
    const parts = dateTimePatternParts(
      formatter,
      group,
      source === "endRange" ? last : first,
      source === "endRange" ? lastZone : firstZone,
    );
    if (parts === undefined) return undefined;
    for (let index = 0; index < parts.length; index++) {
      const part: DateTimePart | undefined = parts[index];
      if (part === undefined) throw "DATE_TIME_RANGE_RENDER_PART_INVARIANT";
      append(result, part, source);
    }
  }
  return result;
}
function differenceKey(
  rank: number,
  tokens: readonly DateTimePatternToken[],
): string {
  return rank === 0
    ? "G"
    : rank === 1
      ? "y"
      : rank === 2
        ? "M"
        : rank === 3
          ? "d"
          : rank === 4
            ? "a"
            : rank === 5
              ? "B"
              : rank === 6
                ? hourFamily(tokens) === 1
                  ? "h"
                  : "H"
                : rank === 7
                  ? "m"
                  : rank === 8
                    ? "s"
                    : "S";
}
function selectInterval(
  formatter: DateTimePartsFormatter,
  wanted: readonly DateTimePatternToken[],
  difference: string,
  first: DateTimeDisplayFields,
  last: DateTimeDisplayFields,
  firstZone: string | undefined,
  lastZone: string | undefined,
  fallbackPattern: string,
): RangeToken[] | undefined {
  const entries = dateTimeCalendarEntries(formatter.calendar, "intervals"),
    wantedFields = dateTimePatternFields(wanted);
  if (wantedFields === undefined) return undefined;
  const wantedMask = mask(wanted),
    family = hourFamily(wanted);
  let best: RangeToken[] | undefined,
    bestScore = -Infinity;
  for (let index = 0; index < entries.length; index++) {
    const entry: DateTimeCalendarEntry | undefined = entries[index];
    if (entry === undefined) throw "DATE_TIME_RANGE_INTERVAL_ENTRY_INVARIANT";
    const separator = entry.key.lastIndexOf(".");
    if (separator < 0 || entry.key.slice(separator + 1) !== difference)
      continue;
    const skeleton = parseDateTimePattern(entry.key.slice(0, separator));
    if (skeleton === undefined) continue;
    const otherFamily = hourFamily(skeleton);
    if (family >= 0 && otherFamily >= 0 && family !== otherFamily) continue;
    let text: string = entry.value,
      firstIsEnd =
        fallbackPattern.indexOf("{1}") < fallbackPattern.indexOf("{0}");
    if (text.startsWith("latestFirst:")) {
      firstIsEnd = true;
      text = text.slice(12);
    } else if (text.startsWith("earliestFirst:")) {
      firstIsEnd = false;
      text = text.slice(14);
    }
    const raw = parseDateTimePattern(text);
    if (raw === undefined) continue;
    const adapted = adaptDateTimePatternTokens(
      raw,
      skeleton,
      wanted,
      formatter.numeric.profile.symbols.decimal,
    );
    if (mask(adapted) !== wantedMask) continue;
    const fields = dateTimePatternFields(adapted),
      originalFields = dateTimePatternFields(skeleton);
    if (fields === undefined || originalFields === undefined) continue;
    const score =
      basicDateTimeFormatScore(wantedFields, fields) * 10000 +
      basicDateTimeFormatScore(wantedFields, originalFields);
    if (score <= bestScore) continue;
    const source = intervalTokens(
      formatter,
      adapted,
      first,
      last,
      firstZone,
      lastZone,
      firstIsEnd,
    );
    if (source === undefined) continue;
    best = source;
    bestScore = score;
  }
  return best;
}
/** Range precision includes all more-significant calendar fields, even when a
 * time-only format hides them. Lower fields beyond the displayed precision do
 * not prevent collapse. Argument order remains the caller's order. */
export function dateTimeRangeParts(
  formatter: DateTimePartsFormatter,
  pattern: ResolvedDateTimePattern,
  first: DateTimeDisplayFields,
  last: DateTimeDisplayFields,
  firstZone: string | undefined,
  lastZone: string | undefined,
): DateTimeRangePart[] | undefined {
  const one = dateTimePatternParts(formatter, pattern.tokens, first, firstZone),
    two = dateTimePatternParts(formatter, pattern.tokens, last, lastZone);
  if (one === undefined || two === undefined) return undefined;
  const difference = firstDifference(formatter, pattern, first, last, one, two);
  if (difference === undefined) return undefined;
  if (difference < 0) {
    const shared: DateTimeRangePart[] = [];
    for (let index = 0; index < one.length; index++) {
      const part: DateTimePart | undefined = one[index];
      if (part === undefined) throw "DATE_TIME_RANGE_COLLAPSE_INVARIANT";
      append(shared, part, "shared");
    }
    return shared;
  }
  const fallbackPattern = dateTimeCalendarValue(
    formatter.calendar,
    "intervals",
    "fallback",
  );
  if (fallbackPattern === undefined) return undefined;
  const date = pattern.dateTokens,
    time = pattern.timeTokens,
    connector = pattern.connector;
  if (date !== undefined && time !== undefined && connector !== undefined) {
    if (difference >= 4) {
      const selected = selectInterval(
        formatter,
        time,
        differenceKey(difference, time),
        first,
        last,
        firstZone,
        lastZone,
        fallbackPattern,
      );
      const interval =
        selected ??
        combineRaw(fallbackPattern, [
          tagged(time, "startRange"),
          tagged(time, "endRange"),
        ]);
      if (interval !== undefined) {
        const values: RangeToken[][] =
            pattern.timeSlot === 0
              ? [interval, tagged(date, "shared")]
              : [tagged(date, "shared"), interval],
          combined = combine(connector, values);
        if (combined !== undefined) {
          const result = render(
            formatter,
            combined,
            first,
            last,
            firstZone,
            lastZone,
          );
          if (result !== undefined) return result;
        }
      }
    }
  } else {
    const interval = selectInterval(
      formatter,
      pattern.tokens,
      differenceKey(difference, pattern.tokens),
      first,
      last,
      firstZone,
      lastZone,
      fallbackPattern,
    );
    if (interval !== undefined) {
      const result = render(
        formatter,
        interval,
        first,
        last,
        firstZone,
        lastZone,
      );
      if (result !== undefined) return result;
    }
  }
  return fallback(fallbackPattern, one, two);
}
