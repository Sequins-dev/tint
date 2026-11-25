import {
  analyzeLiveSlots,
  blockSuccessors,
  isNativeTypedArray,
  type FunctionIR,
  type Instruction,
  type ScalarType,
} from "@tint/ir/scalar";
/** Blocks whose register contents at entry the emitter can derive from the
 * edges it has already emitted when it reaches them: every control-flow
 * predecessor precedes the block in layout. Excluded are the function entry
 * (entered from the prologue), targets of back edges (loop headers and
 * self-loops, whose latches are emitted later) and exception handler targets
 * (entered from landing pads emitted after the body). */
export function forwardableEntries(
  fn: FunctionIR,
  /** Emission order of block IDs (see chainedBlockOrder). */
  order: readonly number[],
): Set<number> {
  const position = new Map<number, number>();
  for (let index = 0; index < order.length; index++) {
    const id = order[index];
    if (id === undefined) throw "block entry invariant";
    position.set(id, index);
  }
  const excluded = new Set<number>();
  excluded.add(fn.entry);
  for (const block of fn.blocks) {
    if (block === undefined) throw "block entry invariant";
    const index = position.get(block.id) ?? 0;
    const handler = block.exception;
    if (handler !== undefined) excluded.add(handler.target);
    for (const successor of blockSuccessors(block)) {
      if (successor === undefined) throw "block entry invariant";
      const at = position.get(successor);
      if (at === undefined || at <= index) excluded.add(successor);
    }
  }
  const result = new Set<number>();
  for (const block of fn.blocks) {
    if (block === undefined) throw "block entry invariant";
    if (!excluded.has(block.id)) result.add(block.id);
  }
  return result;
}
/** Whether execution can continue past `word` into the next instruction:
 * false only for B, BR, RET and BRK. Unknown words count as falling through,
 * which only adds an edge and so keeps forwarding conservative. */
export function fallsThrough(word: number): boolean {
  if ((word & 0xfc000000) >>> 0 === 0x14000000) return false;
  const branchRegister = (word & 0xfffffc1f) >>> 0;
  if (branchRegister === 0xd61f0000 || branchRegister === 0xd65f0000)
    return false;
  return (word & 0xffe0001f) >>> 0 !== 0xd4200000;
}

/** Emission order of a function's blocks: IR order, except that a block
 * ending in a jump or a record access is followed by its (consequent)
 * successor when that successor has no other predecessor and is not yet
 * placed, so the common path falls through instead of taking a branch
 * (inlining and record lowering append such continuations at the end).
 * The entry stays first; every block appears exactly once. */
export function chainedBlockOrder(
  fn: FunctionIR,
  inlineCall?: (target: number) => boolean,
): number[] {
  const predecessors = new Uint32Array(fn.blocks.length);
  for (const block of fn.blocks) {
    if (block === undefined) throw "block order invariant";
    for (const successor of blockSuccessors(block))
      if (successor !== undefined)
        predecessors[successor] = (predecessors[successor] ?? 0) + 1;
    const handler = block.exception;
    if (handler !== undefined)
      predecessors[handler.target] = (predecessors[handler.target] ?? 0) + 2;
  }
  const placed = new Uint8Array(fn.blocks.length),
    order: number[] = [];
  const coldFlags = new Uint8Array(fn.blocks.length);
  for (const block of fn.blocks) {
    if (block === undefined || block.id === fn.entry) continue;
    const kind = block.terminator.kind;
    if (kind === "trap" || kind === "throw" || kind === "throw-literal") {
      coldFlags[block.id] = 1;
      continue;
    }
    for (const op of block.instructions)
      if (
        op !== undefined &&
        ((op.kind === "call" && inlineCall?.(op.target) !== true) ||
          op.kind === "call-indirect" ||
          op.kind === "host-call" ||
          op.kind === "c-call" ||
          op.kind === "array-copy")
      ) {
        coldFlags[block.id] = 1;
        break;
      }
  }
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    for (const block of fn.blocks) {
      if (
        block === undefined ||
        block.id === fn.entry ||
        coldFlags[block.id] === 1
      )
        continue;
      const succs = blockSuccessors(block);
      if (succs.length === 0) continue;
      let allCold = true;
      for (const s of succs)
        if (s === undefined || coldFlags[s] !== 1) {
          allCold = false;
          break;
        }
      if (allCold) {
        coldFlags[block.id] = 1;
        changed = true;
      }
    }
    if (!changed) break;
  }
  // Forward cold propagation: blocks reachable only from cold blocks (such as
  // post-call capacity refresh diamonds on a slow push path) are also cold,
  // so their join back into the hot loop sees only one hot predecessor.
  const coldPredCount = new Uint32Array(fn.blocks.length);
  for (let pass = 0; pass < 4; pass++) {
    coldPredCount.fill(0);
    for (const block of fn.blocks) {
      if (block === undefined || coldFlags[block.id] !== 1) continue;
      for (const s of blockSuccessors(block))
        if (s !== undefined) coldPredCount[s] = (coldPredCount[s] ?? 0) + 1;
    }
    let changed = false;
    for (const block of fn.blocks) {
      if (
        block === undefined ||
        block.id === fn.entry ||
        coldFlags[block.id] === 1
      )
        continue;
      const total = predecessors[block.id] ?? 0;
      if (total > 0 && (coldPredCount[block.id] ?? 0) === total) {
        coldFlags[block.id] = 1;
        changed = true;
      }
    }
    if (!changed) break;
  }
  /** Cold or call-bearing blocks that should not interrupt a hot branch's
   * fallthrough chain (e.g. a slow growth path in a push loop). */
  function coldOrCallBlock(id: number): boolean {
    return coldFlags[id] === 1;
  }
  const hotPredecessors = new Uint32Array(fn.blocks.length);
  for (const block of fn.blocks) {
    if (block === undefined) throw "block order invariant";
    if (!coldOrCallBlock(block.id)) {
      for (const successor of blockSuccessors(block))
        if (successor !== undefined)
          hotPredecessors[successor] = (hotPredecessors[successor] ?? 0) + 1;
    }
    const handler = block.exception;
    if (handler !== undefined)
      hotPredecessors[handler.target] =
        (hotPredecessors[handler.target] ?? 0) + 2;
  }
  /** The single-predecessor (or sole non-cold predecessor) continuation that
   * should follow `id`. */
  function continuation(id: number): number {
    const block = fn.blocks[id];
    if (block === undefined) throw "block order invariant";
    const term = block.terminator;
    let next = -1;
    if (term.kind === "jump") next = term.target;
    else if (term.kind === "record" || term.kind === "record-cell")
      next = term.consequent;
    else if (term.kind === "branch" && term.consequent !== term.alternate) {
      const coldC = coldOrCallBlock(term.consequent),
        coldA = coldOrCallBlock(term.alternate);
      if (!coldC && coldA) next = term.consequent;
      else if (!coldA && coldC) next = term.alternate;
      else if (!coldC && !coldA) {
        const cUnique =
            term.consequent !== fn.entry &&
            ((predecessors[term.consequent] ?? 0) === 1 ||
              (!coldOrCallBlock(id) &&
                (hotPredecessors[term.consequent] ?? 0) === 1)),
          aUnique =
            term.alternate !== fn.entry &&
            ((predecessors[term.alternate] ?? 0) === 1 ||
              (!coldOrCallBlock(id) &&
                (hotPredecessors[term.alternate] ?? 0) === 1));
        if (cUnique && !aUnique) next = term.consequent;
        else if (aUnique && !cUnique) next = term.alternate;
        else if (cUnique) next = term.consequent;
      }
    }
    return next >= 0 &&
      next !== fn.entry &&
      ((predecessors[next] ?? 0) === 1 ||
        (!coldOrCallBlock(id) && (hotPredecessors[next] ?? 0) === 1))
      ? next
      : -1;
  }
  function place(id: number): void {
    let current = id;
    while (current >= 0 && placed[current] !== 1) {
      placed[current] = 1;
      order.push(current);
      current = continuation(current);
    }
  }
  /** Cold trap/throw blocks placed after hot code so common paths fall
   * through instead of jumping over a 4-byte brk #0. */
  function coldBlock(id: number): boolean {
    const block = fn.blocks[id];
    if (block === undefined || id === fn.entry) return false;
    const kind = block.terminator.kind;
    return (
      (block.instructions.length === 0 && kind === "trap") ||
      kind === "throw-literal"
    );
  }
  place(fn.entry);
  for (const block of fn.blocks) {
    if (block === undefined) throw "block order invariant";
    if (!coldBlock(block.id)) place(block.id);
  }
  for (const block of fn.blocks) {
    if (block === undefined) throw "block order invariant";
    place(block.id);
  }
  return order;
}

function isTrackedNonNullSlot(type: ScalarType): boolean {
  return (
    type === "reference" ||
    type === "optional-reference" ||
    type === "string" ||
    type === "optional-string" ||
    type === "primitive" ||
    isNativeTypedArray(type)
  );
}

/** Intraprocedural forward must-analysis proving which SSA values hold a
 * non-zero managed pointer at their definition. Tracks single-word managed
 * slots across branches (`=== none`, `!== none`, `truthy`, `!`, `string-present`),
 * allocations, and prior non-null casts/record guards. Returns undefined if
 * `budget` is exhausted (caller assumes nothing is proven). */
export function provenNonNullValues(
  fn: FunctionIR,
  intern: (id: number) => number,
  valueCount: number,
  budget: number,
): Uint8Array | undefined {
  const blockCount = fn.blocks.length;
  if (blockCount === 0 || valueCount === 0) return new Uint8Array(valueCount);
  // 1-based bit index per slot (0 means untracked), keeping all scratch in
  // Uint32Array for the native subset.
  const slotToBit = new Uint32Array(fn.slots.length);
  let bitCount = 0;
  for (let s = 0; s < fn.slots.length; s++) {
    const type = fn.slots[s];
    if (type !== undefined && isTrackedNonNullSlot(type)) {
      slotToBit[s] = ++bitCount;
    }
  }
  const words = (bitCount + 31) >>> 5,
    inMasks = new Uint32Array(blockCount * words),
    visited = new Uint8Array(blockCount),
    exceptionTargets = new Uint8Array(blockCount);
  for (const block of fn.blocks) {
    if (block === undefined) throw "non-null block invariant";
    if (block.exception !== undefined)
      exceptionTargets[block.exception.target] = 1;
  }
  const curMask = new Uint32Array(words),
    trueMask = new Uint32Array(words),
    falseMask = new Uint32Array(words),
    slotVer = new Uint32Array(bitCount),
    nonNullEpoch = new Uint32Array(valueCount),
    noneEpoch = new Uint32Array(valueCount),
    loadSlotEpoch = new Uint32Array(valueCount),
    loadSlotBit = new Uint32Array(valueCount),
    loadSlotVer = new Uint32Array(valueCount),
    loadSlot2Epoch = new Uint32Array(valueCount),
    loadSlot2Bit = new Uint32Array(valueCount),
    loadSlot2Ver = new Uint32Array(valueCount),
    cmpEpoch = new Uint32Array(valueCount),
    cmpValIdx = new Uint32Array(valueCount),
    cmpSlotBit = new Uint32Array(valueCount),
    cmpSlotVer = new Uint32Array(valueCount),
    cmpSlot2Bit = new Uint32Array(valueCount),
    cmpSlot2Ver = new Uint32Array(valueCount),
    cmpWhenTrue = new Uint8Array(valueCount);
  const queue: number[] = [],
    queued = new Uint8Array(blockCount);
  let head = 0,
    epoch = 0,
    work = 0;

  function setBit(mask: Uint32Array, bit: number): void {
    const w = bit >>> 5;
    mask[w] = ((mask[w] ?? 0) | (1 << (bit & 31))) >>> 0;
  }
  function clearBit(mask: Uint32Array, bit: number): void {
    const w = bit >>> 5;
    mask[w] = ((mask[w] ?? 0) & ~(1 << (bit & 31))) >>> 0;
  }
  function hasBit(mask: Uint32Array, bit: number): boolean {
    return (((mask[bit >>> 5] ?? 0) >>> (bit & 31)) & 1) !== 0;
  }
  function propagate(target: number, mask: Uint32Array): void {
    if (target === fn.entry || exceptionTargets[target] === 1) {
      if (visited[target] === 0) {
        visited[target] = 1;
        if (queued[target] === 0) {
          queued[target] = 1;
          queue.push(target);
        }
      }
      return;
    }
    const base = target * words;
    if (visited[target] === 0) {
      visited[target] = 1;
      for (let w = 0; w < words; w++) inMasks[base + w] = mask[w] ?? 0;
      if (queued[target] === 0) {
        queued[target] = 1;
        queue.push(target);
      }
      return;
    }
    let changed = false;
    for (let w = 0; w < words; w++) {
      const prev = inMasks[base + w] ?? 0,
        next = (prev & (mask[w] ?? 0)) >>> 0;
      if (next !== prev) {
        inMasks[base + w] = next;
        changed = true;
      }
    }
    if (changed && queued[target] === 0) {
      queued[target] = 1;
      queue.push(target);
    }
  }
  function recordCmp(dstIdx: number, srcIdx: number, whenTrue: number): void {
    cmpEpoch[dstIdx] = epoch;
    cmpValIdx[dstIdx] = srcIdx + 1;
    if (loadSlotEpoch[srcIdx] === epoch) {
      cmpSlotBit[dstIdx] = loadSlotBit[srcIdx] ?? 0;
      cmpSlotVer[dstIdx] = loadSlotVer[srcIdx] ?? 0;
    } else {
      cmpSlotBit[dstIdx] = 0;
      cmpSlotVer[dstIdx] = 0;
    }
    if (loadSlot2Epoch[srcIdx] === epoch) {
      cmpSlot2Bit[dstIdx] = loadSlot2Bit[srcIdx] ?? 0;
      cmpSlot2Ver[dstIdx] = loadSlot2Ver[srcIdx] ?? 0;
    } else {
      cmpSlot2Bit[dstIdx] = 0;
      cmpSlot2Ver[dstIdx] = 0;
    }
    cmpWhenTrue[dstIdx] = whenTrue;
  }
  function markSourceSlotsNonNull(srcIdx: number, mask: Uint32Array): void {
    if (loadSlotEpoch[srcIdx] === epoch) {
      const bit1 = loadSlotBit[srcIdx] ?? 0;
      if (bit1 > 0 && (slotVer[bit1 - 1] ?? 0) === (loadSlotVer[srcIdx] ?? 0))
        setBit(mask, bit1 - 1);
    }
    if (loadSlot2Epoch[srcIdx] === epoch) {
      const bit2 = loadSlot2Bit[srcIdx] ?? 0;
      if (bit2 > 0 && (slotVer[bit2 - 1] ?? 0) === (loadSlot2Ver[srcIdx] ?? 0))
        setBit(mask, bit2 - 1);
    }
  }

  function transferBlock(
    blockId: number,
    outValues: Uint8Array | undefined,
  ): boolean {
    const block = fn.blocks[blockId];
    if (block === undefined) throw "non-null block invariant";
    work += block.instructions.length + 2;
    if (work > budget) return false;
    epoch++;
    const base = blockId * words;
    for (let w = 0; w < words; w++) curMask[w] = inMasks[base + w] ?? 0;
    for (const op of block.instructions) {
      if (op === undefined) throw "non-null instruction invariant";
      switch (op.kind) {
        case "load": {
          const bitPlus1 = slotToBit[op.slot] ?? 0,
            idx = intern(op.id);
          if (bitPlus1 > 0) {
            const bit = bitPlus1 - 1;
            loadSlotEpoch[idx] = epoch;
            loadSlotBit[idx] = bitPlus1;
            loadSlotVer[idx] = slotVer[bit] ?? 0;
            if (hasBit(curMask, bit)) {
              nonNullEpoch[idx] = epoch;
              if (outValues !== undefined) outValues[idx] = 1;
            }
          }
          break;
        }
        case "store": {
          const bitPlus1 = slotToBit[op.slot] ?? 0;
          if (bitPlus1 > 0) {
            const bit = bitPlus1 - 1,
              vIdx = intern(op.value);
            slotVer[bit] = (slotVer[bit] ?? 0) + 1;
            const ver = slotVer[bit] ?? 0;
            if (nonNullEpoch[vIdx] === epoch) setBit(curMask, bit);
            else clearBit(curMask, bit);
            if (loadSlotEpoch[vIdx] !== epoch) {
              loadSlotEpoch[vIdx] = epoch;
              loadSlotBit[vIdx] = bitPlus1;
              loadSlotVer[vIdx] = ver;
            } else if (
              loadSlot2Epoch[vIdx] !== epoch &&
              (loadSlotBit[vIdx] ?? 0) !== bitPlus1
            ) {
              loadSlot2Epoch[vIdx] = epoch;
              loadSlot2Bit[vIdx] = bitPlus1;
              loadSlot2Ver[vIdx] = ver;
            }
          }
          break;
        }
        case "reference-none":
        case "string-none":
          noneEpoch[intern(op.id)] = epoch;
          break;
        case "record-new":
        case "function-new":
        case "error-new":
        case "reference-vector-new":
        case "string-literal":
        case "string-concat":
        case "array-new":
        case "array-subarray":
        case "array-buffer": {
          const idx = intern(op.id);
          nonNullEpoch[idx] = epoch;
          if (outValues !== undefined) outValues[idx] = 1;
          break;
        }
        case "reference-value":
        case "string-value":
        case "reference-wrap":
        case "string-wrap":
        case "primitive-wrap":
        case "primitive-reference": {
          const idx = intern(op.id),
            vIdx = intern(op.value);
          nonNullEpoch[idx] = epoch;
          if (outValues !== undefined) outValues[idx] = 1;
          markSourceSlotsNonNull(vIdx, curMask);
          if (loadSlotEpoch[vIdx] === epoch) {
            loadSlotEpoch[idx] = epoch;
            loadSlotBit[idx] = loadSlotBit[vIdx] ?? 0;
            loadSlotVer[idx] = loadSlotVer[vIdx] ?? 0;
          }
          if (loadSlot2Epoch[vIdx] === epoch) {
            loadSlot2Epoch[idx] = epoch;
            loadSlot2Bit[idx] = loadSlot2Bit[vIdx] ?? 0;
            loadSlot2Ver[idx] = loadSlot2Ver[vIdx] ?? 0;
          }
          break;
        }
        case "string-reference":
        case "reference-string": {
          const idx = intern(op.id),
            vIdx = intern(op.value);
          if (nonNullEpoch[vIdx] === epoch) {
            nonNullEpoch[idx] = epoch;
            if (outValues !== undefined) outValues[idx] = 1;
          }
          if (loadSlotEpoch[vIdx] === epoch) {
            loadSlotEpoch[idx] = epoch;
            loadSlotBit[idx] = loadSlotBit[vIdx] ?? 0;
            loadSlotVer[idx] = loadSlotVer[vIdx] ?? 0;
          }
          if (loadSlot2Epoch[vIdx] === epoch) {
            loadSlot2Epoch[idx] = epoch;
            loadSlot2Bit[idx] = loadSlot2Bit[vIdx] ?? 0;
            loadSlot2Ver[idx] = loadSlot2Ver[vIdx] ?? 0;
          }
          break;
        }
        case "string-present": {
          recordCmp(intern(op.id), intern(op.value), 1);
          break;
        }
        case "unary": {
          const idx = intern(op.id),
            vIdx = intern(op.operand);
          if (op.operator === "truthy") {
            recordCmp(idx, vIdx, 1);
          } else if (op.operator === "!") {
            if (cmpEpoch[vIdx] === epoch) {
              cmpEpoch[idx] = epoch;
              cmpValIdx[idx] = cmpValIdx[vIdx] ?? 0;
              cmpSlotBit[idx] = cmpSlotBit[vIdx] ?? 0;
              cmpSlotVer[idx] = cmpSlotVer[vIdx] ?? 0;
              cmpSlot2Bit[idx] = cmpSlot2Bit[vIdx] ?? 0;
              cmpSlot2Ver[idx] = cmpSlot2Ver[vIdx] ?? 0;
              cmpWhenTrue[idx] = cmpWhenTrue[vIdx] === 1 ? 0 : 1;
            } else {
              recordCmp(idx, vIdx, 0);
            }
          }
          break;
        }
        case "binary": {
          if (
            op.operator === "===" ||
            op.operator === "==" ||
            op.operator === "!==" ||
            op.operator === "!="
          ) {
            const idx = intern(op.id),
              lIdx = intern(op.left),
              rIdx = intern(op.right),
              whenTrue = op.operator === "===" || op.operator === "==" ? 0 : 1;
            if (noneEpoch[lIdx] === epoch && noneEpoch[rIdx] !== epoch)
              recordCmp(idx, rIdx, whenTrue);
            else if (noneEpoch[rIdx] === epoch && noneEpoch[lIdx] !== epoch)
              recordCmp(idx, lIdx, whenTrue);
          }
          break;
        }
      }
    }
    if (outValues !== undefined) return true;
    if (block.exception !== undefined)
      propagate(block.exception.target, curMask);
    const t = block.terminator;
    if (t.kind === "jump") {
      propagate(t.target, curMask);
    } else if (t.kind === "branch") {
      for (let w = 0; w < words; w++) {
        trueMask[w] = curMask[w] ?? 0;
        falseMask[w] = curMask[w] ?? 0;
      }
      const cIdx = intern(t.condition);
      if (cmpEpoch[cIdx] === epoch) {
        const dest = cmpWhenTrue[cIdx] === 1 ? trueMask : falseMask,
          bit1 = cmpSlotBit[cIdx] ?? 0,
          bit2 = cmpSlot2Bit[cIdx] ?? 0,
          valIdxPlus1 = cmpValIdx[cIdx] ?? 0;
        if (bit1 > 0 && (slotVer[bit1 - 1] ?? 0) === (cmpSlotVer[cIdx] ?? 0))
          setBit(dest, bit1 - 1);
        if (bit2 > 0 && (slotVer[bit2 - 1] ?? 0) === (cmpSlot2Ver[cIdx] ?? 0))
          setBit(dest, bit2 - 1);
        if (valIdxPlus1 > 0) markSourceSlotsNonNull(valIdxPlus1 - 1, dest);
      }
      propagate(t.consequent, trueMask);
      propagate(t.alternate, falseMask);
    } else if (t.kind === "record" || t.kind === "record-cell") {
      for (let w = 0; w < words; w++) trueMask[w] = curMask[w] ?? 0;
      markSourceSlotsNonNull(intern(t.object), trueMask);
      if (t.operation === "read") {
        const written = slotToBit[t.slot] ?? 0;
        if (written > 0) clearBit(trueMask, written - 1);
      }
      propagate(t.consequent, trueMask);
      propagate(t.alternate, curMask);
    } else if (t.kind === "cell") {
      for (let w = 0; w < words; w++) trueMask[w] = curMask[w] ?? 0;
      if (t.operation === "read") {
        const written = slotToBit[t.slot] ?? 0;
        if (written > 0) clearBit(trueMask, written - 1);
      }
      propagate(t.consequent, trueMask);
      propagate(t.alternate, curMask);
    }
    return true;
  }

  visited[fn.entry] = 1;
  queued[fn.entry] = 1;
  queue.push(fn.entry);
  while (head < queue.length) {
    const id = queue[head++];
    if (id === undefined) break;
    queued[id] = 0;
    if (!transferBlock(id, undefined)) return undefined;
  }
  const result = new Uint8Array(valueCount);
  for (let id = 0; id < blockCount; id++) {
    if (visited[id] !== 1) continue;
    if (!transferBlock(id, result)) return undefined;
  }
  return result;
}

export interface SelectArm {
  readonly kind: "load" | "constant" | "none";
  readonly slot: number;
  readonly value: number | boolean;
}

export interface NestedSelectCompare {
  readonly operator: "<" | "<=" | ">" | ">=" | "===" | "!==" | "==" | "!=";
  readonly type: ScalarType;
  readonly left: SelectArm;
  readonly right: SelectArm;
}

export interface NestedSelect {
  readonly innerBlock: number;
  readonly compare: NestedSelectCompare;
  readonly innerDiamond: SelectDiamond;
  readonly inTrueArm: boolean;
  readonly copyJoin: number | undefined;
}

export interface SelectDiamond {
  readonly targetSlot: number;
  readonly join: number;
  readonly trueArm: SelectArm;
  readonly falseArm: SelectArm;
  readonly fusedBlocks: readonly number[];
  readonly nested?: NestedSelect;
}

export interface SelectDiamondPlan {
  readonly diamonds: ReadonlyMap<number, SelectDiamond>;
  readonly fused: Uint8Array;
}

function isSelectableSlotType(type: ScalarType): boolean {
  return (
    type === "number" ||
    type === "boolean" ||
    type === "reference" ||
    type === "optional-reference" ||
    type === "string" ||
    type === "optional-string"
  );
}

/** Finds simple 1-arm and 2-arm conditional slot-assignment diamonds whose
 * branch arms are pure single-word loads or constants, so the branch can emit
 * branchless AArch64 `fcsel`/`csel` instead of unpredictable jumps. */
export function findSelectDiamonds(
  fn: FunctionIR,
  integerSlots: Uint8Array,
  dispatchFused: Uint8Array | undefined,
  armAllowed: (blockId: number) => boolean,
): SelectDiamondPlan {
  const blockCount = fn.blocks.length,
    predecessors = new Uint32Array(blockCount),
    fused = new Uint8Array(blockCount),
    diamonds = new Map<number, SelectDiamond>();
  for (const block of fn.blocks) {
    if (block === undefined) throw "select diamond block invariant";
    for (const successor of blockSuccessors(block))
      if (successor !== undefined)
        predecessors[successor] = (predecessors[successor] ?? 0) + 1;
    if (block.exception !== undefined)
      predecessors[block.exception.target] =
        (predecessors[block.exception.target] ?? 0) + 2;
  }

  function parseArm(blockId: number):
    | {
        readonly targetSlot: number;
        readonly join: number;
        readonly arm: SelectArm;
      }
    | undefined {
    if (
      blockId === fn.entry ||
      (predecessors[blockId] ?? 0) !== 1 ||
      dispatchFused?.[blockId] === 1 ||
      !armAllowed(blockId)
    )
      return undefined;
    const block = fn.blocks[blockId];
    if (
      block === undefined ||
      block.exception !== undefined ||
      block.instructions.length !== 2
    )
      return undefined;
    const term = block.terminator;
    if (term.kind !== "jump") return undefined;
    const op0 = block.instructions[0],
      op1 = block.instructions[1];
    if (op0 === undefined || op1 === undefined || op1.kind !== "store")
      return undefined;
    const targetSlot = op1.slot,
      slotType = fn.slots[targetSlot];
    if (slotType === undefined || !isSelectableSlotType(slotType))
      return undefined;
    const targetIsInt = slotType === "number" && integerSlots[targetSlot] === 1;
    let arm: SelectArm | undefined;
    if (op0.kind === "load" && op0.id === op1.value) {
      const srcType = fn.slots[op0.slot];
      if (srcType !== slotType) return undefined;
      if (targetIsInt && integerSlots[op0.slot] !== 1) return undefined;
      arm = { kind: "load", slot: op0.slot, value: 0 };
    } else if (op0.kind === "constant" && op0.id === op1.value) {
      if (slotType === "number") {
        if (typeof op0.value !== "number") return undefined;
        if (
          targetIsInt &&
          (!Number.isSafeInteger(op0.value) ||
            (op0.value === 0 && 1 / op0.value < 0))
        )
          return undefined;
      } else if (slotType === "boolean") {
        if (typeof op0.value !== "boolean") return undefined;
      } else return undefined;
      arm = { kind: "constant", slot: -1, value: op0.value };
    } else if (
      ((op0.kind === "reference-none" && slotType === "optional-reference") ||
        (op0.kind === "string-none" && slotType === "optional-string")) &&
      op0.id === op1.value
    ) {
      arm = { kind: "none", slot: -1, value: 0 };
    }
    if (arm === undefined) return undefined;
    return { targetSlot, join: term.target, arm };
  }

  for (const block of fn.blocks) {
    if (block === undefined) throw "select diamond block invariant";
    if (dispatchFused?.[block.id] === 1 || fused[block.id] === 1) continue;
    const t = block.terminator;
    if (
      t.kind !== "branch" ||
      t.consequent === t.alternate ||
      t.consequent === block.id ||
      t.alternate === block.id
    )
      continue;
    const tArm = parseArm(t.consequent),
      fArm = parseArm(t.alternate);
    if (
      tArm !== undefined &&
      fArm !== undefined &&
      tArm.targetSlot === fArm.targetSlot &&
      tArm.join === fArm.join &&
      tArm.join !== block.id &&
      tArm.join !== t.consequent &&
      tArm.join !== t.alternate
    ) {
      fused[t.consequent] = 1;
      fused[t.alternate] = 1;
      diamonds.set(block.id, {
        targetSlot: tArm.targetSlot,
        join: tArm.join,
        trueArm: tArm.arm,
        falseArm: fArm.arm,
        fusedBlocks: [t.consequent, t.alternate],
      });
    } else if (
      tArm !== undefined &&
      tArm.join === t.alternate &&
      tArm.join !== block.id
    ) {
      fused[t.consequent] = 1;
      diamonds.set(block.id, {
        targetSlot: tArm.targetSlot,
        join: tArm.join,
        trueArm: tArm.arm,
        falseArm: { kind: "load", slot: tArm.targetSlot, value: 0 },
        fusedBlocks: [t.consequent],
      });
    } else if (
      fArm !== undefined &&
      fArm.join === t.consequent &&
      fArm.join !== block.id
    ) {
      fused[t.alternate] = 1;
      diamonds.set(block.id, {
        targetSlot: fArm.targetSlot,
        join: fArm.join,
        trueArm: { kind: "load", slot: fArm.targetSlot, value: 0 },
        falseArm: fArm.arm,
        fusedBlocks: [t.alternate],
      });
    }
  }
  // Second pass: recognize 2-level nested select diamonds (e.g. `clamp`:
  // `x < lo ? lo : x > hi ? hi : x`), where one arm is a simple SelectArm
  // and the other is a single-predecessor pure-comparison 1-level diamond
  // joining either directly or through a single-slot copy block whose source
  // slot is dead at the outer join.
  let livenessChecked = false,
    liveSlots: readonly (readonly number[])[] | undefined;
  function isDeadAt(slot: number, blockId: number): boolean {
    if (!livenessChecked) {
      livenessChecked = true;
      liveSlots = analyzeLiveSlots(fn, 500000)?.slots;
    }
    if (liveSlots === undefined) return false;
    const live = liveSlots[blockId];
    return live === undefined || !live.includes(slot);
  }
  function parsePureCompare(blockId: number): NestedSelectCompare | undefined {
    if (
      blockId === fn.entry ||
      (predecessors[blockId] ?? 0) !== 1 ||
      dispatchFused?.[blockId] === 1 ||
      !armAllowed(blockId)
    )
      return undefined;
    const block = fn.blocks[blockId];
    if (
      block === undefined ||
      block.exception !== undefined ||
      block.instructions.length < 2
    )
      return undefined;
    const term = block.terminator;
    if (term.kind !== "branch") return undefined;
    const last = block.instructions[block.instructions.length - 1];
    if (
      last === undefined ||
      last.kind !== "binary" ||
      last.id !== term.condition
    )
      return undefined;
    const op = last.operator;
    if (
      op !== "<" &&
      op !== "<=" &&
      op !== ">" &&
      op !== ">=" &&
      op !== "===" &&
      op !== "!==" &&
      op !== "==" &&
      op !== "!="
    )
      return undefined;
    const defs = new Map<number, Instruction>();
    for (let i = 0; i < block.instructions.length - 1; i++) {
      const inst = block.instructions[i];
      if (inst === undefined) return undefined;
      if (
        inst.kind === "load" ||
        inst.kind === "constant" ||
        inst.kind === "reference-none" ||
        inst.kind === "string-none"
      )
        defs.set(inst.id, inst);
      else return undefined;
    }
    const toOperand = (
      id: number,
    ): { readonly arm: SelectArm; readonly type: ScalarType } | undefined => {
      const def = defs.get(id);
      if (def === undefined) return undefined;
      if (def.kind === "load") {
        const t = fn.slots[def.slot];
        if (
          t !== "number" &&
          t !== "boolean" &&
          t !== "reference" &&
          t !== "optional-reference"
        )
          return undefined;
        return { arm: { kind: "load", slot: def.slot, value: 0 }, type: t };
      }
      if (def.kind === "constant") {
        if (typeof def.value === "number")
          return {
            arm: { kind: "constant", slot: -1, value: def.value },
            type: "number",
          };
        if (typeof def.value === "boolean")
          return {
            arm: { kind: "constant", slot: -1, value: def.value },
            type: "boolean",
          };
        return undefined;
      }
      if (def.kind === "reference-none")
        return {
          arm: { kind: "none", slot: -1, value: 0 },
          type: "optional-reference",
        };
      return undefined;
    };
    const left = toOperand(last.left),
      right = toOperand(last.right);
    if (left === undefined || right === undefined || left.type !== right.type)
      return undefined;
    if (
      left.type !== "number" &&
      op !== "===" &&
      op !== "!==" &&
      op !== "==" &&
      op !== "!="
    )
      return undefined;
    return { operator: op, type: left.type, left: left.arm, right: right.arm };
  }
  function parseCopyJoin(
    blockId: number,
    fromSlot: number,
    toSlot: number,
    expectedJoin: number,
  ): boolean {
    if (
      blockId === fn.entry ||
      (predecessors[blockId] ?? 0) !== 2 ||
      dispatchFused?.[blockId] === 1 ||
      fused[blockId] === 1 ||
      !armAllowed(blockId)
    )
      return false;
    const block = fn.blocks[blockId];
    if (
      block === undefined ||
      block.exception !== undefined ||
      block.instructions.length !== 2
    )
      return false;
    const term = block.terminator;
    if (term.kind !== "jump" || term.target !== expectedJoin) return false;
    const op0 = block.instructions[0],
      op1 = block.instructions[1];
    if (
      op0 === undefined ||
      op1 === undefined ||
      op0.kind !== "load" ||
      op0.slot !== fromSlot ||
      op1.kind !== "store" ||
      op1.slot !== toSlot ||
      op1.value !== op0.id
    )
      return false;
    if (
      fn.slots[fromSlot] !== fn.slots[toSlot] ||
      (integerSlots[fromSlot] === 1) !== (integerSlots[toSlot] === 1)
    )
      return false;
    return isDeadAt(fromSlot, expectedJoin);
  }
  for (const block of fn.blocks) {
    if (block === undefined) throw "select diamond block invariant";
    if (
      dispatchFused?.[block.id] === 1 ||
      fused[block.id] === 1 ||
      diamonds.has(block.id)
    )
      continue;
    const t = block.terminator;
    if (
      t.kind !== "branch" ||
      t.consequent === t.alternate ||
      t.consequent === block.id ||
      t.alternate === block.id
    )
      continue;
    const tryNested = (
      simpleId: number,
      innerId: number,
      innerInTrue: boolean,
    ): boolean => {
      const simple = parseArm(simpleId),
        inner = diamonds.get(innerId);
      if (
        simple === undefined ||
        inner === undefined ||
        inner.nested !== undefined ||
        simple.join === block.id ||
        simple.join === simpleId ||
        simple.join === innerId ||
        fused[simpleId] === 1 ||
        fused[innerId] === 1
      )
        return false;
      const compare = parsePureCompare(innerId);
      if (compare === undefined) return false;
      const targetSlot = simple.targetSlot,
        join = simple.join;
      let copyJoin: number | undefined;
      if (inner.join === join && inner.targetSlot === targetSlot) {
        copyJoin = undefined;
      } else if (
        parseCopyJoin(inner.join, inner.targetSlot, targetSlot, join)
      ) {
        copyJoin = inner.join;
      } else return false;
      diamonds.delete(innerId);
      fused[simpleId] = 1;
      fused[innerId] = 1;
      const fusedBlocks: number[] = [simpleId, innerId];
      for (const fb of inner.fusedBlocks)
        if (fb !== undefined) fusedBlocks.push(fb);
      if (copyJoin !== undefined) {
        fused[copyJoin] = 1;
        fusedBlocks.push(copyJoin);
      }
      const placeholder: SelectArm = { kind: "none", slot: -1, value: 0 };
      diamonds.set(block.id, {
        targetSlot,
        join,
        trueArm: innerInTrue ? placeholder : simple.arm,
        falseArm: innerInTrue ? simple.arm : placeholder,
        fusedBlocks,
        nested: {
          innerBlock: innerId,
          compare,
          innerDiamond: inner,
          inTrueArm: innerInTrue,
          copyJoin,
        },
      });
      return true;
    };
    if (!tryNested(t.consequent, t.alternate, false))
      tryNested(t.alternate, t.consequent, true);
  }
  return { diamonds, fused };
}
