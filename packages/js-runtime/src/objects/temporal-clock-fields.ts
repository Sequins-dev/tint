import type { ISOTime } from "@tint/foundation/chrono/iso-date-time";
import { builtinAccessor, builtinFunction } from "./intrinsics.ts";
import type { OrdinaryObject, ObjectHooks } from "./operations.ts";
import type { ErrorRealm } from "./errors.ts";
import type { ScriptPropertyKey } from "./symbols.ts";
/** Clock fields are identical across plain and zoned date-time slot adapters. */
export function installTemporalClockAccessors(
  prototype: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  extract: (receiver: unknown) => ISOTime,
): void {
  for (const name of [
    "hour",
    "minute",
    "second",
    "millisecond",
    "microsecond",
    "nanosecond",
  ]) {
    if (name === undefined) throw "TEMPORAL_CLOCK_ACCESSOR_INVARIANT";
    builtinAccessor(
      prototype,
      name,
      builtinFunction(
        realm.functionPrototype,
        "get " + name,
        0,
        (receiver, args): unknown => {
          const d = extract(receiver);
          return name === "hour"
            ? d.hour
            : name === "minute"
              ? d.minute
              : name === "second"
                ? d.second
                : name === "millisecond"
                  ? Math.floor(d.nanosecond / 1000000)
                  : name === "microsecond"
                    ? Math.floor(d.nanosecond / 1000) % 1000
                    : d.nanosecond % 1000;
        },
        hooks,
      ),
      undefined,
      hooks,
    );
  }
}
