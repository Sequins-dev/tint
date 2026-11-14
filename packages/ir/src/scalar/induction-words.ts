import type { FunctionIR, Instruction, Block } from "./model.ts";
import { instructionResult } from "./operands.ts";
/** Verified IR with stable local slots and no opaque alias mutation only.
 * Recognize constant initialization plus guarded unit-step increments. A
 * dominating `slot < bound` edge with no intervening write or cycle establishes
 * the guard (see guardedBy); unsupported updates retain checks. */
export function provenInductionWords(
  fn: FunctionIR,
  maxWork: number = 200000,
): Uint8Array | undefined {
  if (!Number.isSafeInteger(maxWork) || maxWork < 1) return undefined;
  let work = fn.slots.length + fn.blocks.length,
    maximum = -1,
    count = 0,
    additions = 0;
  if (work > maxWork) return undefined;
  for (const block of fn.blocks) {
    if (block === undefined) throw "induction block invariant";
    for (const op of block.instructions) {
      if (op === undefined) throw "induction instruction invariant";
      if (++work > maxWork) return undefined;
      count++;
      const id = instructionResult(op);
      if (id !== undefined) maximum = Math.max(maximum, id);
      if (op.kind === "binary" && op.operator === "+") additions++;
    }
  }
  if (additions === 0 || maximum > count * 4 + 16 || maximum >= maxWork)
    return undefined;
  const definitions: (Instruction | undefined)[] = [],
    positions = new Uint32Array(maximum + 1),
    predecessors: number[][] = [],
    valid = new Uint8Array(fn.slots.length),
    initialized = new Uint8Array(fn.slots.length),
    updated = new Uint8Array(fn.slots.length);
  for (let slot = 0; slot < fn.slots.length; slot++)
    valid[slot] = fn.slots[slot] === "number" ? 1 : 0;
  for (const parameter of fn.parameters) {
    if (parameter === undefined) throw "induction parameter invariant";
    valid[parameter] = 0;
  }
  for (let id = 0; id < fn.blocks.length; id++) predecessors.push([]);
  function edge(from: number, to: number): void {
    const list = predecessors[to];
    if (list === undefined) throw "induction edge invariant";
    list.push(from);
  }
  for (const block of fn.blocks) {
    if (block === undefined) throw "induction block invariant";
    for (let position = 0; position < block.instructions.length; position++) {
      if (++work > maxWork) return undefined;
      const op = block.instructions[position];
      if (op === undefined) throw "induction instruction invariant";
      const id = instructionResult(op);
      if (id !== undefined) {
        definitions[id] = op;
        positions[id] = position;
      }
    }
    const term = block.terminator;
    if (term.kind === "jump") edge(block.id, term.target);
    else if (
      term.kind === "branch" ||
      term.kind === "record" ||
      term.kind === "cell" ||
      term.kind === "record-cell"
    ) {
      edge(block.id, term.consequent);
      edge(block.id, term.alternate);
      if (term.kind !== "branch" && term.operation === "read")
        valid[term.slot] = 0;
    }
    if (block.exception !== undefined) edge(block.id, block.exception.target);
  }
  // Slots whose every write is a store of a word-sized bound value.
  const boundSlots = new Uint8Array(fn.slots.length);
  for (let slot = 0; slot < fn.slots.length; slot++)
    if (fn.slots[slot] === "number") boundSlots[slot] = 1;
  for (const parameter of fn.parameters)
    if (parameter !== undefined) boundSlots[parameter] = 0;
  if (fn.receiverSlot !== undefined) boundSlots[fn.receiverSlot] = 0;
  for (const block of fn.blocks) {
    if (block === undefined) throw "induction block invariant";
    if (block.exception !== undefined) boundSlots[block.exception.slot] = 0;
    const term = block.terminator;
    if (
      term.kind === "record" ||
      term.kind === "cell" ||
      term.kind === "record-cell"
    )
      boundSlots[term.slot] = 0;
    for (const op of block.instructions) {
      if (++work > maxWork) return undefined;
      if (op === undefined || op.kind !== "store") continue;
      const stored = definitions[op.value];
      if (stored === undefined || !boundValue(stored)) boundSlots[op.slot] = 0;
    }
  }
  /** A word-sized upper bound: a 32-bit constant, an array or string length
   * or a uint32 conversion (array lengths lower as `uint32(length)`), or a
   * load of a slot that only ever stores such values (LICM carries a hoisted
   * bound in a fresh slot). */
  function wordBound(op: Instruction | undefined): boolean {
    if (op === undefined) return false;
    if (op.kind === "load") return boundSlots[op.slot] === 1;
    return boundValue(op);
  }
  function boundValue(op: Instruction): boolean {
    return (
      wordConstant(op) ||
      op.kind === "array-length" ||
      op.kind === "string-length" ||
      (op.kind === "unary" && op.operator === "uint32") ||
      (op.kind === "binary" && op.operator === ">>>")
    );
  }
  function wordConstant(op: Instruction | undefined): boolean {
    if (op === undefined || op.kind !== "constant") return false;
    const value = op.value;
    return (
      typeof value === "number" &&
      Number.isInteger(value) &&
      value >= -2147483648 &&
      value <= 4294967295 &&
      (value !== 0 || 1 / value > 0)
    );
  }
  function one(op: Instruction | undefined): boolean {
    return op !== undefined && op.kind === "constant" && op.value === 1;
  }
  /** Blocks reachable from start (inclusive) along successor edges, or
   * along predecessor edges when backward, without entering stop or taking
   * the edge skipFrom -> skipTo. Undefined on budget exhaustion. */
  function reach(
    start: number,
    stop: number,
    backward: boolean,
    skipFrom: number = -1,
    skipTo: number = -1,
  ): Uint8Array | undefined {
    const seen = new Uint8Array(fn.blocks.length),
      stack = [start],
      targets: number[] = [];
    seen[start] = 1;
    while (stack.length > 0) {
      const id = stack.pop();
      if (id === undefined) throw "induction reach invariant";
      targets.length = 0;
      if (backward) {
        const list = predecessors[id];
        if (list === undefined) throw "induction reach invariant";
        for (const from of list) {
          if (from === undefined) throw "induction predecessor invariant";
          targets.push(from);
        }
      } else {
        const block = fn.blocks[id];
        if (block === undefined) throw "induction reach block invariant";
        const term = block.terminator;
        if (term.kind === "jump") targets.push(term.target);
        else if (
          term.kind === "branch" ||
          term.kind === "record" ||
          term.kind === "cell" ||
          term.kind === "record-cell"
        )
          targets.push(term.consequent, term.alternate);
        if (block.exception !== undefined) targets.push(block.exception.target);
      }
      for (const target of targets) {
        if (target === undefined) throw "induction successor invariant";
        if (++work > maxWork) return undefined;
        if (id === skipFrom && target === skipTo) continue;
        if (target === stop || seen[target] === 1) continue;
        seen[target] = 1;
        stack.push(target);
      }
    }
    return seen;
  }
  /** The guard block's branch tests `load(slot) < bound` (see wordBound) after the block's last store to the slot. Its consequent
   * edge G -> C must dominate the update in block L, no path from C to the
   * update may store to the slot, and L must not reach itself without passing
   * G. Every executed update then follows a guard observing the same value. */
  function guardedBy(
    guard: Block,
    block: Block,
    position: number,
    slot: number,
  ): boolean {
    const term = guard.terminator;
    if (term.kind !== "branch" || term.consequent === term.alternate)
      return false;
    const condition = definitions[term.condition];
    if (
      condition === undefined ||
      condition.kind !== "binary" ||
      condition.operator !== "<"
    )
      return false;
    const left = definitions[condition.left],
      right = definitions[condition.right],
      begin = positions[condition.left] ?? 0;
    if (
      left === undefined ||
      left.kind !== "load" ||
      left.slot !== slot ||
      guard.instructions[begin] !== left ||
      !wordBound(right)
    )
      return false;
    for (let i = begin + 1; i < guard.instructions.length; i++) {
      if (++work > maxWork) return false;
      const op = guard.instructions[i];
      if (op === undefined) throw "induction scan invariant";
      if (op.kind === "store" && op.slot === slot) return false;
    }
    const consequent = term.consequent;
    if (consequent === guard.id || block.id === guard.id) return false;
    // The edge dominates L: without it, L is unreachable from entry.
    const bypass = reach(fn.entry, -1, false, guard.id, consequent);
    if (bypass === undefined || bypass[block.id] === 1) return false;
    const forward = reach(consequent, guard.id, false),
      backward = reach(block.id, guard.id, true);
    if (forward === undefined || backward === undefined) return false;
    if (forward[block.id] !== 1) return false;
    // A successor of L that reaches L again avoiding G closes a cycle.
    const t = block.terminator;
    const exits: number[] = [];
    if (t.kind === "jump") exits.push(t.target);
    else if (
      t.kind === "branch" ||
      t.kind === "record" ||
      t.kind === "cell" ||
      t.kind === "record-cell"
    )
      exits.push(t.consequent, t.alternate);
    if (block.exception !== undefined) exits.push(block.exception.target);
    for (const target of exits) {
      if (target === undefined) throw "induction exit invariant";
      if (target !== guard.id && backward[target] === 1) return false;
    }
    // No store, or slot-reading terminator, on any path C -> L.
    for (const candidate of fn.blocks) {
      if (candidate === undefined) throw "induction region invariant";
      if (forward[candidate.id] !== 1 || backward[candidate.id] !== 1) continue;
      const own = candidate.id === block.id,
        end = own ? position : candidate.instructions.length;
      const ct = candidate.terminator;
      if (
        !own &&
        (ct.kind === "cell" ||
          ct.kind === "record" ||
          ct.kind === "record-cell") &&
        ct.operation === "read" &&
        ct.slot === slot
      )
        return false;
      for (let i = 0; i < end; i++) {
        if (++work > maxWork) return false;
        const op = candidate.instructions[i];
        if (op === undefined) throw "induction scan invariant";
        if (op.kind === "store" && op.slot === slot) return false;
      }
    }
    return true;
  }
  function guarded(block: Block, position: number, slot: number): boolean {
    for (const guard of fn.blocks) {
      if (guard === undefined) throw "induction guard block invariant";
      if (++work > maxWork) return false;
      if (guardedBy(guard, block, position, slot)) return true;
    }
    return false;
  }
  for (const block of fn.blocks) {
    if (block === undefined) throw "induction block invariant";
    for (const op of block.instructions) {
      if (op === undefined) throw "induction instruction invariant";
      if (++work > maxWork) return undefined;
      if (op.kind !== "store" || valid[op.slot] !== 1) continue;
      const source = definitions[op.value];
      if (wordConstant(source)) {
        initialized[op.slot] = 1;
        continue;
      }
      if (
        source !== undefined &&
        source.kind === "binary" &&
        source.operator === "+"
      ) {
        const left = definitions[source.left],
          right = definitions[source.right];
        const loaded = one(left) ? right : one(right) ? left : undefined;
        if (
          loaded !== undefined &&
          loaded.kind === "load" &&
          loaded.slot === op.slot
        ) {
          const position = positions[loaded.id];
          if (position === undefined) throw "induction update invariant";
          updated[op.slot] = 1;
          if (!guarded(block, position, op.slot)) valid[op.slot] = 0;
          if (work > maxWork) return undefined;
          continue;
        }
      }
      valid[op.slot] = 0;
    }
  }
  for (let slot = 0; slot < valid.length; slot++)
    if (initialized[slot] !== 1 || updated[slot] !== 1) valid[slot] = 0;
  return valid;
}
