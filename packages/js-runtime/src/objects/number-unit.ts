import { localeTableValue } from "./locale-canonicalization.ts";
import {
  lookupNumberFormatLocale,
  numberFormatLocaleKey,
} from "./number-format-profile.ts";
import {
  numberUnitLocaleRows,
  numberUnitProfiles,
  numberUnitFields,
  numberUnitStrings,
} from "./number-unit-data.ts";

/** NumberFormat unit patterns for one locale: per width, "unit.category",
 * "unit.per" (CLDR perUnitPattern) and "per" (the compound per pattern).
 * Fixed row-id fields rather than a list keep this record free of collection
 * types in the core Script surface. */
export interface NumberUnitProfile {
  readonly locale: string;
  readonly long: string;
  readonly short: string;
  readonly narrow: string;
}
export function createNumberUnitProfile(
  locale: string,
): NumberUnitProfile | undefined {
  const matched = lookupNumberFormatLocale(locale);
  if (matched === undefined) return undefined;
  const id = localeTableValue(
      numberUnitLocaleRows,
      numberFormatLocaleKey(matched),
    ),
    groups =
      id === undefined ? undefined : localeTableValue(numberUnitProfiles, id);
  if (groups === undefined) return undefined;
  const widths = groups.split(","),
    long = widths[0],
    short = widths[1],
    narrow = widths[2];
  if (
    widths.length !== 3 ||
    long === undefined ||
    short === undefined ||
    narrow === undefined
  )
    throw "NUMBER_UNIT_PROFILE_SHAPE_INVARIANT";
  return { locale: matched, long, short, narrow };
}
function value(
  profile: NumberUnitProfile,
  width: string,
  key: string,
): string | undefined {
  const id =
      width === "long"
        ? profile.long
        : width === "short"
          ? profile.short
          : profile.narrow,
    row = localeTableValue(numberUnitFields, id);
  if (row === undefined) throw "NUMBER_UNIT_PROFILE_INVARIANT";
  // Fields are sorted by key; scan the entry whose key matches exactly.
  const marker = "," + key + ":";
  const start = ("," + row).indexOf(marker);
  if (start < 0) return undefined;
  const from = start + marker.length - 1,
    end = row.indexOf(",", from);
  const text = localeTableValue(
    numberUnitStrings,
    end < 0 ? row.slice(from) : row.slice(from, end),
  );
  if (text === undefined) throw "NUMBER_UNIT_TEXT_INVARIANT";
  return text;
}
function simplePattern(
  profile: NumberUnitProfile,
  width: string,
  unit: string,
  category: string,
): string | undefined {
  return (
    value(profile, width, unit + "." + category) ??
    value(profile, width, unit + ".other")
  );
}
/** A denominator in a "per" compound uses its singular pattern with the
 * number placeholder and surrounding spaces removed (UTS #35 Part 6). */
function unitName(
  profile: NumberUnitProfile,
  width: string,
  unit: string,
): string {
  const pattern = simplePattern(profile, width, unit, "one");
  if (pattern === undefined) throw "NUMBER_UNIT_DENOMINATOR_INVARIANT";
  let name =
    pattern.indexOf("{0}") < 0 ? pattern : substitute(pattern, "{0}", "");
  while (name.length > 0 && isSpace(name.charCodeAt(0))) name = name.slice(1);
  while (name.length > 0 && isSpace(name.charCodeAt(name.length - 1)))
    name = name.slice(0, -1);
  return name;
}
/** Replace the first occurrence of a placeholder without replacement patterns. */
function substitute(
  pattern: string,
  placeholder: string,
  text: string,
): string {
  const index = pattern.indexOf(placeholder);
  if (index < 0) throw "NUMBER_UNIT_PLACEHOLDER_INVARIANT";
  return (
    pattern.slice(0, index) + text + pattern.slice(index + placeholder.length)
  );
}
function isSpace(code: number): boolean {
  return code === 0x20 || code === 0xa0 || code === 0x202f;
}
/** The "{0}" template for a sanctioned simple unit or an X-per-Y compound.
 * CLDR's predefined compounds (kilometer-per-hour, ...) win; otherwise the
 * denominator's perUnitPattern wraps the numerator, and otherwise the per
 * compound pattern joins the numerator and the denominator's unit name. */
export function numberUnitPattern(
  profile: NumberUnitProfile,
  width: string,
  unit: string,
  category: string,
): string | undefined {
  const direct = simplePattern(profile, width, unit, category);
  if (direct !== undefined) return direct;
  const split = unit.indexOf("-per-");
  if (split < 0) return undefined;
  const numerator = simplePattern(
      profile,
      width,
      unit.slice(0, split),
      category,
    ),
    denominator = unit.slice(split + 5);
  if (numerator === undefined) return undefined;
  const per = value(profile, width, denominator + ".per");
  if (per !== undefined) return substitute(per, "{0}", numerator);
  const compound = value(profile, width, "per");
  if (compound === undefined) throw "NUMBER_UNIT_COMPOUND_INVARIANT";
  return substitute(
    substitute(compound, "{0}", numerator),
    "{1}",
    unitName(profile, width, denominator),
  );
}

/** ECMA-402 sanctioned simple unit identifiers, sorted (AvailableCanonicalUnits). */
export function sanctionedSimpleUnits(): string[] {
  return [
    "acre",
    "bit",
    "byte",
    "celsius",
    "centimeter",
    "day",
    "degree",
    "fahrenheit",
    "fluid-ounce",
    "foot",
    "gallon",
    "gigabit",
    "gigabyte",
    "gram",
    "hectare",
    "hour",
    "inch",
    "kilobit",
    "kilobyte",
    "kilogram",
    "kilometer",
    "liter",
    "megabit",
    "megabyte",
    "meter",
    "microsecond",
    "mile",
    "mile-scandinavian",
    "milliliter",
    "millimeter",
    "millisecond",
    "minute",
    "month",
    "nanosecond",
    "ounce",
    "percent",
    "petabyte",
    "pound",
    "second",
    "stone",
    "terabit",
    "terabyte",
    "week",
    "yard",
    "year",
  ];
}
