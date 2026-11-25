import { installSetAlgebra } from "./set-algebra.ts";
import { requireSet, createSetData } from "./set-data.ts";
import {
  hasMap,
  setMap,
  deleteMap,
  clearMap,
  createMapCursor,
  advanceMapCursor,
  readMapCursorKey,
} from "@tint/foundation/collections/linked-map";
import {
  ensureExoticSlots,
  exoticSlots,
  createObject,
  createConstructorObject,
  getProperty,
  type OrdinaryObject,
  type ObjectHooks,
} from "./operations.ts";
import {
  builtinFunction,
  builtinProperty,
  builtinAccessor,
  builtinFunctionMetadata,
} from "./intrinsics.ts";
import { viewObjectValue, callObjectValue } from "./values.ts";
import { isCallableObject } from "./call.ts";
import { constructorPrototype } from "./functions.ts";
import {
  getScriptIterator,
  stepScriptIterator,
  closeScriptIterator,
} from "./iteration.ts";
import { createArrayFromList } from "./array-like.ts";
import { createIteratorResult } from "./iterator-intrinsics.ts";
import { wellKnownSymbol, type ScriptPropertyKey } from "./symbols.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";

/** Set shares value-key storage and live cursors, with distinct collection brands. */
export function installSetIntrinsics(
  global: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  const prototype = realm.setPrototype;
  const constructor = createConstructorObject<ScriptPropertyKey, unknown>(
    realm.functionPrototype,
    (receiver, args): unknown => {
      throw createRuntimeError(realm, "type");
    },
    (args, target): unknown => {
      const set = createObject<ScriptPropertyKey, unknown>(
        constructorPrototype(target, "set", realm, hooks),
      );
      ensureExoticSlots(set).internalSetData = createSetData();
      const iterable = args[0];
      if (iterable === undefined || iterable === null) return set;
      const adder = getProperty<ScriptPropertyKey, unknown>(
        set,
        "add",
        set,
        hooks,
      );
      if (
        !isCallableObject<ScriptPropertyKey, unknown>(
          viewObjectValue(adder, realm.objectPrototype),
        )
      )
        throw createRuntimeError(realm, "type");
      const iterator = getScriptIterator(iterable, realm, hooks);
      while (true) {
        const step = stepScriptIterator(iterator);
        if (step.done) return set;
        try {
          const called = callObjectValue(
            adder,
            set,
            [step.value],
            realm.objectPrototype,
          );
          if (called.error !== "none") throw createRuntimeError(realm, "type");
        } catch (error) {
          closeScriptIterator(iterator, true);
          throw error;
        }
      }
    },
  );
  builtinFunctionMetadata(constructor, "Set", 0, hooks);
  builtinProperty(constructor, "prototype", prototype, false, false, hooks);
  builtinProperty(prototype, "constructor", constructor, true, true, hooks);
  builtinProperty(global, "Set", constructor, true, true, hooks);
  builtinAccessor(
    constructor,
    wellKnownSymbol(realm.symbolRegistry, "species"),
    builtinFunction(
      realm.functionPrototype,
      "get [Symbol.species]",
      0,
      (receiver, args): unknown => receiver,
      hooks,
    ),
    undefined,
    hooks,
  );
  builtinProperty(
    prototype,
    wellKnownSymbol(realm.symbolRegistry, "toStringTag"),
    "Set",
    false,
    true,
    hooks,
  );
  builtinAccessor(
    prototype,
    "size",
    builtinFunction(
      realm.functionPrototype,
      "get size",
      0,
      (receiver, args): unknown => requireSet(receiver, realm).size,
      hooks,
    ),
    undefined,
    hooks,
  );
  for (const name of ["has", "add", "delete", "clear"]) {
    if (name === undefined) throw "SET_METHOD_NAME_INVARIANT";
    const method = builtinFunction(
      realm.functionPrototype,
      name,
      name === "clear" ? 0 : 1,
      (receiver, args): unknown => {
        const set = requireSet(receiver, realm);
        const value = args[0] === 0 ? 0 : args[0];
        if (name === "has") return hasMap<unknown, unknown>(set, value);
        if (name === "delete") return deleteMap<unknown, unknown>(set, value);
        if (name === "clear") {
          clearMap<unknown, unknown>(set);
          return undefined;
        }
        setMap<unknown, unknown>(set, value, value);
        return receiver;
      },
      hooks,
    );
    builtinProperty(prototype, name, method, true, true, hooks);
    // Generated calls perform these inline on a Set receiver's storage.
    if (name === "has") realm.intrinsicFunctions.setHas = method;
    else if (name === "add") realm.intrinsicFunctions.setAdd = method;
  }
  installSetAlgebra(realm, hooks);
  builtinProperty(
    prototype,
    "forEach",
    builtinFunction(
      realm.functionPrototype,
      "forEach",
      1,
      (receiver, args): unknown => {
        const set = requireSet(receiver, realm);
        const callback = args[0];
        if (
          !isCallableObject<ScriptPropertyKey, unknown>(
            viewObjectValue(callback, realm.objectPrototype),
          )
        )
          throw createRuntimeError(realm, "type");
        const cursor = createMapCursor<unknown, unknown>(set);
        while (advanceMapCursor<unknown, unknown>(cursor)) {
          const value = readMapCursorKey<unknown, unknown>(cursor);
          const called = callObjectValue(
            callback,
            args[1],
            [value, value, receiver],
            realm.objectPrototype,
          );
          if (called.error !== "none") throw createRuntimeError(realm, "type");
        }
        return undefined;
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(
    realm.setIteratorPrototype,
    wellKnownSymbol(realm.symbolRegistry, "toStringTag"),
    "Set Iterator",
    false,
    true,
    hooks,
  );
  builtinProperty(
    realm.setIteratorPrototype,
    "next",
    builtinFunction(
      realm.functionPrototype,
      "next",
      0,
      (receiver, args): unknown => {
        const object = viewObjectValue(receiver, realm.objectPrototype);
        const data =
          object === undefined
            ? undefined
            : exoticSlots(object).internalSetIteratorData;
        if (data === undefined) throw createRuntimeError(realm, "type");
        if (!advanceMapCursor<unknown, unknown>(data.cursor))
          return createIteratorResult(undefined, true, realm, hooks);
        const value = readMapCursorKey<unknown, unknown>(data.cursor);
        const result = data.entries
          ? createArrayFromList(
              [value, value],
              0,
              realm.arrayPrototype,
              realm,
              hooks,
            )
          : value;
        return createIteratorResult(result, false, realm, hooks);
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  for (const name of ["values", "entries"]) {
    if (name === undefined) throw "SET_ITERATOR_NAME_INVARIANT";
    const method = builtinFunction(
      realm.functionPrototype,
      name,
      0,
      (receiver, args): unknown => {
        const set = requireSet(receiver, realm);
        const iterator = createObject<ScriptPropertyKey, unknown>(
          realm.setIteratorPrototype,
        );
        ensureExoticSlots(iterator).internalSetIteratorData = {
          cursor: createMapCursor<unknown, unknown>(set),
          entries: name === "entries",
        };
        return iterator;
      },
      hooks,
    );
    builtinProperty(prototype, name, method, true, true, hooks);
    if (name === "values") {
      builtinProperty(prototype, "keys", method, true, true, hooks);
      builtinProperty(
        prototype,
        wellKnownSymbol(realm.symbolRegistry, "iterator"),
        method,
        true,
        true,
        hooks,
      );
    }
  }
}
