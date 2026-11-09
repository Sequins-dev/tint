import {
  createConstructorObject,
  createObject,
  getProperty,
  type OrdinaryObject,
  type ObjectHooks,
} from "./operations.ts";
import {
  builtinFunction,
  builtinProperty,
  builtinFunctionMetadata,
} from "./intrinsics.ts";
import { viewObjectValue, callObjectValue } from "./values.ts";
import { isCallableObject } from "./call.ts";
import { constructorPrototype } from "./functions.ts";
import { addEntriesFromIterable } from "./entry-iteration.ts";
import {
  getScriptIterator,
  stepScriptIterator,
  closeScriptIterator,
} from "./iteration.ts";
import { wellKnownSymbol, type ScriptPropertyKey } from "./symbols.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";
import {
  canBeHeldWeakly,
  findWeakCell,
  addWeakCell,
  deleteWeakCell,
  createWeakCollectionData,
  type WeakCollectionData,
} from "./weak-storage.ts";
function requireCollection(
  receiver: unknown,
  kind: "map" | "set",
  realm: ErrorRealm,
): WeakCollectionData {
  const object = viewObjectValue(receiver, realm.objectPrototype),
    data = object === undefined ? undefined : object.internalWeakData;
  if (
    data === undefined ||
    (data.kind !== "map" && data.kind !== "set") ||
    data.kind !== kind
  )
    throw createRuntimeError(realm, "type");
  return data;
}
function put(
  data: WeakCollectionData,
  key: unknown,
  value: unknown,
  realm: ErrorRealm,
): void {
  const existing = findWeakCell(data, key, realm);
  if (existing !== undefined) {
    if (data.kind === "map") data.storage.setValue(existing, value);
    return;
  }
  addWeakCell(
    data,
    key,
    data.storage.create(key, value, data.kind === "map"),
    realm,
  );
}
/** A shared installer keeps the two constructor/iterator protocols aligned;
 * the distinct brands and per-instance storage capability remain explicit. */
export function installWeakCollectionIntrinsics(
  global: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  const kinds: ("map" | "set")[] = ["map", "set"];
  for (const kind of kinds) {
    if (kind === undefined) throw "WEAK_KIND_INVARIANT";
    const map = kind === "map",
      name = map ? "WeakMap" : "WeakSet",
      prototype = map ? realm.weakMapPrototype : realm.weakSetPrototype;
    const constructor = createConstructorObject<ScriptPropertyKey, unknown>(
      realm.functionPrototype,
      (receiver, args): unknown => {
        throw createRuntimeError(realm, "type");
      },
      (args, target): unknown => {
        const object = createObject<ScriptPropertyKey, unknown>(
          constructorPrototype(
            target,
            map ? "weak-map" : "weak-set",
            realm,
            hooks,
          ),
        );
        const storage = realm.agent.weakStorage;
        if (storage === undefined) return rejectUnsupportedExecution(realm);
        object.internalWeakData = createWeakCollectionData(kind, storage);
        const iterable = args[0];
        if (iterable === undefined || iterable === null) return object;
        const adder = getProperty<ScriptPropertyKey, unknown>(
          object,
          map ? "set" : "add",
          object,
          hooks,
        );
        if (
          !isCallableObject<ScriptPropertyKey, unknown>(
            viewObjectValue(adder, realm.objectPrototype),
          )
        )
          throw createRuntimeError(realm, "type");
        if (map) {
          addEntriesFromIterable(
            iterable,
            (key, value): void => {
              const called = callObjectValue(
                adder,
                object,
                [key, value],
                realm.objectPrototype,
              );
              if (called.error !== "none")
                throw createRuntimeError(realm, "type");
            },
            realm,
            hooks,
          );
          return object;
        }
        const iterator = getScriptIterator(iterable, realm, hooks);
        while (true) {
          const step = stepScriptIterator(iterator);
          if (step.done) return object;
          try {
            const called = callObjectValue(
              adder,
              object,
              [step.value],
              realm.objectPrototype,
            );
            if (called.error !== "none")
              throw createRuntimeError(realm, "type");
          } catch (error) {
            try {
              closeScriptIterator(iterator, true);
            } catch {}
            throw error;
          }
        }
      },
    );
    builtinFunctionMetadata(constructor, name, 0, hooks);
    builtinProperty(constructor, "prototype", prototype, false, false, hooks);
    builtinProperty(prototype, "constructor", constructor, true, true, hooks);
    builtinProperty(
      prototype,
      wellKnownSymbol(realm.symbolRegistry, "toStringTag"),
      name,
      false,
      true,
      hooks,
    );
    builtinProperty(global, name, constructor, true, true, hooks);
    const methods = map
      ? ["get", "has", "delete", "set", "getOrInsert", "getOrInsertComputed"]
      : ["has", "delete", "add"];
    for (const method of methods) {
      if (method === undefined) throw "WEAK_METHOD_INVARIANT";
      builtinProperty(
        prototype,
        method,
        builtinFunction(
          realm.functionPrototype,
          method,
          method === "set" ||
            method === "getOrInsert" ||
            method === "getOrInsertComputed"
            ? 2
            : 1,
          (receiver, args): unknown => {
            const data = requireCollection(receiver, kind, realm),
              key = args[0];
            const mutating =
              method === "set" ||
              method === "add" ||
              method === "getOrInsert" ||
              method === "getOrInsertComputed";
            if (!canBeHeldWeakly(key, realm)) {
              if (mutating) throw createRuntimeError(realm, "type");
              return method === "get" ? undefined : false;
            }
            const computed = method === "getOrInsertComputed";
            if (
              computed &&
              !isCallableObject<ScriptPropertyKey, unknown>(
                viewObjectValue(args[1], realm.objectPrototype),
              )
            )
              throw createRuntimeError(realm, "type");
            const cell = findWeakCell(data, key, realm);
            if (method === "get")
              return cell === undefined ? undefined : data.storage.value(cell);
            if (method === "has") return cell !== undefined;
            if (method === "delete") {
              if (cell === undefined) return false;
              deleteWeakCell(data, key, cell, realm);
              return true;
            }
            if (method === "set" || method === "add") {
              put(data, key, map ? args[1] : undefined, realm);
              return receiver;
            }
            if (cell !== undefined) return data.storage.value(cell);
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
            // Callback reentrancy can insert/delete cells; find the key again.
            put(data, key, value, realm);
            return value;
          },
          hooks,
        ),
        true,
        true,
        hooks,
      );
    }
  }
}
