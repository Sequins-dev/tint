import { fromNumber, type Integer } from "@tint/foundation/numeric/big-integer";
import type { RoundingMode } from "@tint/foundation/numeric/integer-rounding";
import { stringValue } from "./coercion.ts";
import { temporalStringOption } from "./temporal-options.ts";
import { optionValue } from "./options.ts";
import { temporalRoundingMode } from "./temporal-rounding.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";
import type { ObjectHooks } from "./operations.ts";
export interface TemporalPrecisionOptions {
  readonly fractionalDigits: number;
  readonly smallestUnit: string;
  readonly mode: RoundingMode;
}
export interface TemporalPrecision {
  readonly digits: number;
  readonly increment: Integer;
}
/** Fractional precision has its own coercion step before later formatting options. */
export function temporalFractionalSecondDigits(
  options: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): number {
  const value = optionValue(options, "fractionalSecondDigits", realm, hooks);
  let fractionalDigits = -1;
  if (value !== undefined) {
    if (typeof value === "number") {
      fractionalDigits = Math.floor(value);
      if (
        !Number.isFinite(fractionalDigits) ||
        fractionalDigits < 0 ||
        fractionalDigits > 9
      )
        throw createRuntimeError(realm, "range");
    } else {
      const converted = stringValue(value, hooks, realm);
      if (converted.error === "unsupported")
        return rejectUnsupportedExecution(realm);
      if (converted.error !== "none") throw createRuntimeError(realm, "type");
      if (converted.value !== "auto") throw createRuntimeError(realm, "range");
    }
  }
  return fractionalDigits;
}
/** Read the unit now; API-specific validation follows all remaining option reads. */
export function temporalPrecisionUnit(
  options: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): string {
  return temporalStringOption(
    options,
    "smallestUnit",
    "",
    [
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
    ],
    realm,
    hooks,
  );
}
/** Read/cast precision options; API-specific algorithmic checks follow other option reads. */
export function readTemporalPrecisionOptions(
  options: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): TemporalPrecisionOptions {
  const fractionalDigits = temporalFractionalSecondDigits(
    options,
    realm,
    hooks,
  );
  const mode = temporalRoundingMode(options, "trunc", realm, hooks);
  const smallestUnit = temporalPrecisionUnit(options, realm, hooks);
  return { fractionalDigits, smallestUnit, mode };
}
export function resolveTemporalPrecision(
  options: TemporalPrecisionOptions,
  realm: ErrorRealm,
): TemporalPrecision {
  const unit = options.smallestUnit;
  let digits = options.fractionalDigits,
    quantum = 1;
  if (unit !== "") {
    if (unit === "minute" || unit === "minutes") {
      digits = -2;
      quantum = 60000000000;
    } else if (unit === "second" || unit === "seconds") {
      digits = 0;
      quantum = 1000000000;
    } else if (unit === "millisecond" || unit === "milliseconds") {
      digits = 3;
      quantum = 1000000;
    } else if (unit === "microsecond" || unit === "microseconds") {
      digits = 6;
      quantum = 1000;
    } else if (unit === "nanosecond" || unit === "nanoseconds") {
      digits = 9;
      quantum = 1;
    } else throw createRuntimeError(realm, "range");
  } else if (digits >= 0) for (let i = digits; i < 9; i++) quantum *= 10;
  const increment = fromNumber(quantum);
  if (increment === undefined) throw "TEMPORAL_PRECISION_INCREMENT_INVARIANT";
  return { digits, increment };
}
