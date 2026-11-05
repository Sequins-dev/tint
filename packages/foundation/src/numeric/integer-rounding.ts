import {
  divide,
  compare,
  negate,
  multiply,
  add,
  fromNumber,
  type Integer,
} from "./big-integer.ts";
export type RoundingMode =
  | "ceil"
  | "floor"
  | "expand"
  | "trunc"
  | "halfCeil"
  | "halfFloor"
  | "halfExpand"
  | "halfTrunc"
  | "halfEven";
export function parseRoundingMode(text: string): RoundingMode | undefined {
  if (text === "ceil") return "ceil";
  if (text === "floor") return "floor";
  if (text === "expand") return "expand";
  if (text === "trunc") return "trunc";
  if (text === "halfCeil") return "halfCeil";
  if (text === "halfFloor") return "halfFloor";
  if (text === "halfExpand") return "halfExpand";
  if (text === "halfTrunc") return "halfTrunc";
  if (text === "halfEven") return "halfEven";
  return undefined;
}
/** Exact signed rounding to a positive increment; invalid increments return undefined. */
export function roundInteger(
  value: Integer,
  increment: Integer,
  mode: RoundingMode,
): Integer | undefined {
  if (
    increment.negative ||
    increment.digits.length === 0 ||
    parseRoundingMode(mode) === undefined
  )
    return undefined;
  const split = divide(value, increment);
  if (split === undefined) throw "ROUNDING_DIVISION_INVARIANT";
  if (split.remainder.digits.length === 0) return value;
  const negative = value.negative;
  let away = false;
  if (mode === "ceil") away = !negative;
  else if (mode === "floor") away = negative;
  else if (mode === "expand") away = true;
  else if (mode !== "trunc") {
    const magnitude = split.remainder.negative
      ? negate(split.remainder)
      : split.remainder;
    const distance = compare(add(magnitude, magnitude), increment);
    if (distance > 0) away = true;
    else if (distance === 0)
      away =
        mode === "halfCeil"
          ? !negative
          : mode === "halfFloor"
            ? negative
            : mode === "halfExpand"
              ? true
              : mode === "halfTrunc"
                ? false
                : (split.quotient.digits[0] ?? 0) % 2 !== 0;
  }
  let quotient = split.quotient;
  if (away) {
    const step = fromNumber(negative ? -1 : 1);
    if (step === undefined) throw "ROUNDING_STEP_INVARIANT";
    quotient = add(quotient, step);
  }
  return multiply(quotient, increment);
}
/** Temporal.Instant treats expand/trunc directions as positive even before the epoch. */
export function roundIntegerAsIfPositive(
  value: Integer,
  increment: Integer,
  mode: RoundingMode,
): Integer | undefined {
  const adjusted: RoundingMode =
    mode === "expand"
      ? "ceil"
      : mode === "trunc"
        ? "floor"
        : mode === "halfExpand"
          ? "halfCeil"
          : mode === "halfTrunc"
            ? "halfFloor"
            : mode;
  return roundInteger(value, increment, adjusted);
}
