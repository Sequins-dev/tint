import type { Integer } from "@tint/foundation/numeric/big-integer";
import { splitTemporalEpochSecond } from "./temporal-epoch.ts";
import {
  tzifOffsetSecondsAt,
  type TzifZone,
} from "@tint/foundation/chrono/tzif";
import { viewObjectValue } from "./values.ts";
import {
  parseISODateTime,
  parseISOTimeZoneString,
} from "@tint/foundation/chrono/iso-date-time";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";
export interface TemporalFixedTimeZone {
  readonly kind: "fixed";
  readonly identifier: string;
  readonly offsetNanoseconds: number;
}
export interface TemporalNamedTimeZone {
  readonly kind: "named";
  readonly identifier: string;
  readonly primaryIdentifier: string | undefined;
  readonly model: TzifZone;
}
export type TemporalTimeZone = TemporalFixedTimeZone | TemporalNamedTimeZone;

/** Resolve at the exact instant. Keeping the model prevents a previous offset
 * observation from turning a named zone into an accidental fixed-offset zone. */
export function temporalTimeZoneOffsetNanoseconds(
  zone: TemporalTimeZone,
  epoch: Integer,
): number | undefined {
  if (zone.kind === "fixed") return zone.offsetNanoseconds;
  const split = splitTemporalEpochSecond(epoch);
  if (split === undefined) return undefined;
  const offset = tzifOffsetSecondsAt(zone.model, split.seconds);
  return offset === undefined || Math.abs(offset) >= 86400
    ? undefined
    : offset * 1000000000;
}

/** Exact Temporal offset rendering, independent of Date's minute-only GMT prefix. */
export function temporalTimeZoneOffsetText(nanoseconds: number): string {
  if (
    !Number.isSafeInteger(nanoseconds) ||
    Math.abs(nanoseconds) >= 86400000000000
  )
    throw "TEMPORAL_OFFSET_INVARIANT";
  const absolute = Math.abs(nanoseconds),
    seconds = Math.floor(absolute / 1000000000);
  let text =
    (nanoseconds < 0 ? "-" : "+") +
    String(Math.floor(seconds / 3600)).padStart(2, "0") +
    ":" +
    String(Math.floor(seconds / 60) % 60).padStart(2, "0");
  const fraction = absolute % 1000000000;
  if (seconds % 60 !== 0 || fraction !== 0)
    text += ":" + String(seconds % 60).padStart(2, "0");
  if (fraction !== 0) {
    let digits = String(fraction).padStart(9, "0");
    while (digits.endsWith("0")) digits = digits.slice(0, -1);
    text += "." + digits;
  }
  return text;
}
/** Minute matching and display share half-expand rounding, including -0 removal. */
export function roundTemporalOffsetNanoseconds(nanoseconds: number): number {
  if (
    !Number.isSafeInteger(nanoseconds) ||
    Math.abs(nanoseconds) >= 86400000000000
  )
    throw "TEMPORAL_OFFSET_INVARIANT";
  return (
    (nanoseconds < 0 ? -1 : 1) *
      Math.floor((Math.abs(nanoseconds) + 30000000000) / 60000000000) *
      60000000000 +
    0
  );
}
/** ISO Temporal strings display minute offsets, with half-expand rounding. */
export function temporalTimeZoneOffsetTextRounded(nanoseconds: number): string {
  const rounded = roundTemporalOffsetNanoseconds(nanoseconds);
  const minutes = Math.abs(rounded) / 60000000000;
  return (
    (rounded < 0 ? "-" : "+") +
    String(Math.floor(minutes / 60)).padStart(2, "0") +
    ":" +
    String(minutes % 60).padStart(2, "0")
  );
}

/** Primary identity is separate from data sharing and from numeric UTC offsets. */
export function temporalTimeZonesEqual(
  one: TemporalTimeZone,
  two: TemporalTimeZone,
  realm: ErrorRealm,
): boolean {
  if (one.identifier === two.identifier) return true;
  const a = one.kind === "fixed" ? one.identifier : one.primaryIdentifier;
  const b = two.kind === "fixed" ? two.identifier : two.primaryIdentifier;
  if (a === undefined || b === undefined)
    return rejectUnsupportedExecution(realm);
  return a === b;
}
/** UTC/fixed offsets are self-contained; named-zone availability needs a database adapter. */
export function temporalTimeZone(
  value: unknown,
  realm: ErrorRealm,
): TemporalTimeZone {
  if (typeof value !== "string") throw createRuntimeError(realm, "type");
  if (value === "Z" || value === "z") throw createRuntimeError(realm, "range");
  const isUTC =
    value.length === 3 &&
    (value.charAt(0) === "U" || value.charAt(0) === "u") &&
    (value.charAt(1) === "T" || value.charAt(1) === "t") &&
    (value.charAt(2) === "C" || value.charAt(2) === "c");
  if (isUTC) return { kind: "fixed", identifier: "UTC", offsetNanoseconds: 0 };
  if (value.charAt(0) !== "+" && value.charAt(0) !== "-") {
    if (parseISODateTime("1970-01-01T00:00[" + value + "]").error !== "none")
      throw createRuntimeError(realm, "range");
    const provider = realm.namedTimeZones;
    if (provider === undefined) return rejectUnsupportedExecution(realm);
    const found = provider.lookup(value);
    if (found.status === "unknown") throw createRuntimeError(realm, "range");
    if (found.status === "unavailable")
      return rejectUnsupportedExecution(realm);
    return {
      kind: "named",
      identifier: found.identifier.identifier,
      primaryIdentifier: found.identifier.primaryIdentifier,
      model: found.zone,
    };
  }
  if (value.length !== 3 && value.length !== 5 && value.length !== 6)
    throw createRuntimeError(realm, "range");
  const parsed = parseISODateTime("1970-01-01T00:00" + value),
    data = parsed.value;
  if (
    parsed.error !== "none" ||
    data === undefined ||
    data.offsetNanoseconds === undefined
  )
    throw createRuntimeError(realm, "range");
  const ns = data.offsetNanoseconds,
    minutes = Math.abs(ns) / 60000000000;
  const offset =
    (ns < 0 ? "-" : "+") +
    String(Math.floor(minutes / 60)).padStart(2, "0") +
    ":" +
    String(minutes % 60).padStart(2, "0");
  return { kind: "fixed", identifier: offset, offsetNanoseconds: ns };
}

/** General time-zone-like conversion, distinct from the constructor's identifier-only input. */
export function temporalTimeZoneLike(
  value: unknown,
  realm: ErrorRealm,
): TemporalTimeZone {
  const object = viewObjectValue(value, realm.objectPrototype);
  const zoned =
    object === undefined ? undefined : object.internalTemporalZonedDateTime;
  if (zoned !== undefined) return zoned.zone;
  if (typeof value !== "string") throw createRuntimeError(realm, "type");
  const identifier = parseISOTimeZoneString(value);
  if (identifier === undefined) throw createRuntimeError(realm, "range");
  return temporalTimeZone(identifier, realm);
}
