import {
  instructionResult,
  visitInstructionOperands,
  visitTerminatorOperands,
  immediateDominators,
  dominates,
  type Dominators,
  type FunctionIR,
  type ModuleIR,
  type Instruction,
  type Block,
  type ScalarType,
  type Terminator,
} from "../scalar/index.ts";
import type { RemarkSink } from "./observer.ts";
interface Candidate {
  readonly instruction: Instruction & { readonly kind: "record-new" };
  escaped: boolean;
  returned: boolean;
  accesses: number;
  fields: number[];
}
/** Local allocations with uniquely assigned local aliases. Unknown uses escape.
 * Scalar fields need neither object identity nor a managed allocation. */
export function scalarReplaceRecords(
  fn: FunctionIR,
  module: ModuleIR,
  budget: number,
  remarks?: RemarkSink,
): { fn: FunctionIR; visited: number; replaced: number } | undefined {
  if (fn.import === true) return { fn, visited: 0, replaced: 0 };
  const entry = fn.blocks[fn.entry];
  if (entry === undefined) throw "record entry invariant";
  let visited = 0;
  const candidates: Candidate[] = [],
    owners: (Candidate | undefined)[] = [],
    aliases: (Candidate | undefined)[] = [],
    writes: number[] = [],
    incoming: number[] = [],
    predecessors: number[] = [],
    ownerBlocks: number[] = [],
    ownerPositions: number[] = [],
    prefixRanks: number[] = [];
  function edge(target: number, source: number): void {
    predecessors[target] = source;
    incoming[target] = (incoming[target] ?? 0) + 1;
  }
  let nextValue = 0;
  // A re-entered entry or local exception handler needs more precise dominance.
  if (entry.exception !== undefined) return { fn, visited, replaced: 0 };
  for (const block of fn.blocks) {
    if (block === undefined) throw "record block invariant";
    const term = block.terminator;
    if (term.kind === "jump") edge(term.target, block.id);
    else if (
      term.kind === "branch" ||
      term.kind === "record" ||
      term.kind === "record-cell" ||
      term.kind === "cell"
    ) {
      edge(term.consequent, block.id);
      edge(term.alternate, block.id);
    }
    if (block.exception !== undefined) edge(block.exception.target, block.id);
    if (
      (term.kind === "jump" && term.target === fn.entry) ||
      ((term.kind === "branch" ||
        term.kind === "record" ||
        term.kind === "record-cell" ||
        term.kind === "cell") &&
        (term.consequent === fn.entry || term.alternate === fn.entry)) ||
      block.exception?.target === fn.entry
    )
      return { fn, visited, replaced: 0 };
    if (block.exception !== undefined) writes[block.exception.slot] = 2;
    if (
      term.kind === "record" ||
      term.kind === "record-cell" ||
      term.kind === "cell"
    )
      writes[term.slot] = 2;
    let position = 0;
    for (const op of block.instructions) {
      position++;
      if (op === undefined) throw "record instruction invariant";
      if (visited++ >= budget) return undefined;
      const id = instructionResult(op);
      if (id !== undefined) nextValue = Math.max(nextValue, id + 1);
      if (op.kind === "store") writes[op.slot] = (writes[op.slot] ?? 0) + 1;
    }
  }
  const prefix: Instruction[] = [];
  let prefixBlock: Block | undefined = entry;
  while (prefixBlock !== undefined) {
    const current: Block = prefixBlock;
    if (current.exception !== undefined) break;
    prefixRanks[current.id] = prefix.length;
    for (const op of current.instructions) {
      if (op === undefined) throw "record prefix invariant";
      if (visited++ >= budget) return undefined;
      prefix.push(op);
    }
    const term: Terminator = current.terminator;
    prefixBlock =
      term.kind === "jump" && incoming[term.target] === 1
        ? fn.blocks[term.target]
        : undefined;
  }
  // A loop-local allocation is safe too when every alias load is dominated by
  // its unique assignment. Re-executing the allocation resets all scalar fields;
  // references surviving into another iteration must pass that same proof.
  for (const block of fn.blocks) {
    if (block === undefined) throw "record candidate block invariant";
    if (block.exception !== undefined) continue;
    for (const op of block.instructions) {
      if (op === undefined) throw "record instruction invariant";
      if (visited++ >= budget) return undefined;
      if (op.kind !== "record-new") continue;
      const layout = module.records?.[op.record];
      if (layout === undefined || layout.fields.length === 0) continue;
      let supported = true;
      for (let index = 0; index < layout.fields.length; index++) {
        const field = layout.fields[index];
        if (
          field === undefined ||
          (field.type !== "number" && field.type !== "boolean") ||
          field.stateOffset !== undefined ||
          field.presenceOffset !== undefined ||
          op.arguments[index] === undefined ||
          op.presence?.[index] !== undefined
        )
          supported = false;
      }
      if (!supported) continue;
      const candidate: Candidate = {
        instruction: op,
        escaped: false,
        returned: false,
        accesses: 0,
        fields: [],
      };
      candidates.push(candidate);
      aliases[op.id] = candidate;
    }
  }
  if (candidates.length === 0) return { fn, visited, replaced: 0 };
  // Follow unique local assignments to a fixed point. Dominance is checked
  // separately before any allocation is removed.
  let changed = true;
  while (changed) {
    changed = false;
    for (const block of fn.blocks) {
      if (block === undefined) throw "record block invariant";
      let position = 0;
      for (const op of block.instructions) {
        position++;
        if (op === undefined) throw "record instruction invariant";
        if (visited++ >= budget) return undefined;
        if (op.kind === "load" && aliases[op.id] === undefined) {
          const owner = owners[op.slot];
          if (owner !== undefined) {
            aliases[op.id] = owner;
            changed = true;
          }
        }
        if (
          op.kind === "store" &&
          owners[op.slot] === undefined &&
          writes[op.slot] === 1 &&
          !fn.parameters.includes(op.slot)
        ) {
          const owner = aliases[op.value];
          if (owner !== undefined) {
            owners[op.slot] = owner;
            ownerBlocks[op.slot] = block.id;
            ownerPositions[op.slot] = position;
            changed = true;
          }
        }
      }
    }
  }
  let tree: Dominators | undefined;
  for (const block of fn.blocks) {
    if (block === undefined) throw "record block invariant";
    let position = 0;
    for (const op of block.instructions) {
      position++;
      if (op === undefined) throw "record instruction invariant";
      if (visited++ >= budget) return undefined;
      if (op.kind !== "load") continue;
      const owner = owners[op.slot],
        storedBlock = ownerBlocks[op.slot];
      if (owner === undefined || storedBlock === undefined) continue;
      let safe = false;
      if (storedBlock === block.id)
        safe = (ownerPositions[op.slot] ?? position) < position;
      else {
        const rank = prefixRanks[storedBlock],
          loadRank = prefixRanks[block.id];
        if (rank !== undefined)
          safe = loadRank === undefined || rank < loadRank;
        else {
          // The storing block must dominate the load. A handler in the
          // storing block could be entered before the store executes.
          if (tree === undefined) {
            tree = immediateDominators(fn, budget - visited);
            if (tree === undefined) return undefined;
            visited += tree.visited;
          }
          safe =
            fn.blocks[storedBlock]?.exception === undefined &&
            dominates(tree, fn.entry, storedBlock, block.id);
        }
      }
      if (!safe) owner.escaped = true;
    }
  }
  function escape(id: number): void {
    const candidate = aliases[id];
    if (candidate !== undefined) candidate.escaped = true;
  }
  for (const block of fn.blocks) {
    if (block === undefined) throw "record block invariant";
    for (const op of block.instructions) {
      if (op === undefined) throw "record instruction invariant";
      if (visited++ >= budget) return undefined;
      if (
        op.kind === "store" &&
        owners[op.slot] !== undefined &&
        owners[op.slot] === aliases[op.value]
      )
        continue;
      visitInstructionOperands(op, escape);
    }
    const term = block.terminator;
    if (term.kind === "record" && aliases[term.object] !== undefined) {
      const candidate = aliases[term.object];
      if (candidate === undefined) throw "record alias invariant";
      candidate.accesses = candidate.accesses + 1;
    } else if (term.kind === "return" && term.value !== undefined) {
      const candidate = aliases[term.value];
      if (candidate !== undefined) candidate.returned = true;
    } else visitTerminatorOperands(term, escape);
  }
  const slots: ScalarType[] = [];
  for (const slot of fn.slots) {
    if (slot === undefined) throw "record slot invariant";
    slots.push(slot);
  }
  let replaced = 0;
  for (const candidate of candidates) {
    if (candidate === undefined) throw "record candidate invariant";
    if (candidate.escaped || candidate.returned || candidate.accesses === 0) {
      if (remarks !== undefined)
        remarks({
          pass: "scalar-replace-records",
          outcome: "missed",
          function: fn.name,
          start: candidate.instruction.start,
          end: candidate.instruction.end,
          message:
            "allocation of r" +
            String(candidate.instruction.record) +
            " kept: " +
            (candidate.escaped
              ? "it escapes"
              : candidate.returned
                ? "it is returned"
                : "no field is accessed"),
        });
      continue;
    }
    const layout = module.records?.[candidate.instruction.record];
    if (layout === undefined) throw "record layout invariant";
    for (const field of layout.fields) {
      if (field === undefined) throw "record field invariant";
      candidate.fields.push(slots.length);
      slots.push(field.type);
    }
    replaced++;
    if (remarks !== undefined)
      remarks({
        pass: "scalar-replace-records",
        outcome: "applied",
        function: fn.name,
        start: candidate.instruction.start,
        end: candidate.instruction.end,
        message:
          "allocation of r" +
          String(candidate.instruction.record) +
          " replaced by " +
          String(layout.fields.length) +
          " scalar slots",
      });
  }
  if (replaced === 0) return { fn, visited, replaced };
  function active(id: number): Candidate | undefined {
    const candidate = aliases[id];
    return candidate !== undefined && candidate.fields.length > 0
      ? candidate
      : undefined;
  }
  const blocks: Block[] = [];
  for (const block of fn.blocks) {
    if (block === undefined) throw "record block invariant";
    const instructions: Instruction[] = [];
    for (const op of block.instructions) {
      if (op === undefined) throw "record instruction invariant";
      if (visited++ >= budget) return undefined;
      if (op.kind === "record-new") {
        const candidate = active(op.id);
        if (candidate !== undefined) {
          for (let index = 0; index < candidate.fields.length; index++) {
            const slot = candidate.fields[index],
              value = op.arguments[index];
            if (slot === undefined || value === undefined)
              throw "record initializer invariant";
            instructions.push({
              kind: "store",
              slot,
              value,
              start: op.start,
              end: op.end,
            });
          }
          continue;
        }
      }
      if (op.kind === "load" && active(op.id) !== undefined) continue;
      if (op.kind === "store" && active(op.value) !== undefined) continue;
      instructions.push(op);
    }
    let terminator = block.terminator;
    if (terminator.kind === "record") {
      const candidate = active(terminator.object);
      if (candidate !== undefined) {
        const matches = candidate.instruction.record === terminator.record;
        if (matches) {
          const fieldSlot = candidate.fields[terminator.field];
          if (fieldSlot === undefined) throw "record field slot invariant";
          const id = nextValue++;
          instructions.push({
            kind: "load",
            id,
            slot: terminator.operation === "read" ? fieldSlot : terminator.slot,
            start: terminator.start,
            end: terminator.end,
          });
          instructions.push({
            kind: "store",
            slot: terminator.operation === "read" ? terminator.slot : fieldSlot,
            value: id,
            start: terminator.start,
            end: terminator.end,
          });
        }
        const condition = nextValue++;
        instructions.push({
          kind: "constant",
          id: condition,
          value: matches,
          start: terminator.start,
          end: terminator.end,
        });
        // Retain both CFG edges until general unreachable-block cleanup exists.
        terminator = {
          kind: "branch",
          condition,
          consequent: terminator.consequent,
          alternate: terminator.alternate,
          start: terminator.start,
          end: terminator.end,
        };
      }
    }
    blocks.push({ ...block, instructions, terminator });
  }
  const transformed: FunctionIR = { ...fn, slots, blocks };
  return { fn: transformed, visited, replaced };
}
