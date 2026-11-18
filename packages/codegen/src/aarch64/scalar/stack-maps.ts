import type { FunctionIR } from "@tint/ir/scalar";
import {
  nativeStackMapMagic,
  nativeStackMapVersion,
  nativeStackMapWideVersion,
  nativeStackMapCompactVersion,
  nativeStackMapRecordShift,
  nativeStackMapRecordLimit,
  nativeStackMapStreamBytes,
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
 * live-in sets (analyzeLiveSlotsPrecisely over the same tracked slots).
 * Guarded writes and initializations (record, record-cell and cell
 * terminators) read their slot. A guarded read writes its slot on the
 * consequent edge only, as the block-level analysis models it: the slot is
 * live before it only when the alternate edge needs the old value, so a dead
 * value is not kept as a root until a later read overwrites its slot.
 * Results are in site order; each lists tracked slots once. */
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
      const written =
        term.kind !== "branch" &&
        term.operation === "read" &&
        term.alternate !== term.consequent
          ? term.slot
          : -1;
      for (const slot of liveIn[term.consequent] ?? [])
        if (slot !== undefined && slot !== written) enter(slot);
      for (const slot of liveIn[term.alternate] ?? [])
        if (slot !== undefined) enter(slot);
      if (term.kind !== "branch" && written < 0) enter(term.slot);
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

/** One safepoint: its return offset in the module's code, the start offset
 * of the function holding the call, and its map words (frame bytes,
 * reference count and stack-pointer-relative offsets, general count and
 * offsets, then the register word: bit i when the frame saves x(19 + i), bit
 * nativeStackMapRegisterShift + i when x(19 + i) holds a live reference,
 * followed by the saved registers' save offsets in register order). Every
 * safepoint of a function has the same frame bytes and saves. */
export interface SafepointEntry {
  readonly offset: number;
  readonly start: number;
  readonly map: readonly number[];
}

/** Run lengths tried for a function's long-lived words (Infinity: none). */
const longRunCandidates = [2, 4, 8, 16, 32, 64, 128, 256, Infinity];
/** A long section is decoded whole at every visit of the frame: its words
 * must be listed at least this fraction of the function's safepoints, so a
 * visit decodes at most twice the runs it uses. */
const longCoverage = 0.5;
const registerLimit = 1 << nativeStackMapRegisterShift;
const unitWords = [3, 2, 1];
const unitScales = [65536, 67108864, 9007199254740992];

function varintBytes(value: number): number {
  let bytes = 1;
  while (value >= 128) {
    value = Math.floor(value / 128);
    bytes++;
  }
  return bytes;
}
function pushVarint(out: number[], value: number): void {
  while (value >= 128) {
    const low = value % 128;
    out.push(low + 128);
    value = (value - low) / 128;
  }
  out.push(value);
}

/** One function's safepoints, in return order. */
interface FunctionSafepoints {
  readonly start: number;
  readonly entries: SafepointEntry[];
}

/** A function's record words (see encodeStackMapTable); its first word, the
 * distance from the function, is set once the record's position is known. */
function encodeFunctionRecord(fn: FunctionSafepoints): number[] | undefined {
  const entries = fn.entries,
    count = entries.length,
    first = entries[0];
  if (first === undefined) throw "safepoint function invariant";
  const firstMap = first.map,
    frameBytes = firstMap[0] ?? -1;
  // Per safepoint: its sorted keys (word index * 2 + general) and held mask.
  const keys: number[][] = [],
    held: number[] = [];
  let saved = -1,
    saveOffsets: number[] = [];
  for (let k = 0; k < count; k++) {
    const entry = entries[k];
    if (entry === undefined) throw "safepoint entry invariant";
    const map = entry.map;
    if (map[0] !== frameBytes) return undefined;
    const referenceCount = map[1] ?? -1,
      generalAt = 2 + referenceCount,
      generalCount = map[generalAt] ?? -1,
      registerAt = generalAt + 1 + generalCount,
      registerWord = map[registerAt] ?? -1;
    if (referenceCount < 0 || generalCount < 0 || registerWord < 0)
      return undefined;
    const list: number[] = [];
    for (let at = 0; at < referenceCount; at++) {
      const offset = map[2 + at] ?? -1;
      if (offset < 0 || offset % 8 !== 0) return undefined;
      list.push((offset / 8) * 2);
    }
    for (let at = 0; at < generalCount; at++) {
      const offset = map[generalAt + 1 + at] ?? -1;
      if (offset < 0 || offset % 8 !== 0) return undefined;
      list.push((offset / 8) * 2 + 1);
    }
    list.sort((left, right) => left - right);
    keys.push(list);
    const savedMask = registerWord % registerLimit,
      saves = map.slice(registerAt + 1);
    if (saved < 0) {
      saved = savedMask;
      saveOffsets = saves.slice();
    } else {
      if (savedMask !== saved || saves.length !== saveOffsets.length)
        return undefined;
      for (let at = 0; at < saves.length; at++)
        if (saves[at] !== saveOffsets[at]) return undefined;
    }
    held.push(Math.floor(registerWord / registerLimit));
  }
  if (frameBytes < 0 || frameBytes % 16 !== 0) return undefined;
  // Runs of consecutive safepoints listing each key: [start, end) pairs.
  const runs = new Map<number, number[]>(),
    ordered: number[] = [];
  for (let k = 0; k < count; k++) {
    const listed = keys[k];
    if (listed === undefined) throw "safepoint key invariant";
    for (const key of listed) {
      if (key === undefined) throw "safepoint key invariant";
      const list = runs.get(key);
      if (list === undefined) {
        const fresh: number[] = [k, k + 1];
        runs.set(key, fresh);
        ordered.push(key);
      } else if (list[list.length - 1] === k) list[list.length - 1] = k + 1;
      else {
        list.push(k);
        list.push(k + 1);
      }
    }
  }
  ordered.sort((left, right) => left - right);
  // The run length whose estimated size is least among those whose long
  // words cover enough of the function.
  let bestLength = Infinity,
    bestCost = Infinity;
  for (const length of longRunCandidates) {
    if (length === undefined) throw "safepoint run length invariant";
    let longKeys = 0,
      covered = 0,
      cost = 0,
      previous = -1;
    for (const key of ordered) {
      if (key === undefined) throw "safepoint key invariant";
      const list = runs.get(key);
      if (list === undefined) throw "safepoint run invariant";
      let longRuns = 0,
        end = 0,
        bytes = 0;
      for (let at = 0; at < list.length; at += 2) {
        const from = list[at] ?? 0,
          to = list[at + 1] ?? 0;
        if (to - from >= length) {
          longRuns++;
          bytes += varintBytes(from - end) + varintBytes(to - from - 1);
          end = to;
          covered += to - from;
        } else cost += (to - from) * 1.5;
      }
      if (longRuns > 0) {
        longKeys++;
        cost += bytes + varintBytes(key - previous - 1) + varintBytes(longRuns);
        previous = key;
      }
    }
    if (longKeys > 0 && covered < longCoverage * longKeys * count) continue;
    if (cost < bestCost) {
      bestCost = cost;
      bestLength = length;
    }
  }
  const stream: number[] = [];
  pushVarint(stream, frameBytes / 16);
  pushVarint(stream, saved);
  for (const offset of saveOffsets) {
    if (offset === undefined || offset % 8 !== 0) return undefined;
    pushVarint(stream, offset / 8);
  }
  // Long section: keys ascending, each with its runs.
  const residual: number[][] = [],
    longSection: number[] = [];
  for (let k = 0; k < count; k++) {
    const empty: number[] = [];
    residual.push(empty);
  }
  let longKeys = 0,
    previous = -1;
  for (const key of ordered) {
    if (key === undefined) throw "safepoint key invariant";
    const list = runs.get(key),
      kept: number[] = [];
    if (list === undefined) throw "safepoint run invariant";
    for (let at = 0; at < list.length; at += 2) {
      const from = list[at] ?? 0,
        to = list[at + 1] ?? 0;
      if (to - from >= bestLength) {
        kept.push(from);
        kept.push(to);
      } else
        for (let k = from; k < to; k++) {
          const target = residual[k];
          if (target === undefined) throw "safepoint residual invariant";
          target.push(key);
        }
    }
    if (kept.length === 0) continue;
    longKeys++;
    pushVarint(longSection, key - previous - 1);
    previous = key;
    pushVarint(longSection, kept.length / 2);
    let end = 0;
    for (let at = 0; at < kept.length; at += 2) {
      const from = kept[at] ?? 0,
        to = kept[at + 1] ?? 0;
      pushVarint(longSection, from - end);
      pushVarint(longSection, to - from - 1);
      end = to;
    }
  }
  pushVarint(stream, longKeys);
  for (const byte of longSection) if (byte !== undefined) stream.push(byte);
  // Residual records, shared by equal safepoints of the function.
  const positions: number[] = [],
    known = new Map<string, number>();
  for (let k = 0; k < count; k++) {
    const list = residual[k],
      mask = held[k] ?? 0;
    if (list === undefined) throw "safepoint residual invariant";
    const key = mask + ":" + list.join(",");
    const at = known.get(key);
    if (at !== undefined) {
      positions.push(at);
      continue;
    }
    known.set(key, stream.length);
    positions.push(stream.length);
    pushVarint(stream, mask);
    pushVarint(stream, list.length);
    let last = -1;
    for (const word of list) {
      if (word === undefined) throw "safepoint residual invariant";
      pushVarint(stream, word - last - 1);
      last = word;
    }
  }
  // Units: return offsets (from the function start, in instructions), then
  // residual positions (stream bytes); the narrowest width that holds both.
  const units: number[] = [];
  for (const entry of entries) {
    if (entry === undefined) throw "safepoint entry invariant";
    const delta = entry.offset - fn.start;
    if (delta <= 0 || delta % 4 !== 0) return undefined;
    units.push(delta / 4);
  }
  for (const position of positions)
    if (position !== undefined) units.push(position);
  let largest = 0;
  for (const unit of units)
    if (unit !== undefined) largest = Math.max(largest, unit);
  const width = largest < 65536 ? 0 : largest < 67108864 ? 1 : 2,
    perWord = unitWords[width] ?? 1,
    scale = unitScales[width] ?? 1;
  const words: number[] = [0, count * 4 + width];
  for (let at = 0; at < units.length; at += perWord) {
    let word = 0,
      factor = 1;
    for (let part = 0; part < perWord && at + part < units.length; part++) {
      word += (units[at + part] ?? 0) * factor;
      factor *= scale;
    }
    words.push(word);
  }
  for (let at = 0; at < stream.length; at += nativeStackMapStreamBytes) {
    let word = 0,
      factor = 1;
    for (
      let part = 0;
      part < nativeStackMapStreamBytes && at + part < stream.length;
      part++
    ) {
      word += (stream[at + part] ?? 0) * factor;
      factor *= 256;
    }
    words.push(word);
  }
  return words;
}

/** Table words (see nativeStackMapMagic) for a module whose table starts at
 * byte `tableOffset` of its code. A compact table (nativeStackMapCompactVersion)
 * holds the function count, then a directory sorted by function start (one
 * word each: start / 4 + record word index * 2^30, the index counted from
 * the table), then each function's record:
 *
 *   word 0  the record's byte distance from its function's start
 *   word 1  safepoint count * 4 + unit width (0: three 16-bit units per
 *           word, 1: two 26-bit, 2: one per word)
 *   units   each safepoint's return offset from the function start / 4,
 *           ascending, then each one's residual position (stream byte)
 *   stream  varints, six bytes per word (little-endian, words below 2^53):
 *           frame bytes / 16, saved register mask, save offsets / 8 in
 *           register order; long word count, then per long word its key
 *           delta (key = sp-relative word index * 2 + general, ascending,
 *           delta from the previous key plus one), run count and runs
 *           (gap from the previous run's end, length - 1) over safepoint
 *           indexes; then residual records: held register mask, count and
 *           key deltas.
 *
 * A safepoint lists the long words whose runs contain its index and its
 * residual record's words. Modules whose offsets reach 2^32 or whose
 * records pass the directory's index range get a wide table
 * (nativeStackMapWideVersion): two words per safepoint (return offset, map
 * word index) and maps of full words. Undefined when two safepoints share a
 * return offset or a function's maps disagree on its frame. */
export function encodeStackMapTable(
  entries: readonly SafepointEntry[],
  tableOffset: number,
): number[] | undefined {
  const sorted = entries.slice();
  sorted.sort((left, right) => left.offset - right.offset);
  const functions: FunctionSafepoints[] = [];
  let previous = -1,
    wide = false;
  for (const entry of sorted) {
    if (entry === undefined) throw "safepoint entry invariant";
    if (!Number.isInteger(entry.offset) || entry.offset <= previous)
      return undefined;
    previous = entry.offset;
    if (entry.offset > 0xffffffff) wide = true;
    const last = functions[functions.length - 1];
    if (last !== undefined && last.start === entry.start)
      last.entries.push(entry);
    else {
      if (last !== undefined && entry.start < last.start) return undefined;
      const first: SafepointEntry[] = [entry];
      functions.push({ start: entry.start, entries: first });
    }
  }
  if (!wide) {
    const records: number[][] = [];
    for (const fn of functions) {
      if (fn === undefined) throw "safepoint function invariant";
      const record = encodeFunctionRecord(fn);
      if (record === undefined) return undefined;
      records.push(record);
    }
    const header = nativeStackMapTableHeaderBytes / 8,
      words: number[] = [
        nativeStackMapMagic,
        nativeStackMapCompactVersion,
        functions.length,
      ];
    let at = header + functions.length;
    for (let index = 0; index < functions.length; index++) {
      const fn = functions[index],
        record = records[index];
      if (fn === undefined || record === undefined)
        throw "safepoint record invariant";
      if (at >= nativeStackMapRecordLimit || tableOffset + at * 8 <= fn.start) {
        wide = true;
        break;
      }
      words.push(fn.start / 4 + at * nativeStackMapRecordShift);
      record[0] = tableOffset + at * 8 - fn.start;
      at += record.length;
    }
    if (!wide) {
      for (const record of records) {
        if (record === undefined) throw "safepoint record invariant";
        for (const word of record) if (word !== undefined) words.push(word);
      }
      return words;
    }
  }
  return encodeWideStackMapTable(sorted);
}

/** The wide table of `sorted` safepoints (see encodeStackMapTable). */
function encodeWideStackMapTable(sorted: readonly SafepointEntry[]): number[] {
  const mapIndices = new Map<string, number>(),
    maps: number[] = [],
    /** Each safepoint's map, as a word offset into `maps`. */
    mapOffsets: number[] = [];
  for (const entry of sorted) {
    if (entry === undefined) throw "safepoint entry invariant";
    const key = entry.map.join(",");
    const known = mapIndices.get(key);
    if (known !== undefined) {
      mapOffsets.push(known);
      continue;
    }
    mapIndices.set(key, maps.length);
    mapOffsets.push(maps.length);
    for (const word of entry.map) {
      if (word === undefined) throw "safepoint map invariant";
      maps.push(word);
    }
  }
  const header = nativeStackMapTableHeaderBytes / 8,
    first = header + sorted.length * 2,
    words: number[] = [
      nativeStackMapMagic,
      nativeStackMapWideVersion,
      sorted.length,
    ];
  for (let index = 0; index < sorted.length; index++) {
    const entry = sorted[index],
      at = mapOffsets[index];
    if (entry === undefined || at === undefined)
      throw "safepoint entry invariant";
    words.push(entry.offset, first + at);
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

/** A full-word map at byte `map` (packed and wide tables). */
function decodeWordMap(
  code: Uint8Array,
  map: number,
  offset: number,
): DecodedSafepoint | undefined {
  const references: number[] = [],
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
  return {
    offset,
    frameBytes: tableWord(code, map),
    references,
    generals,
    registers,
    saves,
  };
}

/** Unit `index` of the compact record at byte `record`. */
function recordUnit(
  code: Uint8Array,
  record: number,
  index: number,
  width: number,
): number {
  const perWord = unitWords[width] ?? 1,
    scale = unitScales[width] ?? 1,
    word = tableWord(code, record + 16 + Math.floor(index / perWord) * 8);
  let shifted = word;
  for (let part = index % perWord; part > 0; part--)
    shifted = Math.floor(shifted / scale);
  return shifted % scale;
}
/** Stream byte `at` of a record whose stream starts at byte `base`. */
function streamByte(code: Uint8Array, base: number, at: number): number {
  let word = tableWord(
    code,
    base + Math.floor(at / nativeStackMapStreamBytes) * 8,
  );
  for (let part = at % nativeStackMapStreamBytes; part > 0; part--)
    word = Math.floor(word / 256);
  return word % 256;
}
/** The varint at stream byte `at`: its value and the next byte. */
function streamVarint(
  code: Uint8Array,
  base: number,
  at: number,
): { value: number; next: number } {
  let value = 0,
    factor = 1,
    position = at;
  while (true) {
    const byte = streamByte(code, base, position);
    position++;
    if (byte < 128) return { value: value + byte * factor, next: position };
    value += (byte - 128) * factor;
    factor *= 128;
  }
}
/** Decodes one compact function record's safepoints (offsets relative to
 * the table's code). */
function decodeCompactRecord(
  code: Uint8Array,
  record: number,
  start: number,
  codeOffset: number,
  result: DecodedSafepoint[],
): boolean {
  const header = tableWord(code, record + 8),
    count = Math.floor(header / 4),
    width = header % 4,
    perWord = unitWords[width];
  if (perWord === undefined) return false;
  const base = record + 16 + Math.ceil((count * 2) / perWord) * 8;
  let read = streamVarint(code, base, 0);
  const frameBytes = read.value * 16;
  read = streamVarint(code, base, read.next);
  const saved = read.value,
    saves: { register: number; offset: number }[] = [];
  for (let bit = 0; bit < nativeStackMapRegisterShift; bit++)
    if ((saved & (1 << bit)) !== 0) {
      read = streamVarint(code, base, read.next);
      saves.push({ register: 19 + bit, offset: read.value * 8 });
    }
  read = streamVarint(code, base, read.next);
  const longKeys = read.value,
    longKey: number[] = [],
    /** Per long word: the index of its first run in longRuns, then its
     * run count. */
    longIndex: number[] = [],
    longRuns: number[] = [];
  let key = -1;
  for (let index = 0; index < longKeys; index++) {
    read = streamVarint(code, base, read.next);
    key += read.value + 1;
    read = streamVarint(code, base, read.next);
    const runCount = read.value;
    longKey.push(key);
    longIndex.push(longRuns.length, runCount);
    let end = 0;
    for (let run = 0; run < runCount; run++) {
      read = streamVarint(code, base, read.next);
      const from = end + read.value;
      read = streamVarint(code, base, read.next);
      end = from + read.value + 1;
      longRuns.push(from, end);
    }
  }
  for (let k = 0; k < count; k++) {
    const keys: number[] = [];
    for (let index = 0; index < longKey.length; index++) {
      const first = longIndex[index * 2] ?? 0,
        runCount = longIndex[index * 2 + 1] ?? 0;
      for (let run = 0; run < runCount; run++)
        if (
          (longRuns[first + run * 2] ?? 0) <= k &&
          k < (longRuns[first + run * 2 + 1] ?? 0)
        )
          keys.push(longKey[index] ?? 0);
    }
    read = streamVarint(code, base, recordUnit(code, record, count + k, width));
    const heldMask = read.value;
    read = streamVarint(code, base, read.next);
    const residualCount = read.value;
    let word = -1;
    for (let at = 0; at < residualCount; at++) {
      read = streamVarint(code, base, read.next);
      word += read.value + 1;
      keys.push(word);
    }
    keys.sort((left, right) => left - right);
    const registers: number[] = [],
      references: number[] = [],
      generals: number[] = [];
    for (let bit = 0; bit < nativeStackMapRegisterShift; bit++)
      if ((heldMask & (1 << bit)) !== 0) registers.push(19 + bit);
    for (const listed of keys)
      if (listed === undefined) throw "safepoint key invariant";
      else if (listed % 2 === 0) references.push((listed / 2) * 8);
      else generals.push(((listed - 1) / 2) * 8);
    result.push({
      offset: codeOffset + start + recordUnit(code, record, k, width) * 4,
      frameBytes,
      references,
      generals,
      registers,
      saves,
    });
  }
  return true;
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
    const version = tableWord(code, base + 8);
    if (tableWord(code, base) !== nativeStackMapMagic) return undefined;
    const count = tableWord(code, base + 16);
    if (version === nativeStackMapCompactVersion) {
      for (let index = 0; index < count; index++) {
        const word = tableWord(
            code,
            base + nativeStackMapTableHeaderBytes + index * 8,
          ),
          start = (word % nativeStackMapRecordShift) * 4,
          record = base + Math.floor(word / nativeStackMapRecordShift) * 8;
        if (!decodeCompactRecord(code, record, start, table.codeOffset, result))
          return undefined;
      }
      continue;
    }
    const wide = version === nativeStackMapWideVersion;
    if (version !== nativeStackMapVersion && !wide) return undefined;
    for (let index = 0; index < count; index++) {
      const entry =
          base + nativeStackMapTableHeaderBytes + index * (wide ? 16 : 8),
        word = tableWord(code, entry),
        returnOffset = wide ? word : word % 4294967296,
        map =
          base +
          (wide ? tableWord(code, entry + 8) : Math.floor(word / 4294967296)) *
            8;
      const decoded = decodeWordMap(code, map, table.codeOffset + returnOffset);
      if (decoded === undefined) return undefined;
      result.push(decoded);
    }
  }
  return result;
}
