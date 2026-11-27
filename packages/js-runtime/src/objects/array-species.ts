import { getFunctionRealm } from "./function-realms.ts";
import { createArrayObject } from "./arrays.ts";
import {
  getProperty,
  type OrdinaryObject,
  type ObjectHooks,
} from "./operations.ts";
import { wellKnownSymbol, type ScriptPropertyKey } from "./symbols.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
import { constructObject } from "./call.ts";
import { isArrayValue, viewObjectValue } from "./values.ts";

/** ArraySpeciesCreate: generic array-like receivers do not consult constructor.
 * A foreign realm's intrinsic Array is replaced with the current intrinsic. */
export function arraySpeciesCreate(
  original: OrdinaryObject<ScriptPropertyKey, unknown>,
  length: number,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  let constructor: unknown = undefined;
  if (isArrayValue(original, realm)) {
    constructor = getProperty<ScriptPropertyKey, unknown>(
      original,
      "constructor",
      original,
      hooks,
    );
    const candidate = viewObjectValue(constructor, realm.objectPrototype);
    if (
      candidate !== undefined &&
      candidate.internalRareSlots?.internalConstruct !== undefined
    ) {
      const constructorRealm = getFunctionRealm(candidate, realm);
      if (
        constructorRealm !== realm &&
        candidate === constructorRealm.arrayConstructor
      )
        constructor = undefined;
    }
    const object = viewObjectValue(constructor, realm.objectPrototype);
    if (object !== undefined) {
      constructor = getProperty<ScriptPropertyKey, unknown>(
        object,
        wellKnownSymbol(realm.symbolRegistry, "species"),
        constructor,
        hooks,
      );
      if (constructor === null) constructor = undefined;
    }
  }
  if (constructor === undefined)
    return createArrayObject<ScriptPropertyKey, unknown>(
      length,
      realm.arrayPrototype,
      realm.arrayHooks,
      hooks,
    );
  const target = viewObjectValue(constructor, realm.objectPrototype);
  if (
    target === undefined ||
    target.internalRareSlots?.internalConstruct === undefined
  )
    throw createRuntimeError(realm, "type");
  const result = constructObject<ScriptPropertyKey, unknown>(
    target,
    [length],
    { object: target, value: constructor },
    undefined,
  );
  const object = viewObjectValue(result.value, realm.objectPrototype);
  if (result.error !== "none" || object === undefined)
    throw createRuntimeError(realm, "type");
  return object;
}
