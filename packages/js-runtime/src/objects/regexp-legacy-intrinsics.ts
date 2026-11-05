import { builtinAccessor, builtinFunction } from "./intrinsics.ts";
import type { OrdinaryObject, ObjectHooks } from "./operations.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
import { regexpString } from "./regexp-runtime.ts";
import type { ScriptPropertyKey } from "./symbols.ts";
/** Legacy accessors require their own realm's intrinsic constructor as receiver. */
export function installRegExpLegacyAccessors(
  constructor: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  const state = realm.regexpLegacyState;
  const names = [
    "input",
    "$_",
    "lastMatch",
    "$&",
    "lastParen",
    "$+",
    "leftContext",
    "$`",
    "rightContext",
    "$'",
    "$1",
    "$2",
    "$3",
    "$4",
    "$5",
    "$6",
    "$7",
    "$8",
    "$9",
  ];
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    if (name === undefined) throw "REGEXP_LEGACY_ACCESSOR_INVARIANT";
    const index = i < 10 ? Math.floor(i / 2) : i - 5;
    const getter = builtinFunction(
      realm.functionPrototype,
      "get " + name,
      0,
      (receiver, args): unknown => {
        if (receiver !== constructor) throw createRuntimeError(realm, "type");
        const value = state.values[index];
        if (value === undefined) throw createRuntimeError(realm, "type");
        return value;
      },
      hooks,
    );
    const setter =
      index === 0
        ? builtinFunction(
            realm.functionPrototype,
            "set " + name,
            1,
            (receiver, args): unknown => {
              if (receiver !== constructor)
                throw createRuntimeError(realm, "type");
              state.values[0] = regexpString(args[0], realm, hooks);
              return undefined;
            },
            hooks,
          )
        : undefined;
    builtinAccessor(constructor, name, getter, setter, hooks);
  }
}
