import {
  nativeAllocatorShutdownRequest,
  nativeAllocationDataRequest,
  nativeAllocationDataThresholdWord,
} from "@tint/abi/host";
import { initializeExternalMemory } from "./external-memory.ts";
import {
  createCheneyCollector,
  createCompactor,
  noLargeSpace,
  type LargeSpace,
} from "./tracing/cheney.ts";
import { createParallelEvacuator } from "./tracing/parallel.ts";
import { cgroupProcessorLimit } from "./processors.ts";
import {
  currentRootHead,
  configureGenerationalAllocation,
  engineRangeError,
  memoryPageBytes,
  permanentArrayAddress,
  processorCount,
  releaseMemory,
} from "./intrinsics/memory.ts";
/** Stop-the-world nursery promotion into a packed old prefix; majors compact
 * the whole space in place (mark-compact). Collections run only when the
 * heap's single mutator requests one, and never while it executes (parallel
 * workers only inside the stop-the-world pause): C leaf FFI calls rely on
 * it (docs/memory-and-lifetimes.md). Collector workspaces
 * and remembered metadata are permanent; application stores use emitted barriers.
 * Weak cells: every collector path defers weak slots, runs the ephemeron
 * fixpoint and clears dead keys of the slots it copies or marks (serially or
 * on the pool); remembered old slots are scanned strongly in minors, their
 * keys being old. Ephemeron value stores use the ordinary barrier.
 * Requires compiler-verified immutable object/root descriptors and an emitted
 * managed mutator with no raw-memory writes or external header mutation. The
 * generational emitter gate enforces the mutator side of this contract. */
/** Thrown when the managed heap stays full after collection. A runtime
 * closure is a value no JavaScript program can produce (Script functions are
 * ordinary objects), so catch boundaries recognise this engine abort by kind
 * and a Script throwing any string or object is unaffected. Created when the
 * module initializes, so throwing it never allocates. */
const managedHeapExhausted: () => void = (): void => {};
/** Most collector threads, including the mutator's own (tuned on six
 * performance cores; 8 or 9 measured no faster on a 9-CPU Linux VM, see
 * docs/native-performance-analysis.md); fewer when the process may use fewer
 * CPUs. */
const maximumParallelWorkers = 6;
/** Source bytes below which a collection stays serial. */
const parallelMinimum = 4194304;
/** Data allocations (strings and owned numeric typed arrays) of at least
 * this many bytes go to the large-object space: never copied by a minor
 * collection, and their chunks are reused once dead. */
const largeObjectThreshold = 262144;
/** Least bytes of one large-object granule (chunks are whole granules,
 * and whole pages where pages are larger). */
const largeGranuleMinimum = 16384;
/** The most bytes of dead young chunks before a minor collection, and of
 * warm free chunks kept for reuse: each also at most half the nursery. */
const largeYoungMaximum = 16777216;
/** Collector threads for `processors` CPUs the process may run on and a
 * CPU bandwidth limit of `limit` CPUs (0: unknown or none for either). One
 * CPU keeps collections serial. */
export function collectorWorkerCount(
  processors: number,
  limit: number,
): number {
  let workers: number = maximumParallelWorkers;
  if (processors > 0 && processors < workers) workers = processors;
  if (limit > 0 && limit < workers) workers = limit;
  return workers;
}
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
      // (measured when majors were whole-space copies). With parallel collection, frozen v2
      // cycles: 64 MiB 226.7G, 128 MiB 225.8G, 256 MiB 219.7G, 512 MiB
      // 227.6G (peak RSS 4.25, 4.08, 3.87, 3.37 GB). With evacuated halves
      // released, frozen v3 at 512 MiB: +7.5% cycles for 3.08 -> 2.67 GB
      // peak RSS; 128 MiB is slower and larger. Small heaps keep a quarter
      // of a semispace.
      268435456,
      Math.max(512, Math.floor(capacity / 2048) * 512),
    ),
    oldCapacity = capacity - youngCapacity,
    // One start bit per 8-byte allocation granule.
    units = capacity / 8,
    words = Math.ceil(units / 32),
    fixupCapacity = Math.floor(starts.length / 2);
  if (
    !Number.isSafeInteger(managedBase) ||
    managedBase <= 0 ||
    managedBase % 16 !== 0 ||
    !Number.isSafeInteger(managedBase + managedLength) ||
    capacity > 0x7ffffff0 ||
    oldCapacity < 512 ||
    // Start bits, then the compactor's live bits and chunk offsets.
    metadata.length < 3 * words ||
    marks.length < Math.ceil(oldCapacity / 64) ||
    roots.length < 1 ||
    fixupCapacity < 1
  )
    throw "INVALID_GENERATIONAL_WORKSPACE";
  const bits = metadata.subarray(0, words),
    live = metadata.subarray(words, 2 * words),
    chunkOffsets = metadata.subarray(2 * words, 3 * words),
    youngBits = bits.subarray(oldCapacity / 256),
    // One dirty bit per granule, eight per 64-byte card byte.
    dirty = marks.subarray(0, Math.ceil(oldCapacity / 64)),
    // Sixteen words of the allocation/barrier ABI, then the large-object
    // space for heap tools (heapDebugStateLarge* in @tint/abi/heap-debug):
    // the live chunk table's address at 16-17, its count at 18, the space's
    // offset at 19 and its granule bytes at 20.
    allocation = new Uint32Array(24);
  allocation[1] = youngCapacity;
  allocation[2] = oldCapacity;
  allocation[7] = oldCapacity;
  let collecting = false;
  /** The space's base: majors compact in place, so the second half of the
   * managed region (a former copy reserve) stays untouched. */
  function activeBase(): number {
    return managedBase;
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
    if (offset < 0 || offset % 8 !== 0 || offset >= (allocation[3] ?? 0))
      return false;
    const unit = offset / 8;
    return ((bits[unit >>> 5] ?? 0) & (1 << (unit & 31))) !== 0;
  }
  function remember(offset: number): void {
    const byte = offset >>> 6,
      bit = 1 << ((offset >>> 3) & 7),
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
        if (offset !== undefined) dirty[offset >>> 6] = 0;
      }
    allocation[12] = 0;
    allocation[14] = 0;
  }
  // Release granularity: the kernel's page size (4, 16 or 64 KiB).
  const releasePage = memoryPageBytes();
  if (
    !Number.isInteger(releasePage) ||
    releasePage < 4096 ||
    (releasePage & (releasePage - 1)) !== 0
  )
    throw "GENERATIONAL_PAGE_SIZE";
  // The large-object space: the managed region's second half, right after
  // the nursery, in granules (LargeSpace in tracing/cheney.ts). Chunks are
  // runs of granules, each holding one object at its start.
  // - Live chunks: their starts in `largeLive`, sizes (in granules) in
  //   `largeSizes` at each start, and `large.young` set until a collection
  //   finds them alive (then they are old).
  // - Free extents: sorted by start and coalesced, `largeWarm` 1 while their
  //   pages are resident. Dead chunks join them warm (and are preferred,
  //   so reuse touches no fresh pages) while the warm bytes stay under
  //   `largeWarmLimit`; beyond that, and at every major collection, their
  //   pages are released.
  // - Granules past `largeTop` have never been used.
  // Young chunks count toward minor collections (`largeYoungLimit`) and old
  // ones toward the old capacity, so the heap's footprint bound holds.
  // The tables live in workspaces this runtime does not otherwise use (the
  // collecting runtime's `offsets` and `sizes`) and in `marks` past the
  // dirty cards, so they take no setup storage; the space shrinks to what
  // they can describe.
  const largeGranuleBytes = Math.max(largeGranuleMinimum, releasePage),
    largeShift = 31 - Math.clz32(largeGranuleBytes),
    dirtyBytes = Math.ceil(oldCapacity / 64),
    // Granule-aligned (so chunks are whole pages for release): capacity is
    // only a multiple of 512 bytes.
    largeOffset = Math.ceil(capacity / largeGranuleBytes) * largeGranuleBytes,
    largeGranules = Math.max(
      0,
      Math.min(
        Math.floor((managedLength - largeOffset) / largeGranuleBytes),
        Math.floor(offsets.length / 2),
        Math.floor(sizes.length / 2),
        Math.floor((marks.length - dirtyBytes) / 3),
      ),
    ),
    large: LargeSpace =
      largeGranules > 0
        ? {
            base: managedBase + largeOffset,
            end: managedBase + largeOffset + largeGranules * largeGranuleBytes,
            shift: largeShift,
            marks: marks.subarray(dirtyBytes, dirtyBytes + largeGranules),
            young: marks.subarray(
              dirtyBytes + largeGranules,
              dirtyBytes + 2 * largeGranules,
            ),
          }
        : noLargeSpace(),
    largeSizes = offsets.subarray(0, largeGranules),
    largeLive = offsets.subarray(largeGranules, 2 * largeGranules),
    largeFreeStart = sizes.subarray(0, largeGranules),
    largeFreeSize = sizes.subarray(largeGranules, 2 * largeGranules),
    largeWarm = marks.subarray(
      dirtyBytes + 2 * largeGranules,
      dirtyBytes + 3 * largeGranules,
    ),
    largeYoungLimit = Math.min(youngCapacity / 2, largeYoungMaximum),
    largeWarmLimit = largeYoungLimit;
  let largeLiveCount = 0,
    largeFreeCount = 0,
    largeTop = 0,
    largeYoungBytes = 0,
    largeOldBytes = 0,
    largeWarmBytes = 0;
  /** Releases the pages of granules [start, start + count). */
  function releaseLarge(start: number, count: number): void {
    if (
      releaseMemory(
        large.base + start * largeGranuleBytes,
        count * largeGranuleBytes,
      ) !== 0
    )
      throw "GENERATIONAL_RELEASE";
  }
  /** Removes free extent `at`, closing the gap. */
  function removeFree(at: number): void {
    largeFreeCount -= 1;
    for (let index = at; index < largeFreeCount; index++) {
      largeFreeStart[index] = largeFreeStart[index + 1] ?? 0;
      largeFreeSize[index] = largeFreeSize[index + 1] ?? 0;
      largeWarm[index] = largeWarm[index + 1] ?? 0;
    }
  }
  /** Opens a gap at free extent `at`. */
  function insertFree(at: number): void {
    for (let index = largeFreeCount; index > at; index--) {
      largeFreeStart[index] = largeFreeStart[index - 1] ?? 0;
      largeFreeSize[index] = largeFreeSize[index - 1] ?? 0;
      largeWarm[index] = largeWarm[index - 1] ?? 0;
    }
    largeFreeCount += 1;
  }
  /** Adds granules [start, start + count) to the free extents, merging with
   * equally warm neighbours. */
  function freeLarge(start: number, count: number, warm: number): void {
    let at = 0;
    while (at < largeFreeCount && (largeFreeStart[at] ?? 0) < start) at++;
    const before = at - 1;
    if (
      before >= 0 &&
      (largeFreeStart[before] ?? 0) + (largeFreeSize[before] ?? 0) === start &&
      (largeWarm[before] ?? 0) === warm
    ) {
      largeFreeSize[before] = (largeFreeSize[before] ?? 0) + count;
      if (
        at < largeFreeCount &&
        (largeFreeStart[at] ?? 0) === start + count &&
        (largeWarm[at] ?? 0) === warm
      ) {
        largeFreeSize[before] =
          (largeFreeSize[before] ?? 0) + (largeFreeSize[at] ?? 0);
        removeFree(at);
      }
      return;
    }
    if (
      at < largeFreeCount &&
      (largeFreeStart[at] ?? 0) === start + count &&
      (largeWarm[at] ?? 0) === warm
    ) {
      largeFreeStart[at] = start;
      largeFreeSize[at] = (largeFreeSize[at] ?? 0) + count;
      return;
    }
    insertFree(at);
    largeFreeStart[at] = start;
    largeFreeSize[at] = count;
    largeWarm[at] = warm;
  }
  /** Takes `count` granules from the free extents (a warm extent first),
   * or from never-used granules; -1 when neither fits. */
  function takeLarge(count: number): number {
    let chosen = -1;
    for (let at = 0; at < largeFreeCount; at++)
      if ((largeFreeSize[at] ?? 0) >= count) {
        if ((largeWarm[at] ?? 0) !== 0) {
          chosen = at;
          break;
        }
        if (chosen < 0) chosen = at;
      }
    if (chosen >= 0) {
      const start = largeFreeStart[chosen] ?? 0,
        size = largeFreeSize[chosen] ?? 0;
      if ((largeWarm[chosen] ?? 0) !== 0)
        largeWarmBytes -= count * largeGranuleBytes;
      if (size === count) removeFree(chosen);
      else {
        largeFreeStart[chosen] = start + count;
        largeFreeSize[chosen] = size - count;
      }
      return start;
    }
    if (largeTop + count > largeGranules) return -1;
    const start = largeTop;
    largeTop += count;
    return start;
  }
  /** After a collection: frees the dead chunks it could judge (young ones
   * after a minor, every chunk after a major) and makes the live young
   * ones old. Marks are cleared for the next collection. */
  function sweepLarge(minor: boolean): void {
    let kept = 0;
    for (let index = 0; index < largeLiveCount; index++) {
      const start = largeLive[index] ?? 0,
        bytes = (largeSizes[start] ?? 0) * largeGranuleBytes,
        young = (large.young[start] ?? 0) !== 0,
        marked = (large.marks[start] ?? 0) !== 0;
      large.marks[start] = 0;
      if (marked || (minor && !young)) {
        if (young) {
          large.young[start] = 0;
          largeOldBytes += bytes;
        }
        largeLive[kept] = start;
        kept += 1;
        continue;
      }
      if (!young) largeOldBytes -= bytes;
      large.young[start] = 0;
      const count = largeSizes[start] ?? 0;
      largeSizes[start] = 0;
      if (largeWarmBytes + bytes <= largeWarmLimit) {
        largeWarmBytes += bytes;
        freeLarge(start, count, 1);
      } else {
        releaseLarge(start, count);
        freeLarge(start, count, 0);
      }
    }
    largeLiveCount = kept;
    allocation[18] = kept;
    largeYoungBytes = 0;
    if (!minor) {
      // Majors return the warm pool's pages too.
      for (let at = 0; at < largeFreeCount; at++)
        if ((largeWarm[at] ?? 0) !== 0)
          releaseLarge(largeFreeStart[at] ?? 0, largeFreeSize[at] ?? 0);
      const extents = largeFreeCount;
      largeFreeCount = 0;
      largeWarmBytes = 0;
      for (let at = 0; at < extents; at++) {
        // Re-add as cold, merging what warmth kept apart.
        const start = largeFreeStart[at] ?? 0,
          size = largeFreeSize[at] ?? 0;
        largeWarm[at] = 0;
        if (
          largeFreeCount > 0 &&
          (largeFreeStart[largeFreeCount - 1] ?? 0) +
            (largeFreeSize[largeFreeCount - 1] ?? 0) ===
            start
        )
          largeFreeSize[largeFreeCount - 1] =
            (largeFreeSize[largeFreeCount - 1] ?? 0) + size;
        else {
          largeFreeStart[largeFreeCount] = start;
          largeFreeSize[largeFreeCount] = size;
          largeWarm[largeFreeCount] = 0;
          largeFreeCount += 1;
        }
      }
    }
  }
  const heap = createCheneyCollector(managedBase, managedLength, large);
  // Pool evacuation for collections large enough to repay waking workers;
  // smaller ones, and any the pool cannot fit with LAB waste, stay serial.
  const parallel = createParallelEvacuator(
    managedBase,
    managedLength,
    collectorWorkerCount(processorCount(), cgroupProcessorLimit()),
    bits,
    roots,
    dirty,
    large,
  );
  // Majors mark and forward on the same pool (inside the pause) when the
  // space is large enough to repay waking it.
  const compactor = createCompactor(
    managedBase,
    managedLength,
    large,
    parallel,
    parallelMinimum,
  );
  // Survivors of a major collection that no longer fit the old prefix would
  // overlap the nursery: the heap is then exhausted for good, and the young
  // window is published full so inline allocation reaches the abort too.
  let exhausted = false;
  // A value created once at setup: a collection must not allocate.
  const rememberedObjects = (scan: (address: number) => void): void => {
    if ((allocation[14] ?? 0) !== 0) {
      const end = Math.ceil((allocation[3] ?? 0) / 64);
      for (let byte = 0; byte < end; byte++) {
        const flags = dirty[byte] ?? 0;
        if (flags !== 0)
          for (let bit = 0; bit < 8; bit++)
            if ((flags & (1 << bit)) !== 0) {
              const address = activeBase() + byte * 64 + bit * 8;
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
  // After publication, which resets the queue words through word 15.
  if (largeGranules > 0) {
    allocation[nativeAllocationDataThresholdWord] = largeObjectThreshold;
    const table = permanentArrayAddress(largeLive);
    allocation[16] = table % 4294967296;
    allocation[17] = Math.floor(table / 4294967296);
    allocation[19] = largeOffset;
    allocation[20] = largeGranuleBytes;
  }
  function collect(forceMajor: boolean): boolean {
    if (exhausted) return false;
    const youngTop = allocation[0] ?? 0,
      oldTop = allocation[3] ?? 0;
    // A minor promotes at most the nursery and the young large objects;
    // old large objects share the old capacity with the old prefix.
    const minor =
      !forceMajor &&
      (youngTop > 0 || largeYoungBytes > 0) &&
      youngTop <= oldCapacity - oldTop &&
      youngTop + largeYoungBytes <= oldCapacity - oldTop - largeOldBytes;
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
      youngBits.fill(0, 0, Math.ceil(youngTop / 256));
      allocation[3] = oldTop + bytes;
      sweepLarge(true);
    } else {
      // The whole active space compacts in place: live old and young
      // objects slide down into a packed old prefix (survivors that no
      // longer fit exhaust the heap for good), so no second space is
      // touched and peak residency is the space's fill plus metadata.
      const used = youngTop > 0 ? oldCapacity + youngTop : oldTop,
        bytes = compactor.collect(
          base,
          used,
          currentRootHead(),
          bits,
          live,
          chunkOffsets,
          pending,
        );
      allocation[3] = bytes;
      if (bytes > oldCapacity) exhausted = true;
      sweepLarge(false);
      // Nothing above the packed prefix is live: return those pages. The
      // nursery and the old fill fault back in as zero pages when reused.
      const start = Math.ceil((base + bytes) / releasePage) * releasePage,
        end = Math.floor((base + used) / releasePage) * releasePage;
      if (end > start && releaseMemory(start, end - start) !== 0)
        throw "GENERATIONAL_RELEASE";
    }
    allocation[0] = exhausted ? youngCapacity : 0;
    clearRemembered();
    collecting = false;
    return !exhausted;
  }
  // Exhaustion throws, so compiled callers unwind through their exceptional
  // edges (an embedded compilation fails instead of trapping). Reentrant or
  // malformed requests remain invariant failures (undefined traps).
  // Request size 0 is reserved for a forced full collection (the Test262
  // host's $262.gc); it returns +0 and allocates nothing.
  /** A young chunk for a data object of `size` bytes (the request's
   * offset), or -1 when the large-object space cannot hold it. Young chunks
   * past their budget collect first, freeing the dead ones. */
  function allocateLarge(size: number): number {
    const count = Math.ceil(size / largeGranuleBytes),
      bytes = count * largeGranuleBytes;
    if (largeYoungBytes + bytes > largeYoungLimit && !collect(false))
      throw managedHeapExhausted;
    const start = takeLarge(count);
    if (start < 0) return -1;
    largeSizes[start] = count;
    large.young[start] = 1;
    largeLive[largeLiveCount] = start;
    largeLiveCount += 1;
    allocation[18] = largeLiveCount;
    largeYoungBytes += bytes;
    return largeOffset + start * largeGranuleBytes;
  }
  return (request) => {
    // Data requests (no references) carry nativeAllocationDataRequest.
    const data = request >= nativeAllocationDataRequest,
      bytes = data ? request - nativeAllocationDataRequest : request;
    if (bytes === nativeAllocatorShutdownRequest && !collecting) {
      if (parallel !== undefined) parallel.dispose();
      return 0;
    }
    if (bytes === 0 && !collecting) {
      if (!collect(true)) throw managedHeapExhausted;
      return 0;
    }
    if (collecting || !Number.isInteger(bytes) || bytes <= 0) return undefined;
    // No collection can make room for this request (an impossible string
    // length lands here too): a catchable RangeError, not an engine abort.
    if (bytes > oldCapacity) throw engineRangeError();
    const size = Math.ceil(bytes / 8) * 8;
    if (data && size >= largeObjectThreshold && large.end !== 0) {
      const offset = allocateLarge(size);
      if (offset >= 0) return offset;
    }
    if (size >= Math.max(128, youngCapacity / 4)) {
      if (size > oldCapacity - (allocation[3] ?? 0) && !collect(true))
        throw managedHeapExhausted;
      const top = allocation[3] ?? 0;
      if (size > oldCapacity - top) throw managedHeapExhausted;
      const unit = top / 8,
        word = unit >>> 5;
      bits[word] = (bits[word] ?? 0) | (1 << (unit & 31));
      allocation[3] = top + size;
      // Constructor stores need no separate barrier: every directly old allocation
      // is remembered before initialization, which has no intervening safepoint.
      remember(top);
      return top;
    }
    if (size > youngCapacity - (allocation[0] ?? 0) && !collect(false))
      throw managedHeapExhausted;
    const top = allocation[0] ?? 0;
    if (size > youngCapacity - top) throw managedHeapExhausted;
    const unit = (oldCapacity + top) / 8,
      word = unit >>> 5;
    bits[word] = (bits[word] ?? 0) | (1 << (unit & 31));
    allocation[0] = top + size;
    return oldCapacity + top;
  };
}
