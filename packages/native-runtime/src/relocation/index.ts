export interface CompactionInput {
  readonly byteLength: number;
  readonly alignment: number;
  readonly count: number;
  readonly offsets: Uint32Array;
  readonly sizes: Uint32Array;
  readonly live: Uint8Array;
  readonly pinned: Uint8Array;
}
function overlaps(
  aStart: number,
  aLength: number,
  bStart: number,
  bLength: number,
): boolean {
  return aStart < bStart + bLength && bStart < aStart + aLength;
}
/** Plan leftward moves without changing source memory or inventory. On success,
 * dead destination entries contain 0xffffffff and summary holds live count, live
 * bytes, moved bytes and largest free extent. All storage is caller-owned. */
export function planCompaction(
  input: CompactionInput,
  destinations: Uint32Array,
  summary: Uint32Array,
): boolean {
  const length = input.byteLength,
    alignment = input.alignment,
    count = input.count,
    offsets = input.offsets,
    sizes = input.sizes,
    live = input.live,
    pinned = input.pinned;
  if (
    !Number.isInteger(length) ||
    length <= 0 ||
    length > 0xffffffff ||
    !Number.isInteger(alignment) ||
    alignment <= 0 ||
    alignment > 0x40000000 ||
    (alignment & (alignment - 1)) !== 0 ||
    length % alignment !== 0 ||
    !Number.isInteger(count) ||
    count < 0 ||
    count > offsets.length ||
    count > sizes.length ||
    count > live.length ||
    count > pinned.length ||
    count > destinations.length ||
    summary.length < 4 ||
    (summary.buffer === destinations.buffer &&
      overlaps(
        summary.byteOffset,
        summary.byteLength,
        destinations.byteOffset,
        destinations.byteLength,
      )) ||
    (summary.buffer === offsets.buffer &&
      overlaps(
        summary.byteOffset,
        summary.byteLength,
        offsets.byteOffset,
        offsets.byteLength,
      )) ||
    (summary.buffer === sizes.buffer &&
      overlaps(
        summary.byteOffset,
        summary.byteLength,
        sizes.byteOffset,
        sizes.byteLength,
      )) ||
    (summary.buffer === live.buffer &&
      overlaps(
        summary.byteOffset,
        summary.byteLength,
        live.byteOffset,
        live.byteLength,
      )) ||
    (summary.buffer === pinned.buffer &&
      overlaps(
        summary.byteOffset,
        summary.byteLength,
        pinned.byteOffset,
        pinned.byteLength,
      )) ||
    (destinations.buffer === offsets.buffer &&
      overlaps(
        destinations.byteOffset,
        destinations.byteLength,
        offsets.byteOffset,
        offsets.byteLength,
      )) ||
    (destinations.buffer === sizes.buffer &&
      overlaps(
        destinations.byteOffset,
        destinations.byteLength,
        sizes.byteOffset,
        sizes.byteLength,
      )) ||
    (destinations.buffer === live.buffer &&
      overlaps(
        destinations.byteOffset,
        destinations.byteLength,
        live.byteOffset,
        live.byteLength,
      )) ||
    (destinations.buffer === pinned.buffer &&
      overlaps(
        destinations.byteOffset,
        destinations.byteLength,
        pinned.byteOffset,
        pinned.byteLength,
      ))
  )
    return false;
  let end = 0;
  for (let i = 0; i < count; i++) {
    const offset = offsets[i],
      size = sizes[i],
      alive = live[i],
      pin = pinned[i];
    if (
      offset === undefined ||
      size === undefined ||
      alive === undefined ||
      pin === undefined ||
      offset < end ||
      offset % alignment !== 0 ||
      size === 0 ||
      size % alignment !== 0 ||
      offset + size > length ||
      alive > 1 ||
      pin > 1 ||
      (pin === 1 && alive === 0)
    )
      return false;
    end = offset + size;
  }
  let cursor = 0,
    liveCount = 0,
    liveBytes = 0,
    movedBytes = 0,
    largestFreeExtent = 0;
  // Validation is complete. This pass cannot fail under exclusive buffer ownership.
  for (let i = 0; i < count; i++) {
    const offset = offsets[i],
      size = sizes[i];
    if (offset === undefined || size === undefined)
      throw "COMPACTION_INVENTORY_INVARIANT";
    if (live[i] === 0) {
      destinations[i] = 0xffffffff;
      continue;
    }
    const destination = pinned[i] === 1 ? offset : cursor;
    if (destination - cursor > largestFreeExtent)
      largestFreeExtent = destination - cursor;
    destinations[i] = destination;
    liveCount++;
    liveBytes += size;
    if (destination !== offset) movedBytes += size;
    cursor = destination + size;
  }
  if (length - cursor > largestFreeExtent) largestFreeExtent = length - cursor;
  summary[0] = liveCount;
  summary[1] = liveBytes;
  summary[2] = movedBytes;
  summary[3] = largestFreeExtent;
  return true;
}

/** Resolve an exact old allocation start in a previously validated plan.
 * The sorted original inventory and destination prefix must remain immutable
 * through reference rewriting. Never call with an already-forwarded pointer.
 * No allocation occurs; lookup is logarithmic in count. */
export function forwardOffset(
  offsets: Uint32Array,
  destinations: Uint32Array,
  count: number,
  offset: number,
): number | undefined {
  if (
    !Number.isInteger(count) ||
    count < 0 ||
    count > offsets.length ||
    count > destinations.length ||
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset > 0xffffffff
  )
    return undefined;
  let low = 0,
    high = count;
  while (low < high) {
    const middle = Math.floor((low + high) / 2),
      candidate = offsets[middle];
    if (candidate === undefined) return undefined;
    if (candidate < offset) low = middle + 1;
    else high = middle;
  }
  if (low >= count || offsets[low] !== offset) return undefined;
  const destination = destinations[low];
  return destination === 0xffffffff ? undefined : destination;
}
export { commitRelocation, type RelocationCommit } from "./commit.ts";
