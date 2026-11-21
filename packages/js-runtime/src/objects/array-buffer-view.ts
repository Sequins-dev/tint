import type { SharedOrder } from "../bytes/shared.ts";
import {
  bufferStorageByteLength,
  bufferStorageImmutable,
  bufferStorageWindow,
  type BufferStorage,
} from "./buffer-storage.ts";
import type { OrdinaryObject } from "./operations.ts";
import type { ScriptPropertyKey } from "./symbols.ts";
import { typedArrayElementWidth } from "./typed-array-data.ts";
import { viewObjectValue } from "./values.ts";

export interface ArrayBufferViewRange {
  readonly kind: "ordinary" | "shared" | "detached";
  readonly storage: BufferStorage;
  readonly byteOffset: number;
  readonly byteLength: number;
  /** A borrow of the whole ordinary backing. Use offset and length to access
   * the view and reacquire after any step that may resize or detach it.
   * Shared access uses the storage's ordered host operations. */
  readonly bytes: Uint8Array | undefined;
  readonly writable: boolean;
}

export function projectArrayBufferViewRange(
  object: OrdinaryObject<ScriptPropertyKey, unknown>,
  order: SharedOrder = "seq-cst",
): ArrayBufferViewRange | undefined {
  const array = object.internalTypedArrayData;
  const view = object.internalDataViewData;
  const data = array ?? view;
  if (data === undefined) return undefined;
  const storage = data.storage;
  const width = array === undefined ? 1 : typedArrayElementWidth(array.kind);
  const count = array === undefined ? view?.byteLength : array.length;
  const window = bufferStorageWindow(
    storage,
    data.byteOffset,
    count,
    width,
    "read",
    order,
  );
  const detached =
    storage.kind === "ordinary" &&
    bufferStorageByteLength(storage) === undefined;
  return {
    kind: detached ? "detached" : storage.kind,
    storage,
    byteOffset: window === undefined ? 0 : data.byteOffset,
    byteLength: window === undefined ? 0 : window.length * width,
    bytes:
      window?.bytes ?? (storage.kind === "ordinary" ? storage.data : undefined),
    writable: !detached && !bufferStorageImmutable(storage),
  };
}

export function projectArrayBufferView(
  value: unknown,
  witness: OrdinaryObject<ScriptPropertyKey, unknown>,
): ArrayBufferViewRange | undefined {
  const object = viewObjectValue(value, witness);
  return object === undefined ? undefined : projectArrayBufferViewRange(object);
}
