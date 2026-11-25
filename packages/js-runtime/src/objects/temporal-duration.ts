import {
  configureDurationFormatter,
  durationPartsText,
} from "./intl-duration-format.ts";
import { durationFormatParts } from "./duration-format.ts";
import { readTemporalRelativeTo } from "./temporal-relative-to.ts";
import { optionValue } from "./options.ts";
import {
  addDurations,
  compareDurations,
} from "./temporal-duration-arithmetic.ts";
import { temporalDurationText } from "./temporal-duration-format.ts";
import { temporalDurationRound } from "./temporal-duration-rounding.ts";
import { temporalDurationTotal } from "./temporal-duration-total.ts";
import {
  durationInteger,
  durationFrom,
  durationWith,
} from "./temporal-duration-conversion.ts";
import {
  createDuration,
  durationFields,
  durationText,
  type Duration,
} from "@tint/foundation/chrono/temporal-duration";
import {
  ensureExoticSlots,
  exoticSlots,
  createObject,
  createConstructorObject,
  type OrdinaryObject,
  type ObjectHooks,
} from "./operations.ts";
import {
  builtinProperty,
  builtinFunction,
  builtinFunctionMetadata,
  builtinAccessor,
} from "./intrinsics.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
import { viewObjectValue } from "./values.ts";
import { constructorPrototype } from "./functions.ts";
import { wellKnownSymbol, type ScriptPropertyKey } from "./symbols.ts";

function requireDuration(value: unknown, realm: ErrorRealm): Duration {
  const object = viewObjectValue(value, realm.objectPrototype),
    data =
      object === undefined
        ? undefined
        : exoticSlots(object).internalTemporalDuration;
  if (data === undefined) throw createRuntimeError(realm, "type");
  return data;
}
export function installTemporalDuration(
  temporal: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  const prototype = realm.temporalDurationPrototype;
  function make(
    data: Duration,
    parent: OrdinaryObject<ScriptPropertyKey, unknown>,
  ): OrdinaryObject<ScriptPropertyKey, unknown> {
    const object = createObject<ScriptPropertyKey, unknown>(parent);
    ensureExoticSlots(object).internalTemporalDuration = data;
    return object;
  }
  const constructor = createConstructorObject<ScriptPropertyKey, unknown>(
    realm.functionPrototype,
    (receiver, args): unknown => {
      throw createRuntimeError(realm, "type");
    },
    (args, target): unknown => {
      const fields: number[] = [];
      for (let i = 0; i < 10; i++) {
        const argument = args[i];
        if (argument === undefined) {
          fields.push(0);
          continue;
        }
        fields.push(durationInteger(argument, realm, hooks));
      }
      const data = createDuration(fields);
      if (data === undefined) throw createRuntimeError(realm, "range");
      return make(
        data,
        constructorPrototype(target, "temporal-duration", realm, hooks),
      );
    },
  );
  builtinProperty(
    constructor,
    "compare",
    builtinFunction(
      realm.functionPrototype,
      "compare",
      2,
      (receiver, args): unknown => {
        const one = durationFrom(args[0], realm, hooks),
          two = durationFrom(args[1], realm, hooks);
        const relative = readTemporalRelativeTo(
          optionValue(args[2], "relativeTo", realm, hooks),
          realm,
          hooks,
        );
        return compareDurations(one, two, relative, realm);
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(
    constructor,
    "from",
    builtinFunction(
      realm.functionPrototype,
      "from",
      1,
      (receiver, args): unknown =>
        make(durationFrom(args[0], realm, hooks), prototype),
      hooks,
    ),
    true,
    true,
    hooks,
  );
  for (const name of ["add", "subtract"]) {
    if (name === undefined) throw "DURATION_ARITHMETIC_METHOD_INVARIANT";
    builtinProperty(
      prototype,
      name,
      builtinFunction(
        realm.functionPrototype,
        name,
        1,
        (receiver, args): unknown => {
          const own = requireDuration(receiver, realm),
            other = durationFrom(args[0], realm, hooks);
          return make(
            addDurations(own, other, name === "subtract", realm),
            prototype,
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
    "total",
    builtinFunction(
      realm.functionPrototype,
      "total",
      1,
      (receiver, args): unknown =>
        temporalDurationTotal(
          requireDuration(receiver, realm),
          args[0],
          realm,
          hooks,
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
      (receiver, args): unknown =>
        make(
          temporalDurationRound(
            requireDuration(receiver, realm),
            args[0],
            realm,
            hooks,
          ),
          prototype,
        ),
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinFunctionMetadata(constructor, "Duration", 0, hooks);
  builtinProperty(constructor, "prototype", prototype, false, false, hooks);
  builtinProperty(prototype, "constructor", constructor, true, true, hooks);
  builtinProperty(
    prototype,
    wellKnownSymbol(realm.symbolRegistry, "toStringTag"),
    "Temporal.Duration",
    false,
    true,
    hooks,
  );
  for (const name of [
    "years",
    "months",
    "weeks",
    "days",
    "hours",
    "minutes",
    "seconds",
    "milliseconds",
    "microseconds",
    "nanoseconds",
    "sign",
    "blank",
  ]) {
    if (name === undefined) throw "DURATION_ACCESSOR_INVARIANT";
    builtinAccessor(
      prototype,
      name,
      builtinFunction(
        realm.functionPrototype,
        "get " + name,
        0,
        (receiver, args): unknown => {
          const d = requireDuration(receiver, realm);
          if (name === "years") return d.years;
          if (name === "months") return d.months;
          if (name === "weeks") return d.weeks;
          if (name === "days") return d.days;
          if (name === "hours") return d.hours;
          if (name === "minutes") return d.minutes;
          if (name === "seconds") return d.seconds;
          if (name === "milliseconds") return d.milliseconds;
          if (name === "microseconds") return d.microseconds;
          if (name === "nanoseconds") return d.nanoseconds;
          return name === "sign" ? d.sign : d.sign === 0;
        },
        hooks,
      ),
      undefined,
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
      (receiver, args): unknown => {
        const data = requireDuration(receiver, realm);
        return make(durationWith(data, args[0], realm, hooks), prototype);
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  for (const name of [
    "toString",
    "toJSON",
    "toLocaleString",
    "valueOf",
    "negated",
    "abs",
  ]) {
    if (name === undefined) throw "DURATION_METHOD_INVARIANT";
    builtinProperty(
      prototype,
      name,
      builtinFunction(
        realm.functionPrototype,
        name,
        0,
        (receiver, args): unknown => {
          if (name === "valueOf") throw createRuntimeError(realm, "type");
          const data = requireDuration(receiver, realm);
          if (name === "negated" || name === "abs") {
            const fields = durationFields(data);
            for (let i = 0; i < fields.length; i++)
              fields[i] =
                name === "negated"
                  ? -(fields[i] ?? 0)
                  : Math.abs(fields[i] ?? 0);
            const changed = createDuration(fields);
            if (changed === undefined) throw "DURATION_TRANSFORM_INVARIANT";
            return make(changed, prototype);
          }
          if (name === "toLocaleString")
            return durationPartsText(
              durationFormatParts(
                configureDurationFormatter(args[0], args[1], realm, hooks),
                data,
              ),
            );
          if (name === "toString")
            return temporalDurationText(data, args[0], realm, hooks);
          return durationText(data);
        },
        hooks,
      ),
      true,
      true,
      hooks,
    );
  }
  builtinProperty(temporal, "Duration", constructor, true, true, hooks);
}
