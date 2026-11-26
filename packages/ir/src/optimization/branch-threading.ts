import {
  instructionResult,
  provenRecordReads,
  verifierRecordWork,
  type Block,
  type FunctionIR,
  type Instruction,
} from "../scalar/index.ts";
import { compactReachableBlocks } from "./control-flow.ts";
import type { RemarkSink } from "./observer.ts";

export interface BranchThreading {
  readonly fn: FunctionIR;
  readonly visited: number;
  /** Jumps merged with a thin branch block plus edges threaded past one. */
  readonly rewritten: number;
}

/** Thin blocks hold at most this many loads and copies. */
const maxThinInstructions = 8;
/** Thin blocks one threaded edge may pass through. */
const maxThreadDepth = 4;
const maxRounds = 4;

/** A block that only loads slots, copies loaded values into slots and then
 * jumps or branches on a loaded value: the lowering of a boolean carried in
 * a slot (`a && b` results, inlined boolean returns) to the branch using it.
 * It cannot throw or write memory, so executing a copy elsewhere, or skipping
 * its loads, is unobservable. */
function thinBlock(block: Block): boolean {
  if (block.exception !== undefined) return false;
  if (block.instructions.length > maxThinInstructions) return false;
  const loaded: number[] = [];
  for (const op of block.instructions) {
    if (op === undefined) throw "branch threading instruction invariant";
    if (op.kind === "load") loaded.push(op.id);
    else if (op.kind !== "store" || !loaded.includes(op.value)) return false;
  }
  const term = block.terminator;
  if (term.kind === "branch") return loaded.includes(term.condition);
  return term.kind === "jump";
}

/** Threads branches on booleans carried in slots:
 * - a jump to a thin branch block takes a copy of that block, so the branch
 *   tests the value computed before the jump (the sweep then forwards the
 *   reload and removes the carrier's stores, letting codegen branch on the
 *   comparison's flags);
 * - an edge of a branch on value `c`, into thin blocks whose branches test
 *   slots that hold `c` at the end of the branching block, goes directly to
 *   the successor those tests select, through a new block that stores the
 *   known constants their copies would have stored.
 * Generated reference-list accessors keep the shape codegen recognizes.
 * Verified IR with dense block IDs only. Remarks name blocks by their IDs
 * before the final compaction. */
export function threadBranches(
  fn: FunctionIR,
  budget: number,
  remarks?: RemarkSink,
  stableLayouts: boolean = false,
): BranchThreading | undefined {
  if (!Number.isSafeInteger(budget) || budget < 0) return undefined;
  let visited = 0,
    rewritten = 0,
    nextId = 0;
  if (fn.name.startsWith("__tint_reference_list_"))
    return { fn, visited, rewritten };
  const blocks: Block[] = [];
  for (let index = 0; index < fn.blocks.length; index++) {
    const block = fn.blocks[index];
    if (block === undefined) throw "branch threading block invariant";
    if (block.id !== index) return { fn, visited, rewritten };
    for (const op of block.instructions) {
      if (op === undefined) throw "branch threading instruction invariant";
      if (++visited > budget) return undefined;
      const id = instructionResult(op);
      if (id !== undefined && id >= nextId) nextId = id + 1;
    }
    blocks.push(block);
  }

  /** The successor reached from `start` when the slots in `known` hold the
   * given booleans, and the constant stores standing in for the copies made
   * on the way; undefined when no branch on the way is decided. */
  function walk(
    start: number,
    known: Map<number, boolean>,
    span: { readonly start: number; readonly end: number },
  ): { instructions: Instruction[]; target: number } | undefined {
    const instructions: Instruction[] = [];
    let target = start,
      decided = false;
    for (let depth = 0; depth < maxThreadDepth; depth++) {
      const block = blocks[target];
      if (block === undefined) throw "branch threading target invariant";
      if (!thinBlock(block)) break;
      const values = new Map<number, boolean>(),
        stores: Instruction[] = [],
        stored = new Map<number, boolean>();
      let complete = true;
      for (const op of block.instructions) {
        if (op === undefined) throw "branch threading instruction invariant";
        visited++;
        if (op.kind === "load") {
          const value = stored.get(op.slot) ?? known.get(op.slot);
          if (value !== undefined) values.set(op.id, value);
        } else if (op.kind === "store") {
          const value = values.get(op.value);
          if (value === undefined) {
            complete = false;
            break;
          }
          const id = nextId++;
          stores.push({
            kind: "constant",
            id,
            value,
            start: span.start,
            end: span.end,
          });
          stores.push({
            kind: "store",
            slot: op.slot,
            value: id,
            start: span.start,
            end: span.end,
          });
          stored.set(op.slot, value);
        }
      }
      if (!complete) break;
      const term = block.terminator;
      let next: number;
      if (term.kind === "jump") next = term.target;
      else if (term.kind === "branch") {
        const value = values.get(term.condition);
        if (value === undefined) break;
        next = value ? term.consequent : term.alternate;
        decided = true;
      } else break;
      for (const op of stores) {
        if (op === undefined) throw "branch threading store invariant";
        instructions.push(op);
      }
      for (const [slot, value] of stored) known.set(slot, value);
      target = next;
    }
    return decided ? { instructions, target } : undefined;
  }

  for (let round = 0; round < maxRounds; round++) {
    let changed = false;
    for (let index = 0; index < blocks.length; index++) {
      const block = blocks[index];
      if (block === undefined) throw "branch threading block invariant";
      if (++visited > budget) return undefined;
      const term = block.terminator;
      if (term.kind === "jump") {
        const target = blocks[term.target];
        if (target === undefined) throw "branch threading target invariant";
        const branch = target.terminator;
        if (
          target.id === block.id ||
          branch.kind !== "branch" ||
          !thinBlock(target)
        )
          continue;
        const renamed = new Map<number, number>(),
          instructions: Instruction[] = block.instructions.slice();
        for (const op of target.instructions) {
          if (op === undefined) throw "branch threading instruction invariant";
          visited++;
          if (op.kind === "load") {
            const id = nextId++;
            renamed.set(op.id, id);
            instructions.push({
              kind: "load",
              id,
              slot: op.slot,
              start: op.start,
              end: op.end,
            });
          } else if (op.kind === "store") {
            const value = renamed.get(op.value);
            if (value === undefined) throw "branch threading copy invariant";
            instructions.push({
              kind: "store",
              slot: op.slot,
              value,
              start: op.start,
              end: op.end,
            });
          }
        }
        const condition = renamed.get(branch.condition);
        if (condition === undefined) throw "branch threading copy invariant";
        blocks[index] = {
          ...block,
          instructions,
          terminator: {
            kind: "branch",
            condition,
            consequent: branch.consequent,
            alternate: branch.alternate,
            start: branch.start,
            end: branch.end,
          },
        };
        rewritten++;
        changed = true;
        if (remarks !== undefined)
          remarks({
            pass: "thread-branches",
            outcome: "applied",
            function: fn.name,
            start: branch.start,
            end: branch.end,
            message:
              "b" +
              String(block.id) +
              " branches directly instead of jumping to thin branch block b" +
              String(target.id),
          });
      } else if (term.kind === "branch") {
        // Slots holding the condition at the end of the block, through
        // reloads of stored values.
        const contents = new Map<number, number>(),
          aliases = new Map<number, number>();
        for (const op of block.instructions) {
          if (op === undefined) throw "branch threading instruction invariant";
          visited++;
          if (op.kind === "store")
            contents.set(op.slot, aliases.get(op.value) ?? op.value);
          else if (op.kind === "load") {
            const held = contents.get(op.slot);
            if (held === undefined) contents.set(op.slot, op.id);
            else aliases.set(op.id, held);
          }
        }
        const condition = aliases.get(term.condition) ?? term.condition;
        let consequent = term.consequent,
          alternate = term.alternate;
        for (let side = 0; side < 2; side++) {
          const known = new Map<number, boolean>();
          for (const [slot, value] of contents)
            if (value === condition) known.set(slot, side === 0);
          if (known.size === 0) break;
          const threaded = walk(
            side === 0 ? consequent : alternate,
            known,
            term,
          );
          if (threaded === undefined) continue;
          let target = threaded.target;
          if (threaded.instructions.length > 0) {
            target = blocks.length;
            blocks.push({
              id: target,
              instructions: threaded.instructions,
              terminator: {
                kind: "jump",
                target: threaded.target,
                start: term.start,
                end: term.end,
              },
            });
          }
          if (side === 0) consequent = target;
          else alternate = target;
        }
        if (consequent === term.consequent && alternate === term.alternate)
          continue;
        blocks[index] = {
          ...block,
          terminator: { ...term, consequent, alternate },
        };
        rewritten++;
        changed = true;
        if (remarks !== undefined)
          remarks({
            pass: "thread-branches",
            outcome: "applied",
            function: fn.name,
            start: term.start,
            end: term.end,
            message:
              "b" +
              String(block.id) +
              " edges threaded past retests of its condition: true->b" +
              String(consequent) +
              " (was b" +
              String(term.consequent) +
              "), false->b" +
              String(alternate) +
              " (was b" +
              String(term.alternate) +
              ")",
          });
      }
    }
    if (!changed) break;
  }
  if (rewritten === 0) return { fn, visited, rewritten };
  const compacted = compactReachableBlocks(fn, blocks, budget - visited);
  if (compacted === undefined) return undefined;
  if (fn.scriptEntry === true) {
    let hasRecordRead = false;
    for (const block of compacted.fn.blocks) {
      if (block === undefined) continue;
      for (const op of block.instructions) {
        if (op !== undefined && op.kind === "record-read") {
          hasRecordRead = true;
          break;
        }
      }
      if (hasRecordRead) break;
    }
    if (hasRecordRead) {
      const proofs = provenRecordReads(
        compacted.fn,
        verifierRecordWork,
        stableLayouts,
      );
      if (proofs === undefined)
        return { fn, visited: visited + compacted.visited, rewritten: 0 };
      for (const block of compacted.fn.blocks) {
        if (block === undefined) continue;
        for (const op of block.instructions) {
          if (
            op !== undefined &&
            op.kind === "record-read" &&
            proofs[op.id] !== 1
          )
            return { fn, visited: visited + compacted.visited, rewritten: 0 };
        }
      }
    }
  }
  return {
    fn: compacted.fn,
    visited: visited + compacted.visited,
    rewritten,
  };
}
