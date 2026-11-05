import { coerceBigInt } from "./bigint-coercion.ts";
import { readBigIntBytes, writeBigIntBytes } from "./bigint-bytes.ts";
import type { BigIntValue } from "./bigints.ts";
import type { StorageAccess } from "../bytes/index.ts";
import {
  readSharedByte,
  writeSharedUnsigned,
  type SharedOrder,
} from "../bytes/shared.ts";
import {
  requireBufferStorage,
  bufferStorageImmutable,
  bufferStorageResizable,
  bufferStorageByteLength,
  bufferStorageWindow,
  type BufferStorage,
  type BufferStorageWindow,
} from "./buffer-storage.ts";
import type { Endian } from "@tint/foundation/binary/bytes";
import {
  numericElementWidth,
  readNumericElement,
  writeNumericElement,
  type NumericElementKind,
} from "./numeric-element.ts";
import { bufferIndex } from "./array-buffer.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";
import { numberValue } from "./coercion.ts";
import { viewObjectValue, scriptBoolean } from "./values.ts";
import { constructorPrototype } from "./functions.ts";
import {
  builtinProperty,
  builtinFunction,
  builtinAccessor,
  builtinFunctionMetadata,
} from "./intrinsics.ts";
import { wellKnownSymbol, type ScriptPropertyKey } from "./symbols.ts";
import {
  createObject,
  createConstructorObject,
  type OrdinaryObject,
  type ObjectHooks,
  type ObjectCall,
} from "./operations.ts";

/** Undefined byteLength denotes a length-tracking view, not a detached view. */
export interface DataViewData {
  readonly buffer: OrdinaryObject<ScriptPropertyKey, unknown>;
  readonly storage: BufferStorage;
  readonly byteOffset: number;
  readonly byteLength: number | undefined;
}
function requireDataView(
  value: unknown,
  realm: ErrorRealm,
  access: StorageAccess = "read",
): DataViewData {
  const object = viewObjectValue(value, realm.objectPrototype);
  const data = object === undefined ? undefined : object.internalDataViewData;
  if (
    data === undefined ||
    (access === "write" && bufferStorageImmutable(data.storage))
  )
    throw createRuntimeError(realm, "type");
  return data;
}
/** Reacquire after all observable coercions; resizing can invalidate a fixed
 * view temporarily, and a later growth can make the same view usable again. */
function captureViewWindow(
  data: DataViewData,
  access: StorageAccess,
  order: SharedOrder,
): BufferStorageWindow | undefined {
  return bufferStorageWindow(
    data.storage,
    data.byteOffset,
    data.byteLength,
    1,
    access,
    order,
  );
}
function viewWindow(
  data: DataViewData,
  realm: ErrorRealm,
  access: StorageAccess = "read",
): BufferStorageWindow {
  const window = captureViewWindow(data, access, "unordered");
  if (window === undefined) throw createRuntimeError(realm, "type");
  return window;
}
function installViewAccessors<Value>(
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  convert: (value: unknown) => Value,
  name: string,
  width: number,
  read: (bytes: Uint8Array, offset: number, endian: Endian) => Value,
  write: (
    bytes: Uint8Array,
    offset: number,
    value: Value,
    endian: Endian,
  ) => void,
): void {
  const prototype = realm.dataViewPrototype;
  const getName = "get" + name,
    setName = "set" + name;
  builtinProperty(
    prototype,
    getName,
    builtinFunction(
      realm.functionPrototype,
      getName,
      1,
      (receiver, args): unknown => {
        const data = requireDataView(receiver, realm);
        const offset = bufferIndex(args[0], realm, hooks);
        const endian = scriptBoolean(args[1], realm.objectPrototype)
          ? "little"
          : "big";
        const window = viewWindow(data, realm);
        if (offset > window.length || width > window.length - offset)
          throw createRuntimeError(realm, "range");
        const ordinaryBytes = window.bytes;
        if (ordinaryBytes !== undefined)
          return read(ordinaryBytes, data.byteOffset + offset, endian);
        const shared = window.shared;
        if (shared === undefined) throw "DATA_VIEW_SHARED_WINDOW_INVARIANT";
        // DataView permits unaligned, bytewise shared accesses. Capture only the
        // requested payload; a witness is not a multi-byte atomic snapshot.
        const bytes = new Uint8Array(width);
        for (let index = 0; index < width; index++) {
          const result = readSharedByte(
            shared,
            data.byteOffset + offset + index,
          );
          if (!result.ok) throw "DATA_VIEW_SHARED_READ_INVARIANT";
          bytes[index] = result.value;
        }
        return read(bytes, 0, endian);
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(
    prototype,
    setName,
    builtinFunction(
      realm.functionPrototype,
      setName,
      2,
      (receiver, args): unknown => {
        const data = requireDataView(receiver, realm, "write");
        const offset = bufferIndex(args[0], realm, hooks);
        const converted = convert(args[1]);
        const endian = scriptBoolean(args[2], realm.objectPrototype)
          ? "little"
          : "big";
        const window = viewWindow(data, realm, "write");
        if (offset > window.length || width > window.length - offset)
          throw createRuntimeError(realm, "range");
        const ordinaryBytes = window.bytes;
        if (ordinaryBytes !== undefined)
          write(ordinaryBytes, data.byteOffset + offset, converted, endian);
        else {
          const shared = window.shared;
          if (shared === undefined) throw "DATA_VIEW_SHARED_WINDOW_INVARIANT";
          const bytes = new Uint8Array(width);
          write(bytes, 0, converted, endian);
          for (let index = 0; index < width; index++) {
            const byte = bytes[index];
            if (byte === undefined) throw "DATA_VIEW_SHARED_BYTE_INVARIANT";
            if (
              writeSharedUnsigned(
                shared,
                data.byteOffset + offset + index,
                1,
                byte,
                "unordered",
              ) !== "none"
            )
              throw "DATA_VIEW_SHARED_WRITE_INVARIANT";
          }
        }
        return undefined;
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
}

export function installDataViewIntrinsics(
  global: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  const prototype = realm.dataViewPrototype;
  const constructor = createConstructorObject<ScriptPropertyKey, unknown>(
    realm.functionPrototype,
    (receiver, args): unknown => {
      throw createRuntimeError(realm, "type");
    },
    (args, target): unknown => {
      const storage = requireBufferStorage(args[0], realm);
      const buffer = viewObjectValue(args[0], realm.objectPrototype);
      if (buffer === undefined) throw "VIEW_BUFFER_INVARIANT";
      const offset = bufferIndex(args[1], realm, hooks);
      const initialLength = bufferStorageByteLength(storage);
      if (initialLength === undefined) throw createRuntimeError(realm, "type");
      if (offset > initialLength) throw createRuntimeError(realm, "range");
      let length: number | undefined = undefined;
      if (args[2] !== undefined) {
        length = bufferIndex(args[2], realm, hooks);
        if (length > initialLength - offset)
          throw createRuntimeError(realm, "range");
      } else if (!bufferStorageResizable(storage))
        length = initialLength - offset;
      const parent = constructorPrototype(target, "data-view", realm, hooks);
      const currentLength = bufferStorageByteLength(storage);
      if (currentLength === undefined) throw createRuntimeError(realm, "type");
      if (
        offset > currentLength ||
        (length !== undefined && length > currentLength - offset)
      )
        throw createRuntimeError(realm, "range");
      const object = createObject<ScriptPropertyKey, unknown>(parent);
      object.internalDataViewData = {
        buffer,
        storage,
        byteOffset: offset,
        byteLength: length,
      };
      object.internalArrayBufferView = true;
      return object;
    },
  );
  builtinFunctionMetadata(constructor, "DataView", 1, hooks);
  builtinProperty(constructor, "prototype", prototype, false, false, hooks);
  builtinProperty(prototype, "constructor", constructor, true, true, hooks);
  builtinProperty(
    prototype,
    wellKnownSymbol(realm.symbolRegistry, "toStringTag"),
    "DataView",
    false,
    true,
    hooks,
  );
  builtinProperty(global, "DataView", constructor, true, true, hooks);
  function getter(name: string, call: ObjectCall<unknown>): void {
    builtinAccessor(
      prototype,
      name,
      builtinFunction(realm.functionPrototype, "get " + name, 0, call, hooks),
      undefined,
      hooks,
    );
  }
  getter(
    "buffer",
    (receiver, args): unknown => requireDataView(receiver, realm).buffer,
  );
  getter("byteLength", (receiver, args): unknown => {
    const data = requireDataView(receiver, realm);
    const window = captureViewWindow(data, "read", "seq-cst");
    return window === undefined ? 0 : window.length;
  });
  getter("byteOffset", (receiver, args): unknown => {
    const data = requireDataView(receiver, realm);
    const window = captureViewWindow(data, "read", "seq-cst");
    return window === undefined ? 0 : data.byteOffset;
  });
  function toNumber(value: unknown): number {
    const converted = numberValue(value, hooks, realm);
    if (converted.error === "unsupported")
      return rejectUnsupportedExecution(realm);
    if (converted.error !== "none") throw createRuntimeError(realm, "type");
    return converted.value;
  }
  function numeric(kind: NumericElementKind): void {
    installViewAccessors<number>(
      realm,
      hooks,
      toNumber,
      kind,
      numericElementWidth(kind),
      (bytes, offset, endian): number =>
        readNumericElement(bytes, offset, kind, endian),
      (bytes, offset, value, endian): void =>
        writeNumericElement(bytes, offset, kind, value, endian),
    );
  }
  function bigint(name: string, signed: boolean): void {
    installViewAccessors<BigIntValue>(
      realm,
      hooks,
      (value): BigIntValue => coerceBigInt(value, false, realm, hooks),
      name,
      8,
      (bytes, offset, endian): BigIntValue =>
        readBigIntBytes(bytes, offset, endian, signed),
      writeBigIntBytes,
    );
  }
  bigint("BigInt64", true);
  bigint("BigUint64", false);
  numeric("Int8");
  numeric("Uint8");
  numeric("Int16");
  numeric("Uint16");
  numeric("Int32");
  numeric("Uint32");
  numeric("Float16");
  numeric("Float32");
  numeric("Float64");
}
