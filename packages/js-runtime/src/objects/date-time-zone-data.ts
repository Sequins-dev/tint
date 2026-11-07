import { localeTableValue } from "./locale-canonicalization.ts";
import {
  lookupNumberFormatLocale,
  numberFormatLocaleKey,
} from "./number-format-profile.ts";
import {
  dateTimeZoneLocales,
  dateTimeZoneProfiles,
  dateTimeZoneFields,
  dateTimeZoneStrings,
  dateTimeZoneAliases,
  dateTimeZoneHistories,
  dateTimeZoneReferences,
  dateTimeZoneTerritories,
  dateTimeZonePrimaryZones,
  dateTimeDayPeriodRules,
} from "./date-time-zone-format-data.ts";
export interface DateTimeZoneProfile {
  readonly locale: string;
  readonly groups: readonly string[];
  readonly dayPeriods: string;
}
export function createDateTimeZoneProfile(
  locale: string,
): DateTimeZoneProfile | undefined {
  const matched = lookupNumberFormatLocale(locale);
  if (matched === undefined) return undefined;
  const key = numberFormatLocaleKey(matched),
    id = localeTableValue(dateTimeZoneLocales(), key);
  const profile =
      id === undefined
        ? undefined
        : localeTableValue(dateTimeZoneProfiles(), id),
    dayPeriods = localeTableValue(dateTimeDayPeriodRules(), key);
  if (profile === undefined || dayPeriods === undefined)
    throw "DATE_TIME_ZONE_PROFILE_INVARIANT";
  return { locale: matched, groups: profile.split(","), dayPeriods };
}
export function dateTimeZoneValue(
  profile: DateTimeZoneProfile,
  group: string,
  key: string,
): string | undefined {
  const names: readonly string[] = [
      "formats",
      "zones",
      "metazones",
      "countries",
    ],
    index = names.indexOf(group);
  if (index < 0) throw "DATE_TIME_ZONE_GROUP_INVARIANT";
  const id = profile.groups[index];
  if (id === undefined) throw "DATE_TIME_ZONE_GROUP_ID_INVARIANT";
  const field = localeTableValue(dateTimeZoneFields(), id);
  if (field === undefined) throw "DATE_TIME_ZONE_FIELD_INVARIANT";
  for (const entry of field.split(",")) {
    if (entry === undefined) throw "DATE_TIME_ZONE_ENTRY_INVARIANT";
    const split = entry.indexOf(":");
    if (entry.slice(0, split) !== key) continue;
    const text = localeTableValue(
      dateTimeZoneStrings(),
      entry.slice(split + 1),
    );
    if (text === undefined) throw "DATE_TIME_ZONE_TEXT_INVARIANT";
    return text;
  }
  return undefined;
}
/** CLDR naming identity is separate from the provider's public IANA identity. */
export function dateTimeZoneCanonicalName(zone: string): string | undefined {
  return localeTableValue(dateTimeZoneAliases(), numberFormatLocaleKey(zone));
}
export function dateTimeZoneMetazone(
  zone: string,
  epochSecond: number,
): string | undefined {
  if (!Number.isFinite(epochSecond)) return undefined;
  const canonical = dateTimeZoneCanonicalName(zone);
  if (canonical === undefined) return undefined;
  const history = localeTableValue(dateTimeZoneHistories(), canonical);
  if (history === undefined) return undefined;
  for (const period of history.split(";")) {
    if (period === undefined) throw "DATE_TIME_ZONE_HISTORY_INVARIANT";
    const fields = period.split(","),
      name = fields[0],
      from = fields[1],
      to = fields[2];
    if (name === undefined || from === undefined || to === undefined)
      throw "DATE_TIME_ZONE_PERIOD_INVARIANT";
    if (
      (from === "" || epochSecond >= Number(from)) &&
      (to === "" || epochSecond < Number(to))
    )
      return name;
  }
  return undefined;
}
export function dateTimeZoneReference(
  metazone: string,
  region: string,
): string | undefined {
  return (
    localeTableValue(dateTimeZoneReferences(), metazone + "." + region) ??
    localeTableValue(dateTimeZoneReferences(), metazone + ".001")
  );
}
export function dateTimeZoneTerritory(zone: string): string | undefined {
  const canonical = dateTimeZoneCanonicalName(zone);
  return canonical === undefined
    ? undefined
    : localeTableValue(dateTimeZoneTerritories(), canonical);
}
export function dateTimeZonePrimary(region: string): string | undefined {
  return localeTableValue(dateTimeZonePrimaryZones(), region);
}
/** Exact midnight/noon points precede inclusive-start, exclusive-end ranges. */
export function dateTimeDayPeriod(
  profile: DateTimeZoneProfile,
  second: number,
): string | undefined {
  if (!Number.isFinite(second) || second < 0 || second >= 86400)
    return undefined;
  let interval: string | undefined;
  for (const rule of profile.dayPeriods.split(";")) {
    if (rule === undefined) throw "DATE_TIME_DAY_PERIOD_RULE_INVARIANT";
    const fields = rule.split(","),
      name = fields[0],
      at = fields[1],
      from = fields[2],
      before = fields[3];
    if (
      name === undefined ||
      at === undefined ||
      from === undefined ||
      before === undefined
    )
      throw "DATE_TIME_DAY_PERIOD_FIELD_INVARIANT";
    if (at !== "") {
      if (second === Number(at) * 60) return name;
      continue;
    }
    const start = Number(from) * 60,
      end = Number(before) * 60;
    if (
      start < end
        ? second >= start && second < end
        : second >= start || second < end
    )
      interval = name;
  }
  return interval;
}
