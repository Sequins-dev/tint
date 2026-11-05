import {
  localeTableValue,
  printLocaleLanguage,
} from "./locale-canonicalization.ts";
import { parseLocaleId } from "./locale-id.ts";
import {
  numberFormatLocaleRows,
  numberFormatBindings,
  numberFormatProfiles,
  numberingSystemDigits,
} from "./number-format-data.ts";

export interface NumberSymbols {
  readonly decimal: string;
  readonly group: string;
  readonly percentSign: string;
  readonly plusSign: string;
  readonly minusSign: string;
  readonly exponential: string;
  readonly infinity: string;
  readonly nan: string;
  readonly approximatelySign: string;
  readonly currencyDecimal: string;
  readonly currencyGroup: string;
}
export interface NumberFormatProfile {
  readonly locale: string;
  readonly numberingSystem: string;
  /** Ten Unicode code points, including noncontiguous/astral mappings. Decode
   * once at formatter construction; UTF16 indexing is not digit indexing. */
  readonly digits: string;
  readonly symbols: NumberSymbols;
  readonly primaryGrouping: number;
  readonly secondaryGrouping: number;
  readonly minimumGroupingDigits: number;
  readonly pattern: string;
}
export interface NumberFormatLocaleData {
  readonly locale: string;
  readonly defaultNumberingSystem: string;
  readonly numberingSystems: readonly string[];
}
export function numberFormatLocaleKey(text: string): string {
  let result = "";
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index);
    result += String.fromCharCode(unit >= 65 && unit <= 90 ? unit + 32 : unit);
  }
  return result;
}
/** Lookup actual complete numeric-service locale data. Canonicalization and
 * Unicode numbering-system negotiation remain observable adapter operations. */
export function lookupNumberFormatLocale(
  canonicalTag: string,
): string | undefined {
  const parts: string[] = [];
  let unicode = false,
    privateUse = false;
  for (const part of numberFormatLocaleKey(canonicalTag).split("-")) {
    if (part === undefined) throw "NUMBER_LOCALE_PART_INVARIANT";
    if (!privateUse && part.length === 1) {
      if (part === "x") privateUse = true;
      unicode = part === "u";
    }
    if (!unicode) parts.push(part);
  }
  let candidate = parts.join("-");
  while (true) {
    if (localeTableValue(numberFormatLocaleRows, candidate) !== undefined) {
      const parsed = parseLocaleId(candidate);
      if (parsed === undefined || parsed.extensions.length !== 0)
        throw "NUMBER_LOCALE_DATA_INVARIANT";
      return printLocaleLanguage(parsed.language, false);
    }
    const split = candidate.lastIndexOf("-");
    if (split < 0) return undefined;
    candidate = candidate.slice(0, split);
    if (
      candidate.length >= 2 &&
      candidate.charCodeAt(candidate.length - 2) === 45
    )
      candidate = candidate.slice(0, -2);
  }
}
function bindingData(locale: string): string | undefined {
  const row = localeTableValue(
    numberFormatLocaleRows,
    numberFormatLocaleKey(locale),
  );
  if (row === undefined) return undefined;
  const split = row.indexOf(",");
  return localeTableValue(numberFormatBindings, row.slice(split + 1));
}
/** Availability reflects complete numeric mappings/profiles, not CLDR's
 * native/traditional/finance preference labels or algorithmic systems. */
export function numberFormatLocaleData(
  locale: string,
): NumberFormatLocaleData | undefined {
  const matched = lookupNumberFormatLocale(locale);
  if (matched === undefined) return undefined;
  const row = localeTableValue(
      numberFormatLocaleRows,
      numberFormatLocaleKey(matched),
    ),
    bindings = bindingData(matched);
  if (row === undefined || bindings === undefined)
    throw "NUMBER_LOCALE_BINDING_INVARIANT";
  const systems: string[] = [];
  for (const entry of bindings.split(";")) {
    if (entry === undefined) throw "NUMBER_SYSTEM_BINDING_INVARIANT";
    systems.push(entry.slice(0, entry.indexOf(",")));
  }
  return {
    locale: matched,
    defaultNumberingSystem: row.slice(0, row.indexOf(",")),
    numberingSystems: systems,
  };
}
function field(fields: readonly string[], index: number): string {
  const value = fields[index];
  if (value === undefined) throw "NUMBER_PROFILE_FIELD_INVARIANT";
  return value;
}
function integer(text: string): number {
  let value = 0;
  for (let index = 0; index < text.length; index++)
    value = value * 10 + text.charCodeAt(index) - 48;
  return value;
}
/** Decode an actual standard decimal profile. An unsupported explicit system
 * returns undefined; the adapter owns fallback and Unicode-extension precedence.
 * All pinned CLDR grades are included, preserving their exact sign/symbol text. */
export function createNumberFormatProfile(
  locale: string,
  numberingSystem: string | undefined = undefined,
): NumberFormatProfile | undefined {
  const matched = lookupNumberFormatLocale(locale);
  if (matched === undefined) return undefined;
  const row = localeTableValue(
      numberFormatLocaleRows,
      numberFormatLocaleKey(matched),
    ),
    bindings = bindingData(matched);
  if (row === undefined || bindings === undefined)
    throw "NUMBER_PROFILE_BINDING_INVARIANT";
  const system = numberingSystem ?? row.slice(0, row.indexOf(",")),
    digits = localeTableValue(numberingSystemDigits, system);
  if (digits === undefined) return undefined;
  let id: string | undefined = undefined;
  for (const entry of bindings.split(";")) {
    if (entry === undefined) throw "NUMBER_PROFILE_SYSTEM_INVARIANT";
    const split = entry.indexOf(",");
    if (entry.slice(0, split) === system) {
      id = entry.slice(split + 1);
      break;
    }
  }
  const encoded =
    id === undefined ? undefined : localeTableValue(numberFormatProfiles, id);
  if (encoded === undefined) return undefined;
  const fields = encoded.split("\t");
  return {
    locale: matched,
    numberingSystem: system,
    digits,
    symbols: {
      decimal: field(fields, 0),
      group: field(fields, 1),
      percentSign: field(fields, 2),
      plusSign: field(fields, 3),
      minusSign: field(fields, 4),
      exponential: field(fields, 5),
      infinity: field(fields, 6),
      nan: field(fields, 7),
      approximatelySign: field(fields, 8),
      currencyDecimal: field(fields, 9),
      currencyGroup: field(fields, 10),
    },
    primaryGrouping: integer(field(fields, 11)),
    secondaryGrouping: integer(field(fields, 12)),
    minimumGroupingDigits: integer(field(fields, 13)),
    pattern: field(fields, 14),
  };
}
