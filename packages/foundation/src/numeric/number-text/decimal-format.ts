import type { RoundingMode } from "../integer-rounding.ts";
import { roundDecimal, type DecimalQuantity } from "./decimal.ts";

/** Mathematical identity and visible precision are separate. The signed plain
 * decimal text preserves requested zeroes for later plural-operand extraction.
 * Materializing text costs space proportional to its length; Intl input policy
 * and the host's allocation limits belong to callers, not numeric rounding. */
export interface DecimalFormatResult {
  readonly quantity: DecimalQuantity;
  readonly text: string;
  readonly roundingMagnitude: number;
}
function zeroes(count: number): string {
  let result = "",
    block = "0";
  while (count > 0) {
    if (count % 2 !== 0) result += block;
    count = Math.floor(count / 2);
    if (count !== 0) block += block;
  }
  return result;
}
function plain(value: DecimalQuantity, minimumFraction: number): string {
  const digits = value.digits,
    point = value.exponent + digits.length;
  let integer = "",
    fraction = "";
  if (point <= 0) {
    integer = "0";
    fraction = zeroes(-point) + digits;
  } else if (point >= digits.length)
    integer = digits + zeroes(point - digits.length);
  else {
    integer = digits.slice(0, point);
    fraction = digits.slice(point);
  }
  if (fraction.length < minimumFraction)
    fraction += zeroes(minimumFraction - fraction.length);
  return (
    (value.negative ? "-" : "") +
    integer +
    (fraction.length === 0 ? "" : "." + fraction)
  );
}
/** ToRawFixed-style rounding. Observable option access/validation is separate. */
export function formatDecimalFraction(
  value: DecimalQuantity,
  minimum: number,
  maximum: number,
  increment: number,
  mode: RoundingMode,
): DecimalFormatResult | undefined {
  if (
    value.kind !== "finite" ||
    !Number.isInteger(minimum) ||
    !Number.isInteger(maximum) ||
    minimum < 0 ||
    minimum > maximum ||
    maximum > 100
  )
    return undefined;
  const quantity = roundDecimal(value, -maximum, increment, mode);
  if (quantity === undefined) return undefined;
  return {
    quantity,
    text: plain(quantity, minimum),
    roundingMagnitude: -maximum,
  };
}
/** ToRawPrecision-style rounding. Carries can change the displayed magnitude
 * and therefore the returned precision-priority rounding magnitude. */
export function formatDecimalPrecision(
  value: DecimalQuantity,
  minimum: number,
  maximum: number,
  mode: RoundingMode,
): DecimalFormatResult | undefined {
  if (
    value.kind !== "finite" ||
    !Number.isInteger(minimum) ||
    !Number.isInteger(maximum) ||
    minimum < 1 ||
    minimum > maximum ||
    maximum > 21
  )
    return undefined;
  const magnitude =
    value.digits === "0" ? 0 : value.exponent + (value.digits.length - 1);
  const quantum = magnitude - maximum + 1;
  const quantity = roundDecimal(value, quantum, 1, mode);
  if (quantity === undefined) return undefined;
  const roundedMagnitude =
    quantity.digits === "0"
      ? 0
      : quantity.exponent + (quantity.digits.length - 1);
  const minimumFraction = Math.max(0, minimum - (roundedMagnitude + 1));
  return {
    quantity,
    text: plain(quantity, minimumFraction),
    roundingMagnitude: roundedMagnitude - maximum + 1,
  };
}
