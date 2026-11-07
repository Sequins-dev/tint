import {
  durationFields,
  type Duration,
} from "@tint/foundation/chrono/temporal-duration";
import {
  fromNumber,
  add,
  multiply,
  formatInteger,
  type Integer,
} from "@tint/foundation/numeric/big-integer";
import {
  decimalFromString,
  type DecimalQuantity,
} from "@tint/foundation/numeric/number-text";
import {
  createDecimalNumberFormatter,
  decimalNumberParts,
} from "./decimal-number-format.ts";
import type {
  NumberFormatDigitOptions,
  NumberOptionAccess,
} from "./intl-number-options.ts";
import { formatListParts, type ListFormatter } from "./list-format.ts";
import {
  createUnitFormatProfile,
  createDurationListFormatter,
  unitFormatDigital,
  type UnitDigitalFormat,
} from "./unit-format.ts";

export interface DurationUnitOptions {
  readonly style: string;
  readonly display: string;
}
export interface DurationFormatOptions {
  readonly style: string;
  readonly units: DurationUnitOptions[];
  readonly fractionalDigits: number | undefined;
}
export interface DurationFormatter {
  readonly locale: string;
  readonly numberingSystem: string;
  readonly options: DurationFormatOptions;
  readonly list: ListFormatter;
  readonly digital: UnitDigitalFormat;
}
export interface DurationFormatPart {
  readonly type: string;
  readonly value: string;
  readonly unit?: string;
}
export function durationUnitName(index: number): string {
  const names =
    "year|month|week|day|hour|minute|second|millisecond|microsecond|nanosecond".split(
      "|",
    );
  const name = names[index];
  if (name === undefined) throw "DURATION_UNIT_INDEX_INVARIANT";
  return name;
}
function stringOption(
  access: NumberOptionAccess,
  key: string,
  allowed: string,
  fallback: string,
): string {
  const input = access.read(key),
    value = input === undefined ? fallback : access.string(input);
  if (!("|" + allowed + "|").includes("|" + value + "|"))
    return access.reject("range");
  return value;
}
/** Observable reads and conversions remain supplied by the embedding. Unit
 * options are read in significance order, display immediately after style. */
export function resolveDurationFormatOptions(
  access: NumberOptionAccess,
  twoDigitHours: boolean,
): DurationFormatOptions {
  const style = stringOption(
      access,
      "style",
      "long|short|narrow|digital",
      "short",
    ),
    units: DurationUnitOptions[] = [];
  let previous = "";
  for (let index = 0; index < 10; index++) {
    const name = durationUnitName(index) + "s",
      input = access.read(name);
    let unitStyle = input === undefined ? "" : access.string(input),
      displayDefault = "always";
    const allowed =
      index < 4
        ? "long|short|narrow"
        : index < 7
          ? "long|short|narrow|numeric|2-digit"
          : "long|short|narrow|numeric";
    if (
      input !== undefined &&
      !("|" + allowed + "|").includes("|" + unitStyle + "|")
    )
      return access.reject("range");
    const previousNumeric =
      previous === "numeric" ||
      previous === "2-digit" ||
      previous === "fractional";
    if (input === undefined) {
      if (style === "digital") {
        unitStyle = index < 4 ? "short" : "numeric";
        if (index < 4 || index > 6) displayDefault = "auto";
      } else if (previousNumeric) {
        unitStyle = "numeric";
        if (index !== 5 && index !== 6) displayDefault = "auto";
      } else {
        unitStyle = style;
        displayDefault = "auto";
      }
    }
    if (index > 6 && unitStyle === "numeric") {
      unitStyle = "fractional";
      displayDefault = "auto";
    }
    const display = stringOption(
      access,
      name + "Display",
      "auto|always",
      displayDefault,
    );
    if (
      (unitStyle === "fractional" && display === "always") ||
      (previous === "fractional" && unitStyle !== "fractional") ||
      (previousNumeric &&
        unitStyle !== "numeric" &&
        unitStyle !== "2-digit" &&
        unitStyle !== "fractional")
    )
      return access.reject("range");
    if (
      (index === 4 &&
        twoDigitHours &&
        (unitStyle === "numeric" || unitStyle === "2-digit")) ||
      ((index === 5 || index === 6) &&
        (previous === "numeric" || previous === "2-digit"))
    )
      unitStyle = "2-digit";
    units.push({ style: unitStyle, display });
    if (index >= 4 && index <= 8) previous = unitStyle;
  }
  const rawFraction = access.read("fractionalDigits");
  let fractionalDigits: number | undefined = undefined;
  if (rawFraction !== undefined) {
    const number = access.number(rawFraction);
    if (!(number >= 0 && number <= 9)) return access.reject("range");
    fractionalDigits = Math.floor(number);
  }
  return { style, units, fractionalDigits };
}
export function createDurationFormatter(
  locale: string,
  numberingSystem: string,
  options: DurationFormatOptions,
): DurationFormatter | undefined {
  const profile = createUnitFormatProfile(locale);
  if (profile === undefined) return undefined;
  const list = createDurationListFormatter(
      profile,
      options.style === "digital" ? "short" : options.style,
    ),
    digital = unitFormatDigital(profile, numberingSystem);
  if (list === undefined || digital === undefined) return undefined;
  return { locale, numberingSystem, options, list, digital };
}
function exactInteger(value: number): Integer {
  const result = fromNumber(value);
  if (result === undefined) throw "DURATION_INTEGER_INVARIANT";
  return result;
}
/** fromNumber preserves the mathematical value of unsafe binary64 integers.
 * Converting through Number's shortest decimal spelling would lose low bits. */
function quantity(
  fields: readonly number[],
  index: number,
  fractional: boolean,
  negativeZero: boolean,
): DecimalQuantity {
  const base = fields[index];
  if (base === undefined) throw "DURATION_FIELD_INVARIANT";
  let total = exactInteger(base),
    exponent = 0;
  if (fractional) {
    const thousand = exactInteger(1000);
    for (let next = index + 1; next < 10; next++) {
      const field = fields[next];
      if (field === undefined) throw "DURATION_FIELD_INVARIANT";
      total = add(multiply(total, thousand), exactInteger(field));
      exponent -= 3;
    }
  }
  const text = formatInteger(total, 10);
  if (text === undefined) throw "DURATION_INTEGER_TEXT_INVARIANT";
  const result = decimalFromString(text + "e" + String(exponent));
  if (result === undefined) throw "DURATION_QUANTITY_INVARIANT";
  return negativeZero && result.digits === "0"
    ? { kind: "finite", negative: true, digits: "0", exponent: 0 }
    : result;
}
function unitOptions(
  formatter: DurationFormatter,
  index: number,
): DurationUnitOptions {
  const result: DurationUnitOptions | undefined =
    formatter.options.units[index];
  if (result === undefined) throw "DURATION_OPTIONS_INVARIANT";
  return result;
}
function nextFractional(formatter: DurationFormatter, index: number): boolean {
  return (
    index >= 6 &&
    index <= 8 &&
    unitOptions(formatter, index + 1).style === "fractional"
  );
}
function numberParts(
  formatter: DurationFormatter,
  fields: readonly number[],
  index: number,
  sign: boolean,
  negative: boolean,
): DurationFormatPart[] {
  const options = unitOptions(formatter, index),
    numeric = options.style === "numeric" || options.style === "2-digit",
    fractional = nextFractional(formatter, index),
    value = quantity(fields, index, fractional, sign && negative),
    digits: NumberFormatDigitOptions = {
      minimumIntegerDigits: options.style === "2-digit" ? 2 : 1,
      minimumFractionDigits: fractional
        ? (formatter.options.fractionalDigits ?? 0)
        : 0,
      maximumFractionDigits: fractional
        ? (formatter.options.fractionalDigits ?? 9)
        : 0,
      minimumSignificantDigits: undefined,
      maximumSignificantDigits: undefined,
      roundingIncrement: 1,
      roundingMode: "trunc",
      roundingType: "fraction-digits",
      roundingPriority: "auto",
      trailingZeroDisplay: "auto",
    };
  const width =
      options.style === "long"
        ? "long"
        : options.style === "narrow"
          ? "narrow"
          : "short",
    unit = durationUnitName(index),
    nf = createDecimalNumberFormatter(
      formatter.locale,
      formatter.numberingSystem,
      digits,
      numeric ? false : "auto",
      sign ? "auto" : "never",
      numeric ? "decimal" : "unit",
      width,
      undefined,
      unit,
    );
  if (nf === undefined) throw "DURATION_NUMBER_FORMAT_INVARIANT";
  const result: DurationFormatPart[] = [];
  for (const part of decimalNumberParts(nf, value))
    result.push({ type: part.type, value: part.value, unit });
  return result;
}
export function durationFormatParts(
  formatter: DurationFormatter,
  duration: Duration,
): DurationFormatPart[] {
  const fields = durationFields(duration),
    groups: DurationFormatPart[][] = [],
    strings: string[] = [];
  let sign = true;
  for (let index = 0; index < 10; index++) {
    const options = unitOptions(formatter, index);
    if (options.style === "fractional") break;
    const numeric = options.style === "numeric" || options.style === "2-digit",
      fractional = nextFractional(formatter, index),
      value = quantity(fields, index, fractional, false);
    if (numeric) {
      const seconds = quantity(fields, 6, nextFractional(formatter, 6), false),
        hourDisplayed =
          index === 4 &&
          ((fields[4] ?? 0) !== 0 || options.display === "always"),
        secondsDisplayed =
          seconds.digits !== "0" ||
          unitOptions(formatter, 6).display === "always",
        minutesDisplayed =
          index <= 5 &&
          ((hourDisplayed && secondsDisplayed) ||
            (fields[5] ?? 0) !== 0 ||
            unitOptions(formatter, 5).display === "always"),
        parts: DurationFormatPart[] = [];
      for (let timeIndex = index; timeIndex <= 6; timeIndex++) {
        const displayed =
          timeIndex === 4
            ? hourDisplayed
            : timeIndex === 5
              ? minutesDisplayed
              : secondsDisplayed;
        if (!displayed) continue;
        if (parts.length > 0)
          parts.push({
            type: "literal",
            value:
              timeIndex === 5
                ? formatter.digital.hourMinuteSeparator
                : formatter.digital.minuteSecondSeparator,
          });
        for (const part of numberParts(
          formatter,
          fields,
          timeIndex,
          sign,
          duration.sign < 0,
        ))
          parts.push(part);
        sign = false;
      }
      if (parts.length > 0) groups.push(parts);
      break;
    }
    if (value.digits !== "0" || options.display === "always") {
      groups.push(
        numberParts(formatter, fields, index, sign, duration.sign < 0),
      );
      sign = false;
    }
    if (fractional) break;
  }
  for (const group of groups) {
    let string = "";
    for (const part of group) string += part.value;
    strings.push(string);
  }
  const result: DurationFormatPart[] = [];
  let groupIndex = 0;
  for (const part of formatListParts(formatter.list, strings)) {
    if (part.type === "literal")
      result.push({ type: "literal", value: part.value });
    else {
      const group = groups[groupIndex++];
      if (group === undefined) throw "DURATION_LIST_GROUP_INVARIANT";
      for (const entry of group) result.push(entry);
    }
  }
  return result;
}
