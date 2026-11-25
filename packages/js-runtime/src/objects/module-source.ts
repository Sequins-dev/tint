import { createRuntimeError, type ErrorRealm } from "./errors.ts";
import {
  builtinFunction,
  builtinFunctionMetadata,
  builtinProperty,
  builtinAccessor,
} from "./intrinsics.ts";
import {
  ensureExoticSlots,
  exoticSlots,
  createConstructorObject,
  createObject,
  type OrdinaryObject,
  type ObjectHooks,
} from "./operations.ts";
import { viewObjectValue } from "./values.ts";
import { wellKnownSymbol, type ScriptPropertyKey } from "./symbols.ts";

/** Realm intrinsic only; embeddings expose concrete source objects, not a global constructor. */
export function installModuleSourceIntrinsic(
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  const prototype = realm.abstractModuleSourcePrototype;
  const constructor = createConstructorObject<ScriptPropertyKey, unknown>(
    realm.functionPrototype,
    (_receiver, _arguments): unknown => {
      throw createRuntimeError(realm, "type");
    },
    (_arguments, _newTarget): unknown => {
      throw createRuntimeError(realm, "type");
    },
  );
  builtinFunctionMetadata(constructor, "AbstractModuleSource", 0, hooks);
  builtinProperty(constructor, "prototype", prototype, false, false, hooks);
  builtinProperty(prototype, "constructor", constructor, true, true, hooks);
  builtinAccessor(
    prototype,
    wellKnownSymbol(realm.symbolRegistry, "toStringTag"),
    builtinFunction(
      realm.functionPrototype,
      "get [Symbol.toStringTag]",
      0,
      (receiver, _arguments): unknown => {
        const object = viewObjectValue(receiver, realm.objectPrototype);
        return object === undefined
          ? undefined
          : exoticSlots(object).internalModuleSourceClassName;
      },
      hooks,
    ),
    undefined,
    hooks,
  );
  realm.abstractModuleSourceConstructor = constructor;
}

/** Concrete source identity is embedding-owned and carries an unforgeable runtime slot. */
export function createModuleSourceObject(
  realm: ErrorRealm,
  prototype: OrdinaryObject<ScriptPropertyKey, unknown>,
  className: string,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  if (prototype.prototype !== realm.abstractModuleSourcePrototype)
    throw "MODULE_SOURCE_PROTOTYPE_INVARIANT";
  const source = createObject<ScriptPropertyKey, unknown>(prototype);
  ensureExoticSlots(source).internalModuleSourceClassName = className;
  return source;
}
