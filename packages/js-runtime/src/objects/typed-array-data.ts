import type { SharedOrder } from "../bytes/shared.ts";
import { viewObjectValue } from "./values.ts";
import type { StorageAccess } from "../bytes/index.ts";
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
import { createIntegerIndexedObject } from "./integer-indexed.ts";
import { canonicalNumericIndex } from "./integer-index.ts";
import { scriptPropertyKeyOrder, type ScriptPropertyKey } from "./symbols.ts";
import type { OrdinaryObject, ObjectHooks } from "./operations.ts";
import { numberValue } from "./coercion.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";
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
}
export function requireTypedArray(
  value: unknown,
  realm: ErrorRealm,
  access: StorageAccess = "read",
): TypedArrayData {
  const object = viewObjectValue(value, realm.objectPrototype);
  const data = object === undefined ? undefined : object.internalTypedArrayData;
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
/** Internal creation after constructor validation; no observable property reads. */
export function createTypedArrayView(
  prototype: OrdinaryObject<ScriptPropertyKey, unknown> | undefined,
  data: TypedArrayData,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  const width = typedArrayElementWidth(data.kind);
  const object = createIntegerIndexedObject<ScriptPropertyKey, unknown>(
    prototype,
    {
      mutable: (): boolean => !bufferStorageImmutable(data.storage),
      numericIndex: (key): number | undefined =>
        typeof key === "string" ? canonicalNumericIndex(key) : undefined,
      valid: (index): boolean => validIndex(data, index),
      read: (index): unknown => {
        const window = typedArrayWindow(data, "read", "unordered");
        if (window === undefined) throw "TYPED_ARRAY_READ_INVARIANT";
        const offset = data.byteOffset + index * width;
        const ordinaryBytes = window.bytes;
        const bytes =
          ordinaryBytes === undefined
            ? readTypedArrayBytes(data, index, window)
            : ordinaryBytes;
        const position = ordinaryBytes === undefined ? 0 : offset;
        return data.kind === "BigInt64" || data.kind === "BigUint64"
          ? readBigIntBytes(
              bytes,
              position,
              data.endian,
              data.kind === "BigInt64",
            )
          : readNumericElement(bytes, position, data.kind, data.endian);
      },
      write: (index, value): void => {
        const kind = data.kind;
        // Coercion can resize or detach the storage; never borrow bytes before it.
        if (kind === "BigInt64" || kind === "BigUint64") {
          const converted = coerceBigInt(value, false, realm, hooks);
          if (!validIndex(data, index)) return;
          const window = typedArrayWindow(data, "write", "unordered");
          if (window === undefined) throw "TYPED_ARRAY_WRITE_INVARIANT";
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
        } else {
          const converted = numberValue(value, hooks, realm);
          if (converted.error === "unsupported")
            return rejectUnsupportedExecution(realm);
          if (converted.error !== "none")
            throw createRuntimeError(realm, "type");
          if (!validIndex(data, index)) return;
          const window = typedArrayWindow(data, "write", "unordered");
          if (window === undefined) throw "TYPED_ARRAY_WRITE_INVARIANT";
          const ordinaryBytes = window.bytes;
          const bytes =
            ordinaryBytes === undefined ? new Uint8Array(width) : ordinaryBytes;
          writeNumericElement(
            bytes,
            ordinaryBytes === undefined ? 0 : data.byteOffset + index * width,
            kind,
            converted.value,
            data.endian,
          );
          if (ordinaryBytes === undefined)
            writeTypedArrayBytes(data, index, bytes, window);
        }
      },
      length: (): number => {
        const window = typedArrayWindow(data);
        return window === undefined ? 0 : window.length;
      },
      fromIndex: (index): ScriptPropertyKey => String(index),
      keyOrder: scriptPropertyKeyOrder,
      canPreventExtensions: (): boolean =>
        data.length !== undefined &&
        (data.storage.kind === "shared" ||
          !bufferStorageResizable(data.storage)),
    },
    hooks,
  );
  object.internalTypedArrayData = data;
  object.internalArrayBufferView = true;
  return object;
}
