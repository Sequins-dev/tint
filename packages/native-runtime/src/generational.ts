import { initializeExternalMemory } from "./external-memory.ts";
import { createCheneyCollector } from "./tracing/cheney.ts";
import { createParallelEvacuator } from "./tracing/parallel.ts";
import {
  currentRootHead,
  configureGenerationalAllocation,
  engineRangeError,
} from "./intrinsics/memory.ts";
/** Stop-the-world nursery promotion with a packed old prefix. Collector workspaces
 * and remembered metadata are permanent; application stores use emitted barriers.
 * Requires compiler-verified immutable object/root descriptors and an emitted
 * managed mutator with no raw-memory writes or external header mutation. The
 * generational emitter gate enforces the mutator side of this contract. */
/** Thrown when the managed heap stays full after collection. A runtime
 * closure is a value no JavaScript program can produce (Script functions are
 * ordinary objects), so catch boundaries recognise this engine abort by kind
 * and a Script throwing any string or object is unaffected. Created when the
 * module initializes, so throwing it never allocates. */
const managedHeapExhausted: () => void = (): void => {};
/** Collector threads, including the mutator's own. */
const parallelWorkers = 6;
/** Source bytes below which a collection stays serial. */
const parallelMinimum = 4194304;
export function initializeGenerationalRuntime(
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
  const capacity = Math.floor(managedLength / 1024) * 512,
    youngCapacity = Math.min(
      // A larger nursery amortizes root/remembered-set scans and lets more
      // objects die young, but every byte of it is taken from the old prefix
      // (majors are whole-space copies). With parallel collection, frozen v2
      // cycles: 64 MiB 226.7G, 128 MiB 225.8G, 256 MiB 219.7G, 512 MiB
      // 227.6G (peak RSS 4.25, 4.08, 3.87, 3.37 GB). Small heaps keep a
      // quarter of a semispace.
      268435456,
      Math.max(512, Math.floor(capacity / 2048) * 512),
    ),
    oldCapacity = capacity - youngCapacity,
    units = capacity / 16,
    words = Math.ceil(units / 32),
    fixupCapacity = Math.floor(starts.length / 2);
  if (
    !Number.isSafeInteger(managedBase) ||
    managedBase <= 0 ||
    managedBase % 16 !== 0 ||
    !Number.isSafeInteger(managedBase + managedLength) ||
    capacity > 0x7ffffff0 ||
    oldCapacity < 512 ||
    metadata.length < units + words ||
    marks.length < Math.ceil(oldCapacity / 128) ||
    roots.length < 1 ||
    fixupCapacity < 1
  )
    throw "INVALID_GENERATIONAL_WORKSPACE";
  const bits = metadata.subarray(units, units + words),
    youngBits = bits.subarray(oldCapacity / 512),
    dirty = marks.subarray(0, Math.ceil(oldCapacity / 128)),
    allocation = new Uint32Array(16);
  allocation[1] = youngCapacity;
  allocation[2] = oldCapacity;
  allocation[7] = oldCapacity;
  let reverse = false,
    collecting = false;
  function activeBase(): number {
    return managedBase + (reverse ? capacity : 0);
  }
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
  function oldStart(address: number): boolean {
    const offset = address - activeBase();
    if (offset < 0 || offset % 16 !== 0 || offset >= (allocation[3] ?? 0))
      return false;
    const unit = offset / 16;
    return ((bits[unit >>> 5] ?? 0) & (1 << (unit & 31))) !== 0;
  }
  function remember(offset: number): void {
    const byte = offset >>> 7,
      bit = 1 << ((offset >>> 4) & 7),
      current = dirty[byte] ?? 0;
    if ((current & bit) !== 0) return;
    dirty[byte] = current | bit;
    const count = allocation[12] ?? 0;
    if (count >= roots.length) allocation[14] = 1;
    else {
      roots[count] = offset;
      allocation[12] = count + 1;
    }
  }
  function clearRemembered(): void {
    if ((allocation[14] ?? 0) !== 0) dirty.fill(0);
    else
      for (let i = 0; i < (allocation[12] ?? 0); i++) {
        const offset = roots[i];
        if (offset !== undefined) dirty[offset >>> 7] = 0;
      }
    allocation[12] = 0;
    allocation[14] = 0;
  }
  const heap = createCheneyCollector(managedBase, managedLength);
  // Pool evacuation for collections large enough to repay waking workers;
  // smaller ones, and any the pool cannot fit with LAB waste, stay serial.
  const parallel = createParallelEvacuator(
    managedBase,
    managedLength,
    parallelWorkers,
    bits,
    roots,
    dirty,
  );
  // Survivors of a major collection that no longer fit the old prefix would
  // overlap the nursery: the heap is then exhausted for good, and the young
  // window is published full so inline allocation reaches the abort too.
  let exhausted = false;
  // A value created once at setup: a collection must not allocate.
  const rememberedObjects = (scan: (address: number) => void): void => {
    if ((allocation[14] ?? 0) !== 0) {
      const end = Math.ceil((allocation[3] ?? 0) / 128);
      for (let byte = 0; byte < end; byte++) {
        const flags = dirty[byte] ?? 0;
        if (flags !== 0)
          for (let bit = 0; bit < 8; bit++)
            if ((flags & (1 << bit)) !== 0) {
              const address = activeBase() + byte * 128 + bit * 16;
              if (oldStart(address)) scan(address);
            }
      }
    } else
      for (let i = 0; i < (allocation[12] ?? 0); i++) {
        const offset = roots[i];
        if (offset === undefined) throw "GENERATIONAL_REMEMBERED";
        const address = activeBase() + offset;
        if (!oldStart(address)) throw "GENERATIONAL_REMEMBERED";
        scan(address);
      }
  };
  if (
    configureGenerationalAllocation(allocation, youngBits, dirty, roots) !== 0
  )
    throw "INVALID_GENERATIONAL_STATE";
  function collect(forceMajor: boolean): boolean {
    if (exhausted) return false;
    const youngTop = allocation[0] ?? 0,
      oldTop = allocation[3] ?? 0;
    const minor =
      !forceMajor && youngTop > 0 && youngTop <= oldCapacity - oldTop;
    collecting = true;
    const base = activeBase();
    if (minor) {
      // The nursery is evacuated into the old prefix, which has room for all
      // of it; remembered old objects are the only old-to-young edges.
      const top =
        parallel !== undefined && youngTop >= parallelMinimum
          ? parallel.collect(
              base + oldCapacity,
              youngTop,
              base,
              oldTop,
              oldCapacity,
              youngTop,
              currentRootHead(),
              base,
              true,
              (allocation[14] ?? 0) !== 0 ? -1 : (allocation[12] ?? 0),
              oldTop,
            )
          : -1;
      const bytes =
        top >= 0
          ? top - oldTop
          : heap.collect(
              base + oldCapacity,
              youngTop,
              base,
              oldTop,
              oldCapacity,
              currentRootHead(),
              bits,
              base,
              rememberedObjects,
            );
      youngBits.fill(0, 0, Math.ceil(youngTop / 512));
      allocation[3] = oldTop + bytes;
    } else {
      const used = youngTop > 0 ? oldCapacity + youngTop : oldTop,
        destination = managedBase + (reverse ? 0 : capacity);
      // Start bits are relative to the active space; the destination becomes
      // the active space, so clear them and let the evacuation set its own.
      bits.fill(0, 0, Math.ceil(used / 512));
      const top =
        parallel !== undefined && used >= parallelMinimum
          ? parallel.collect(
              base,
              used,
              destination,
              0,
              capacity,
              // Survivors beyond the old prefix exhaust the heap anyway.
              oldCapacity,
              currentRootHead(),
              destination,
              false,
              0,
              0,
            )
          : -1;
      const bytes =
        top >= 0
          ? top
          : heap.collect(
              base,
              used,
              destination,
              0,
              capacity,
              currentRootHead(),
              bits,
              destination,
              undefined,
            );
      reverse = !reverse;
      allocation[3] = bytes;
      if (bytes > oldCapacity) exhausted = true;
    }
    allocation[0] = exhausted ? youngCapacity : 0;
    allocation[2] = (reverse ? capacity : 0) + oldCapacity;
    clearRemembered();
    collecting = false;
    return !exhausted;
  }
  // Exhaustion throws, so compiled callers unwind through their exceptional
  // edges (an embedded compilation fails instead of trapping). Reentrant or
  // malformed requests remain invariant failures (undefined traps).
  // Request size 0 is reserved for a forced full collection (the Test262
  // host's $262.gc); it returns +0 and allocates nothing.
  return (bytes) => {
    if (bytes === 0 && !collecting) {
      if (!collect(true)) throw managedHeapExhausted;
      return 0;
    }
    if (collecting || !Number.isInteger(bytes) || bytes <= 0) return undefined;
    // No collection can make room for this request (an impossible string
    // length lands here too): a catchable RangeError, not an engine abort.
    if (bytes > oldCapacity) throw engineRangeError();
    const size = Math.ceil(bytes / 16) * 16;
    if (size >= Math.max(128, youngCapacity / 4)) {
      if (size > oldCapacity - (allocation[3] ?? 0) && !collect(true))
        throw managedHeapExhausted;
      const top = allocation[3] ?? 0;
      if (size > oldCapacity - top) throw managedHeapExhausted;
      const unit = top / 16,
        word = unit >>> 5;
      bits[word] = (bits[word] ?? 0) | (1 << (unit & 31));
      allocation[3] = top + size;
      // Constructor stores need no separate barrier: every directly old allocation
      // is remembered before initialization, which has no intervening safepoint.
      remember(top);
      return (reverse ? capacity : 0) + top;
    }
    if (size > youngCapacity - (allocation[0] ?? 0) && !collect(false))
      throw managedHeapExhausted;
    const top = allocation[0] ?? 0;
    if (size > youngCapacity - top) throw managedHeapExhausted;
    const unit = (oldCapacity + top) / 16,
      word = unit >>> 5;
    bits[word] = (bits[word] ?? 0) | (1 << (unit & 31));
    allocation[0] = top + size;
    return (reverse ? capacity : 0) + oldCapacity + top;
  };
}
