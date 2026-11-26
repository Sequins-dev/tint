import {
  blockSuccessors,
  visitInstructionOperands,
  type Block,
  type FunctionIR,
  type Instruction,
} from "@tint/ir/scalar";

/** The part a block plays in a fused cached property access (or inline
 * element access, which misses and tests the same way): the access
 * itself (`access`, whose miss jumps to `miss` directly), the miss test the
 * branch reads (`test`, not emitted; the branch goes to `hit`), or both. */
export interface FusedPropertyAccess {
  readonly access: number | undefined;
  readonly miss: number;
  readonly test: number | undefined;
  readonly hit: number;
  /** Indices of the access block's stores after the load whose slots only
   * the skipped test reads (such as an inlined test's parameter): neither
   * edge observes them, so they are not emitted. */
  readonly skipped: readonly number[];
}

/** Instructions a miss may skip besides stores: block-local values without
 * effects that cannot trap. */
function skippable(op: Instruction): boolean {
  return (
    op.kind === "load" ||
    op.kind === "constant" ||
    op.kind === "string-literal" ||
    op.kind === "reference-none" ||
    op.kind === "general-none" ||
    op.kind === "closure-environment" ||
    op.kind === "record-read" ||
    op.kind === "general-is" ||
    (op.kind === "general-value" && op.unchecked === true)
  );
}

/** Whether some path from `start` reads one of `slots` before writing it:
 * a slot load, a terminator writing from the slot, or (conservatively) any
 * reach of an exception handler. Undefined past `budget` blocks. */
function slotsLiveAt(
  fn: FunctionIR,
  start: number,
  slots: readonly number[],
  budget: number,
): boolean | undefined {
  const seen = new Set<string>();
  const initial = slots.slice();
  initial.sort((a: number, b: number): number => a - b);
  const pending: { readonly block: number; readonly live: number[] }[] = [];
  pending.push({ block: start, live: initial });
  while (pending.length > 0) {
    const next = pending.pop();
    if (next === undefined) throw "property fusion worklist invariant";
    // Live sets only shrink along a path; each (block, set) is walked once.
    const key = String(next.block) + ":" + next.live.join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    if (seen.size > budget) return undefined;
    const block = fn.blocks[next.block];
    if (block === undefined) throw "property fusion block invariant";
    const live = next.live.slice();
    for (const op of block.instructions) {
      if (op === undefined) throw "property fusion instruction invariant";
      if (op.kind === "load" && live.indexOf(op.slot) >= 0) return true;
      if (op.kind === "store") {
        const at = live.indexOf(op.slot);
        if (at >= 0) live.splice(at, 1);
      }
    }
    if (live.length === 0) continue;
    const t = block.terminator;
    if (
      (t.kind === "record" || t.kind === "record-cell" || t.kind === "cell") &&
      t.operation !== "read" &&
      live.indexOf(t.slot) >= 0
    )
      return true;
    if (block.exception !== undefined) return true;
    for (const successor of blockSuccessors(block)) {
      if (successor === undefined) throw "property fusion successor invariant";
      pending.push({ block: successor, live });
    }
  }
  return false;
}

/** Blocks taking part in a fusable cached property access.
 *
 * A store qualifies when it is its block's last instruction and the branch
 * reads its result (true selects the consequent, the hit).
 *
 * A load qualifies when only skippable instructions and stores follow it in
 * its block, which either ends in the branch or jumps to a block (with no
 * other predecessor) of slot loads and constants only that ends in it, and
 * the branch reads the absent test of the load's value (directly or through
 * slots it was stored to) as the block's last instruction. Every slot those
 * stores write must be dead where the miss continues, so skipping them is
 * unobservable. */
/** A load whose miss is the absent value. */
function missingLoad(op: Instruction | undefined): boolean {
  return (
    op?.kind === "property-load" ||
    op?.kind === "element-load" ||
    op?.kind === "general-element-load" ||
    op?.kind === "element-length"
  );
}
/** Predecessor counts over normal and exceptional edges. */
function predecessorCounts(fn: FunctionIR): Uint32Array {
  const counts = new Uint32Array(fn.blocks.length);
  for (const block of fn.blocks) {
    if (block === undefined) throw "property fusion block invariant";
    for (const successor of blockSuccessors(block))
      if (successor !== undefined)
        counts[successor] = (counts[successor] ?? 0) + 1;
  }
  return counts;
}
/** What follows a property-load: the values and slots holding its value,
 * and every slot stored after it. */
interface LoadUses {
  readonly aliases: Set<number>;
  readonly aliasSlots: number[];
  readonly stored: number[];
}
/** Track a store or load after the access; false for anything else. */
function followLoad(uses: LoadUses, op: Instruction): boolean {
  if (op.kind === "store") {
    uses.stored.push(op.slot);
    const at = uses.aliasSlots.indexOf(op.slot);
    if (uses.aliases.has(op.value)) {
      if (at < 0) uses.aliasSlots.push(op.slot);
    } else if (at >= 0) uses.aliasSlots.splice(at, 1);
    return true;
  }
  if (op.kind === "load") {
    if (uses.aliasSlots.indexOf(op.slot) >= 0) uses.aliases.add(op.id);
    return true;
  }
  return false;
}

/** Blocks taking part in a fusable cached property access.
 *
 * A store qualifies when it is its block's last instruction and the branch
 * reads its result (true selects the consequent, the hit).
 *
 * A load qualifies when only skippable instructions and stores follow it in
 * its block, which either ends in the branch or jumps to a block (with no
 * other predecessor) of slot loads and constants only that ends in it, and
 * the branch reads the absent test of the load's value (directly or through
 * slots it was stored to) as the block's last instruction. Every slot those
 * stores write must be dead where the miss continues, so skipping them is
 * unobservable. */
export function fusedPropertyAccesses(
  fn: FunctionIR,
  budget: number = 4096,
): ReadonlyMap<number, FusedPropertyAccess> {
  const fused = new Map<number, FusedPropertyAccess>();
  const none = new Uint32Array(0);
  let counted: Uint32Array = none;
  for (const block of fn.blocks) {
    if (block === undefined) throw "property fusion block invariant";
    const t = block.terminator;
    const final = block.instructions[block.instructions.length - 1];
    if (
      t.kind === "branch" &&
      t.consequent !== t.alternate &&
      final !== undefined &&
      (final.kind === "property-store" ||
        final.kind === "element-store" ||
        final.kind === "general-element-store") &&
      final.id === t.condition
    ) {
      fused.set(block.id, {
        access: final.id,
        miss: t.alternate,
        test: final.id,
        hit: t.consequent,
        skipped: [],
      });
      continue;
    }
    // The last property-load (or element-load) and what follows it.
    let index = block.instructions.length - 1;
    while (index >= 0 && !missingLoad(block.instructions[index])) index--;
    const load = block.instructions[index];
    if (
      load === undefined ||
      (load.kind !== "property-load" &&
        load.kind !== "element-load" &&
        load.kind !== "general-element-load" &&
        load.kind !== "element-length")
    )
      continue;
    const uses: LoadUses = {
      aliases: new Set<number>(),
      aliasSlots: [],
      stored: [],
    };
    uses.aliases.add(load.id);
    const last = block.instructions.length - 1;
    let valid: boolean = true;
    for (let next = index + 1; next <= last && valid; next++) {
      const op = block.instructions[next];
      if (op === undefined) throw "property fusion instruction invariant";
      if (!followLoad(uses, op) && !skippable(op)) valid = false;
    }
    if (!valid) continue;
    let testBlock: Block = block;
    let testStart = index + 1;
    if (t.kind === "jump") {
      const target = fn.blocks[t.target];
      if (target === undefined || target.id === block.id) continue;
      if (counted.length === 0) counted = predecessorCounts(fn);
      const predecessors = counted;
      if (predecessors[target.id] !== 1 || target.exception !== undefined)
        continue;
      for (let next = 0; next < target.instructions.length && valid; next++) {
        const op = target.instructions[next];
        if (op === undefined) throw "property fusion instruction invariant";
        if (op.kind === "load") followLoad(uses, op);
        else if (
          op.kind !== "constant" &&
          op.kind !== "reference-none" &&
          op.kind !== "general-none" &&
          !(op.kind === "general-is" && op.type === "absent")
        )
          valid = false;
      }
      if (!valid) continue;
      testBlock = target;
      testStart = 0;
    }
    const branch = testBlock.terminator;
    if (branch.kind !== "branch" || branch.consequent === branch.alternate)
      continue;
    let testId = -1;
    let testIndex = -1;
    for (let next = testStart; next < testBlock.instructions.length; next++) {
      const op = testBlock.instructions[next];
      if (
        op !== undefined &&
        op.kind === "general-is" &&
        op.type === "absent" &&
        op.id === branch.condition &&
        uses.aliases.has(op.value)
      ) {
        testId = op.id;
        testIndex = next;
        break;
      }
    }
    if (testId < 0) continue;
    // The skipped test value may only be consumed by the branch terminator.
    let usedByOp = false;
    for (
      let next = testIndex + 1;
      next < testBlock.instructions.length && !usedByOp;
      next++
    ) {
      const op = testBlock.instructions[next];
      if (op !== undefined)
        visitInstructionOperands(op, (id) => {
          if (id === branch.condition) usedByOp = true;
        });
    }
    if (usedByOp) continue;
    // The test is true when the load missed.
    if (
      uses.stored.length > 0 &&
      slotsLiveAt(fn, branch.consequent, uses.stored, budget) !== false
    )
      continue;
    // A store no later instruction of the block reads, whose slot only
    // the test block loads (for the test alone) and is dead on the hit
    // edge, is not emitted.
    const skipped: number[] = [];
    if (testBlock !== block)
      for (let next = index + 1; next <= last; next++) {
        const op = block.instructions[next];
        if (op === undefined) throw "property fusion instruction invariant";
        if (op.kind !== "store") continue;
        let read: boolean = false;
        for (let later = next + 1; later <= last; later++) {
          const after = block.instructions[later];
          if (after === undefined)
            throw "property fusion instruction invariant";
          if (after.kind === "load" && after.slot === op.slot) read = true;
        }
        const slots: number[] = [];
        slots.push(op.slot);
        if (!read && slotsLiveAt(fn, branch.alternate, slots, budget) === false)
          skipped.push(next);
      }
    fused.set(block.id, {
      access: load.id,
      miss: branch.consequent,
      test: testBlock === block ? testId : undefined,
      hit: branch.alternate,
      skipped,
    });
    if (testBlock !== block)
      fused.set(testBlock.id, {
        access: undefined,
        miss: branch.consequent,
        test: testId,
        hit: branch.alternate,
        skipped: [],
      });
  }
  return fused;
}

/** Value IDs within `fn` proven to hold the closure returned by a
 * `script-entry` instruction (always a `functionRecord` with the script-entry
 * ABI signature). Undefined when `fn` contains no `script-entry`. */
export function scriptEntryCalleeValues(
  fn: FunctionIR,
): ReadonlySet<number> | undefined {
  let hasScriptEntry = false;
  for (const block of fn.blocks) {
    if (block === undefined) throw "script entry analysis block invariant";
    for (const op of block.instructions) {
      if (op !== undefined && op.kind === "script-entry") {
        hasScriptEntry = true;
        break;
      }
    }
    if (hasScriptEntry) break;
  }
  if (!hasScriptEntry) return undefined;
  const ineligible = new Set<number>();
  for (const param of fn.parameters)
    if (param !== undefined) ineligible.add(param);
  const receiverSlot = fn.receiverSlot;
  if (receiverSlot !== undefined) ineligible.add(receiverSlot);
  const closureEnvironment = fn.closureEnvironment;
  if (closureEnvironment !== undefined) ineligible.add(closureEnvironment);
  const slotStores = new Map<number, number[]>();
  const proven = new Set<number>();
  for (const block of fn.blocks) {
    if (block === undefined) throw "script entry analysis block invariant";
    const exception = block.exception;
    if (exception !== undefined) ineligible.add(exception.slot);
    const t = block.terminator;
    if (
      (t.kind === "record" || t.kind === "record-cell" || t.kind === "cell") &&
      t.operation === "read"
    )
      ineligible.add(t.slot);
    for (const op of block.instructions) {
      if (op === undefined) throw "script entry analysis instruction invariant";
      if (op.kind === "script-entry") proven.add(op.id);
      else if (op.kind === "store") {
        let list = slotStores.get(op.slot);
        if (list === undefined) {
          list = [];
          slotStores.set(op.slot, list);
        }
        list.push(op.value);
      }
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const block of fn.blocks) {
      if (block === undefined) throw "script entry analysis block invariant";
      for (const op of block.instructions) {
        if (op === undefined)
          throw "script entry analysis instruction invariant";
        if (
          op.kind === "reference-value" &&
          proven.has(op.value) &&
          !proven.has(op.id)
        ) {
          proven.add(op.id);
          changed = true;
        } else if (
          op.kind === "load" &&
          !ineligible.has(op.slot) &&
          !proven.has(op.id)
        ) {
          const stores = slotStores.get(op.slot);
          if (stores !== undefined && stores.length > 0) {
            let allProven = true;
            for (const stored of stores)
              if (stored === undefined || !proven.has(stored)) {
                allProven = false;
                break;
              }
            if (allProven) {
              proven.add(op.id);
              changed = true;
            }
          }
        }
      }
    }
  }
  return proven;
}

/** Property-load / property-store instruction IDs whose receiver value is
 * already proven to carry the general object tag (tag === 5) on every path
 * reaching the instruction, allowing codegen to load the payload directly and
 * skip the redundant tag test (and string-primitive cold stub). Undefined when
 * `fn` contains no `property-load` or `property-store`. */
export function knownObjectTagAccesses(
  fn: FunctionIR,
  fusedAccesses: ReadonlyMap<number, FusedPropertyAccess> | undefined,
): ReadonlySet<number> | undefined {
  let hasPropertyAccess = false;
  for (const block of fn.blocks) {
    if (block === undefined) throw "known object tag block invariant";
    for (const op of block.instructions) {
      if (
        op !== undefined &&
        (op.kind === "property-load" || op.kind === "property-store")
      ) {
        hasPropertyAccess = true;
        break;
      }
    }
    if (hasPropertyAccess) break;
  }
  if (!hasPropertyAccess) return undefined;
  const generalSlots = new Map<number, number>();
  for (let slot = 0; slot < fn.slots.length; slot++) {
    if (fn.slots[slot] === "general") generalSlots.set(slot, generalSlots.size);
  }
  const slotCount = generalSlots.size;
  const blockCount = fn.blocks.length;
  const inKnown: (Uint8Array | undefined)[] = [];
  for (let index = 0; index < blockCount; index++) inKnown.push(undefined);
  inKnown[fn.entry] = new Uint8Array(slotCount);
  const worklist: number[] = [fn.entry];
  const queued = new Uint8Array(blockCount);
  queued[fn.entry] = 1;
  function propagate(target: number, edgeOut: Uint8Array): void {
    if (target === fn.entry) return;
    const existing = inKnown[target];
    if (existing === undefined) {
      inKnown[target] = edgeOut.slice();
      if (queued[target] === 0) {
        queued[target] = 1;
        worklist.push(target);
      }
      return;
    }
    let changed = false;
    for (let i = 0; i < slotCount; i++) {
      if (existing[i] === 1 && edgeOut[i] === 0) {
        existing[i] = 0;
        changed = true;
      }
    }
    if (changed && queued[target] === 0) {
      queued[target] = 1;
      worklist.push(target);
    }
  }
  const maxSteps = Math.max(256, blockCount * 16);
  let steps = 0;
  const valueKnown = new Set<number>();
  const valueSlot = new Map<number, number>();
  const valueSlotVersion = new Map<number, number>();
  const recordIsSlot = new Map<number, number>();
  const recordIsVersion = new Map<number, number>();
  const recordIsNegated = new Set<number>();
  const slotVersion = new Uint32Array(slotCount);
  const storedSlots = new Uint8Array(slotCount);
  while (worklist.length > 0) {
    if (++steps > maxSteps) return undefined;
    const blockId = worklist.pop();
    if (blockId === undefined) break;
    queued[blockId] = 0;
    const block = fn.blocks[blockId];
    const entry = inKnown[blockId];
    if (block === undefined || entry === undefined) continue;
    const knownSlots = entry.slice();
    valueKnown.clear();
    valueSlot.clear();
    valueSlotVersion.clear();
    recordIsSlot.clear();
    recordIsVersion.clear();
    recordIsNegated.clear();
    slotVersion.fill(0);
    storedSlots.fill(0);
    const fusion = fusedAccesses?.get(blockId);
    let missOut: Uint8Array | undefined = undefined;
    for (const op of block.instructions) {
      if (op === undefined) throw "known object tag instruction invariant";
      if (op.kind === "load") {
        const idx = generalSlots.get(op.slot);
        if (idx !== undefined) {
          valueSlot.set(op.id, idx);
          valueSlotVersion.set(op.id, slotVersion[idx] ?? 0);
          if (knownSlots[idx] === 1) valueKnown.add(op.id);
        }
      } else if (op.kind === "store") {
        const idx = generalSlots.get(op.slot);
        if (idx !== undefined) {
          storedSlots[idx] = 1;
          slotVersion[idx] = (slotVersion[idx] ?? 0) + 1;
          knownSlots[idx] = valueKnown.has(op.value) ? 1 : 0;
        }
      } else if (op.kind === "general-record-is") {
        const idx = valueSlot.get(op.value);
        if (idx !== undefined) {
          const ver = valueSlotVersion.get(op.value);
          if (ver !== undefined && ver === (slotVersion[idx] ?? 0)) {
            recordIsSlot.set(op.id, idx);
            recordIsVersion.set(op.id, ver);
          }
        }
      } else if (op.kind === "unary" && op.operator === "!") {
        const idx = recordIsSlot.get(op.operand);
        if (idx !== undefined) {
          const ver = recordIsVersion.get(op.operand);
          if (ver !== undefined && ver === (slotVersion[idx] ?? 0)) {
            recordIsSlot.set(op.id, idx);
            recordIsVersion.set(op.id, ver);
            if (!recordIsNegated.has(op.operand)) recordIsNegated.add(op.id);
          }
        }
      } else if (
        (op.kind === "property-load" || op.kind === "property-store") &&
        fusion !== undefined &&
        fusion.access === op.id
      ) {
        missOut = knownSlots.slice();
        if (op.kind === "property-store" || !op.inherited) {
          valueKnown.add(op.object);
          const idx = valueSlot.get(op.object);
          if (
            idx !== undefined &&
            valueSlotVersion.get(op.object) === (slotVersion[idx] ?? 0)
          )
            knownSlots[idx] = 1;
        }
      }
    }
    const exception = block.exception;
    if (exception !== undefined) {
      const exOut = entry.slice();
      for (let i = 0; i < slotCount; i++)
        if (storedSlots[i] === 1) exOut[i] = 0;
      const exIdx = generalSlots.get(exception.slot);
      if (exIdx !== undefined) exOut[exIdx] = 0;
      propagate(exception.target, exOut);
    }
    const t = block.terminator;
    if (
      (t.kind === "record" || t.kind === "record-cell" || t.kind === "cell") &&
      t.operation === "read"
    ) {
      const idx = generalSlots.get(t.slot);
      if (idx !== undefined) knownSlots[idx] = 0;
    }
    if (
      fusion !== undefined &&
      fusion.access !== undefined &&
      missOut !== undefined
    ) {
      propagate(fusion.miss, missOut);
      if (t.kind === "branch") propagate(fusion.hit, knownSlots);
      else if (t.kind === "jump") propagate(t.target, knownSlots);
    } else if (t.kind === "branch") {
      if (
        fusion !== undefined &&
        fusion.test === t.condition &&
        fusion.access === undefined
      ) {
        propagate(fusion.hit, knownSlots);
      } else {
        const recSlot = recordIsSlot.get(t.condition);
        const recVer = recordIsVersion.get(t.condition);
        if (
          recSlot !== undefined &&
          recVer !== undefined &&
          recVer === (slotVersion[recSlot] ?? 0)
        ) {
          const negated = recordIsNegated.has(t.condition);
          const proved = knownSlots.slice();
          proved[recSlot] = 1;
          propagate(negated ? t.alternate : t.consequent, proved);
          propagate(negated ? t.consequent : t.alternate, knownSlots);
        } else {
          propagate(t.consequent, knownSlots);
          propagate(t.alternate, knownSlots);
        }
      }
    } else if (t.kind === "jump") {
      propagate(t.target, knownSlots);
    } else if (
      t.kind === "record" ||
      t.kind === "record-cell" ||
      t.kind === "cell"
    ) {
      propagate(t.consequent, knownSlots);
      propagate(t.alternate, knownSlots);
    }
  }
  const proven = new Set<number>();
  for (let blockId = 0; blockId < blockCount; blockId++) {
    const block = fn.blocks[blockId];
    const entry = inKnown[blockId];
    if (block === undefined || entry === undefined) continue;
    const knownSlots = entry.slice();
    valueKnown.clear();
    valueSlot.clear();
    valueSlotVersion.clear();
    slotVersion.fill(0);
    const fusion = fusedAccesses?.get(blockId);
    for (const op of block.instructions) {
      if (op === undefined) throw "known object tag instruction invariant";
      if (op.kind === "load") {
        const idx = generalSlots.get(op.slot);
        if (idx !== undefined) {
          valueSlot.set(op.id, idx);
          valueSlotVersion.set(op.id, slotVersion[idx] ?? 0);
          if (knownSlots[idx] === 1) valueKnown.add(op.id);
        }
      } else if (op.kind === "store") {
        const idx = generalSlots.get(op.slot);
        if (idx !== undefined) {
          slotVersion[idx] = (slotVersion[idx] ?? 0) + 1;
          knownSlots[idx] = valueKnown.has(op.value) ? 1 : 0;
        }
      } else if (op.kind === "property-load" || op.kind === "property-store") {
        if (valueKnown.has(op.object)) proven.add(op.id);
        if (
          fusion !== undefined &&
          fusion.access === op.id &&
          (op.kind === "property-store" || !op.inherited)
        ) {
          valueKnown.add(op.object);
          const idx = valueSlot.get(op.object);
          if (
            idx !== undefined &&
            valueSlotVersion.get(op.object) === (slotVersion[idx] ?? 0)
          )
            knownSlots[idx] = 1;
        }
      }
    }
  }
  return proven.size === 0 ? undefined : proven;
}
