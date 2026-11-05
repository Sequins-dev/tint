import {
  divide,
  fromNumber,
  toNumber,
  type Integer,
} from "../../numeric/big-integer.ts";
import { createDuration, type Duration } from "./duration.ts";
/** Balance an exact signed time total, with largest unit indexed hour=0 through ns=5.
 * Each Number field is converted independently, preserving specified FP rounding. */
export function balanceTimeDuration(
  total: Integer,
  largest: number,
): Duration | undefined {
  if (!Number.isInteger(largest) || largest < 0 || largest > 5)
    return undefined;
  const factors = [3600000000000, 60000000000, 1000000000, 1000000, 1000, 1];
  const fields = [0, 0, 0, 0];
  let remaining = total;
  for (let i = 0; i < 6; i++) {
    if (i < largest) {
      fields.push(0);
      continue;
    }
    const factor = fromNumber(factors[i] ?? 1);
    if (factor === undefined) throw "DURATION_BALANCE_FACTOR_INVARIANT";
    const part = divide(remaining, factor);
    if (part === undefined) throw "DURATION_BALANCE_DIVISION_INVARIANT";
    fields.push(toNumber(part.quotient));
    remaining = part.remainder;
  }
  return createDuration(fields);
}
