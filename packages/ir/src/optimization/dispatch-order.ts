import type { Block, FunctionIR, ModuleIR } from "../scalar/index.ts";

export interface DispatchOrdering {
  readonly module: ModuleIR;
  readonly visited: number;
  /** Chains whose candidate order changed. */
  readonly rewritten: number;
}

/** Union field reads lower to a chain of checked `record` reads: each failed
 * layout test continues to a block that reloads the same object and tests
 * the next candidate layout, every candidate reading into the same transfer
 * slot and continuing to the same block. The layouts are distinct, so at most
 * one candidate matches any object and the test order is unobservable.
 * Candidates are reordered by the number of allocation sites (`record-new`)
 * of their layout in the module, most first (stable for ties), so the common
 * layout is tested first. Verified IR only; the failure edge is unchanged. */
export function orderRecordDispatch(
  module: ModuleIR,
  maxWork: number,
): DispatchOrdering | undefined {
  if (!Number.isSafeInteger(maxWork) || maxWork < 0) return undefined;
  const records = module.records ?? [];
  // One unit per function, so exhaustion is visible even without records.
  let visited = module.functions.length;
  if (visited > maxWork) return undefined;
  if (records.length === 0) return { module, visited, rewritten: 0 };
  const allocations = new Uint32Array(records.length);
  for (const fn of module.functions) {
    if (fn === undefined) throw "dispatch order function invariant";
    for (const block of fn.blocks) {
      if (block === undefined) throw "dispatch order block invariant";
      for (const op of block.instructions) {
        if (op === undefined) throw "dispatch order instruction invariant";
        if (++visited > maxWork) return undefined;
        if (op.kind === "record-new" && op.record < records.length)
          allocations[op.record] = (allocations[op.record] ?? 0) + 1;
      }
    }
  }
  let rewritten = 0;
  const functions: FunctionIR[] = [];
  for (const fn of module.functions) {
    if (fn === undefined) throw "dispatch order function invariant";
    const result = orderFunction(fn, allocations, maxWork - visited);
    if (result === undefined) return undefined;
    visited += result.visited;
    rewritten += result.rewritten;
    functions.push(result.fn);
  }
  return {
    module: rewritten === 0 ? module : { ...module, functions },
    visited,
    rewritten,
  };
}

function orderFunction(
  fn: FunctionIR,
  allocations: Uint32Array,
  maxWork: number,
): { fn: FunctionIR; visited: number; rewritten: number } | undefined {
  const count = fn.blocks.length;
  let visited = 0;
  const predecessors = new Uint32Array(count);
  const edge = (target: number): void => {
    if (target >= 0 && target < count)
      predecessors[target] = (predecessors[target] ?? 0) + 1;
  };
  for (let index = 0; index < count; index++) {
    const block = fn.blocks[index];
    if (block === undefined || block.id !== index) return undefined;
    if (++visited > maxWork) return undefined;
    const term = block.terminator;
    if (term.kind === "jump") edge(term.target);
    else if (
      term.kind === "branch" ||
      term.kind === "cell" ||
      term.kind === "record" ||
      term.kind === "record-cell"
    ) {
      edge(term.consequent);
      if (term.alternate !== term.consequent) edge(term.alternate);
    }
    const handler = block.exception?.target;
    if (handler !== undefined) edge(handler);
  }
  const member = new Uint8Array(count);
  let blocks: Block[] | undefined;
  let rewritten = 0;
  for (const head of fn.blocks) {
    if (head === undefined) throw "dispatch order block invariant";
    if (member[head.id] === 1) continue;
    const term = head.terminator;
    if (term.kind !== "record" || term.operation !== "read") continue;
    const sources = reloadedSlots(head, term.object);
    if (sources.length === 0) continue;
    const chain: number[] = [head.id];
    let failure = term.alternate;
    while (true) {
      if (++visited > maxWork) return undefined;
      const next = fn.blocks[failure];
      if (
        next === undefined ||
        next.id === fn.entry ||
        member[next.id] === 1 ||
        chain.includes(next.id) ||
        predecessors[next.id] !== 1 ||
        next.exception?.target !== head.exception?.target ||
        next.exception?.slot !== head.exception?.slot ||
        next.instructions.length !== 1
      )
        break;
      const load = next.instructions[0],
        guard = next.terminator;
      if (
        load === undefined ||
        load.kind !== "load" ||
        !sources.includes(load.slot) ||
        guard.kind !== "record" ||
        guard.operation !== "read" ||
        guard.object !== load.id ||
        guard.slot !== term.slot ||
        guard.consequent !== term.consequent
      )
        break;
      chain.push(next.id);
      failure = guard.alternate;
    }
    if (chain.length < 2) continue;
    for (const id of chain) {
      if (id === undefined) throw "dispatch order chain invariant";
      member[id] = 1;
    }
    // Stable insertion sort of chain positions by allocation count.
    const records: number[] = [],
      fields: number[] = [],
      order: number[] = [];
    for (const id of chain) {
      if (id === undefined) throw "dispatch order chain invariant";
      const t = fn.blocks[id]?.terminator;
      if (t === undefined || t.kind !== "record")
        throw "dispatch order chain invariant";
      records.push(t.record);
      fields.push(t.field);
    }
    for (let position = 0; position < chain.length; position++) {
      const weight = allocations[records[position] ?? 0] ?? 0;
      let at = order.length;
      while (at > 0) {
        const previous = order[at - 1] ?? 0;
        if ((allocations[records[previous] ?? 0] ?? 0) >= weight) break;
        at--;
      }
      order.splice(at, 0, position);
    }
    let unchanged = true;
    for (let index = 0; index < order.length; index++)
      if (order[index] !== index) unchanged = false;
    if (unchanged) continue;
    rewritten++;
    const target = blocks ?? fn.blocks.slice();
    blocks = target;
    for (let index = 0; index < chain.length; index++) {
      const id = chain[index],
        position = order[index];
      if (id === undefined || position === undefined)
        throw "dispatch order chain invariant";
      const record = records[position],
        field = fields[position];
      if (record === undefined || field === undefined)
        throw "dispatch order chain invariant";
      const block = target[id];
      if (block === undefined) throw "dispatch order chain invariant";
      const guard = block.terminator;
      if (guard.kind !== "record") throw "dispatch order chain invariant";
      target[id] = { ...block, terminator: { ...guard, record, field } };
    }
  }
  return {
    fn: blocks === undefined ? fn : { ...fn, blocks },
    visited,
    rewritten,
  };
}

/** Slots whose contents equal `object` at the end of `block`: the slot it
 * was loaded from and slots it was copied into, minus overwritten ones. */
function reloadedSlots(block: Block, object: number): readonly number[] {
  const slots: number[] = [];
  for (const op of block.instructions) {
    if (op === undefined) throw "dispatch order instruction invariant";
    if (op.kind === "load" && op.id === object) {
      if (!slots.includes(op.slot)) slots.push(op.slot);
    } else if (op.kind === "store") {
      const at = slots.indexOf(op.slot);
      if (at >= 0) slots.splice(at, 1);
      else if (op.value === object) slots.push(op.slot);
    }
  }
  return slots;
}
