import { decimalFromNumber } from "@tint/foundation/numeric/number-text";
import { localeTableValue } from "./locale-canonicalization.ts";
import {
  lookupNumberFormatLocale,
  numberFormatLocaleKey,
} from "./number-format-profile.ts";
import {
  decimalNumberParts,
  type DecimalNumberFormatter,
} from "./decimal-number-format.ts";
import { createPluralRuleSet } from "./plural-rules.ts";
import { resolvePlural, type PluralFormatter } from "./plural-format.ts";
import {
  relativeTimeLocales,
  relativeTimeProfiles,
  relativeTimeFields,
  relativeTimeStrings,
} from "./relative-time-data.ts";
export type RelativeTimeStyle = "long" | "short" | "narrow";
export type RelativeTimeNumeric = "always" | "auto";
export interface RelativeTimePart {
  readonly type: string;
  readonly value: string;
  readonly unit: string | undefined;
}
export interface RelativeTimeFormatter {
  readonly number: DecimalNumberFormatter;
  readonly plural: PluralFormatter;
  readonly style: RelativeTimeStyle;
  readonly numeric: RelativeTimeNumeric;
  readonly fields: readonly string[];
}
/** Uses the numeric service's locale registry; all advertised locales have
 * complete inherited relative fields in the generated CLDR profile table. */
export function createRelativeTimeFormatter(
  number: DecimalNumberFormatter,
  style: RelativeTimeStyle,
  numeric: RelativeTimeNumeric,
): RelativeTimeFormatter | undefined {
  if (number.style !== "decimal") return undefined;
  const locale = lookupNumberFormatLocale(number.locale);
  if (locale === undefined) return undefined;
  const id = localeTableValue(
    relativeTimeLocales,
    numberFormatLocaleKey(locale),
  );
  const profile =
    id === undefined ? undefined : localeTableValue(relativeTimeProfiles, id);
  const rules = createPluralRuleSet(locale, "cardinal");
  if (profile === undefined || rules === undefined) return undefined;
  return {
    number,
    style,
    numeric,
    fields: profile.split(","),
    plural: {
      locale,
      type: "cardinal",
      notation: "standard",
      compactDisplay: undefined,
      digits: number.digitOptions,
      rules,
    },
  };
}
function pattern(field: string, key: string): string | undefined {
  const entries = localeTableValue(relativeTimeFields, field);
  if (entries === undefined) throw "RELATIVE_TIME_FIELD_INVARIANT";
  for (const entry of entries.split(",")) {
    if (entry === undefined) throw "RELATIVE_TIME_ENTRY_INVARIANT";
    const split = entry.indexOf(":");
    if (entry.slice(0, split) === key) {
      const text = localeTableValue(
        relativeTimeStrings,
        entry.slice(split + 1),
      );
      if (text === undefined) throw "RELATIVE_TIME_STRING_INVARIANT";
      return text;
    }
  }
  return undefined;
}
/** Coercions and public realm errors belong to the adapter. Preserve the sign
 * of zero for tense selection while inserting the absolute formatted number. */
export function relativeTimeParts(
  formatter: RelativeTimeFormatter,
  value: number,
  inputUnit: string,
): RelativeTimePart[] | undefined {
  if (!Number.isFinite(value)) return undefined;
  const unit = inputUnit.endsWith("s") ? inputUnit.slice(0, -1) : inputUnit;
  const units = [
      "second",
      "minute",
      "hour",
      "day",
      "week",
      "month",
      "quarter",
      "year",
    ],
    index = units.indexOf(unit);
  if (index < 0) return undefined;
  const style =
    formatter.style === "long" ? 0 : formatter.style === "short" ? 1 : 2;
  const field = formatter.fields[index * 3 + style];
  if (field === undefined) throw "RELATIVE_TIME_PROFILE_INVARIANT";
  if (formatter.numeric === "auto") {
    const automatic = pattern(field, String(value));
    if (automatic !== undefined)
      return [{ type: "literal", value: automatic, unit: undefined }];
  }
  const quantity = decimalFromNumber(Math.abs(value)),
    category = resolvePlural(formatter.plural, quantity).category;
  const tense = value < 0 || (value === 0 && 1 / value < 0) ? "past" : "future";
  const text =
    pattern(field, tense + "." + category) ?? pattern(field, tense + ".other");
  if (text === undefined) throw "RELATIVE_TIME_PATTERN_INVARIANT";
  const numbers = decimalNumberParts(formatter.number, quantity),
    result: RelativeTimePart[] = [];
  let start = 0;
  while (start < text.length) {
    const marker = text.indexOf("{0}", start);
    const end = marker < 0 ? text.length : marker;
    if (end > start)
      result.push({
        type: "literal",
        value: text.slice(start, end),
        unit: undefined,
      });
    if (marker < 0) break;
    for (const part of numbers) {
      if (part === undefined) throw "RELATIVE_TIME_NUMBER_PART_INVARIANT";
      result.push({ type: part.type, value: part.value, unit });
    }
    start = marker + 3;
  }
  return result;
}
