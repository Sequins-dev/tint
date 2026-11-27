import type { OrdinaryObject, ObjectHooks } from "./operations.ts";
import { builtinFunction, builtinProperty } from "./intrinsics.ts";
import { viewObjectValue } from "./values.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
import type { ScriptPropertyKey } from "./symbols.ts";
import {
  configureDateTimeFormatter,
  dateTimePartsText,
} from "./intl-date-time-format.ts";
import {
  dateTimeTemporalKind,
  dateTimeValueParts,
  dateTimeInstantParts,
} from "./intl-date-time-value.ts";
import { bigIntInteger } from "./bigints.ts";
import { exoticSlots } from "./operations.ts";
type Obj = OrdinaryObject<ScriptPropertyKey, unknown>;
export function installTemporalLocaleStrings(
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  const prototypes: readonly Obj[] = [
    realm.temporalPlainDatePrototype,
    realm.temporalPlainYearMonthPrototype,
    realm.temporalPlainMonthDayPrototype,
    realm.temporalPlainTimePrototype,
    realm.temporalPlainDateTimePrototype,
    realm.temporalInstantPrototype,
    realm.temporalZonedDateTimePrototype,
  ];
  for (let index = 0; index < prototypes.length; index++) {
    const prototype: Obj | undefined = prototypes[index],
      kind = index;
    if (prototype === undefined) throw "TEMPORAL_LOCALE_PROTOTYPE_INVARIANT";
    builtinProperty(
      prototype,
      "toLocaleString",
      builtinFunction(
        realm.functionPrototype,
        "toLocaleString",
        0,
        (receiver, args): unknown => {
          const object = viewObjectValue(receiver, realm.objectPrototype);
          if (object === undefined || dateTimeTemporalKind(object) !== kind)
            throw createRuntimeError(realm, "type");
          const required =
              kind === 0
                ? "date"
                : kind === 1
                  ? "year-month"
                  : kind === 2
                    ? "month-day"
                    : kind === 3
                      ? "time"
                      : "any",
            defaults =
              kind < 4 ? required : kind === 6 ? "zoned-date-time" : "all",
            zoned = exoticSlots(object).internalTemporalZonedDateTime,
            formatter = configureDateTimeFormatter(
              args[0],
              args[1],
              realm,
              hooks,
              required,
              defaults,
              zoned === undefined ? undefined : zoned.zone,
            );
          if (kind === 6) {
            if (zoned === undefined) throw "TEMPORAL_LOCALE_ZONED_INVARIANT";
            const calendar =
              exoticSlots(object).internalTemporalCalendar ?? "iso8601";
            if (
              calendar !== "iso8601" &&
              calendar !== formatter.configuration.locale.calendar
            )
              throw createRuntimeError(realm, "range");
            return dateTimePartsText(
              dateTimeInstantParts(
                formatter,
                bigIntInteger(zoned.epoch),
                realm,
              ),
            );
          }
          return dateTimePartsText(
            dateTimeValueParts(formatter, { kind, numeric: 0, object }, realm),
          );
        },
        hooks,
      ),
      true,
      true,
      hooks,
    );
  }
}
