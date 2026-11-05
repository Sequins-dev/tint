import { findTzifTransition } from "@tint/foundation/chrono/tzif";
import { fromNumber, multiply } from "@tint/foundation/numeric/big-integer";
import { splitTemporalEpochSecond } from "./temporal-epoch.ts";
import { temporalStringOption } from "./temporal-options.ts";
import { temporalTimeZonesEqual } from "./temporal-time-zone.ts";
import { createTemporalInstantObject } from "./temporal-instant-construction.ts";
import {
  createObject,
  type OrdinaryObject,
  type ObjectHooks,
} from "./operations.ts";
import { builtinProperty, builtinFunction } from "./intrinsics.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";
import { requireTemporalCalendar } from "./temporal-coercion.ts";
import {
  zonedDateTimeFrom,
  zonedDateTimeWith,
  interpretZonedOffset,
} from "./temporal-zoned-conversion.ts";
import { plainTimeFrom } from "./temporal-time-conversion.ts";
import { combineTemporalDateTime } from "./temporal-date-time-conversion.ts";
import { temporalStartOfDay } from "./temporal-zone-local.ts";
import { compareBigIntValues, createBigIntValue } from "./bigints.ts";
import { temporalTimeZoneLike } from "./temporal-time-zone.ts";
import { createTemporalZonedObject } from "./temporal-zoned-construction.ts";
import type { TemporalZonedDateTime } from "./temporal-zoned-date-time.ts";
import type { ScriptPropertyKey } from "./symbols.ts";
/** These conversions use immutable slots and intrinsic prototypes, never public getters. */
export function installZonedCopyMethods(
  prototype: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  extract: (receiver: unknown) => TemporalZonedDateTime,
): void {
  for (const name of [
    "toInstant",
    "toPlainDate",
    "toPlainTime",
    "toPlainDateTime",
    "withCalendar",
    "with",
    "withTimeZone",
    "withPlainTime",
    "startOfDay",
    "getTimeZoneTransition",
    "equals",
  ]) {
    if (name === undefined) throw "ZONED_COPY_METHOD_INVARIANT";
    builtinProperty(
      prototype,
      name,
      builtinFunction(
        realm.functionPrototype,
        name,
        name === "with" ||
          name === "withCalendar" ||
          name === "withTimeZone" ||
          name === "equals" ||
          name === "getTimeZoneTransition"
          ? 1
          : 0,
        (receiver, args): unknown => {
          const data = extract(receiver);
          if (name === "getTimeZoneTransition") {
            const value = args[0];
            if (value === undefined) throw createRuntimeError(realm, "type");
            let direction = "";
            if (typeof value === "string") direction = value;
            else {
              direction = temporalStringOption(
                value,
                "direction",
                "",
                ["next", "previous"],
                realm,
                hooks,
              );
              if (direction === "") throw createRuntimeError(realm, "range");
            }
            if (direction !== "next" && direction !== "previous")
              throw createRuntimeError(realm, "range");
            const zone = data.zone;
            if (zone.kind === "fixed") return null;
            const split = splitTemporalEpochSecond(data.epoch.integer);
            if (split === undefined) throw "ZONED_TRANSITION_EPOCH_INVARIANT";
            const result = findTzifTransition(zone.model, {
              epochSeconds: split.seconds,
              direction,
              inclusive:
                direction === "previous" && split.fractionNanoseconds > 0,
              minimum: -8640000000000,
              maximum: 8640000000000,
            });
            if (!result.ok) return rejectUnsupportedExecution(realm);
            const at = result.epochSeconds;
            if (at === undefined) return null;
            const second = fromNumber(at),
              billion = fromNumber(1000000000);
            if (second === undefined || billion === undefined)
              throw "ZONED_TRANSITION_SECOND_INVARIANT";
            return createTemporalZonedObject(
              createBigIntValue(multiply(second, billion)),
              data.zone,
              prototype,
              realm,
            );
          }
          if (name === "with") {
            const result = zonedDateTimeWith(
              data,
              args[0],
              args[1],
              realm,
              hooks,
            );
            return createTemporalZonedObject(
              result.epoch,
              result.zone,
              prototype,
              realm,
            );
          }
          if (name === "withPlainTime" || name === "startOfDay") {
            const epoch =
              name === "startOfDay" || args[0] === undefined
                ? createBigIntValue(
                    temporalStartOfDay(data.dateTime.date, data.zone, realm),
                  )
                : interpretZonedOffset(
                    combineTemporalDateTime(
                      data.dateTime.date,
                      plainTimeFrom(args[0], undefined, realm, hooks),
                      realm,
                    ),
                    data.zone,
                    undefined,
                    "ignore",
                    realm,
                  ).epoch;
            return createTemporalZonedObject(
              epoch,
              data.zone,
              prototype,
              realm,
            );
          }
          if (name === "withTimeZone")
            return createTemporalZonedObject(
              data.epoch,
              temporalTimeZoneLike(args[0], realm),
              prototype,
              realm,
            );
          if (name === "equals") {
            const other = zonedDateTimeFrom(args[0], undefined, realm, hooks);
            return (
              compareBigIntValues(data.epoch, other.epoch) === 0 &&
              temporalTimeZonesEqual(data.zone, other.zone, realm)
            );
          }
          if (name === "withCalendar") {
            if (args[0] === undefined) throw createRuntimeError(realm, "type");
            requireTemporalCalendar(args[0], realm);
            const object = createObject<ScriptPropertyKey, unknown>(prototype);
            object.internalTemporalZonedDateTime = data;
            object.internalTemporalCalendar = "iso8601";
            return object;
          }
          if (name === "toInstant")
            return createTemporalInstantObject(
              data.epoch,
              realm.temporalInstantPrototype,
            );
          const parent =
            name === "toPlainDate"
              ? realm.temporalPlainDatePrototype
              : name === "toPlainDateTime"
                ? realm.temporalPlainDateTimePrototype
                : realm.temporalPlainTimePrototype;
          const object = createObject<ScriptPropertyKey, unknown>(parent);
          if (name === "toPlainDate") {
            object.internalTemporalPlainDate = data.dateTime.date;
            object.internalTemporalCalendar = "iso8601";
          } else if (name === "toPlainDateTime") {
            object.internalTemporalPlainDateTime = data.dateTime;
            object.internalTemporalCalendar = "iso8601";
          } else
            object.internalTemporalPlainTime = {
              hour: data.dateTime.hour,
              minute: data.dateTime.minute,
              second: data.dateTime.second,
              nanosecond: data.dateTime.nanosecond,
            };
          return object;
        },
        hooks,
      ),
      true,
      true,
      hooks,
    );
  }
}
