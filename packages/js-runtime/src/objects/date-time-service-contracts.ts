import type { GregorianDate } from "@tint/foundation/chrono/gregorian-calendar";
import type { TemporalTimeZone } from "./temporal-time-zone.ts";
import type {
  DateTimeFormatFields,
  DateTimePatternToken,
} from "./date-time-pattern.ts";
import type { DecimalNumberFormatter } from "./decimal-number-format.ts";

/** Exact formatter state shared by the Intl adapter and the native service.
 * This module contains declarations only; it does not reach CLDR tables or
 * formatter implementation bodies. */
export interface DateTimeCalendarProfile {
  readonly locale: string;
  readonly calendar: string;
  readonly groups: readonly string[];
}

export interface DateTimeCalendarEntry {
  readonly key: string;
  readonly value: string;
}

export interface DateTimeZoneProfile {
  readonly locale: string;
  readonly groups: readonly string[];
  readonly dayPeriods: string;
}

export interface ResolvedDateTimeLocale {
  readonly locale: string;
  readonly dataLocale: string;
  readonly calendar: string;
  readonly numberingSystem: string;
  readonly hourCycle: string;
  readonly region: string;
}

export interface ResolvedDateTimePattern {
  readonly tokens: readonly DateTimePatternToken[];
  readonly fields: DateTimeFormatFields;
  readonly skeleton: string;
  readonly dateTokens: readonly DateTimePatternToken[] | undefined;
  readonly timeTokens: readonly DateTimePatternToken[] | undefined;
  readonly connector: string | undefined;
  readonly timeSlot: number;
}

export interface DateTimeDisplayFields {
  readonly date: GregorianDate;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  readonly millisecond: number;
}

export interface DateTimePart {
  readonly type: string;
  readonly value: string;
}

export interface DateTimePartsFormatter {
  readonly calendar: DateTimeCalendarProfile;
  readonly gregorian: DateTimeCalendarProfile;
  readonly periods: DateTimeZoneProfile;
  readonly numeric: DecimalNumberFormatter;
  readonly twoDigits: DecimalNumberFormatter;
  readonly threeDigits: DecimalNumberFormatter;
}

export interface DateTimeZoneNameFormatter {
  readonly data: DateTimeZoneProfile;
  readonly numeric: DecimalNumberFormatter;
  readonly twoDigits: DecimalNumberFormatter;
  readonly region: string;
}

export interface DateTimeRangePart {
  readonly type: string;
  readonly value: string;
  readonly source: string;
}

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
  readonly defaults: string;
  readonly temporalPatterns: (ResolvedDateTimePattern | undefined)[];
  temporalPatternMask: number;
  boundFormat: unknown;
}

export interface DateTimeInput {
  readonly fields: DateTimeDisplayFields;
  readonly zoneName: string | undefined;
}
