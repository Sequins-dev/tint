import { nativeAllocationDataRequest } from "@tint/abi/host";
import { createRegionCompactor, type CompactionStorage } from "./compaction.ts";
export type { CompactionStorage } from "./compaction.ts";
import {
  createRegionAllocator,
  snapshotRegionAllocations,
} from "../allocators/region/index.ts";
import { createNativeCollector, type ReadWord } from "../tracing/index.ts";
import type { MarkStatus } from "../graph/index.ts";
export type CollectionStatus =
  MarkStatus | "inventory" | "sweep" | "reentrant" | "relocation";
export interface RegionOptions {
  readonly compaction?: CompactionStorage;
  readonly base: number;
  readonly byteLength: number;
  readonly metadata: Uint32Array;
  readonly offsets: Uint32Array;
  readonly sizes: Uint32Array;
  readonly starts: Float64Array;
  readonly marks: Uint8Array;
  readonly pending: Uint32Array;
  readonly roots: Float64Array;
  readonly readWord: ReadWord;
  /** Calls the collection with the root head (the stack-map registry). The
   * native runtime reads it in this callback's own frame, which stays live
   * while the collection walks its callers (see currentRootHead). */
  readonly withRootHead: (
    collect: (rootHead: number) => CollectionStatus,
  ) => CollectionStatus;
  readonly isExternal: (address: number) => boolean;
  readonly maxSteps?: number;
}
export interface CollectingRegion {
  readonly allocate: (byteLength: number) => number | undefined;
  readonly collect: () => CollectionStatus;
  readonly usedBytes: () => number;
}
/** All control state/workspaces must be allocated outside this managed region.
 * No cross-region references are permitted except independently immortal objects. */
export function createCollectingRegion(
  options: RegionOptions,
): CollectingRegion | undefined {
  const base = options.base,
    length = options.byteLength,
    maxSteps = options.maxSteps ?? 1000000;
  if (
    !Number.isSafeInteger(base) ||
    base <= 0 ||
    base % 16 !== 0 ||
    !Number.isSafeInteger(base + length) ||
    !Number.isInteger(maxSteps) ||
    maxSteps < 0 ||
    maxSteps > 0xffffffff
  )
    return undefined;
  const allocator = createRegionAllocator(length, 16, options.metadata);
  if (allocator === undefined) return undefined;
  const heap = allocator;
  // Keep the top quarter exclusively available to large buffers. Tiny regions
  // retain the original unpartitioned behavior. One inventory still traces all
  // allocations, including references that cross this placement boundary. Large
  // requests may borrow unused low space; small requests cannot use the reserve.
  const largeBoundary =
    length >= 262144 ? Math.floor((length * 3) / 64) * 16 : 0;
  const collector = createNativeCollector(
    options.readWord,
    options.starts,
    options.sizes,
    options.marks,
    options.pending,
    options.roots,
    options.isExternal,
  );
  const storage = options.compaction;
  const compact =
    storage === undefined
      ? undefined
      : createRegionCompactor(
          base,
          length,
          options.metadata.length / 3 - 32,
          options.starts,
          options.sizes,
          options.marks,
          options.readWord,
          options.isExternal,
          heap.replaceAllocations,
          storage,
          maxSteps,
        );
  if (storage !== undefined && compact === undefined) return undefined;
  let collecting = false,
    markCount = 0;
  // Created with the region, so the collection allocates no closure.
  const markAndCompact = (rootHead: number): CollectionStatus => {
    const status = collector.mark(markCount, rootHead, maxSteps);
    if (status !== "complete" || compact === undefined) return status;
    return compact(markCount, rootHead) ? "complete" : "relocation";
  };
  function collect(): CollectionStatus {
    if (collecting) return "reentrant";
    collecting = true;
    heap.disableSearchIndex();
    try {
      const indexed =
        options.pending.length >= options.offsets.length &&
        options.starts.length >= 256;
      const count = snapshotRegionAllocations(
        options.metadata,
        length,
        options.offsets,
        options.sizes,
        indexed ? options.pending : undefined,
        indexed ? options.starts : undefined,
        heap.descriptorCount(),
      );
      if (count === undefined || count > options.starts.length)
        return "inventory";
      for (let index = 0; index < count; index++) {
        const offset = options.offsets[index];
        if (offset === undefined) return "inventory";
        options.starts[index] = base + offset;
        if (indexed) {
          const descriptor = options.pending[index];
          if (descriptor === undefined) return "inventory";
          options.offsets[index] = descriptor;
        }
      }
      markCount = count;
      const status = options.withRootHead(markAndCompact);
      if (status !== "complete" || compact !== undefined) return status;
      if (indexed) {
        let survivors = 0;
        for (let index = 0; index < count; index++) {
          if (options.marks[index] !== 0) {
            const descriptor = options.offsets[index];
            if (descriptor === undefined) return "sweep";
            options.pending[survivors++] = descriptor;
          }
        }
        // High-mortality collections rebuild from survivors instead of merging
        // millions of dead extents individually. Addresses remain unchanged;
        // the marker stack is now available as descriptor scratch.
        if (
          survivors < count / 2 &&
          survivors * 2 + 1 <= options.metadata.length / 3 - 32
        ) {
          return heap.retainDescriptors(
            options.pending,
            survivors,
            options.offsets,
            options.sizes,
          )
            ? "complete"
            : "sweep";
        }
      }
      // Compact dead offsets into the borrowed snapshot, then reclaim all of
      // them in one validated linear pass through the allocator inventory.
      let dead = 0;
      for (let index = 0; index < count; index++) {
        if (options.marks[index] === 0) {
          const offset = options.offsets[index];
          if (offset === undefined) return "sweep";
          options.offsets[dead] = offset;
          dead++;
        }
      }
      if (
        indexed
          ? !heap.releaseDescriptors(options.offsets, dead)
          : !heap.releaseAll(options.offsets, dead)
      )
        return "sweep";
      return "complete";
    } finally {
      collecting = false;
      // Snapshot/mark are finished with these workspaces. Allocation may now
      // borrow them until the next collection, without allocating index storage.
      heap.enableSearchIndex(options.pending, options.offsets);
    }
  }
  return {
    // Request size 0 is reserved for a forced full collection (the Test262
    // host's $262.gc, collect-garbage): +0 when it completed. A failed or
    // reentrant collection is an invariant failure (undefined traps).
    allocate: (request) => {
      // This region has no large-object space: a data request is ordinary.
      const bytes =
        request >= nativeAllocationDataRequest
          ? request - nativeAllocationDataRequest
          : request;
      if (bytes === 0)
        return !collecting && collect() === "complete" ? 0 : undefined;
      if (
        collecting ||
        !Number.isInteger(bytes) ||
        bytes <= 0 ||
        bytes > length
      )
        return undefined;
      // Keep large buffers away from densely interleaved small object lifetimes.
      // Both directions share one inventory, index and tracing collector.
      const large = bytes >= 65536;
      const offset = large
        ? heap.allocateFromEnd(bytes)
        : heap.allocateBelow(
            bytes,
            largeBoundary === 0 ? length : largeBoundary,
          );
      if (offset !== undefined) return offset;
      if (collect() !== "complete") return undefined;
      return large
        ? heap.allocateFromEnd(bytes)
        : heap.allocateBelow(
            bytes,
            largeBoundary === 0 ? length : largeBoundary,
          );
    },
    collect,
    usedBytes: () => heap.usedBytes(),
  };
}
