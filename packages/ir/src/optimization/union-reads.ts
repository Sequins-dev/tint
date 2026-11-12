import {
  instructionEffects,
  effectInvoke,
  effectWriteHeap,
  instructionResult,
  type Block,
  type FunctionIR,
  type Instruction,
} from "../scalar/index.ts";
import { compactReachableBlocks } from "./control-flow.ts";

export interface UnionReadReuse {
  readonly fn: FunctionIR;
  readonly visited: number;
  /** Repeated chains replaced by a copy of the earlier result. */
  readonly rewritten: number;
}

/** A union field read: a head block loads an object from `object`, tests one
 * layout and reads its field into `transfer`; each failing test falls through
 * to a continuation that reloads the same object (from a copy slot) and tests
 * the next layout for the same transfer slot and consequent. */
interface ReadChain {
  readonly head: number;
  readonly object: number;
  readonly transfer: number;
  readonly consequent: number;
  /** Object slot and every (layout, field) pair, in order. */
  readonly signature: string;
  readonly blocks: readonly number[];
}

interface Fact {
  readonly signature: string;
  readonly object: number;
  readonly transfer: number;
}

function writesMemory(op: Instruction): boolean {
  const effects = instructionEffects(op);
  return (effects & (effectWriteHeap | effectInvoke)) !== 0;
}

/** Reuses repeated union field reads: when every path to a chain head passes
 * the consequent edge of an earlier chain on the same object slot whose
 * (layout, field) pairs include all of the head's (the union may have
 * narrowed since), with
 * neither its object slot nor its transfer slot stored since and no
 * operation that writes memory or calls in between, the head copies the
 * earlier transfer slot into its own and jumps to its consequent. A null
 * object or an unmatched layout never reaches the earlier consequent, so the
 * later chain reads the same value whenever its own layouts match; for an
 * object of an excluded layout (only reachable through an unsound assertion)
 * the copy is the property value ECMAScript would read. Verified IR only. */
export function reuseUnionReads(
  fn: FunctionIR,
  budget: number,
): UnionReadReuse | undefined {
  if (!Number.isSafeInteger(budget) || budget < 0) return undefined;
  const count = fn.blocks.length;
  let visited = 0;
  const predecessors = new Uint32Array(count);
  let maximum = -1;
  for (const block of fn.blocks) {
    if (block === undefined || block.id >= count) return undefined;
    if ((visited += 1 + block.instructions.length) > budget) return undefined;
    for (const op of block.instructions) {
      if (op === undefined) throw "union read instruction invariant";
      const id = instructionResult(op);
      if (id !== undefined && id > maximum) maximum = id;
    }
    for (const target of successors(block)) {
      if (target === undefined) throw "union read successor invariant";
      predecessors[target] = (predecessors[target] ?? 0) + 1;
    }
    const handler = block.exception;
    if (handler !== undefined)
      predecessors[handler.target] = (predecessors[handler.target] ?? 0) + 1;
  }
  // Chains by head; chain membership per block (chain index + 1; 0 none).
  const chains: ReadChain[] = [],
    member = new Uint32Array(count);
  for (const block of fn.blocks) {
    if (block === undefined) throw "union read block invariant";
    if (++visited > budget) return undefined;
    const term = block.terminator;
    if (term.kind !== "record" || term.operation !== "read") continue;
    if (member[block.id] !== 0 || block.exception !== undefined) continue;
    // The object comes from a load of its slot in this block, which stores
    // no slot but copies of it afterwards.
    let object = -1;
    const copies: number[] = [];
    for (const op of block.instructions) {
      if (op === undefined) throw "union read instruction invariant";
      if (op.kind === "load" && op.id === term.object) object = op.slot;
      else if (op.kind === "store") {
        if (op.value === term.object) copies.push(op.slot);
        else if (op.slot === object) object = -2;
      }
    }
    if (object < 0 || copies.includes(object) || term.slot === object) continue;
    let signature =
      String(object) + ":" + String(term.record) + "." + String(term.field);
    const blocks = [block.id];
    let next = fn.blocks[term.alternate];
    while (next !== undefined && member[next.id] === 0) {
      if (++visited > budget) return undefined;
      const t = next.terminator,
        first = next.instructions[0];
      if (
        next.instructions.length !== 1 ||
        first === undefined ||
        first.kind !== "load" ||
        (first.slot !== object && !copies.includes(first.slot)) ||
        t.kind !== "record" ||
        t.operation !== "read" ||
        t.object !== first.id ||
        t.slot !== term.slot ||
        t.consequent !== term.consequent ||
        next.exception !== undefined ||
        predecessors[next.id] !== 1 ||
        blocks.includes(next.id)
      )
        break;
      signature += "," + String(t.record) + "." + String(t.field);
      blocks.push(next.id);
      next = fn.blocks[t.alternate];
    }
    const index = chains.length;
    for (const id of blocks) {
      if (id === undefined) throw "union read chain invariant";
      member[id] = index + 1;
    }
    chains.push({
      head: block.id,
      object,
      transfer: term.slot,
      consequent: term.consequent,
      signature,
      blocks,
    });
  }
  if (chains.length < 2) return { fn, visited, rewritten: 0 };
  // Forward must-availability: undefined is "not yet reached" (top).
  const entry: (Fact[] | undefined)[] = [];
  for (let id = 0; id < count; id++) entry.push(undefined);
  entry[fn.entry] = [];
  function kill(facts: Fact[], slot: number): Fact[] {
    return facts.filter((f) => f.object !== slot && f.transfer !== slot);
  }
  /** Facts after a block's instructions (before its terminator). */
  function through(block: Block, facts: Fact[]): Fact[] {
    let current = facts;
    for (const op of block.instructions) {
      if (op === undefined) throw "union read instruction invariant";
      visited++;
      if (current.length === 0) break;
      if (op.kind === "store") current = kill(current, op.slot);
      else if (writesMemory(op)) current = [];
    }
    return current;
  }
  function meet(target: number, facts: Fact[]): boolean {
    const previous = entry[target];
    if (previous === undefined) {
      entry[target] = facts;
      return true;
    }
    const kept = previous.filter((p) =>
      facts.some(
        (f) =>
          f.signature === p.signature &&
          f.object === p.object &&
          f.transfer === p.transfer,
      ),
    );
    if (kept.length === previous.length) return false;
    entry[target] = kept;
    return true;
  }
  const pending: number[] = [fn.entry],
    queued = new Uint8Array(count);
  queued[fn.entry] = 1;
  while (pending.length > 0) {
    if (++visited > budget) return undefined;
    const id = pending.pop();
    if (id === undefined) throw "union read worklist invariant";
    queued[id] = 0;
    const block = fn.blocks[id],
      facts = entry[id];
    if (block === undefined || facts === undefined)
      throw "union read flow invariant";
    let out = through(block, facts);
    const term = block.terminator;
    let consequentFacts: Fact[] | undefined;
    if (
      term.kind === "record" ||
      term.kind === "record-cell" ||
      term.kind === "cell"
    ) {
      if (term.operation === "read") {
        out = kill(out, term.slot);
        const chain = chains[(member[id] ?? 0) - 1];
        if (chain !== undefined) {
          const extended: Fact[] = out.slice();
          extended.push({
            signature: chain.signature,
            object: chain.object,
            transfer: chain.transfer,
          });
          consequentFacts = extended;
        }
      } else out = [];
    }
    const handler = block.exception;
    const flow = (target: number, facts: Fact[]): void => {
      if (meet(target, facts) && queued[target] !== 1) {
        queued[target] = 1;
        pending.push(target);
      }
    };
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
      flow(term.consequent, consequentFacts ?? out);
      flow(term.alternate, out);
    }
  }
  // Rewrite heads whose signature is available after their own instructions.
  const candidates: Block[] = fn.blocks.slice();
  let rewritten = 0,
    next = maximum + 1;
  for (const chain of chains) {
    if (chain === undefined) throw "union read chain invariant";
    const block = fn.blocks[chain.head],
      facts = entry[chain.head];
    if (block === undefined || facts === undefined) continue;
    // An earlier read over a superset of these layouts read the same field
    // (the object matched one of them; these read the same field slot).
    const pairs = chain.signature.split(":")[1]?.split(",") ?? [],
      object = chain.object;
    let source = -1;
    for (const fact of through(block, facts)) {
      if (fact === undefined) throw "union read fact invariant";
      if (fact.object !== object) continue;
      const earlier = fact.signature.split(":")[1]?.split(",") ?? [];
      let covered = true;
      for (const pair of pairs)
        if (pair === undefined || !earlier.includes(pair)) covered = false;
      if (covered) {
        source = fact.transfer;
        break;
      }
    }
    if (source < 0 || source === chain.transfer) continue;
    const term = block.terminator;
    const id = next++;
    const copied: Instruction[] = block.instructions.slice();
    copied.push({
      kind: "load",
      id,
      slot: source,
      start: term.start,
      end: term.end,
    });
    copied.push({
      kind: "store",
      slot: chain.transfer,
      value: id,
      start: term.start,
      end: term.end,
    });
    candidates[chain.head] = {
      ...block,
      instructions: copied,
      terminator: {
        kind: "jump",
        target: chain.consequent,
        start: term.start,
        end: term.end,
      },
    };
    rewritten++;
  }
  if (rewritten === 0) return { fn, visited, rewritten };
  const compacted = compactReachableBlocks(fn, candidates, budget - visited);
  if (compacted === undefined) return undefined;
  return {
    fn: compacted.fn,
    visited: visited + compacted.visited,
    rewritten,
  };
}

function successors(block: Block): number[] {
  const term = block.terminator;
  if (term.kind === "jump") return [term.target];
  if (
    term.kind === "branch" ||
    term.kind === "record" ||
    term.kind === "record-cell" ||
    term.kind === "cell"
  )
    return term.consequent === term.alternate
      ? [term.consequent]
      : [term.consequent, term.alternate];
  return [];
}
