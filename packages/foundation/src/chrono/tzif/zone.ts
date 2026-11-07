import { readTzif, type TzifData, type TzifLocalType } from "./reader.ts";
import { readPosixTimeZone, type PosixTimeZone } from "./posix.ts";
import { posixOffsetSecondsAt, posixDaylightSavingAt } from "./posix-offset.ts";
export type TzifUnspecifiedOffsetPolicy = "unavailable" | "stored";
export interface TzifZone {
  readonly unspecifiedOffsetPolicy: TzifUnspecifiedOffsetPolicy;
  readonly data: TzifData;
  /** Out-of-safe-integer transitions saturate to infinities for safe-integer queries.
   * The original, exact words remain in data; ordering was checked by the reader. */
  readonly transitionSeconds: readonly number[];
  readonly future: PosixTimeZone | undefined;
  readonly futureStatus: "absent" | "ready" | "unsupported";
}
export type TzifZoneError =
  | "INVALID_TZIF"
  | "LEAP_SECONDS_UNSUPPORTED"
  | "INVALID_POSIX_TZ"
  | "FOOTER_OFFSET_MISMATCH";
export type TzifZoneResult =
  | { readonly ok: true; readonly value: TzifZone }
  | { readonly ok: false; readonly error: TzifZoneError };
function knownOffset(
  type: TzifLocalType | undefined,
  policy: TzifUnspecifiedOffsetPolicy,
): number | undefined {
  if (type === undefined) return undefined;
  const name = type.designation;
  return policy === "unavailable" &&
    name.length === 3 &&
    name[0] === 45 &&
    name[1] === 48 &&
    name[2] === 48
    ? undefined
    : type.offsetSeconds;
}
function futureOffset(
  future: PosixTimeZone | undefined,
  second: number,
  policy: TzifUnspecifiedOffsetPolicy,
): number | undefined {
  if (future === undefined) return undefined;
  const offset = posixOffsetSecondsAt(future, second);
  if (policy === "stored" || offset === undefined) return offset;
  if (future.kind === "fixed")
    return future.name === "-00" ? undefined : offset;
  // Equal standard/daylight offsets cannot disambiguate an unspecified name;
  // conservatively retain unavailable in that ambiguous generic-reader case.
  if (
    (future.standardName === "-00" &&
      offset === future.standardOffsetSeconds) ||
    (future.daylightName === "-00" && offset === future.daylightOffsetSeconds)
  )
    return undefined;
  return offset;
}
/** Prepare once, preserving exact input data and an explicit future-data horizon. */
export function createTzifZone(
  bytes: Uint8Array,
  unspecifiedOffsetPolicy: TzifUnspecifiedOffsetPolicy = "unavailable",
): TzifZoneResult {
  const parsed = readTzif(bytes);
  if (!parsed.ok) return parsed;
  const data = parsed.value,
    transitionSeconds: number[] = [];
  for (const entry of data.transitions) {
    if (entry === undefined) throw "TZIF_TRANSITION_INVARIANT";
    const high =
      entry.at.hi >= 2147483648 ? entry.at.hi - 4294967296 : entry.at.hi;
    const second = high * 4294967296 + entry.at.lo;
    transitionSeconds.push(
      Number.isSafeInteger(second) ? second : high < 0 ? -Infinity : Infinity,
    );
  }
  let future: PosixTimeZone | undefined = undefined;
  let futureStatus: "absent" | "ready" | "unsupported" = "absent";
  const footer = data.footer;
  if (footer !== undefined && footer.length > 0) {
    const parsed = readPosixTimeZone(footer, data.version >= 3);
    if (!parsed.ok) {
      if (parsed.error === "INVALID_POSIX_TZ")
        return { ok: false, error: "INVALID_POSIX_TZ" };
      futureStatus = "unsupported";
    } else {
      future = parsed.value;
      futureStatus = "ready";
    }
  }
  const last = transitionSeconds[transitionSeconds.length - 1],
    lastEntry = data.transitions[data.transitions.length - 1];
  if (
    future !== undefined &&
    last !== undefined &&
    lastEntry !== undefined &&
    Number.isSafeInteger(last)
  ) {
    const offset = posixOffsetSecondsAt(future, last);
    const lastType = data.types[lastEntry.type];
    if (
      offset !== undefined &&
      lastType !== undefined &&
      offset !== lastType.offsetSeconds
    )
      return { ok: false, error: "FOOTER_OFFSET_MISMATCH" };
  }
  return {
    ok: true,
    value: {
      data,
      transitionSeconds,
      future,
      futureStatus,
      unspecifiedOffsetPolicy,
    },
  };
}
/** Historical lookup is logarithmic. Unknown horizons stay unavailable; -00
 * designations follow the selected policy. Final recorded offsets are not extrapolated. */
export function tzifOffsetSecondsAt(
  zone: TzifZone,
  second: number,
): number | undefined {
  if (!Number.isSafeInteger(second)) return undefined;
  const times = zone.transitionSeconds,
    last = times[times.length - 1],
    future = zone.future;
  if (times.length === 0) {
    if (zone.futureStatus !== "absent")
      return futureOffset(future, second, zone.unspecifiedOffsetPolicy);
    return knownOffset(zone.data.types[0], zone.unspecifiedOffsetPolicy);
  }
  if (last === undefined) throw "TZIF_TRANSITION_INVARIANT";
  if (second >= last)
    return futureOffset(future, second, zone.unspecifiedOffsetPolicy);
  return knownOffset(
    historicalType(zone, second),
    zone.unspecifiedOffsetPolicy,
  );
}
function historicalType(
  zone: TzifZone,
  second: number,
): TzifLocalType | undefined {
  const times = zone.transitionSeconds;
  let low = 0,
    high = times.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2),
      at = times[middle];
    if (at === undefined) throw "TZIF_TRANSITION_INVARIANT";
    if (at <= second) low = middle + 1;
    else high = middle;
  }
  const entry = zone.data.transitions[low - 1];
  return zone.data.types[entry === undefined ? 0 : entry.type];
}
/** Preserve the database's seasonal identity for localized zone names. Never
 * infer daylight saving by comparing January/July or by offset magnitude. */
export function tzifDaylightSavingAt(
  zone: TzifZone,
  second: number,
): boolean | undefined {
  if (tzifOffsetSecondsAt(zone, second) === undefined) return undefined;
  const last = zone.transitionSeconds[zone.transitionSeconds.length - 1];
  if (
    (last === undefined && zone.futureStatus !== "absent") ||
    (last !== undefined && second >= last)
  ) {
    const future = zone.future;
    return future === undefined
      ? undefined
      : posixDaylightSavingAt(future, second);
  }
  const type = historicalType(zone, second);
  return type === undefined ? undefined : type.daylightSaving;
}
