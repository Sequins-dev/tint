export interface RelocationCommit {
  readonly byteLength: number;
  readonly alignment: number;
  readonly maxExtents: number;
  readonly count: number;
  readonly offsets: Uint32Array;
  readonly sizes: Uint32Array;
  readonly destinations: Uint32Array;
  readonly fixupCount: number;
  readonly slots: Float64Array;
  readonly values: Float64Array;
  readonly publishedOffsets: Uint32Array;
  readonly publishedSizes: Uint32Array;
  readonly canWrite: (slot: number) => boolean;
  readonly write: (slot: number, value: number) => boolean;
  readonly move: (destination: number, source: number, size: number) => boolean;
  readonly publish: (
    offsets: Uint32Array,
    sizes: Uint32Array,
    count: number,
  ) => boolean;
}
/** Inputs come from successful relocation/fixup preflight and remain immutable.
 * All scratch/control state must be outside moved memory and writable roots.
 * Callbacks are trusted, nonallocating, nonreentrant leaves under stop-the-world
 * ownership. False is possible only before mutation; failure after commit begins
 * throws a fatal invariant, which the host must never catch and resume execution. */
export function commitRelocation(request: RelocationCommit): boolean {
  const length = request.byteLength,
    alignment = request.alignment,
    count = request.count,
    offsets = request.offsets,
    sizes = request.sizes,
    destinations = request.destinations,
    slots = request.slots,
    values = request.values,
    fixupCount = request.fixupCount,
    publishedOffsets = request.publishedOffsets,
    publishedSizes = request.publishedSizes;
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
    count > destinations.length ||
    count > publishedOffsets.length ||
    count > publishedSizes.length ||
    !Number.isInteger(fixupCount) ||
    fixupCount < 0 ||
    fixupCount > slots.length ||
    fixupCount > values.length ||
    !Number.isInteger(request.maxExtents) ||
    request.maxExtents < 1
  )
    return false;
  // Publication scratch must not destroy any still-needed input or fixup words.
  for (let outputIndex = 0; outputIndex < 2; outputIndex++) {
    const output = outputIndex === 0 ? publishedOffsets : publishedSizes;
    if (
      output.buffer === offsets.buffer ||
      output.buffer === sizes.buffer ||
      output.buffer === destinations.buffer ||
      output.buffer === slots.buffer ||
      output.buffer === values.buffer
    )
      return false;
  }
  if (publishedOffsets.buffer === publishedSizes.buffer) return false;
  let oldEnd = 0,
    newEnd = 0,
    survivors = 0,
    extents = 0;
  for (let i = 0; i < count; i++) {
    const old = offsets[i],
      size = sizes[i],
      destination = destinations[i];
    if (
      old === undefined ||
      size === undefined ||
      destination === undefined ||
      size === 0 ||
      old < oldEnd ||
      old % alignment !== 0 ||
      size % alignment !== 0 ||
      old + size > length
    )
      return false;
    oldEnd = old + size;
    if (destination === 0xffffffff) continue;
    if (
      destination > old ||
      destination < newEnd ||
      destination % alignment !== 0
    )
      return false;
    if (destination > newEnd) extents++;
    extents++;
    newEnd = destination + size;
    publishedOffsets[survivors] = destination;
    publishedSizes[survivors] = size;
    survivors++;
  }
  if (newEnd < length) extents++;
  if (extents > request.maxExtents) return false;
  for (let i = 0; i < fixupCount; i++) {
    const slot = slots[i],
      value = values[i];
    if (
      slot === undefined ||
      value === undefined ||
      !Number.isSafeInteger(slot) ||
      slot < 0 ||
      slot % 8 !== 0 ||
      !Number.isSafeInteger(value) ||
      value < 0 ||
      !request.canWrite(slot)
    )
      return false;
  }
  for (let i = 0; i < fixupCount; i++) {
    const slot = slots[i],
      value = values[i];
    if (
      slot === undefined ||
      value === undefined ||
      !request.write(slot, value)
    )
      throw "RELOCATION_COMMIT_FAILED";
  }
  for (let i = 0; i < count; i++) {
    const old = offsets[i],
      size = sizes[i],
      destination = destinations[i];
    if (old === undefined || size === undefined || destination === undefined)
      throw "RELOCATION_COMMIT_FAILED";
    if (
      destination !== 0xffffffff &&
      destination !== old &&
      !request.move(destination, old, size)
    )
      throw "RELOCATION_COMMIT_FAILED";
  }
  if (!request.publish(publishedOffsets, publishedSizes, survivors))
    throw "RELOCATION_COMMIT_FAILED";
  return true;
}
