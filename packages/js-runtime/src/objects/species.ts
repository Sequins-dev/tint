import {
  getProperty,
  type OrdinaryObject,
  type ObjectHooks,
} from "./operations.ts";
import { wellKnownSymbol, type ScriptPropertyKey } from "./symbols.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
import { viewObjectValue } from "./values.ts";

/** SpeciesConstructor, shared by APIs whose result type is constructor-selected. */
export function speciesConstructor(
  original: OrdinaryObject<ScriptPropertyKey, unknown>,
  fallback: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  const constructor = getProperty<ScriptPropertyKey, unknown>(
    original,
    "constructor",
    original,
    hooks,
  );
  if (constructor === undefined) return fallback;
  const object = viewObjectValue(constructor, realm.objectPrototype);
  if (object === undefined) throw createRuntimeError(realm, "type");
  const species = getProperty<ScriptPropertyKey, unknown>(
    object,
    wellKnownSymbol(realm.symbolRegistry, "species"),
    constructor,
    hooks,
  );
  if (species === undefined || species === null) return fallback;
  const target = viewObjectValue(species, realm.objectPrototype);
  if (target === undefined || target.internalConstruct === undefined)
    throw createRuntimeError(realm, "type");
  return target;
}
