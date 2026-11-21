import { speciesConstructor } from "./species.ts";
import { constructObject } from "./call.ts";
import {
  copyByteStorage,
  copyImmutableByteStorage,
  createByteStorage,
  adoptByteStorage,
  byteStorageData,
  resizeByteStorage,
  transferByteStorage,
  detachByteStorage,
  type ByteStorage,
  type StorageError,
  type StorageTransferMode,
} from "../bytes/index.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
import { integerOrInfinity } from "./coercion.ts";
import { viewObjectValue } from "./values.ts";
import { constructorPrototype } from "./functions.ts";
import {
  builtinAccessor,
  builtinFunctionMetadata,
  builtinFunction,
  builtinProperty,
} from "./intrinsics.ts";
import { wellKnownSymbol, type ScriptPropertyKey } from "./symbols.ts";
import {
  createObject,
  createConstructorObject,
  getProperty,
  type OrdinaryObject,
  type ObjectHooks,
  type ObjectCall,
} from "./operations.ts";

/** ToIndex, after observable numeric conversion and truncation. */
export function bufferIndex(
  value: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): number {
  const index = integerOrInfinity(value, hooks, realm);
  if (index < 0 || index > 9007199254740991)
    throw createRuntimeError(realm, "range");
  return index === 0 ? 0 : index;
}
export function requireArrayBuffer(
  value: unknown,
  realm: ErrorRealm,
): ByteStorage {
  const object = viewObjectValue(value, realm.objectPrototype);
  const storage =
    object === undefined ? undefined : object.internalArrayBufferData;
  if (storage === undefined) throw createRuntimeError(realm, "type");
  return storage;
}
function storageFailure(error: StorageError, realm: ErrorRealm): never {
  throw createRuntimeError(
    realm,
    error === "detached" || error === "fixed-length" || error === "immutable"
      ? "type"
      : "range",
  );
}
export function detachArrayBuffer(value: unknown, realm: ErrorRealm): void {
  const result = detachByteStorage(requireArrayBuffer(value, realm));
  if (result !== "none") storageFailure(result, realm);
}
/** Wrap an existing byte extent with the realm's intrinsic ArrayBuffer brand. */
export function adoptArrayBuffer(
  bytes: Uint8Array,
  realm: ErrorRealm,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  const object = createObject<ScriptPropertyKey, unknown>(
    realm.arrayBufferPrototype,
  );
  const storage = adoptByteStorage(
    bytes,
    bytes.length,
    false,
    realm.bufferMaxBytes,
    realm.bufferAllocator,
  );
  if (!storage.ok) return storageFailure(storage.error, realm);
  object.internalArrayBufferData = storage.value;
  return object;
}
export function installArrayBufferIntrinsics(
  global: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  const prototype = realm.arrayBufferPrototype;
  function wrap(
    storage: ByteStorage,
    parent: OrdinaryObject<ScriptPropertyKey, unknown>,
  ): OrdinaryObject<ScriptPropertyKey, unknown> {
    const object = createObject<ScriptPropertyKey, unknown>(parent);
    object.internalArrayBufferData = storage;
    return object;
  }
  const constructor = createConstructorObject<ScriptPropertyKey, unknown>(
    realm.functionPrototype,
    (receiver, args): unknown => {
      throw createRuntimeError(realm, "type");
    },
    (args, target): unknown => {
      const length = bufferIndex(args[0], realm, hooks);
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
      const resizable = requested !== undefined;
      const maximum = resizable ? bufferIndex(requested, realm, hooks) : length;
      if (length > maximum) throw createRuntimeError(realm, "range");
      const parent = constructorPrototype(target, "array-buffer", realm, hooks);
      if (maximum > realm.bufferMaxBytes)
        throw createRuntimeError(realm, "range");
      const storage = createByteStorage(
        length,
        maximum,
        resizable,
        realm.bufferMaxBytes,
        realm.bufferAllocator,
      );
      if (!storage.ok) return storageFailure(storage.error, realm);
      return wrap(storage.value, parent);
    },
  );
  builtinFunctionMetadata(constructor, "ArrayBuffer", 1, hooks);
  builtinProperty(constructor, "prototype", prototype, false, false, hooks);
  builtinProperty(prototype, "constructor", constructor, true, true, hooks);
  builtinProperty(
    prototype,
    wellKnownSymbol(realm.symbolRegistry, "toStringTag"),
    "ArrayBuffer",
    false,
    true,
    hooks,
  );
  builtinProperty(global, "ArrayBuffer", constructor, true, true, hooks);
  function getter(
    object: OrdinaryObject<ScriptPropertyKey, unknown>,
    key: ScriptPropertyKey,
    name: string,
    call: ObjectCall<unknown>,
  ): void {
    const fn = builtinFunction(
      realm.functionPrototype,
      "get " + name,
      0,
      call,
      hooks,
    );
    builtinAccessor(object, key, fn, undefined, hooks);
  }
  getter(
    constructor,
    wellKnownSymbol(realm.symbolRegistry, "species"),
    "[Symbol.species]",
    (receiver, args): unknown => receiver,
  );
  getter(prototype, "byteLength", "byteLength", (receiver, args): unknown => {
    const data = byteStorageData(requireArrayBuffer(receiver, realm));
    return data === undefined ? 0 : data.length;
  });
  getter(
    prototype,
    "maxByteLength",
    "maxByteLength",
    (receiver, args): unknown => {
      const storage = requireArrayBuffer(receiver, realm);
      return byteStorageData(storage) === undefined ? 0 : storage.maxByteLength;
    },
  );
  getter(
    prototype,
    "resizable",
    "resizable",
    (receiver, args): unknown => requireArrayBuffer(receiver, realm).resizable,
  );
  getter(
    prototype,
    "immutable",
    "immutable",
    (receiver, args): unknown => requireArrayBuffer(receiver, realm).immutable,
  );
  getter(
    prototype,
    "detached",
    "detached",
    (receiver, args): unknown =>
      byteStorageData(requireArrayBuffer(receiver, realm)) === undefined,
  );
  builtinProperty(
    constructor,
    "isView",
    builtinFunction(
      realm.functionPrototype,
      "isView",
      1,
      (receiver, args): unknown => {
        const object = viewObjectValue(args[0], realm.objectPrototype);
        return object !== undefined && object.internalArrayBufferView;
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(
    prototype,
    "resize",
    builtinFunction(
      realm.functionPrototype,
      "resize",
      1,
      (receiver, args): unknown => {
        const storage = requireArrayBuffer(receiver, realm);
        if (!storage.resizable) throw createRuntimeError(realm, "type");
        const length = bufferIndex(args[0], realm, hooks);
        const result = resizeByteStorage(storage, length);
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
        const storage = requireArrayBuffer(receiver, realm);
        const original = viewObjectValue(receiver, realm.objectPrototype);
        if (original === undefined) throw "BUFFER_RECEIVER_INVARIANT";
        const before = byteStorageData(storage);
        if (before === undefined) throw createRuntimeError(realm, "type");
        const length = before.length;
        const first = relativeIndex(args[0], length);
        const end =
          args[1] === undefined ? length : relativeIndex(args[1], length);
        const count = Math.max(end - first, 0);
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
        const target = requireArrayBuffer(result.value, realm);
        const targetData = byteStorageData(target, "write");
        if (
          targetData === undefined ||
          targetData.length < count ||
          result.value === receiver
        )
          throw createRuntimeError(realm, "type");
        const current = byteStorageData(storage);
        if (current === undefined) throw createRuntimeError(realm, "type");
        const copyCount = Math.min(count, Math.max(current.length - first, 0));
        if (copyCount > 0) {
          const copied = copyByteStorage(storage, target, first, 0, copyCount);
          if (copied !== "none") return storageFailure(copied, realm);
        }
        return result.value;
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(
    prototype,
    "sliceToImmutable",
    builtinFunction(
      realm.functionPrototype,
      "sliceToImmutable",
      2,
      (receiver, args): unknown => {
        const storage = requireArrayBuffer(receiver, realm);
        const before = byteStorageData(storage);
        if (before === undefined) throw createRuntimeError(realm, "type");
        const length = before.length;
        const first = relativeIndex(args[0], length);
        const final =
          args[1] === undefined ? length : relativeIndex(args[1], length);
        const current = byteStorageData(storage);
        if (current === undefined) throw createRuntimeError(realm, "type");
        if (current.length < final) throw createRuntimeError(realm, "range");
        const count = Math.max(final - first, 0);
        const copied = copyImmutableByteStorage(storage, first, count, count);
        if (!copied.ok) return storageFailure(copied.error, realm);
        return wrap(copied.value, prototype);
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  function transfer(name: string, mode: StorageTransferMode): void {
    builtinProperty(
      prototype,
      name,
      builtinFunction(
        realm.functionPrototype,
        name,
        0,
        (receiver, args): unknown => {
          const storage = requireArrayBuffer(receiver, realm);
          const data = byteStorageData(storage);
          const length =
            args[0] === undefined
              ? data === undefined
                ? 0
                : data.length
              : bufferIndex(args[0], realm, hooks);
          const moved = transferByteStorage(storage, length, mode);
          if (!moved.ok) return storageFailure(moved.error, realm);
          return wrap(moved.value, prototype);
        },
        hooks,
      ),
      true,
      true,
      hooks,
    );
  }
  transfer("transfer", "preserve-resizability");
  transfer("transferToFixedLength", "fixed-length");
  transfer("transferToImmutable", "immutable");
}
