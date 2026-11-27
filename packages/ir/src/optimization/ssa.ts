import { solveDataflow } from "@tint/foundation/graph/dataflow";
import {
  promoteSlots,
  lowerSSA,
  instructionResult,
  type FunctionIR,
  type Instruction,
  type SSABlock,
  type SSAParameter,
  type SSAEdge,
} from "../scalar/index.ts";
import { unary, binary, type Constant } from "./constants.ts";
import { unbounded } from "./budget.ts";
export interface SSAOptimization {
  readonly fn: FunctionIR;
  readonly visited: number;
  readonly rewritten: number;
}
/** IEEE equality for facts: distinguish signed zero and equate NaN payloads. */
function same(left: Constant, right: Constant): boolean {
  if (typeof left !== "number" || typeof right !== "number")
    return left === right;
  return left === right
    ? left !== 0 || 1 / left === 1 / right
    : left !== left && right !== right;
}
/** Conditional fixed-point propagation over promoted locals. Facts are bottom,
 * a constant, or unknown. Only executable incoming edges participate in joins.
 * All facts are discarded on exhaustion; source IR is never mutated. */
export function foldSSAConstants(
  fn: FunctionIR,
  budget: number,
): SSAOptimization | undefined {
  const ssa = promoteSlots(fn, budget);
  if (ssa === undefined) return undefined;
  if (ssa.promoted === 0) return { fn, visited: ssa.work, rewritten: 0 };
  const states = new Uint8Array(ssa.valueCount),
    values: (Constant | undefined)[] = [];
  const live = new Uint8Array(ssa.blocks.length),
    active = new Uint8Array(ssa.blocks.length);
  const successors: number[][] = [],
    predecessors: number[][] = [];
  let work = ssa.work,
    exhausted = false;
  const skipSettledJoins = unbounded(budget);
  for (const block of ssa.blocks) {
    if (block === undefined) return undefined;
    successors.push([]);
    predecessors.push([]);
  }
  for (const block of ssa.blocks) {
    if (block === undefined) return undefined;
    const outgoing = successors[block.id];
    if (outgoing === undefined) return undefined;
    for (let index = 0; index < block.edges.length; index++) {
      const edge = block.edges[index];
      if (edge === undefined) return undefined;
      outgoing.push(edge.target);
      const incoming = predecessors[edge.target];
      if (incoming === undefined) return undefined;
      incoming.push(block.id * 2 + index);
    }
    if (block.exception !== undefined) outgoing.push(block.exception.target);
  }
  function join(
    id: number,
    state: number,
    value: Constant | undefined,
  ): boolean {
    const before = states[id] ?? 0;
    if (before === 2 || state === 0) return false;
    const previous = values[id];
    if (
      state === 2 ||
      (before === 1 &&
        previous !== undefined &&
        value !== undefined &&
        !same(previous, value))
    ) {
      states[id] = 2;
      if (previous !== undefined) values[id] = undefined;
      return before !== 2;
    }
    if (before === 0) {
      states[id] = state;
      if (value !== undefined) values[id] = value;
      return true;
    }
    return false;
  }
  live[fn.entry] = 1;
  const solved = solveDataflow(
    successors,
    [fn.entry],
    (id: number): boolean => {
      if (live[id] === 0) return false;
      const block = ssa.blocks[id];
      const incoming: readonly number[] | undefined = predecessors[id];
      if (block === undefined || incoming === undefined)
        throw "SSA solver block invariant";
      let changed = false;
      for (let index = 0; index < block.parameters.length; index++) {
        const param = block.parameters[index];
        if (param === undefined) throw "SSA solver parameter invariant";
        // A settled unknown is the top of the lattice. Reading incoming
        // arguments again cannot change the parameter or enqueue successors.
        // Bounded runs keep their existing budget accounting.
        if (skipSettledJoins && states[param.id] === 2) continue;
        for (
          let predecessorIndex = 0;
          predecessorIndex < incoming.length;
          predecessorIndex++
        ) {
          const encoded: number | undefined = incoming[predecessorIndex];
          if (++work > budget) {
            exhausted = true;
            return false;
          }
          if (encoded === undefined) throw "SSA predecessor invariant";
          const source = Math.floor(encoded / 2),
            edgeIndex = encoded % 2;
          if (((active[source] ?? 0) & (1 << edgeIndex)) === 0) continue;
          const value = ssa.blocks[source]?.edges[edgeIndex]?.arguments[index];
          if (value === undefined) throw "SSA incoming argument invariant";
          if (join(param.id, states[value] ?? 0, values[value])) changed = true;
        }
      }
      for (const op of block.instructions) {
        if (++work > budget) {
          exhausted = true;
          return false;
        }
        if (op === undefined) throw "SSA solver instruction invariant";
        const result = instructionResult(op);
        if (result === undefined) continue;
        let state = 2,
          value: Constant | undefined;
        if (op.kind === "constant") {
          state = 1;
          value = op.value;
        } else if (op.kind === "unary") {
          state = states[op.operand] ?? 0;
          const operand = values[op.operand];
          if (state === 1 && operand !== undefined) {
            value = unary(op.operator, operand);
            if (value === undefined) state = 2;
          }
        } else if (op.kind === "binary") {
          const leftState = states[op.left] ?? 0,
            rightState = states[op.right] ?? 0;
          state = leftState === 0 || rightState === 0 ? 0 : 2;
          const left = values[op.left],
            right = values[op.right];
          if (
            leftState === 1 &&
            rightState === 1 &&
            left !== undefined &&
            right !== undefined
          ) {
            value = binary(op.operator, left, right);
            state = value === undefined ? 2 : 1;
          }
        }
        if (join(result, state, value)) changed = true;
      }
      const term = block.terminator;
      let mask = block.edges.length === 2 ? 3 : block.edges.length;
      if (term.kind === "branch") {
        const state = states[term.condition] ?? 0;
        if (state === 0) mask = 0;
        else if (state === 1) mask = values[term.condition] ? 1 : 2;
      }
      const previous = active[id] ?? 0;
      active[id] = previous | mask;
      if (previous !== active[id]) changed = true;
      for (let index = 0; index < block.edges.length; index++) {
        if ((mask & (1 << index)) === 0) continue;
        const edge = block.edges[index];
        if (edge === undefined) throw "SSA executable edge invariant";
        if (live[edge.target] === 0) {
          live[edge.target] = 1;
          changed = true;
        }
      }
      const handler = block.exception;
      if (handler !== undefined && live[handler.target] === 0) {
        live[handler.target] = 1;
        changed = true;
      }
      return changed;
    },
    budget - work,
  );
  if (!solved.complete || exhausted || work + solved.work > budget)
    return undefined;
  const blocks: SSABlock[] = [];
  let rewritten = 0;
  for (const block of ssa.blocks) {
    if (block === undefined) throw "SSA rewrite block invariant";
    const parameters: SSAParameter[] = [],
      instructions: Instruction[] = [];
    for (const param of block.parameters) {
      if (param === undefined) throw "SSA rewrite parameter invariant";
      const value = values[param.id];
      if (states[param.id] === 1 && value !== undefined) {
        const entrySpan = block.instructions[0] ?? block.terminator;
        instructions.push({
          kind: "constant",
          id: param.id,
          value,
          start: entrySpan.start,
          end: entrySpan.end,
          ...(entrySpan.inline === undefined
            ? {}
            : { inline: entrySpan.inline }),
        });
        rewritten++;
      } else parameters.push(param);
    }
    for (const op of block.instructions) {
      if (op === undefined) throw "SSA rewrite instruction invariant";
      const id = instructionResult(op),
        value = id === undefined ? undefined : values[id];
      if (
        (op.kind === "unary" || op.kind === "binary") &&
        id !== undefined &&
        states[id] === 1 &&
        value !== undefined
      ) {
        instructions.push({
          kind: "constant",
          id,
          value,
          start: op.start,
          end: op.end,
          ...(op.inline === undefined ? {} : { inline: op.inline }),
        });
        rewritten++;
      } else instructions.push(op);
    }
    blocks.push({ ...block, parameters, instructions });
  }
  if (rewritten === 0) return { fn, visited: work + solved.work, rewritten: 0 };
  const final: SSABlock[] = [];
  for (const block of blocks) {
    if (block === undefined) throw "SSA final block invariant";
    const edges: SSAEdge[] = [];
    for (const edge of block.edges) {
      if (edge === undefined) throw "SSA final edge invariant";
      const target = ssa.blocks[edge.target],
        args: number[] = [];
      if (target === undefined) throw "SSA final target invariant";
      for (let index = 0; index < target.parameters.length; index++) {
        const param = target.parameters[index],
          value = edge.arguments[index];
        if (param === undefined || value === undefined)
          throw "SSA final argument invariant";
        if (states[param.id] !== 1) args.push(value);
      }
      edges.push({ ...edge, arguments: args });
    }
    final.push({ ...block, edges });
  }
  return {
    fn: lowerSSA({ ...ssa, blocks: final }),
    visited: work + solved.work,
    rewritten,
  };
}
