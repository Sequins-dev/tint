import { gregorianCoordinateFromEpochDay } from "../gregorian-calendar/index.ts";
import { tzifOffsetSecondsAt, type TzifZone } from "./zone.ts";
import { posixTransitionEpochSeconds } from "./posix-offset.ts";
export type TzifDisambiguation = "compatible" | "earlier" | "later" | "reject";
export type TzifLocalResult =
  | { readonly ok: true; readonly epochSeconds: number }
  | {
      readonly ok: false;
      readonly error: "invalid" | "unavailable" | "ambiguous";
    };
export interface TzifLocalGap {
  readonly transitionEpochSeconds: number;
  readonly earlierEpochSeconds: number;
  readonly laterEpochSeconds: number;
}
export interface TzifLocalAnalysisSuccess {
  readonly ok: true;
  readonly candidates: readonly number[];
  readonly gap: TzifLocalGap | undefined;
}
export type TzifLocalAnalysis =
  | TzifLocalAnalysisSuccess
  | { readonly ok: false; readonly error: "invalid" | "unavailable" };

/** Enumerate verified candidates and expose the actual skipped-time transition.
 * Selection policy stays with callers; gaps can exceed or be shorter than an hour. */
export function analyzeTzifLocalSeconds(
  zone: TzifZone,
  local: number,
): TzifLocalAnalysis {
  if (!Number.isSafeInteger(local)) return { ok: false, error: "invalid" };
  const offsets: number[] = [];
  function add(offset: number): void {
    if (!offsets.includes(offset)) offsets.push(offset);
  }
  for (const type of zone.data.types) {
    if (type === undefined) throw "TZIF_TYPE_INVARIANT";
    add(type.offsetSeconds);
  }
  const future = zone.future;
  if (future !== undefined) {
    if (future.kind === "fixed") add(future.offsetSeconds);
    else {
      const one = future.standardOffsetSeconds,
        two = future.daylightOffsetSeconds;
      add(one);
      add(two);
    }
  }
  const candidates: number[] = [];
  let unavailable = false;
  for (const offset of offsets) {
    if (offset === undefined) throw "TZIF_OFFSET_INVARIANT";
    const candidate = local - offset,
      actual = tzifOffsetSecondsAt(zone, candidate);
    if (actual === undefined) unavailable = true;
    else if (actual === offset) candidates.push(candidate);
  }
  // Never choose one candidate while unavailable data could conceal another.
  if (unavailable) return { ok: false, error: "unavailable" };
  if (candidates.length > 0) {
    candidates.sort((one, two): number => one - two);
    return { ok: true, candidates, gap: undefined };
  }
  let earlier: number | undefined = undefined,
    later: number | undefined = undefined,
    transition: number | undefined = undefined,
    conflict = false;
  function gap(at: number): void {
    if (!Number.isSafeInteger(at)) return;
    const before = tzifOffsetSecondsAt(zone, at - 1),
      after = tzifOffsetSecondsAt(zone, at);
    if (
      before === undefined ||
      after === undefined ||
      after <= before ||
      local < at + before ||
      local >= at + after
    )
      return;
    const first = local - after,
      last = local - before;
    if (
      earlier !== undefined &&
      (earlier !== first || later !== last || transition !== at)
    )
      conflict = true;
    earlier = first;
    later = last;
    transition = at;
  }
  for (const at of zone.transitionSeconds) {
    if (at === undefined) throw "TZIF_TRANSITION_INVARIANT";
    gap(at);
  }
  if (future !== undefined && future.kind === "alternating") {
    const date = gregorianCoordinateFromEpochDay(Math.floor(local / 86400));
    if (date !== undefined) {
      const last = zone.transitionSeconds[zone.transitionSeconds.length - 1];
      for (let year = date.year - 1; year <= date.year + 1; year++) {
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
        if (start !== undefined && (last === undefined || start >= last))
          gap(start);
        if (end !== undefined && (last === undefined || end >= last)) gap(end);
      }
    }
  }
  const first = earlier,
    last = later,
    at = transition;
  if (conflict || first === undefined || last === undefined || at === undefined)
    return { ok: false, error: "unavailable" };
  return {
    ok: true,
    candidates: [],
    gap: {
      transitionEpochSeconds: at,
      earlierEpochSeconds: first,
      laterEpochSeconds: last,
    },
  };
}

/** Resolve with Date/Temporal's explicit overlap and gap policies. */
export function resolveTzifLocalSeconds(
  zone: TzifZone,
  local: number,
  mode: TzifDisambiguation = "compatible",
): TzifLocalResult {
  if (
    mode !== "compatible" &&
    mode !== "earlier" &&
    mode !== "later" &&
    mode !== "reject"
  )
    return { ok: false, error: "invalid" };
  const result = analyzeTzifLocalSeconds(zone, local);
  if (!result.ok) return result;
  const candidates = result.candidates;
  if (candidates.length > 0) {
    if (candidates.length > 1 && mode === "reject")
      return { ok: false, error: "ambiguous" };
    const selected = candidates[mode === "later" ? candidates.length - 1 : 0];
    if (selected === undefined) throw "TZIF_CANDIDATE_INVARIANT";
    return { ok: true, epochSeconds: selected };
  }
  const gap = result.gap;
  if (gap === undefined) throw "TZIF_GAP_INVARIANT";
  if (mode === "reject") return { ok: false, error: "ambiguous" };
  return {
    ok: true,
    epochSeconds:
      mode === "earlier" ? gap.earlierEpochSeconds : gap.laterEpochSeconds,
  };
}
