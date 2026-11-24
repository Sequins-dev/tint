import {
  segmentBoundaries,
  isWordLikeSegment,
  type SegmentationGranularity,
} from "@tint/foundation/unicode/segmentation";
import {
  ensureExoticSlots,
  exoticSlots,
  createObject,
  createConstructorObject,
  createDataProperty,
  type OrdinaryObject,
  type ObjectHooks,
} from "./operations.ts";
import {
  builtinProperty,
  builtinFunction,
  builtinFunctionMetadata,
} from "./intrinsics.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";
import { constructorPrototype } from "./functions.ts";
import { viewObjectValue } from "./values.ts";
import { toObjectValue } from "./boxing.ts";
import { optionValue } from "./options.ts";
import { stringValue, integerOrInfinity } from "./coercion.ts";
import { canonicalLocaleList, runtimeDefaultLocale } from "./locale-objects.ts";
import { createStringArrayFromList } from "./array-like.ts";
import { createIteratorResult } from "./iterator-intrinsics.ts";
import { lookupNumberFormatLocale } from "./number-format-profile.ts";
import { wellKnownSymbol, type ScriptPropertyKey } from "./symbols.ts";
import type { SegmenterState } from "./segmenter-state.ts";

function toStringValue(
  value: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): string {
  const converted = stringValue(value, hooks, realm);
  if (converted.error === "unsupported")
    return rejectUnsupportedExecution(realm);
  if (converted.error !== "none") throw createRuntimeError(realm, "type");
  return converted.value;
}
function stringOption(
  options: unknown,
  name: string,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): string | undefined {
  const value = optionValue(options, name, realm, hooks);
  return value === undefined ? undefined : toStringValue(value, realm, hooks);
}
function localeMatcher(
  options: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  const matcher = stringOption(options, "localeMatcher", realm, hooks);
  if (matcher !== undefined && matcher !== "lookup" && matcher !== "best fit")
    throw createRuntimeError(realm, "range");
}
function granularityOption(
  options: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): SegmentationGranularity {
  const value = stringOption(options, "granularity", realm, hooks);
  if (value === undefined) return "grapheme";
  if (value === "grapheme" || value === "word" || value === "sentence")
    return value;
  throw createRuntimeError(realm, "range");
}
/** UAX #29 default rules apply to every locale, so [[AvailableLocales]] is
 * the runtime's CLDR locale coverage (the NumberFormat locale profiles).
 * Segmenter has no relevant extension keys; lookup drops Unicode extensions. */
function lookupSegmenterLocale(tag: string): string | undefined {
  return lookupNumberFormatLocale(tag);
}
function resolveLocale(requested: readonly string[]): string {
  for (const tag of requested) {
    if (tag === undefined) throw "SEGMENTER_LOCALE_INVARIANT";
    const match = lookupSegmenterLocale(tag);
    if (match !== undefined) return match;
  }
  return runtimeDefaultLocale;
}
function requireState(
  value: unknown,
  kind: "segmenter" | "segments" | "iterator",
  realm: ErrorRealm,
): SegmenterState {
  const object = viewObjectValue(value, realm.objectPrototype);
  const state =
    object === undefined
      ? undefined
      : exoticSlots(object).internalSegmenterData;
  if (state === undefined || state.kind !== kind)
    throw createRuntimeError(realm, "type");
  return state;
}
function boundariesOf(state: SegmenterState): number[] {
  const cached = state.boundaries;
  if (cached !== undefined) return cached;
  const computed = segmentBoundaries(state.input, state.granularity);
  state.boundaries = computed;
  return computed;
}
function boundaryAt(boundaries: number[], index: number): number {
  const value = boundaries[index];
  if (value === undefined) throw "SEGMENTER_BOUNDARY_INVARIANT";
  return value;
}
/** Index of the last boundary <= position; position is within the string. */
function segmentStartIndex(boundaries: number[], position: number): number {
  let low = 0,
    high = boundaries.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2);
    if (boundaryAt(boundaries, mid) <= position) low = mid;
    else high = mid - 1;
  }
  return low;
}
function dataProperty(
  object: OrdinaryObject<ScriptPropertyKey, unknown>,
  name: string,
  value: unknown,
  hooks: ObjectHooks<unknown>,
): void {
  if (
    !createDataProperty<ScriptPropertyKey, unknown>(object, name, value, hooks)
  )
    throw "SEGMENT_DATA_PROPERTY_INVARIANT";
}
/** CreateSegmentDataObject. */
function segmentData(
  state: SegmenterState,
  start: number,
  end: number,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  const segment = state.input.slice(start, end),
    result = createObject<ScriptPropertyKey, unknown>(realm.objectPrototype);
  dataProperty(result, "segment", segment, hooks);
  dataProperty(result, "index", start, hooks);
  dataProperty(result, "input", state.input, hooks);
  if (state.granularity === "word")
    dataProperty(result, "isWordLike", isWordLikeSegment(segment), hooks);
  return result;
}

export function installSegmenterIntrinsic(
  intl: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  const prototype = realm.segmenterPrototype,
    segmentsPrototype = realm.segmentsPrototype,
    iteratorPrototype = realm.segmentIteratorPrototype;
  const constructor = createConstructorObject<ScriptPropertyKey, unknown>(
    realm.functionPrototype,
    (receiver, args): unknown => {
      throw createRuntimeError(realm, "type");
    },
    (args, target): unknown => {
      const object = createObject<ScriptPropertyKey, unknown>(
        constructorPrototype(target, "intl-segmenter", realm, hooks),
      );
      const requested = canonicalLocaleList(args[0], realm, hooks),
        input = args[1];
      // GetOptionsObject: undefined uses a null-prototype object; other
      // non-objects are rejected without coercion.
      const options =
        input === undefined
          ? createObject<ScriptPropertyKey, unknown>(undefined)
          : viewObjectValue(input, realm.objectPrototype);
      if (options === undefined) throw createRuntimeError(realm, "type");
      localeMatcher(options, realm, hooks);
      const locale = resolveLocale(requested);
      const granularity = granularityOption(options, realm, hooks);
      ensureExoticSlots(object).internalSegmenterData = {
        kind: "segmenter",
        locale,
        granularity,
        input: "",
        boundaries: undefined,
        position: 0,
      };
      return object;
    },
  );
  builtinFunctionMetadata(constructor, "Segmenter", 0, hooks);
  builtinProperty(constructor, "prototype", prototype, false, false, hooks);
  builtinProperty(prototype, "constructor", constructor, true, true, hooks);
  builtinProperty(
    prototype,
    wellKnownSymbol(realm.symbolRegistry, "toStringTag"),
    "Intl.Segmenter",
    false,
    true,
    hooks,
  );
  builtinProperty(
    constructor,
    "supportedLocalesOf",
    builtinFunction(
      realm.functionPrototype,
      "supportedLocalesOf",
      1,
      (receiver, args): unknown => {
        const requested = canonicalLocaleList(args[0], realm, hooks);
        // CoerceOptionsToObject.
        const options =
          args[1] === undefined
            ? createObject<ScriptPropertyKey, unknown>(undefined)
            : toObjectValue(args[1], realm, hooks);
        localeMatcher(options, realm, hooks);
        const supported: string[] = [];
        for (const tag of requested) {
          if (tag === undefined) throw "SEGMENTER_LOCALE_INVARIANT";
          if (lookupSegmenterLocale(tag) !== undefined) supported.push(tag);
        }
        return createStringArrayFromList(supported, realm, hooks);
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(
    prototype,
    "resolvedOptions",
    builtinFunction(
      realm.functionPrototype,
      "resolvedOptions",
      0,
      (receiver, args): unknown => {
        const state = requireState(receiver, "segmenter", realm),
          result = createObject<ScriptPropertyKey, unknown>(
            realm.objectPrototype,
          );
        dataProperty(result, "locale", state.locale, hooks);
        dataProperty(result, "granularity", state.granularity, hooks);
        return result;
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(
    prototype,
    "segment",
    builtinFunction(
      realm.functionPrototype,
      "segment",
      1,
      (receiver, args): unknown => {
        const state = requireState(receiver, "segmenter", realm);
        const input = toStringValue(args[0], realm, hooks);
        const segments = createObject<ScriptPropertyKey, unknown>(
          segmentsPrototype,
        );
        ensureExoticSlots(segments).internalSegmenterData = {
          kind: "segments",
          locale: state.locale,
          granularity: state.granularity,
          input,
          boundaries: undefined,
          position: 0,
        };
        return segments;
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(
    segmentsPrototype,
    "containing",
    builtinFunction(
      realm.functionPrototype,
      "containing",
      1,
      (receiver, args): unknown => {
        const state = requireState(receiver, "segments", realm);
        const n = integerOrInfinity(args[0], hooks, realm);
        if (n < 0 || n >= state.input.length) return undefined;
        const boundaries = boundariesOf(state),
          start = segmentStartIndex(boundaries, n);
        return segmentData(
          state,
          boundaryAt(boundaries, start),
          boundaryAt(boundaries, start + 1),
          realm,
          hooks,
        );
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(
    segmentsPrototype,
    wellKnownSymbol(realm.symbolRegistry, "iterator"),
    builtinFunction(
      realm.functionPrototype,
      "[Symbol.iterator]",
      0,
      (receiver, args): unknown => {
        const state = requireState(receiver, "segments", realm);
        const iterator = createObject<ScriptPropertyKey, unknown>(
          iteratorPrototype,
        );
        ensureExoticSlots(iterator).internalSegmenterData = {
          kind: "iterator",
          locale: state.locale,
          granularity: state.granularity,
          input: state.input,
          boundaries: boundariesOf(state),
          position: 0,
        };
        return iterator;
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(
    iteratorPrototype,
    "next",
    builtinFunction(
      realm.functionPrototype,
      "next",
      0,
      (receiver, args): unknown => {
        const state = requireState(receiver, "iterator", realm);
        const start = state.position;
        if (start >= state.input.length)
          return createIteratorResult(undefined, true, realm, hooks);
        const boundaries = boundariesOf(state),
          end = boundaryAt(
            boundaries,
            segmentStartIndex(boundaries, start) + 1,
          );
        state.position = end;
        return createIteratorResult(
          segmentData(state, start, end, realm, hooks),
          false,
          realm,
          hooks,
        );
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(
    iteratorPrototype,
    wellKnownSymbol(realm.symbolRegistry, "toStringTag"),
    "Segmenter String Iterator",
    false,
    true,
    hooks,
  );
  builtinProperty(intl, "Segmenter", constructor, true, true, hooks);
}
