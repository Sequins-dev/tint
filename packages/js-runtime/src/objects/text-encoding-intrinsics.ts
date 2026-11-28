import {
  createNativeTextDecoder,
  encodeUTF8,
  encodeUTF8Into,
} from "@tint/foundation/text/text-encoding";
import { readSharedUnsigned, writeSharedUnsigned } from "../bytes/shared.ts";
import { adoptArrayBuffer } from "./array-buffer.ts";
import {
  projectArrayBufferViewRange,
  type ArrayBufferViewRange,
} from "./array-buffer-view.ts";
import {
  bufferStorageByteLength,
  type BufferStorage,
} from "./buffer-storage.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
import { stringValueOrThrow } from "./fused-results.ts";
import {
  builtinAccessor,
  builtinFunction,
  builtinFunctionMetadata,
  builtinProperty,
} from "./intrinsics.ts";
import {
  createConstructorObject,
  createDataProperty,
  createObject,
  ensureExoticSlots,
  exoticSlots,
  getProperty,
  type ObjectCall,
  type ObjectHooks,
  type OrdinaryObject,
} from "./operations.ts";
import { wellKnownSymbol, type ScriptPropertyKey } from "./symbols.ts";
import { createTypedArrayView } from "./typed-array-data.ts";
import { scriptBoolean, viewObjectValue } from "./values.ts";

type RealmObject = OrdinaryObject<ScriptPropertyKey, unknown>;

function copyBytes(
  storage: BufferStorage,
  offset: number,
  length: number,
): Uint8Array {
  if (storage.kind === "ordinary") {
    const bytes = storage.data;
    return bytes === undefined
      ? new Uint8Array(0)
      : bytes.subarray(offset, offset + length);
  }
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    const result = readSharedUnsigned(storage, offset + i, 1, "unordered");
    if (!result.ok) throw "TEXT_DECODE_SHARED_READ";
    bytes[i] = result.value;
  }
  return bytes;
}

export function installTextEncodingIntrinsics(
  global: RealmObject,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  function property(object: RealmObject, key: ScriptPropertyKey): unknown {
    return getProperty<ScriptPropertyKey, unknown>(object, key, object, hooks);
  }
  function objectOf(value: unknown): RealmObject {
    const object = viewObjectValue(value, global);
    if (object === undefined) throw createRuntimeError(realm, "type");
    return object;
  }
  function option(value: unknown, key: string): boolean {
    const object = viewObjectValue(value, global);
    return object !== undefined && scriptBoolean(property(object, key), global);
  }
  function inputBytes(value: unknown): Uint8Array {
    if (value === undefined) return new Uint8Array(0);
    const object = objectOf(value);
    const range = projectArrayBufferViewRange(object);
    if (range !== undefined)
      return copyBytes(range.storage, range.byteOffset, range.byteLength);
    const slots = exoticSlots(object);
    const storage =
      slots.internalArrayBufferData ?? slots.internalSharedArrayBufferData;
    if (storage === undefined) throw createRuntimeError(realm, "type");
    const length = bufferStorageByteLength(storage) ?? 0;
    return copyBytes(storage, 0, length);
  }
  function construct(
    name: string,
    prototype: RealmObject,
    init: (instance: RealmObject, args: readonly unknown[]) => void,
  ): void {
    const constructor = createConstructorObject<ScriptPropertyKey, unknown>(
      realm.functionPrototype,
      (_receiver, _args): unknown => {
        throw createRuntimeError(realm, "type");
      },
      (args, newTarget): unknown => {
        const target = objectOf(newTarget);
        const parent = viewObjectValue(property(target, "prototype"), global);
        const instance = createObject<ScriptPropertyKey, unknown>(
          parent ?? prototype,
        );
        init(instance, args);
        return instance;
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
  }
  function method(
    prototype: RealmObject,
    name: string,
    length: number,
    invoke: ObjectCall<unknown>,
  ): void {
    builtinProperty(
      prototype,
      name,
      builtinFunction(realm.functionPrototype, name, length, invoke, hooks),
      true,
      true,
      hooks,
    );
  }
  function getter(
    prototype: RealmObject,
    name: string,
    invoke: ObjectCall<unknown>,
  ): void {
    builtinAccessor(
      prototype,
      name,
      builtinFunction(realm.functionPrototype, "get " + name, 0, invoke, hooks),
      undefined,
      hooks,
    );
  }
  function encoder(receiver: unknown): void {
    if (!exoticSlots(objectOf(receiver)).internalTextEncoder)
      throw createRuntimeError(realm, "type");
  }
  function decoder(
    receiver: unknown,
  ): (operation: string, input: Uint8Array, stream: boolean) => unknown {
    const state = exoticSlots(objectOf(receiver)).internalTextDecoder;
    if (state === undefined) throw createRuntimeError(realm, "type");
    return state;
  }
  function destination(value: unknown): ArrayBufferViewRange {
    const object = objectOf(value);
    const data = exoticSlots(object).internalTypedArrayData;
    const range = projectArrayBufferViewRange(object);
    if (data?.kind !== "Uint8" || range === undefined || !range.writable)
      throw createRuntimeError(realm, "type");
    return range;
  }
  const encodePrototype = createObject<ScriptPropertyKey, unknown>(
    realm.objectPrototype,
  );
  getter(encodePrototype, "encoding", (receiver, _args): unknown => {
    encoder(receiver);
    return "utf-8";
  });
  method(encodePrototype, "encode", 0, (receiver, args): unknown => {
    encoder(receiver);
    const value = args[0];
    const bytes = encodeUTF8(
      value === undefined ? "" : stringValueOrThrow(value, hooks, realm),
    );
    const buffer = adoptArrayBuffer(bytes, realm);
    const storage = exoticSlots(buffer).internalArrayBufferData;
    const parent = realm.typedArrayPrototypes.get("Uint8");
    if (storage === undefined || parent === undefined)
      throw "TEXT_ENCODER_STORAGE";
    return createTypedArrayView(
      parent,
      {
        storage,
        buffer,
        byteOffset: 0,
        length: bytes.length,
        kind: "Uint8",
        endian: "little",
      },
      realm,
      hooks,
    );
  });
  method(encodePrototype, "encodeInto", 2, (receiver, args): unknown => {
    encoder(receiver);
    if (args.length < 2) throw createRuntimeError(realm, "type");
    const text = stringValueOrThrow(args[0], hooks, realm);
    const range = destination(args[1]);
    const target = range.bytes;
    const bytes =
      target === undefined
        ? new Uint8Array(Math.min(text.length * 3, range.byteLength))
        : target.subarray(
            range.byteOffset,
            range.byteOffset + range.byteLength,
          );
    const result = encodeUTF8Into(text, bytes);
    const storage = range.storage;
    if (storage.kind === "shared")
      for (let i = 0; i < result.written; i++)
        if (
          writeSharedUnsigned(
            storage,
            range.byteOffset + i,
            1,
            bytes[i] ?? 0,
            "unordered",
          ) !== "none"
        )
          throw "TEXT_ENCODE_SHARED_WRITE";
    const output = createObject<ScriptPropertyKey, unknown>(
      realm.objectPrototype,
    );
    createDataProperty<ScriptPropertyKey, unknown>(
      output,
      "read",
      result.read,
      hooks,
    );
    createDataProperty<ScriptPropertyKey, unknown>(
      output,
      "written",
      result.written,
      hooks,
    );
    return output;
  });
  construct("TextEncoder", encodePrototype, (object, _args): void => {
    ensureExoticSlots(object).internalTextEncoder = true;
  });
  const decodePrototype = createObject<ScriptPropertyKey, unknown>(
    realm.objectPrototype,
  );
  getter(decodePrototype, "encoding", (receiver, _args): unknown =>
    decoder(receiver)("encoding", new Uint8Array(0), false),
  );
  getter(decodePrototype, "fatal", (receiver, _args): unknown =>
    decoder(receiver)("fatal", new Uint8Array(0), false),
  );
  getter(decodePrototype, "ignoreBOM", (receiver, _args): unknown =>
    decoder(receiver)("ignoreBOM", new Uint8Array(0), false),
  );
  method(decodePrototype, "decode", 0, (receiver, args): unknown => {
    const state = decoder(receiver);
    const stream = option(args[1], "stream");
    const bytes = inputBytes(args[0]);
    try {
      return state("decode", bytes, stream);
    } catch {
      throw createRuntimeError(realm, "type");
    }
  });
  construct("TextDecoder", decodePrototype, (object, args): void => {
    const label = args[0];
    const name =
      label === undefined ? "utf-8" : stringValueOrThrow(label, hooks, realm);
    const fatal = option(args[1], "fatal");
    const ignoreBOM = option(args[1], "ignoreBOM");
    try {
      const state = createNativeTextDecoder(name, { fatal, ignoreBOM });
      ensureExoticSlots(object).internalTextDecoder = (
        operation,
        bytes,
        stream,
      ): unknown => {
        if (operation === "encoding") return state.encoding;
        if (operation === "fatal") return state.fatal;
        if (operation === "ignoreBOM") return state.ignoreBOM;
        return state.decode(bytes, { stream });
      };
    } catch {
      throw createRuntimeError(realm, "range");
    }
  });
}
