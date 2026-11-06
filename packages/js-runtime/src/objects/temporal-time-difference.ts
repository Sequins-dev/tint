import { fromNumber, type Integer } from "@tint/foundation/numeric/big-integer";
import {
  roundInteger,
  type RoundingMode,
} from "@tint/foundation/numeric/integer-rounding";
import {
  balanceTimeDuration,
  type Duration,
} from "@tint/foundation/chrono/temporal-duration";
import { temporalStringOption } from "./temporal-options.ts";
import {
  temporalRoundingIncrement,
  temporalRoundingMode,
  temporalTimeUnitNanoseconds,
} from "./temporal-rounding.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
import type { ObjectHooks } from "./operations.ts";
export const temporalDifferenceUnitNames: readonly string[] = [
  "auto",
  "year",
  "years",
  "month",
  "months",
  "week",
  "weeks",
  "day",
  "days",
  "hour",
  "hours",
  "minute",
  "minutes",
  "second",
  "seconds",
  "millisecond",
  "milliseconds",
  "microsecond",
  "microseconds",
  "nanosecond",
  "nanoseconds",
];

export function temporalDifferenceUnit(
  options: unknown,
  name: string,
  fallback: string,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): string {
  return temporalStringOption(
    options,
    name,
    fallback,
    temporalDifferenceUnitNames,
    realm,
    hooks,
  );
}

export interface TemporalDifferenceSettings {
  readonly largestUnit: string;
  readonly smallestUnit: string;
  readonly increment: number;
  readonly mode: RoundingMode;
}
function canonicalUnit(unit: string): string {
  return unit.endsWith("s") ? unit.slice(0, -1) : unit;
}
function unitRank(unit: string): number {
  switch (unit) {
    case "year":
      return 0;
    case "month":
      return 1;
    case "week":
      return 2;
    case "day":
      return 3;
    case "hour":
      return 4;
    case "minute":
      return 5;
    case "second":
      return 6;
    case "millisecond":
      return 7;
    case "microsecond":
      return 8;
    case "nanosecond":
      return 9;
    default:
      return -1;
  }
}
/** Read all options before checking unit categories, rank and divisibility. */
export function readTemporalDifferenceSettings(
  options: unknown,
  defaultLargest: string,
  category: "time" | "date-time" | "date" | "year-month",
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): TemporalDifferenceSettings {
  const largestUnit = canonicalUnit(
    temporalDifferenceUnit(options, "largestUnit", "auto", realm, hooks),
  );
  const increment = temporalRoundingIncrement(options, realm, hooks);
  const mode = temporalRoundingMode(options, "trunc", realm, hooks);
  const smallestUnit = canonicalUnit(
    temporalDifferenceUnit(
      options,
      "smallestUnit",
      category === "date"
        ? "day"
        : category === "year-month"
          ? "month"
          : "nanosecond",
      realm,
      hooks,
    ),
  );
  return normalizeTemporalDifferenceSettings(
    largestUnit,
    smallestUnit,
    defaultLargest,
    category,
    increment,
    mode,
    realm,
  );
}
/** Pure normalization lets independently ordered option readers share the same
 * categories, default-unit selection and clock-increment divisibility rules. */
export function normalizeTemporalDifferenceSettings(
  largest: string,
  smallest: string,
  defaultLargest: string,
  category: "time" | "date-time" | "date" | "year-month",
  increment: number,
  mode: RoundingMode,
  realm: ErrorRealm,
): TemporalDifferenceSettings {
  let largestUnit = canonicalUnit(largest);
  const smallestUnit = canonicalUnit(smallest);
  if (!Number.isInteger(increment) || increment < 1 || increment > 1000000000)
    throw createRuntimeError(realm, "range");
  const smallestRank = unitRank(smallestUnit),
    fallbackRank = unitRank(canonicalUnit(defaultLargest));
  if (smallestRank < 0 || fallbackRank < 0)
    throw createRuntimeError(realm, "range");
  if (largestUnit === "auto")
    largestUnit =
      smallestRank < fallbackRank
        ? smallestUnit
        : canonicalUnit(defaultLargest);
  const largestRank = unitRank(largestUnit);
  if (
    largestRank < 0 ||
    largestRank > smallestRank ||
    (category === "time" && (largestRank < 4 || smallestRank < 4)) ||
    (category === "date" && (largestRank >= 4 || smallestRank >= 4)) ||
    (category === "year-month" && (largestRank >= 2 || smallestRank >= 2))
  )
    throw createRuntimeError(realm, "range");
  if (smallestRank >= 4) {
    const factor = temporalTimeUnitNanoseconds(smallestUnit);
    if (factor === undefined) throw "TEMPORAL_DIFFERENCE_UNIT_INVARIANT";
    const maximum =
      factor === 3600000000000 ? 24 : factor >= 1000000000 ? 60 : 1000;
    if (increment >= maximum || maximum % increment !== 0)
      throw createRuntimeError(realm, "range");
  }
  return { largestUnit, smallestUnit, increment, mode };
}
/** Apply validated clock-unit settings to an exact signed result-direction delta. */
export function balanceTemporalTimeDifference(
  delta: Integer,
  settings: TemporalDifferenceSettings,
  realm: ErrorRealm,
): Duration {
  const smallest = temporalTimeUnitNanoseconds(settings.smallestUnit),
    largest = temporalTimeUnitNanoseconds(settings.largestUnit);
  if (smallest === undefined || largest === undefined)
    throw createRuntimeError(realm, "range");
  const quantum = fromNumber(smallest * settings.increment);
  if (quantum === undefined) throw "TEMPORAL_DIFFERENCE_QUANTUM_INVARIANT";
  const rounded = roundInteger(delta, quantum, settings.mode);
  if (rounded === undefined) throw "TEMPORAL_DIFFERENCE_ROUND_INVARIANT";
  const factors = [3600000000000, 60000000000, 1000000000, 1000000, 1000, 1];
  let index = 0;
  while (index < factors.length && factors[index] !== largest) index++;
  const result = balanceTimeDuration(rounded, index);
  if (result === undefined) throw createRuntimeError(realm, "range");
  return result;
}
/** Instant/PlainTime supply a signed delta after converting both operands. */
export function temporalTimeDifference(
  delta: Integer,
  options: unknown,
  defaultLargest: string,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): Duration {
  return balanceTemporalTimeDifference(
    delta,
    readTemporalDifferenceSettings(
      options,
      defaultLargest,
      "time",
      realm,
      hooks,
    ),
    realm,
  );
}
