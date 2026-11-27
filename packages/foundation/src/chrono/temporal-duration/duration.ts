import {
  fromNumber,
  add,
  multiply,
  compare,
  negate,
  divide,
  formatInteger,
  type Integer,
} from "../../numeric/big-integer.ts";
/** Immutable validated fields. Construct through createDuration; units remain unbalanced. */
export interface Duration {
  readonly years: number;
  readonly months: number;
  readonly weeks: number;
  readonly days: number;
  readonly hours: number;
  readonly minutes: number;
  readonly seconds: number;
  readonly milliseconds: number;
  readonly microseconds: number;
  readonly nanoseconds: number;
  readonly sign: number;
}
function integer(value: number): Integer {
  const result = fromNumber(value);
  if (result === undefined) throw "DURATION_INTEGER_INVARIANT";
  return result;
}
function sumNanoseconds(values: readonly number[], start: number): Integer {
  const factors = [
    86400000000000, 3600000000000, 60000000000, 1000000000, 1000000, 1000, 1,
  ];
  let total = integer(0);
  for (let i = start; i < 10; i++) {
    const value = values[i] ?? 0,
      factor = factors[i - 3];
    if (factor === undefined) throw "DURATION_UNIT_INVARIANT";
    total = add(total, multiply(integer(value), integer(factor)));
  }
  return total;
}
/** Years through nanoseconds in constructor order; omitted entries default to zero. */
export function createDuration(
  fields: readonly number[],
): Duration | undefined {
  const values: number[] = [];
  let sign = 0;
  for (let i = 0; i < 10; i++) {
    const value = fields[i] ?? 0;
    if (!Number.isFinite(value) || Math.trunc(value) !== value)
      return undefined;
    if (value !== 0) {
      const next = value < 0 ? -1 : 1;
      if (sign !== 0 && sign !== next) return undefined;
      sign = next;
    }
    if (i < 3 && Math.abs(value) >= 4294967296) return undefined;
    values.push(value === 0 ? 0 : value);
  }
  const total = sumNanoseconds(values, 3),
    magnitude = total.negative ? negate(total) : total;
  const limit = multiply(integer(9007199254740992), integer(1000000000));
  if (compare(magnitude, limit) >= 0) return undefined;
  return {
    years: values[0] ?? 0,
    months: values[1] ?? 0,
    weeks: values[2] ?? 0,
    days: values[3] ?? 0,
    hours: values[4] ?? 0,
    minutes: values[5] ?? 0,
    seconds: values[6] ?? 0,
    milliseconds: values[7] ?? 0,
    microseconds: values[8] ?? 0,
    nanoseconds: values[9] ?? 0,
    sign,
  };
}
export function durationFields(value: Duration): number[] {
  return [
    value.years,
    value.months,
    value.weeks,
    value.days,
    value.hours,
    value.minutes,
    value.seconds,
    value.milliseconds,
    value.microseconds,
    value.nanoseconds,
  ];
}
function decimal(value: Integer): string {
  const text = formatInteger(value, 10);
  if (text === undefined) throw "DURATION_DECIMAL_INVARIANT";
  return text;
}
/** Default ISO duration formatting; subsecond carry is exact even for unsafe integers. */
/** Format validated fields. A nonnegative precision requires an already rounded
 * value and retains exactly that many fractional second digits. */
export function durationText(value: Duration, digits: number = -1): string {
  let text = value.sign < 0 ? "-P" : "P";
  if (value.years !== 0) text += String(Math.abs(value.years)) + "Y";
  if (value.months !== 0) text += String(Math.abs(value.months)) + "M";
  if (value.weeks !== 0) text += String(Math.abs(value.weeks)) + "W";
  if (value.days !== 0) text += String(Math.abs(value.days)) + "D";
  const total = sumNanoseconds(durationFields(value), 6),
    magnitude = total.negative ? negate(total) : total;
  const parts = divide(magnitude, integer(1000000000));
  if (parts === undefined) throw "DURATION_DIVISION_INVARIANT";
  if (
    value.hours !== 0 ||
    value.minutes !== 0 ||
    magnitude.len !== 0 ||
    value.sign === 0 ||
    digits >= 0
  ) {
    text += "T";
    if (value.hours !== 0) text += String(Math.abs(value.hours)) + "H";
    if (value.minutes !== 0) text += String(Math.abs(value.minutes)) + "M";
    if (magnitude.len !== 0 || value.sign === 0 || digits >= 0) {
      text += decimal(parts.quotient);
      if (digits > 0 || (digits < 0 && parts.remainder.len !== 0)) {
        let fraction = decimal(parts.remainder).padStart(9, "0");
        if (digits >= 0) fraction = fraction.slice(0, digits);
        else while (fraction.endsWith("0")) fraction = fraction.slice(0, -1);
        text += "." + fraction;
      }
      text += "S";
    }
  }
  return text;
}

/** Exact hours-through-nanoseconds total. Calendar units are deliberately excluded. */
export function durationTimeNanoseconds(value: Duration): Integer {
  return sumNanoseconds(durationFields(value), 4);
}

export type DurationUnit =
  | "year"
  | "month"
  | "week"
  | "day"
  | "hour"
  | "minute"
  | "second"
  | "millisecond"
  | "microsecond"
  | "nanosecond";
/** The most significant nonzero field, without balancing or observable coercion. */
export function durationLargestUnit(value: Duration): DurationUnit {
  const fields = durationFields(value);
  const units: readonly DurationUnit[] = [
    "year",
    "month",
    "week",
    "day",
    "hour",
    "minute",
    "second",
    "millisecond",
    "microsecond",
    "nanosecond",
  ];
  for (let index = 0; index < fields.length; index++) {
    if ((fields[index] ?? 0) !== 0) {
      const unit = units[index];
      if (unit === undefined) throw "DURATION_LARGEST_UNIT_INVARIANT";
      return unit;
    }
  }
  return "nanosecond";
}
