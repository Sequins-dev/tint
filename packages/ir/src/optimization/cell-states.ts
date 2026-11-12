import type {
  Block,
  FunctionIR,
  RecordLayout,
  Terminator,
} from "../scalar/index.ts";

export interface CellStateProof {
  readonly fn: FunctionIR;
  readonly visited: number;
  /** Cell accesses marked initialized. */
  readonly rewritten: number;
}

interface Fact {
  readonly object: number;
  readonly record: number;
  readonly field: number;
}

/** The slot a record-cell access's object was loaded from in its own block,
 * not stored afterwards; -1 otherwise. */
function objectSlot(block: Block, object: number): number {
  let slot = -1;
  for (const op of block.instructions) {
    if (op === undefined) throw "cell state instruction invariant";
    if (op.kind === "load" && op.id === object) slot = op.slot;
    else if (op.kind === "store" && op.slot === slot) slot = -2;
  }
  return slot;
}

/** A managed cell's state only moves from uninitialized to initialized, so
 * after one access to a (layout, field) cell of the object held in a slot has
 * succeeded, later reads (and writes to mutable fields) of that cell through
 * the same, unchanged slot need no state test: they are marked `initialized`
 * and keep their layout guard and failure edge. Facts flow along
 * success edges only and end when the object slot is stored. Initializations
 * and writes to immutable fields keep their checked form. Verified IR only. */
export function proveCellStates(
  fn: FunctionIR,
  records: readonly RecordLayout[] | undefined,
  budget: number,
): CellStateProof | undefined {
  if (!Number.isSafeInteger(budget) || budget < 0) return undefined;
  if (records === undefined) return { fn, visited: 0, rewritten: 0 };
  const layouts: readonly RecordLayout[] = records;
  const count = fn.blocks.length;
  let visited = 0,
    any = false;
  for (const block of fn.blocks) {
    if (block === undefined || block.id >= count) return undefined;
    if (++visited > budget) return undefined;
    if (block.terminator.kind === "record-cell") any = true;
  }
  if (!any) return { fn, visited, rewritten: 0 };
  const entry: (Fact[] | undefined)[] = [];
  for (let id = 0; id < count; id++) entry.push(undefined);
  entry[fn.entry] = [];
  function through(block: Block, facts: Fact[]): Fact[] {
    let current = facts;
    for (const op of block.instructions) {
      if (op === undefined) throw "cell state instruction invariant";
      visited++;
      if (current.length === 0) break;
      if (op.kind === "store") {
        const slot = op.slot;
        current = current.filter((f) => f.object !== slot);
      }
    }
    return current;
  }
  function meet(target: number, facts: Fact[]): boolean {
    const previous = entry[target];
    if (previous === undefined) {
      entry[target] = facts;
      return true;
    }
    const kept: Fact[] = [];
    for (const p of previous) {
      if (p === undefined) throw "cell state fact invariant";
      for (const f of facts) {
        if (f === undefined) throw "cell state fact invariant";
        if (
          f.object === p.object &&
          f.record === p.record &&
          f.field === p.field
        ) {
          kept.push(p);
          break;
        }
      }
    }
    if (kept.length === previous.length) return false;
    entry[target] = kept;
    return true;
  }
  /** Facts on a block's success edge, from its entry facts. */
  function success(block: Block, out: Fact[], term: Terminator): Fact[] {
    if (term.kind !== "record-cell" && term.kind !== "record") return out;
    // The transfer slot is written on success; reads write it.
    let result = out;
    if (term.operation === "read") {
      const slot = term.slot;
      result = result.filter((f) => f.object !== slot);
    }
    if (term.kind !== "record-cell") return result;
    const slot = objectSlot(block, term.object);
    if (slot < 0 || slot === term.slot) return result;
    for (const f of result)
      if (
        f !== undefined &&
        f.object === slot &&
        f.record === term.record &&
        f.field === term.field
      )
        return result;
    const extended: Fact[] = result.slice();
    extended.push({ object: slot, record: term.record, field: term.field });
    return extended;
  }
  const pending: number[] = [fn.entry],
    queued = new Uint8Array(count);
  queued[fn.entry] = 1;
  function flow(target: number, facts: Fact[]): void {
    if (meet(target, facts) && queued[target] !== 1) {
      queued[target] = 1;
      pending.push(target);
    }
  }
  while (pending.length > 0) {
    if (++visited > budget) return undefined;
    const id = pending.pop();
    if (id === undefined) throw "cell state worklist invariant";
    queued[id] = 0;
    const block = fn.blocks[id],
      facts = entry[id];
    if (block === undefined || facts === undefined)
      throw "cell state flow invariant";
    const out = through(block, facts);
    const term = block.terminator;
    const handler = block.exception;
    if (handler !== undefined) flow(handler.target, []);
    if (term.kind === "jump") flow(term.target, out);
    else if (term.kind === "branch") {
      flow(term.consequent, out);
      flow(term.alternate, out);
    } else if (
      term.kind === "record" ||
      term.kind === "record-cell" ||
      term.kind === "cell"
    ) {
      const transfer = term.slot;
      const failed = out.filter((f) => f.object !== transfer);
      flow(term.consequent, success(block, out, term));
      // A failed read leaves its transfer slot unchanged, but keep the
      // facts conservative on both edges.
      flow(term.alternate, failed);
    }
  }
  const blocks: Block[] = fn.blocks.slice();
  let rewritten = 0;
  for (const block of fn.blocks) {
    if (block === undefined) throw "cell state block invariant";
    const term = block.terminator,
      facts = entry[block.id];
    if (term.kind !== "record-cell" || facts === undefined) continue;
    if (term.operation === "initialize" || term.initialized === true) continue;
    const layout = layouts[term.record];
    if (layout === undefined) continue;
    const field = layout.fields[term.field];
    if (field === undefined) continue;
    if (term.operation === "write" && !field.mutable) continue;
    const slot = objectSlot(block, term.object);
    if (slot < 0) continue;
    let proven = false;
    for (const f of through(block, facts))
      if (
        f !== undefined &&
        f.object === slot &&
        f.record === term.record &&
        f.field === term.field
      )
        proven = true;
    if (!proven) continue;
    blocks[block.id] = {
      ...block,
      terminator: { ...term, initialized: true },
    };
    rewritten++;
  }
  return {
    fn: rewritten === 0 ? fn : { ...fn, blocks },
    visited,
    rewritten,
  };
}
