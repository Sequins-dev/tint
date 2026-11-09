import { createTemporalInstantObject } from "./temporal-instant-construction.ts";
import { temporalTimeZoneLike } from "./temporal-time-zone.ts";
import { createTemporalZonedObject } from "./temporal-zoned-construction.ts";
import { temporalTimeDifference } from "./temporal-time-difference.ts";
import { instantText } from "./temporal-instant-format.ts";
import { roundIntegerAsIfPositive } from "@tint/foundation/numeric/integer-rounding";
import { instantRoundingOptions } from "./temporal-rounding.ts";
import { durationTimeNanoseconds } from "@tint/foundation/chrono/temporal-duration";
import { durationFrom } from "./temporal-duration-conversion.ts";
import { compare, add, subtract } from "@tint/foundation/numeric/big-integer";
import {
  createObject,
  createConstructorObject,
  type OrdinaryObject,
  type ObjectHooks,
} from "./operations.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";
import { createBigIntValue, type BigIntValue } from "./bigints.ts";
import { coerceBigInt } from "./bigint-coercion.ts";
import { numberValue } from "./coercion.ts";
import {
  temporalEpochMilliseconds,
  temporalEpochFromMilliseconds,
  validTemporalEpoch,
} from "./temporal-epoch.ts";
import { instantFrom } from "./temporal-instant-conversion.ts";
import {
  builtinProperty,
  builtinFunction,
  builtinFunctionMetadata,
  builtinAccessor,
} from "./intrinsics.ts";
import { constructorPrototype } from "./functions.ts";
import { viewObjectValue } from "./values.ts";
import { wellKnownSymbol, type ScriptPropertyKey } from "./symbols.ts";
function requireInstant(value: unknown, realm: ErrorRealm): BigIntValue {
  const object = viewObjectValue(value, realm.objectPrototype),
    epoch = object === undefined ? undefined : object.internalTemporalInstant;
  if (epoch === undefined) throw createRuntimeError(realm, "type");
  return epoch;
}
export function installTemporalInstant(
  temporal: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  const prototype = realm.temporalInstantPrototype;
  function valid(epoch: BigIntValue): BigIntValue {
    if (!validTemporalEpoch(epoch.integer))
      throw createRuntimeError(realm, "range");
    return epoch;
  }
  const constructor = createConstructorObject<ScriptPropertyKey, unknown>(
    realm.functionPrototype,
    (receiver, args): unknown => {
      throw createRuntimeError(realm, "type");
    },
    (args, target): unknown => {
      const epoch = valid(coerceBigInt(args[0], false, realm, hooks));
      return createTemporalInstantObject(
        epoch,
        constructorPrototype(target, "temporal-instant", realm, hooks),
      );
    },
  );
  builtinFunctionMetadata(constructor, "Instant", 1, hooks);
  builtinProperty(constructor, "prototype", prototype, false, false, hooks);
  builtinProperty(prototype, "constructor", constructor, true, true, hooks);
  builtinProperty(
    prototype,
    wellKnownSymbol(realm.symbolRegistry, "toStringTag"),
    "Temporal.Instant",
    false,
    true,
    hooks,
  );
  for (const name of [
    "from",
    "fromEpochMilliseconds",
    "fromEpochNanoseconds",
    "compare",
  ]) {
    if (name === undefined) throw "INSTANT_STATIC_INVARIANT";
    builtinProperty(
      constructor,
      name,
      builtinFunction(
        realm.functionPrototype,
        name,
        name === "compare" ? 2 : 1,
        (receiver, args): unknown => {
          if (name === "compare")
            return compare(
              instantFrom(args[0], realm, hooks).integer,
              instantFrom(args[1], realm, hooks).integer,
            );
          if (name === "from")
            return createTemporalInstantObject(
              instantFrom(args[0], realm, hooks),
              prototype,
            );
          if (name === "fromEpochNanoseconds")
            return createTemporalInstantObject(
              valid(coerceBigInt(args[0], false, realm, hooks)),
              prototype,
            );
          const converted = numberValue(args[0], hooks, realm);
          if (converted.error === "unsupported")
            return rejectUnsupportedExecution(realm);
          if (converted.error !== "none")
            throw createRuntimeError(realm, "type");
          const epoch = temporalEpochFromMilliseconds(converted.value);
          if (epoch === undefined) throw createRuntimeError(realm, "range");
          return createTemporalInstantObject(
            createBigIntValue(epoch),
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
  for (const name of ["epochNanoseconds", "epochMilliseconds"]) {
    if (name === undefined) throw "INSTANT_ACCESSOR_INVARIANT";
    builtinAccessor(
      prototype,
      name,
      builtinFunction(
        realm.functionPrototype,
        "get " + name,
        0,
        (receiver, args): unknown => {
          const epoch = requireInstant(receiver, realm);
          return name === "epochNanoseconds"
            ? epoch
            : temporalEpochMilliseconds(epoch.integer);
        },
        hooks,
      ),
      undefined,
      hooks,
    );
  }
  builtinProperty(
    prototype,
    "round",
    builtinFunction(
      realm.functionPrototype,
      "round",
      1,
      (receiver, args): unknown => {
        const epoch = requireInstant(receiver, realm);
        const options = instantRoundingOptions(args[0], realm, hooks);
        const rounded = roundIntegerAsIfPositive(
          epoch.integer,
          options.increment,
          options.mode,
        );
        if (rounded === undefined) throw "INSTANT_ROUNDING_INVARIANT";
        return createTemporalInstantObject(
          valid(createBigIntValue(rounded)),
          prototype,
        );
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(
    prototype,
    "toZonedDateTimeISO",
    builtinFunction(
      realm.functionPrototype,
      "toZonedDateTimeISO",
      1,
      (receiver, args): unknown => {
        const epoch = requireInstant(receiver, realm);
        const zone = temporalTimeZoneLike(args[0], realm);
        return createTemporalZonedObject(
          epoch,
          zone,
          realm.temporalZonedDateTimePrototype,
          realm,
        );
      },
      hooks,
    ),
    true,
    true,
    hooks,
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
          const epoch = requireInstant(receiver, realm);
          const other = instantFrom(args[0], realm, hooks).integer;
          const own = epoch.integer;
          const delta =
            name === "until" ? subtract(other, own) : subtract(own, other);
          const duration = temporalTimeDifference(
            delta,
            args[1],
            "second",
            realm,
            hooks,
          );
          const object = createObject<ScriptPropertyKey, unknown>(
            realm.temporalDurationPrototype,
          );
          object.internalTemporalDuration = duration;
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
    if (name === undefined) throw "INSTANT_ARITHMETIC_INVARIANT";
    builtinProperty(
      prototype,
      name,
      builtinFunction(
        realm.functionPrototype,
        name,
        1,
        (receiver, args): unknown => {
          const epoch = requireInstant(receiver, realm);
          const duration = durationFrom(args[0], realm, hooks);
          if (
            duration.years !== 0 ||
            duration.months !== 0 ||
            duration.weeks !== 0 ||
            duration.days !== 0
          )
            throw createRuntimeError(realm, "range");
          const delta = durationTimeNanoseconds(duration);
          return createTemporalInstantObject(
            valid(
              createBigIntValue(
                name === "add"
                  ? add(epoch.integer, delta)
                  : subtract(epoch.integer, delta),
              ),
            ),
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
    "equals",
    builtinFunction(
      realm.functionPrototype,
      "equals",
      1,
      (receiver, args): unknown => {
        const epoch = requireInstant(receiver, realm);
        return (
          compare(epoch.integer, instantFrom(args[0], realm, hooks).integer) ===
          0
        );
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  for (const name of ["toString", "toJSON", "valueOf"]) {
    if (name === undefined) throw "INSTANT_METHOD_INVARIANT";
    builtinProperty(
      prototype,
      name,
      builtinFunction(
        realm.functionPrototype,
        name,
        0,
        (receiver, args): unknown => {
          if (name === "valueOf") throw createRuntimeError(realm, "type");
          const epoch = requireInstant(receiver, realm);
          return instantText(
            epoch,
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
  builtinProperty(temporal, "Instant", constructor, true, true, hooks);
}
