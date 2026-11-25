import { forEachGroupItem } from "./grouping.ts";
import {
  createMapWithKeys,
  getMap,
  hasMap,
  setMap,
  deleteMap,
  clearMap,
  createMapCursor,
  advanceMapCursor,
  readMapCursorKey,
  readMapCursorValue,
  type LinkedMap,
} from "@tint/foundation/collections/linked-map";
import { collectionKeyHash, collectionKeyEqual } from "./collection-keys.ts";
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
import { addEntriesFromIterable } from "./entry-iteration.ts";
import { createArrayFromList } from "./array-like.ts";
import { createIteratorResult } from "./iterator-intrinsics.ts";
import { wellKnownSymbol, type ScriptPropertyKey } from "./symbols.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";

function requireMap(
  receiver: unknown,
  realm: ErrorRealm,
): LinkedMap<unknown, unknown> {
  const object = viewObjectValue(receiver, realm.objectPrototype);
  const data =
    object === undefined ? undefined : exoticSlots(object).internalMapData;
  if (data === undefined) throw createRuntimeError(realm, "type");
  return data;
}

/** Live Maps preserve Script value equality while sharing ordered native storage. */
export function installMapIntrinsics(
  global: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  const prototype = realm.mapPrototype;
  const constructor = createConstructorObject<ScriptPropertyKey, unknown>(
    realm.functionPrototype,
    (receiver, args): unknown => {
      throw createRuntimeError(realm, "type");
    },
    (args, target): unknown => {
      const map = createObject<ScriptPropertyKey, unknown>(
        constructorPrototype(target, "map", realm, hooks),
      );
      ensureExoticSlots(map).internalMapData = createMapWithKeys<
        unknown,
        unknown
      >({
        hash: collectionKeyHash,
        equals: collectionKeyEqual,
      });
      const iterable = args[0];
      if (iterable === undefined || iterable === null) return map;
      const adder = getProperty<ScriptPropertyKey, unknown>(
        map,
        "set",
        map,
        hooks,
      );
      if (
        !isCallableObject<ScriptPropertyKey, unknown>(
          viewObjectValue(adder, realm.objectPrototype),
        )
      )
        throw createRuntimeError(realm, "type");
      addEntriesFromIterable(
        iterable,
        (key, value): void => {
          const result = callObjectValue(
            adder,
            map,
            [key, value],
            realm.objectPrototype,
          );
          if (result.error !== "none") throw createRuntimeError(realm, "type");
        },
        realm,
        hooks,
      );
      return map;
    },
  );
  builtinFunctionMetadata(constructor, "Map", 0, hooks);
  builtinProperty(constructor, "prototype", prototype, false, false, hooks);
  builtinProperty(prototype, "constructor", constructor, true, true, hooks);
  builtinProperty(global, "Map", constructor, true, true, hooks);
  builtinProperty(
    constructor,
    "groupBy",
    builtinFunction(
      realm.functionPrototype,
      "groupBy",
      2,
      (receiver, args): unknown => {
        const groups: { readonly key: unknown; readonly values: unknown[] }[] =
          [];
        const byKey = createMapWithKeys<
          unknown,
          { readonly key: unknown; readonly values: unknown[] }
        >({ hash: collectionKeyHash, equals: collectionKeyEqual });
        forEachGroupItem(
          args[0],
          args[1],
          (inputKey, value): void => {
            const key = inputKey === 0 ? 0 : inputKey;
            let group = getMap<
              unknown,
              { readonly key: unknown; readonly values: unknown[] }
            >(byKey, key);
            if (group === undefined) {
              group = { key, values: [] };
              setMap<
                unknown,
                { readonly key: unknown; readonly values: unknown[] }
              >(byKey, key, group);
              groups.push(group);
            }
            group.values.push(value);
          },
          realm,
          hooks,
        );
        const result = createObject<ScriptPropertyKey, unknown>(prototype);
        const data = createMapWithKeys<unknown, unknown>({
          hash: collectionKeyHash,
          equals: collectionKeyEqual,
        });
        ensureExoticSlots(result).internalMapData = data;
        for (const group of groups) {
          if (group === undefined) throw "MAP_GROUP_INVARIANT";
          setMap<unknown, unknown>(
            data,
            group.key,
            createArrayFromList(
              group.values,
              0,
              realm.arrayPrototype,
              realm,
              hooks,
            ),
          );
        }
        return result;
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  for (const name of ["getOrInsert", "getOrInsertComputed"]) {
    if (name === undefined) throw "MAP_INSERT_NAME_INVARIANT";
    builtinProperty(
      prototype,
      name,
      builtinFunction(
        realm.functionPrototype,
        name,
        2,
        (receiver, args): unknown => {
          const map = requireMap(receiver, realm);
          const computed = name === "getOrInsertComputed";
          if (
            computed &&
            !isCallableObject<ScriptPropertyKey, unknown>(
              viewObjectValue(args[1], realm.objectPrototype),
            )
          )
            throw createRuntimeError(realm, "type");
          const key = args[0] === 0 ? 0 : args[0];
          if (hasMap<unknown, unknown>(map, key))
            return getMap<unknown, unknown>(map, key);
          let value = args[1];
          if (computed) {
            const called = callObjectValue(
              args[1],
              undefined,
              [key],
              realm.objectPrototype,
            );
            if (called.error !== "none")
              throw createRuntimeError(realm, "type");
            value = called.value;
          }
          // Lookup again after the callback: it may have inserted this key itself.
          setMap<unknown, unknown>(map, key, value);
          return value;
        },
        hooks,
      ),
      true,
      true,
      hooks,
    );
  }
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
    "Map",
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
      (receiver, args): unknown => requireMap(receiver, realm).size,
      hooks,
    ),
    undefined,
    hooks,
  );
  for (const name of ["get", "has", "set", "delete", "clear"]) {
    if (name === undefined) throw "MAP_METHOD_NAME_INVARIANT";
    const method = builtinFunction(
      realm.functionPrototype,
      name,
      name === "set" ? 2 : name === "clear" ? 0 : 1,
      (receiver, args): unknown => {
        const map = requireMap(receiver, realm);
        const key = args[0] === 0 ? 0 : args[0];
        if (name === "get") return getMap<unknown, unknown>(map, key);
        if (name === "has") return hasMap<unknown, unknown>(map, key);
        if (name === "delete") return deleteMap<unknown, unknown>(map, key);
        if (name === "clear") {
          clearMap<unknown, unknown>(map);
          return undefined;
        }
        setMap<unknown, unknown>(map, key, args[1]);
        return receiver;
      },
      hooks,
    );
    builtinProperty(prototype, name, method, true, true, hooks);
    // Generated calls perform these inline on a Map receiver's storage.
    const intrinsics = realm.intrinsicFunctions;
    if (name === "get") intrinsics.mapGet = method;
    else if (name === "has") intrinsics.mapHas = method;
    else if (name === "set") intrinsics.mapSet = method;
  }
  builtinProperty(
    prototype,
    "forEach",
    builtinFunction(
      realm.functionPrototype,
      "forEach",
      1,
      (receiver, args): unknown => {
        const map = requireMap(receiver, realm);
        const callback = args[0];
        if (
          !isCallableObject<ScriptPropertyKey, unknown>(
            viewObjectValue(callback, realm.objectPrototype),
          )
        )
          throw createRuntimeError(realm, "type");
        const cursor = createMapCursor<unknown, unknown>(map);
        while (advanceMapCursor<unknown, unknown>(cursor)) {
          const called = callObjectValue(
            callback,
            args[1],
            [
              readMapCursorValue<unknown, unknown>(cursor),
              readMapCursorKey<unknown, unknown>(cursor),
              receiver,
            ],
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
    realm.mapIteratorPrototype,
    wellKnownSymbol(realm.symbolRegistry, "toStringTag"),
    "Map Iterator",
    false,
    true,
    hooks,
  );
  builtinProperty(
    realm.mapIteratorPrototype,
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
            : exoticSlots(object).internalMapIteratorData;
        if (data === undefined) throw createRuntimeError(realm, "type");
        if (!advanceMapCursor<unknown, unknown>(data.cursor))
          return createIteratorResult(undefined, true, realm, hooks);
        const key = readMapCursorKey<unknown, unknown>(data.cursor),
          value = readMapCursorValue<unknown, unknown>(data.cursor);
        const result =
          data.kind === "key"
            ? key
            : data.kind === "value"
              ? value
              : createArrayFromList(
                  [key, value],
                  0,
                  realm.arrayPrototype,
                  realm,
                  hooks,
                );
        return createIteratorResult(result, false, realm, hooks);
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  for (const name of ["keys", "values", "entries"]) {
    if (name === undefined) throw "MAP_ITERATOR_NAME_INVARIANT";
    const method = builtinFunction(
      realm.functionPrototype,
      name,
      0,
      (receiver, args): unknown => {
        const map = requireMap(receiver, realm);
        const iterator = createObject<ScriptPropertyKey, unknown>(
          realm.mapIteratorPrototype,
        );
        ensureExoticSlots(iterator).internalMapIteratorData = {
          cursor: createMapCursor<unknown, unknown>(map),
          kind: name === "keys" ? "key" : name === "values" ? "value" : "entry",
        };
        return iterator;
      },
      hooks,
    );
    builtinProperty(prototype, name, method, true, true, hooks);
    if (name === "entries")
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
