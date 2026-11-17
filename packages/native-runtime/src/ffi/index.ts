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
} from "./primitives.ts";
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
  if (storage.guard === 0) {
    // Reserved once and never accessible: every view is at most
    // maximumBytes long, so any access through a released view faults.
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
  retargetExternal(view, storage.guard);
  unmapExternal(address);
}
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
