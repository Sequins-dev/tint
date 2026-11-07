import {
  compareISODateTime,
  type ISODateTime,
} from "@tint/foundation/chrono/iso-date-time";
import {
  createObject,
  type OrdinaryObject,
  type ObjectHooks,
} from "./operations.ts";
import { builtinProperty, builtinFunction } from "./intrinsics.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
import { plainTimeFrom } from "./temporal-time-conversion.ts";
import {
  plainDateTimeFrom,
  combineTemporalDateTime,
  plainDateTimeWith,
} from "./temporal-date-time-conversion.ts";
import { temporalTimeZoneLike } from "./temporal-time-zone.ts";
import { temporalDisambiguationOption } from "./temporal-options.ts";
import { interpretZonedOffset } from "./temporal-zoned-conversion.ts";
import { createTemporalZonedObject } from "./temporal-zoned-construction.ts";
import {
  requireCalendarAlgorithms,
  temporalCalendarIdentifier,
} from "./temporal-coercion.ts";
import type { ScriptPropertyKey } from "./symbols.ts";
export function installDateTimeCopyMethods(
  prototype: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  extract: (receiver: unknown) => ISODateTime,
  create: (data: ISODateTime) => OrdinaryObject<ScriptPropertyKey, unknown>,
): void {
  for (const name of [
    "equals",
    "with",
    "withCalendar",
    "withPlainTime",
    "toPlainDate",
    "toPlainTime",
    "toZonedDateTime",
  ]) {
    if (name === undefined) throw "DATE_TIME_COPY_METHOD_INVARIANT";
    builtinProperty(
      prototype,
      name,
      builtinFunction(
        realm.functionPrototype,
        name,
        name === "equals" ||
          name === "with" ||
          name === "withCalendar" ||
          name === "toZonedDateTime"
          ? 1
          : 0,
        (receiver, args): unknown => {
          const data = extract(receiver);
          if (name === "toZonedDateTime") {
            const zone = temporalTimeZoneLike(args[0], realm);
            const disambiguation = temporalDisambiguationOption(
              args[1],
              realm,
              hooks,
            );
            const result = interpretZonedOffset(
              data,
              zone,
              undefined,
              "ignore",
              realm,
              disambiguation,
            );
            return createTemporalZonedObject(
              result.epoch,
              zone,
              realm.temporalZonedDateTimePrototype,
              realm,
              data.calendar ?? "iso8601",
            );
          }
          if (name === "with")
            return create(
              plainDateTimeWith(data, args[0], args[1], realm, hooks),
            );
          if (name === "equals") {
            const other = plainDateTimeFrom(args[0], undefined, realm, hooks);
            return (
              compareISODateTime(data, other) === 0 &&
              (data.calendar ?? "iso8601") === (other.calendar ?? "iso8601")
            );
          }
          if (name === "withCalendar") {
            if (args[0] === undefined) throw createRuntimeError(realm, "type");
            const calendar = requireCalendarAlgorithms(
              temporalCalendarIdentifier(args[0], realm),
              realm,
            );
            return create(
              combineTemporalDateTime(data.date, data, realm, calendar),
            );
          }
          if (name === "withPlainTime") {
            const time =
              args[0] === undefined
                ? { hour: 0, minute: 0, second: 0, nanosecond: 0 }
                : plainTimeFrom(args[0], undefined, realm, hooks);
            return create(
              combineTemporalDateTime(
                data.date,
                time,
                realm,
                data.calendar ?? "iso8601",
              ),
            );
          }
          const date = name === "toPlainDate";
          const result = createObject<ScriptPropertyKey, unknown>(
            date
              ? realm.temporalPlainDatePrototype
              : realm.temporalPlainTimePrototype,
          );
          if (date) {
            result.internalTemporalPlainDate = data.date;
            result.internalTemporalCalendar = data.calendar ?? "iso8601";
          } else
            result.internalTemporalPlainTime = {
              hour: data.hour,
              minute: data.minute,
              second: data.second,
              nanosecond: data.nanosecond,
            };
          return result;
        },
        hooks,
      ),
      true,
      true,
      hooks,
    );
  }
}
