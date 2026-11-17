/** `tint:ffi/collected`: collector-registered external storage
 * (docs/native-ffi.md, "External storage"). Each view carries a weak cell;
 * storage whose view died is unmapped by the next sweep, and external
 * memory pressure (mapped bytes passing twice the level after the last
 * forced collection, at least 64 MiB) forces a collection first.
 * `release` (from `tint:ffi`) frees it earlier.
 * KNOWN DEFECT (collector gap, docs/native-ffi.md#known-defects): weak
 * cells need the copying or region collectors (the generational emitter
 * rejects them), so this module compiles only there; `allocate` from
 * `tint:ffi` works with every collector. */
import {
  adoptMapping,
  externalBytes,
  liveExternal,
  mapExternal,
  unmapExternal,
} from "./index.ts";
import { createWeakSlot, weakSlotKey } from "../intrinsics/weak.ts";
import { collectGarbage } from "../intrinsics/memory.ts";

/** Registered mappings (addresses with a weak cell on each view), the
 * byte level that forces a collection and the count that starts a sweep. */
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
