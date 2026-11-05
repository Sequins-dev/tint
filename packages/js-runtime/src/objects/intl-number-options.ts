import {
  parseRoundingMode,
  type RoundingMode,
} from "@tint/foundation/numeric/integer-rounding";
import {
  formatDecimalFraction,
  formatDecimalPrecision,
  type DecimalQuantity,
  type DecimalFormatResult,
} from "@tint/foundation/numeric/number-text";

export type NumberNotation =
  "standard" | "scientific" | "engineering" | "compact";
export type RoundingPriority = "auto" | "morePrecision" | "lessPrecision";
export type NumberRoundingType =
  | "fraction-digits"
  | "significant-digits"
  | "more-precision"
  | "less-precision";
/** The embedding supplies observable Get, ToNumber, ToString and realm-local
 * errors. This core never substitutes host coercions for Script operations. */
export interface NumberOptionAccess {
  readonly read: (key: string) => unknown;
  readonly number: (value: unknown) => number;
  readonly string: (value: unknown) => string;
  readonly reject: (kind: "type" | "range") => never;
}
export interface NumberFormatDigitOptions {
  readonly minimumIntegerDigits: number;
  readonly minimumFractionDigits: number | undefined;
  readonly maximumFractionDigits: number | undefined;
  readonly minimumSignificantDigits: number | undefined;
  readonly maximumSignificantDigits: number | undefined;
  readonly roundingIncrement: number;
  readonly roundingMode: RoundingMode;
  readonly roundingType: NumberRoundingType;
  /** Computed value: compact defaults can turn requested auto into morePrecision. */
  readonly roundingPriority: RoundingPriority;
  readonly trailingZeroDisplay: "auto" | "stripIfInteger";
}
function defaultNumberOption(
  access: NumberOptionAccess,
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number | undefined,
): number | undefined {
  if (value === undefined) return fallback;
  const number = access.number(value);
  if (!(number >= minimum && number <= maximum)) return access.reject("range");
  return Math.floor(number);
}
function numberOption(
  access: NumberOptionAccess,
  key: string,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  const value = defaultNumberOption(
    access,
    access.read(key),
    minimum,
    maximum,
    fallback,
  );
  if (value === undefined) throw "NUMBER_OPTION_DEFAULT_INVARIANT";
  return value;
}
function stringOption(
  access: NumberOptionAccess,
  key: string,
  fallback: string,
): string {
  const value = access.read(key);
  return value === undefined ? fallback : access.string(value);
}
function allowedIncrement(value: number): boolean {
  return (
    value === 1 ||
    value === 2 ||
    value === 5 ||
    value === 10 ||
    value === 20 ||
    value === 25 ||
    value === 50 ||
    value === 100 ||
    value === 200 ||
    value === 250 ||
    value === 500 ||
    value === 1000 ||
    value === 2000 ||
    value === 2500 ||
    value === 5000
  );
}
/** ECMA-402 SetNumberFormatDigitOptions. The caller supplies already resolved
 * style defaults and notation; locale/unit/notation options are separate. */
export function resolveNumberFormatDigitOptions(
  access: NumberOptionAccess,
  minFDDefault: number,
  maxFDDefault: number,
  notation: NumberNotation,
): NumberFormatDigitOptions {
  const minimumIntegerDigits = numberOption(
    access,
    "minimumIntegerDigits",
    1,
    21,
    1,
  );
  const minFD = access.read("minimumFractionDigits");
  const maxFD = access.read("maximumFractionDigits");
  const minSD = access.read("minimumSignificantDigits");
  const maxSD = access.read("maximumSignificantDigits");
  const roundingIncrement = numberOption(
    access,
    "roundingIncrement",
    1,
    5000,
    1,
  );
  if (!allowedIncrement(roundingIncrement)) return access.reject("range");
  const mode = parseRoundingMode(
    stringOption(access, "roundingMode", "halfExpand"),
  );
  if (mode === undefined) return access.reject("range");
  const priority = stringOption(access, "roundingPriority", "auto");
  if (
    priority !== "auto" &&
    priority !== "morePrecision" &&
    priority !== "lessPrecision"
  )
    return access.reject("range");
  const trailing = stringOption(access, "trailingZeroDisplay", "auto");
  if (trailing !== "auto" && trailing !== "stripIfInteger")
    return access.reject("range");

  const maximumDefault = roundingIncrement === 1 ? maxFDDefault : minFDDefault;
  const hasSD = minSD !== undefined || maxSD !== undefined;
  const hasFD = minFD !== undefined || maxFD !== undefined;
  const needSD = priority !== "auto" || hasSD;
  const needFD =
    priority !== "auto" || (!hasSD && (hasFD || notation !== "compact"));
  let minimumSignificantDigits: number | undefined = undefined;
  let maximumSignificantDigits: number | undefined = undefined;
  let minimumFractionDigits: number | undefined = undefined;
  let maximumFractionDigits: number | undefined = undefined;
  if (needSD) {
    if (hasSD) {
      const minimum = defaultNumberOption(access, minSD, 1, 21, 1);
      if (minimum === undefined) throw "SIGNIFICANT_MINIMUM_INVARIANT";
      const maximum = defaultNumberOption(access, maxSD, minimum, 21, 21);
      if (maximum === undefined) throw "SIGNIFICANT_MAXIMUM_INVARIANT";
      minimumSignificantDigits = minimum;
      maximumSignificantDigits = maximum;
    } else {
      minimumSignificantDigits = 1;
      maximumSignificantDigits = 21;
    }
  }
  if (needFD) {
    if (hasFD) {
      const minimum = defaultNumberOption(access, minFD, 0, 100, undefined);
      const maximum = defaultNumberOption(access, maxFD, 0, 100, undefined);
      // hasFD guarantees at least one side is present; neither default path
      // coerces a value again, including when it came from an accessor object.
      if (minimum === undefined) {
        if (maximum === undefined) throw "FRACTION_DEFAULT_INVARIANT";
        minimumFractionDigits = Math.min(minFDDefault, maximum);
        maximumFractionDigits = maximum;
      } else if (maximum === undefined) {
        minimumFractionDigits = minimum;
        maximumFractionDigits = Math.max(maximumDefault, minimum);
      } else {
        if (minimum > maximum) return access.reject("range");
        minimumFractionDigits = minimum;
        maximumFractionDigits = maximum;
      }
    } else {
      minimumFractionDigits = minFDDefault;
      maximumFractionDigits = maximumDefault;
    }
  }
  let roundingType: NumberRoundingType = "fraction-digits";
  let roundingPriority: RoundingPriority = "auto";
  if (!needSD && !needFD) {
    minimumFractionDigits = 0;
    maximumFractionDigits = 0;
    minimumSignificantDigits = 1;
    maximumSignificantDigits = 2;
    roundingType = "more-precision";
    roundingPriority = "morePrecision";
  } else if (priority === "morePrecision") {
    roundingType = "more-precision";
    roundingPriority = priority;
  } else if (priority === "lessPrecision") {
    roundingType = "less-precision";
    roundingPriority = priority;
  } else if (hasSD) roundingType = "significant-digits";
  if (roundingIncrement !== 1) {
    if (roundingType !== "fraction-digits") return access.reject("type");
    if (maximumFractionDigits !== minimumFractionDigits)
      return access.reject("range");
  }
  return {
    minimumIntegerDigits,
    minimumFractionDigits,
    maximumFractionDigits,
    minimumSignificantDigits,
    maximumSignificantDigits,
    roundingIncrement,
    roundingMode: mode,
    roundingType,
    roundingPriority,
    trailingZeroDisplay: trailing,
  };
}
function significant(
  value: DecimalQuantity,
  options: NumberFormatDigitOptions,
): DecimalFormatResult | undefined {
  const minimum = options.minimumSignificantDigits;
  const maximum = options.maximumSignificantDigits;
  if (minimum === undefined || maximum === undefined) return undefined;
  return formatDecimalPrecision(value, minimum, maximum, options.roundingMode);
}
function fractional(
  value: DecimalQuantity,
  options: NumberFormatDigitOptions,
): DecimalFormatResult | undefined {
  const minimum = options.minimumFractionDigits;
  const maximum = options.maximumFractionDigits;
  if (minimum === undefined || maximum === undefined) return undefined;
  return formatDecimalFraction(
    value,
    minimum,
    maximum,
    options.roundingIncrement,
    options.roundingMode,
  );
}
/** FormatNumericToString's finite numerical stage. Text is unsigned, including
 * negative zero; the returned mathematical quantity retains the original sign.
 * Locale sign patterns and notation scaling belong to the service adapter. */
export function formatIntlDecimal(
  value: DecimalQuantity,
  options: NumberFormatDigitOptions,
): DecimalFormatResult | undefined {
  if (value.kind !== "finite") return undefined;
  let chosen: DecimalFormatResult | undefined = undefined;
  if (options.roundingType === "significant-digits")
    chosen = significant(value, options);
  else if (options.roundingType === "fraction-digits")
    chosen = fractional(value, options);
  else {
    const significantResult = significant(value, options);
    if (significantResult === undefined) return undefined;
    const fractionResult = fractional(value, options);
    if (fractionResult === undefined) return undefined;
    const fixedIsMorePrecise =
      fractionResult.roundingMagnitude < significantResult.roundingMagnitude;
    chosen =
      options.roundingType === "more-precision"
        ? fixedIsMorePrecise
          ? fractionResult
          : significantResult
        : fixedIsMorePrecise
          ? significantResult
          : fractionResult;
  }
  if (chosen === undefined) return undefined;
  const quantity = chosen.quantity,
    roundingMagnitude = chosen.roundingMagnitude;
  let text = quantity.negative ? chosen.text.slice(1) : chosen.text;
  if (
    options.trailingZeroDisplay === "stripIfInteger" &&
    (quantity.digits === "0" || quantity.exponent >= 0)
  ) {
    const point = text.indexOf(".");
    if (point !== -1) text = text.slice(0, point);
  }
  const point = text.indexOf(".");
  const integerDigits = point === -1 ? text.length : point;
  let prefix = "";
  for (let i = integerDigits; i < options.minimumIntegerDigits; i++)
    prefix += "0";
  return {
    quantity,
    text: prefix + text,
    roundingMagnitude,
  };
}
