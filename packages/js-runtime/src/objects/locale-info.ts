import { numberFormatLocaleData } from "./number-format-profile.ts";
import { parseLocaleId, type LocaleId } from "./locale-id.ts";
import {
  canonicalizeLocaleId,
  localeTableValue,
} from "./locale-canonicalization.ts";
import { maximizeLocaleId } from "./locale-likely.ts";
import {
  localeHourCyclePreferences,
  localeCalendarPreferences,
  localeCalendarTypes,
  localeCollationPreferences,
  localeScriptDirections,
  localeWeekFirstDays,
  localeWeekendStarts,
  localeWeekendEnds,
  localeTerritoryTimeZones,
} from "./locale-data.ts";

export interface LocaleWeekInfo {
  readonly firstDay: number;
  readonly weekend: readonly number[];
}

function parsed(tag: string): LocaleId {
  const result = parseLocaleId(tag);
  if (result === undefined) throw "LOCALE_INFO_TAG_INVARIANT";
  return result;
}

function keyword(locale: LocaleId, key: string): string | undefined {
  for (const extension of locale.extensions) {
    if (extension === undefined) throw "LOCALE_INFO_TAG_INVARIANT";
    if (extension.key !== "u") continue;
    for (const field of extension.fields) {
      if (field === undefined) throw "LOCALE_INFO_TAG_INVARIANT";
      if (field.key === key) return field.value;
    }
  }
  return undefined;
}

function subdivisionRegion(locale: LocaleId, key: string): string | undefined {
  const value = keyword(locale, key);
  if (value === undefined || value.length === 0) return undefined;
  const first = value.charCodeAt(0),
    numeric = first >= 48 && first <= 57,
    size = numeric ? 3 : 2;
  if (value.length <= size || value.length > size + 4) return undefined;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index),
      digit = code >= 48 && code <= 57,
      letter = code >= 97 && code <= 122;
    if (index < size ? (numeric ? !digit : !letter) : !digit && !letter)
      return undefined;
  }
  const canonical = canonicalizeLocaleId("und-" + value.slice(0, size));
  if (canonical === undefined) throw "LOCALE_INFO_REGION_INVARIANT";
  return parsed(canonical).language.region;
}

function regionPreference(
  tag: string,
  locale: LocaleId,
): { readonly region: string; readonly override: string | undefined } {
  const subdivision = subdivisionRegion(locale, "sd");
  const region =
    locale.language.region !== "" ? locale.language.region : subdivision;
  if (region !== undefined && region !== "")
    return { region, override: subdivisionRegion(locale, "rg") };
  const maximal = maximizeLocaleId(tag);
  const likely = parsed(maximal ?? tag).language.region;
  return {
    region: likely === "" ? "001" : likely,
    override: subdivisionRegion(locale, "rg"),
  };
}

/** CLDR time preferences; independent of formatter-service availability. */
export function localeHourCycles(tag: string): readonly string[] {
  const locale = parsed(tag),
    explicit = keyword(locale, "hc");
  if (explicit !== undefined) return [explicit];
  const preference = regionPreference(tag, locale);
  for (const region of [preference.override, preference.region]) {
    if (region === undefined) continue;
    const value =
      localeTableValue(
        localeHourCyclePreferences,
        locale.language.language + "-" + region,
      ) ?? localeTableValue(localeHourCyclePreferences, region);
    if (value !== undefined) return value.split(",");
  }
  return ["h23"];
}

export function localeTextDirection(tag: string): string | undefined {
  const language = parsed(tag).language;
  const maximal = language.script === "" ? maximizeLocaleId(tag) : undefined;
  const script =
    language.script === ""
      ? parsed(maximal ?? tag).language.script
      : language.script;
  const value = localeTableValue(localeScriptDirections, script);
  return value === "ltr" || value === "rtl" ? value : undefined;
}

function hasWeekData(region: string | undefined): boolean {
  return (
    region !== undefined &&
    (localeTableValue(localeWeekFirstDays, region) !== undefined ||
      localeTableValue(localeWeekendStarts, region) !== undefined ||
      localeTableValue(localeWeekendEnds, region) !== undefined)
  );
}

function weekField(rows: string, region: string): number {
  const value = localeTableValue(rows, region) ?? localeTableValue(rows, "001");
  if (value === undefined) throw "LOCALE_WEEK_DATA_INVARIANT";
  return Number(value);
}

export function localeWeekInfo(tag: string): LocaleWeekInfo {
  const locale = parsed(tag),
    preference = regionPreference(tag, locale);
  const region = hasWeekData(preference.override)
    ? preference.override
    : hasWeekData(preference.region)
      ? preference.region
      : "001";
  if (region === undefined) throw "LOCALE_WEEK_DATA_INVARIANT";
  let firstDay = weekField(localeWeekFirstDays, region);
  const start = weekField(localeWeekendStarts, region),
    end = weekField(localeWeekendEnds, region),
    weekend: number[] = [];
  for (let day = 1; day <= 7; day++)
    if (start <= end ? day >= start && day <= end : day >= start || day <= end)
      weekend.push(day);
  const override = keyword(locale, "fw"),
    weekdays = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  for (let index = 0; index < weekdays.length; index++)
    if (override === weekdays[index]) firstDay = index + 1;
  return { firstDay, weekend };
}

/** Common-use territory catalog, not an exhaustive tzdb zone.tab assignment.
 * This query uses the explicit region only, ignoring likely/sd/rg regions. */
export function localeTimeZones(tag: string): readonly string[] | undefined {
  const region = parsed(tag).language.region;
  if (region === "") return undefined;
  const value = localeTableValue(localeTerritoryTimeZones, region);
  return value === undefined ? [] : value.split(",");
}

/** Explicit Locale keywords are returned as stored, even when a formatter does
 * not support that system. Otherwise expose the matched formatter's default. */
export function localeNumberingSystems(tag: string): string[] {
  const override = keyword(parsed(tag), "nu");
  if (override !== undefined) return [override];
  const data = numberFormatLocaleData(tag);
  return [data === undefined ? "latn" : data.defaultNumberingSystem];
}

/** Available canonical calendar identifiers from the pinned CLDR vocabulary. */
export function availableLocaleCalendars(): string[] {
  return localeCalendarTypes.split(",");
}

/** CollationsOfLocale uses prefix matching, without likely-subtag expansion.
 * The generated table already resolves CLDR's collation-specific inheritance. */
export function localeCollations(tag: string): string[] {
  const locale = parsed(tag),
    explicit = keyword(locale, "co");
  if (explicit !== undefined) return [explicit];
  const language = locale.language;
  let key = language.language;
  if (language.script !== "") key += "-" + language.script;
  if (language.region !== "") key += "-" + language.region;
  while (key !== "") {
    const value = localeTableValue(localeCollationPreferences, key);
    if (value !== undefined) return value.split(",");
    const split = key.lastIndexOf("-");
    key = split < 0 ? "" : key.slice(0, split);
  }
  return ["emoji", "eor"];
}
/** CalendarsOfLocale preserves common-use preference order and explicit slots. */
export function localeCalendars(tag: string): string[] {
  const locale = parsed(tag),
    explicit = keyword(locale, "ca");
  if (explicit !== undefined) return [explicit];
  const preference = regionPreference(tag, locale),
    available = availableLocaleCalendars();
  for (const region of [preference.override, preference.region]) {
    if (region === undefined) continue;
    const data =
      localeTableValue(
        localeCalendarPreferences,
        locale.language.language + "-" + region,
      ) ?? localeTableValue(localeCalendarPreferences, region);
    if (data === undefined) continue;
    const values: string[] = [];
    for (const calendar of data.split(",")) {
      if (calendar === undefined) throw "LOCALE_CALENDAR_DATA_INVARIANT";
      if (available.includes(calendar) && !values.includes(calendar))
        values.push(calendar);
    }
    return values.length === 0 ? ["gregory"] : values;
  }
  return ["gregory"];
}
