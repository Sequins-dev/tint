/** Owned byte storage. Mutate lifecycle state only through this module. */
export interface ByteStorage {
  readonly kind: "ordinary";
  data: Uint8Array | undefined;
  readonly maxByteLength: number;
  readonly resizable: boolean;
  readonly immutable: boolean;
  readonly allocationLimit: number;
}
export type StorageAccess = "read" | "write";
export type StorageTransferMode =
  "preserve-resizability" | "fixed-length" | "immutable";
export type StorageError =
  | "detached"
  | "fixed-length"
  | "immutable"
  | "invalid-length"
  | "allocation-limit";
export type StorageResult =
  | { readonly ok: true; readonly value: ByteStorage }
  | { readonly ok: false; readonly error: StorageError };
function validLength(length: number): boolean {
  return (
    Number.isInteger(length) && length >= 0 && length <= Number.MAX_SAFE_INTEGER
  );
}
/** Maximum length is a logical limit, not an eagerly allocated reservation.
 * The embedding supplies its allocation policy separately from that limit. */
export function createByteStorage(
  length: number,
  maxByteLength: number,
  resizable: boolean,
  allocationLimit: number,
): StorageResult {
  return allocateStorage(
    length,
    maxByteLength,
    resizable,
    allocationLimit,
    false,
  );
}
function allocateStorage(
  length: number,
  maxByteLength: number,
  resizable: boolean,
  allocationLimit: number,
  immutable: boolean,
): StorageResult {
  if (
    !validLength(length) ||
    !validLength(maxByteLength) ||
    !validLength(allocationLimit) ||
    length > maxByteLength ||
    (!resizable && length !== maxByteLength)
  )
    return { ok: false, error: "invalid-length" };
  if (length > allocationLimit) return { ok: false, error: "allocation-limit" };
  return {
    ok: true,
    value: {
      kind: "ordinary",
      data: new Uint8Array(length),
      maxByteLength,
      resizable,
      immutable,
      allocationLimit,
    },
  };
}
/** Borrowed storage; reacquire after any operation that can resize or detach.
 * Read borrows must not be mutated. Write borrows also reject immutable storage.
 * Undefined means inaccessible; a zero-length array is still live storage. */
export function byteStorageData(
  storage: ByteStorage,
  access: StorageAccess = "read",
): Uint8Array | undefined {
  return access === "write" && storage.immutable ? undefined : storage.data;
}
export interface ByteStorageWindow {
  readonly bytes: Uint8Array;
  readonly length: number;
}
/** Borrow an element-counted view, reacquiring storage after lifecycle changes.
 * An undefined fixedLength tracks the remaining whole elements. Out-of-bounds
 * views can recover after growth; detached storage never exposes a window. */
export function byteStorageWindow(
  storage: ByteStorage,
  byteOffset: number,
  fixedLength: number | undefined,
  elementBytes: number,
  access: StorageAccess = "read",
): ByteStorageWindow | undefined {
  const bytes = byteStorageData(storage, access);
  if (
    bytes === undefined ||
    !validLength(byteOffset) ||
    !validLength(elementBytes) ||
    elementBytes === 0 ||
    byteOffset > bytes.length
  )
    return undefined;
  const available = Math.floor((bytes.length - byteOffset) / elementBytes);
  if (
    fixedLength !== undefined &&
    (!validLength(fixedLength) || fixedLength > available)
  )
    return undefined;
  return { bytes, length: fixedLength === undefined ? available : fixedLength };
}
export function detachByteStorage(storage: ByteStorage): "none" | "immutable" {
  if (storage.immutable) return "immutable";
  storage.data = undefined;
  return "none";
}
function copyBytes(
  source: Uint8Array,
  target: Uint8Array,
  sourceStart: number,
  targetStart: number,
  length: number,
): void {
  const backwards =
    source === target &&
    targetStart > sourceStart &&
    targetStart - sourceStart < length;
  for (let count = 0; count < length; count++) {
    const index = backwards ? length - count - 1 : count;
    const value = source[sourceStart + index];
    if (value === undefined) throw "BYTE_STORAGE_BOUNDS_INVARIANT";
    target[targetStart + index] = value;
  }
}
function copyPrefix(source: Uint8Array, target: Uint8Array): void {
  copyBytes(source, target, 0, 0, Math.min(source.length, target.length));
}
/** Checked, overlap-safe copying with no observable callbacks or allocations. */
export function copyByteStorage(
  source: ByteStorage,
  target: ByteStorage,
  sourceStart: number,
  targetStart: number,
  length: number,
): StorageError | "none" {
  if (target.immutable) return "immutable";
  const from = source.data,
    to = target.data;
  if (from === undefined || to === undefined) return "detached";
  if (
    !validLength(sourceStart) ||
    !validLength(targetStart) ||
    !validLength(length) ||
    sourceStart > from.length ||
    targetStart > to.length ||
    length > from.length - sourceStart ||
    length > to.length - targetStart
  )
    return "invalid-length";
  copyBytes(from, to, sourceStart, targetStart, length);
  return "none";
}
export function resizeByteStorage(
  storage: ByteStorage,
  length: number,
): StorageError | "none" {
  if (storage.immutable) return "immutable";
  const current = storage.data;
  if (current === undefined) return "detached";
  if (!storage.resizable) return "fixed-length";
  if (!validLength(length) || length > storage.maxByteLength)
    return "invalid-length";
  if (length > storage.allocationLimit) return "allocation-limit";
  if (length === current.length) return "none";
  const replacement = new Uint8Array(length);
  copyPrefix(current, replacement);
  storage.data = replacement;
  return "none";
}
/** Copy before committing detachment so failed transfers preserve the source.
 * A fixed destination can exceed the source's former logical maximum. */
export function transferByteStorage(
  storage: ByteStorage,
  length: number,
  mode: StorageTransferMode,
): StorageResult {
  if (storage.immutable) return { ok: false, error: "immutable" };
  const current = storage.data;
  if (current === undefined) return { ok: false, error: "detached" };
  const resizable = mode === "preserve-resizability" && storage.resizable;
  const destination = allocateStorage(
    length,
    resizable ? storage.maxByteLength : length,
    resizable,
    storage.allocationLimit,
    mode === "immutable",
  );
  if (!destination.ok) return destination;
  const bytes = destination.value.data;
  if (bytes === undefined) throw "NEW_STORAGE_DETACHED";
  copyPrefix(current, bytes);
  detachByteStorage(storage);
  return destination;
}

/** Initialize an independent immutable destination before publishing it. A resolved
 * empty range may start beyond a source that shrank during argument coercion. */
export function copyImmutableByteStorage(
  source: ByteStorage,
  sourceStart: number,
  count: number,
  length: number,
): StorageResult {
  const bytes = source.data;
  if (bytes === undefined) return { ok: false, error: "detached" };
  if (
    !validLength(sourceStart) ||
    !validLength(count) ||
    !validLength(length) ||
    count > length ||
    (count > 0 &&
      (sourceStart > bytes.length || count > bytes.length - sourceStart))
  )
    return { ok: false, error: "invalid-length" };
  const destination = allocateStorage(
    length,
    length,
    false,
    source.allocationLimit,
    true,
  );
  if (!destination.ok) return destination;
  const target = destination.value.data;
  if (target === undefined) throw "NEW_STORAGE_DETACHED";
  copyBytes(bytes, target, sourceStart, 0, count);
  return destination;
}
