import {
  ensureExoticSlots,
  exoticSlots,
  createConstructorObject,
  createObject,
  type OrdinaryObject,
  type ObjectHooks,
} from "./operations.ts";
import {
  builtinFunction,
  builtinProperty,
  builtinFunctionMetadata,
} from "./intrinsics.ts";
import { viewObjectValue } from "./values.ts";
import { constructorPrototype } from "./functions.ts";
import { wellKnownSymbol, type ScriptPropertyKey } from "./symbols.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";
import { canBeHeldWeakly } from "./weak-storage.ts";
export function installWeakRefIntrinsics(
  global: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  const prototype = realm.weakRefPrototype;
  const constructor = createConstructorObject<ScriptPropertyKey, unknown>(
    realm.functionPrototype,
    (receiver, args): unknown => {
      throw createRuntimeError(realm, "type");
    },
    (args, target): unknown => {
      const key = args[0];
      if (!canBeHeldWeakly(key, realm)) throw createRuntimeError(realm, "type");
      const object = createObject<ScriptPropertyKey, unknown>(
        constructorPrototype(target, "weak-ref", realm, hooks),
      );
      const storage = realm.agent.weakStorage;
      if (storage === undefined) return rejectUnsupportedExecution(realm);
      // This strong agent root covers allocation of the cell itself as well as all
      // subsequent collections in the current synchronous execution sequence.
      realm.agent.keptAlive.push(key);
      ensureExoticSlots(object).internalWeakData = {
        kind: "ref",
        storage,
        cell: storage.create(key, undefined, false),
      };
      return object;
    },
  );
  builtinFunctionMetadata(constructor, "WeakRef", 1, hooks);
  builtinProperty(constructor, "prototype", prototype, false, false, hooks);
  builtinProperty(prototype, "constructor", constructor, true, true, hooks);
  builtinProperty(
    prototype,
    wellKnownSymbol(realm.symbolRegistry, "toStringTag"),
    "WeakRef",
    false,
    true,
    hooks,
  );
  builtinProperty(global, "WeakRef", constructor, true, true, hooks);
  builtinProperty(
    prototype,
    "deref",
    builtinFunction(
      realm.functionPrototype,
      "deref",
      0,
      (receiver, args): unknown => {
        const object = viewObjectValue(receiver, realm.objectPrototype),
          data =
            object === undefined
              ? undefined
              : exoticSlots(object).internalWeakData;
        if (data === undefined || data.kind !== "ref")
          throw createRuntimeError(realm, "type");
        const key = data.storage.key(data.cell);
        if (key !== undefined) realm.agent.keptAlive.push(key);
        return key;
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
}
