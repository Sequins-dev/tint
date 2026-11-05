import { requireTypedArray, typedArrayWindow } from "./typed-array-data.ts";
import { viewObjectValue, scriptStrictEqual } from "./values.ts";
import { numberValue } from "./coercion.ts";
import {
  getProperty,
  hasProperty,
  type OrdinaryObject,
  type ObjectHooks,
} from "./operations.ts";
import type { ScriptPropertyKey } from "./symbols.ts";
import { builtinFunction, builtinProperty } from "./intrinsics.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";
export function installTypedArraySearch(
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  function validate(receiver: unknown): {
    readonly object: OrdinaryObject<ScriptPropertyKey, unknown>;
    readonly length: number;
  } {
    const data = requireTypedArray(receiver, realm),
      window = typedArrayWindow(data);
    if (window === undefined) throw createRuntimeError(realm, "type");
    const object = viewObjectValue(receiver, realm.objectPrototype);
    if (object === undefined) throw "TYPED_ARRAY_SEARCH_INVARIANT";
    return { object, length: window.length };
  }
  function integer(value: unknown): number {
    const converted = numberValue(value, hooks, realm);
    if (converted.error === "unsupported")
      return rejectUnsupportedExecution(realm);
    if (converted.error !== "none") throw createRuntimeError(realm, "type");
    return converted.value !== converted.value
      ? 0
      : Math.trunc(converted.value);
  }
  builtinProperty(
    realm.typedArrayPrototype,
    "at",
    builtinFunction(
      realm.functionPrototype,
      "at",
      1,
      (receiver, args): unknown => {
        const source = validate(receiver),
          relative = integer(args[0]);
        const index = relative < 0 ? source.length + relative : relative;
        return index < 0 || index >= source.length
          ? undefined
          : getProperty<ScriptPropertyKey, unknown>(
              source.object,
              String(index),
              receiver,
              hooks,
            );
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  function search(name: string, reverse: boolean, includes: boolean): void {
    builtinProperty(
      realm.typedArrayPrototype,
      name,
      builtinFunction(
        realm.functionPrototype,
        name,
        1,
        (receiver, args): unknown => {
          const source = validate(receiver),
            length = source.length;
          if (length === 0) return includes ? false : -1;
          const from =
            reverse && args.length < 2 ? length - 1 : integer(args[1]);
          let index = reverse
            ? from >= 0
              ? Math.min(from, length - 1)
              : length + from
            : from >= 0
              ? from
              : Math.max(length + from, 0);
          while (index >= 0 && index < length) {
            const key = String(index);
            if (
              includes ||
              hasProperty<ScriptPropertyKey, unknown>(source.object, key)
            ) {
              const value = getProperty<ScriptPropertyKey, unknown>(
                  source.object,
                  key,
                  receiver,
                  hooks,
                ),
                expected = args[0];
              if (
                scriptStrictEqual(value, expected) ||
                (includes &&
                  typeof value === "number" &&
                  typeof expected === "number" &&
                  value !== value &&
                  expected !== expected)
              )
                return includes ? true : index === 0 ? 0 : index;
            }
            index += reverse ? -1 : 1;
          }
          return includes ? false : -1;
        },
        hooks,
      ),
      true,
      true,
      hooks,
    );
  }
  search("includes", false, true);
  search("indexOf", false, false);
  search("lastIndexOf", true, false);
}
