import {
  byteStorageData,
  byteStorageWindow,
  type ByteStorage,
  type StorageAccess,
} from "../bytes/index.ts";
import {
  sharedStorageLength,
  sharedStorageWindow,
  type SharedBlockStorage,
  type SharedOrder,
} from "../bytes/shared.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
import { viewObjectValue } from "./values.ts";
import { exoticSlots } from "./operations.ts";

/** Views accept either backing kind. Lifecycle methods retain their own brands. */
export type BufferStorage = ByteStorage | SharedBlockStorage;
export function requireBufferStorage(
  value: unknown,
  realm: ErrorRealm,
): BufferStorage {
  const object = viewObjectValue(value, realm.objectPrototype);
  if (object !== undefined) {
    const ordinary = exoticSlots(object).internalArrayBufferData;
    if (ordinary !== undefined) return ordinary;
    const shared = exoticSlots(object).internalSharedArrayBufferData;
    if (shared !== undefined) return shared;
  }
  throw createRuntimeError(realm, "type");
}
export function bufferStorageImmutable(storage: BufferStorage): boolean {
  return storage.kind === "ordinary" && storage.immutable;
}
export function bufferStorageResizable(storage: BufferStorage): boolean {
  return storage.kind === "ordinary" ? storage.resizable : storage.growable;
}
export function bufferStorageByteLength(
  storage: BufferStorage,
): number | undefined {
  if (storage.kind === "ordinary") return byteStorageData(storage)?.length;
  const result = sharedStorageLength(storage, "seq-cst");
  return result.ok ? result.value : undefined;
}
export interface BufferStorageWindow {
  readonly length: number;
  /** Only ordinary storage borrows bytes; shared storage uses host operations. */
  readonly bytes: Uint8Array | undefined;
  readonly shared: SharedBlockStorage | undefined;
}
export function bufferStorageWindow(
  storage: BufferStorage,
  offset: number,
  fixedLength: number | undefined,
  elementBytes: number,
  access: StorageAccess = "read",
  order: SharedOrder = "seq-cst",
): BufferStorageWindow | undefined {
  let bytes: Uint8Array | undefined = undefined;
  let shared: SharedBlockStorage | undefined = undefined;
  let length = 0;
  if (storage.kind === "ordinary") {
    const window = byteStorageWindow(
      storage,
      offset,
      fixedLength,
      elementBytes,
      access,
    );
    if (window === undefined) return undefined;
    bytes = window.bytes;
    length = window.length;
  } else {
    const window = sharedStorageWindow(
      storage,
      offset,
      fixedLength,
      elementBytes,
      order,
    );
    if (!window.ok) return undefined;
    shared = storage;
    length = window.value.length;
  }
  return { length, bytes, shared };
}
