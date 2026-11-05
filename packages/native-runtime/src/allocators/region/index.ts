export interface RegionAllocator {
  /** Replace the complete inventory after a caller-controlled relocation commit. */
  readonly replaceAllocations: (
    offsets: Uint32Array,
    sizes: Uint32Array,
    length: number,
  ) => boolean;
  readonly allocate: (bytes: number) => number | undefined;
  /** Highest-address fit, split from the high end; shares reclamation and indexing. */
  readonly allocateFromEnd: (bytes: number) => number | undefined;
  /** First-fit entirely below an exclusive region-relative limit. */
  readonly allocateBelow: (bytes: number, limit: number) => number | undefined;
  /** Highest fit entirely at or above an inclusive region-relative limit. */
  readonly allocateAbove: (bytes: number, limit: number) => number | undefined;
  /** Borrow disjoint external scratch until disabled or reclamation begins. */
  readonly enableSearchIndex: (
    descriptors: Uint32Array,
    maxima: Uint32Array,
  ) => boolean;
  readonly disableSearchIndex: () => void;
  readonly descriptorCount: () => number;
  readonly release: (offset: number) => boolean;
  readonly releaseAll: (offsets: Uint32Array, length: number) => boolean;
  /** Snapshot descriptor IDs, strictly ordered by their allocation offsets. */
  readonly releaseDescriptors: (ids: Uint32Array, length: number) => boolean;
  /** Retain only these ordered snapshot descriptors; invalidate all old descriptor
   * IDs while preserving allocation addresses. Scratch arrays must be disjoint. */
  readonly retainDescriptors: (
    ids: Uint32Array,
    length: number,
    offsets: Uint32Array,
    sizes: Uint32Array,
  ) => boolean;
  readonly allocationSize: (offset: number) => number | undefined;
  readonly usedBytes: () => number;
}
/** Three words per descriptor plus 96 trailing words for bounded search hints.
 * Descriptors contain start, size, and allocation marker/free-list link.
 * Size zero denotes a recycled descriptor. Allocated descriptors use 0xffffffff;
 * free descriptors link to the next free slot plus one, with zero ending the list. */
export function createRegionAllocator(
  byteLength: number,
  alignment: number,
  metadata: Uint32Array,
): RegionAllocator | undefined {
  if (
    !Number.isInteger(byteLength) ||
    byteLength <= 0 ||
    byteLength > 0xffffffff ||
    !Number.isInteger(alignment) ||
    alignment <= 0 ||
    alignment > 0x40000000 ||
    (alignment & (alignment - 1)) !== 0 ||
    byteLength % alignment !== 0 ||
    metadata.length < 99 ||
    metadata.length % 3 !== 0
  )
    return undefined;
  const capacity = metadata.length / 3 - 32,
    cacheBase = capacity * 3;
  let count = 1,
    used = 0,
    freeHead = 0,
    recycled = -1,
    indexLeaves = 0;
  let indexDescriptors = metadata,
    indexMaxima = metadata;
  metadata.fill(0);
  metadata[1] = byteLength;
  function read(index: number): number {
    const value = metadata[index];
    if (value === undefined) throw "region metadata invariant";
    return value;
  }
  function discard(index: number): void {
    metadata[index * 3] = recycled + 1;
    metadata[index * 3 + 1] = 0;
    metadata[index * 3 + 2] = 0;
    recycled = index;
  }
  function find(offset: number): number {
    if (!Number.isInteger(offset) || offset < 0 || offset >= byteLength)
      return -1;
    for (let index = 0; index < count; index++) {
      if (read(index * 3 + 2) === 0xffffffff && read(index * 3) === offset)
        return index;
    }
    return -1;
  }
  function swap(a: number, b: number): void {
    for (let word = 0; word < 3; word++) {
      const value = read(a * 3 + word);
      metadata[a * 3 + word] = read(b * 3 + word);
      metadata[b * 3 + word] = value;
    }
  }
  function sift(root: number, end: number): void {
    while (root * 2 + 1 < end) {
      let child = root * 2 + 1;
      if (child + 1 < end && read((child + 1) * 3) > read(child * 3)) child++;
      if (read(root * 3) >= read(child * 3)) return;
      swap(root, child);
      root = child;
    }
  }
  function requested(
    offsets: Uint32Array,
    length: number,
    offset: number,
  ): boolean {
    let low = 0,
      high = length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2),
        value = offsets[middle];
      if (value === undefined) throw "release inventory invariant";
      if (value < offset) low = middle + 1;
      else high = middle;
    }
    return low < length && offsets[low] === offset;
  }
  function place(
    bytes: number,
    fromEnd: boolean,
    limit: number,
  ): number | undefined {
    if (
      !Number.isInteger(bytes) ||
      bytes <= 0 ||
      bytes > byteLength ||
      !Number.isInteger(limit) ||
      limit < 0 ||
      limit > byteLength
    )
      return undefined;
    const size = Math.ceil(bytes / alignment) * alignment;
    // Each hint names an exact request size and an undersized prefix.
    // A second candidate keeps common colliding sizes from repeatedly
    // discarding each other's progress through a fragmented free list.
    const units = size / alignment,
      primary = units % 32;
    let secondary = (units * 13 + Math.floor(units / 32)) % 32;
    if (secondary === primary) secondary = (primary + 17) % 32;
    let cache = cacheBase + primary * 3,
      cachedUnits = fromEnd ? 0 : read(cache);
    if (!fromEnd && cachedUnits !== units) {
      const alternate = cacheBase + secondary * 3,
        alternateUnits = read(alternate);
      if (
        alternateUnits === units ||
        (cachedUnits !== 0 && alternateUnits === 0)
      ) {
        cache = alternate;
        cachedUnits = alternateUnits;
      }
    }
    let indexedNode = 0;
    const descriptors = indexDescriptors,
      maxima = indexMaxima;
    let previous = -1,
      index = freeHead;
    if (indexLeaves > 0 && (recycled >= 0 || count < capacity)) {
      if ((maxima[1] ?? 0) < size) return undefined;
      const cachedNode =
        !fromEnd && cachedUnits === units ? read(cache + 1) : 0;
      if (cachedNode >= indexLeaves && (maxima[cachedNode] ?? 0) >= size)
        indexedNode = cachedNode;
      else {
        indexedNode = 1;
        while (indexedNode < indexLeaves) {
          indexedNode *= 2;
          if (fromEnd) {
            if ((maxima[indexedNode + 1] ?? 0) >= size) indexedNode++;
          } else if ((maxima[indexedNode] ?? 0) < size) indexedNode++;
        }
      }
      index = descriptors[indexedNode - indexLeaves] ?? -1;
    } else if (fromEnd) {
      // Without an index, remember the last suitable extent and its predecessor.
      // Descriptor exhaustion permits exact fits but not splitting a hole.
      let free = freeHead,
        prior = -1;
      index = -1;
      while (free >= 0) {
        const length = read(free * 3 + 1);
        if (
          length >= size &&
          (length === size || recycled >= 0 || count < capacity)
        ) {
          index = free;
          previous = prior;
        }
        prior = free;
        free = read(free * 3 + 2) - 1;
      }
    } else if (indexLeaves === 0 && cachedUnits === units) {
      index = read(cache + 1) - 1;
      previous = read(cache + 2) - 1;
    } else if (indexLeaves === 0) {
      // A prefix proved too small for a smaller request is also too small
      // for this one. Reuse that proof across distinct request sizes instead
      // of rescanning every hole whenever the exact-size cache misses.
      let boundary = -1;
      for (let hint = cacheBase; hint < metadata.length; hint += 3) {
        const minimum = read(hint);
        if (minimum === 0 || minimum > units) continue;
        const predecessor = read(hint + 2) - 1;
        if (predecessor < 0) continue;
        const offset = read(predecessor * 3);
        if (offset > boundary) {
          boundary = offset;
          previous = predecessor;
          index = read(hint + 1) - 1;
        }
      }
    }
    while (index >= 0) {
      const base = index * 3,
        length = read(base + 1),
        next = read(base + 2) - 1;
      if (
        length >= size &&
        (length === size || recycled >= 0 || count < capacity)
      ) {
        const start = read(base),
          offset = fromEnd ? start + length - size : start;
        // Selection is address-ordered. If this first/highest fit crosses the
        // limit, every later candidate in the search direction is outside too.
        // Reject before changing descriptors, search hints or index maxima.
        if (fromEnd ? offset < limit : offset + size > limit) return undefined;
        if (length === size) {
          if (indexedNode > 0) {
            // Find the closest preceding nonempty leaf to unlink exact fits.
            let predecessor = indexedNode;
            while (predecessor > 1) {
              if (predecessor % 2 === 1 && (maxima[predecessor - 1] ?? 0) > 0) {
                predecessor--;
                while (predecessor < indexLeaves) {
                  predecessor = predecessor * 2 + 1;
                  if ((maxima[predecessor] ?? 0) === 0) predecessor--;
                }
                previous = descriptors[predecessor - indexLeaves] ?? -1;
                break;
              }
              predecessor = Math.floor(predecessor / 2);
            }
          }
          if (previous < 0) freeHead = next;
          else metadata[previous * 3 + 2] = next + 1;
          metadata[base + 2] = 0xffffffff;
        } else {
          let allocated = recycled;
          if (allocated >= 0) recycled = read(allocated * 3) - 1;
          else {
            allocated = count;
            count++;
          }
          metadata[allocated * 3] = offset;
          metadata[allocated * 3 + 1] = size;
          metadata[allocated * 3 + 2] = 0xffffffff;
          metadata[base] = fromEnd ? start : start + size;
          metadata[base + 1] = length - size;
        }
        if (indexedNode === 0 && indexLeaves > 0) {
          for (let hint = cacheBase; hint < metadata.length; hint += 3)
            metadata[hint] = 0;
        }
        if (length === size && indexedNode === 0) {
          // An exact fit unlinks a descriptor. Repair hints whose boundary
          // or predecessor was that descriptor before its slot can be reused.
          for (let hint = cacheBase; hint < metadata.length; hint += 3) {
            if (read(hint) === 0) continue;
            if (read(hint + 1) === index + 1) metadata[hint + 1] = next + 1;
            if (read(hint + 2) === index + 1) metadata[hint + 2] = previous + 1;
          }
        }
        if (!fromEnd) {
          metadata[cache] = units;
          metadata[cache + 1] =
            indexedNode > 0
              ? indexedNode
              : (length === size ? next : index) + 1;
          metadata[cache + 2] = indexedNode > 0 ? 0 : previous + 1;
        }
        if (indexedNode > 0) {
          let maximum = length - size,
            child = indexedNode;
          maxima[child] = maximum;
          while (child > 1) {
            const parent = Math.floor(child / 2);
            if (maxima[parent] !== length) break;
            const sibling =
              maxima[child % 2 === 0 ? child + 1 : child - 1] ?? 0;
            if (sibling > maximum) maximum = sibling;
            if (maximum === length) break;
            maxima[parent] = maximum;
            child = parent;
          }
        } else indexLeaves = 0;
        used += size;
        return offset;
      }
      previous = index;
      index = next;
    }
    return undefined;
  }
  function publish(
    offsets: Uint32Array,
    sizes: Uint32Array,
    length: number,
    retainedBytes: number,
  ): boolean {
    indexLeaves = 0;
    let built = 0,
      cursor = 0,
      head = -1,
      tail = -1;
    for (let i = 0; i <= length; i++) {
      const offset = i === length ? byteLength : offsets[i];
      if (offset === undefined) throw "retained extent invariant";
      if (cursor < offset) {
        metadata[built * 3] = cursor;
        metadata[built * 3 + 1] = offset - cursor;
        metadata[built * 3 + 2] = 0;
        if (tail < 0) head = built;
        else metadata[tail * 3 + 2] = built + 1;
        tail = built++;
      }
      if (i < length) {
        const size = sizes[i];
        if (size === undefined) throw "retained size invariant";
        metadata[built * 3] = offset;
        metadata[built * 3 + 1] = size;
        metadata[built * 3 + 2] = 0xffffffff;
        built++;
        cursor = offset + size;
      }
    }
    metadata.fill(0, built * 3, count * 3);
    count = built;
    used = retainedBytes;
    freeHead = head;
    recycled = -1;
    for (let hint = cacheBase; hint < metadata.length; hint += 3)
      metadata[hint] = 0;
    return true;
  }
  return {
    replaceAllocations: (offsets, sizes, length) => {
      if (
        !Number.isInteger(length) ||
        length < 0 ||
        length > offsets.length ||
        length > sizes.length ||
        overlaps(metadata, offsets) ||
        overlaps(metadata, sizes) ||
        overlaps(offsets, sizes)
      )
        return false;
      let end = 0,
        required = 0,
        retainedBytes = 0;
      for (let i = 0; i < length; i++) {
        const offset = offsets[i],
          size = sizes[i];
        if (
          offset === undefined ||
          size === undefined ||
          offset < end ||
          offset % alignment !== 0 ||
          size === 0 ||
          size % alignment !== 0 ||
          offset + size > byteLength
        )
          return false;
        if (offset > end) required++;
        required++;
        retainedBytes += size;
        end = offset + size;
      }
      if (end < byteLength) required++;
      if (required > capacity) return false;
      return publish(offsets, sizes, length, retainedBytes);
    },
    descriptorCount: () => count,
    disableSearchIndex: () => {
      indexLeaves = 0;
      for (let hint = cacheBase; hint < metadata.length; hint += 3)
        metadata[hint] = 0;
    },
    enableSearchIndex: (descriptors, maxima) => {
      indexLeaves = 0;
      for (let hint = cacheBase; hint < metadata.length; hint += 3)
        metadata[hint] = 0;
      if (
        overlaps(metadata, descriptors) ||
        overlaps(metadata, maxima) ||
        overlaps(descriptors, maxima)
      )
        return false;
      let freeCount = 0;
      for (let free = freeHead; free >= 0; free = read(free * 3 + 2) - 1)
        freeCount++;
      let leaves = 1;
      while (leaves < freeCount) leaves *= 2;
      if (freeCount > descriptors.length || leaves * 2 > maxima.length)
        return false;
      maxima.fill(0, 0, leaves * 2);
      let position = 0;
      for (let free = freeHead; free >= 0; free = read(free * 3 + 2) - 1) {
        descriptors[position] = free;
        maxima[leaves + position] = read(free * 3 + 1);
        position++;
      }
      for (let node = leaves - 1; node > 0; node--)
        maxima[node] = Math.max(
          maxima[node * 2] ?? 0,
          maxima[node * 2 + 1] ?? 0,
        );
      indexDescriptors = descriptors;
      indexMaxima = maxima;
      indexLeaves = leaves;
      return true;
    },
    allocate: (bytes) => place(bytes, false, byteLength),
    allocateFromEnd: (bytes) => place(bytes, true, 0),
    allocateBelow: (bytes, limit) => place(bytes, false, limit),
    allocateAbove: (bytes, limit) => place(bytes, true, limit),
    release: (offset) => {
      let index = find(offset);
      if (index < 0) return false;
      indexLeaves = 0;
      used -= read(index * 3 + 1);
      let previous = -1,
        next = freeHead;
      while (next >= 0 && read(next * 3) < offset) {
        previous = next;
        next = read(next * 3 + 2) - 1;
      }
      metadata[index * 3 + 2] = next + 1;
      if (previous < 0) freeHead = index;
      else metadata[previous * 3 + 2] = index + 1;
      if (
        previous >= 0 &&
        read(previous * 3) + read(previous * 3 + 1) === offset
      ) {
        metadata[previous * 3 + 1] =
          read(previous * 3 + 1) + read(index * 3 + 1);
        metadata[previous * 3 + 2] = next + 1;
        discard(index);
        index = previous;
      }
      if (
        next >= 0 &&
        read(index * 3) + read(index * 3 + 1) === read(next * 3)
      ) {
        metadata[index * 3 + 1] = read(index * 3 + 1) + read(next * 3 + 1);
        metadata[index * 3 + 2] = read(next * 3 + 2);
        discard(next);
      }
      for (let hint = cacheBase; hint < metadata.length; hint += 3)
        metadata[hint] = 0;
      return true;
    },
    releaseAll: (offsets, length) => {
      if (
        !Number.isInteger(length) ||
        length < 0 ||
        length > offsets.length ||
        (metadata.buffer === offsets.buffer &&
          metadata.byteOffset < offsets.byteOffset + offsets.byteLength &&
          offsets.byteOffset < metadata.byteOffset + metadata.byteLength)
      )
        return false;
      for (let index = 0; index < length; index++) {
        const offset = offsets[index],
          previous = offsets[index - 1];
        if (
          offset === undefined ||
          offset >= byteLength ||
          (index > 0 && (previous === undefined || previous >= offset))
        )
          return false;
      }
      if (length === 0) return true;
      let matches = 0;
      for (let index = 0; index < count; index++) {
        if (
          read(index * 3 + 2) === 0xffffffff &&
          requested(offsets, length, read(index * 3))
        )
          matches++;
      }
      if (matches !== length) return false;
      indexLeaves = 0;
      // Remove recycled slots and mark dead allocations before ordering extents.
      const oldCount = count;
      let output = 0;
      for (let index = 0; index < count; index++) {
        const start = read(index * 3),
          size = read(index * 3 + 1);
        if (size === 0) continue;
        let state = read(index * 3 + 2);
        if (state === 0xffffffff && requested(offsets, length, start)) {
          used -= size;
          state = 0;
        }
        // Allocation runs commonly become dead together. Merge neighboring
        // extents now so the sort sees live objects and free runs, not garbage.
        if (
          state !== 0xffffffff &&
          output > 0 &&
          read((output - 1) * 3 + 2) !== 0xffffffff &&
          read((output - 1) * 3) + read((output - 1) * 3 + 1) === start
        ) {
          metadata[(output - 1) * 3 + 1] = read((output - 1) * 3 + 1) + size;
        } else {
          metadata[output * 3] = start;
          metadata[output * 3 + 1] = size;
          metadata[output * 3 + 2] = state;
          output++;
        }
      }
      count = output;
      for (let root = Math.floor(count / 2) - 1; root >= 0; root--)
        sift(root, count);
      for (let end = count - 1; end > 0; end--) {
        swap(0, end);
        sift(0, end);
      }
      output = 0;
      for (let index = 0; index < count; index++) {
        const start = read(index * 3),
          size = read(index * 3 + 1),
          allocated = read(index * 3 + 2) === 0xffffffff;
        if (
          !allocated &&
          output > 0 &&
          read((output - 1) * 3 + 2) !== 0xffffffff
        ) {
          metadata[(output - 1) * 3 + 1] = read((output - 1) * 3 + 1) + size;
        } else {
          metadata[output * 3] = start;
          metadata[output * 3 + 1] = size;
          metadata[output * 3 + 2] = allocated ? 0xffffffff : 0;
          output++;
        }
      }
      for (let word = output * 3; word < oldCount * 3; word++)
        metadata[word] = 0;
      count = output;
      freeHead = -1;
      recycled = -1;
      let previous = -1;
      for (let index = 0; index < count; index++) {
        if (read(index * 3 + 2) === 0xffffffff) continue;
        if (previous < 0) freeHead = index;
        else metadata[previous * 3 + 2] = index + 1;
        previous = index;
      }
      for (let hint = cacheBase; hint < metadata.length; hint += 3)
        metadata[hint] = 0;
      return true;
    },
    retainDescriptors: (ids, length, offsets, sizes) => {
      if (
        !Number.isInteger(length) ||
        length < 0 ||
        length > ids.length ||
        length > offsets.length ||
        length > sizes.length ||
        overlaps(metadata, ids) ||
        overlaps(metadata, offsets) ||
        overlaps(metadata, sizes) ||
        overlaps(ids, offsets) ||
        overlaps(ids, sizes) ||
        overlaps(offsets, sizes)
      )
        return false;
      let end = 0,
        required = 0,
        retainedBytes = 0;
      // Validate survivors and copy their extents before changing any metadata.
      for (let i = 0; i < length; i++) {
        const id = ids[i];
        if (id === undefined || id >= count || read(id * 3 + 2) !== 0xffffffff)
          return false;
        const offset = read(id * 3),
          size = read(id * 3 + 1);
        if (
          size === 0 ||
          offset % alignment !== 0 ||
          size % alignment !== 0 ||
          offset < end ||
          offset + size > byteLength
        )
          return false;
        if (offset > end) required++;
        required++;
        offsets[i] = offset;
        sizes[i] = size;
        retainedBytes += size;
        end = offset + size;
      }
      if (end < byteLength) required++;
      if (required > capacity) return false;
      return publish(offsets, sizes, length, retainedBytes);
    },
    releaseDescriptors: (ids, length) => {
      if (
        !Number.isInteger(length) ||
        length < 0 ||
        length > ids.length ||
        (metadata.buffer === ids.buffer &&
          metadata.byteOffset < ids.byteOffset + ids.byteLength &&
          ids.byteOffset < metadata.byteOffset + metadata.byteLength)
      )
        return false;
      let previousOffset = -1;
      for (let i = 0; i < length; i++) {
        const id = ids[i];
        if (id === undefined || id >= count || read(id * 3 + 2) !== 0xffffffff)
          return false;
        const offset = read(id * 3);
        if (offset <= previousOffset) return false;
        previousOffset = offset;
      }
      if (length === 0) return true;
      // Merge the existing ordered free list and the ordered dead descriptor
      indexLeaves = 0;
      // stream. Allocated descriptors never move; coalesced slots are recycled.
      let free = freeHead,
        dead = 0,
        head = -1,
        previous = -1;
      while (free >= 0 || dead < length) {
        const nextDead = ids[dead];
        let index = -1;
        if (
          dead < length &&
          nextDead !== undefined &&
          (free < 0 || read(nextDead * 3) < read(free * 3))
        ) {
          index = nextDead;
          dead++;
          used -= read(index * 3 + 1);
        } else {
          index = free;
          free = read(index * 3 + 2) - 1;
        }
        if (
          previous >= 0 &&
          read(previous * 3) + read(previous * 3 + 1) === read(index * 3)
        ) {
          metadata[previous * 3 + 1] =
            read(previous * 3 + 1) + read(index * 3 + 1);
          discard(index);
        } else {
          if (previous < 0) head = index;
          else metadata[previous * 3 + 2] = index + 1;
          metadata[index * 3 + 2] = 0;
          previous = index;
        }
      }
      freeHead = head;
      for (let hint = cacheBase; hint < metadata.length; hint += 3)
        metadata[hint] = 0;
      return true;
    },
    allocationSize: (offset) => {
      const index = find(offset);
      return index < 0 ? undefined : read(index * 3 + 1);
    },
    usedBytes: () => used,
  };
}
function overlaps(a: Uint32Array, b: Uint32Array): boolean {
  return (
    a.buffer === b.buffer &&
    a.byteOffset < b.byteOffset + b.byteLength &&
    b.byteOffset < a.byteOffset + a.byteLength
  );
}
function swapInventory(
  offsets: Uint32Array,
  sizes: Uint32Array,
  a: number,
  b: number,
): void {
  const offset = offsets[a],
    size = sizes[a],
    otherOffset = offsets[b],
    otherSize = sizes[b];
  if (
    offset === undefined ||
    size === undefined ||
    otherOffset === undefined ||
    otherSize === undefined
  )
    throw "inventory sort invariant";
  offsets[a] = otherOffset;
  sizes[a] = otherSize;
  offsets[b] = offset;
  sizes[b] = size;
}
function siftInventory(
  offsets: Uint32Array,
  sizes: Uint32Array,
  root: number,
  end: number,
): void {
  while (root * 2 + 1 < end) {
    let child = root * 2 + 1;
    const right = offsets[child + 1],
      left = offsets[child];
    if (left === undefined) throw "inventory child invariant";
    if (child + 1 < end && right !== undefined && right > left) child++;
    const parent = offsets[root],
      value = offsets[child];
    if (parent === undefined || value === undefined)
      throw "inventory parent invariant";
    if (parent >= value) return;
    swapInventory(offsets, sizes, root, child);
    root = child;
  }
}
function overlapsBuckets(words: Uint32Array, buckets: Float64Array): boolean {
  return (
    words.buffer === buckets.buffer &&
    words.byteOffset < buckets.byteOffset + buckets.byteLength &&
    buckets.byteOffset < words.byteOffset + words.byteLength
  );
}
function radixInventory(
  metadata: Uint32Array,
  offsets: Uint32Array,
  sizes: Uint32Array,
  scratch: Uint32Array,
  buckets: Float64Array,
  count: number,
): void {
  // Use two half-word passes when the borrowed workspace and inventory are
  // large enough; otherwise use four byte passes. Both leave descriptors in
  // scratch, with sizes borrowed as the alternating destination.
  const bits = buckets.length >= 65536 && count >= 65536 ? 16 : 8,
    bucketCount = bits === 16 ? 65536 : 256,
    mask = bucketCount - 1;
  let source = scratch,
    target = sizes;
  for (let shift = 0; shift < 32; shift += bits) {
    for (let b = 0; b < bucketCount; b++) buckets[b] = 0;
    for (let i = 0; i < count; i++) {
      const word = source[i];
      if (word === undefined) throw "inventory radix index invariant";
      const key = metadata[word];
      if (key === undefined) throw "inventory radix key invariant";
      const bucket = (key >>> shift) & mask;
      buckets[bucket] = (buckets[bucket] ?? 0) + 1;
    }
    let total = 0;
    for (let b = 0; b < bucketCount; b++) {
      const size = buckets[b];
      if (size === undefined) throw "inventory radix bucket invariant";
      buckets[b] = total;
      total += size;
    }
    for (let i = 0; i < count; i++) {
      const word = source[i];
      if (word === undefined) throw "inventory radix index invariant";
      const key = metadata[word];
      if (key === undefined) throw "inventory radix key invariant";
      const bucket = (key >>> shift) & mask,
        next = buckets[bucket];
      if (next === undefined) throw "inventory radix position invariant";
      target[next] = word;
      buckets[bucket] = next + 1;
    }
    const previous = source;
    source = target;
    target = previous;
  }
  for (let i = 0; i < count; i++) {
    const word = scratch[i];
    if (word === undefined) throw "inventory radix output invariant";
    const offset = metadata[word],
      size = metadata[word + 1];
    if (offset === undefined || size === undefined)
      throw "inventory radix descriptor invariant";
    offsets[i] = offset;
    sizes[i] = size;
    scratch[i] = word / 3;
  }
}
/** Snapshot a quiescent allocator into sorted allocation starts and sizes.
 * Capacity/alias failures write nothing. Other malformed inventories may leave
 * scratch output, which callers must ignore unless a count is returned. */
export function snapshotRegionAllocations(
  metadata: Uint32Array,
  byteLength: number,
  offsets: Uint32Array,
  sizes: Uint32Array,
  scratch?: Uint32Array,
  buckets?: Float64Array,
  activeDescriptors?: number,
): number | undefined {
  const capacity = metadata.length / 3 - 32;
  if (
    activeDescriptors !== undefined &&
    (!Number.isInteger(activeDescriptors) ||
      activeDescriptors < 0 ||
      activeDescriptors > capacity)
  )
    return undefined;
  return snapshotPrefix(
    metadata,
    byteLength,
    offsets,
    sizes,
    scratch,
    buckets,
    (activeDescriptors ?? capacity) * 3,
  );
}
function snapshotPrefix(
  metadata: Uint32Array,
  byteLength: number,
  offsets: Uint32Array,
  sizes: Uint32Array,
  scratch: Uint32Array | undefined,
  buckets: Float64Array | undefined,
  descriptorWords: number,
): number | undefined {
  if (
    !Number.isInteger(byteLength) ||
    byteLength <= 0 ||
    byteLength > 0xffffffff ||
    metadata.length < 99 ||
    metadata.length % 3 !== 0 ||
    overlaps(metadata, offsets) ||
    overlaps(metadata, sizes) ||
    overlaps(offsets, sizes)
  )
    return undefined;
  if (scratch !== undefined || buckets !== undefined) {
    if (scratch === undefined || buckets === undefined) return undefined;
    const temporary = scratch,
      counts = buckets;
    if (
      counts.length < 256 ||
      overlaps(metadata, temporary) ||
      overlaps(offsets, temporary) ||
      overlaps(sizes, temporary) ||
      overlapsBuckets(metadata, counts) ||
      overlapsBuckets(offsets, counts) ||
      overlapsBuckets(sizes, counts) ||
      overlapsBuckets(temporary, counts)
    )
      return undefined;
  }

  let count = 0,
    freeCount = 0,
    freeHead = -1,
    firstFreeOffset = byteLength,
    total = 0;
  for (let word = 0; word < descriptorWords; word += 3) {
    const offset = metadata[word],
      size = metadata[word + 1],
      state = metadata[word + 2];
    if (offset === undefined || size === undefined || state === undefined)
      return undefined;
    if (size === 0) {
      if (state !== 0) return undefined;
      continue;
    }
    if (
      offset >= byteLength ||
      size > byteLength - offset ||
      (state !== 0xffffffff && state > descriptorWords / 3)
    )
      return undefined;
    total += size;
    if (total > byteLength) return undefined;
    if (state === 0xffffffff) count++;
    else {
      freeCount++;
      if (offset < firstFreeOffset) {
        firstFreeOffset = offset;
        freeHead = word / 3;
      }
    }
  }
  if (
    total !== byteLength ||
    count > offsets.length ||
    count > sizes.length ||
    (scratch !== undefined && count > scratch.length)
  )
    return undefined;
  let output = 0,
    previousOffset = -1,
    ordered = true;
  for (let word = 0; word < descriptorWords; word += 3) {
    if (metadata[word + 2] !== 0xffffffff) continue;
    const offset = metadata[word],
      size = metadata[word + 1];
    if (offset === undefined || size === undefined)
      throw "inventory copy invariant";
    if (offset < previousOffset) ordered = false;
    previousOffset = offset;
    offsets[output] = offset;
    sizes[output] = size;
    if (scratch !== undefined) scratch[output] = word;
    output++;
  }
  if (!ordered && scratch !== undefined && buckets !== undefined) {
    radixInventory(metadata, offsets, sizes, scratch, buckets, count);
  } else if (!ordered) {
    for (let root = Math.floor(count / 2) - 1; root >= 0; root--)
      siftInventory(offsets, sizes, root, count);
    for (let end = count - 1; end > 0; end--) {
      swapInventory(offsets, sizes, 0, end);
      siftInventory(offsets, sizes, 0, end);
    }
  }
  if (ordered && scratch !== undefined) {
    const descriptors = scratch;
    for (let i = 0; i < count; i++) {
      const word = descriptors[i];
      if (word === undefined) throw "inventory descriptor invariant";
      descriptors[i] = word / 3;
    }
  }
  let expected = 0,
    allocated = 0,
    free = freeHead,
    visited = 0;
  while (allocated < count || free >= 0) {
    const nextAllocated = offsets[allocated],
      nextFree = free < 0 ? undefined : metadata[free * 3];
    if (
      allocated < count &&
      (free < 0 ||
        (nextAllocated !== undefined &&
          nextFree !== undefined &&
          nextAllocated < nextFree))
    ) {
      const size = sizes[allocated];
      if (nextAllocated !== expected || size === undefined) return undefined;
      expected += size;
      allocated++;
    } else {
      if (free < 0 || free >= descriptorWords / 3 || visited >= freeCount)
        return undefined;
      const size = metadata[free * 3 + 1],
        next = metadata[free * 3 + 2];
      if (
        nextFree !== expected ||
        size === undefined ||
        size === 0 ||
        next === undefined ||
        next === 0xffffffff
      )
        return undefined;
      expected += size;
      free = next - 1;
      visited++;
    }
  }
  return expected === byteLength && visited === freeCount ? count : undefined;
}
