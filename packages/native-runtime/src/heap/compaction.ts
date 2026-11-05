import {
  planCompaction,
  forwardOffset,
  commitRelocation,
} from "../relocation/index.ts";
import { createNativeFixupPlanner, type ReadWord } from "../tracing/index.ts";
export interface CompactionStorage {
  readonly offsets: Uint32Array;
  readonly live: Uint8Array;
  readonly pinned: Uint8Array;
  readonly destinations: Uint32Array;
  readonly summary: Uint32Array;
  readonly slots: Float64Array;
  readonly values: Float64Array;
  readonly publishedOffsets: Uint32Array;
  readonly publishedSizes: Uint32Array;
  readonly canWrite: (slot: number) => boolean;
  readonly write: (slot: number, value: number) => boolean;
  readonly move: (destination: number, source: number, size: number) => boolean;
}
/** Construct on permanent control storage. All buffers are exclusively borrowed
 * and disjoint from collector workspaces, the heap, roots and one another.
 * Pinned flags are provided in the current sorted inventory order before compact. */
export function createRegionCompactor(
  base: number,
  length: number,
  maxExtents: number,
  starts: Float64Array,
  sizes: Uint32Array,
  marks: Uint8Array,
  read: ReadWord,
  isExternal: (address: number) => boolean,
  publish: (offsets: Uint32Array, sizes: Uint32Array, count: number) => boolean,
  storage: CompactionStorage,
  maxSteps: number,
): ((count: number, rootHead: number) => boolean) | undefined {
  let activeCount = 0;
  const offsets = storage.offsets,
    destinations = storage.destinations;
  function forward(address: number): number | undefined {
    if (address < base || address >= base + length)
      return isExternal(address) ? address : undefined;
    const offset = forwardOffset(
      offsets,
      destinations,
      activeCount,
      address - base,
    );
    return offset === undefined ? undefined : base + offset;
  }
  const fixups = createNativeFixupPlanner(
    read,
    forward,
    storage.canWrite,
    storage.slots,
    storage.values,
  );
  if (fixups === undefined) return undefined;
  const planner = fixups;
  const input = {
    byteLength: length,
    alignment: 16,
    count: 0,
    offsets,
    sizes,
    live: storage.live,
    pinned: storage.pinned,
  };
  const commit = {
    byteLength: length,
    alignment: 16,
    maxExtents,
    count: 0,
    offsets,
    sizes,
    destinations,
    fixupCount: 0,
    slots: storage.slots,
    values: storage.values,
    publishedOffsets: storage.publishedOffsets,
    publishedSizes: storage.publishedSizes,
    canWrite: storage.canWrite,
    write: storage.write,
    move: storage.move,
    publish,
  };
  return (count, rootHead) => {
    if (
      count > offsets.length ||
      count > storage.live.length ||
      count > starts.length ||
      count > marks.length
    )
      return false;
    for (let i = 0; i < count; i++) {
      const start = starts[i],
        mark = marks[i];
      if (
        start === undefined ||
        mark === undefined ||
        start < base ||
        start >= base + length ||
        (mark !== 0 && mark !== 2)
      )
        return false;
      offsets[i] = start - base;
      storage.live[i] = mark === 2 ? 1 : 0;
    }
    input.count = count;
    if (!planCompaction(input, destinations, storage.summary)) return false;
    activeCount = count;
    const fixupCount = planner.prepare(
      starts,
      sizes,
      marks,
      count,
      rootHead,
      maxSteps,
    );
    if (fixupCount === undefined) return false;
    commit.count = count;
    commit.fixupCount = fixupCount;
    return commitRelocation(commit);
  };
}
