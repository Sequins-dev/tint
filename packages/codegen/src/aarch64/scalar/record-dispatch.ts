import type { Block, FunctionIR, RecordLayout } from "@tint/ir/scalar";
export interface RecordDispatchChain {
  /** Candidate layouts in source order; the first is the head's own guard. */
  readonly records: readonly number[];
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
 * object slot and tests the next layout for the same read. When every
 * continuation reads an identically placed and typed field into the same
 * transfer slot, continues to the same block and is reachable only from the
 * previous candidate, the chain is one layout membership test followed by one
 * shared read. Continuations hold no safepoint, so skipping them preserves
 * every collecting block's root state. `guarded(block)` reports whether the
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
    const source = reloadedSlot(block, term.object);
    if (field === undefined || source === undefined) continue;
    const candidates: number[] = [term.record];
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
        next.instructions.length !== 1
      )
        break;
      const load = next.instructions[0],
        guard = next.terminator;
      if (
        load === undefined ||
        load.kind !== "load" ||
        load.slot !== source ||
        guard.kind !== "record" ||
        guard.operation !== "read" ||
        guard.object !== load.id ||
        guard.slot !== term.slot ||
        guard.consequent !== term.consequent
      )
        break;
      const candidate = records?.[guard.record]?.fields[guard.field];
      if (
        candidate === undefined ||
        candidate.offset !== field.offset ||
        candidate.type !== field.type
      )
        break;
      candidates.push(guard.record);
      fused[next.id] = 1;
      failure = guard.alternate;
    }
    if (candidates.length > 1)
      chains.set(block.id, { records: candidates, failure });
  }
  return { chains, fused };
}
/** The slot whose current contents equal `object` at the terminator: it is
 * loaded in this block and not stored to afterwards. */
function reloadedSlot(block: Block, object: number): number | undefined {
  let source: number | undefined;
  for (const op of block.instructions) {
    if (op === undefined) throw "dispatch instruction invariant";
    if (op.kind === "load" && op.id === object) source = op.slot;
    else if (op.kind === "store" && op.slot === source) return undefined;
  }
  return source;
}
