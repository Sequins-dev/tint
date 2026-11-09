import { localeTableValue } from "./locale-canonicalization.ts";
import { numberFormatLocaleKey } from "./number-format-profile.ts";
import {
  currencyNameLocaleRows,
  currencyUnitPatternRows,
  currencyNameFields,
  currencyNameStrings,
} from "./currency-name-data.ts";

/** Field key for a plural category ("" is the plain display name). */
function categoryKey(category: string): string {
  if (category === "zero") return "z";
  if (category === "one") return "o";
  if (category === "two") return "t";
  if (category === "few") return "f";
  if (category === "many") return "m";
  if (category === "other") return "x";
  return "d";
}
/** One locale's own value for a currency key, without inheritance. */
function ownValue(
  locale: string,
  code: string,
  key: string,
): string | undefined {
  const row = localeTableValue(currencyNameLocaleRows, locale);
  if (row === undefined) return undefined;
  const split = row.indexOf(";"),
    field = localeTableValue(currencyNameFields, row.slice(split + 1));
  if (field === undefined) throw "CURRENCY_NAME_FIELD_INVARIANT";
  const start = ("," + field).indexOf("," + code + "/");
  if (start < 0) return undefined;
  const end = field.indexOf(",", start),
    entry = end < 0 ? field.slice(start) : field.slice(start, end);
  const marker = "/" + key + "=",
    at = entry.indexOf(marker);
  if (at < 0) return undefined;
  const from = at + marker.length,
    stop = entry.indexOf("/", from);
  const text = localeTableValue(
    currencyNameStrings,
    stop < 0 ? entry.slice(from) : entry.slice(from, stop),
  );
  if (text === undefined) throw "CURRENCY_NAME_TEXT_INVARIANT";
  return text;
}
function parentOf(locale: string): string | undefined {
  const row = localeTableValue(currencyNameLocaleRows, locale);
  if (row === undefined) return undefined;
  const parent = row.slice(0, row.indexOf(";"));
  return parent === "" ? undefined : parent;
}
/** CLDR inherits each path separately: look for the key in the locale and its
 * parents before falling back to a less specific key. */
function inherited(
  locale: string,
  code: string,
  key: string,
): string | undefined {
  let current: string | undefined = locale;
  while (current !== undefined) {
    const value = ownValue(current, code, key);
    if (value !== undefined) return value;
    current = parentOf(current);
  }
  return undefined;
}
/** The long currency name for currencyDisplay "name": the plural form for the
 * category, else "other", else the display name, else the ISO code. */
export function currencyLongName(
  locale: string,
  code: string,
  category: string,
): string {
  const key = numberFormatLocaleKey(locale);
  return (
    inherited(key, code, categoryKey(category)) ??
    inherited(key, code, "x") ??
    inherited(key, code, "d") ??
    code
  );
}
/** The "{0} {1}" currency unit pattern for a locale, numbering system and
 * plural category ("other" when the category has no pattern). */
export function currencyUnitPattern(
  locale: string,
  numberingSystem: string,
  category: string,
): string {
  const row = localeTableValue(
    currencyUnitPatternRows,
    numberFormatLocaleKey(locale),
  );
  if (row === undefined) throw "CURRENCY_UNIT_PATTERN_LOCALE_INVARIANT";
  const split = row.indexOf(";");
  let id = split < 0 ? row : row.slice(0, split);
  if (split >= 0)
    for (const exception of row.slice(split + 1).split(",")) {
      if (exception === undefined) throw "CURRENCY_UNIT_PATTERN_INVARIANT";
      const colon = exception.indexOf(":");
      if (exception.slice(0, colon) === numberingSystem)
        id = exception.slice(colon + 1);
    }
  const field = localeTableValue(currencyNameFields, id);
  if (field === undefined) throw "CURRENCY_UNIT_PATTERN_FIELD_INVARIANT";
  let other: string | undefined = undefined;
  for (const entry of field.split(",")) {
    if (entry === undefined) throw "CURRENCY_UNIT_PATTERN_ENTRY_INVARIANT";
    const colon = entry.indexOf(":"),
      text = localeTableValue(currencyNameStrings, entry.slice(colon + 1));
    if (text === undefined) throw "CURRENCY_UNIT_PATTERN_TEXT_INVARIANT";
    const name = entry.slice(0, colon);
    if (name === category) return text;
    if (name === "other") other = text;
  }
  if (other === undefined) throw "CURRENCY_UNIT_PATTERN_OTHER_INVARIANT";
  return other;
}

/** AvailableCanonicalCurrencies: ISO 4217 codes with CLDR display names in
 * the English data, sorted; every one formats with currencyDisplay "name". */
export function availableCurrencyCodes(): string[] {
  const row = localeTableValue(currencyNameLocaleRows, "en");
  if (row === undefined) throw "CURRENCY_NAME_LOCALE_INVARIANT";
  const field = localeTableValue(
    currencyNameFields,
    row.slice(row.indexOf(";") + 1),
  );
  if (field === undefined) throw "CURRENCY_NAME_FIELD_INVARIANT";
  const codes: string[] = [];
  for (const entry of field.split(",")) {
    if (entry === undefined) throw "CURRENCY_NAME_ENTRY_INVARIANT";
    const code = entry.slice(0, 3);
    if (codes.length === 0 || codes[codes.length - 1] !== code)
      codes.push(code);
  }
  return codes;
}
