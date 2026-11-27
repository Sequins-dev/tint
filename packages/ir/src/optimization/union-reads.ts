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
  // Identify object slots for single-block record writes so a subsequent read
  // of the same (object, record, field) — including through `function-environment`
  // on an unchanged closure slot — can reuse the just-written slot value.
  const writeFact = new Map<
    number,
    {
      readonly object: number;
      readonly pair: string;
      readonly viaEnv: boolean;
      readonly transfer: number;
    }
  >();
  for (const block of fn.blocks) {
    if (block === undefined) throw "union read block invariant";
    if (++visited > budget) return undefined;
    const term = block.terminator;
    if (
      (term.kind !== "record" && term.kind !== "record-cell") ||
      (term.operation !== "read" && term.operation !== "write")
    )
      continue;
    if (member[block.id] !== 0 || block.exception !== undefined) continue;
    // The object comes from a load of its slot in this block (optionally
    // unwrapped by reference-value, or via function-environment of a closure
    // slot), which stores no slot but copies of it afterwards.
    let targetObject = term.object;
    let viaEnv = false;
    for (let i = block.instructions.length - 1; i >= 0; i--) {
      const op = block.instructions[i];
      if (op === undefined) continue;
      if (op.kind === "reference-value" && op.id === targetObject) {
        targetObject = op.value;
      } else if (op.kind === "function-environment" && op.id === targetObject) {
        targetObject = op.callee;
        viaEnv = true;
        break;
      }
    }
    let object = -1;
    const copies: number[] = [];
    for (const op of block.instructions) {
      if (op === undefined) throw "union read instruction invariant";
      if (op.kind === "load" && op.id === targetObject) object = op.slot;
      else if (op.kind === "store") {
        if (op.value === term.object || op.value === targetObject)
          copies.push(op.slot);
        else if (op.slot === object) object = -2;
      }
    }
    if (object < 0 || copies.includes(object)) continue;
    if (term.operation === "write") {
      if (term.slot !== object)
        writeFact.set(block.id, {
          object,
          pair: String(term.record) + "." + String(term.field),
          viaEnv,
          transfer: term.slot,
        });
      continue;
    }
    if (term.slot === object) continue;
    let signature =
      (viaEnv ? "env:" : "") +
      String(object) +
      ":" +
      String(term.record) +
      "." +
      String(term.field);
    const blocks = [block.id];
    let next =
      term.kind === "record" && !viaEnv ? fn.blocks[term.alternate] : undefined;
    while (next !== undefined && member[next.id] === 0) {
      if (++visited > budget) return undefined;
      const t = next.terminator,
        first = next.instructions[0],
        second = next.instructions[1];
      if (first === undefined || first.kind !== "load" || t.kind !== "record")
        break;
      const unwrap =
        next.instructions.length === 2 &&
        second !== undefined &&
        second.kind === "reference-value" &&
        second.value === first.id &&
        t.object === second.id;
      if (
        (!unwrap &&
          (next.instructions.length !== 1 || t.object !== first.id)) ||
        (first.slot !== object && !copies.includes(first.slot)) ||
        t.operation !== "read" ||
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
  if (chains.length === 0 || (chains.length < 2 && writeFact.size === 0))
    return { fn, visited, rewritten: 0 };
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
    const loadedSlot = new Map<number, number>();
    for (const op of block.instructions) {
      if (op === undefined) throw "union read instruction invariant";
      visited++;
      if (op.kind === "load") loadedSlot.set(op.id, op.slot);
      else if (op.kind === "store") {
        const src = loadedSlot.get(op.value);
        current = kill(current, op.slot);
        if (src !== undefined && src !== op.slot) {
          const nextFacts: Fact[] = current.slice();
          nextFacts.push({
            signature: "alias",
            object: src,
            transfer: op.slot,
          });
          for (const f of current) {
            if (f.signature === "alias") continue;
            if (f.object === src) {
              const isEnv = f.signature.startsWith("env:");
              const pairs = f.signature.split(":")[isEnv ? 2 : 1] ?? "";
              nextFacts.push({
                signature:
                  (isEnv ? "env:" : "") + String(op.slot) + ":" + pairs,
                object: op.slot,
                transfer: f.transfer,
              });
            }
          }
          current = nextFacts;
        }
      } else if (writesMemory(op))
        current = current.filter((f) => f.signature === "alias");
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
        const chain = chains[(member[id] ?? 0) - 1];
        // If this read is already covered by an identical fact into the same
        // transfer slot (`source === term.slot`), rewriting it drops the write
        // to `term.slot`, so preserve existing facts/aliases involving `term.slot`.
        let selfReload = false;
        if (chain !== undefined) {
          const chainEnv = chain.signature.startsWith("env:");
          const pairs =
            chain.signature.split(":")[chainEnv ? 2 : 1]?.split(",") ?? [];
          for (const fact of out) {
            if (
              fact.signature === "alias" ||
              fact.object !== chain.object ||
              fact.transfer !== chain.transfer
            )
              continue;
            const factEnv = fact.signature.startsWith("env:");
            if (factEnv !== chainEnv) continue;
            const earlier =
              fact.signature.split(":")[factEnv ? 2 : 1]?.split(",") ?? [];
            let covered = true;
            for (const pair of pairs)
              if (pair === undefined || !earlier.includes(pair))
                covered = false;
            if (covered) {
              selfReload = true;
              break;
            }
          }
        }
        if (!selfReload) out = kill(out, term.slot);
        if (chain !== undefined && !selfReload) {
          const extended: Fact[] = out.slice();
          extended.push({
            signature: chain.signature,
            object: chain.object,
            transfer: chain.transfer,
          });
          consequentFacts = extended;
        }
      } else if (term.kind === "record" || term.kind === "record-cell") {
        // Record layouts are nominal and disjoint: a write to (record, field)
        // can only alias facts that read that same (record, field) pair.
        const writtenPair = String(term.record) + "." + String(term.field);
        out = out.filter((f) => {
          if (f.signature === "alias") return true;
          const pairs =
            f.signature
              .split(":")
              [f.signature.startsWith("env:") ? 2 : 1]?.split(",") ?? [];
          return !pairs.includes(writtenPair);
        });
        const wf = writeFact.get(id);
        if (wf !== undefined) {
          const extended: Fact[] = out.slice();
          const prefix = wf.viaEnv ? "env:" : "";
          extended.push({
            signature: prefix + String(wf.object) + ":" + wf.pair,
            object: wf.object,
            transfer: wf.transfer,
          });
          for (const f of out) {
            if (f.signature !== "alias") continue;
            const other =
              f.object === wf.object
                ? f.transfer
                : f.transfer === wf.object
                  ? f.object
                  : -1;
            if (other >= 0 && other !== wf.object)
              extended.push({
                signature: prefix + String(other) + ":" + wf.pair,
                object: other,
                transfer: wf.transfer,
              });
          }
          consequentFacts = extended;
        }
      } else out = out.filter((f) => f.signature === "alias");
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
    const chainEnv = chain.signature.startsWith("env:");
    const pairs =
        chain.signature.split(":")[chainEnv ? 2 : 1]?.split(",") ?? [],
      object = chain.object;
    let source = -1;
    for (const fact of through(block, facts)) {
      if (fact === undefined) throw "union read fact invariant";
      if (fact.signature === "alias" || fact.object !== object) continue;
      const factEnv = fact.signature.startsWith("env:");
      if (factEnv !== chainEnv) continue;
      const earlier =
        fact.signature.split(":")[factEnv ? 2 : 1]?.split(",") ?? [];
      let covered = true;
      for (const pair of pairs)
        if (pair === undefined || !earlier.includes(pair)) covered = false;
      if (covered) {
        source = fact.transfer;
        break;
      }
    }
    if (source < 0) continue;
    const term = block.terminator,
      inline = term.inline;
    const copied: Instruction[] = block.instructions.slice();
    if (source !== chain.transfer) {
      const id = next++;
      copied.push({
        kind: "load",
        id,
        slot: source,
        start: term.start,
        end: term.end,
        ...(inline === undefined ? {} : { inline }),
      });
      copied.push({
        kind: "store",
        slot: chain.transfer,
        value: id,
        start: term.start,
        end: term.end,
        ...(inline === undefined ? {} : { inline }),
      });
    }
    candidates[chain.head] = {
      ...block,
      instructions: copied,
      terminator: {
        kind: "jump",
        target: chain.consequent,
        start: term.start,
        end: term.end,
        ...(inline === undefined ? {} : { inline }),
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
