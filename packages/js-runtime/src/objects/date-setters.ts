import {
  clipDateTime,
  makeDateTime,
  dateFields,
  fullDateYear,
} from "./date-values.ts";
import { builtinFunction, builtinProperty } from "./intrinsics.ts";
import type { ErrorRealm } from "./errors.ts";
import type { OrdinaryObject, ObjectHooks } from "./operations.ts";
import type { ScriptPropertyKey } from "./symbols.ts";
interface DateSetterControls {
  readonly requireDate: (
    receiver: unknown,
  ) => OrdinaryObject<ScriptPropertyKey, unknown>;
  readonly number: (value: unknown) => number;
  readonly localTime: (time: number) => number;
  readonly utcTime: (time: number) => number;
}
/** UTC and local setters share field updates; conversion order stays observable. */
export function installDateSetters(
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  controls: DateSetterControls,
): void {
  const prototype = realm.datePrototype;
  for (const name of [
    "setYear",
    "setFullYear",
    "setMonth",
    "setDate",
    "setHours",
    "setMinutes",
    "setSeconds",
    "setMilliseconds",
    "setUTCFullYear",
    "setUTCMonth",
    "setUTCDate",
    "setUTCHours",
    "setUTCMinutes",
    "setUTCSeconds",
    "setUTCMilliseconds",
  ]) {
    if (name === undefined) throw "DATE_SETTER_INVARIANT";
    const utc = name.startsWith("setUTC"),
      field = name.slice(utc ? 6 : 3);
    const count =
      field === "FullYear" || field === "Minutes"
        ? 3
        : field === "Hours"
          ? 4
          : field === "Month" || field === "Seconds"
            ? 2
            : 1;
    builtinProperty(
      prototype,
      name,
      builtinFunction(
        realm.functionPrototype,
        name,
        count,
        (receiver, args): unknown => {
          const object = controls.requireDate(receiver);
          const saved = object.internalDateValue;
          if (saved === undefined) throw "DATE_SLOT_INVARIANT";
          const first = controls.number(args[0]);
          if (field === "Year" && Number.isNaN(first)) {
            object.internalDateValue = NaN;
            return NaN;
          }
          // Year setters convert the initial argument before local conversion, but
          // before converting optional month/day. Other setters convert all args
          // before examining an invalid date or consulting the local zone.
          const base =
            field === "FullYear" || field === "Year"
              ? Number.isNaN(saved)
                ? 0
                : utc
                  ? saved
                  : controls.localTime(saved)
              : saved;
          const second =
            args.length > 1 && count > 1 ? controls.number(args[1]) : undefined;
          const third =
            args.length > 2 && count > 2 ? controls.number(args[2]) : undefined;
          const fourth =
            args.length > 3 && count > 3 ? controls.number(args[3]) : undefined;
          const fields = dateFields(
            field === "FullYear" || field === "Year" || utc
              ? base
              : controls.localTime(base),
          );
          // Invalid-date setters still coerce their arguments but must not undo
          // mutations performed during coercion when they return early.
          if (fields === undefined) return NaN;
          let year = fields.year,
            month = fields.month,
            day = fields.day,
            hour = fields.hour,
            minute = fields.minute,
            secondValue = fields.second,
            millisecond = fields.millisecond;
          if (field === "FullYear" || field === "Year") {
            year = field === "Year" ? fullDateYear(first) : first;
            if (second !== undefined) month = second;
            if (third !== undefined) day = third;
          } else if (field === "Month") {
            month = first;
            if (second !== undefined) day = second;
          } else if (field === "Date") day = first;
          else if (field === "Hours") {
            hour = first;
            if (second !== undefined) minute = second;
            if (third !== undefined) secondValue = third;
            if (fourth !== undefined) millisecond = fourth;
          } else if (field === "Minutes") {
            minute = first;
            if (second !== undefined) secondValue = second;
            if (third !== undefined) millisecond = third;
          } else if (field === "Seconds") {
            secondValue = first;
            if (second !== undefined) millisecond = second;
          } else millisecond = first;
          const value = makeDateTime(
            year,
            month,
            day,
            hour,
            minute,
            secondValue,
            millisecond,
          );
          const result = clipDateTime(utc ? value : controls.utcTime(value));
          object.internalDateValue = result;
          return result;
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
    "setTime",
    builtinFunction(
      realm.functionPrototype,
      "setTime",
      1,
      (receiver, args): unknown => {
        const object = controls.requireDate(receiver);
        const time = clipDateTime(controls.number(args[0]));
        object.internalDateValue = time;
        return time;
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
}
