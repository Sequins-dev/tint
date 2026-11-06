import { installDateDifferenceMethods } from "./temporal-date-difference.ts";
import { plainDateArithmetic } from "./temporal-date-arithmetic.ts";
import { durationFrom } from "./temporal-duration-conversion.ts";
import { installPlainDateCopyMethods } from "./temporal-plain-date-methods.ts";
import { formatISODate } from "@tint/foundation/chrono/iso-date-time";
import { installISOCalendarAccessors } from "./temporal-calendar-fields.ts";
import { plainDateFrom } from "./temporal-plain-date-conversion.ts";
import { temporalInteger, requireISOCalendar } from "./temporal-coercion.ts";
import { temporalStringOption } from "./temporal-options.ts";
import {
  epochDayFromGregorian,
  type GregorianDate,
} from "@tint/foundation/chrono/gregorian-calendar";
import {
  createObject,
  createConstructorObject,
  type OrdinaryObject,
  type ObjectHooks,
} from "./operations.ts";
import {
  builtinProperty,
  builtinFunctionMetadata,
  builtinFunction,
} from "./intrinsics.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
import { viewObjectValue } from "./values.ts";
import { constructorPrototype } from "./functions.ts";
import { wellKnownSymbol, type ScriptPropertyKey } from "./symbols.ts";

function requireDate(value: unknown, realm: ErrorRealm): GregorianDate {
  const object = viewObjectValue(value, realm.objectPrototype);
  const date =
    object === undefined ? undefined : object.internalTemporalPlainDate;
  if (date === undefined) throw createRuntimeError(realm, "type");
  return date;
}
export function installTemporalPlainDate(
  temporal: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  const prototype = realm.temporalPlainDatePrototype;
  const constructor = createConstructorObject<ScriptPropertyKey, unknown>(
    realm.functionPrototype,
    (receiver, args): unknown => {
      throw createRuntimeError(realm, "type");
    },
    (args, target): unknown => {
      const year = temporalInteger(args[0], realm, hooks),
        month = temporalInteger(args[1], realm, hooks),
        day = temporalInteger(args[2], realm, hooks);
      requireISOCalendar(args[3], realm);
      const epoch = epochDayFromGregorian(year, month, day);
      if (epoch === undefined || epoch < -100000001 || epoch > 100000000)
        throw createRuntimeError(realm, "range");
      const object = createObject<ScriptPropertyKey, unknown>(
        constructorPrototype(target, "temporal-plain-date", realm, hooks),
      );
      object.internalTemporalCalendar = "iso8601";
      object.internalTemporalPlainDate = { year, month, day };
      return object;
    },
  );
  function create(
    date: GregorianDate,
  ): OrdinaryObject<ScriptPropertyKey, unknown> {
    const object = createObject<ScriptPropertyKey, unknown>(prototype);
    object.internalTemporalCalendar = "iso8601";
    object.internalTemporalPlainDate = {
      year: date.year,
      month: date.month,
      day: date.day,
    };
    return object;
  }
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
          const date = requireDate(receiver, realm);
          const duration = durationFrom(args[0], realm, hooks);
          const policy = temporalStringOption(
            args[1],
            "overflow",
            "constrain",
            ["constrain", "reject"],
            realm,
            hooks,
          );
          return create(
            plainDateArithmetic(
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
        create(plainDateFrom(args[0], args[1], realm, hooks)),
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
        const a = plainDateFrom(args[0], undefined, realm, hooks),
          b = plainDateFrom(args[1], undefined, realm, hooks);
        return a.year !== b.year
          ? a.year < b.year
            ? -1
            : 1
          : a.month !== b.month
            ? a.month < b.month
              ? -1
              : 1
            : a.day !== b.day
              ? a.day < b.day
                ? -1
                : 1
              : 0;
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinFunctionMetadata(constructor, "PlainDate", 3, hooks);
  builtinProperty(constructor, "prototype", prototype, false, false, hooks);
  builtinProperty(prototype, "constructor", constructor, true, true, hooks);
  builtinProperty(
    prototype,
    wellKnownSymbol(realm.symbolRegistry, "toStringTag"),
    "Temporal.PlainDate",
    false,
    true,
    hooks,
  );
  installISOCalendarAccessors(
    prototype,
    realm,
    hooks,
    (receiver): GregorianDate => requireDate(receiver, realm),
  );
  installDateDifferenceMethods(
    prototype,
    realm,
    hooks,
    (receiver): GregorianDate => requireDate(receiver, realm),
    "date",
  );
  installPlainDateCopyMethods(
    prototype,
    realm,
    hooks,
    (receiver): GregorianDate => requireDate(receiver, realm),
    create,
  );
  for (const name of ["toString", "toJSON", "valueOf"]) {
    if (name === undefined) throw "TEMPORAL_METHOD_INVARIANT";
    builtinProperty(
      prototype,
      name,
      builtinFunction(
        realm.functionPrototype,
        name,
        0,
        (receiver, args): unknown => {
          if (name === "valueOf") throw createRuntimeError(realm, "type");
          const date = requireDate(receiver, realm);
          const display =
            name === "toString"
              ? temporalStringOption(
                  args[0],
                  "calendarName",
                  "auto",
                  ["auto", "always", "never", "critical"],
                  realm,
                  hooks,
                )
              : "auto";
          return (
            formatISODate(date) +
            (display === "always"
              ? "[u-ca=iso8601]"
              : display === "critical"
                ? "[!u-ca=iso8601]"
                : "")
          );
        },
        hooks,
      ),
      true,
      true,
      hooks,
    );
  }
  builtinProperty(temporal, "PlainDate", constructor, true, true, hooks);
}
