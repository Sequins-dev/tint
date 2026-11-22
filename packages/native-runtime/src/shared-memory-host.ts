import { mapMemory, unmapMemory } from "./intrinsics/memory.ts";
import {
  readSharedUnsigned,
  writeSharedUnsigned,
  readSharedWord64,
  writeSharedWord64,
  compareExchangeSharedWord64,
  compareExchangeSharedUnsigned,
} from "./intrinsics/shared-atomics.ts";

/** Explicit trusted leaves. Calls cannot allocate managed objects, throw, invoke
 * callbacks or reenter this registry. map/unmap return failures as numeric status.
 * The owner supplies the real normal-memory page size and owns every successful
 * registry/payload mapping through engine/process lifetime. No collector grants. */
export interface NativeSharedMemoryHost {
  mapMemory(length: number): number;
  unmapMemory(address: number, length: number): number;
  readSharedUnsigned(
    address: number,
    length: number,
    offset: number,
    width: number,
    order: number,
  ): number;
  writeSharedUnsigned(
    address: number,
    length: number,
    offset: number,
    width: number,
    value: number,
    order: number,
  ): number;
  readSharedWord64(
    address: number,
    length: number,
    offset: number,
    order: number,
    scratch: Uint32Array,
  ): number;
  writeSharedWord64(
    address: number,
    length: number,
    offset: number,
    order: number,
    lo: number,
    hi: number,
  ): number;
  compareExchangeSharedWord64(
    address: number,
    length: number,
    offset: number,
    expectedLo: number,
    expectedHi: number,
    replacementLo: number,
    replacementHi: number,
    scratch: Uint32Array,
  ): number;
}
/** Independent optional capability. Availability on another host object never
 * grants this authority; the embedding passes it explicitly to create/attach. */
export interface NativeSharedAtomicMemoryHost {
  compareExchangeSharedUnsigned(
    address: number,
    length: number,
    offset: number,
    width: number,
    expected: number,
    replacement: number,
  ): number;
}
/** Requires its own explicit unsigned-CAS native binding. The base seven-leaf
 * factory and default project permissions are unchanged. */
export function nativeSharedAtomicMemoryHost(): NativeSharedAtomicMemoryHost {
  return {
    compareExchangeSharedUnsigned: (
      address,
      length,
      offset,
      width,
      expected,
      replacement,
    ): number =>
      compareExchangeSharedUnsigned(
        address,
        length,
        offset,
        width,
        expected,
        replacement,
      ),
  };
}
/** Selecting this host does not authorize its leaves. The embedding must declare
 * their runtime modules and all seven bindings in its native program request. */
export function nativeSharedMemoryHost(): NativeSharedMemoryHost {
  return {
    mapMemory: (length): number => mapMemory(length),
    unmapMemory: (address, length): number => unmapMemory(address, length),
    readSharedUnsigned: (address, length, offset, width, order): number =>
      readSharedUnsigned(address, length, offset, width, order),
    writeSharedUnsigned: (
      address,
      length,
      offset,
      width,
      value,
      order,
    ): number =>
      writeSharedUnsigned(address, length, offset, width, value, order),
    readSharedWord64: (address, length, offset, order, scratch): number =>
      readSharedWord64(address, length, offset, order, scratch),
    writeSharedWord64: (address, length, offset, order, lo, hi): number =>
      writeSharedWord64(address, length, offset, order, lo, hi),
    compareExchangeSharedWord64: (
      address,
      length,
      offset,
      expectedLo,
      expectedHi,
      replacementLo,
      replacementHi,
      scratch,
    ): number =>
      compareExchangeSharedWord64(
        address,
        length,
        offset,
        expectedLo,
        expectedHi,
        replacementLo,
        replacementHi,
        scratch,
      ),
  };
}
export interface NativeSharedBlockRegistry {
  readonly base: number;
  readonly byteLength: number;
  readonly engineId: number;
}
const PART = 4294967296;
export function integer(value: number): boolean {
  return (
    Number.isInteger(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER
  );
}
export function numberFromScratch(scratch: Uint32Array): number {
  const lo = scratch[0],
    hi = scratch[1];
  if (lo === undefined || hi === undefined || hi > 0x1fffff)
    throw "NATIVE_SHARED_METADATA_INVARIANT";
  // Only bounded metadata is numeric. Arbitrary payloads never use this helper.
  return hi * PART + lo;
}
export function readNumber(
  host: NativeSharedMemoryHost,
  registry: NativeSharedBlockRegistry,
  offset: number,
  scratch: Uint32Array,
  order: number = 1,
): number {
  if (
    host.readSharedWord64(
      registry.base,
      registry.byteLength,
      offset,
      order,
      scratch,
    ) !== 0
  )
    throw "NATIVE_SHARED_METADATA_READ";
  return numberFromScratch(scratch);
}
/** The word parking the registry locks use (NativeWaiterParkingHost). */
export interface NativeWordParking {
  park(address: number, expected: number, timeoutNanoseconds: number): number;
  wake(address: number, all?: boolean): number;
}
/** A registry lock word: 0 free, 1 held, 2 held with possible sleepers.
 * Uncontended acquire and release are one compare-exchange each; only a
 * release after a sleeper marked the word contended wakes the address. The
 * bounded park only guards against a lost wake. */
export function lockRegistryWord(
  host: NativeSharedMemoryHost,
  parking: NativeWordParking,
  registry: NativeSharedBlockRegistry,
  offset: number,
  scratch: Uint32Array,
): void {
  let state = compareNumber(host, registry, offset, 0, 1, scratch);
  while (state !== 0) {
    if (
      state === 2 ||
      compareNumber(host, registry, offset, 1, 2, scratch) !== 0
    )
      parking.park(registry.base + offset, 2, 1000000);
    state = compareNumber(host, registry, offset, 0, 2, scratch);
  }
}
export function unlockRegistryWord(
  host: NativeSharedMemoryHost,
  parking: NativeWordParking,
  registry: NativeSharedBlockRegistry,
  offset: number,
  scratch: Uint32Array,
): void {
  if (compareNumber(host, registry, offset, 1, 0, scratch) === 1) return;
  writeNumber(host, registry, offset, 0);
  parking.wake(registry.base + offset);
}
export function writeNumber(
  host: NativeSharedMemoryHost,
  registry: NativeSharedBlockRegistry,
  offset: number,
  value: number,
): void {
  if (
    !integer(value) ||
    host.writeSharedWord64(
      registry.base,
      registry.byteLength,
      offset,
      1,
      value % PART,
      Math.floor(value / PART),
    ) !== 0
  )
    throw "NATIVE_SHARED_METADATA_WRITE";
}
export function compareNumber(
  host: NativeSharedMemoryHost,
  registry: NativeSharedBlockRegistry,
  offset: number,
  expected: number,
  replacement: number,
  scratch: Uint32Array,
): number {
  if (
    host.compareExchangeSharedWord64(
      registry.base,
      registry.byteLength,
      offset,
      expected % PART,
      Math.floor(expected / PART),
      replacement % PART,
      Math.floor(replacement / PART),
      scratch,
    ) !== 0
  )
    throw "NATIVE_SHARED_METADATA_COMPARE";
  return numberFromScratch(scratch);
}
