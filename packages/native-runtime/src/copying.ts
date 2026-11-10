import { initializeExternalMemory } from "./external-memory.ts";
import { createCheneyCollector } from "./tracing/cheney.ts";
import {
  currentRootHead,
  configureLinearAllocation,
  engineRangeError,
} from "./intrinsics/memory.ts";
/** Transitional stop-the-world two-space runtime. It collects the whole managed
 * graph, without extent descriptors or inventory sorting. No generational barrier
 * is needed until a separately retained old generation is introduced. Startup
 * retains its existing ABI; collector arrays are partitioned into exclusive views.
 * All setup allocations use permanent control storage. */
/** Thrown when the managed heap stays full after collection. A runtime
 * closure is a value no JavaScript program can produce (Script functions are
 * ordinary objects), so catch boundaries recognise this engine abort by kind
 * and a Script throwing any string or object is unaffected. Created when the
 * module initializes, so throwing it never allocates. */
const managedHeapExhausted: () => void = (): void => {};
export function initializeCopyingRuntime(
  managedBase: number,
  managedLength: number,
  controlBase: number,
  controlLength: number,
  imageBase: number,
  imageLength: number,
  stackBase: number,
  stackLength: number,
  metadata: Uint32Array,
  offsets: Uint32Array,
  sizes: Uint32Array,
  starts: Float64Array,
  marks: Uint8Array,
  pending: Uint32Array,
  roots: Float64Array,
): (bytes: number) => number | undefined {
  const capacity = Math.floor(managedLength / 32) * 16,
    units = capacity / 16,
    words = Math.ceil(units / 32);
  const fixupCapacity = Math.floor(starts.length / 2);
  if (
    !Number.isSafeInteger(managedBase) ||
    managedBase <= 0 ||
    managedBase % 16 !== 0 ||
    !Number.isSafeInteger(managedBase + managedLength) ||
    capacity < 16 ||
    metadata.length < units + words ||
    fixupCapacity < 1
  )
    throw "INVALID_COPYING_WORKSPACE";
  const bits = metadata.subarray(units, units + words),
    allocation = new Uint32Array(8);
  allocation[1] = capacity;
  let reverse = false,
    collecting = false;
  initializeExternalMemory(
    managedBase,
    managedLength,
    controlBase,
    controlLength,
    imageBase,
    imageLength,
    stackBase,
    stackLength,
  );
  // Collections copy the active semispace into the other one in a single
  // Cheney pass; a semispace always holds everything the active one holds.
  const heap = createCheneyCollector(managedBase, managedLength);
  if (configureLinearAllocation(allocation, bits) !== 0)
    throw "INVALID_LINEAR_ALLOCATION_STATE";
  // Exhaustion throws, so compiled callers unwind through their exceptional
  // edges (an embedded compilation fails instead of trapping). Reentrant or
  // malformed requests remain invariant failures (undefined traps).
  function collect(top: number): void {
    collecting = true;
    const source = managedBase + (reverse ? capacity : 0),
      destination = managedBase + (reverse ? 0 : capacity);
    // Start bits are relative to the active space; clear the used prefix and
    // let the evacuation describe the packed destination.
    bits.fill(0, 0, Math.ceil(top / 512));
    const bytes = heap.collect(
      source,
      top,
      destination,
      0,
      capacity,
      currentRootHead(),
      bits,
      destination,
      undefined,
    );
    allocation[0] = bytes;
    reverse = !reverse;
    allocation[2] = reverse ? capacity : 0;
    collecting = false;
  }
  // Request size 0 is reserved for a forced full collection (the Test262
  // host's $262.gc); it returns +0 and allocates nothing.
  return (bytes) => {
    let top = allocation[0] ?? 0;
    if (bytes === 0 && !collecting) {
      collect(top);
      return 0;
    }
    if (collecting || !Number.isInteger(bytes) || bytes <= 0) return undefined;
    // No collection can make room for this request (an impossible string
    // length lands here too): a catchable RangeError, not an engine abort.
    if (bytes > capacity) throw engineRangeError();
    const size = Math.ceil(bytes / 16) * 16;
    if (size > capacity - top) {
      collect(top);
      top = allocation[0] ?? 0;
      if (size > capacity - top) {
        roots[0] = 2;
        roots[1] = top;
        roots[2] = size;
        throw managedHeapExhausted;
      }
    }
    const offset = top,
      unit = offset / 16,
      word = unit >>> 5;
    bits[word] = (bits[word] ?? 0) | (1 << (unit & 31));
    allocation[0] = top + size;
    return (reverse ? capacity : 0) + offset;
  };
}
