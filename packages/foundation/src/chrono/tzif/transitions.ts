import { gregorianCoordinateFromEpochDay } from "../gregorian-calendar/index.ts";
import { posixTransitionEpochSeconds } from "./posix-offset.ts";
import { tzifOffsetSecondsAt, type TzifZone } from "./zone.ts";
export interface TzifTransitionQuery {
  readonly epochSeconds: number;
  readonly direction: "next" | "previous";
  readonly inclusive: boolean;
  readonly minimum: number;
  readonly maximum: number;
}
export type TzifTransitionResult =
  | { readonly ok: true; readonly epochSeconds: number | undefined }
  | { readonly ok: false; readonly error: "invalid" | "unavailable" };

/** Find actual offset changes, skipping designation-only changes. Explicit query
 * bounds let adapters clip their own instant domain without guessing a horizon. */
export function findTzifTransition(
  zone: TzifZone,
  query: TzifTransitionQuery,
): TzifTransitionResult {
  const second = query.epochSeconds,
    forward = query.direction === "next";
  if (
    !Number.isSafeInteger(second) ||
    !Number.isSafeInteger(query.minimum) ||
    !Number.isSafeInteger(query.maximum) ||
    query.minimum > second ||
    second > query.maximum ||
    (query.direction !== "next" && query.direction !== "previous")
  )
    return { ok: false, error: "invalid" };
  if (!query.inclusive && second === (forward ? query.maximum : query.minimum))
    return { ok: true, epochSeconds: undefined };
  if (tzifOffsetSecondsAt(zone, second) === undefined)
    return { ok: false, error: "unavailable" };
  let best: number | undefined = undefined,
    unknown: number | undefined = undefined;
  function nearer(one: number, two: number): boolean {
    return forward ? one < two : one > two;
  }
  function consider(at: number): void {
    if (
      !Number.isSafeInteger(at) ||
      at < query.minimum ||
      at > query.maximum ||
      (forward ? at < second : at > second) ||
      (!query.inclusive && at === second)
    )
      return;
    const before = tzifOffsetSecondsAt(zone, at - 1),
      after = tzifOffsetSecondsAt(zone, at);
    if (before === undefined || after === undefined) {
      const previous = unknown;
      if (previous === undefined || nearer(at, previous)) unknown = at;
    } else if (before !== after) {
      const previous = best;
      if (previous === undefined || nearer(at, previous)) best = at;
    }
  }
  for (const at of zone.transitionSeconds) {
    if (at === undefined) throw "TZIF_TRANSITION_INVARIANT";
    consider(at);
  }
  const last = zone.transitionSeconds[zone.transitionSeconds.length - 1],
    future = zone.future;
  if (future === undefined) {
    if (zone.transitionSeconds.length === 0 && zone.futureStatus === "absent") {
      if (tzifOffsetSecondsAt(zone, second) === undefined)
        return { ok: false, error: "unavailable" };
    } else {
      const horizon = last ?? query.minimum,
        current = best;
      const affected = forward
        ? query.maximum >= horizon &&
          (current === undefined || current >= horizon)
        : second > horizon || (query.inclusive && second === horizon);
      if (affected) return { ok: false, error: "unavailable" };
    }
  } else if (future.kind === "alternating") {
    const horizon = Math.max(query.minimum, last ?? query.minimum),
      current = best;
    const affected = forward
      ? query.maximum >= horizon &&
        (current === undefined || current >= horizon)
      : second >= horizon;
    if (affected) {
      const cursor = forward ? Math.max(second, horizon) : second;
      const date = gregorianCoordinateFromEpochDay(Math.floor(cursor / 86400));
      if (date === undefined) return { ok: false, error: "unavailable" };
      // Gregorian rules repeat over 400 years. Include adjacent rule years for
      // extended transition clocks that spill across a year boundary. Searching
      // the complete cycle also handles schedules whose changes cancel in some years.
      for (let distance = -1; distance <= 400; distance++) {
        const year = date.year + (forward ? distance : -distance);
        const start = posixTransitionEpochSeconds(
            future.start,
            year,
            future.standardOffsetSeconds,
          ),
          end = posixTransitionEpochSeconds(
            future.end,
            year,
            future.daylightOffsetSeconds,
          );
        if (start === undefined || end === undefined)
          return { ok: false, error: "unavailable" };
        if (start >= horizon) consider(start);
        if (end >= horizon) consider(end);
      }
    }
  }
  const candidate = best,
    unavailable = unknown;
  if (
    unavailable !== undefined &&
    (candidate === undefined || nearer(unavailable, candidate))
  )
    return { ok: false, error: "unavailable" };
  return { ok: true, epochSeconds: candidate };
}
