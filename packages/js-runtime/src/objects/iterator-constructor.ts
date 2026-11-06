import { installIteratorSearch } from "./iterator-search.ts";
import { installIteratorFrom } from "./iterator-from.ts";
import { installIteratorConsumers } from "./iterator-consumers.ts";
import { installIteratorHelpers } from "./iterator-helpers.ts";
import {
  createObject,
  createConstructorObject,
  getOwnProperty,
  createDataProperty,
  setProperty,
  type OrdinaryObject,
  type ObjectHooks,
} from "./operations.ts";
import { viewObjectValue } from "./values.ts";
import { constructorPrototype } from "./functions.ts";
import {
  builtinFunction,
  builtinProperty,
  builtinAccessor,
  builtinFunctionMetadata,
} from "./intrinsics.ts";
import { wellKnownSymbol, type ScriptPropertyKey } from "./symbols.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";

/** Abstract Iterator base; concrete iterators and subclasses share its prototype.
 * Prototype intrinsics such as [Symbol.iterator] and [Symbol.dispose] are
 * installed with the realm by installIteratorIntrinsics. */
export function installIteratorConstructor(
  global: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  const prototype = realm.iteratorPrototype;
  const constructor: OrdinaryObject<ScriptPropertyKey, unknown> =
    createConstructorObject<ScriptPropertyKey, unknown>(
      realm.functionPrototype,
      (receiver, args): unknown => {
        throw createRuntimeError(realm, "type");
      },
      (args, target): unknown => {
        if (target === constructor) throw createRuntimeError(realm, "type");
        return createObject<ScriptPropertyKey, unknown>(
          constructorPrototype(target, "iterator", realm, hooks),
        );
      },
    );
  builtinFunctionMetadata(constructor, "Iterator", 0, hooks);
  builtinProperty(constructor, "prototype", prototype, false, false, hooks);
  builtinProperty(global, "Iterator", constructor, true, true, hooks);
  installIteratorFrom(constructor, realm, hooks);
  installIteratorConsumers(realm, hooks);
  installIteratorSearch(realm, hooks);
  installIteratorHelpers(realm, hooks, constructor);

  function inherited(
    key: ScriptPropertyKey,
    name: string,
    value: unknown,
  ): void {
    builtinAccessor(
      prototype,
      key,
      builtinFunction(
        realm.functionPrototype,
        "get " + name,
        0,
        (receiver, args): unknown => value,
        hooks,
      ),
      builtinFunction(
        realm.functionPrototype,
        "set " + name,
        1,
        (receiver, args): unknown => {
          const object = viewObjectValue(receiver, realm.objectPrototype);
          if (object === undefined || object === prototype)
            throw createRuntimeError(realm, "type");
          // SetterThatIgnoresPrototypeProperties creates a shadowing property
          // when absent, even if the inherited accessor is frozen.
          const accepted =
            getOwnProperty<ScriptPropertyKey, unknown>(object, key) ===
            undefined
              ? createDataProperty<ScriptPropertyKey, unknown>(
                  object,
                  key,
                  args[0],
                  hooks,
                )
              : setProperty<ScriptPropertyKey, unknown>(
                  object,
                  key,
                  args[0],
                  { object, value: receiver },
                  hooks,
                );
          if (!accepted) throw createRuntimeError(realm, "type");
          return undefined;
        },
        hooks,
      ),
      hooks,
    );
  }
  inherited("constructor", "constructor", constructor);
  inherited(
    wellKnownSymbol(realm.symbolRegistry, "toStringTag"),
    "[Symbol.toStringTag]",
    "Iterator",
  );
}
