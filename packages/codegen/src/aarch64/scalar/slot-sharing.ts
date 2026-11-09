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
): SlotSharing | undefined {
  const blockCount = fn.blocks.length,
    slotCount = fn.slots.length;
  let work = blockCount + slotCount;
  if (work > budget) return undefined;
  // Predecessor links: (source, slot killed on this edge or -1, exceptional).
  // Heads hold link index + 1; zero ends a predecessor list.
  const heads = new Uint32Array(blockCount),
    linkSource: number[] = [],
    linkKill: number[] = [],
    linkExceptional: number[] = [],
    linkNext: number[] = [];
  function link(
    source: number,
    target: number,
    kill: number,
    exceptional: number,
  ): void {
    if (target < 0 || target >= blockCount) throw "slot sharing edge invariant";
    linkSource.push(source);
    linkKill.push(kill);
    linkExceptional.push(exceptional);
    linkNext.push((heads[target] ?? 0) - 1);
    heads[target] = linkSource.length;
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
  const liveStamp = new Uint32Array(blockCount),
    defStamp = new Uint32Array(blockCount),
    occupancy: number[][] = [],
    liveIns: number[][] = [];
  const stack: number[] = [];
  for (let slot = 0; slot < slotCount; slot++) {
    const occupied: number[] = [],
      liveIn: number[] = [];
    occupancy.push(occupied);
    liveIns.push(liveIn);
    if (!eligible(slot)) continue;
    const stamp = slot + 1;
    for (const block of defs[slot] ?? []) {
      if (block === undefined) throw "slot sharing def invariant";
      defStamp[block] = stamp;
    }
    for (const block of seeds[slot] ?? []) {
      if (block === undefined) throw "slot sharing seed invariant";
      if (liveStamp[block] === stamp) continue;
      liveStamp[block] = stamp;
      liveIn.push(block);
      stack.push(block);
    }
    while (stack.length > 0) {
      const block = stack.pop();
      if (block === undefined) throw "slot sharing stack invariant";
      for (let at = (heads[block] ?? 0) - 1; at >= 0; at = linkNext[at] ?? -1) {
        if (++work > budget) return undefined;
        if (linkKill[at] === slot) continue;
        const source = linkSource[at] ?? -1;
        if (source < 0) throw "slot sharing link invariant";
        // A throw may precede any store in the source block.
        if (linkExceptional[at] !== 1 && defStamp[source] === stamp) continue;
        if (liveStamp[source] === stamp) continue;
        liveStamp[source] = stamp;
        liveIn.push(source);
        stack.push(source);
      }
    }
    for (const block of liveIn) {
      if (block === undefined) throw "slot sharing live invariant";
      occupied.push(block);
    }
    for (const block of refs[slot] ?? []) {
      if (block === undefined) throw "slot sharing reference invariant";
      if (liveStamp[block] !== stamp) occupied.push(block);
    }
    work += occupied.length;
    if (work > budget) return undefined;
  }
  // Greedy grouping by type in order of first occupied block.
  const order: number[] = [];
  const first = new Uint32Array(slotCount).fill(blockCount);
  for (let slot = 0; slot < slotCount; slot++) {
    const occupied = occupancy[slot];
    if (occupied === undefined || !eligible(slot) || occupied.length === 0)
      continue;
    let minimum = blockCount;
    for (const block of occupied)
      if (block !== undefined && block < minimum) minimum = block;
    first[slot] = minimum;
    order.push(slot);
  }
  order.sort((a, b) => (first[a] ?? 0) - (first[b] ?? 0) || a - b);
  const color = new Uint32Array(slotCount);
  const groupType: string[] = [],
    groupBlocks: Uint8Array[] = [],
    liveOwner = new Map<number, number>();
  for (const slot of order) {
    if (slot === undefined) throw "slot sharing order invariant";
    const type = fn.slots[slot];
    const occupied = occupancy[slot];
    if (type === undefined || occupied === undefined)
      throw "slot sharing slot invariant";
    let chosen = -1,
      tried = 0;
    for (let group = 0; group < groupType.length && tried < 64; group++) {
      if (groupType[group] !== type) continue;
      tried++;
      const blocks = groupBlocks[group];
      if (blocks === undefined) throw "slot sharing group invariant";
      let free = true;
      for (const block of occupied) {
        if (++work > budget) return undefined;
        if (block !== undefined && blocks[block] === 1) {
          free = false;
          break;
        }
      }
      if (free) {
        chosen = group;
        break;
      }
    }
    if (chosen < 0) {
      chosen = groupType.length;
      groupType.push(type);
      groupBlocks.push(new Uint8Array(blockCount));
      work += blockCount >>> 3;
      if (work > budget) return undefined;
    }
    const blocks = groupBlocks[chosen];
    if (blocks === undefined) throw "slot sharing group invariant";
    for (const block of occupied) if (block !== undefined) blocks[block] = 1;
    for (const block of liveIns[slot] ?? [])
      if (block !== undefined) liveOwner.set(chosen * blockCount + block, slot);
    color[slot] = chosen + 1;
  }
  return {
    color,
    colors: groupType.length,
    otherLiveIn: (slot: number, block: number): boolean => {
      const group = (color[slot] ?? 0) - 1;
      if (group < 0) return false;
      const owner = liveOwner.get(group * blockCount + block);
      return owner !== undefined && owner !== slot;
    },
  };
}
