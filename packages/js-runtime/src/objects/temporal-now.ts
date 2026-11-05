import {
  temporalTimeZone,
  temporalTimeZoneLike,
} from "./temporal-time-zone.ts";
import {
  createTemporalZonedObject,
  temporalZonedData,
} from "./temporal-zoned-construction.ts";
import { temporalEpochFromMilliseconds } from "./temporal-epoch.ts";
import { createBigIntValue, type BigIntValue } from "./bigints.ts";
import { createTemporalInstantObject } from "./temporal-instant-construction.ts";
import {
  createObject,
  type OrdinaryObject,
  type ObjectHooks,
} from "./operations.ts";
import { builtinProperty, builtinFunction } from "./intrinsics.ts";
import { rejectUnsupportedExecution, type ErrorRealm } from "./errors.ts";
import { wellKnownSymbol, type ScriptPropertyKey } from "./symbols.ts";

function systemEpoch(realm: ErrorRealm): BigIntValue {
  const clock = realm.wallClockMilliseconds;
  if (clock === undefined) return rejectUnsupportedExecution(realm);
  // Floor before exact multiplication; the host explicitly supplies millisecond precision.
  const milliseconds = clock();
  if (!Number.isFinite(milliseconds)) return rejectUnsupportedExecution(realm);
  const bounded = Math.max(
    -8640000000000000,
    Math.min(8640000000000000, milliseconds),
  );
  const epoch = temporalEpochFromMilliseconds(Math.floor(bounded));
  if (epoch === undefined) return rejectUnsupportedExecution(realm);
  return createBigIntValue(epoch);
}
function systemZoneIdentifier(realm: ErrorRealm): string {
  const identify = realm.systemTimeZoneIdentifier;
  if (identify === undefined) return rejectUnsupportedExecution(realm);
  return identify();
}

/** Clock and system-zone capabilities belong to the embedding. Resolve the zone
 * before reading the clock, and allocate directly from intrinsic prototypes. */
export function installTemporalNow(
  temporal: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  const now = createObject<ScriptPropertyKey, unknown>(realm.objectPrototype);
  builtinProperty(
    now,
    wellKnownSymbol(realm.symbolRegistry, "toStringTag"),
    "Temporal.Now",
    false,
    true,
    hooks,
  );
  for (const name of [
    "instant",
    "timeZoneId",
    "plainDateTimeISO",
    "zonedDateTimeISO",
    "plainDateISO",
    "plainTimeISO",
  ]) {
    if (name === undefined) throw "TEMPORAL_NOW_METHOD_INVARIANT";
    builtinProperty(
      now,
      name,
      builtinFunction(
        realm.functionPrototype,
        name,
        0,
        (receiver, args): unknown => {
          if (name === "timeZoneId") return systemZoneIdentifier(realm);
          if (name === "instant")
            return createTemporalInstantObject(
              systemEpoch(realm),
              realm.temporalInstantPrototype,
            );
          const zone =
            args[0] === undefined
              ? temporalTimeZone(systemZoneIdentifier(realm), realm)
              : temporalTimeZoneLike(args[0], realm);
          const epoch = systemEpoch(realm);
          if (name === "zonedDateTimeISO")
            return createTemporalZonedObject(
              epoch,
              zone,
              realm.temporalZonedDateTimePrototype,
              realm,
            );
          const data = temporalZonedData(epoch, zone, realm).dateTime;
          const parent =
            name === "plainDateISO"
              ? realm.temporalPlainDatePrototype
              : name === "plainTimeISO"
                ? realm.temporalPlainTimePrototype
                : realm.temporalPlainDateTimePrototype;
          const object = createObject<ScriptPropertyKey, unknown>(parent);
          if (name === "plainTimeISO")
            object.internalTemporalPlainTime = {
              hour: data.hour,
              minute: data.minute,
              second: data.second,
              nanosecond: data.nanosecond,
            };
          else {
            object.internalTemporalCalendar = "iso8601";
            if (name === "plainDateISO")
              object.internalTemporalPlainDate = data.date;
            else object.internalTemporalPlainDateTime = data;
          }
          return object;
        },
        hooks,
      ),
      true,
      true,
      hooks,
    );
  }
  builtinProperty(temporal, "Now", now, true, true, hooks);
}
