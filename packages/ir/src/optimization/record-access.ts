import { representationFor, type TypeKnowledge } from "../semantic/index.ts";
import {
  analyzeRecordAccesses,
  stableRecordLayouts,
  instructionResult,
  type ModuleIR,
  type FunctionIR,
  type Block,
  type Instruction,
} from "../scalar/index.ts";
export interface RecordAccessLowering {
  readonly module: ModuleIR;
  readonly visited: number;
  readonly rewritten: number;
}
/** Move statically proven reads into the ordinary value stream. Checked reads
 * remain when proof is unavailable. Retain the failure CFG edge with a constant
 * condition until reachability cleanup, preserving the current verifier contract. */
export function lowerProvenRecordReads(
  module: ModuleIR,
  budget: number,
): RecordAccessLowering | undefined {
  if (!Number.isSafeInteger(budget) || budget < 1) return undefined;
  const stable = stableRecordLayouts(module),
    functions: FunctionIR[] = [];
  let visited = 0,
    rewritten = 0;
  for (const fn of module.functions) {
    if (fn === undefined) throw "record lowering function invariant";
    let maximum = -1,
      candidates = 0;
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
      if (
        term.kind !== "record" ||
        term.operation !== "read" ||
        proof.guards[block.id] !== 1
      ) {
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
    }
    functions.push(changed ? { ...fn, blocks } : fn);
  }
  return {
    module: rewritten === 0 ? module : { ...module, functions },
    visited,
    rewritten,
  };
}
