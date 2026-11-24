import { representationFor, type TypeKnowledge } from "../semantic/index.ts";
import {
  analyzeRecordAccesses,
  provenRecordReads,
  stableDescriptors,
  instructionResult,
  verifierRecordBudget,
  type ModuleIR,
  type FunctionIR,
  type Block,
  type Instruction,
} from "../scalar/index.ts";
import type { RemarkSink } from "./observer.ts";
export interface RecordAccessLowering {
  readonly module: ModuleIR;
  readonly visited: number;
  readonly rewritten: number;
  /** Functions kept checked because the verifier's budget would not prove
   * their lowered reads (PassStatistics.fallbacks). */
  readonly fallbacks: number;
}
/** Move statically proven reads into the ordinary value stream. Checked reads
 * remain when proof is unavailable. Retain the failure CFG edge with a constant
 * condition until reachability cleanup, preserving the current verifier contract. */
export function lowerProvenRecordReads(
  module: ModuleIR,
  budget: number,
  remarks?: RemarkSink,
): RecordAccessLowering | undefined {
  if (!Number.isSafeInteger(budget) || budget < 1) return undefined;
  const stable = stableDescriptors(module),
    functions: FunctionIR[] = [];
  let visited = 0,
    rewritten = 0,
    fallbacks = 0;
  for (const fn of module.functions) {
    if (fn === undefined) throw "record lowering function invariant";
    let maximum = -1,
      candidates = 0;
    const rewrittenBefore = rewritten;
    for (const block of fn.blocks) {
      if (block === undefined || ++visited > budget) return undefined;
      const terminator = block.terminator;
      if (terminator.kind === "record" && terminator.operation === "read")
        candidates++;
      for (const op of block.instructions) {
        if (op === undefined || ++visited > budget) return undefined;
        const id = instructionResult(op);
        if (id !== undefined) maximum = Math.max(maximum, id);
      }
    }
    if (candidates === 0) {
      functions.push(fn);
      continue;
    }
    const proof = analyzeRecordAccesses(fn, budget - visited, stable);
    if (proof === undefined) return undefined;
    visited += proof.work;
    const blocks: Block[] = [];
    let changed = false,
      next = maximum + 1;
    for (const block of fn.blocks) {
      if (block === undefined || ++visited > budget) return undefined;
      const term = block.terminator;
      if (term.kind !== "record" || term.operation !== "read") {
        blocks.push(block);
        continue;
      }
      if (proof.guards[block.id] !== 1) {
        if (remarks !== undefined)
          remarks({
            pass: "lower-proven-record-reads",
            outcome: "missed",
            function: fn.name,
            start: term.start,
            end: term.end,
            message:
              "read r" +
              String(term.record) +
              ".f" +
              String(term.field) +
              " stays checked: object layout unproven",
          });
        blocks.push(block);
        continue;
      }
      const knowledge: TypeKnowledge = {
        declared: undefined,
        variants: [term.record],
        origin: "analysis",
        guard: undefined,
      };
      if (representationFor(knowledge, []) !== "fixed") {
        if (remarks !== undefined)
          remarks({
            pass: "lower-proven-record-reads",
            outcome: "missed",
            function: fn.name,
            start: term.start,
            end: term.end,
            message:
              "read r" +
              String(term.record) +
              ".f" +
              String(term.field) +
              " stays checked: layout proven but representation is not fixed",
          });
        blocks.push(block);
        continue;
      }
      const id = next++,
        condition = next++;
      const instructions: Instruction[] = block.instructions.slice();
      instructions.push({
        kind: "record-read",
        id,
        object: term.object,
        record: term.record,
        field: term.field,
        start: term.start,
        end: term.end,
      });
      instructions.push({
        kind: "store",
        slot: term.slot,
        value: id,
        start: term.start,
        end: term.end,
      });
      instructions.push({
        kind: "constant",
        id: condition,
        value: true,
        start: term.start,
        end: term.end,
      });
      blocks.push({
        ...block,
        instructions,
        terminator: {
          kind: "branch",
          condition,
          consequent: term.consequent,
          alternate: term.alternate,
          start: term.start,
          end: term.end,
        },
      });
      rewritten++;
      changed = true;
      if (remarks !== undefined)
        remarks({
          pass: "lower-proven-record-reads",
          outcome: "applied",
          function: fn.name,
          start: term.start,
          end: term.end,
          message:
            "read r" +
            String(term.record) +
            ".f" +
            String(term.field) +
            " proven: unchecked field load",
        });
    }
    if (!changed) {
      functions.push(fn);
      continue;
    }
    // The proof above spends this pass's budget; the verifier re-proves the
    // direct reads under its own (verifierRecordBudget). Keep the checked
    // reads of a function it would not prove.
    const lowered: FunctionIR = { ...fn, blocks },
      proofs = provenRecordReads(
        lowered,
        verifierRecordBudget(lowered),
        stable,
      );
    let verified = proofs !== undefined;
    for (const block of blocks) {
      if (!verified) break;
      if (block === undefined || ++visited > budget) return undefined;
      for (const op of block.instructions)
        if (
          op !== undefined &&
          op.kind === "record-read" &&
          proofs !== undefined &&
          proofs[op.id] !== 1
        )
          verified = false;
    }
    if (verified) {
      functions.push(lowered);
      continue;
    }
    fallbacks++;
    rewritten = rewrittenBefore;
    functions.push(fn);
    if (remarks !== undefined)
      remarks({
        pass: "lower-proven-record-reads",
        outcome: "missed",
        function: fn.name,
        start: 0,
        end: 0,
        message:
          "reads stay checked: the verifier's work budget does not prove the lowered function",
      });
  }
  return {
    module: rewritten === 0 ? module : { ...module, functions },
    visited,
    rewritten,
    fallbacks,
  };
}
