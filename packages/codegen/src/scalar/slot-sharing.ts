import type { FunctionIR } from "@tint/ir/scalar";
/** Frame slots of one type whose live ranges never meet share a stack offset.
 * `color[slot]` is the shared group plus one, or 0 for a private offset. */
export interface SlotSharing {
  readonly color: Uint32Array;
  readonly colors: number;
  /** True when a slot other than `slot` in its group is live into `block`;
   * clearing the shared word there would destroy that slot's value. */
  readonly otherLiveIn: (slot: number, block: number) => boolean;
}
/** Verified IR only. A slot occupies a block when it is live into the block
 * or the block accesses it; slots sharing an offset never occupy one block, so
 * no value is overwritten while it may still be read and every safepoint sees
 * either the occupying slot's value or a stale value of the same type.
 * Per-slot backward liveness costs the size of each live range, not
 * slots x blocks. Guarded `read` terminators define their slot only on the
 * consequent edge; `write`/`initialize` terminators read it. A slot live into
 * an exception handler is live throughout every block that may throw to it.
 * Returns undefined when `budget` work units would be exceeded. */
export function shareFrameSlots(
  fn: FunctionIR,
  eligible: (slot: number) => boolean,
  budget: number,
  /** Slots share a word only within one kind (default: the slot type). */
  kind?: (slot: number) => string,
  /** Record live-in owners for `otherLiveIn` queries (required when clearing
   * dead shared slots at block entry; callers with stack maps skip it). */
  trackOwners: boolean = true,
): SlotSharing | undefined {
  const blockCount = fn.blocks.length,
    slotCount = fn.slots.length;
  let work = blockCount + slotCount;
  if (work > budget) return undefined;
  // Predecessor links: (source, slot killed on this edge or -1, exceptional).
  // Heads hold link index + 1; zero ends a predecessor list.
  const heads = new Uint32Array(blockCount);
  let linkCapacity = Math.max(64, blockCount * 2),
    linkCount = 0,
    linkSource = new Int32Array(linkCapacity),
    linkKill = new Int32Array(linkCapacity),
    linkExceptional = new Uint8Array(linkCapacity),
    linkNext = new Int32Array(linkCapacity);
  function link(
    source: number,
    target: number,
    kill: number,
    exceptional: number,
  ): void {
    if (target < 0 || target >= blockCount) throw "slot sharing edge invariant";
    if (linkCount === linkCapacity) {
      const nextCapacity = linkCapacity * 2,
        nextSource = new Int32Array(nextCapacity),
        nextKill = new Int32Array(nextCapacity),
        nextExceptional = new Uint8Array(nextCapacity),
        nextNext = new Int32Array(nextCapacity);
      nextSource.set(linkSource);
      nextKill.set(linkKill);
      nextExceptional.set(linkExceptional);
      nextNext.set(linkNext);
      linkSource = nextSource;
      linkKill = nextKill;
      linkExceptional = nextExceptional;
      linkNext = nextNext;
      linkCapacity = nextCapacity;
    }
    const edge = linkCount++;
    linkSource[edge] = source;
    linkKill[edge] = kill;
    linkExceptional[edge] = exceptional;
    linkNext[edge] = (heads[target] ?? 0) - 1;
    heads[target] = linkCount;
  }
  const defs: number[][] = [],
    refs: number[][] = [],
    seeds: number[][] = [];
  for (let slot = 0; slot < slotCount; slot++) {
    defs.push([]);
    refs.push([]);
    seeds.push([]);
  }
  // Block + 1 of the latest store/reference per slot; zero is none.
  const storedIn = new Uint32Array(slotCount),
    referencedIn = new Uint32Array(slotCount);
  function reference(slot: number, block: number): void {
    if (referencedIn[slot] === block + 1) return;
    referencedIn[slot] = block + 1;
    refs[slot]?.push(block);
  }
  function use(slot: number, block: number): void {
    reference(slot, block);
    if (storedIn[slot] !== block + 1) {
      const list = seeds[slot];
      if (list === undefined) throw "slot sharing seed invariant";
      if (list[list.length - 1] !== block) list.push(block);
    }
  }
  for (let index = 0; index < blockCount; index++) {
    const block = fn.blocks[index];
    if (block === undefined || block.id !== index) return undefined;
    for (const op of block.instructions) {
      if (op === undefined) throw "slot sharing instruction invariant";
      if (++work > budget) return undefined;
      if (op.kind === "load") use(op.slot, index);
      else if (op.kind === "store") {
        reference(op.slot, index);
        if (storedIn[op.slot] !== index + 1) {
          storedIn[op.slot] = index + 1;
          defs[op.slot]?.push(index);
        }
      }
    }
    const term = block.terminator;
    if (term.kind === "jump") link(index, term.target, -1, 0);
    else if (term.kind === "branch") {
      link(index, term.consequent, -1, 0);
      if (term.alternate !== term.consequent)
        link(index, term.alternate, -1, 0);
    } else if (
      term.kind === "cell" ||
      term.kind === "record" ||
      term.kind === "record-cell"
    ) {
      const reads = term.operation === "read";
      if (reads) reference(term.slot, index);
      else use(term.slot, index);
      const distinct = term.alternate !== term.consequent;
      link(index, term.consequent, reads && distinct ? term.slot : -1, 0);
      if (distinct) link(index, term.alternate, -1, 0);
    }
    const handler = block.exception;
    if (handler !== undefined) link(index, handler.target, -1, 1);
  }
  // Per-slot liveness; slot + 1 stamps avoid clearing per-block scratch.
  // Flat typed buffers avoid per-slot managed NumberList overhead on large functions.
  const liveStamp = new Uint32Array(blockCount),
    defStamp = new Uint32Array(blockCount),
    stack = new Uint32Array(blockCount),
    occStart = new Uint32Array(slotCount + 1),
    liveStart = new Uint32Array(trackOwners ? slotCount + 1 : 0);
  let occData = new Uint32Array(Math.max(64, slotCount * 2)),
    occLength = 0,
    liveData = new Uint32Array(trackOwners ? Math.max(64, slotCount * 2) : 0),
    liveLength = 0;
  function growOcc(): void {
    const next = new Uint32Array(occData.length * 2);
    next.set(occData);
    occData = next;
  }
  function growLive(): void {
    const next = new Uint32Array(liveData.length * 2);
    next.set(liveData);
    liveData = next;
  }
  for (let slot = 0; slot < slotCount; slot++) {
    occStart[slot] = occLength;
    if (trackOwners) liveStart[slot] = liveLength;
    if (!eligible(slot)) {
      occStart[slot + 1] = occLength;
      if (trackOwners) liveStart[slot + 1] = liveLength;
      continue;
    }
    const stamp = slot + 1;
    let stackTop = 0;
    for (const block of defs[slot] ?? []) {
      if (block === undefined) throw "slot sharing def invariant";
      defStamp[block] = stamp;
    }
    for (const block of seeds[slot] ?? []) {
      if (block === undefined) throw "slot sharing seed invariant";
      if (liveStamp[block] === stamp) continue;
      liveStamp[block] = stamp;
      if (occLength === occData.length) growOcc();
      occData[occLength++] = block;
      if (trackOwners) {
        if (liveLength === liveData.length) growLive();
        liveData[liveLength++] = block;
      }
      stack[stackTop++] = block;
    }
    while (stackTop > 0) {
      const block = stack[--stackTop] ?? 0;
      for (let at = (heads[block] ?? 0) - 1; at >= 0; at = linkNext[at] ?? -1) {
        if (++work > budget) return undefined;
        if (linkKill[at] === slot) continue;
        const source = linkSource[at] ?? -1;
        if (source < 0) throw "slot sharing link invariant";
        // A throw may precede any store in the source block.
        if (linkExceptional[at] !== 1 && defStamp[source] === stamp) continue;
        if (liveStamp[source] === stamp) continue;
        liveStamp[source] = stamp;
        if (occLength === occData.length) growOcc();
        occData[occLength++] = source;
        if (trackOwners) {
          if (liveLength === liveData.length) growLive();
          liveData[liveLength++] = source;
        }
        stack[stackTop++] = source;
      }
    }
    for (const block of refs[slot] ?? []) {
      if (block === undefined) throw "slot sharing reference invariant";
      if (liveStamp[block] !== stamp) {
        if (occLength === occData.length) growOcc();
        occData[occLength++] = block;
      }
    }
    const occupiedCount = occLength - (occStart[slot] ?? 0);
    occStart[slot + 1] = occLength;
    if (trackOwners) liveStart[slot + 1] = liveLength;
    work += occupiedCount;
    if (work > budget) return undefined;
  }
  // Greedy grouping by type in order of first occupied block (counting sort
  // preserves ascending slot tie-breaking in linear time).
  const first = new Uint32Array(slotCount).fill(blockCount),
    firstCounts = new Uint32Array(blockCount + 1);
  let orderCount = 0;
  for (let slot = 0; slot < slotCount; slot++) {
    const start = occStart[slot] ?? 0,
      end = occStart[slot + 1] ?? 0;
    if (start === end || !eligible(slot)) continue;
    let minimum = blockCount;
    for (let at = start; at < end; at++) {
      const block = occData[at] ?? 0;
      if (block < minimum) minimum = block;
    }
    first[slot] = minimum;
    firstCounts[minimum + 1] = (firstCounts[minimum + 1] ?? 0) + 1;
    orderCount++;
  }
  for (let block = 0; block < blockCount; block++)
    firstCounts[block + 1] =
      (firstCounts[block + 1] ?? 0) + (firstCounts[block] ?? 0);
  const order = new Uint32Array(orderCount);
  for (let slot = 0; slot < slotCount; slot++) {
    const minimum = first[slot] ?? blockCount;
    if (minimum >= blockCount) continue;
    const position = firstCounts[minimum] ?? 0;
    firstCounts[minimum] = position + 1;
    order[position] = slot;
  }
  const color = new Uint32Array(slotCount),
    blockWords = (blockCount + 31) >>> 5;
  // Probe at most the first 64 groups of each kind; groups past that cap are
  // never probed again and need no occupancy bitset.
  let groupCount = 0;
  const probedByType = new Map<
    string,
    { readonly group: number; readonly bits: Uint32Array }[]
  >();
  for (let orderIndex = 0; orderIndex < orderCount; orderIndex++) {
    const slot = order[orderIndex] ?? 0;
    const type = kind === undefined ? (fn.slots[slot] ?? "") : kind(slot);
    const start = occStart[slot] ?? 0,
      end = occStart[slot + 1] ?? 0;
    let candidates = probedByType.get(type);
    if (candidates === undefined) {
      candidates = [];
      probedByType.set(type, candidates);
    }
    let chosen = -1,
      chosenBits: Uint32Array | undefined;
    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      if (candidate === undefined) throw "slot sharing candidate invariant";
      const bits = candidate.bits;
      let free = true;
      for (let at = start; at < end; at++) {
        if (++work > budget) return undefined;
        const block = occData[at] ?? 0;
        if (((bits[block >>> 5] ?? 0) & (1 << (block & 31))) !== 0) {
          free = false;
          break;
        }
      }
      if (free) {
        chosen = candidate.group;
        chosenBits = bits;
        break;
      }
    }
    if (chosen < 0) {
      chosen = groupCount++;
      if (candidates.length < 64) {
        chosenBits = new Uint32Array(blockWords);
        candidates.push({ group: chosen, bits: chosenBits });
      }
      work += blockCount >>> 3;
      if (work > budget) return undefined;
    }
    if (chosenBits !== undefined)
      for (let at = start; at < end; at++) {
        const block = occData[at] ?? 0;
        const word = block >>> 5;
        chosenBits[word] = (chosenBits[word] ?? 0) | (1 << (block & 31));
      }
    color[slot] = chosen + 1;
  }
  // Release occupancy scratch before returning so no temporary coloring buffers
  // stay live if the caller later queries `otherLiveIn`.
  occData = new Uint32Array(0);
  probedByType.clear();
  return {
    color,
    colors: groupCount,
    otherLiveIn: trackOwners
      ? createDeferredOwnerLookup(
          color,
          groupCount,
          slotCount,
          blockWords,
          liveStart,
          liveData,
        )
      : disabledOtherLiveIn,
  };
}
function disabledOtherLiveIn(_slot: number, _block: number): boolean {
  throw "slot sharing owner tracking disabled";
}
/** Builds the `otherLiveIn` index lazily on the first actual query and releases
 * the raw live-in rows immediately afterward. Chooses whichever representation
 * is smaller between packed bit rows (O(1) bit test using disjoint same-group
 * occupancy) and an open-addressed hash table for sparse live-in sets. */
function createDeferredOwnerLookup(
  color: Uint32Array,
  groupCount: number,
  slotCount: number,
  blockWords: number,
  initialLiveStart: Uint32Array,
  initialLiveData: Uint32Array,
): (slot: number, block: number) => boolean {
  let built = false,
    liveStart: Uint32Array = initialLiveStart,
    liveData: Uint32Array = initialLiveData,
    mode = 0, // 0 = empty, 1 = packed bit rows, 2 = open-addressed hash table
    groupRow = new Uint32Array(0),
    slotRow = new Uint32Array(0),
    groupLiveBits = new Uint32Array(0),
    slotLiveBits = new Uint32Array(0),
    ownerMask = 0,
    ownerGroup = new Uint32Array(0),
    ownerBlock = new Uint32Array(0),
    ownerSlot = new Uint32Array(0);
  function ownerHome(group: number, block: number): number {
    let mixed = Math.imul(group + 1, 0x9e3779b1) ^ block;
    mixed = Math.imul(mixed ^ (mixed >>> 16), 0x85ebca6b);
    return (mixed ^ (mixed >>> 13)) & ownerMask;
  }
  function ownerAt(group: number, block: number): number {
    let at = ownerHome(group, block);
    while (
      ownerGroup[at] !== 0 &&
      (ownerGroup[at] !== group + 1 || ownerBlock[at] !== block)
    )
      at = (at + 1) & ownerMask;
    return at;
  }
  function build(): void {
    built = true;
    const members = new Uint32Array(groupCount);
    for (let slot = 0; slot < slotCount; slot++) {
      const group = (color[slot] ?? 0) - 1;
      if (group >= 0) members[group] = (members[group] ?? 0) + 1;
    }
    let sharedGroups = 0,
      sharedSlots = 0,
      liveTotal = 0;
    for (let group = 0; group < groupCount; group++)
      if ((members[group] ?? 0) > 1) sharedGroups++;
    for (let slot = 0; slot < slotCount; slot++) {
      const group = (color[slot] ?? 0) - 1;
      if (group < 0 || (members[group] ?? 0) <= 1) continue;
      sharedSlots++;
      liveTotal += (liveStart[slot + 1] ?? 0) - (liveStart[slot] ?? 0);
    }
    if (liveTotal === 0) {
      liveStart = new Uint32Array(0);
      liveData = new Uint32Array(0);
      mode = 0;
      return;
    }
    let ownerCapacity = 16;
    while (ownerCapacity < liveTotal * 2 + 1) ownerCapacity *= 2;
    const hashBytes = ownerCapacity * 12,
      packedGroupWords = sharedGroups * blockWords,
      packedSlotWords = sharedSlots * blockWords,
      packedBytes =
        (packedGroupWords + packedSlotWords) * 4 + (groupCount + slotCount) * 4;
    if (
      packedBytes < hashBytes &&
      packedGroupWords <= 0x3fffffff &&
      packedSlotWords <= 0x3fffffff
    ) {
      // Same-group slots have disjoint occupancy, so at most one slot in a
      // group is live-in at any block: another slot is live-in iff the group
      // bit is set and `slot`'s own bit is clear.
      groupRow = new Uint32Array(groupCount);
      let nextGroup = 1;
      for (let group = 0; group < groupCount; group++)
        if ((members[group] ?? 0) > 1) groupRow[group] = nextGroup++;
      slotRow = new Uint32Array(slotCount);
      groupLiveBits = new Uint32Array(packedGroupWords);
      slotLiveBits = new Uint32Array(packedSlotWords);
      let nextSlot = 1;
      for (let slot = 0; slot < slotCount; slot++) {
        const group = (color[slot] ?? 0) - 1;
        if (group < 0) continue;
        const gRow = (groupRow[group] ?? 0) - 1;
        if (gRow < 0) continue;
        const sRow = nextSlot - 1;
        slotRow[slot] = nextSlot++;
        const gBase = gRow * blockWords,
          sBase = sRow * blockWords,
          lStart = liveStart[slot] ?? 0,
          lEnd = liveStart[slot + 1] ?? 0;
        for (let at = lStart; at < lEnd; at++) {
          const block = liveData[at] ?? 0,
            word = block >>> 5,
            bit = 1 << (block & 31);
          groupLiveBits[gBase + word] =
            (groupLiveBits[gBase + word] ?? 0) | bit;
          slotLiveBits[sBase + word] = (slotLiveBits[sBase + word] ?? 0) | bit;
        }
      }
      mode = 1;
    } else {
      ownerMask = ownerCapacity - 1;
      ownerGroup = new Uint32Array(ownerCapacity);
      ownerBlock = new Uint32Array(ownerCapacity);
      ownerSlot = new Uint32Array(ownerCapacity);
      for (let slot = 0; slot < slotCount; slot++) {
        const group = (color[slot] ?? 0) - 1;
        if (group < 0 || (members[group] ?? 0) <= 1) continue;
        const lStart = liveStart[slot] ?? 0,
          lEnd = liveStart[slot + 1] ?? 0;
        for (let at = lStart; at < lEnd; at++) {
          const block = liveData[at] ?? 0,
            pos = ownerAt(group, block);
          ownerGroup[pos] = group + 1;
          ownerBlock[pos] = block;
          ownerSlot[pos] = slot;
        }
      }
      mode = 2;
    }
    liveStart = new Uint32Array(0);
    liveData = new Uint32Array(0);
  }
  return (slot: number, block: number): boolean => {
    const group = (color[slot] ?? 0) - 1;
    if (group < 0) return false;
    if (!built) build();
    if (mode === 0) return false;
    if (mode === 1) {
      const gRow = (groupRow[group] ?? 0) - 1;
      if (gRow < 0) return false;
      const word = block >>> 5;
      if (word >= blockWords) return false;
      const bit = 1 << (block & 31);
      if (((groupLiveBits[gRow * blockWords + word] ?? 0) & bit) === 0)
        return false;
      const sRow = (slotRow[slot] ?? 0) - 1;
      return (
        sRow < 0 || ((slotLiveBits[sRow * blockWords + word] ?? 0) & bit) === 0
      );
    }
    const at = ownerAt(group, block);
    return ownerGroup[at] !== 0 && ownerSlot[at] !== slot;
  };
}
