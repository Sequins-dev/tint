/** `tint:ffi` external storage (docs/native-ffi.md, "External storage").
 *
 * External storage is a byte view (a borrowed-kind Uint8Array) over pages
 * mapped outside the managed heap. Collectors move the view object, never
 * its data, so C may retain the address across calls (zlib's `z_stream`
 * and its windows, I/O rings). Leaf calls still only borrow movable views.
 *
 * Lifetime: `release` unmaps the pages at once and points the view at one
 * shared inaccessible guard reservation (typed-array lengths never change,
 * so a dangling view must fault rather than reach freed or reused memory).
 * `allocate` storage has an explicit lifetime; `external` storage is also
 * freed by the collector: each view carries a weak cell, storage whose view
 * died is unmapped by the next sweep, and external memory pressure (mapped
 * bytes passing twice the level after the last forced collection, at least
 * 64 MiB) forces a collection first. Weak cells work under every collector. */
import {
  MAP_ANONYMOUS,
  MAP_PRIVATE,
  PROT_NONE,
  PROT_READ,
  PROT_WRITE,
  getpagesize,
  mmap,
  munmap,
} from "tint:c/memory";
import {
  adoptExternal,
  externalAddress,
  retargetExternal,
  stableBytes as stableArray,
  callbackKey,
} from "./primitives.ts";
import { pthread_setspecific } from "tint:c/dl";
import { bytesAt } from "./unsafe.ts";
import { createWeakSlot, weakSlotKey } from "../intrinsics/weak.ts";
import { collectGarbage } from "../intrinsics/memory.ts";

/** `View<R>` (docs/native-ffi.md, "C views"): the nominal C view of a
 * binding record R. Tint's checker resolves it from the binding's layout
 * (this alias body is never used); TypeScript callers get its member
 * typing from the `tint:ffi` declaration (src/c/ffi.d.ts). */
export type View<R> = Uint8Array;
/** Largest external view: typed-array lengths are 32-bit. */
const maximumBytes = 4294967295;
/** Anonymous private mappings: the flag values are the target's header
 * constants (tint:c/memory declares them per target). */
const anonymousPrivate: number = MAP_PRIVATE | MAP_ANONYMOUS;
/** External storage state: live mappings (address to mapped bytes;
 * released ones are removed), the mapped byte total, the inaccessible
 * reservation released views point at (0 until the first release) and the
 * kernel's page size, the mapping granule (0 until the first mapping). */
interface Storage {
  readonly mappings: Map<number, number>;
  liveBytes: number;
  guard: number;
  pageBytes: number;
}
const storage: Storage = {
  mappings: new Map<number, number>(),
  liveBytes: 0,
  guard: 0,
  pageBytes: 0,
};

/** Whole pages covering `byteLength` bytes (at least one). */
function pagesOf(byteLength: number): number {
  if (storage.pageBytes === 0) storage.pageBytes = getpagesize();
  const page = storage.pageBytes;
  return Math.max(page, Math.ceil(byteLength / page) * page);
}
/** Map zero-filled pages for `byteLength` bytes (at least one page); the
 * address, or -1 when the system refuses. */
export function mapExternal(byteLength: number): number {
  if (
    !Number.isSafeInteger(byteLength) ||
    byteLength < 0 ||
    byteLength > maximumBytes
  )
    throw new RangeError("invalid external storage byte length");
  const pages = pagesOf(byteLength);
  const address = mmap(
    0,
    pages,
    PROT_READ | PROT_WRITE,
    anonymousPrivate,
    -1,
    0,
  );
  if (address < 0) return -1;
  storage.liveBytes += pages;
  storage.mappings.set(address, pages);
  return address;
}
/** Unmap live mapping `address`. */
export function unmapExternal(address: number): void {
  const pages = storage.mappings.get(address);
  if (pages === undefined) throw "external storage mapping invariant";
  storage.mappings.delete(address);
  storage.liveBytes -= pages;
  if (munmap(address, pages) !== 0)
    throw new RangeError("external storage unmap failed");
}
/** Whether `address` is a live mapping (not released or unmapped). */
export function liveExternal(address: number): boolean {
  return storage.mappings.has(address);
}
/** Mapped bytes not yet released. */
export function externalBytes(): number {
  return storage.liveBytes;
}
/** An external view of a fresh mapping of `byteLength` bytes at
 * `address` (from mapExternal). */
export function adoptMapping(address: number, byteLength: number): Uint8Array {
  return adoptExternal(new Uint8Array(0), address, byteLength);
}
export function allocate(byteLength: number): Uint8Array {
  const address = mapExternal(byteLength);
  if (address < 0) throw new RangeError("external storage exhausted");
  return adoptMapping(address, byteLength);
}
/** The address of live external storage `view`. */
function liveAddress(view: Uint8Array): number {
  const address = externalAddress(view);
  if (address < 0 || !storage.mappings.has(address))
    throw new TypeError("not live external storage");
  return address;
}
export function release(view: Uint8Array): void {
  const address = liveAddress(view);
  retargetExternal(view, callbackGuard());
  unmapExternal(address);
}
/** An inaccessible address range at least maximumBytes long, reserved once:
 * released views and idle callback views point there, so any access
 * through them faults. */
export function callbackGuard(): number {
  if (storage.guard === 0) {
    const reserved = mmap(
      0,
      maximumBytes + 1,
      PROT_NONE,
      anonymousPrivate,
      -1,
      0,
    );
    if (reserved < 0) throw new RangeError("external storage guard failed");
    storage.guard = reserved;
  }
  return storage.guard;
}
/** Callback views (docs/native-ffi.md, "Callbacks"): a generated adapter
 * makes one foreign view per `Ptr<R>` callback parameter and points it at
 * C's record for each invocation and at `callbackGuard()` after it with
 * this primitive (one inline retarget, no call). */
export { retargetExternal as retargetCallbackView };
export function address(view: Uint8Array): number {
  return liveAddress(view);
}
/** Collector-registered mappings (addresses with a weak cell on each view),
 * the byte level that forces a collection and the count that starts a
 * sweep. */
interface Registry {
  addresses: number[];
  cells: unknown[];
  collectAt: number;
  sweepAt: number;
}
const registry: Registry = {
  addresses: [],
  cells: [],
  collectAt: 67108864,
  sweepAt: 1024,
};
/** Unmap registered storage whose view died (after a forced collection
 * when `collect`), forgetting released entries. */
function sweep(collect: boolean): void {
  if (collect) collectGarbage();
  const addresses: number[] = [],
    cells: unknown[] = [];
  for (let index = 0; index < registry.addresses.length; index++) {
    const address = registry.addresses[index],
      cell = registry.cells[index];
    if (address === undefined) throw "external storage registry invariant";
    if (!liveExternal(address)) continue;
    if (weakSlotKey(cell) === undefined) unmapExternal(address);
    else {
      addresses.push(address);
      cells.push(cell);
    }
  }
  registry.addresses = addresses;
  registry.cells = cells;
  registry.sweepAt = Math.max(1024, addresses.length * 2);
  if (collect) registry.collectAt = Math.max(67108864, externalBytes() * 2);
}
export function external(byteLength: number): Uint8Array {
  if (externalBytes() + byteLength > registry.collectAt) sweep(true);
  else if (registry.addresses.length >= registry.sweepAt) sweep(false);
  let address = mapExternal(byteLength);
  if (address < 0) {
    sweep(true);
    address = mapExternal(byteLength);
  }
  if (address < 0) throw new RangeError("external storage exhausted");
  const view = adoptMapping(address, byteLength);
  registry.addresses.push(address);
  registry.cells.push(createWeakSlot(view, undefined, false));
  return view;
}
/** Callback state for may-callback calls (docs/native-ffi.md, "Callbacks"):
 * the calling mutator's state block, whose first word is the innermost
 * transition record (0: no may-callback call is running). It is external
 * storage, so callback thunks read it at a fixed address; one block per
 * runtime instance (each mutator has its own module instances), never
 * released. */
interface CallbackState {
  block: Uint8Array | undefined;
}
const callbacks: CallbackState = { block: undefined };
export function callbackState(): Uint8Array {
  const known = callbacks.block;
  if (known !== undefined) return known;
  const block = allocate(16);
  // Thunks find it under the image's key (created at startup), on this
  // thread only: a callback on another thread finds none and traps.
  const word = bytesAt(callbackKey(), 8);
  let key = 0;
  for (let index = 7; index >= 0; index--) key = key * 256 + (word[index] ?? 0);
  if (pthread_setspecific(key, address(block)) !== 0)
    throw new RangeError("callback state registration failed");
  callbacks.block = block;
  return block;
}
/** Whether `view`'s data never moves (external storage or foreign memory):
 * only such data may stay reachable from C across a may-callback call,
 * during which collections run. */
export function stableBytes(view: Uint8Array): boolean {
  return stableArray(view);
}
/** Registered callbacks (docs/native-ffi.md, "Callbacks"): TypeScript
 * functions C keeps a pointer to and calls during later may-callback calls
 * (zlib's allocator). Each is an adapter taking up to seven numbers; its
 * C function pointer is a registered thunk for its id (`registeredCallbacks`
 * ids at a time), which calls the dispatcher every may-callback call
 * passes. What a registered callback throws is rethrown when the
 * may-callback call that ran it returns; C gets 0. */
export type RegisteredCallback = (
  a0: number,
  a1: number,
  a2: number,
  a3: number,
  a4: number,
  a5: number,
  a6: number,
) => number;
export type CallbackDispatcher = (
  id: number,
  a0: number,
  a1: number,
  a2: number,
  a3: number,
  a4: number,
  a5: number,
  a6: number,
) => number;
/** How many registered callbacks may exist at once (per mutator). */
export const registeredCallbacks = 16;
interface CallbackRegistry {
  readonly functions: (RegisteredCallback | undefined)[];
  readonly addresses: number[];
  failed: boolean;
  error: unknown;
  dispatcher: CallbackDispatcher | undefined;
}
const registry$: CallbackRegistry = {
  functions: [],
  addresses: [],
  failed: false,
  error: undefined,
  dispatcher: undefined,
};
/** Register `fn`; its id (its thunk address is noted by `noteCallback`). */
export function registerCallback(fn: RegisteredCallback): number {
  const functions = registry$.functions;
  while (functions.length < registeredCallbacks) {
    functions.push(undefined);
    registry$.addresses.push(0);
  }
  for (let id = 0; id < registeredCallbacks; id++)
    if (functions[id] === undefined) {
      functions[id] = fn;
      return id;
    }
  throw new RangeError("too many registered callbacks");
}
/** Record registered callback `id`'s C function pointer. */
export function noteCallback(id: number, address: number): void {
  registry$.addresses[id] = address;
}
/** Unregister the callback whose C function pointer is `address`; C must
 * not call it afterwards (it would reach whatever reuses the id). */
export function releaseCallback(address: number): void {
  const addresses = registry$.addresses;
  for (let id = 0; id < addresses.length; id++)
    if (addresses[id] === address && registry$.functions[id] !== undefined) {
      registry$.functions[id] = undefined;
      addresses[id] = 0;
      return;
    }
  throw new TypeError("not a registered callback");
}
/** The dispatcher may-callback calls pass for registered thunks. */
export function callbackDispatcher(): CallbackDispatcher {
  const known = registry$.dispatcher;
  if (known !== undefined) return known;
  const dispatcher = (
    id: number,
    a0: number,
    a1: number,
    a2: number,
    a3: number,
    a4: number,
    a5: number,
    a6: number,
  ): number => {
    if (registry$.failed) return 0;
    const fn = registry$.functions[id];
    if (fn === undefined) return 0;
    try {
      return fn(a0, a1, a2, a3, a4, a5, a6);
    } catch (error) {
      registry$.failed = true;
      registry$.error = error;
      return 0;
    }
  };
  registry$.dispatcher = dispatcher;
  return dispatcher;
}
/** Rethrow what a registered callback raised during the may-callback call
 * that just returned. */
export function rethrowCallbackFailure(): void {
  if (!registry$.failed) return;
  const error = registry$.error;
  registry$.failed = false;
  registry$.error = undefined;
  throw error;
}
