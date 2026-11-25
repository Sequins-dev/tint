import { temporalTimeDifference } from "./temporal-time-difference.ts";
import { roundInteger } from "@tint/foundation/numeric/integer-rounding";
import { plainTimeRoundingOptions } from "./temporal-rounding.ts";
import {
  readTemporalPrecisionOptions,
  resolveTemporalPrecision,
} from "./temporal-precision.ts";
import { add, subtract } from "@tint/foundation/numeric/big-integer";
import { durationTimeNanoseconds } from "@tint/foundation/chrono/temporal-duration";
import { durationFrom } from "./temporal-duration-conversion.ts";
import {
  clockNanoseconds,
  splitClockNanoseconds,
} from "./temporal-time-arithmetic.ts";
import { plainTimeFrom, plainTimeWith } from "./temporal-time-conversion.ts";
import {
  formatISOTimePrecision,
  compareISOTime,
  type ISOTime,
} from "@tint/foundation/chrono/iso-date-time";
import {
  ensureExoticSlots,
  exoticSlots,
  createObject,
  createConstructorObject,
  type OrdinaryObject,
  type ObjectHooks,
} from "./operations.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
import { temporalInteger } from "./temporal-coercion.ts";
import { installTemporalClockAccessors } from "./temporal-clock-fields.ts";
import {
  builtinProperty,
  builtinFunction,
  builtinFunctionMetadata,
} from "./intrinsics.ts";
import { constructorPrototype } from "./functions.ts";
import { viewObjectValue } from "./values.ts";
import { wellKnownSymbol, type ScriptPropertyKey } from "./symbols.ts";
function requireTime(value: unknown, realm: ErrorRealm): ISOTime {
  const object = viewObjectValue(value, realm.objectPrototype);
  const time =
    object === undefined
      ? undefined
      : exoticSlots(object).internalTemporalPlainTime;
  if (time === undefined) throw createRuntimeError(realm, "type");
  return time;
}
export function installTemporalPlainTime(
  temporal: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  const prototype = realm.temporalPlainTimePrototype;
  const constructor = createConstructorObject<ScriptPropertyKey, unknown>(
    realm.functionPrototype,
    (receiver, args): unknown => {
      throw createRuntimeError(realm, "type");
    },
    (args, target): unknown => {
      const fields: number[] = [];
      for (let i = 0; i < 6; i++)
        fields.push(
          args[i] === undefined ? 0 : temporalInteger(args[i], realm, hooks),
        );
      const hour = fields[0] ?? 0,
        minute = fields[1] ?? 0,
        second = fields[2] ?? 0,
        millisecond = fields[3] ?? 0,
        microsecond = fields[4] ?? 0,
        nanosecond = fields[5] ?? 0;
      if (
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
      const object = createObject<ScriptPropertyKey, unknown>(
        constructorPrototype(target, "temporal-plain-time", realm, hooks),
      );
      ensureExoticSlots(object).internalTemporalPlainTime = {
        hour,
        minute,
        second,
        nanosecond: millisecond * 1000000 + microsecond * 1000 + nanosecond,
      };
      return object;
    },
  );
  function make(time: ISOTime): OrdinaryObject<ScriptPropertyKey, unknown> {
    const object = createObject<ScriptPropertyKey, unknown>(prototype);
    ensureExoticSlots(object).internalTemporalPlainTime = time;
    return object;
  }
  builtinProperty(
    constructor,
    "from",
    builtinFunction(
      realm.functionPrototype,
      "from",
      1,
      (receiver, args): unknown =>
        make(plainTimeFrom(args[0], args[1], realm, hooks)),
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
        const a = plainTimeFrom(args[0], undefined, realm, hooks),
          b = plainTimeFrom(args[1], undefined, realm, hooks);
        return compareISOTime(a, b);
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinFunctionMetadata(constructor, "PlainTime", 0, hooks);
  builtinProperty(constructor, "prototype", prototype, false, false, hooks);
  builtinProperty(prototype, "constructor", constructor, true, true, hooks);
  builtinProperty(
    prototype,
    wellKnownSymbol(realm.symbolRegistry, "toStringTag"),
    "Temporal.PlainTime",
    false,
    true,
    hooks,
  );
  installTemporalClockAccessors(prototype, realm, hooks, (receiver): ISOTime =>
    requireTime(receiver, realm),
  );
  for (const name of ["until", "since"]) {
    if (name === undefined) throw "TEMPORAL_DIFFERENCE_METHOD_INVARIANT";
    builtinProperty(
      prototype,
      name,
      builtinFunction(
        realm.functionPrototype,
        name,
        1,
        (receiver, args): unknown => {
          const time = requireTime(receiver, realm);
          const other = clockNanoseconds(
            plainTimeFrom(args[0], undefined, realm, hooks),
          );
          const own = clockNanoseconds(time);
          const delta =
            name === "until" ? subtract(other, own) : subtract(own, other);
          const duration = temporalTimeDifference(
            delta,
            args[1],
            "hour",
            realm,
            hooks,
          );
          const object = createObject<ScriptPropertyKey, unknown>(
            realm.temporalDurationPrototype,
          );
          ensureExoticSlots(object).internalTemporalDuration = duration;
          return object;
        },
        hooks,
      ),
      true,
      true,
      hooks,
    );
  }
  for (const name of ["add", "subtract"]) {
    if (name === undefined) throw "PLAIN_TIME_ARITHMETIC_INVARIANT";
    builtinProperty(
      prototype,
      name,
      builtinFunction(
        realm.functionPrototype,
        name,
        1,
        (receiver, args): unknown => {
          const time = requireTime(receiver, realm);
          const duration = durationFrom(args[0], realm, hooks),
            delta = durationTimeNanoseconds(duration);
          const clock = clockNanoseconds(time);
          return make(
            splitClockNanoseconds(
              name === "add" ? add(clock, delta) : subtract(clock, delta),
            ).time,
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
    "with",
    builtinFunction(
      realm.functionPrototype,
      "with",
      1,
      (receiver, args): unknown =>
        make(
          plainTimeWith(
            requireTime(receiver, realm),
            args[0],
            args[1],
            realm,
            hooks,
          ),
        ),
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(
    prototype,
    "round",
    builtinFunction(
      realm.functionPrototype,
      "round",
      1,
      (receiver, args): unknown => {
        const time = requireTime(receiver, realm);
        const settings = plainTimeRoundingOptions(args[0], realm, hooks);
        const rounded = roundInteger(
          clockNanoseconds(time),
          settings.increment,
          settings.mode,
        );
        if (rounded === undefined) throw "PLAIN_TIME_ROUNDING_INVARIANT";
        return make(splitClockNanoseconds(rounded).time);
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(
    prototype,
    "equals",
    builtinFunction(
      realm.functionPrototype,
      "equals",
      1,
      (receiver, args): unknown => {
        const time = requireTime(receiver, realm);
        return (
          compareISOTime(
            time,
            plainTimeFrom(args[0], undefined, realm, hooks),
          ) === 0
        );
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  for (const name of ["toString", "toJSON", "valueOf"]) {
    if (name === undefined) throw "PLAIN_TIME_METHOD_INVARIANT";
    builtinProperty(
      prototype,
      name,
      builtinFunction(
        realm.functionPrototype,
        name,
        0,
        (receiver, args): unknown => {
          if (name === "valueOf") throw createRuntimeError(realm, "type");
          const time = requireTime(receiver, realm);
          const settings = readTemporalPrecisionOptions(
            name === "toString" ? args[0] : undefined,
            realm,
            hooks,
          );
          const precision = resolveTemporalPrecision(settings, realm);
          const rounded = roundInteger(
            clockNanoseconds(time),
            precision.increment,
            settings.mode,
          );
          if (rounded === undefined)
            throw "PLAIN_TIME_FORMAT_ROUNDING_INVARIANT";
          return formatISOTimePrecision(
            splitClockNanoseconds(rounded).time,
            precision.digits,
          );
        },
        hooks,
      ),
      true,
      true,
      hooks,
    );
  }
  builtinProperty(temporal, "PlainTime", constructor, true, true, hooks);
}
