import {
  configureDateTimeFormatter,
  dateTimePartsText,
} from "./intl-date-time-format.ts";
import { dateTimeFormatParts } from "./date-time-service.ts";
import { temporalEpochFromMilliseconds } from "./temporal-epoch.ts";
import { createBigIntValue } from "./bigints.ts";
import { createTemporalInstantObject } from "./temporal-instant-construction.ts";
import { installDateSetters } from "./date-setters.ts";
import { parseDateText } from "./date-parse.ts";
import {
  dateISOText,
  dateUTCText,
  dateLocalCalendarText,
  dateLocalClockText,
} from "./date-format.ts";
import { toObjectValue } from "./boxing.ts";
import { ordinaryPrimitive } from "./coercion.ts";
import { callObjectValue } from "./values.ts";
import { wellKnownSymbol } from "./symbols.ts";
import {
  clipDateTime,
  makeDateTime,
  fullDateYear,
  dateFields,
} from "./date-values.ts";
import {
  ensureExoticSlots,
  exoticSlots,
  getProperty,
  createObject,
  createConstructorObject,
  type OrdinaryObject,
  type ObjectHooks,
} from "./operations.ts";
import {
  builtinFunction,
  builtinFunctionMetadata,
  builtinProperty,
} from "./intrinsics.ts";
import { constructorPrototype } from "./functions.ts";
import { primitiveValue, numberValue, stringValue } from "./coercion.ts";
import { viewObjectValue } from "./values.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";
import type { ScriptPropertyKey } from "./symbols.ts";

/** Numeric/UTC Date operations are portable. Clock, local zones and parsing are
 * separate capabilities; absent paths report unsupported instead of inventing UTC. */
export function installDateIntrinsics(
  global: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  const prototype = realm.datePrototype;
  function now(): number {
    const wallClock = realm.wallClockMilliseconds;
    if (wallClock === undefined) return rejectUnsupportedExecution(realm);
    return clipDateTime(wallClock());
  }
  function localTime(time: number): number {
    if (Number.isNaN(time)) return NaN;
    const offset = realm.localTimeOffsetSeconds;
    if (offset === undefined) return rejectUnsupportedExecution(realm);
    const seconds = offset(Math.floor(time / 1000));
    if (!Number.isFinite(seconds)) return rejectUnsupportedExecution(realm);
    return time + seconds * 1000;
  }
  function localText(time: number, kind: "date" | "time" | "full"): string {
    if (Number.isNaN(time)) return "Invalid Date";
    const local = localTime(time);
    if (kind === "date") return dateLocalCalendarText(local);
    const clock = dateLocalClockText(local, local - time);
    if (clock === undefined) return rejectUnsupportedExecution(realm);
    return kind === "time" ? clock : dateLocalCalendarText(local) + " " + clock;
  }
  function number(value: unknown): number {
    const converted = numberValue(value, hooks, realm);
    if (converted.error === "unsupported") rejectUnsupportedExecution(realm);
    if (converted.error !== "none") throw createRuntimeError(realm, "type");
    return converted.value;
  }
  function utcTime(local: number): number {
    if (!Number.isFinite(local)) return NaN;
    const convert = realm.localTimeToUTC;
    return convert === undefined
      ? rejectUnsupportedExecution(realm)
      : convert(local);
  }
  function parse(text: string): number {
    const parsed = parseDateText(text);
    return parsed.local ? clipDateTime(utcTime(parsed.value)) : parsed.value;
  }
  function components(args: readonly unknown[]): number {
    const year = number(args[0]);
    const month = args.length > 1 ? number(args[1]) : 0;
    const day = args.length > 2 ? number(args[2]) : 1;
    const hour = args.length > 3 ? number(args[3]) : 0;
    const minute = args.length > 4 ? number(args[4]) : 0;
    const second = args.length > 5 ? number(args[5]) : 0;
    const millisecond = args.length > 6 ? number(args[6]) : 0;
    return makeDateTime(
      fullDateYear(year),
      month,
      day,
      hour,
      minute,
      second,
      millisecond,
    );
  }
  function requireDate(
    value: unknown,
  ): OrdinaryObject<ScriptPropertyKey, unknown> {
    const object = viewObjectValue(value, prototype);
    if (
      object === undefined ||
      exoticSlots(object).internalDateValue === undefined
    )
      throw createRuntimeError(realm, "type");
    return object;
  }
  function dateArgument(input: unknown): number {
    const source = viewObjectValue(input, prototype);
    const stored =
      source === undefined ? undefined : exoticSlots(source).internalDateValue;
    if (stored !== undefined) return stored;
    const primitive = primitiveValue(input, "default", hooks, realm);
    if (primitive.error === "unsupported")
      return rejectUnsupportedExecution(realm);
    if (primitive.error !== "none") throw createRuntimeError(realm, "type");
    const value = primitive.value;
    if (typeof value === "string") return parse(value);
    return number(value);
  }
  const constructor = createConstructorObject<ScriptPropertyKey, unknown>(
    realm.functionPrototype,
    (receiver, args): unknown => localText(now(), "full"),
    (args, target): unknown => {
      const time =
        args.length === 0
          ? now()
          : args.length === 1
            ? dateArgument(args[0])
            : utcTime(components(args));
      // GetPrototypeFromConstructor is observable after argument conversion.
      const object = createObject<ScriptPropertyKey, unknown>(
        constructorPrototype(target, "date", realm, hooks),
      );
      ensureExoticSlots(object).internalDateValue = clipDateTime(time);
      return object;
    },
  );
  builtinFunctionMetadata(constructor, "Date", 7, hooks);
  builtinProperty(constructor, "prototype", prototype, false, false, hooks);
  builtinProperty(prototype, "constructor", constructor, true, true, hooks);
  builtinProperty(global, "Date", constructor, true, true, hooks);
  builtinProperty(
    constructor,
    "UTC",
    builtinFunction(
      realm.functionPrototype,
      "UTC",
      7,
      (receiver, args): unknown => {
        return clipDateTime(components(args));
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(
    constructor,
    "parse",
    builtinFunction(
      realm.functionPrototype,
      "parse",
      1,
      (receiver, args): unknown => {
        const text = stringValue(args[0], hooks, realm);
        if (text.error === "unsupported")
          return rejectUnsupportedExecution(realm);
        if (text.error !== "none") throw createRuntimeError(realm, "type");
        return parse(text.value);
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  // Wall-clock hosting stays distinct from monotonic benchmark time.
  builtinProperty(
    constructor,
    "now",
    builtinFunction(
      realm.functionPrototype,
      "now",
      0,
      (receiver, args): unknown => now(),
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(
    prototype,
    "toTemporalInstant",
    builtinFunction(
      realm.functionPrototype,
      "toTemporalInstant",
      0,
      (receiver, args): unknown => {
        const value = exoticSlots(requireDate(receiver)).internalDateValue;
        if (value === undefined) throw "DATE_SLOT_INVARIANT";
        const epoch = temporalEpochFromMilliseconds(value);
        if (epoch === undefined) throw createRuntimeError(realm, "range");
        return createTemporalInstantObject(
          createBigIntValue(epoch),
          realm.temporalInstantPrototype,
        );
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  const utcString = builtinFunction(
    realm.functionPrototype,
    "toUTCString",
    0,
    (receiver, args): unknown => {
      const value = exoticSlots(requireDate(receiver)).internalDateValue;
      if (value === undefined) throw "DATE_SLOT_INVARIANT";
      return dateUTCText(value);
    },
    hooks,
  );
  builtinProperty(prototype, "toUTCString", utcString, true, true, hooks);
  builtinProperty(prototype, "toGMTString", utcString, true, true, hooks);
  builtinProperty(
    prototype,
    "toISOString",
    builtinFunction(
      realm.functionPrototype,
      "toISOString",
      0,
      (receiver, args): unknown => {
        const value = exoticSlots(requireDate(receiver)).internalDateValue;
        if (value === undefined) throw "DATE_SLOT_INVARIANT";
        const text = dateISOText(value);
        if (text === undefined) throw createRuntimeError(realm, "range");
        return text;
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  for (const name of [
    "toString",
    "toDateString",
    "toTimeString",
    "toLocaleString",
    "toLocaleDateString",
    "toLocaleTimeString",
  ]) {
    if (name === undefined) throw "DATE_LOCAL_METHOD_INVARIANT";
    builtinProperty(
      prototype,
      name,
      builtinFunction(
        realm.functionPrototype,
        name,
        0,
        (receiver, args): unknown => {
          const value = exoticSlots(requireDate(receiver)).internalDateValue;
          if (value === undefined) throw "DATE_SLOT_INVARIANT";
          if (
            name === "toLocaleString" ||
            name === "toLocaleDateString" ||
            name === "toLocaleTimeString"
          ) {
            if (Number.isNaN(value)) return "Invalid Date";
            const required =
                name === "toLocaleDateString"
                  ? "date"
                  : name === "toLocaleTimeString"
                    ? "time"
                    : "any",
              defaults = required === "any" ? "all" : required,
              formatter = configureDateTimeFormatter(
                args[0],
                args[1],
                realm,
                hooks,
                required,
                defaults,
              ),
              parts = dateTimeFormatParts(formatter, value);
            return parts === undefined
              ? rejectUnsupportedExecution(realm)
              : dateTimePartsText(parts);
          }
          return localText(
            value,
            name === "toDateString"
              ? "date"
              : name === "toTimeString"
                ? "time"
                : "full",
          );
        },
        hooks,
      ),
      true,
      true,
      hooks,
    );
  }
  builtinProperty(
    prototype,
    "toJSON",
    builtinFunction(
      realm.functionPrototype,
      "toJSON",
      1,
      (receiver, args): unknown => {
        const object = toObjectValue(receiver, realm, hooks);
        const primitive = primitiveValue(object, "number", hooks, realm);
        if (primitive.error === "unsupported")
          return rejectUnsupportedExecution(realm);
        if (primitive.error !== "none") throw createRuntimeError(realm, "type");
        if (
          typeof primitive.value === "number" &&
          !Number.isFinite(primitive.value)
        )
          return null;
        const method = getProperty<ScriptPropertyKey, unknown>(
          object,
          "toISOString",
          object,
          hooks,
        );
        const result = callObjectValue(method, object, [], prototype);
        if (result.error !== "none") throw createRuntimeError(realm, "type");
        return result.value;
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(
    prototype,
    wellKnownSymbol(realm.symbolRegistry, "toPrimitive"),
    builtinFunction(
      realm.functionPrototype,
      "[Symbol.toPrimitive]",
      1,
      (receiver, args): unknown => {
        if (viewObjectValue(receiver, prototype) === undefined)
          throw createRuntimeError(realm, "type");
        const hint = args[0];
        if (hint !== "default" && hint !== "string" && hint !== "number")
          throw createRuntimeError(realm, "type");
        const primitive = ordinaryPrimitive(
          receiver,
          hint !== "number",
          hooks,
          realm,
        );
        if (primitive.error === "unsupported")
          return rejectUnsupportedExecution(realm);
        if (primitive.error !== "none") throw createRuntimeError(realm, "type");
        return primitive.value;
      },
      hooks,
    ),
    false,
    true,
    hooks,
  );
  for (const name of [
    "getTime",
    "valueOf",
    "getTimezoneOffset",
    "getYear",
    "getFullYear",
    "getMonth",
    "getDate",
    "getDay",
    "getHours",
    "getMinutes",
    "getSeconds",
    "getMilliseconds",
    "getUTCFullYear",
    "getUTCMonth",
    "getUTCDate",
    "getUTCDay",
    "getUTCHours",
    "getUTCMinutes",
    "getUTCSeconds",
    "getUTCMilliseconds",
  ]) {
    if (name === undefined) throw "DATE_METHOD_INVARIANT";
    builtinProperty(
      prototype,
      name,
      builtinFunction(
        realm.functionPrototype,
        name,
        0,
        (receiver, args): unknown => {
          const value = exoticSlots(requireDate(receiver)).internalDateValue;
          if (value === undefined) throw "DATE_SLOT_INVARIANT";
          if (name === "getTime" || name === "valueOf") return value;
          if (name === "getTimezoneOffset")
            return (value - localTime(value)) / 60000;
          const utc = name.startsWith("getUTC");
          const field = name.slice(utc ? 6 : 3);
          const fields = dateFields(utc ? value : localTime(value));
          if (fields === undefined) return NaN;
          if (field === "Year") return fields.year - 1900;
          if (field === "FullYear") return fields.year;
          if (field === "Month") return fields.month;
          if (field === "Date") return fields.day;
          if (field === "Day") return fields.weekday;
          if (field === "Hours") return fields.hour;
          if (field === "Minutes") return fields.minute;
          if (field === "Seconds") return fields.second;
          return fields.millisecond;
        },
        hooks,
      ),
      true,
      true,
      hooks,
    );
  }
  installDateSetters(realm, hooks, { requireDate, number, localTime, utcTime });
}
