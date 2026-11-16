import type { FunctionIR } from "@tint/ir/scalar";
import {
  nativeStackMapMagic,
  nativeStackMapVersion,
  nativeStackMapWideVersion,
  nativeStackMapTableHeaderBytes,
  nativeStackMapRegisterShift,
} from "@tint/abi/host";

/** A call site at which the collector may walk this frame: the instruction
 * at `index` of `block` (the terminator when index is the instruction count). */
export interface SafepointSite {
  readonly block: number;
  readonly index: number;
}

/** Slots live while each site's call runs (live after it, since a call reads
 * and writes no slots, plus everything live into the block's exception
 * handler, which any instruction of the block may reach), from per-block
 * live-in sets (analyzeLiveSlots over the same tracked slots). Record and
 * cell terminators count as reading their slot, as the block-level analysis
 * does, so the sets stay consistent with its upward-exposed reads. Results
 * are in site order; each lists tracked slots once. */
export function safepointLiveSlots(
  fn: FunctionIR,
  liveIn: readonly (readonly number[] | undefined)[],
  tracked: Uint8Array,
  sites: readonly SafepointSite[],
): (readonly number[])[] {
  const count = fn.slots.length,
    results: (readonly number[])[] = [],
    byBlock = new Map<number, number[]>();
  for (let site = 0; site < sites.length; site++) {
    const at = sites[site];
    if (at === undefined) throw "safepoint site invariant";
    results.push([]);
    const listed = byBlock.get(at.block);
    if (listed === undefined) byBlock.set(at.block, [site]);
    else listed.push(site);
  }
  // Live set as a sparse set (members plus 1-based positions).
  const position = new Uint32Array(count),
    members: number[] = [],
    stamps = new Uint32Array(count);
  let stamp = 0;
  function enter(slot: number): void {
    if (tracked[slot] !== 1) return;
    const at = position[slot] ?? 0;
    if (at > 0 && members[at - 1] === slot) return;
    members.push(slot);
    position[slot] = members.length;
  }
  function leave(slot: number): void {
    const at = position[slot] ?? 0;
    if (at === 0 || members[at - 1] !== slot) return;
    const last = members.pop();
    if (last === undefined) throw "safepoint live set invariant";
    if (last !== slot) {
      members[at - 1] = last;
      position[last] = at;
    }
    position[slot] = 0;
  }
  for (const [blockId, blockSites] of byBlock) {
    const block = fn.blocks[blockId];
    if (block === undefined || block.id !== blockId)
      throw "safepoint block invariant";
    for (const slot of members) if (slot !== undefined) position[slot] = 0;
    members.length = 0;
    const term = block.terminator;
    if (term.kind === "jump")
      for (const slot of liveIn[term.target] ?? [])
        if (slot !== undefined) enter(slot);
    if (
      term.kind === "branch" ||
      term.kind === "record" ||
      term.kind === "record-cell" ||
      term.kind === "cell"
    ) {
      for (const slot of liveIn[term.consequent] ?? [])
        if (slot !== undefined) enter(slot);
      for (const slot of liveIn[term.alternate] ?? [])
        if (slot !== undefined) enter(slot);
      if (term.kind !== "branch") enter(term.slot);
    }
    const handler = block.exception,
      handlerLive = handler === undefined ? [] : (liveIn[handler.target] ?? []);
    // Sites in descending index order.
    const ordered = blockSites.slice();
    ordered.sort((left, right) => {
      const a = sites[left],
        b = sites[right];
      if (a === undefined || b === undefined) throw "safepoint order invariant";
      return b.index - a.index;
    });
    let next = 0;
    for (let index = block.instructions.length; index >= 0; index--) {
      while (next < ordered.length) {
        const site = ordered[next];
        if (site === undefined) throw "safepoint order invariant";
        const at = sites[site];
        if (at === undefined || at.index > index)
          throw "safepoint index invariant";
        if (at.index !== index) break;
        stamp++;
        const live: number[] = [];
        for (const slot of members)
          if (slot !== undefined && stamps[slot] !== stamp) {
            stamps[slot] = stamp;
            live.push(slot);
          }
        for (const slot of handlerLive)
          if (
            slot !== undefined &&
            tracked[slot] === 1 &&
            stamps[slot] !== stamp
          ) {
            stamps[slot] = stamp;
            live.push(slot);
          }
        results[site] = live;
        next++;
      }
      if (index === 0) break;
      const op = block.instructions[index - 1];
      if (op === undefined) throw "safepoint instruction invariant";
      if (op.kind === "store") leave(op.slot);
      else if (op.kind === "load") enter(op.slot);
    }
    if (next !== ordered.length) throw "safepoint site invariant";
  }
  return results;
}

/** One safepoint: its return offset in the module's code and its map words
 * (frame bytes, reference count and stack-pointer-relative offsets, general
 * count and offsets, then the register word: bit i when the frame saves
 * x(19 + i), bit nativeStackMapRegisterShift + i when x(19 + i) holds a live
 * reference, followed by the saved registers' save offsets in register
 * order). */
export interface SafepointEntry {
  readonly offset: number;
  readonly map: readonly number[];
}

/** Packed tables index maps by word in the high bits of a 2^53-safe word. */
const packedMapIndexLimit = 2097152;

/** Table words (see nativeStackMapMagic): header, then the safepoints sorted
 * by return offset, then the distinct maps. A packed table has one word per
 * safepoint (map word index * 2^32 + offset); when a map index would reach
 * 2^21 words, the table is wide (nativeStackMapWideVersion): two words per
 * safepoint, the offset then the map word index. Undefined when two
 * safepoints share a return offset or an offset exceeds 32 bits. */
export function encodeStackMapTable(
  entries: readonly SafepointEntry[],
): number[] | undefined {
  const sorted = entries.slice();
  sorted.sort((left, right) => left.offset - right.offset);
  let previous = -1,
    lastMap = 0;
  const mapIndices = new Map<string, number>(),
    maps: number[] = [],
    /** Each safepoint's map, as a word offset into `maps`. */
    mapOffsets: number[] = [];
  for (const entry of sorted) {
    if (entry === undefined) throw "safepoint entry invariant";
    if (
      !Number.isInteger(entry.offset) ||
      entry.offset <= previous ||
      entry.offset > 0xffffffff
    )
      return undefined;
    previous = entry.offset;
    const key = entry.map.join(",");
    const known = mapIndices.get(key);
    if (known !== undefined) {
      mapOffsets.push(known);
      continue;
    }
    lastMap = maps.length;
    mapIndices.set(key, lastMap);
    mapOffsets.push(lastMap);
    for (const word of entry.map) {
      if (word === undefined) throw "safepoint map invariant";
      maps.push(word);
    }
  }
  const header = nativeStackMapTableHeaderBytes / 8,
    wide = header + sorted.length + lastMap >= packedMapIndexLimit,
    first = header + sorted.length * (wide ? 2 : 1),
    words: number[] = [
      nativeStackMapMagic,
      wide ? nativeStackMapWideVersion : nativeStackMapVersion,
      sorted.length,
    ];
  for (let index = 0; index < sorted.length; index++) {
    const entry = sorted[index],
      at = mapOffsets[index];
    if (entry === undefined || at === undefined)
      throw "safepoint entry invariant";
    if (wide) words.push(entry.offset, first + at);
    else words.push((first + at) * 4294967296 + entry.offset);
  }
  for (const word of maps) if (word !== undefined) words.push(word);
  return words;
}

/** A decoded safepoint (tests and tools): its return offset in the module,
 * the frame's byte size, the stack-pointer-relative words it lists, the
 * callee-saved registers holding live references, and the frame's register
 * saves (register and stack-pointer-relative offset, in register order). */
export interface DecodedSafepoint {
  readonly offset: number;
  readonly frameBytes: number;
  readonly references: readonly number[];
  readonly generals: readonly number[];
  readonly registers: readonly number[];
  readonly saves: readonly { register: number; offset: number }[];
}

function tableWord(code: Uint8Array, offset: number): number {
  let value = 0;
  for (let index = 7; index >= 0; index--)
    value = value * 256 + (code[offset + index] ?? 0);
  return value;
}

/** Decodes every safepoint table of an emitted module, in return order;
 * undefined for a malformed table. */
export function decodeStackMaps(module: {
  readonly code: Uint8Array;
  readonly stackMaps: readonly {
    readonly codeOffset: number;
    readonly tableOffset: number;
  }[];
}): DecodedSafepoint[] | undefined {
  const result: DecodedSafepoint[] = [];
  for (const table of module.stackMaps) {
    if (table === undefined) return undefined;
    const base = table.tableOffset,
      code = module.code;
    const version = tableWord(code, base + 8),
      wide = version === nativeStackMapWideVersion;
    if (
      tableWord(code, base) !== nativeStackMapMagic ||
      (version !== nativeStackMapVersion && !wide)
    )
      return undefined;
    const count = tableWord(code, base + 16);
    for (let index = 0; index < count; index++) {
      const entry =
          base + nativeStackMapTableHeaderBytes + index * (wide ? 16 : 8),
        word = tableWord(code, entry),
        returnOffset = wide ? word : word % 4294967296,
        map =
          base +
          (wide ? tableWord(code, entry + 8) : Math.floor(word / 4294967296)) *
            8,
        references: number[] = [],
        generals: number[] = [];
      const referenceCount = tableWord(code, map + 8);
      for (let at = 0; at < referenceCount; at++)
        references.push(tableWord(code, map + 16 + at * 8));
      const generalBase = map + 16 + referenceCount * 8,
        generalCount = tableWord(code, generalBase);
      for (let at = 0; at < generalCount; at++)
        generals.push(tableWord(code, generalBase + 8 + at * 8));
      const registerBase = generalBase + 8 + generalCount * 8,
        registerWord = tableWord(code, registerBase),
        registerLimit = 1 << nativeStackMapRegisterShift,
        saved = registerWord % registerLimit,
        held = Math.floor(registerWord / registerLimit),
        registers: number[] = [],
        saves: { register: number; offset: number }[] = [];
      if (held >= registerLimit) return undefined;
      let saveAt = registerBase + 8;
      for (let bit = 0; bit < nativeStackMapRegisterShift; bit++) {
        if ((held & (1 << bit)) !== 0) registers.push(19 + bit);
        if ((saved & (1 << bit)) !== 0) {
          saves.push({ register: 19 + bit, offset: tableWord(code, saveAt) });
          saveAt += 8;
        }
      }
      result.push({
        offset: table.codeOffset + returnOffset,
        frameBytes: tableWord(code, map),
        references,
        generals,
        registers,
        saves,
      });
    }
  }
  return result;
}
