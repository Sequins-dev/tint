import { initializeExternalMemory } from "./external-memory.ts";
import { createNurseryEvacuator } from "./tracing/index.ts";
import {
  readMemoryWord,
  writeMemoryWord,
  moveMemory,
  currentRootHead,
  configureLinearAllocation,
} from "./intrinsics/memory.ts";
function contains(base: number, length: number, address: number): boolean {
  return address >= base && address - base <= length - 8;
}
/** Transitional stop-the-world two-space runtime. It collects the whole managed
 * graph, without extent descriptors or inventory sorting. No generational barrier
 * is needed until a separately retained old generation is introduced. Startup
 * retains its existing ABI; collector arrays are partitioned into exclusive views.
 * All setup allocations use permanent control storage. */
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
  const forwarding = metadata.subarray(0, units),
    bits = metadata.subarray(units, units + words),
    slots = starts.subarray(0, fixupCapacity),
    values = starts.subarray(fixupCapacity, fixupCapacity * 2),
    summary = new Uint32Array(3),
    allocation = new Uint32Array(8);
  allocation[1] = capacity;
  let reverse = false,
    collecting = false;
  const external = initializeExternalMemory(
    managedBase,
    managedLength,
    controlBase,
    controlLength,
    imageBase,
    imageLength,
    stackBase,
    stackLength,
  );
  const collector = createNurseryEvacuator({
    base: managedBase,
    byteLength: capacity,
    targetBase: managedBase + capacity,
    targetLength: capacity,
    starts: bits,
    forwarding,
    sources: offsets,
    sizes,
    destinations: pending,
    slots,
    values,
    summary,
    maxSteps: 0xffffffff,
    isExternal: (address) =>
      contains(controlBase, controlLength, address) ||
      contains(imageBase, imageLength, address) ||
      external.contains(address, 8),
    scanRemembered: (visit) => true,
    read: (address) => {
      if (!(
        contains(managedBase, managedLength, address) ||
        contains(controlBase, controlLength, address) ||
        contains(imageBase, imageLength, address) ||
        contains(stackBase, stackLength, address) ||
        external.contains(address, 8)
      ))
        return undefined;
      // Containment authorizes this eight-byte subwindow. Constant extent/offset
      // let codegen discharge their validation; address/word checks remain.
      const value = readMemoryWord(address, 8, 0);
      return value < 0 ? undefined : value;
    },
    canWrite: (slot) =>
      contains(managedBase, managedLength, slot) ||
      contains(stackBase, stackLength, slot),
    copy: (destination, source, size) =>
      moveMemory(
        managedBase,
        managedLength,
        destination - managedBase,
        source - managedBase,
        size,
      ) === 0,
    write: (slot, value) =>
      contains(managedBase, managedLength, slot)
        ? writeMemoryWord(
            managedBase,
            managedLength,
            slot - managedBase,
            value,
          ) === 0
        : writeMemoryWord(stackBase, stackLength, slot - stackBase, value) ===
          0,
    publish: (count, bytes) => {
      // Clear only the previously used start-bit prefix, then describe the packed
      // destination. No per-dead-object scan or descriptor reconstruction occurs.
      bits.fill(0, 0, Math.ceil((allocation[0] ?? 0) / 512));
      for (let i = 0; i < count; i++) {
        const destination = pending[i];
        if (destination === undefined) return false;
        const unit = destination / 16,
          word = unit >>> 5;
        bits[word] = (bits[word] ?? 0) | (1 << (unit & 31));
      }
      allocation[0] = bytes;
      reverse = !reverse;
      allocation[2] = reverse ? capacity : 0;
      return true;
    },
  });
  if (collector === undefined) throw "INVALID_COPYING_HEAP";
  const heap = collector;
  if (configureLinearAllocation(allocation, bits) !== 0)
    throw "INVALID_LINEAR_ALLOCATION_STATE";
  // Exhaustion throws, so compiled callers unwind through their exceptional
  // edges (an embedded compilation fails instead of trapping). Reentrant or
  // malformed requests remain invariant failures (undefined traps).
  return (bytes) => {
    let top = allocation[0] ?? 0;
    if (collecting || !Number.isInteger(bytes) || bytes <= 0) return undefined;
    if (bytes > capacity) throw "MANAGED_HEAP_EXHAUSTED";
    const size = Math.ceil(bytes / 16) * 16;
    if (size > capacity - top) {
      collecting = true;
      if (!heap.prepare(top, currentRootHead(), reverse)) {
        roots[0] = 1;
        roots[1] = top;
        roots[2] = size;
        roots[3] = fixupCapacity;
        roots[4] = summary[0] ?? 0;
        roots[5] = summary[1] ?? 0;
        roots[6] = summary[2] ?? 0;
        collecting = false;
        throw "MANAGED_HEAP_EXHAUSTED";
      }
      if (!heap.commit()) throw "COPYING_COMMIT_FAILED";
      collecting = false;
      top = allocation[0] ?? 0;
      if (size > capacity - top) {
        roots[0] = 2;
        roots[1] = top;
        roots[2] = size;
        throw "MANAGED_HEAP_EXHAUSTED";
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
