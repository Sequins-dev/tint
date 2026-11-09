import { temporalZonedHoursInDay } from "./temporal-zone-local.ts";
import { installZonedDifferenceMethods } from "./temporal-zoned-difference.ts";
import { plainDateTimeRoundingOptions } from "./temporal-rounding.ts";
import {
  zonedDateTimeArithmetic,
  roundTemporalZonedDateTime,
} from "./temporal-zoned-arithmetic.ts";
import { durationFrom } from "./temporal-duration-conversion.ts";
import { temporalStringOption } from "./temporal-options.ts";
import { createTemporalZonedObject } from "./temporal-zoned-construction.ts";
import { zonedDateTimeFrom } from "./temporal-zoned-conversion.ts";
import {
  temporalTimeZone,
  type TemporalTimeZone,
} from "./temporal-time-zone.ts";
import { installZonedCopyMethods } from "./temporal-zoned-copy.ts";
import type { ISODateTime } from "@tint/foundation/chrono/iso-date-time";
import { zonedDateTimeText } from "./temporal-zoned-format.ts";
import type { GregorianDate } from "@tint/foundation/chrono/gregorian-calendar";
import {
  createConstructorObject,
  type OrdinaryObject,
  type ObjectHooks,
} from "./operations.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
import { coerceBigInt } from "./bigint-coercion.ts";
import { compareBigIntValues, type BigIntValue } from "./bigints.ts";
import {
  temporalEpochMilliseconds,
  validTemporalEpoch,
} from "./temporal-epoch.ts";
import { requireCalendarAlgorithms } from "./temporal-coercion.ts";
import { installTemporalCalendarAccessors } from "./temporal-calendar-fields.ts";
import { installTemporalClockAccessors } from "./temporal-clock-fields.ts";
import {
  builtinProperty,
  builtinFunction,
  builtinFunctionMetadata,
  builtinAccessor,
} from "./intrinsics.ts";
import { constructorPrototype } from "./functions.ts";
import { viewObjectValue } from "./values.ts";
import { wellKnownSymbol, type ScriptPropertyKey } from "./symbols.ts";

export interface TemporalZonedDateTime {
  readonly zone: TemporalTimeZone;
  readonly epoch: BigIntValue;
  readonly dateTime: ISODateTime;
  readonly timeZone: string;
  readonly offset: string;
  readonly offsetNanoseconds: number;
}
function requireZoned(
  receiver: unknown,
  realm: ErrorRealm,
): TemporalZonedDateTime {
  const object = viewObjectValue(receiver, realm.objectPrototype);
  const data =
    object === undefined ? undefined : object.internalTemporalZonedDateTime;
  if (data === undefined) throw createRuntimeError(realm, "type");
  return data;
}
/** UTC and numeric fixed offsets need no host time-zone database. */
export function installTemporalZonedDateTime(
  temporal: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  const prototype = realm.temporalZonedDateTimePrototype;
  const constructor = createConstructorObject<ScriptPropertyKey, unknown>(
    realm.functionPrototype,
    (receiver, args): unknown => {
      throw createRuntimeError(realm, "type");
    },
    (args, target): unknown => {
      const epoch = coerceBigInt(args[0], false, realm, hooks);
      // Epoch range validation precedes all time-zone/calendar validation.
      if (!validTemporalEpoch(epoch.integer))
        throw createRuntimeError(realm, "range");
      const zone = temporalTimeZone(args[1], realm);
      const calendar = requireCalendarAlgorithms(args[2], realm);
      return createTemporalZonedObject(
        epoch,
        zone,
        constructorPrototype(target, "temporal-zoned-date-time", realm, hooks),
        realm,
        calendar,
      );
    },
  );
  builtinFunctionMetadata(constructor, "ZonedDateTime", 2, hooks);
  builtinProperty(constructor, "prototype", prototype, false, false, hooks);
  builtinProperty(prototype, "constructor", constructor, true, true, hooks);
  for (const name of ["from", "compare"]) {
    if (name === undefined) throw "ZONED_FACTORY_INVARIANT";
    builtinProperty(
      constructor,
      name,
      builtinFunction(
        realm.functionPrototype,
        name,
        name === "from" ? 1 : 2,
        (receiver, args): unknown => {
          const first = zonedDateTimeFrom(
            args[0],
            name === "from" ? args[1] : undefined,
            realm,
            hooks,
          );
          if (name === "from")
            return createTemporalZonedObject(
              first.epoch,
              first.zone,
              prototype,
              realm,
              first.calendar,
            );
          const second = zonedDateTimeFrom(args[1], undefined, realm, hooks);
          return compareBigIntValues(first.epoch, second.epoch);
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
    wellKnownSymbol(realm.symbolRegistry, "toStringTag"),
    "Temporal.ZonedDateTime",
    false,
    true,
    hooks,
  );
  installTemporalCalendarAccessors(
    prototype,
    realm,
    hooks,
    (receiver): GregorianDate => requireZoned(receiver, realm).dateTime.date,
  );
  installTemporalClockAccessors(
    prototype,
    realm,
    hooks,
    (receiver): ISODateTime => requireZoned(receiver, realm).dateTime,
  );
  for (const name of [
    "epochNanoseconds",
    "epochMilliseconds",
    "timeZoneId",
    "offset",
    "offsetNanoseconds",
    "hoursInDay",
  ]) {
    if (name === undefined) throw "ZONED_ACCESSOR_INVARIANT";
    builtinAccessor(
      prototype,
      name,
      builtinFunction(
        realm.functionPrototype,
        "get " + name,
        0,
        (receiver, args): unknown => {
          const d = requireZoned(receiver, realm);
          if (name === "epochNanoseconds") return d.epoch;
          if (name === "timeZoneId") return d.timeZone;
          if (name === "offset") return d.offset;
          if (name === "offsetNanoseconds") return d.offsetNanoseconds;
          if (name === "hoursInDay")
            return temporalZonedHoursInDay(d.dateTime.date, d.zone, realm);
          return temporalEpochMilliseconds(d.epoch.integer);
        },
        hooks,
      ),
      undefined,
      hooks,
    );
  }
  for (const name of ["add", "subtract"]) {
    if (name === undefined) throw "ZONED_ARITHMETIC_METHOD_INVARIANT";
    builtinProperty(
      prototype,
      name,
      builtinFunction(
        realm.functionPrototype,
        name,
        1,
        (receiver, args): unknown => {
          const data = requireZoned(receiver, realm);
          const duration = durationFrom(args[0], realm, hooks);
          const policy = temporalStringOption(
            args[1],
            "overflow",
            "constrain",
            ["constrain", "reject"],
            realm,
            hooks,
          );
          const epoch = zonedDateTimeArithmetic(
            data,
            duration,
            name === "subtract",
            policy,
            realm,
          );
          return createTemporalZonedObject(
            epoch,
            data.zone,
            prototype,
            realm,
            data.dateTime.calendar ?? "iso8601",
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
    "round",
    builtinFunction(
      realm.functionPrototype,
      "round",
      1,
      (receiver, args): unknown => {
        const data = requireZoned(receiver, realm);
        const settings = plainDateTimeRoundingOptions(args[0], realm, hooks);
        const epoch = roundTemporalZonedDateTime(data, settings, realm);
        return createTemporalZonedObject(
          epoch,
          data.zone,
          prototype,
          realm,
          data.dateTime.calendar ?? "iso8601",
        );
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  installZonedDifferenceMethods(
    prototype,
    realm,
    hooks,
    (receiver): TemporalZonedDateTime => requireZoned(receiver, realm),
  );
  installZonedCopyMethods(
    prototype,
    realm,
    hooks,
    (receiver): TemporalZonedDateTime => requireZoned(receiver, realm),
  );
  // toLocaleString is the ECMA-402 method installed by temporal-locale-string.ts.
  for (const name of ["toString", "toJSON", "valueOf"]) {
    if (name === undefined) throw "ZONED_METHOD_INVARIANT";
    builtinProperty(
      prototype,
      name,
      builtinFunction(
        realm.functionPrototype,
        name,
        0,
        (receiver, args): unknown => {
          if (name === "valueOf") throw createRuntimeError(realm, "type");
          const d = requireZoned(receiver, realm);
          return zonedDateTimeText(
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
  builtinProperty(temporal, "ZonedDateTime", constructor, true, true, hooks);
}
