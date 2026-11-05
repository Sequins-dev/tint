import { joinIndexedProperties } from "./join-indexed-properties.ts";
import { requireTypedArray, typedArrayWindow } from "./typed-array-data.ts";
import { viewObjectValue } from "./values.ts";
import { stringValue } from "./coercion.ts";
import { getOwnProperty, type ObjectHooks } from "./operations.ts";
import type { ScriptPropertyKey } from "./symbols.ts";
import { builtinFunction, builtinProperty } from "./intrinsics.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";
export function installTypedArrayText(
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  function text(value: unknown): string {
    const converted = stringValue(value, hooks, realm);
    if (converted.error === "unsupported")
      return rejectUnsupportedExecution(realm);
    if (converted.error !== "none") throw createRuntimeError(realm, "type");
    return converted.value;
  }
  builtinProperty(
    realm.typedArrayPrototype,
    "join",
    builtinFunction(
      realm.functionPrototype,
      "join",
      1,
      (receiver, args): unknown => {
        const data = requireTypedArray(receiver, realm),
          window = typedArrayWindow(data);
        if (window === undefined) throw createRuntimeError(realm, "type");
        const object = viewObjectValue(receiver, realm.objectPrototype);
        if (object === undefined) throw "TYPED_ARRAY_JOIN_INVARIANT";
        const length = window.length,
          separator = args[0] === undefined ? "," : text(args[0]);
        return joinIndexedProperties(
          object,
          length,
          separator,
          undefined,
          [],
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
  builtinProperty(
    realm.typedArrayPrototype,
    "toLocaleString",
    builtinFunction(
      realm.functionPrototype,
      "toLocaleString",
      0,
      (receiver, args): unknown => {
        const data = requireTypedArray(receiver, realm),
          window = typedArrayWindow(data);
        if (window === undefined) throw createRuntimeError(realm, "type");
        const object = viewObjectValue(receiver, realm.objectPrototype);
        if (object === undefined) throw "TYPED_ARRAY_LOCALE_INVARIANT";
        return joinIndexedProperties(
          object,
          window.length,
          ",",
          "toLocaleString",
          [args[0], args[1]],
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
  const toString = getOwnProperty<ScriptPropertyKey, unknown>(
    realm.arrayPrototype,
    "toString",
  );
  if (toString === undefined) throw "TYPED_ARRAY_REQUIRES_ARRAY_INTRINSICS";
  builtinProperty(
    realm.typedArrayPrototype,
    "toString",
    toString.value,
    true,
    true,
    hooks,
  );
}
