import { viewObjectValue } from "./values.ts";
import type { ScriptPropertyKey } from "./symbols.ts";
import {
  createDataProperty,
  getProperty,
  type OrdinaryObject,
  type ObjectHooks,
} from "./operations.ts";
import { createArrayObject } from "./arrays.ts";
import { numberValue } from "./coercion.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";

export function lengthOfArrayLike(
  object: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): number {
  const converted = numberValue(
    getProperty<ScriptPropertyKey, unknown>(object, "length", object, hooks),
    hooks,
    realm,
  );
  if (converted.error === "unsupported")
    return rejectUnsupportedExecution(realm);
  if (converted.error !== "none") throw createRuntimeError(realm, "type");
  const number = converted.value;
  return number > 0 ? Math.min(Math.floor(number), 9007199254740991) : 0;
}

/** Create a dense array from an internal argument list without observable
 * iteration or the Array constructor's single-number length interpretation. */
export function createArrayFromList(
  args: readonly unknown[],
  start: number,
  prototype: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  const length = Math.max(0, args.length - start);
  const object = createArrayObject<ScriptPropertyKey, unknown>(
    length,
    prototype,
    realm.arrayHooks,
    hooks,
  );
  for (let index = 0; index < length; index++) {
    if (
      !createDataProperty<ScriptPropertyKey, unknown>(
        object,
        String(index),
        args[start + index],
        hooks,
      )
    )
      throw "ARRAY_LIST_INVARIANT";
  }
  return object;
}

/** Copy a typed internal string list into an independently mutable Script Array. */
export function createStringArrayFromList(
  values: readonly string[],
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  const result: unknown[] = [];
  for (const value of values) {
    if (value === undefined) throw "STRING_ARRAY_LIST_INVARIANT";
    result.push(value);
  }
  return createArrayFromList(result, 0, realm.arrayPrototype, realm, hooks);
}

/** CreateListFromArrayLike reads every indexed value, including absent entries. */
export function arrayLikeValues(
  value: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): unknown[] {
  const object = viewObjectValue(value, realm.objectPrototype);
  if (object === undefined) throw createRuntimeError(realm, "type");
  const length = lengthOfArrayLike(object, realm, hooks),
    result: unknown[] = [];
  for (let index = 0; index < length; index++)
    result.push(
      getProperty<ScriptPropertyKey, unknown>(
        object,
        String(index),
        value,
        hooks,
      ),
    );
  return result;
}
