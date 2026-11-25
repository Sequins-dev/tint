import { fromParts, type Word64 } from "@tint/foundation/binary/word64";

export type SharedOrder = "unordered" | "seq-cst";
export type SharedUnsignedWidth = 1 | 2 | 4;
export type SharedError =
  | "invalid-handle"
  | "invalid-length"
  | "fixed-length"
  | "invalid-range"
  | "invalid-width"
  | "unaligned"
  | "invalid-order"
  | "invalid-value"
  | "allocation-limit";
export type SharedStatus = "none" | SharedError;
export type SharedResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: SharedError };

export interface SharedBlockDescriptor {
  /** Opaque engine-scoped capability, never a payload address. */
  readonly handle: number;
  /** Stable identity shared by every handle/wrapper for this block. */
  readonly blockId: number;
  readonly maxByteLength: number;
  readonly growable: boolean;
}

/** Optional trusted atomic backing operations. Always sequentially consistent;
 * callers finish conversions before entry. Word64 observations use exact halves,
 * never an arbitrary uint64 Number. Failed calls leave caller scratch unchanged. */
export interface SharedBlockAtomics {
  compareExchangeUnsigned(
    handle: number,
    offset: number,
    width: SharedUnsignedWidth,
    expected: number,
    replacement: number,
  ): SharedResult<number>;
  compareExchangeWord64(
    handle: number,
    offset: number,
    expectedLo: number,
    expectedHi: number,
    replacementLo: number,
    replacementHi: number,
    scratch: Uint32Array,
  ): SharedStatus;
  /** One indivisible read-modify-write of an unsigned element: `operand`
   * is already the element's unsigned encoding. Returns the element's
   * previous unsigned value. */
  updateUnsigned(
    handle: number,
    offset: number,
    width: SharedUnsignedWidth,
    operation: SharedUpdate,
    operand: number,
  ): SharedResult<number>;
}
export type SharedUpdate = "exchange" | "add" | "sub" | "and" | "or" | "xor";
/** The unsigned `width`-byte result of `operation` on unsigned encodings. */
export function sharedUpdateValue(
  operation: SharedUpdate,
  previous: number,
  operand: number,
  width: SharedUnsignedWidth,
): number {
  const modulus = width === 1 ? 256 : width === 2 ? 65536 : 4294967296;
  if (operation === "exchange") return operand;
  if (operation === "add") return (previous + operand) % modulus;
  if (operation === "sub") return (previous - operand + modulus) % modulus;
  if (operation === "and") return (previous & operand) >>> 0;
  if (operation === "or") return (previous | operand) >>> 0;
  return (previous ^ operand) >>> 0;
}

/** Notification authority for an engine-owned waiter registry. Width selects a
 * valid Int32/BigInt64 view, never a separate queue: the key is block identity
 * plus absolute byte offset. Count is already converted, nonnegative or Infinity.
 * Even count zero follows the host's waiter-list critical section. */
export interface SharedBlockNotifications {
  notifyOrdered?(
    handle: number,
    offset: number,
    width: 4 | 8,
    count: number,
  ): SharedResult<SharedNotificationBatch>;
  notify(
    handle: number,
    offset: number,
    width: 4 | 8,
    count: number,
  ): SharedResult<number>;
}
export interface SharedNotificationBatch {
  readonly count: number;
  readonly first: number;
  readonly last: number;
}

/** Owner-agent waiter protocol. Tickets are opaque scalar capabilities. Kernel
 * wakes are advisory; only a terminal state can complete a language wait. */
export type SharedWaitState = "waiting" | "notified" | "timed-out";
export interface SharedWaitRegistration {
  readonly state: "waiting" | "not-equal" | "timed-out";
  readonly ticket: number;
}
export interface SharedBlockWaiting {
  readonly registryId?: number;
  register(
    handle: number,
    offset: number,
    width: 4 | 8,
    lo: number,
    hi: number,
    zeroTimeout: boolean,
  ): SharedResult<SharedWaitRegistration>;
  poll(ticket: number): SharedResult<SharedWaitState>;
  /** Terminal sequence shared across waiter locations; zero while pending. */
  order?(ticket: number): SharedResult<number>;
  expire(ticket: number): SharedResult<boolean>;
  take(ticket: number): SharedResult<SharedWaitState>;
  park(ticket: number, timeoutNanoseconds: number): SharedResult<number>;
  /** Monotonic milliseconds, with one process-wide origin shared by its agents. */
  now(): number;
}

/** Explicit trusted embedding capability. No global or ordinary-storage fallback.
 * Engine/block identities are stable safe integers, unique within their scope.
 * Creation reserves a stable, zeroed, nonmoving payload up to maximum once.
 * The service owns its blocks; payloads contain no managed references. It must
 * retain mappings while any operation can access them, independently of wrappers.
 * Numeric inputs are already converted: callers finish observable hooks first.
 * Every leaf validates handle, order, width, alignment and authoritative bounds
 * before memory access. Shared reads/effects must never be treated as pure. */
export interface SharedBlockService {
  readonly engineId: number;
  readonly atomics?: SharedBlockAtomics | undefined;
  readonly notifications?: SharedBlockNotifications | undefined;
  readonly waiting?: SharedBlockWaiting | undefined;
  create(
    initial: number,
    maximum: number,
    growable: boolean,
  ): SharedResult<SharedBlockDescriptor>;
  describe(handle: number): SharedResult<SharedBlockDescriptor>;
  /** Trusted: a nonmoving byte view of the block's whole reservation
   * (maxByteLength bytes), which typed code may view directly; undefined
   * for an invalid handle or a service that cannot expose its payload. */
  bytes(handle: number): Uint8Array | undefined;
  length(handle: number, order: SharedOrder): SharedResult<number>;
  /** Atomically revalidate current <= target <= maximum and publish target.
   * Equality also follows the ordered publication path. Never copy or shrink. */
  grow(handle: number, target: number): SharedStatus;
  /** Each integer access captures/stores its entire aligned width in one
   * operation; bytewise integer reconstruction is not an implementation. */
  readUnsigned(
    handle: number,
    offset: number,
    width: SharedUnsignedWidth,
    order: SharedOrder,
  ): SharedResult<number>;
  writeUnsigned(
    handle: number,
    offset: number,
    width: SharedUnsignedWidth,
    value: number,
    order: SharedOrder,
  ): SharedStatus;
  /** One 64-bit load, then split the captured payload into scratch[0]=lo,
   * scratch[1]=hi. No arbitrary uint64 payload ever passes through Number. */
  readWord64(
    handle: number,
    offset: number,
    order: SharedOrder,
    scratch: Uint32Array,
  ): SharedStatus;
  /** Assemble both exact halves before one 64-bit store. */
  writeWord64(
    handle: number,
    offset: number,
    order: SharedOrder,
    lo: number,
    hi: number,
  ): SharedStatus;
}

/** Managed wrapper metadata. Logical length exists only in the shared service;
 * wrapper identity, copied lengths and mutable byte-array windows are not backing
 * identity or shared length authority. This is separate from ordinary ByteStorage. */
export interface SharedBlockStorage extends SharedBlockDescriptor {
  readonly kind: "shared";
  readonly engineId: number;
  readonly service: SharedBlockService;
}
function validLength(value: number): boolean {
  return (
    Number.isInteger(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER
  );
}
function validOrder(order: SharedOrder): boolean {
  return order === "unordered" || order === "seq-cst";
}
function wrap(
  service: SharedBlockService,
  descriptor: SharedBlockDescriptor,
): SharedBlockStorage {
  return {
    kind: "shared",
    service,
    engineId: service.engineId,
    handle: descriptor.handle,
    blockId: descriptor.blockId,
    maxByteLength: descriptor.maxByteLength,
    growable: descriptor.growable,
  };
}
export function createSharedStorage(
  service: SharedBlockService,
  initial: number,
  maximum: number,
  growable: boolean,
): SharedResult<SharedBlockStorage> {
  if (
    !validLength(initial) ||
    !validLength(maximum) ||
    initial > maximum ||
    (!growable && initial !== maximum)
  )
    return { ok: false, error: "invalid-length" };
  const result = service.create(initial, maximum, growable);
  return result.ok ? { ok: true, value: wrap(service, result.value) } : result;
}
export function attachSharedStorage(
  service: SharedBlockService,
  handle: number,
): SharedResult<SharedBlockStorage> {
  if (!validLength(handle)) return { ok: false, error: "invalid-handle" };
  const result = service.describe(handle);
  return result.ok ? { ok: true, value: wrap(service, result.value) } : result;
}
export function sameSharedBlock(
  left: SharedBlockStorage,
  right: SharedBlockStorage,
): boolean {
  return left.engineId === right.engineId && left.blockId === right.blockId;
}
export function sharedStorageLength(
  storage: SharedBlockStorage,
  order: SharedOrder,
): SharedResult<number> {
  if (!validOrder(order)) return { ok: false, error: "invalid-order" };
  return storage.service.length(storage.handle, order);
}
export function growSharedStorage(
  storage: SharedBlockStorage,
  target: number,
): SharedStatus {
  if (!storage.growable) return "fixed-length";
  if (!validLength(target) || target > storage.maxByteLength)
    return "invalid-length";
  // The service must compare against its current length inside atomic publication.
  return storage.service.grow(storage.handle, target);
}
export interface SharedStorageWindow {
  readonly storage: SharedBlockStorage;
  readonly byteOffset: number;
  /** Captured total block byte length, not a promise that later reads agree. */
  readonly byteLength: number;
  /** Element count in this fixed or length-tracking view. */
  readonly length: number;
}
/** Capture length exactly once after callers finish observable coercions/hooks.
 * Keep the returned witness for this operation; reacquire after callbacks. No
 * byte array escapes, and a witness does not promise a multi-access snapshot. */
export function sharedStorageWindow(
  storage: SharedBlockStorage,
  byteOffset: number,
  fixedLength: number | undefined,
  elementBytes: number,
  order: SharedOrder,
): SharedResult<SharedStorageWindow> {
  if (
    !validLength(byteOffset) ||
    !validLength(elementBytes) ||
    elementBytes === 0 ||
    (fixedLength !== undefined && !validLength(fixedLength))
  )
    return { ok: false, error: "invalid-range" };
  if (byteOffset % elementBytes !== 0) return { ok: false, error: "unaligned" };
  const current = sharedStorageLength(storage, order);
  if (!current.ok) return current;
  if (byteOffset > current.value) return { ok: false, error: "invalid-range" };
  const available = Math.floor((current.value - byteOffset) / elementBytes);
  if (fixedLength !== undefined && fixedLength > available)
    return { ok: false, error: "invalid-range" };
  return {
    ok: true,
    value: {
      storage,
      byteOffset,
      byteLength: current.value,
      length: fixedLength === undefined ? available : fixedLength,
    },
  };
}
function accessError(
  offset: number,
  width: number,
  order: SharedOrder,
): SharedStatus {
  if (!validOrder(order)) return "invalid-order";
  if (width !== 1 && width !== 2 && width !== 4 && width !== 8)
    return "invalid-width";
  if (!validLength(offset)) return "invalid-range";
  return offset % width === 0 ? "none" : "unaligned";
}
/** Byte-oriented copies/codecs/DataView use explicit byte accesses, including
 * unaligned locations. Integer elements use the width-aware operations below. */
export function readSharedByte(
  storage: SharedBlockStorage,
  offset: number,
): SharedResult<number> {
  return readSharedUnsigned(storage, offset, 1, "unordered");
}
export function writeSharedByte(
  storage: SharedBlockStorage,
  offset: number,
  value: number,
): SharedStatus {
  return writeSharedUnsigned(storage, offset, 1, value, "unordered");
}
export function readSharedUnsigned(
  storage: SharedBlockStorage,
  offset: number,
  width: SharedUnsignedWidth,
  order: SharedOrder,
): SharedResult<number> {
  const error: SharedStatus =
    width !== 1 && width !== 2 && width !== 4
      ? "invalid-width"
      : accessError(offset, width, order);
  if (error !== "none") return { ok: false, error };
  return storage.service.readUnsigned(storage.handle, offset, width, order);
}
export function writeSharedUnsigned(
  storage: SharedBlockStorage,
  offset: number,
  width: SharedUnsignedWidth,
  value: number,
  order: SharedOrder,
): SharedStatus {
  const error: SharedStatus =
    width !== 1 && width !== 2 && width !== 4
      ? "invalid-width"
      : accessError(offset, width, order);
  if (error !== "none") return error;
  const maximum = width === 1 ? 255 : width === 2 ? 65535 : 4294967295;
  if (!validLength(value) || value > maximum) return "invalid-value";
  return storage.service.writeUnsigned(
    storage.handle,
    offset,
    width,
    value,
    order,
  );
}
export function readSharedWord64(
  storage: SharedBlockStorage,
  offset: number,
  order: SharedOrder,
): SharedResult<Word64> {
  const error = accessError(offset, 8, order);
  if (error !== "none") return { ok: false, error };
  const scratch = new Uint32Array(2);
  const status = storage.service.readWord64(
    storage.handle,
    offset,
    order,
    scratch,
  );
  if (status !== "none") return { ok: false, error: status };
  const lo = scratch[0],
    hi = scratch[1];
  if (lo === undefined || hi === undefined)
    throw "SHARED_WORD_SCRATCH_INVARIANT";
  return { ok: true, value: { lo, hi } };
}
export function writeSharedWord64(
  storage: SharedBlockStorage,
  offset: number,
  value: Word64,
  order: SharedOrder,
): SharedStatus {
  const error = accessError(offset, 8, order);
  if (error !== "none") return error;
  const word = fromParts(value.lo, value.hi);
  if (!word.ok) return "invalid-value";
  return storage.service.writeWord64(
    storage.handle,
    offset,
    order,
    word.value.lo,
    word.value.hi,
  );
}
