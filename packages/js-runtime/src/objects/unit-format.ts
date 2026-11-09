import { localeTableValue } from "./locale-canonicalization.ts";
import {
  lookupNumberFormatLocale,
  numberFormatLocaleKey,
} from "./number-format-profile.ts";
import { lookupListFormatLocale, type ListFormatter } from "./list-format.ts";
import {
  unitFormatLocaleRows,
  unitFormatProfiles,
  unitFormatFields,
  unitFormatStrings,
} from "./unit-format-data.ts";
export interface UnitFormatProfile {
  readonly locale: string;
  readonly groups: readonly string[];
}
export interface UnitDigitalFormat {
  readonly hourMinuteSeparator: string;
  readonly minuteSecondSeparator: string;
  readonly twoDigitHours: boolean;
}
export function createUnitFormatProfile(
  locale: string,
): UnitFormatProfile | undefined {
  const matched = lookupNumberFormatLocale(locale);
  if (matched === undefined) return undefined;
  const id = localeTableValue(
      unitFormatLocaleRows,
      numberFormatLocaleKey(matched),
    ),
    profile =
      id === undefined ? undefined : localeTableValue(unitFormatProfiles, id);
  return profile === undefined
    ? undefined
    : { locale: matched, groups: profile.split(",") };
}
function value(
  profile: UnitFormatProfile,
  group: number,
  key: string,
): string | undefined {
  const id = profile.groups[group],
    row = id === undefined ? undefined : localeTableValue(unitFormatFields, id);
  if (row === undefined) throw "UNIT_FORMAT_PROFILE_INVARIANT";
  for (const entry of row.split(",")) {
    if (entry === undefined) throw "UNIT_FORMAT_ENTRY_INVARIANT";
    const split = entry.indexOf(":");
    if (entry.slice(0, split) !== key) continue;
    const result = localeTableValue(unitFormatStrings, entry.slice(split + 1));
    if (result === undefined) throw "UNIT_FORMAT_TEXT_INVARIANT";
    return result;
  }
  return undefined;
}
export function unitFormatPattern(
  profile: UnitFormatProfile,
  width: string,
  unit: string,
  category: string,
): string | undefined {
  return (
    value(profile, 0, width + "." + unit + "." + category) ??
    value(profile, 0, width + "." + unit + ".other")
  );
}
export function unitFormatDigital(
  profile: UnitFormatProfile,
  system: string,
): UnitDigitalFormat | undefined {
  const hourMinuteSeparator = value(profile, 1, system + ".hm"),
    minuteSecondSeparator = value(profile, 1, system + ".ms"),
    hours = value(profile, 1, system + ".hh");
  return hourMinuteSeparator === undefined ||
    minuteSecondSeparator === undefined ||
    hours === undefined
    ? undefined
    : {
        hourMinuteSeparator,
        minuteSecondSeparator,
        twoDigitHours: hours === "1",
      };
}
export function createDurationListFormatter(
  profile: UnitFormatProfile,
  width: string,
): ListFormatter | undefined {
  if (width !== "long" && width !== "short" && width !== "narrow")
    return undefined;
  const pair = value(profile, 2, width + ".2"),
    start = value(profile, 2, width + ".start"),
    middle = value(profile, 2, width + ".middle"),
    end = value(profile, 2, width + ".end");
  if (
    pair === undefined ||
    start === undefined ||
    middle === undefined ||
    end === undefined
  )
    return undefined;
  // The shared list renderer uses this key only for contextual Spanish/Hebrew
  // rules; the actual inherited patterns come from this complete profile.
  return {
    locale: lookupListFormatLocale(profile.locale) ?? "en",
    type: "unit",
    style: width,
    pair,
    start,
    middle,
    end,
  };
}

/** The complete family required by DurationFormat and its internal NumberFormat
 * calls. Other public measurement units retain their existing availability. */
export function isTimeUnitIdentifier(unit: string): boolean {
  return "|year|month|week|day|hour|minute|second|millisecond|microsecond|nanosecond|".includes(
    "|" + unit + "|",
  );
}
