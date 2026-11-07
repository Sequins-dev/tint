import { localeTableValue } from "./locale-canonicalization.ts";
import {
  lookupNumberFormatLocale,
  numberFormatLocaleKey,
} from "./number-format-profile.ts";
import {
  dateTimeCalendarLocales,
  dateTimeCalendarProfiles,
  dateTimeCalendarFields,
  dateTimeCalendarStrings,
} from "./date-time-format-data.ts";

/** Resolved, inherited calendar presentation data. Arithmetic stays in calendar.ts. */
export interface DateTimeCalendarProfile {
  readonly locale: string;
  readonly calendar: string;
  readonly groups: readonly string[];
}
export interface DateTimeCalendarEntry {
  readonly key: string;
  readonly value: string;
}
export function createDateTimeCalendarProfile(
  locale: string,
  calendar: string,
): DateTimeCalendarProfile | undefined {
  const matched = lookupNumberFormatLocale(locale);
  if (matched === undefined) return undefined;
  const id = localeTableValue(
    dateTimeCalendarLocales,
    numberFormatLocaleKey(matched) + "#" + calendar,
  );
  if (id === undefined) return undefined;
  const profile = localeTableValue(dateTimeCalendarProfiles, id);
  if (profile === undefined) throw "DATE_TIME_CALENDAR_PROFILE_INVARIANT";
  return { locale: matched, calendar, groups: profile.split(",") };
}
function groupData(profile: DateTimeCalendarProfile, group: string): string {
  const names: readonly string[] = [
    "styles",
    "patterns",
    "intervals",
    "months",
    "days",
    "eras",
    "dayPeriods",
    "cyclicYears",
    "leapMonths",
    "appendItems",
  ];
  const index = names.indexOf(group);
  if (index < 0) throw "DATE_TIME_CALENDAR_GROUP_INVARIANT";
  const id = profile.groups[index];
  if (id === undefined) throw "DATE_TIME_CALENDAR_GROUP_ID_INVARIANT";
  const data = localeTableValue(dateTimeCalendarFields, id);
  if (data === undefined) throw "DATE_TIME_CALENDAR_FIELD_INVARIANT";
  return data;
}
function entryText(id: string): string {
  const value = localeTableValue(dateTimeCalendarStrings, id);
  if (value === undefined) throw "DATE_TIME_CALENDAR_TEXT_INVARIANT";
  return value;
}
export function dateTimeCalendarValue(
  profile: DateTimeCalendarProfile,
  group: string,
  key: string,
): string | undefined {
  for (const entry of groupData(profile, group).split(",")) {
    if (entry === undefined) throw "DATE_TIME_CALENDAR_ENTRY_INVARIANT";
    const split = entry.indexOf(":");
    if (entry.slice(0, split) === key) return entryText(entry.slice(split + 1));
  }
  return undefined;
}
/** Fresh entries let matching engines order candidates without mutating data. */
export function dateTimeCalendarEntries(
  profile: DateTimeCalendarProfile,
  group: string,
): DateTimeCalendarEntry[] {
  const data = groupData(profile, group),
    result: DateTimeCalendarEntry[] = [];
  if (data === "") return result;
  for (const entry of data.split(",")) {
    if (entry === undefined) throw "DATE_TIME_CALENDAR_ENTRY_INVARIANT";
    const split = entry.indexOf(":");
    result.push({
      key: entry.slice(0, split),
      value: entryText(entry.slice(split + 1)),
    });
  }
  return result;
}
