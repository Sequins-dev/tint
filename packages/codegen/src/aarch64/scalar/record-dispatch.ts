import type { Block, FunctionIR, RecordLayout } from "@tint/ir/scalar";
/** Candidates whose field reads identically after a membership test. */
export interface RecordDispatchGroup {
  /** Candidate layouts in source order. */
  readonly records: readonly number[];
  /** A representative layout and field index for the shared read (every
   * candidate's field has its offset). */
  readonly record: number;
  readonly field: number;
}
export interface RecordDispatchChain {
  /** Candidate layouts in source order; the first is the head's own guard. */
  readonly records: readonly number[];
  /** The candidates by placement, in order of first appearance: each group
   * is one membership test and one read. */
  readonly groups: readonly RecordDispatchGroup[];
  /** Taken when no candidate matches, including a null object. */
  readonly failure: number;
}
export interface RecordDispatchPlan {
  /** Head block id to its fused chain. */
  readonly chains: ReadonlyMap<number, RecordDispatchChain>;
  /** 1 for continuation blocks folded into a head; never emitted. */
  readonly fused: Uint8Array;
}
/** Verified IR only. Union field reads lower to a chain of `record` guards:
 * a failed layout test falls through to a block that only reloads the same
 * object slot (unwrapping it when the slot holds an optional reference) and
 * tests the next layout for the same read. When every
 * continuation reads an equally typed field into the same transfer slot,
 * continues to the same block and is reachable only from the previous
 * candidate, the chain fuses: candidates whose field has one offset share
 * one membership test and one read, so a union whose members place the
 * field differently costs one test per offset, not per layout.
 * Continuations hold no safepoint, so skipping them preserves every
 * collecting block's root state; a continuation's unwrap cannot fail, since
 * the slot still holds the head's object, which the head already unwrapped
 * or loaded as a reference. `guarded(block)` reports whether the
 * head emits a descriptor guard at all; proven layouts keep their fast path. */
export function recordDispatchChains(
  fn: FunctionIR,
  records: readonly RecordLayout[] | undefined,
  guarded: (block: number) => boolean,
): RecordDispatchPlan | undefined {
  if (records === undefined) return undefined;
  const count = fn.blocks.length;
  const predecessors = new Uint32Array(count);
  function edge(target: number): void {
    if (target >= 0 && target < count)
      predecessors[target] = (predecessors[target] ?? 0) + 1;
  }
  for (let index = 0; index < count; index++) {
    const block = fn.blocks[index];
    if (block === undefined || block.id !== index) return undefined;
    const term = block.terminator;
    let first = -1,
      second = -1,
      third = -1;
    if (term.kind === "jump") first = term.target;
    else if (
      term.kind === "branch" ||
      term.kind === "cell" ||
      term.kind === "record" ||
      term.kind === "record-cell"
    ) {
      first = term.consequent;
      second = term.alternate;
    }
    if (block.exception !== undefined) third = block.exception.target;
    // Count each distinct successor of this block once.
    edge(first);
    if (second !== first) edge(second);
    if (third !== first && third !== second) edge(third);
  }
  const fused = new Uint8Array(count);
  const chains = new Map<number, RecordDispatchChain>();
  for (const block of fn.blocks) {
    if (block === undefined || fused[block.id] === 1) continue;
    const term = block.terminator;
    if (
      term.kind !== "record" ||
      term.operation !== "read" ||
      !guarded(block.id)
    )
      continue;
    const field = records?.[term.record]?.fields[term.field];
    const sources = reloadedSlots(block, term.object);
    if (field === undefined || sources.length === 0) continue;
    const candidates: number[] = [term.record],
      groups: { records: number[]; record: number; field: number }[] = [
        { records: [term.record], record: term.record, field: term.field },
      ],
      offsets: number[] = [field.offset];
    /** Adds a candidate whose field is placed like `field` of
     * `representative`. */
    function add(record: number, representative: number, field: number): void {
      const offset = records?.[representative]?.fields[field]?.offset;
      if (offset === undefined) throw "dispatch layout invariant";
      const at = offsets.indexOf(offset);
      candidates.push(record);
      const group = at < 0 ? undefined : groups[at];
      if (group !== undefined) group.records.push(record);
      else {
        offsets.push(offset);
        groups.push({ records: [record], record: representative, field });
      }
    }
    let failure = term.alternate;
    while (true) {
      const next = fn.blocks[failure];
      if (
        next === undefined ||
        next.id === fn.entry ||
        next.id === block.id ||
        fused[next.id] === 1 ||
        predecessors[next.id] !== 1 ||
        next.exception?.target !== block.exception?.target ||
        next.exception?.slot !== block.exception?.slot ||
        next.instructions.length > 2
      )
        break;
      const load = next.instructions[0],
        unwrap = next.instructions[1],
        guard = next.terminator;
      if (
        load === undefined ||
        load.kind !== "load" ||
        !sources.includes(load.slot) ||
        guard.kind !== "record" ||
        guard.operation !== "read" ||
        guard.object !==
          (unwrap === undefined
            ? load.id
            : unwrap.kind === "reference-value" && unwrap.value === load.id
              ? unwrap.id
              : -1) ||
        guard.slot !== term.slot ||
        guard.consequent !== term.consequent
      )
        break;
      const candidate = records?.[guard.record]?.fields[guard.field];
      if (candidate === undefined || candidate.type !== field.type) break;
      add(guard.record, guard.record, guard.field);
      fused[next.id] = 1;
      failure = guard.alternate;
      // An earlier-visited head (copy slots let a later head reach it)
      // already fused its continuations: absorb its whole chain, whose
      // candidates share its field type, transfer slot and consequent.
      const absorbed = chains.get(next.id);
      if (absorbed !== undefined) {
        chains.delete(next.id);
        // Its head (this guard) is already a candidate.
        let head = true;
        for (const group of absorbed.groups) {
          if (group === undefined) throw "dispatch chain invariant";
          for (const record of group.records) {
            if (record === undefined) throw "dispatch chain invariant";
            if (head && record === guard.record) head = false;
            else add(record, group.record, group.field);
          }
        }
        failure = absorbed.failure;
        break;
      }
    }
    if (candidates.length > 1)
      chains.set(block.id, { records: candidates, groups, failure });
  }
  return { chains, fused };
}
/** Slots whose current contents are `object` at the terminator, or the
 * optional reference it unwraps: the slot it was loaded from and slots it
 * was stored into, minus any overwritten afterwards (lowering copies a union
 * receiver before reading its field). */
function reloadedSlots(block: Block, object: number): readonly number[] {
  let unwrapped = -1;
  for (const op of block.instructions) {
    if (op === undefined) throw "dispatch instruction invariant";
    if (op.kind === "reference-value" && op.id === object) unwrapped = op.value;
  }
  const slots: number[] = [];
  for (const op of block.instructions) {
    if (op === undefined) throw "dispatch instruction invariant";
    if (op.kind === "load" && (op.id === object || op.id === unwrapped)) {
      if (!slots.includes(op.slot)) slots.push(op.slot);
    } else if (op.kind === "store") {
      // Any store into a tracked slot drops it (conservatively, even of the
      // same value); a copy of the object into another slot adds that slot.
      const at = slots.indexOf(op.slot);
      if (at >= 0) slots.splice(at, 1);
      else if (op.value === object || op.value === unwrapped)
        slots.push(op.slot);
    }
  }
  return slots;
}
