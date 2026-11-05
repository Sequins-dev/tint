import { createArrayIterator } from "./iterator-intrinsics.ts";
import { requireTypedArray, typedArrayWindow } from "./typed-array-data.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
import { builtinFunction, builtinProperty } from "./intrinsics.ts";
import { viewObjectValue } from "./values.ts";
import { wellKnownSymbol, type ScriptPropertyKey } from "./symbols.ts";
import type { ObjectHooks, OrdinaryObject } from "./operations.ts";
export function installTypedArrayIterators(
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  function method(
    name: string,
    kind: "key" | "value" | "entry",
  ): OrdinaryObject<ScriptPropertyKey, unknown> {
    return builtinFunction(
      realm.functionPrototype,
      name,
      0,
      (receiver, args): unknown => {
        const data = requireTypedArray(receiver, realm);
        if (typedArrayWindow(data) === undefined)
          throw createRuntimeError(realm, "type");
        const object = viewObjectValue(receiver, realm.objectPrototype);
        if (object === undefined) throw "TYPED_ARRAY_ITERATOR_INVARIANT";
        return createArrayIterator(object, kind, realm);
      },
      hooks,
    );
  }
  const values = method("values", "value"),
    prototype = realm.typedArrayPrototype;
  builtinProperty(prototype, "values", values, true, true, hooks);
  builtinProperty(
    prototype,
    wellKnownSymbol(realm.symbolRegistry, "iterator"),
    values,
    true,
    true,
    hooks,
  );
  builtinProperty(prototype, "keys", method("keys", "key"), true, true, hooks);
  builtinProperty(
    prototype,
    "entries",
    method("entries", "entry"),
    true,
    true,
    hooks,
  );
}
