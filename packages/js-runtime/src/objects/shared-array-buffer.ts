import {
  createSharedStorage,
  growSharedStorage,
  readSharedByte,
  sameSharedBlock,
  sharedStorageLength,
  writeSharedUnsigned,
  type SharedBlockService,
  type SharedBlockStorage,
  type SharedError,
} from "../bytes/shared.ts";
import { bufferIndex } from "./array-buffer.ts";
import { integerOrInfinity } from "./coercion.ts";
import { constructObject } from "./call.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
import { constructorPrototype } from "./functions.ts";
import {
  builtinAccessor,
  builtinFunction,
  builtinFunctionMetadata,
  builtinProperty,
} from "./intrinsics.ts";
import {
  ensureExoticSlots,
  exoticSlots,
  createConstructorObject,
  createObject,
  getProperty,
  type ObjectCall,
  type ObjectHooks,
  type OrdinaryObject,
} from "./operations.ts";
import { speciesConstructor } from "./species.ts";
import { wellKnownSymbol, type ScriptPropertyKey } from "./symbols.ts";
import { viewObjectValue } from "./values.ts";

export function requireSharedArrayBuffer(
  value: unknown,
  realm: ErrorRealm,
): SharedBlockStorage {
  const object = viewObjectValue(value, realm.objectPrototype);
  const storage =
    object === undefined
      ? undefined
      : exoticSlots(object).internalSharedArrayBufferData;
  if (storage === undefined) throw createRuntimeError(realm, "type");
  return storage;
}
function storageFailure(error: SharedError, realm: ErrorRealm): never {
  throw createRuntimeError(
    realm,
    error === "fixed-length" || error === "invalid-handle" ? "type" : "range",
  );
}
function byteLength(storage: SharedBlockStorage, realm: ErrorRealm): number {
  const result = sharedStorageLength(storage, "seq-cst");
  return result.ok ? result.value : storageFailure(result.error, realm);
}

/** Explicit embedding opt-in. The service owns genuine shared backing; this
 * installer neither grants host memory access nor emulates sharing with arrays. */
export function installSharedArrayBufferIntrinsics(
  global: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  service: SharedBlockService,
): void {
  const prototype = realm.sharedArrayBufferPrototype;
  const constructor = createConstructorObject<ScriptPropertyKey, unknown>(
    realm.functionPrototype,
    (receiver, args): unknown => {
      throw createRuntimeError(realm, "type");
    },
    (args, target): unknown => {
      const initial = bufferIndex(args[0], realm, hooks);
      const options = viewObjectValue(args[1], realm.objectPrototype);
      const requested =
        options === undefined
          ? undefined
          : getProperty<ScriptPropertyKey, unknown>(
              options,
              "maxByteLength",
              options,
              hooks,
            );
      const growable = requested !== undefined;
      const maximum = growable ? bufferIndex(requested, realm, hooks) : initial;
      if (initial > maximum) throw createRuntimeError(realm, "range");
      const parent = constructorPrototype(
        target,
        "shared-array-buffer",
        realm,
        hooks,
      );
      if (maximum > realm.bufferMaxBytes)
        throw createRuntimeError(realm, "range");
      const created = createSharedStorage(service, initial, maximum, growable);
      if (!created.ok) return storageFailure(created.error, realm);
      const object = createObject<ScriptPropertyKey, unknown>(parent);
      ensureExoticSlots(object).internalSharedArrayBufferData = created.value;
      return object;
    },
  );
  builtinFunctionMetadata(constructor, "SharedArrayBuffer", 1, hooks);
  builtinProperty(constructor, "prototype", prototype, false, false, hooks);
  builtinProperty(prototype, "constructor", constructor, true, true, hooks);
  builtinProperty(
    prototype,
    wellKnownSymbol(realm.symbolRegistry, "toStringTag"),
    "SharedArrayBuffer",
    false,
    true,
    hooks,
  );
  function getter(
    object: OrdinaryObject<ScriptPropertyKey, unknown>,
    key: ScriptPropertyKey,
    name: string,
    call: ObjectCall<unknown>,
  ): void {
    builtinAccessor(
      object,
      key,
      builtinFunction(realm.functionPrototype, "get " + name, 0, call, hooks),
      undefined,
      hooks,
    );
  }
  getter(
    constructor,
    wellKnownSymbol(realm.symbolRegistry, "species"),
    "[Symbol.species]",
    (receiver, args): unknown => receiver,
  );
  getter(prototype, "byteLength", "byteLength", (receiver, args): unknown =>
    byteLength(requireSharedArrayBuffer(receiver, realm), realm),
  );
  getter(
    prototype,
    "maxByteLength",
    "maxByteLength",
    (receiver, args): unknown =>
      requireSharedArrayBuffer(receiver, realm).maxByteLength,
  );
  getter(
    prototype,
    "growable",
    "growable",
    (receiver, args): unknown =>
      requireSharedArrayBuffer(receiver, realm).growable,
  );
  builtinProperty(
    prototype,
    "grow",
    builtinFunction(
      realm.functionPrototype,
      "grow",
      1,
      (receiver, args): unknown => {
        const storage = requireSharedArrayBuffer(receiver, realm);
        if (!storage.growable) throw createRuntimeError(realm, "type");
        const length = bufferIndex(args[0], realm, hooks);
        const result = growSharedStorage(storage, length);
        if (result !== "none") return storageFailure(result, realm);
        return undefined;
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  function relativeIndex(value: unknown, length: number): number {
    const index = integerOrInfinity(value, hooks, realm);
    return index < 0 ? Math.max(length + index, 0) : Math.min(index, length);
  }
  builtinProperty(
    prototype,
    "slice",
    builtinFunction(
      realm.functionPrototype,
      "slice",
      2,
      (receiver, args): unknown => {
        const storage = requireSharedArrayBuffer(receiver, realm);
        const original = viewObjectValue(receiver, realm.objectPrototype);
        if (original === undefined) throw "SHARED_BUFFER_RECEIVER_INVARIANT";
        const length = byteLength(storage, realm);
        const first = relativeIndex(args[0], length);
        const final =
          args[1] === undefined ? length : relativeIndex(args[1], length);
        const count = Math.max(final - first, 0);
        const selected = speciesConstructor(
          original,
          constructor,
          realm,
          hooks,
        );
        const result = constructObject<ScriptPropertyKey, unknown>(
          selected,
          [count],
          { object: selected, value: selected },
          undefined,
        );
        if (result.error !== "none") throw createRuntimeError(realm, "type");
        const target = requireSharedArrayBuffer(result.value, realm);
        // Species can return a different managed wrapper around the source block.
        if (
          sameSharedBlock(storage, target) ||
          byteLength(target, realm) < count
        )
          throw createRuntimeError(realm, "type");
        for (let index = 0; index < count; index++) {
          const read = readSharedByte(storage, first + index);
          if (!read.ok) return storageFailure(read.error, realm);
          const written = writeSharedUnsigned(
            target,
            index,
            1,
            read.value,
            "unordered",
          );
          if (written !== "none") return storageFailure(written, realm);
        }
        return result.value;
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(global, "SharedArrayBuffer", constructor, true, true, hooks);
}
