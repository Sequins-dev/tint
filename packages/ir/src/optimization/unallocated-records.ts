import {
  stableRecordLayouts,
  type Block,
  type FunctionIR,
  type Instruction,
  type ModuleIR,
} from "../scalar/index.ts";
import { compactReachableBlocks } from "./control-flow.ts";
import type { RemarkSink } from "./observer.ts";

export interface UnallocatedRecordPruning {
  readonly module: ModuleIR;
  readonly visited: number;
  readonly rewritten: number;
}

/** In a closed world (`closedRecords` + `stableRecordLayouts`), a record layout
 * with zero `record-new` allocations and no escaped descriptor references
 * (`record-descriptor-address` / `general-record-descriptor`) or closure
 * environment uses can never be the runtime descriptor of any object.
 * Any `record` / `record-cell` terminator testing such a layout always fails
 * (jumps to `alternate`), and any `record-has` / `general-record-is` testing it
 * always yields `false`. Likewise, for any layout whose descriptor never
 * escapes, an optional-presence field (`presenceOffset !== undefined`) that is
 * never written present by any `record-new` or `record` write in the module can
 * never be present on any instance, so `record-has` for it always yields
 * `false`. Pruning these dead union arms and own-override checks collapses
 * 2-layout union chains and class prototype dispatch fast paths. */
export function pruneUnallocatedRecords(
  module: ModuleIR,
  budget: number,
  remarks?: RemarkSink,
  openRecords?: ReadonlySet<number>,
): UnallocatedRecordPruning | undefined {
  if (!Number.isSafeInteger(budget) || budget < 0) return undefined;
  const records = module.records;
  if (records === undefined || records.length === 0)
    return { module, visited: 0, rewritten: 0 };
  if (!stableRecordLayouts(module)) return { module, visited: 0, rewritten: 0 };
  const live = new Uint8Array(records.length),
    escapedDescriptor = new Uint8Array(records.length),
    presentFields: (Uint8Array | undefined)[] = [];
  if (openRecords !== undefined)
    for (const record of openRecords)
      if (record !== undefined && record < records.length) {
        live[record] = 1;
        escapedDescriptor[record] = 1;
      }
  for (let r = 0; r < records.length; r++) {
    const layout = records[r];
    if (layout === undefined) {
      presentFields.push(undefined);
      continue;
    }
    let hasPresence = false;
    for (const field of layout.fields)
      if (field !== undefined && field.presenceOffset !== undefined) {
        hasPresence = true;
        break;
      }
    presentFields.push(
      hasPresence ? new Uint8Array(layout.fields.length) : undefined,
    );
  }
  let visited = 0;
  for (const fn of module.functions) {
    if (fn === undefined) throw "unallocated record function invariant";
    if (fn.import === true) return { module, visited, rewritten: 0 };
    if (
      fn.closureEnvironment !== undefined &&
      fn.closureEnvironment < records.length
    )
      live[fn.closureEnvironment] = 1;
    for (const block of fn.blocks) {
      if (block === undefined) throw "unallocated record block invariant";
      if (++visited > budget) return undefined;
      for (const op of block.instructions) {
        if (op === undefined) throw "unallocated record instruction invariant";
        if (++visited > budget) return undefined;
        if (op.kind === "record-new" && op.record < records.length) {
          live[op.record] = 1;
          const flags = presentFields[op.record];
          if (flags !== undefined) {
            const layout = records[op.record];
            if (layout !== undefined)
              for (let f = 0; f < layout.fields.length; f++) {
                const field = layout.fields[f];
                if (
                  field !== undefined &&
                  field.presenceOffset !== undefined &&
                  (op.arguments[f] !== undefined ||
                    op.presence?.[f] !== undefined)
                )
                  flags[f] = 1;
              }
          }
        } else if (
          (op.kind === "record-descriptor-address" ||
            op.kind === "general-record-descriptor") &&
          op.record < records.length
        ) {
          live[op.record] = 1;
          escapedDescriptor[op.record] = 1;
        }
      }
      const term = block.terminator;
      if (
        term.kind === "record" &&
        term.operation === "write" &&
        term.record < records.length
      ) {
        const flags = presentFields[term.record];
        if (flags !== undefined && term.field < flags.length)
          flags[term.field] = 1;
      }
    }
  }
  let hasDead = false;
  for (let i = 0; i < records.length; i++) {
    if (live[i] === 0) {
      hasDead = true;
      break;
    }
    const flags = presentFields[i];
    if (flags !== undefined && escapedDescriptor[i] === 0) {
      const layout = records[i];
      if (layout !== undefined)
        for (let f = 0; f < layout.fields.length; f++)
          if (
            layout.fields[f]?.presenceOffset !== undefined &&
            flags[f] === 0
          ) {
            hasDead = true;
            break;
          }
    }
    if (hasDead) break;
  }
  if (!hasDead) return { module, visited, rewritten: 0 };
  const functions: FunctionIR[] = [];
  let rewritten = 0,
    moduleChanged = false;
  for (const fn of module.functions) {
    if (fn === undefined) throw "unallocated record function invariant";
    let fnChanged = false,
      cfgChanged = false;
    const blocks: Block[] = [];
    for (const block of fn.blocks) {
      if (block === undefined) throw "unallocated record block invariant";
      if (++visited > budget) return undefined;
      let instructions: Instruction[] | undefined;
      const deadFalseIds = new Set<number>();
      for (let i = 0; i < block.instructions.length; i++) {
        const op = block.instructions[i];
        if (op === undefined) throw "unallocated record instruction invariant";
        if (++visited > budget) return undefined;
        let deadId = -1;
        let reason = "";
        if (
          (op.kind === "record-has" || op.kind === "general-record-is") &&
          op.record < records.length &&
          live[op.record] === 0
        ) {
          deadId = op.id;
          reason =
            op.kind + " for unallocated r" + String(op.record) + " -> false";
        } else if (
          op.kind === "record-has" &&
          op.record < records.length &&
          escapedDescriptor[op.record] === 0
        ) {
          const flags = presentFields[op.record];
          const field = records[op.record]?.fields[op.field];
          if (
            flags !== undefined &&
            field !== undefined &&
            field.presenceOffset !== undefined &&
            flags[op.field] === 0
          ) {
            deadId = op.id;
            reason =
              "record-has for never-written r" +
              String(op.record) +
              ".f" +
              String(op.field) +
              " -> false";
          }
        }
        if (deadId >= 0) {
          if (instructions === undefined)
            instructions = block.instructions.slice(0, i);
          instructions.push({
            kind: "constant",
            id: deadId,
            value: false,
            start: op.start,
            end: op.end,
            ...(op.inline === undefined ? {} : { inline: op.inline }),
          });
          deadFalseIds.add(deadId);
          rewritten++;
          fnChanged = true;
          if (remarks !== undefined)
            remarks({
              pass: "prune-unallocated-records",
              outcome: "applied",
              function: fn.name,
              start: op.start,
              end: op.end,
              message: reason,
            });
          continue;
        }
        if (instructions !== undefined) instructions.push(op);
      }
      let terminator = block.terminator;
      if (
        terminator.kind === "branch" &&
        deadFalseIds.has(terminator.condition)
      ) {
        terminator = {
          kind: "jump",
          target: terminator.alternate,
          start: terminator.start,
          end: terminator.end,
          ...(terminator.inline === undefined
            ? {}
            : { inline: terminator.inline }),
        };
        rewritten++;
        fnChanged = true;
        cfgChanged = true;
      } else if (
        (terminator.kind === "record" || terminator.kind === "record-cell") &&
        terminator.record < records.length &&
        live[terminator.record] === 0
      ) {
        if (remarks !== undefined)
          remarks({
            pass: "prune-unallocated-records",
            outcome: "applied",
            function: fn.name,
            start: terminator.start,
            end: terminator.end,
            message:
              terminator.kind +
              " check for unallocated r" +
              String(terminator.record) +
              " -> jump b" +
              String(terminator.alternate),
          });
        terminator = {
          kind: "jump",
          target: terminator.alternate,
          start: terminator.start,
          end: terminator.end,
          ...(terminator.inline === undefined
            ? {}
            : { inline: terminator.inline }),
        };
        rewritten++;
        fnChanged = true;
        cfgChanged = true;
      }
      blocks.push(
        instructions === undefined && terminator === block.terminator
          ? block
          : {
              ...block,
              instructions:
                instructions === undefined ? block.instructions : instructions,
              terminator,
            },
      );
    }
    if (!fnChanged) {
      functions.push(fn);
      continue;
    }
    moduleChanged = true;
    if (!cfgChanged) {
      functions.push({ ...fn, blocks });
      continue;
    }
    const compacted = compactReachableBlocks(fn, blocks, budget - visited);
    if (compacted === undefined) return undefined;
    visited += compacted.visited;
    functions.push(compacted.fn);
  }
  return {
    module: moduleChanged ? { ...module, functions } : module,
    visited,
    rewritten,
  };
}
