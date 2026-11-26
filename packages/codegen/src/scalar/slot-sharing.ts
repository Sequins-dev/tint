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
  // Live-in owners by (group, block) in an open-addressed table: slots of one
  // group never occupy the same block, so each key has at most one owner. A
  // Map here held one managed entry per live-in block (a tenth of the
  // compiler's self-compile). Capacity is a power of two above twice the
  // live-in total, so probing always reaches an empty slot.
  let ownerCapacity = 0;
  if (trackOwners) {
    let liveTotal = 0;
    for (let index = 0; index < orderCount; index++) {
      const slot = order[index] ?? 0;
      liveTotal += (liveStart[slot + 1] ?? 0) - (liveStart[slot] ?? 0);
    }
    ownerCapacity = 16;
    while (ownerCapacity < liveTotal * 2 + 1) ownerCapacity *= 2;
  }
  const ownerMask = ownerCapacity > 0 ? ownerCapacity - 1 : 0,
    ownerGroup = new Uint32Array(ownerCapacity),
    ownerBlock = new Uint32Array(ownerCapacity),
    ownerSlot = new Uint32Array(ownerCapacity);
  function ownerHome(group: number, block: number): number {
    let mixed = Math.imul(group + 1, 0x9e3779b1) ^ block;
    mixed = Math.imul(mixed ^ (mixed >>> 16), 0x85ebca6b);
    return (mixed ^ (mixed >>> 13)) & ownerMask;
  }
  function ownerAt(group: number, block: number): number {
    // Position holding (group, block), or the empty position ending its probe.
    let at = ownerHome(group, block);
    while (
      ownerGroup[at] !== 0 &&
      (ownerGroup[at] !== group + 1 || ownerBlock[at] !== block)
    )
      at = (at + 1) & ownerMask;
    return at;
  }
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
    if (trackOwners) {
      const lStart = liveStart[slot] ?? 0,
        lEnd = liveStart[slot + 1] ?? 0;
      for (let at = lStart; at < lEnd; at++) {
        const block = liveData[at] ?? 0;
        const pos = ownerAt(chosen, block);
        ownerGroup[pos] = chosen + 1;
        ownerBlock[pos] = block;
        ownerSlot[pos] = slot;
      }
    }
    color[slot] = chosen + 1;
  }
  // Release temporary flat buffers so the returned `otherLiveIn` closure
  // retains only the owner lookup tables.
  occData = new Uint32Array(0);
  liveData = new Uint32Array(0);
  return {
    color,
    colors: groupCount,
    otherLiveIn: (slot: number, block: number): boolean => {
      if (ownerCapacity === 0) throw "slot sharing owner tracking disabled";
      const group = (color[slot] ?? 0) - 1;
      if (group < 0) return false;
      const at = ownerAt(group, block);
      return ownerGroup[at] !== 0 && ownerSlot[at] !== slot;
    },
  };
}
