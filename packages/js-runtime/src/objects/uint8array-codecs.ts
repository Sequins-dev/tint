import { readSharedByte, writeSharedUnsigned } from "../bytes/shared.ts";
import type { BufferStorageWindow } from "./buffer-storage.ts";
import type { StorageAccess } from "../bytes/index.ts";
import { optionValue } from "./options.ts";
import { scriptBoolean } from "./values.ts";
import {
  decodeBase64Into,
  encodeBase64,
  type Base64Alphabet,
  type Base64LastChunkHandling,
  decodeHexInto,
  encodeHex,
  type BaseDecodeResult,
} from "@tint/foundation/text/base-encoding";
import type { Endian } from "@tint/foundation/binary/bytes";
import { allocateTypedArray } from "./typed-array-construction.ts";
import {
  requireTypedArray,
  typedArrayWindow,
  type TypedArrayData,
} from "./typed-array-data.ts";
import { builtinFunction, builtinProperty } from "./intrinsics.ts";
import {
  createObject,
  createDataProperty,
  type ObjectCall,
  type ObjectHooks,
  type OrdinaryObject,
} from "./operations.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
import type { ScriptPropertyKey } from "./symbols.ts";

/** Codecs are byte-oriented. Only ordinary storage lends a mutable byte window;
 * shared decoding commits the successfully decoded prefix even on syntax error. */
function codecWindow(
  data: TypedArrayData,
  window: BufferStorageWindow,
  read: boolean,
): { readonly bytes: Uint8Array; readonly offset: number } {
  const ordinaryBytes = window.bytes;
  if (ordinaryBytes !== undefined)
    return { bytes: ordinaryBytes, offset: data.byteOffset };
  const shared = window.shared;
  if (shared === undefined) throw "UINT8_CODEC_BACKING_INVARIANT";
  const bytes = new Uint8Array(window.length);
  if (read)
    for (let index = 0; index < window.length; index++) {
      const byte = readSharedByte(shared, data.byteOffset + index);
      if (!byte.ok) throw "UINT8_CODEC_READ_INVARIANT";
      bytes[index] = byte.value;
    }
  return { bytes, offset: 0 };
}
function commitCodec(
  data: TypedArrayData,
  window: BufferStorageWindow,
  bytes: Uint8Array,
  written: number,
): void {
  const shared = window.shared;
  if (shared === undefined) return;
  for (let index = 0; index < written; index++) {
    const byte = bytes[index];
    if (
      byte === undefined ||
      writeSharedUnsigned(
        shared,
        data.byteOffset + index,
        1,
        byte,
        "unordered",
      ) !== "none"
    )
      throw "UINT8_CODEC_WRITE_INVARIANT";
  }
}

/** Concrete Uint8Array methods: brand validation is separate from borrowing bytes
 * so option-bearing codecs can run getters before reacquiring their window. */
export function installUint8ArrayCodecs(
  constructor: OrdinaryObject<ScriptPropertyKey, unknown>,
  prototype: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  endian: Endian,
): void {
  function uint8(
    value: unknown,
    access: StorageAccess = "read",
  ): TypedArrayData {
    const data = requireTypedArray(value, realm, access);
    if (data.kind !== "Uint8") throw createRuntimeError(realm, "type");
    return data;
  }
  function method(
    owner: OrdinaryObject<ScriptPropertyKey, unknown>,
    name: string,
    length: number,
    implementation: ObjectCall<unknown>,
  ): void {
    builtinProperty(
      owner,
      name,
      builtinFunction(
        realm.functionPrototype,
        name,
        length,
        implementation,
        hooks,
      ),
      true,
      true,
      hooks,
    );
  }
  function counts(
    result: BaseDecodeResult,
  ): OrdinaryObject<ScriptPropertyKey, unknown> {
    const object = createObject<ScriptPropertyKey, unknown>(
      realm.objectPrototype,
    );
    createDataProperty<ScriptPropertyKey, unknown>(
      object,
      "read",
      result.read,
      hooks,
    );
    createDataProperty<ScriptPropertyKey, unknown>(
      object,
      "written",
      result.written,
      hooks,
    );
    return object;
  }
  function decodedArray(
    decoded: Uint8Array,
    length: number,
  ): OrdinaryObject<ScriptPropertyKey, unknown> {
    const target = allocateTypedArray(
      "Uint8",
      length,
      prototype,
      realm,
      hooks,
      endian,
    );
    const data = target.internalTypedArrayData;
    if (data === undefined) throw "UINT8_CODEC_TARGET_INVARIANT";
    const window = typedArrayWindow(data, "write");
    if (window === undefined) throw "UINT8_CODEC_TARGET_INVARIANT";
    const destination = codecWindow(data, window, false);
    for (let index = 0; index < length; index++) {
      const byte = decoded[index];
      if (byte === undefined) throw "UINT8_CODEC_TARGET_INVARIANT";
      destination.bytes[destination.offset + index] = byte;
    }
    commitCodec(data, window, destination.bytes, length);
    return target;
  }
  function alphabet(options: unknown): Base64Alphabet {
    const value = optionValue(options, "alphabet", realm, hooks);
    if (value === undefined) return "base64";
    if (value === "base64" || value === "base64url") return value;
    throw createRuntimeError(realm, "type");
  }
  function chunkHandling(options: unknown): Base64LastChunkHandling {
    const value = optionValue(options, "lastChunkHandling", realm, hooks);
    if (value === undefined) return "loose";
    if (
      value === "loose" ||
      value === "strict" ||
      value === "stop-before-partial"
    )
      return value;
    throw createRuntimeError(realm, "type");
  }
  method(constructor, "fromHex", 1, (receiver, args): unknown => {
    const source = args[0];
    if (typeof source !== "string") throw createRuntimeError(realm, "type");
    if (source.length % 2 !== 0) throw createRuntimeError(realm, "syntax");
    const decoded = new Uint8Array(source.length / 2);
    const result = decodeHexInto(source, decoded, 0, decoded.length);
    if (result.error === "syntax") throw createRuntimeError(realm, "syntax");
    if (result.error !== "none") throw "HEX_DECODE_WINDOW_INVARIANT";
    return decodedArray(decoded, result.written);
  });
  method(prototype, "toHex", 0, (receiver, args): unknown => {
    const data = uint8(receiver),
      window = typedArrayWindow(data);
    if (window === undefined) throw createRuntimeError(realm, "type");
    const source = codecWindow(data, window, true);
    const result = encodeHex(source.bytes, source.offset, window.length);
    if (result === undefined) throw "HEX_ENCODE_WINDOW_INVARIANT";
    return result;
  });
  method(prototype, "setFromHex", 1, (receiver, args): unknown => {
    const data = uint8(receiver, "write"),
      source = args[0];
    if (typeof source !== "string") throw createRuntimeError(realm, "type");
    const window = typedArrayWindow(data, "write");
    if (window === undefined) throw createRuntimeError(realm, "type");
    const target = codecWindow(data, window, false);
    const result = decodeHexInto(
      source,
      target.bytes,
      target.offset,
      window.length,
    );
    commitCodec(data, window, target.bytes, result.written);
    if (result.error === "syntax") throw createRuntimeError(realm, "syntax");
    if (result.error !== "none") throw "HEX_DECODE_WINDOW_INVARIANT";
    return counts(result);
  });
  method(constructor, "fromBase64", 1, (receiver, args): unknown => {
    const source = args[0];
    if (typeof source !== "string") throw createRuntimeError(realm, "type");
    const options = args[1],
      selected = alphabet(options),
      mode = chunkHandling(options);
    const decoded = new Uint8Array(Math.ceil(source.length / 4) * 3);
    const result = decodeBase64Into(
      source,
      decoded,
      0,
      decoded.length,
      selected,
      mode,
    );
    if (result.error === "syntax") throw createRuntimeError(realm, "syntax");
    if (result.error !== "none") throw "BASE64_DECODE_WINDOW_INVARIANT";
    return decodedArray(decoded, result.written);
  });
  method(prototype, "setFromBase64", 1, (receiver, args): unknown => {
    const data = uint8(receiver, "write"),
      source = args[0];
    if (typeof source !== "string") throw createRuntimeError(realm, "type");
    const options = args[1],
      selected = alphabet(options),
      mode = chunkHandling(options);
    const window = typedArrayWindow(data, "write");
    if (window === undefined) throw createRuntimeError(realm, "type");
    const target = codecWindow(data, window, false);
    const result = decodeBase64Into(
      source,
      target.bytes,
      target.offset,
      window.length,
      selected,
      mode,
    );
    commitCodec(data, window, target.bytes, result.written);
    if (result.error === "syntax") throw createRuntimeError(realm, "syntax");
    if (result.error !== "none") throw "BASE64_DECODE_WINDOW_INVARIANT";
    return counts(result);
  });
  method(prototype, "toBase64", 0, (receiver, args): unknown => {
    const data = uint8(receiver),
      options = args[0],
      selected = alphabet(options);
    const omitPadding = scriptBoolean(
      optionValue(options, "omitPadding", realm, hooks),
      realm.objectPrototype,
    );
    const window = typedArrayWindow(data);
    if (window === undefined) throw createRuntimeError(realm, "type");
    const source = codecWindow(data, window, true);
    const result = encodeBase64(
      source.bytes,
      source.offset,
      window.length,
      selected,
      omitPadding,
    );
    if (result === undefined) throw "BASE64_ENCODE_WINDOW_INVARIANT";
    return result;
  });
}
