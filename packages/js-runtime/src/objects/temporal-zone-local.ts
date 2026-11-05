import {
  add,
  subtract,
  toNumber,
  multiply,
  fromNumber,
  type Integer,
} from "@tint/foundation/numeric/big-integer";
import {
  analyzeTzifLocalSeconds,
  type TzifDisambiguation,
  type TzifLocalAnalysisSuccess,
} from "@tint/foundation/chrono/tzif";
import {
  addGregorianDate,
  type GregorianDate,
} from "@tint/foundation/chrono/gregorian-calendar";
import type { ISODateTime } from "@tint/foundation/chrono/iso-date-time";
import { combineTemporalDateTime } from "./temporal-date-time-conversion.ts";
import {
  temporalDateTimeCoordinate,
  temporalDateTimeEpoch,
  splitTemporalEpochSecond,
  validTemporalEpoch,
} from "./temporal-epoch.ts";
import {
  roundTemporalOffsetNanoseconds,
  type TemporalTimeZone,
  type TemporalNamedTimeZone,
} from "./temporal-time-zone.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";

function epochAtSecond(
  seconds: number,
  fraction: number,
  realm: ErrorRealm,
): Integer {
  const whole = fromNumber(seconds),
    part = fromNumber(fraction),
    billion = fromNumber(1000000000);
  if (whole === undefined || part === undefined || billion === undefined)
    throw "TEMPORAL_LOCAL_SECOND_INVARIANT";
  const epoch = add(multiply(whole, billion), part);
  if (!validTemporalEpoch(epoch)) throw createRuntimeError(realm, "range");
  return epoch;
}
function localParts(
  data: ISODateTime,
  realm: ErrorRealm,
): { readonly seconds: number; readonly fractionNanoseconds: number } {
  const coordinate = temporalDateTimeCoordinate(data);
  if (coordinate === undefined) throw createRuntimeError(realm, "range");
  const parts = splitTemporalEpochSecond(coordinate);
  if (parts === undefined) throw createRuntimeError(realm, "range");
  return parts;
}
function analyze(
  zone: TemporalNamedTimeZone,
  second: number,
  realm: ErrorRealm,
): TzifLocalAnalysisSuccess {
  const result = analyzeTzifLocalSeconds(zone.model, second);
  if (!result.ok) {
    if (result.error === "invalid") throw createRuntimeError(realm, "range");
    return rejectUnsupportedExecution(realm);
  }
  return result;
}

/** A skipped midnight starts at the transition, not at midnight plus the gap length. */
export function temporalStartOfDay(
  date: GregorianDate,
  zone: TemporalTimeZone,
  realm: ErrorRealm,
): Integer {
  const data = combineTemporalDateTime(
    date,
    { hour: 0, minute: 0, second: 0, nanosecond: 0 },
    realm,
  );
  if (zone.kind === "fixed") {
    const epoch = temporalDateTimeEpoch(data, zone.offsetNanoseconds);
    if (epoch === undefined) throw createRuntimeError(realm, "range");
    return epoch;
  }
  const parts = localParts(data, realm),
    result = analyze(zone, parts.seconds, realm);
  const first = result.candidates[0];
  if (first !== undefined) return epochAtSecond(first, 0, realm);
  const gap = result.gap;
  if (gap === undefined) throw "TEMPORAL_START_OF_DAY_INVARIANT";
  return epochAtSecond(gap.transitionEpochSeconds, 0, realm);
}

/** Exact/use interpretation bypasses matching; prefer/reject inspect all verified
 * candidates before applying the explicit overlap/gap disambiguation policy. */
export function interpretNamedZonedOffset(
  data: ISODateTime,
  zone: TemporalNamedTimeZone,
  supplied: number | undefined,
  policy: string,
  realm: ErrorRealm,
  mode: TzifDisambiguation,
  matchMinutes: boolean,
): Integer {
  if (!data.hasTime) return temporalStartOfDay(data.date, zone, realm);
  if (data.utc || (supplied !== undefined && policy === "use")) {
    const epoch = temporalDateTimeEpoch(data, data.utc ? 0 : (supplied ?? 0));
    if (epoch === undefined) throw createRuntimeError(realm, "range");
    return epoch;
  }
  const parts = localParts(data, realm),
    result = analyze(zone, parts.seconds, realm);
  if (supplied !== undefined && policy !== "ignore") {
    for (const candidate of result.candidates) {
      if (candidate === undefined) throw "TEMPORAL_LOCAL_CANDIDATE_INVARIANT";
      const seconds = parts.seconds - candidate;
      if (Math.abs(seconds) >= 86400) return rejectUnsupportedExecution(realm);
      const offset = seconds * 1000000000;
      if (
        offset === supplied ||
        (matchMinutes && roundTemporalOffsetNanoseconds(offset) === supplied)
      )
        return epochAtSecond(candidate, parts.fractionNanoseconds, realm);
    }
    if (policy === "reject") throw createRuntimeError(realm, "range");
  }
  const candidates = result.candidates;
  if (candidates.length > 0) {
    if (candidates.length > 1 && mode === "reject")
      throw createRuntimeError(realm, "range");
    const selected = candidates[mode === "later" ? candidates.length - 1 : 0];
    if (selected === undefined) throw "TEMPORAL_LOCAL_CANDIDATE_INVARIANT";
    return epochAtSecond(selected, parts.fractionNanoseconds, realm);
  }
  if (mode === "reject") throw createRuntimeError(realm, "range");
  const gap = result.gap;
  if (gap === undefined) throw "TEMPORAL_LOCAL_GAP_INVARIANT";
  return epochAtSecond(
    mode === "earlier" ? gap.earlierEpochSeconds : gap.laterEpochSeconds,
    parts.fractionNanoseconds,
    realm,
  );
}

/** Consecutive local dates can delimit shorter or longer exact days. */
export function temporalZonedDayBounds(
  date: GregorianDate,
  zone: TemporalTimeZone,
  realm: ErrorRealm,
): { readonly start: Integer; readonly end: Integer } {
  const next = addGregorianDate(date, 0, 0, 0, 1, "reject");
  if (next === undefined) throw createRuntimeError(realm, "range");
  return {
    start: temporalStartOfDay(date, zone, realm),
    end: temporalStartOfDay(next, zone, realm),
  };
}

export function temporalZonedHoursInDay(
  date: GregorianDate,
  zone: TemporalTimeZone,
  realm: ErrorRealm,
): number {
  const bounds = temporalZonedDayBounds(date, zone, realm);
  return toNumber(subtract(bounds.end, bounds.start)) / 3600000000000;
}
