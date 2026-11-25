import type { SharedOrder } from "../bytes/shared.ts";
import { viewObjectValue } from "./values.ts";
import { byteStorageData, type StorageAccess } from "../bytes/index.ts";
import {
  bufferStorageWindow,
  bufferStorageImmutable,
  bufferStorageResizable,
  type BufferStorage,
  type BufferStorageWindow,
} from "./buffer-storage.ts";
import {
  readTypedArrayBytes,
  writeTypedArrayBytes,
} from "./typed-array-storage.ts";
import type { Endian } from "@tint/foundation/binary/bytes";
import {
  numericElementWidth,
  readNumericElement,
  writeNumericElement,
  type NumericElementKind,
} from "./numeric-element.ts";
import { readBigIntBytes, writeBigIntBytes } from "./bigint-bytes.ts";
import { coerceBigInt } from "./bigint-coercion.ts";
import { createIntegerIndexedMethods } from "./integer-indexed.ts";
import { canonicalNumericIndex } from "./integer-index.ts";
import { scriptPropertyKeyOrder, type ScriptPropertyKey } from "./symbols.ts";
import {
  createExoticObject,
  type OrdinaryObject,
  type ObjectHooks,
  type ObjectInternalMethods,
} from "./operations.ts";
import { numberValue } from "./coercion.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";
import { ensureExoticSlots, exoticSlots } from "./operations.ts";
export type TypedArrayElementKind =
  NumericElementKind | "BigInt64" | "BigUint64";
/** A fixed element count may become out of bounds and later recover. Undefined
 * length tracks the backing store. Endianness is supplied by the target host. */
export interface TypedArrayData {
  readonly buffer: OrdinaryObject<ScriptPropertyKey, unknown>;
  readonly storage: BufferStorage;
  readonly byteOffset: number;
  readonly length: number | undefined;
  readonly kind: TypedArrayElementKind;
  readonly endian: Endian;
  /** Lazily cached native Uint32Array over a fixed-length little-endian
   * Int32/Uint32 view of a SharedBlockStorage, for inline Atomics fast paths. */
  nativeWords?: Uint32Array | undefined;
}
export function requireTypedArray(
  value: unknown,
  realm: ErrorRealm,
  access: StorageAccess = "read",
): TypedArrayData {
  const object = viewObjectValue(value, realm.objectPrototype);
  const data =
    object === undefined
      ? undefined
      : exoticSlots(object).internalTypedArrayData;
  if (
    data === undefined ||
    (access === "write" && bufferStorageImmutable(data.storage))
  )
    throw createRuntimeError(realm, "type");
  return data;
}
export function typedArrayElementWidth(kind: TypedArrayElementKind): number {
  return kind === "BigInt64" || kind === "BigUint64"
    ? 8
    : numericElementWidth(kind);
}
export function typedArrayWindow(
  data: TypedArrayData,
  access: StorageAccess = "read",
  order: SharedOrder = "seq-cst",
): BufferStorageWindow | undefined {
  return bufferStorageWindow(
    data.storage,
    data.byteOffset,
    data.length,
    typedArrayElementWidth(data.kind),
    access,
    order,
  );
}
function validIndex(data: TypedArrayData, index: number): boolean {
  if (!Number.isInteger(index) || index < 0 || (index === 0 && 1 / index < 0))
    return false;
  const window = typedArrayWindow(data, "read", "unordered");
  return window !== undefined && index < window.length;
}
/** TypedArrayGetElement for an index the caller has validated against window
 * (captured with no intervening user code). Shared elements load whole. */
export function readTypedArrayElement(
  data: TypedArrayData,
  index: number,
  window: BufferStorageWindow,
): unknown {
  const width = typedArrayElementWidth(data.kind);
  const ordinaryBytes = window.bytes;
  const bytes =
    ordinaryBytes === undefined
      ? readTypedArrayBytes(data, index, window)
      : ordinaryBytes;
  const position =
    ordinaryBytes === undefined ? 0 : data.byteOffset + index * width;
  return decodeTypedArrayElement(data, bytes, position);
}
function decodeTypedArrayElement(
  data: TypedArrayData,
  bytes: Uint8Array,
  position: number,
): unknown {
  const kind = data.kind;
  return kind === "BigInt64" || kind === "BigUint64"
    ? readBigIntBytes(bytes, position, data.endian, kind === "BigInt64")
    : readNumericElement(bytes, position, kind, data.endian);
}
/** [[Get]] of a canonical numeric index: the element when the index is a
 * valid integer index of the current window, otherwise undefined. */
export function typedArrayElementAt(
  data: TypedArrayData,
  index: number,
): unknown {
  if (!Number.isInteger(index) || index < 0 || (index === 0 && 1 / index < 0))
    return undefined;
  const storage = data.storage;
  if (storage.kind === "ordinary") {
    const bytes = byteStorageData(storage);
    if (bytes === undefined) return undefined;
    const width = typedArrayElementWidth(data.kind);
    const length = data.length;
    if (length !== undefined && index >= length) return undefined;
    const end =
      data.byteOffset + (length === undefined ? index + 1 : length) * width;
    if (end > bytes.length) return undefined;
    const offset = data.byteOffset + index * width;
    if (width === 1) {
      const byte = bytes[offset];
      if (byte === undefined) throw "TYPED_ARRAY_READ_BOUNDS_INVARIANT";
      return data.kind === "Int8" && byte >= 128 ? byte - 256 : byte;
    }
    return decodeTypedArrayElement(data, bytes, offset);
  }
  const window = typedArrayWindow(data, "read", "unordered");
  if (window === undefined || index >= window.length) return undefined;
  return readTypedArrayElement(data, index, window);
}
/** Store an already-numeric value of a non-BigInt kind at an index the caller
 * has validated against window, with no user code since it was captured. */
export function writeTypedArrayNumber(
  data: TypedArrayData,
  index: number,
  value: number,
  window: BufferStorageWindow,
): void {
  const kind = data.kind;
  if (kind === "BigInt64" || kind === "BigUint64")
    throw "TYPED_ARRAY_NUMBER_KIND_INVARIANT";
  const ordinaryBytes = window.bytes;
  if (ordinaryBytes !== undefined) {
    writeNumericElement(
      ordinaryBytes,
      data.byteOffset + index * numericElementWidth(kind),
      kind,
      value,
      data.endian,
    );
    return;
  }
  const bytes = new Uint8Array(numericElementWidth(kind));
  writeNumericElement(bytes, 0, kind, value, data.endian);
  writeTypedArrayBytes(data, index, bytes, window);
}
/** TypedArraySetElement: convert first (which can resize or detach the
 * storage, so bytes are never borrowed before it), then store only if the
 * index is still valid. */
export function setTypedArrayElement(
  data: TypedArrayData,
  index: number,
  value: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  const kind = data.kind,
    width = typedArrayElementWidth(kind);
  if (kind === "BigInt64" || kind === "BigUint64") {
    const converted = coerceBigInt(value, false, realm, hooks);
    if (!Number.isInteger(index) || index < 0 || (index === 0 && 1 / index < 0))
      return;
    const window = typedArrayWindow(data, "write", "unordered");
    if (window === undefined || index >= window.length) return;
    const ordinaryBytes = window.bytes;
    const bytes =
      ordinaryBytes === undefined ? new Uint8Array(width) : ordinaryBytes;
    writeBigIntBytes(
      bytes,
      ordinaryBytes === undefined ? 0 : data.byteOffset + index * width,
      converted,
      data.endian,
    );
    if (ordinaryBytes === undefined)
      writeTypedArrayBytes(data, index, bytes, window);
    return;
  }
  const converted = numberValue(value, hooks, realm);
  if (converted.error === "unsupported")
    return rejectUnsupportedExecution(realm);
  if (converted.error !== "none") throw createRuntimeError(realm, "type");
  if (!Number.isInteger(index) || index < 0 || (index === 0 && 1 / index < 0))
    return;
  const window = typedArrayWindow(data, "write", "unordered");
  if (window === undefined || index >= window.length) return;
  writeTypedArrayNumber(data, index, converted.value, window);
}
/** Internal creation after constructor validation; no observable property reads. */
function integerIndexedMethods(
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): ObjectInternalMethods<ScriptPropertyKey, unknown> {
  const cached = realm.typedArrayIntegerIndexed;
  if (cached !== undefined && cached.hooks === hooks) return cached.methods;
  const methods = createIntegerIndexedMethods<
    ScriptPropertyKey,
    unknown,
    TypedArrayData
  >(
    (object): TypedArrayData => {
      const data = exoticSlots(object).internalTypedArrayData;
      if (data === undefined) throw "TYPED_ARRAY_DATA_INVARIANT";
      return data;
    },
    {
      mutable: (data): boolean => !bufferStorageImmutable(data.storage),
      numericIndex: (key): number | undefined =>
        typeof key === "string" ? canonicalNumericIndex(key) : undefined,
      valid: (data, index): boolean => validIndex(data, index),
      read: (data, index): unknown => {
        const window = typedArrayWindow(data, "read", "unordered");
        if (window === undefined) throw "TYPED_ARRAY_READ_INVARIANT";
        return readTypedArrayElement(data, index, window);
      },
      write: (data, index, value): void => {
        setTypedArrayElement(data, index, value, realm, hooks);
      },
      length: (data): number => {
        const window = typedArrayWindow(data);
        return window === undefined ? 0 : window.length;
      },
      fromIndex: (index): ScriptPropertyKey => String(index),
      keyOrder: scriptPropertyKeyOrder,
      canPreventExtensions: (data): boolean =>
        data.length !== undefined &&
        (data.storage.kind === "shared" ||
          !bufferStorageResizable(data.storage)),
    },
    hooks,
  );
  realm.typedArrayIntegerIndexed = { hooks, methods };
  return methods;
}

export function createTypedArrayView(
  prototype: OrdinaryObject<ScriptPropertyKey, unknown> | undefined,
  data: TypedArrayData,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  const object = createExoticObject<ScriptPropertyKey, unknown>(
    prototype,
    integerIndexedMethods(realm, hooks),
  );
  const slots = ensureExoticSlots(object);
  slots.internalTypedArrayData = data;
  slots.internalArrayBufferView = true;
  return object;
}
