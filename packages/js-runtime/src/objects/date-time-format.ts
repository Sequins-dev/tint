import { tzifOffsetSecondsAt } from "@tint/foundation/chrono/tzif";
import type { TemporalTimeZone } from "./temporal-time-zone.ts";
import { clipDateTime, dateFields } from "./date-values.ts";
import {
  dateTimeCalendarEntries,
  type DateTimeCalendarEntry,
} from "./date-time-calendar.ts";
import {
  basicDateTimeFormatScore,
  type DateTimeFormatFields,
} from "./date-time-pattern.ts";
import {
  resolveDateTimeSkeleton,
  resolveDateTimeStylePattern,
  type ResolvedDateTimePattern,
} from "./date-time-skeleton.ts";
import {
  createDateTimePartsFormatter,
  dateTimePatternParts,
  type DateTimePartsFormatter,
  type DateTimeDisplayFields,
  type DateTimePart,
} from "./date-time-parts.ts";
import {
  dateTimeZoneName,
  type DateTimeZoneNameFormatter,
} from "./date-time-zone-name.ts";
import {
  dateTimeRangeParts,
  type DateTimeRangePart,
} from "./date-time-range.ts";
import type { ResolvedDateTimeLocale } from "./date-time-locale.ts";
export interface DateTimeFormatConfiguration {
  readonly locale: ResolvedDateTimeLocale;
  readonly timeZone: TemporalTimeZone;
  readonly fields: DateTimeFormatFields;
  readonly dateStyle: string | undefined;
  readonly timeStyle: string | undefined;
  readonly formatMatcher: string;
}
export interface DateTimeFormatter {
  readonly configuration: DateTimeFormatConfiguration;
  readonly pattern: ResolvedDateTimePattern;
  readonly parts: DateTimePartsFormatter;
  readonly zoneNames: DateTimeZoneNameFormatter;
  boundFormat: unknown;
}
function textWidth(value: string): number {
  return value === "narrow"
    ? 5
    : value === "long"
      ? 4
      : value === "short"
        ? 3
        : value === "2-digit"
          ? 2
          : 1;
}
function clockSymbol(cycle: string): string {
  return cycle === "h11"
    ? "K"
    : cycle === "h12"
      ? "h"
      : cycle === "h24"
        ? "k"
        : "H";
}
function component(symbol: string, value: string | undefined): string {
  const width = value;
  return width === undefined ? "" : symbol.repeat(textWidth(width));
}
/** Options are already validated by the observable adapter. */
export function dateTimeComponentSkeleton(
  fields: DateTimeFormatFields,
  cycle: string,
): string {
  let result =
    component("E", fields.weekday) +
    component("G", fields.era) +
    component("y", fields.year) +
    component("M", fields.month) +
    component("d", fields.day) +
    component("B", fields.dayPeriod) +
    component(clockSymbol(cycle), fields.hour) +
    component("m", fields.minute) +
    component("s", fields.second);
  const fraction = fields.fractionalSecondDigits;
  if (fraction !== undefined) result += "S".repeat(fraction);
  const zone = fields.timeZoneName;
  if (zone !== undefined)
    result +=
      zone === "short"
        ? "z"
        : zone === "long"
          ? "zzzz"
          : zone === "shortGeneric"
            ? "v"
            : zone === "longGeneric"
              ? "vvvv"
              : zone === "shortOffset"
                ? "O"
                : "OOOO";
  return result;
}
function cycleSkeleton(key: string, cycle: string): string {
  let result = "";
  for (let index = 0; index < key.length; index++) {
    const character = key.charAt(index);
    result += "hHKk".includes(character) ? clockSymbol(cycle) : character;
  }
  return result;
}
function basicPattern(
  parts: DateTimePartsFormatter,
  fields: DateTimeFormatFields,
  cycle: string,
): ResolvedDateTimePattern | undefined {
  const rows = dateTimeCalendarEntries(parts.calendar, "patterns"),
    keys: string[] = [],
    dates: string[] = [],
    times: string[] = [];
  // A fixed locale inventory, independent of the request: available skeletons,
  // required legacy subsets and every date/time combination of those records.
  for (let index = 0; index < rows.length; index++) {
    const row: DateTimeCalendarEntry | undefined = rows[index];
    if (row === undefined) throw "DATE_TIME_BASIC_ROW_INVARIANT";
    if (!row.key.endsWith(".ascii")) keys.push(cycleSkeleton(row.key, cycle));
  }
  for (const key of ["yMd", "yM", "Md", "y", "M", "d", "Hms", "Hm", "H"])
    if (key !== undefined) keys.push(cycleSkeleton(key, cycle));
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index];
    if (key === undefined) throw "DATE_TIME_BASIC_KEY_INVARIANT";
    let date = false,
      time = false;
    for (let cursor = 0; cursor < key.length; cursor++) {
      const symbol = key.charAt(cursor);
      if ("GyYuUrUMLdEec".includes(symbol)) date = true;
      else time = true;
    }
    if (date && !time && !dates.includes(key)) dates.push(key);
    if (time && !date && !times.includes(key)) times.push(key);
  }
  // Prune combinations only when their unavoidable extra fields already lose
  // to a single record. The scored inventory itself is fixed for this locale.
  let best: ResolvedDateTimePattern | undefined = undefined,
    score = -Infinity;
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index];
    if (key === undefined) throw "DATE_TIME_BASIC_CANDIDATE_INVARIANT";
    const candidate = resolveDateTimeSkeleton(
      parts.calendar,
      key,
      parts.numeric.profile.symbols.decimal,
    );
    if (candidate === undefined) continue;
    const value = basicDateTimeFormatScore(fields, candidate.fields);
    if (value > score) {
      score = value;
      best = candidate;
    }
  }
  if (score >= 0) return best;
  for (let dateIndex = 0; dateIndex < dates.length; dateIndex++) {
    const date = dates[dateIndex];
    if (date === undefined) throw "DATE_TIME_BASIC_DATE_INVARIANT";
    for (let timeIndex = 0; timeIndex < times.length; timeIndex++) {
      const time = times[timeIndex];
      if (time === undefined) throw "DATE_TIME_BASIC_TIME_INVARIANT";
      const candidate = resolveDateTimeSkeleton(
        parts.calendar,
        date + time,
        parts.numeric.profile.symbols.decimal,
      );
      if (candidate === undefined) continue;
      const value = basicDateTimeFormatScore(fields, candidate.fields);
      if (value > score) {
        score = value;
        best = candidate;
      }
    }
  }
  return best;
}
export function createDateTimeFormatter(
  configuration: DateTimeFormatConfiguration,
): DateTimeFormatter | undefined {
  const locale = configuration.locale,
    parts = createDateTimePartsFormatter(
      locale.dataLocale,
      locale.calendar,
      locale.numberingSystem,
    );
  if (parts === undefined) return undefined;
  const pattern =
    configuration.dateStyle !== undefined ||
    configuration.timeStyle !== undefined
      ? resolveDateTimeStylePattern(
          parts.calendar,
          configuration.dateStyle,
          configuration.timeStyle,
          locale.hourCycle,
        )
      : configuration.formatMatcher === "basic"
        ? basicPattern(parts, configuration.fields, locale.hourCycle)
        : resolveDateTimeSkeleton(
            parts.calendar,
            dateTimeComponentSkeleton(configuration.fields, locale.hourCycle),
            parts.numeric.profile.symbols.decimal,
            configuration.fields.hour === "2-digit",
          );
  if (pattern === undefined) return undefined;
  return {
    configuration,
    pattern,
    parts,
    zoneNames: {
      data: parts.periods,
      numeric: parts.numeric,
      twoDigits: parts.twoDigits,
      region: locale.region,
    },
    boundFormat: undefined,
  };
}
interface DateTimeInput {
  readonly fields: DateTimeDisplayFields;
  readonly zoneName: string | undefined;
}
function input(
  formatter: DateTimeFormatter,
  value: number,
): DateTimeInput | undefined {
  const clipped = clipDateTime(value);
  if (!Number.isFinite(clipped)) return undefined;
  const seconds = Math.floor(clipped / 1000),
    zone = formatter.configuration.timeZone,
    offset =
      zone.kind === "fixed"
        ? zone.offsetNanoseconds / 1e9
        : tzifOffsetSecondsAt(zone.model, seconds);
  if (offset === undefined || Math.abs(offset) >= 86400) return undefined;
  const local = dateFields(clipped + offset * 1000);
  if (local === undefined) return undefined;
  const style = formatter.pattern.fields.timeZoneName,
    zoneName =
      style === undefined
        ? undefined
        : dateTimeZoneName(formatter.zoneNames, zone, seconds, style);
  if (style !== undefined && zoneName === undefined) return undefined;
  return {
    fields: {
      date: { year: local.year, month: local.month + 1, day: local.day },
      hour: local.hour,
      minute: local.minute,
      second: local.second,
      millisecond: local.millisecond,
    },
    zoneName,
  };
}
export function dateTimeFormatParts(
  formatter: DateTimeFormatter,
  value: number,
): DateTimePart[] | undefined {
  const converted = input(formatter, value);
  return converted === undefined
    ? undefined
    : dateTimePatternParts(
        formatter.parts,
        formatter.pattern.tokens,
        converted.fields,
        converted.zoneName,
      );
}
export function dateTimeFormatRangeParts(
  formatter: DateTimeFormatter,
  first: number,
  last: number,
): DateTimeRangePart[] | undefined {
  const start = input(formatter, first),
    end = input(formatter, last);
  return start === undefined || end === undefined
    ? undefined
    : dateTimeRangeParts(
        formatter.parts,
        formatter.pattern,
        start.fields,
        end.fields,
        start.zoneName,
        end.zoneName,
      );
}
