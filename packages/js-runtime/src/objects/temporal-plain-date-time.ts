import { installDateTimeDifferenceMethods } from "./temporal-date-time-difference.ts";
import { plainDateTimeRoundingOptions } from "./temporal-rounding.ts";
import { roundTemporalDateTime } from "./temporal-date-time-rounding.ts";
import { plainDateTimeText } from "./temporal-date-time-format.ts";
import { temporalStringOption } from "./temporal-options.ts";
import { plainDateTimeArithmetic } from "./temporal-date-arithmetic.ts";
import { durationFrom } from "./temporal-duration-conversion.ts";
import { installDateTimeCopyMethods } from "./temporal-date-time-methods.ts";
import { plainDateTimeFrom } from "./temporal-date-time-conversion.ts";
import { installTemporalClockAccessors } from "./temporal-clock-fields.ts";
import {
  epochDayFromGregorian,
  type GregorianDate,
} from "@tint/foundation/chrono/gregorian-calendar";
import {
  compareISODateTime,
  type ISODateTime,
} from "@tint/foundation/chrono/iso-date-time";
import {
  createObject,
  createConstructorObject,
  type OrdinaryObject,
  type ObjectHooks,
} from "./operations.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
import {
  temporalInteger,
  requireCalendarAlgorithms,
} from "./temporal-coercion.ts";
import { installTemporalCalendarAccessors } from "./temporal-calendar-fields.ts";
import {
  builtinProperty,
  builtinFunction,
  builtinFunctionMetadata,
} from "./intrinsics.ts";
import { constructorPrototype } from "./functions.ts";
import { viewObjectValue } from "./values.ts";
import { wellKnownSymbol, type ScriptPropertyKey } from "./symbols.ts";

function requireDateTime(value: unknown, realm: ErrorRealm): ISODateTime {
  const object = viewObjectValue(value, realm.objectPrototype),
    data =
      object === undefined ? undefined : object.internalTemporalPlainDateTime;
  if (data === undefined) throw createRuntimeError(realm, "type");
  return data;
}
export function installTemporalPlainDateTime(
  temporal: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  const prototype = realm.temporalPlainDateTimePrototype;
  installDateTimeDifferenceMethods(prototype, realm, hooks, (receiver) =>
    requireDateTime(receiver, realm),
  );
  const constructor = createConstructorObject<ScriptPropertyKey, unknown>(
    realm.functionPrototype,
    (receiver, args): unknown => {
      throw createRuntimeError(realm, "type");
    },
    (args, target): unknown => {
      const year = temporalInteger(args[0], realm, hooks),
        month = temporalInteger(args[1], realm, hooks),
        day = temporalInteger(args[2], realm, hooks);
      const time: number[] = [];
      for (let i = 3; i < 9; i++)
        time.push(
          args[i] === undefined ? 0 : temporalInteger(args[i], realm, hooks),
        );
      const calendar = requireCalendarAlgorithms(args[9], realm);
      const hour = time[0] ?? 0,
        minute = time[1] ?? 0,
        second = time[2] ?? 0,
        millisecond = time[3] ?? 0,
        microsecond = time[4] ?? 0,
        nanosecond = time[5] ?? 0;
      const epoch = epochDayFromGregorian(year, month, day);
      if (
        epoch === undefined ||
        epoch < -100000001 ||
        epoch > 100000000 ||
        hour < 0 ||
        hour > 23 ||
        minute < 0 ||
        minute > 59 ||
        second < 0 ||
        second > 59 ||
        millisecond < 0 ||
        millisecond > 999 ||
        microsecond < 0 ||
        microsecond > 999 ||
        nanosecond < 0 ||
        nanosecond > 999
      )
        throw createRuntimeError(realm, "range");
      const fraction = millisecond * 1000000 + microsecond * 1000 + nanosecond;
      if (
        epoch === -100000001 &&
        hour === 0 &&
        minute === 0 &&
        second === 0 &&
        fraction === 0
      )
        throw createRuntimeError(realm, "range");
      const object = createObject<ScriptPropertyKey, unknown>(
        constructorPrototype(target, "temporal-plain-date-time", realm, hooks),
      );
      object.internalTemporalPlainDateTime = {
        date: { year, month, day },
        hasTime: true,
        hour,
        minute,
        second,
        nanosecond: fraction,
        utc: false,
        offsetNanoseconds: undefined,
        timeZone: undefined,
        calendar,
      };
      object.internalTemporalCalendar = calendar;
      return object;
    },
  );
  function make(data: ISODateTime): OrdinaryObject<ScriptPropertyKey, unknown> {
    const object = createObject<ScriptPropertyKey, unknown>(prototype);
    object.internalTemporalPlainDateTime = data;
    object.internalTemporalCalendar = data.calendar ?? "iso8601";
    return object;
  }
  builtinProperty(
    prototype,
    "round",
    builtinFunction(
      realm.functionPrototype,
      "round",
      1,
      (receiver, args): unknown => {
        const data = requireDateTime(receiver, realm);
        const settings = plainDateTimeRoundingOptions(args[0], realm, hooks);
        return make(roundTemporalDateTime(data, settings, realm));
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  for (const name of ["add", "subtract"]) {
    if (name === undefined) throw "TEMPORAL_DATE_ARITHMETIC_METHOD_INVARIANT";
    builtinProperty(
      prototype,
      name,
      builtinFunction(
        realm.functionPrototype,
        name,
        1,
        (receiver, args): unknown => {
          const date = requireDateTime(receiver, realm);
          const duration = durationFrom(args[0], realm, hooks);
          const policy = temporalStringOption(
            args[1],
            "overflow",
            "constrain",
            ["constrain", "reject"],
            realm,
            hooks,
          );
          return make(
            plainDateTimeArithmetic(
              date,
              duration,
              name === "subtract",
              policy,
              realm,
            ),
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
    constructor,
    "from",
    builtinFunction(
      realm.functionPrototype,
      "from",
      1,
      (receiver, args): unknown =>
        make(plainDateTimeFrom(args[0], args[1], realm, hooks)),
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(
    constructor,
    "compare",
    builtinFunction(
      realm.functionPrototype,
      "compare",
      2,
      (receiver, args): unknown => {
        const a = plainDateTimeFrom(args[0], undefined, realm, hooks),
          b = plainDateTimeFrom(args[1], undefined, realm, hooks);
        return compareISODateTime(a, b);
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinFunctionMetadata(constructor, "PlainDateTime", 3, hooks);
  builtinProperty(constructor, "prototype", prototype, false, false, hooks);
  builtinProperty(prototype, "constructor", constructor, true, true, hooks);
  builtinProperty(
    prototype,
    wellKnownSymbol(realm.symbolRegistry, "toStringTag"),
    "Temporal.PlainDateTime",
    false,
    true,
    hooks,
  );
  installTemporalCalendarAccessors(
    prototype,
    realm,
    hooks,
    (receiver): GregorianDate => requireDateTime(receiver, realm).date,
  );
  installTemporalClockAccessors(
    prototype,
    realm,
    hooks,
    (receiver): ISODateTime => requireDateTime(receiver, realm),
  );
  installDateTimeCopyMethods(
    prototype,
    realm,
    hooks,
    (receiver): ISODateTime => requireDateTime(receiver, realm),
    make,
  );
  for (const name of ["toString", "toJSON", "valueOf"]) {
    if (name === undefined) throw "DATE_TIME_METHOD_INVARIANT";
    builtinProperty(
      prototype,
      name,
      builtinFunction(
        realm.functionPrototype,
        name,
        0,
        (receiver, args): unknown => {
          if (name === "valueOf") throw createRuntimeError(realm, "type");
          const d = requireDateTime(receiver, realm);
          return plainDateTimeText(
            d,
            name === "toString" ? args[0] : undefined,
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
  }
  builtinProperty(temporal, "PlainDateTime", constructor, true, true, hooks);
}
