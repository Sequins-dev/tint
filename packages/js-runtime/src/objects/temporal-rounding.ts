import { fromNumber, type Integer } from "@tint/foundation/numeric/big-integer";
import {
  parseRoundingMode,
  type RoundingMode,
} from "@tint/foundation/numeric/integer-rounding";
import { type ObjectHooks } from "./operations.ts";
import { numberValue } from "./coercion.ts";
import { viewObjectValue } from "./values.ts";
import { temporalStringOption } from "./temporal-options.ts";
import { optionValue } from "./options.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";
export interface TemporalRounding {
  readonly increment: Integer;
  readonly mode: RoundingMode;
}
export function temporalTimeUnitNanoseconds(unit: string): number | undefined {
  if (unit === "hour" || unit === "hours") return 3600000000000;
  if (unit === "minute" || unit === "minutes") return 60000000000;
  if (unit === "second" || unit === "seconds") return 1000000000;
  if (unit === "millisecond" || unit === "milliseconds") return 1000000;
  if (unit === "microsecond" || unit === "microseconds") return 1000;
  if (unit === "nanosecond" || unit === "nanoseconds") return 1;
  return undefined;
}
export function temporalRoundingIncrement(
  options: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): number {
  const value = optionValue(options, "roundingIncrement", realm, hooks);
  if (value === undefined) return 1;
  const converted = numberValue(value, hooks, realm);
  if (converted.error === "unsupported")
    return rejectUnsupportedExecution(realm);
  if (converted.error !== "none") throw createRuntimeError(realm, "type");
  if (!Number.isFinite(converted.value))
    throw createRuntimeError(realm, "range");
  const increment = Math.trunc(converted.value);
  if (increment < 1 || increment > 1000000000)
    throw createRuntimeError(realm, "range");
  return increment;
}
export function temporalRoundingMode(
  options: unknown,
  fallback: string,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): RoundingMode {
  const text = temporalStringOption(
    options,
    "roundingMode",
    fallback,
    [
      "ceil",
      "floor",
      "expand",
      "trunc",
      "halfCeil",
      "halfFloor",
      "halfExpand",
      "halfTrunc",
      "halfEven",
    ],
    realm,
    hooks,
  );
  const mode = parseRoundingMode(text);
  if (mode === undefined) throw "TEMPORAL_ROUNDING_MODE_INVARIANT";
  return mode;
}
interface TimeRoundingOptions {
  readonly increment: number;
  readonly mode: RoundingMode;
  readonly factor: number;
}
/** Read/cast all rounding options before API-specific divisibility checks. */
function readTimeRoundingOptions(
  value: unknown,
  dayAllowed: boolean,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): TimeRoundingOptions {
  let increment = 1,
    mode: RoundingMode = "halfExpand",
    unit = "";
  if (typeof value === "string") unit = value;
  else {
    if (viewObjectValue(value, realm.objectPrototype) === undefined)
      throw createRuntimeError(realm, "type");
    increment = temporalRoundingIncrement(value, realm, hooks);
    mode = temporalRoundingMode(value, "halfExpand", realm, hooks);
    unit = temporalStringOption(
      value,
      "smallestUnit",
      "",
      [
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
      ],
      realm,
      hooks,
    );
  }
  const factor =
    dayAllowed && (unit === "day" || unit === "days")
      ? 86400000000000
      : temporalTimeUnitNanoseconds(unit);
  if (factor === undefined) throw createRuntimeError(realm, "range");
  return { increment, mode, factor };
}
function roundingQuantum(options: TimeRoundingOptions): TemporalRounding {
  const quantum = fromNumber(options.factor * options.increment);
  if (quantum === undefined) throw "TEMPORAL_ROUNDING_INCREMENT_INVARIANT";
  return { increment: quantum, mode: options.mode };
}
export function instantRoundingOptions(
  value: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): TemporalRounding {
  const options = readTimeRoundingOptions(value, false, realm, hooks);
  const increment = options.increment,
    factor = options.factor;
  const maximum = 86400000000000 / factor;
  if (increment > maximum || maximum % increment !== 0)
    throw createRuntimeError(realm, "range");
  return roundingQuantum(options);
}
export function plainTimeRoundingOptions(
  value: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): TemporalRounding {
  return clockRoundingOptions(value, false, realm, hooks);
}
export function plainDateTimeRoundingOptions(
  value: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): TemporalRounding {
  return clockRoundingOptions(value, true, realm, hooks);
}
function clockRoundingOptions(
  value: unknown,
  dayAllowed: boolean,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): TemporalRounding {
  const options = readTimeRoundingOptions(value, dayAllowed, realm, hooks);
  const increment = options.increment,
    factor = options.factor;
  const maximum =
    factor === 3600000000000 ? 24 : factor >= 1000000000 ? 60 : 1000;
  if (
    factor === 86400000000000
      ? increment !== 1
      : increment >= maximum || maximum % increment !== 0
  )
    throw createRuntimeError(realm, "range");
  return roundingQuantum(options);
}
