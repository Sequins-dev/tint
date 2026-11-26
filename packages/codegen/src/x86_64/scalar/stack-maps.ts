import {
  analyzeLiveSlotRowsPrecisely,
  analyzeLiveSlotsPrecisely,
  fitsLiveRows,
  instructionResult,
  visitInstructionOperands,
  visitTerminatorOperands,
  type FunctionIR,
  type ScalarType,
  type SlotLiveRows,
} from "@tint/ir/scalar";
import {
  safepointLiveSlots,
  type SafepointSite,
} from "../../scalar/stack-maps.ts";

interface LabeledSafepoint extends SafepointSite {
  readonly label: string;
  readonly transitionRoots?: readonly number[];
}
export interface PendingSafepoint {
  readonly label: string;
  readonly functionLabel: string;
  readonly map: readonly number[];
}

export function isRootType(type: ScalarType): boolean {
  return (
    type !== "number" &&
    type !== "boolean" &&
    type !== "optional-number" &&
    type !== "optional-boolean"
  );
}

/** In-place ascending numeric sort on a Uint32Array without closure or
 * managed NumberList overhead. */
function sortUint32(values: Uint32Array, length: number): void {
  if (length <= 1) return;
  if (length <= 16) {
    for (let i = 1; i < length; i++) {
      const value = values[i] ?? 0;
      let j = i - 1;
      while (j >= 0 && (values[j] ?? 0) > value) {
        values[j + 1] = values[j] ?? 0;
        j--;
      }
      values[j + 1] = value;
    }
    return;
  }
  // In-place heapsort: O(n log n) worst-case, zero recursion and allocations.
  for (let start = (length >>> 1) - 1; start >= 0; start--) {
    let root = start;
    while (true) {
      let child = root * 2 + 1;
      if (child >= length) break;
      if (child + 1 < length && (values[child] ?? 0) < (values[child + 1] ?? 0))
        child++;
      const rootValue = values[root] ?? 0,
        childValue = values[child] ?? 0;
      if (rootValue >= childValue) break;
      values[root] = childValue;
      values[child] = rootValue;
      root = child;
    }
  }
  for (let end = length - 1; end > 0; end--) {
    const max = values[0] ?? 0;
    values[0] = values[end] ?? 0;
    values[end] = max;
    let root = 0;
    while (true) {
      let child = root * 2 + 1;
      if (child >= end) break;
      if (child + 1 < end && (values[child] ?? 0) < (values[child + 1] ?? 0))
        child++;
      const rootValue = values[root] ?? 0,
        childValue = values[child] ?? 0;
      if (rootValue >= childValue) break;
      values[root] = childValue;
      values[child] = rootValue;
      root = child;
    }
  }
}

/** Stream every safepoint map of `fn` in `sites` order to `onMap`, using dense
 * bit-row liveness when it fits and processing contiguous block runs one block
 * at a time so large functions do not retain per-safepoint slot lists or map
 * arrays simultaneously. The `map` passed to `onMap` is reused across calls. */
export function emitFrameStackMaps(
  fn: FunctionIR,
  frameBytes: number,
  slots: readonly number[],
  homes: ReadonlyMap<number, number>,
  types: ReadonlyMap<number, ScalarType>,
  sites: readonly LabeledSafepoint[],
  environment: number | undefined,
  onMap: (label: string, map: readonly number[]) => void,
): void {
  if (sites.length === 0) return;
  const slotCount = fn.slots.length;
  const trackedSlots: number[] = [];
  const tracked = new Uint8Array(slots.length);
  const slotWord = new Int32Array(slotCount);
  const slotIsGeneral = new Uint8Array(slotCount);
  for (let slot = 0; slot < slots.length; slot++) {
    const type = fn.slots[slot];
    if (type !== undefined && isRootType(type)) {
      tracked[slot] = 1;
      trackedSlots.push(slot);
      const offset = slots[slot];
      if (offset === undefined) throw "x86-64 live slot home invariant";
      slotWord[slot] = frameBytes + offset;
      if (type === "general") slotIsGeneral[slot] = 1;
    }
  }
  let liveRows: SlotLiveRows | undefined;
  let liveLists: readonly (readonly number[])[] | undefined;
  if (fitsLiveRows(fn, trackedSlots.length)) {
    const dense = analyzeLiveSlotRowsPrecisely(
      fn,
      Number.MAX_SAFE_INTEGER,
      trackedSlots,
      true,
    );
    if (dense === undefined) throw "x86-64 slot liveness invariant";
    liveRows = dense;
  } else {
    const sparse = analyzeLiveSlotsPrecisely(
      fn,
      Number.MAX_SAFE_INTEGER,
      trackedSlots,
      true,
    );
    if (sparse === undefined) throw "x86-64 slot liveness invariant";
    liveLists = sparse.slots;
  }
  const frameWords = frameBytes > 0 ? (frameBytes + 7) >>> 3 : 0;
  const bitWords = (frameWords + 31) >>> 5;
  const useBitsetTable = frameBytes > 0 && bitWords <= 4096;
  const refBits = new Uint32Array(useBitsetTable ? bitWords : 0);
  const genBits = new Uint32Array(useBitsetTable ? bitWords : 0);
  let refBuf = new Uint32Array(64);
  let refLen = 0;
  let genBuf = new Uint32Array(16);
  let genLen = 0;
  const map: number[] = [];
  const lastUse = new Map<number, number>();
  const definitions: number[] = [];
  const defIds: number[] = [];
  const defWords: number[] = [];
  const defIsGeneral: number[] = [];
  function addRootFallback(word: number, general: boolean): void {
    if (general) {
      if (genLen === genBuf.length) {
        const next = new Uint32Array(genBuf.length * 2);
        next.set(genBuf);
        genBuf = next;
      }
      genBuf[genLen++] = word;
    } else {
      if (refLen === refBuf.length) {
        const next = new Uint32Array(refBuf.length * 2);
        next.set(refBuf);
        refBuf = next;
      }
      refBuf[refLen++] = word;
    }
  }
  function prepareBlockTemporaries(blockId: number): void {
    const block = fn.blocks[blockId];
    if (block === undefined) throw "x86-64 safepoint block invariant";
    lastUse.clear();
    definitions.length = 0;
    defIds.length = 0;
    defWords.length = 0;
    defIsGeneral.length = 0;
    for (let index = 0; index < block.instructions.length; index++) {
      const op = block.instructions[index];
      if (op === undefined) throw "x86-64 safepoint instruction invariant";
      const id = instructionResult(op);
      if (id !== undefined) {
        const type = types.get(id);
        if (type !== undefined && isRootType(type)) {
          const offset = homes.get(id);
          if (offset === undefined)
            throw "x86-64 temporary root home invariant";
          definitions.push(index);
          defIds.push(id);
          defWords.push(frameBytes + offset);
          defIsGeneral.push(type === "general" ? 1 : 0);
        }
      }
      visitInstructionOperands(op, (operand) => {
        lastUse.set(operand, index);
      });
    }
    visitTerminatorOperands(block.terminator, (operand) => {
      lastUse.set(operand, block.instructions.length);
    });
  }
  const envWord = environment !== undefined ? frameBytes + environment : -1;
  function emitSiteFallback(
    site: LabeledSafepoint,
    liveSlice: Uint32Array,
    liveStart: number,
    liveEnd: number,
  ): void {
    refLen = 0;
    genLen = 0;
    if (environment !== undefined) addRootFallback(envWord, false);
    for (const offset of site.transitionRoots ?? []) {
      if (offset === undefined) throw "callback stack-map invariant";
      addRootFallback(frameBytes + offset, false);
    }
    for (let at = liveStart; at < liveEnd; at++) {
      const slot = liveSlice[at] ?? 0;
      if (slots[slot] === undefined || fn.slots[slot] === undefined)
        throw "x86-64 live slot home invariant";
      addRootFallback(slotWord[slot] ?? 0, slotIsGeneral[slot] === 1);
    }
    for (let d = 0; d < definitions.length; d++) {
      const index = definitions[d];
      if (index === undefined) throw "x86-64 definition index invariant";
      if (index >= site.index) break;
      const id = defIds[d];
      if (id === undefined) throw "x86-64 temporary ID invariant";
      if ((lastUse.get(id) ?? -1) < site.index) continue;
      addRootFallback(defWords[d] ?? 0, defIsGeneral[d] === 1);
    }
    sortUint32(refBuf, refLen);
    sortUint32(genBuf, genLen);
    map.length = 0;
    map.push(frameBytes, refLen);
    for (let i = 0; i < refLen; i++) map.push(refBuf[i] ?? 0);
    map.push(genLen);
    for (let i = 0; i < genLen; i++) map.push(genBuf[i] ?? 0);
    map.push(0);
    onMap(site.label, map);
  }
  function emitSite(
    site: LabeledSafepoint,
    liveSlice: Uint32Array,
    liveStart: number,
    liveEnd: number,
  ): void {
    const block = fn.blocks[site.block];
    if (block === undefined) throw "x86-64 safepoint block invariant";
    if (!useBitsetTable) {
      emitSiteFallback(site, liveSlice, liveStart, liveEnd);
      return;
    }
    let refMin = bitWords,
      refMax = -1,
      refCount = 0,
      genMin = bitWords,
      genMax = -1,
      genCount = 0,
      fallback = false;
    if (environment !== undefined) {
      const word = envWord;
      if (word < 0 || word >= frameBytes || (word & 7) !== 0) fallback = true;
      else {
        const idx = word >>> 3,
          w = idx >>> 5,
          mask = 1 << (idx & 31);
        refBits[w] = (refBits[w] ?? 0) | mask;
        refMin = w;
        refMax = w;
        refCount = 1;
      }
    }
    if (!fallback && site.transitionRoots !== undefined) {
      for (const offset of site.transitionRoots) {
        if (offset === undefined) throw "callback stack-map invariant";
        const word = frameBytes + offset;
        if (word < 0 || word >= frameBytes || (word & 7) !== 0) {
          fallback = true;
          break;
        }
        const idx = word >>> 3,
          w = idx >>> 5,
          mask = 1 << (idx & 31),
          prev = refBits[w] ?? 0;
        if ((prev & mask) !== 0) {
          fallback = true;
          break;
        }
        refBits[w] = prev | mask;
        if (w < refMin) refMin = w;
        if (w > refMax) refMax = w;
        refCount++;
      }
    }
    if (!fallback) {
      for (let at = liveStart; at < liveEnd; at++) {
        const slot = liveSlice[at] ?? 0;
        const word = slotWord[slot] ?? 0;
        if (word < 0 || word >= frameBytes || (word & 7) !== 0) {
          fallback = true;
          break;
        }
        const idx = word >>> 3,
          w = idx >>> 5,
          mask = 1 << (idx & 31);
        if (slotIsGeneral[slot] === 1) {
          const prev = genBits[w] ?? 0;
          if ((prev & mask) !== 0) {
            fallback = true;
            break;
          }
          genBits[w] = prev | mask;
          if (w < genMin) genMin = w;
          if (w > genMax) genMax = w;
          genCount++;
        } else {
          const prev = refBits[w] ?? 0;
          if ((prev & mask) !== 0) {
            fallback = true;
            break;
          }
          refBits[w] = prev | mask;
          if (w < refMin) refMin = w;
          if (w > refMax) refMax = w;
          refCount++;
        }
      }
    }
    if (!fallback) {
      for (let d = 0; d < definitions.length; d++) {
        const index = definitions[d];
        if (index === undefined) throw "x86-64 definition index invariant";
        if (index >= site.index) break;
        const id = defIds[d];
        if (id === undefined) throw "x86-64 temporary ID invariant";
        if ((lastUse.get(id) ?? -1) < site.index) continue;
        const word = defWords[d] ?? 0;
        if (word < 0 || word >= frameBytes || (word & 7) !== 0) {
          fallback = true;
          break;
        }
        const idx = word >>> 3,
          w = idx >>> 5,
          mask = 1 << (idx & 31);
        if (defIsGeneral[d] === 1) {
          const prev = genBits[w] ?? 0;
          if ((prev & mask) !== 0) {
            fallback = true;
            break;
          }
          genBits[w] = prev | mask;
          if (w < genMin) genMin = w;
          if (w > genMax) genMax = w;
          genCount++;
        } else {
          const prev = refBits[w] ?? 0;
          if ((prev & mask) !== 0) {
            fallback = true;
            break;
          }
          refBits[w] = prev | mask;
          if (w < refMin) refMin = w;
          if (w > refMax) refMax = w;
          refCount++;
        }
      }
    }
    if (fallback) {
      for (let w = refMin; w <= refMax; w++) refBits[w] = 0;
      for (let w = genMin; w <= genMax; w++) genBits[w] = 0;
      emitSiteFallback(site, liveSlice, liveStart, liveEnd);
      return;
    }
    map.length = 0;
    map.push(frameBytes, refCount);
    for (let w = refMin; w <= refMax; w++) {
      let bits = refBits[w] ?? 0;
      if (bits === 0) continue;
      refBits[w] = 0;
      const base = w << 8;
      while (bits !== 0) {
        const bit = 31 - Math.clz32(bits & -bits);
        bits &= bits - 1;
        map.push(base + (bit << 3));
      }
    }
    map.push(genCount);
    for (let w = genMin; w <= genMax; w++) {
      let bits = genBits[w] ?? 0;
      if (bits === 0) continue;
      genBits[w] = 0;
      const base = w << 8;
      while (bits !== 0) {
        const bit = 31 - Math.clz32(bits & -bits);
        bits &= bits - 1;
        map.push(base + (bit << 3));
      }
    }
    map.push(0);
    onMap(site.label, map);
  }
  // Fast streaming path: when sites are grouped in contiguous per-block runs
  // (always true during code emission), compute backward slot liveness one
  // block at a time without materializing all safepoint live lists at once.
  const seenBlocks = new Uint8Array(fn.blocks.length);
  let contiguous = true;
  let prevBlock = -1;
  for (let i = 0; i < sites.length; i++) {
    const site = sites[i];
    if (site === undefined) throw "x86-64 safepoint site invariant";
    if (site.block !== prevBlock) {
      if (seenBlocks[site.block] === 1) {
        contiguous = false;
        break;
      }
      seenBlocks[site.block] = 1;
      prevBlock = site.block;
    }
  }
  if (!contiguous) {
    let lists = liveLists;
    if (lists === undefined) {
      const sparse = analyzeLiveSlotsPrecisely(
        fn,
        Number.MAX_SAFE_INTEGER,
        trackedSlots,
        true,
      );
      if (sparse === undefined) throw "x86-64 slot liveness invariant";
      lists = sparse.slots;
    }
    const liveSlots = safepointLiveSlots(fn, lists, tracked, sites, true);
    let scratch = new Uint32Array(Math.max(16, slotCount));
    let previous = -1;
    for (let i = 0; i < sites.length; i++) {
      const site = sites[i],
        live = liveSlots[i];
      if (site === undefined || live === undefined)
        throw "x86-64 safepoint liveness invariant";
      if (site.block !== previous) {
        previous = site.block;
        prepareBlockTemporaries(site.block);
      }
      if (live.length > scratch.length) scratch = new Uint32Array(live.length);
      for (let j = 0; j < live.length; j++) scratch[j] = live[j] ?? 0;
      emitSite(site, scratch, 0, live.length);
    }
    return;
  }
  const position = new Uint32Array(slotCount),
    members = new Uint32Array(slotCount),
    stamps = new Uint32Array(slotCount),
    handlerSlots = new Uint32Array(slotCount),
    rowTracked = new Uint32Array(trackedSlots.length);
  for (let i = 0; i < trackedSlots.length; i++)
    rowTracked[i] = trackedSlots[i] ?? 0;
  let memberCount = 0,
    siteLiveData = new Uint32Array(Math.max(64, slotCount * 2)),
    siteLiveLength = 0,
    siteLiveStarts = new Uint32Array(16),
    siteLiveEnds = new Uint32Array(16),
    cachedHandlerTarget = -1,
    cachedHandlerExcluded = -1,
    handlerCount = 0,
    stamp = 0;
  function growSiteLive(needed: number): void {
    let nextCapacity = siteLiveData.length;
    while (nextCapacity < needed) nextCapacity *= 2;
    const next = new Uint32Array(nextCapacity);
    next.set(siteLiveData);
    siteLiveData = next;
  }
  function enter(slot: number): void {
    if (tracked[slot] !== 1) return;
    const at = position[slot] ?? 0;
    if (at > 0 && members[at - 1] === slot) return;
    members[memberCount++] = slot;
    position[slot] = memberCount;
  }
  function leave(slot: number): void {
    const at = position[slot] ?? 0;
    if (at === 0 || members[at - 1] !== slot) return;
    const last = members[--memberCount] ?? 0;
    if (last !== slot) {
      members[at - 1] = last;
      position[last] = at;
    }
    position[slot] = 0;
  }
  function enterLiveIn(blockId: number, excludedSlot: number): void {
    if (liveRows !== undefined) {
      const start = liveRows.starts[blockId] ?? 0,
        end = liveRows.ends[blockId] ?? 0,
        base = blockId * liveRows.rowWords,
        rows = liveRows.rows;
      for (let word = start; word < end; word++) {
        let bits = rows[base + word] ?? 0;
        const wordBase = word << 5;
        while (bits !== 0) {
          const bit = 31 - Math.clz32(bits & -bits);
          bits &= bits - 1;
          const slot = rowTracked[wordBase + bit] ?? 0;
          if (slot !== excludedSlot) enter(slot);
        }
      }
      return;
    }
    for (const slot of liveLists?.[blockId] ?? [])
      if (slot !== undefined && slot !== excludedSlot) enter(slot);
  }
  function loadHandlerSlots(targetBlockId: number, excludedSlot: number): void {
    if (
      targetBlockId === cachedHandlerTarget &&
      excludedSlot === cachedHandlerExcluded
    )
      return;
    cachedHandlerTarget = targetBlockId;
    cachedHandlerExcluded = excludedSlot;
    handlerCount = 0;
    if (liveRows !== undefined) {
      const start = liveRows.starts[targetBlockId] ?? 0,
        end = liveRows.ends[targetBlockId] ?? 0,
        base = targetBlockId * liveRows.rowWords,
        rows = liveRows.rows;
      for (let word = start; word < end; word++) {
        let bits = rows[base + word] ?? 0;
        const wordBase = word << 5;
        while (bits !== 0) {
          const bit = 31 - Math.clz32(bits & -bits);
          bits &= bits - 1;
          const slot = rowTracked[wordBase + bit] ?? 0;
          if (tracked[slot] === 1 && slot !== excludedSlot)
            handlerSlots[handlerCount++] = slot;
        }
      }
      return;
    }
    for (const slot of liveLists?.[targetBlockId] ?? [])
      if (slot !== undefined && tracked[slot] === 1 && slot !== excludedSlot)
        handlerSlots[handlerCount++] = slot;
  }
  let runStart = 0;
  while (runStart < sites.length) {
    const firstSite = sites[runStart];
    if (firstSite === undefined) throw "x86-64 safepoint site invariant";
    const blockId = firstSite.block;
    let runEnd = runStart + 1;
    let ascending = true;
    let lastIndex = firstSite.index;
    while (runEnd < sites.length) {
      const candidate = sites[runEnd];
      if (candidate === undefined || candidate.block !== blockId) break;
      if (candidate.index < lastIndex) ascending = false;
      lastIndex = candidate.index;
      runEnd++;
    }
    const block = fn.blocks[blockId];
    if (block === undefined || block.id !== blockId)
      throw "x86-64 safepoint block invariant";
    for (let m = 0; m < memberCount; m++) position[members[m] ?? 0] = 0;
    memberCount = 0;
    const term = block.terminator;
    if (term.kind === "jump") enterLiveIn(term.target, -1);
    else if (
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
      enterLiveIn(term.consequent, written);
      enterLiveIn(term.alternate, -1);
      if (term.kind !== "branch" && written < 0) enter(term.slot);
    }
    const handler = block.exception;
    if (handler !== undefined) loadHandlerSlots(handler.target, handler.slot);
    const runLen = runEnd - runStart;
    if (runLen > siteLiveStarts.length) {
      siteLiveStarts = new Uint32Array(runLen);
      siteLiveEnds = new Uint32Array(runLen);
    }
    // Order local indices [0 .. runLen - 1] in descending site.index order.
    const ordered: number[] = [];
    if (ascending) {
      for (let k = runLen - 1; k >= 0; k--) ordered.push(k);
    } else {
      for (let k = 0; k < runLen; k++) ordered.push(k);
      ordered.sort((left, right) => {
        const a = sites[runStart + left],
          b = sites[runStart + right];
        if (a === undefined || b === undefined)
          throw "safepoint order invariant";
        return b.index - a.index;
      });
    }
    siteLiveLength = 0;
    let next = 0;
    for (let index = block.instructions.length; index >= 0; index--) {
      while (next < runLen) {
        const local = ordered[next];
        if (local === undefined) throw "safepoint order invariant";
        const at = sites[runStart + local];
        if (at === undefined || at.index > index)
          throw "safepoint index invariant";
        if (at.index !== index) break;
        stamp++;
        const liveStart = siteLiveLength;
        const needed =
          siteLiveLength +
          memberCount +
          (handler !== undefined ? handlerCount : 0);
        if (needed > siteLiveData.length) growSiteLive(needed);
        for (let m = 0; m < memberCount; m++) {
          const slot = members[m] ?? 0;
          if (stamps[slot] !== stamp) {
            stamps[slot] = stamp;
            siteLiveData[siteLiveLength++] = slot;
          }
        }
        if (handler !== undefined) {
          for (let h = 0; h < handlerCount; h++) {
            const slot = handlerSlots[h] ?? 0;
            if (stamps[slot] !== stamp) {
              stamps[slot] = stamp;
              siteLiveData[siteLiveLength++] = slot;
            }
          }
        }
        siteLiveStarts[local] = liveStart;
        siteLiveEnds[local] = siteLiveLength;
        next++;
      }
      if (index === 0) break;
      const op = block.instructions[index - 1];
      if (op === undefined) throw "safepoint instruction invariant";
      if (op.kind === "store") leave(op.slot);
      else if (op.kind === "load") enter(op.slot);
    }
    if (next !== runLen) throw "safepoint site invariant";
    prepareBlockTemporaries(blockId);
    for (let local = 0; local < runLen; local++) {
      const site = sites[runStart + local];
      if (site === undefined) throw "x86-64 safepoint site invariant";
      emitSite(
        site,
        siteLiveData,
        siteLiveStarts[local] ?? 0,
        siteLiveEnds[local] ?? 0,
      );
    }
    runStart = runEnd;
  }
}

/** Every x86 value has its own home. A slot belongs in the map through
 * either successor of the call; a temporary belongs only between its
 * definition and last use within the block. The result, including any
 * exceptional payload, has not been produced at this safepoint. */
export function frameStackMaps(
  fn: FunctionIR,
  functionLabel: string,
  frameBytes: number,
  slots: readonly number[],
  homes: ReadonlyMap<number, number>,
  types: ReadonlyMap<number, ScalarType>,
  sites: readonly LabeledSafepoint[],
  environment?: number,
): PendingSafepoint[] {
  const maps: PendingSafepoint[] = [];
  emitFrameStackMaps(
    fn,
    frameBytes,
    slots,
    homes,
    types,
    sites,
    environment,
    (label, map) => {
      maps.push({ label, functionLabel, map: map.slice() });
    },
  );
  return maps;
}
