import { instructionResult } from "./operands.ts";
import type { FunctionIR, Block, Instruction, ModuleIR } from "./model.ts";
/** Whole-module effect proof for verified IR. Managed writes never replace an
 * object's descriptor. Internal calls and managed imports obey the same
 * descriptor-stability contract; allocation/collection preserve layouts.
 * Raw-memory host capabilities break
 * that contract. New host operations are unsafe until explicitly classified.
 * This is not a proof for externally supplied code or arbitrary FFI callbacks. */
export function stableRecordLayouts(module: ModuleIR): boolean {
  for (const fn of module.functions) {
    if (fn === undefined) throw "layout effect function invariant";
    for (const block of fn.blocks) {
      if (block === undefined) throw "layout effect block invariant";
      for (const op of block.instructions) {
        if (op === undefined) throw "layout effect instruction invariant";
        if (op.kind !== "host-call") continue;
        switch (op.operation) {
          case "cpu-pause":
          case "monotonic-time":
          case "wall-clock-time":
          case "random-word":
          case "open-read":
          case "open-exclusive":
          case "read":
          case "write":
          case "close":
          case "chmod":
          case "rename":
          case "unlink":
          case "read-link":
          case "argument-count":
          case "argument-length":
          case "argument-copy":
          case "context-domain":
          case "root-head":
          case "memory-map":
          case "memory-read-word":
            break;
          default:
            return false;
        }
      }
    }
  }
  return true;
}
/** Descriptor proofs for verified fixed-layout IR. Constructors establish exact
 * layouts; successful guards establish facts along unique normal predecessor
 * chains. Local alias assignments preserve identity. Joins, exception entries,
 * opaque calls and host effects stop propagation. Exhaustion keeps every check.
 * No source annotation or speculative shape assumption is used. */
export function analyzeRecordAccesses(
  fn: FunctionIR,
  maxWork: number = 100000,
  stableLayouts: boolean = false,
  includeGuards: boolean = true,
):
  | {
      readonly guards: Uint8Array;
      readonly reads: Uint8Array;
      readonly work: number;
    }
  | undefined {
  if (!Number.isSafeInteger(maxWork) || maxWork < 0) return undefined;
  let maximum = 0;
  for (const block of fn.blocks) {
    if (block === undefined) return undefined;
    for (const op of block.instructions)
      if (op !== undefined && op.kind === "record-read")
        maximum = Math.max(maximum, op.id + 1);
  }
  if (maximum > maxWork) return undefined;
  const reads = new Uint8Array(maximum);
  const predecessors = new Uint32Array(fn.blocks.length),
    proven = new Uint8Array(fn.blocks.length);
  let work = 0,
    exhausted = false;
  function step(): boolean {
    if (work >= maxWork) {
      exhausted = true;
      return false;
    }
    work++;
    return true;
  }
  function edge(from: number, to: number): void {
    predecessors[to] = predecessors[to] === 0 ? from + 1 : 0xffffffff;
  }
  for (const block of fn.blocks) {
    if (block === undefined) throw "record fact block invariant";
    if (!step()) return undefined;
    const term = block.terminator;
    if (term.kind === "jump") edge(block.id, term.target);
    else if (
      term.kind === "branch" ||
      term.kind === "record" ||
      term.kind === "record-cell" ||
      term.kind === "cell"
    ) {
      edge(block.id, term.consequent);
      edge(block.id, term.alternate);
    }
    if (block.exception !== undefined)
      predecessors[block.exception.target] = 0xffffffff;
  }
  predecessors[fn.entry] = 0xffffffff;
  function barrier(op: Instruction): boolean {
    return (
      !stableLayouts &&
      (op.kind === "call" ||
        op.kind === "call-indirect" ||
        op.kind === "host-call")
    );
  }
  // Positive origins identify slots at block entry. Negative origins describe
  // constructor layouts (not allocation identity). Zero means unknown.
  function slotOrigin(
    block: Block,
    slot: number,
    before: number,
    depth: number,
  ): number {
    if (depth > 128) return 0;
    for (let i = before - 1; i >= 0; i--) {
      if (!step()) return 0;
      const op = block.instructions[i];
      if (op === undefined) throw "record fact instruction invariant";
      if (barrier(op)) return 0;
      if (op.kind === "store" && op.slot === slot)
        return valueOrigin(block, op.value, i, depth + 1);
      // A previously verified read is a proof checkpoint, not a new assumption.
      // Compare identities at the read: the slot may have been reassigned since
      // the receiver was loaded. Equal layouts alone do not establish identity.
      if (op.kind === "record-read" && reads[op.id] === 1) {
        const checked = valueOrigin(block, op.object, i, depth + 1);
        if (checked > 0 && checked === slotOrigin(block, slot, i, depth + 1))
          return -op.record - 1;
      }
    }
    return slot + 1;
  }
  function valueOrigin(
    block: Block,
    value: number,
    before: number,
    depth: number,
  ): number {
    if (depth > 128) return 0;
    for (let i = before - 1; i >= 0; i--) {
      if (!step()) return 0;
      const op = block.instructions[i];
      if (op === undefined) throw "record fact instruction invariant";
      if (barrier(op)) return 0;
      if (
        op.kind === "record-read" &&
        op.object === value &&
        reads[op.id] === 1
      )
        return -op.record - 1;
      if (instructionResult(op) !== value) continue;
      if (op.kind === "record-new") return -op.record - 1;
      if (op.kind === "load") return slotOrigin(block, op.slot, i, depth + 1);
      if (op.kind === "reference-value" || op.kind === "reference-wrap")
        return valueOrigin(block, op.value, i, depth + 1);
      return 0;
    }
    return 0;
  }
  function proves(
    block: Block,
    object: number,
    record: number,
    before: number,
  ): boolean {
    let matched = false;
    let origin = valueOrigin(block, object, before, 0),
      cursor = block.id;
    for (let hops = 0; hops < 32 && origin !== 0; hops++) {
      if (!step()) return false;
      if (origin < 0) {
        if (-origin - 1 === record) matched = true;
        break;
      }
      const previous = predecessors[cursor];
      if (previous === undefined || previous === 0 || previous === 0xffffffff)
        break;
      const source = fn.blocks[previous - 1];
      if (source === undefined) throw "record fact predecessor invariant";
      const prior = source.terminator,
        slot = origin - 1;
      // A record/cell read may define the receiver slot on the successful edge.
      if (
        (prior.kind === "record" ||
          prior.kind === "record-cell" ||
          prior.kind === "cell") &&
        prior.slot === slot
      )
        break;
      origin = slotOrigin(source, slot, source.instructions.length, 0);
      if (
        (prior.kind === "record" || prior.kind === "record-cell") &&
        prior.consequent === cursor &&
        prior.record === record &&
        origin !== 0
      ) {
        const checked = valueOrigin(
          source,
          prior.object,
          source.instructions.length,
          0,
        );
        if (origin > 0 && origin === checked) {
          matched = true;
          break;
        }
      }
      cursor = source.id;
    }
    return matched && !exhausted;
  }
  // Only established reads may seed later proofs. Revisit unresolved reads when
  // a checkpoint was added, so block numbering cannot affect soundness or
  // completeness. Cycles without an initial proof never acquire a checkpoint.
  let changed = true;
  while (changed) {
    changed = false;
    let pending = false;
    for (const block of fn.blocks) {
      if (block === undefined) throw "record proof block invariant";
      if (!step()) return undefined;
      for (let index = 0; index < block.instructions.length; index++) {
        if (!step()) return undefined;
        const op = block.instructions[index];
        if (op === undefined) throw "record proof instruction invariant";
        if (op.kind !== "record-read" || reads[op.id] === 1) continue;
        if (proves(block, op.object, op.record, index)) {
          reads[op.id] = 1;
          changed = true;
        } else pending = true;
      }
      const term = block.terminator;
      if (
        includeGuards &&
        proven[block.id] !== 1 &&
        (term.kind === "record" || term.kind === "record-cell") &&
        proves(block, term.object, term.record, block.instructions.length)
      )
        proven[block.id] = 1;
      if (exhausted) return undefined;
    }
    if (!pending) break;
  }
  return { guards: proven, reads, work };
}
export function provenRecordGuards(
  fn: FunctionIR,
  maxWork: number = 100000,
  stableLayouts: boolean = false,
): Uint8Array | undefined {
  return analyzeRecordAccesses(fn, maxWork, stableLayouts)?.guards;
}
export function provenRecordReads(
  fn: FunctionIR,
  maxWork: number = 100000,
  stableLayouts: boolean = false,
): Uint8Array | undefined {
  // Verification needs read proofs only. Optimization-only guard queries can
  // otherwise exhaust its budget and reject valid, already-lowered reads.
  return analyzeRecordAccesses(fn, maxWork, stableLayouts, false)?.reads;
}
