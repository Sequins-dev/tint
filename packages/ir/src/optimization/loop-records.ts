import {
  analyzeLiveSlots,
  blockSuccessors,
  instructionResult,
  naturalLoops,
  recordReadsKept,
  retainDebugValues,
  stableDescriptors,
  visitInstructionOperands,
  visitTerminatorOperands,
  type Block,
  type FunctionIR,
  type Instruction,
  type ModuleIR,
  type NaturalLoop,
  type RecordLayout,
  type ScalarType,
  type Terminator,
} from "../scalar/index.ts";
import { compactReachableBlocks } from "./control-flow.ts";
import type { RemarkSink } from "./observer.ts";

export interface LoopRecordScalarization {
  readonly fn: FunctionIR;
  readonly visited: number;
  readonly scalarized: number;
}

const maxScalarizedFields = 16;
const maxLoopRecordInstructions = 2000;
const maxLoopRecordAllocs = 16;
const maxPreheaderHops = 64;
const maxPreheaderWork = 8192;

function isSupportedFieldType(type: ScalarType): boolean {
  return (
    type === "number" ||
    type === "boolean" ||
    type === "reference" ||
    type === "optional-reference" ||
    type === "string" ||
    type === "optional-string"
  );
}

/** Proves the exact record layout held in `slot` at the end of `blockId` by
 * walking backward along unique normal predecessor chains (same rules as
 * `analyzeRecordAccesses`). Returns undefined when unproven. */
function proveSlotLayoutAtBlockEnd(
  fn: FunctionIR,
  blockId: number,
  startSlot: number,
  predecessors: readonly (readonly number[])[],
  stable: boolean,
  budget: number,
): { readonly layout: number | undefined; readonly visited: number } {
  const limit = Math.min(budget, maxPreheaderWork);
  let visited = 0;
  function barrier(op: Instruction): boolean {
    return (
      !stable &&
      (op.kind === "call" ||
        op.kind === "call-indirect" ||
        op.kind === "host-call")
    );
  }
  function valueOrigin(
    block: Block,
    startValue: number,
    before: number,
    depth: number,
  ): number {
    if (depth > 8 || visited > limit) return 0;
    let target = startValue;
    for (let i = before - 1; i >= 0; i--) {
      visited++;
      if (visited > limit) return 0;
      const op = block.instructions[i];
      if (op === undefined) throw "loop record instruction invariant";
      if (barrier(op)) return 0;
      if (op.kind === "record-read" && op.object === target)
        return -op.record - 1;
      if (instructionResult(op) !== target) continue;
      if (op.kind === "record-new") return -op.record - 1;
      if (op.kind === "load") return slotOrigin(block, op.slot, i, depth + 1);
      if (
        (op.kind === "reference-value" && op.type === undefined) ||
        op.kind === "reference-wrap" ||
        op.kind === "general-wrap" ||
        (op.kind === "general-value" && op.type === "reference")
      ) {
        target = op.value;
        continue;
      }
      return 0;
    }
    return 0;
  }
  function slotOrigin(
    block: Block,
    slot: number,
    before: number,
    depth: number,
  ): number {
    if (depth > 8 || visited > limit) return 0;
    let hasRead = false;
    for (let i = before - 1; i >= 0; i--) {
      visited++;
      if (visited > limit) return 0;
      const op = block.instructions[i];
      if (op === undefined) throw "loop record instruction invariant";
      if (barrier(op)) return 0;
      if (op.kind === "store" && op.slot === slot)
        return valueOrigin(block, op.value, i, depth + 1);
      if (op.kind === "record-read") hasRead = true;
    }
    if (hasRead) {
      const aliases = new Set<number>();
      for (let i = 0; i < before; i++) {
        visited++;
        if (visited > limit) return 0;
        const op = block.instructions[i];
        if (op === undefined) throw "loop record instruction invariant";
        if (op.kind === "load" && op.slot === slot) aliases.add(op.id);
        else if (
          ((op.kind === "reference-value" && op.type === undefined) ||
            op.kind === "reference-wrap" ||
            op.kind === "general-wrap" ||
            (op.kind === "general-value" && op.type === "reference")) &&
          aliases.has(op.value)
        )
          aliases.add(op.id);
        else if (op.kind === "record-read" && aliases.has(op.object))
          return -op.record - 1;
      }
    }
    return slot + 1;
  }
  const startBlock = fn.blocks[blockId];
  if (startBlock === undefined) return { layout: undefined, visited };
  let origin = slotOrigin(
      startBlock,
      startSlot,
      startBlock.instructions.length,
      0,
    ),
    cursor = blockId;
  const seen = new Set<number>();
  const hopLimit = Math.min(fn.blocks.length, maxPreheaderHops);
  for (let hops = 0; hops < hopLimit && origin !== 0; hops++) {
    visited++;
    if (visited > limit) return { layout: undefined, visited };
    if (origin < 0) return { layout: -origin - 1, visited };
    if (seen.has(cursor) || cursor === fn.entry) break;
    seen.add(cursor);
    const preds = predecessors[cursor];
    if (preds === undefined || preds.length !== 1) break;
    const prevId = preds[0];
    if (prevId === undefined) break;
    const prev = fn.blocks[prevId];
    if (prev === undefined || prev.exception?.target === cursor) break;
    const prior = prev.terminator,
      slot = origin - 1;
    if (
      (prior.kind === "record" ||
        prior.kind === "record-cell" ||
        prior.kind === "cell") &&
      prior.slot === slot
    )
      break;
    origin = slotOrigin(prev, slot, prev.instructions.length, 0);
    if (
      (prior.kind === "record" || prior.kind === "record-cell") &&
      prior.consequent === cursor &&
      origin > 0
    ) {
      const checked = valueOrigin(
        prev,
        prior.object,
        prev.instructions.length,
        0,
      );
      if (checked === origin) return { layout: prior.record, visited };
    }
    cursor = prevId;
  }
  return { layout: undefined, visited };
}

function defaultInstructionFor(
  id: number,
  type: ScalarType,
  start: number,
  end: number,
): Instruction | undefined {
  if (type === "number") return { kind: "constant", id, value: 0, start, end };
  if (type === "boolean")
    return { kind: "constant", id, value: false, start, end };
  if (type === "string")
    return { kind: "string-literal", id, value: "", start, end };
  if (type === "optional-reference")
    return { kind: "reference-none", id, start, end };
  if (type === "optional-string")
    return { kind: "string-none", id, start, end };
  return undefined;
}

/** Loop-carried record scalarization.
 *
 * When a natural loop carries a `reference` slot `S` of a proven fixed layout
 * `R` across iterations, reads only fields (or `record-has`) of `S` inside the
 * loop without escaping or mutating `S` in place, and every update to `S` in
 * the loop assigns a fresh non-escaping `record-new` of layout `R` (either
 * initialized directly in `record-new` or populated via builder field writes
 * before storing into `S`):
 *
 * 1. The preheader reads `S`'s initial fields (and any presence flags) into
 *    dedicated scalar slots and initializes a `dirty` boolean slot to `false`.
 *    Because `S` is proven to have layout `R` at the preheader, the preheader
 *    reads cannot fail even when the loop runs 0 iterations.
 * 2. Inside the loop, reads of `S` read the scalar field slots, `record-new`
 *    builder allocations write temporary builder slots instead of allocating on
 *    the heap, and storing the builder into `S` copies the builder slots into
 *    the loop-carried field slots and sets `dirty = true`.
 * 3. On every loop exit where `S` is live (normal exit edges, early `return`s
 *    of `S`, and exception edges leaving the loop), a guard checks `dirty`:
 *    when `true`, it materializes `S = record-new(fields...)`; when `false`,
 *    `S` keeps its exact pre-loop object identity (0-iteration identity). */
export function scalarizeLoopRecords(
  fn: FunctionIR,
  module: ModuleIR,
  budget: number,
  remarks?: RemarkSink,
  stableLayouts?: boolean,
): LoopRecordScalarization | undefined {
  if (!Number.isSafeInteger(budget) || budget < 0) return undefined;
  if (fn.import === true) return { fn, visited: 0, scalarized: 0 };
  const stable =
    stableLayouts !== undefined ? stableLayouts : stableDescriptors(module);
  let current = fn,
    visited = 0,
    scalarized = 0;
  for (let round = 0; round < 8; round++) {
    const result = scalarizeRound(
      current,
      module,
      stable,
      budget - visited,
      remarks,
    );
    if (result === undefined) return undefined;
    visited += result.visited;
    if (result.scalarized === 0) break;
    scalarized += result.scalarized;
    current = result.fn;
  }
  return { fn: current, visited, scalarized };
}

interface BuilderAnalysis {
  readonly allocBlock: number;
  readonly allocOp: Instruction & { readonly kind: "record-new" };
  readonly slots: ReadonlySet<number>;
  readonly values: ReadonlySet<number>;
}

function scalarizeRound(
  fn: FunctionIR,
  module: ModuleIR,
  stable: boolean,
  budget: number,
  remarks: RemarkSink | undefined,
): LoopRecordScalarization | undefined {
  const count = fn.blocks.length;
  for (let i = 0; i < count; i++)
    if (fn.blocks[i]?.id !== i) return { fn, visited: 0, scalarized: 0 };
  const forest = naturalLoops(fn, budget);
  if (forest === undefined) return undefined;
  let visited = forest.visited;
  if (forest.loops.length === 0) return { fn, visited, scalarized: 0 };
  const predecessors: number[][] = [];
  for (let i = 0; i < count; i++) predecessors.push([]);
  let nextValue = 0;
  for (const block of fn.blocks) {
    if (block === undefined) throw "loop record block invariant";
    for (const target of blockSuccessors(block))
      if (target !== undefined) predecessors[target]?.push(block.id);
    const blockEx = block.exception;
    if (blockEx !== undefined) predecessors[blockEx.target]?.push(block.id);
    for (const op of block.instructions) {
      if (op === undefined) throw "loop record instruction invariant";
      if (++visited > budget) return undefined;
      const id = instructionResult(op);
      if (id !== undefined && id >= nextValue) nextValue = id + 1;
    }
  }
  // Innermost loops first.
  const loops: NaturalLoop[] = [];
  for (const loop of forest.loops) {
    if (loop === undefined) throw "loop record loop invariant";
    let at = loops.length;
    while (at > 0 && (loops[at - 1]?.body.size ?? 0) > loop.body.size) at--;
    loops.splice(at, 0, loop);
  }
  for (const loop of loops) {
    if (loop === undefined) throw "loop record loop invariant";
    let loopInstructions = 0;
    for (const id of loop.body) {
      const block = fn.blocks[id];
      if (block !== undefined) loopInstructions += block.instructions.length;
    }
    if (loopInstructions > maxLoopRecordInstructions) continue;
    // Require a single plain-jump preheader and single loop entry at header.
    let reducible = true;
    for (const id of loop.body) {
      if (id === loop.header) continue;
      for (const pred of predecessors[id] ?? [])
        if (pred !== undefined && !loop.body.has(pred)) {
          reducible = false;
          break;
        }
      if (!reducible) break;
    }
    if (!reducible) continue;
    const outside = (predecessors[loop.header] ?? []).filter(
      (id) => !loop.body.has(id),
    );
    const preheaderId = outside[0];
    if (outside.length !== 1 || preheaderId === undefined) continue;
    const preheader = fn.blocks[preheaderId];
    if (
      preheader === undefined ||
      preheader.terminator.kind !== "jump" ||
      preheader.exception !== undefined
    )
      continue;
    // Candidate loop-carried reference slots written in the loop.
    const candidateSlots: number[] = [];
    for (const slot of loop.writes)
      if (slot !== undefined && fn.slots[slot] === "reference")
        candidateSlots.push(slot);
    if (candidateSlots.length === 0) continue;
    for (const targetSlot of candidateSlots) {
      if (targetSlot === undefined) continue;
      // Target slot cannot be an exception slot or a guarded read destination
      // inside the loop.
      let slotDisqualified = false;
      for (const id of loop.body) {
        const block = fn.blocks[id];
        if (block === undefined) {
          slotDisqualified = true;
          break;
        }
        if (block.exception?.slot === targetSlot) {
          slotDisqualified = true;
          break;
        }
        const term = block.terminator;
        if (
          (term.kind === "record" ||
            term.kind === "record-cell" ||
            term.kind === "cell") &&
          term.operation === "read" &&
          term.slot === targetSlot
        ) {
          slotDisqualified = true;
          break;
        }
      }
      if (slotDisqualified) continue;
      const proved = proveSlotLayoutAtBlockEnd(
        fn,
        preheaderId,
        targetSlot,
        predecessors,
        stable,
        budget - visited,
      );
      visited += proved.visited;
      if (visited > budget) return undefined;
      const record = proved.layout;
      if (record === undefined) continue;
      const layout = module.records?.[record];
      if (
        layout === undefined ||
        layout.fields.length === 0 ||
        layout.fields.length > maxScalarizedFields
      )
        continue;
      let layoutSupported = true;
      for (const field of layout.fields)
        if (
          field === undefined ||
          field.stateOffset !== undefined ||
          !isSupportedFieldType(field.type)
        ) {
          layoutSupported = false;
          break;
        }
      if (!layoutSupported) continue;
      const attempt = tryScalarizeSlot(
        fn,
        loop,
        preheaderId,
        targetSlot,
        record,
        layout,
        nextValue,
        budget - visited,
        remarks,
      );
      if (attempt === undefined) return undefined;
      visited += attempt.visited;
      if (attempt.fn !== undefined) {
        return { fn: attempt.fn, visited, scalarized: 1 };
      }
    }
  }
  return { fn, visited, scalarized: 0 };
}

function tryScalarizeSlot(
  fn: FunctionIR,
  loop: NaturalLoop,
  preheaderId: number,
  targetSlot: number,
  record: number,
  layout: RecordLayout,
  nextValueStart: number,
  budget: number,
  remarks: RemarkSink | undefined,
):
  | { readonly fn: FunctionIR | undefined; readonly visited: number }
  | undefined {
  let visited = 0;
  const miss = (
    reason: string,
  ): { readonly fn: FunctionIR | undefined; readonly visited: number } => {
    if (remarks !== undefined)
      remarks({
        pass: "scalarize-loop-records",
        outcome: "missed",
        function: fn.name,
        start: fn.blocks[loop.header]?.terminator.start ?? 0,
        end: fn.blocks[loop.header]?.terminator.end ?? 0,
        message:
          "loop-carried s" +
          String(targetSlot) +
          " (r" +
          String(record) +
          ") kept: " +
          reason,
      });
    return { fn: undefined, visited };
  };
  // Find all record-new of `record` inside the loop.
  const allocOps: {
    readonly block: number;
    readonly op: Instruction & { readonly kind: "record-new" };
  }[] = [];
  for (const id of loop.body) {
    const block = fn.blocks[id];
    if (block === undefined) return { fn: undefined, visited };
    for (const op of block.instructions) {
      if (op === undefined) throw "loop record instruction invariant";
      if (++visited > budget) return undefined;
      if (op.kind === "record-new" && op.record === record)
        allocOps.push({ block: id, op });
    }
  }
  if (allocOps.length === 0) return miss("no record-new of layout in loop");
  if (allocOps.length > maxLoopRecordAllocs)
    return miss("too many allocations of layout in loop");
  // For each allocation, trace its derived values and pure-builder local slots
  // inside the loop. Keep only allocations that actually feed a store to
  // `targetSlot`.
  const allBuilderSlots = new Set<number>();
  const allocToBuilder = new Map<number, number>();
  const builders: BuilderAnalysis[] = [];
  const slotOwnerBuilder = new Map<number, number>();
  // Pre-scan slot write counts inside the loop and whether any slot is a
  // guarded transfer target or exception slot.
  const opaqueSlots = new Set<number>();
  for (const id of loop.body) {
    const block = fn.blocks[id];
    if (block === undefined) return { fn: undefined, visited };
    const blockEx = block.exception;
    if (blockEx !== undefined) opaqueSlots.add(blockEx.slot);
    const term = block.terminator;
    if (
      (term.kind === "record" ||
        term.kind === "record-cell" ||
        term.kind === "cell") &&
      term.operation === "read"
    )
      opaqueSlots.add(term.slot);
  }
  // Identify read-alias slots of `targetSlot` and builder slots by fixed point.
  // A slot C != targetSlot is a read-alias slot if every store to C in the loop
  // comes from `targetSlot` / read-alias values (and C is not opaque).
  // A slot B != targetSlot is a builder slot for builder k if every store to B
  // in the loop comes from builder k values (and B is not opaque).
  const readAliasSlots = new Set<number>();
  readAliasSlots.add(targetSlot);
  const readAliasValues = new Set<number>();
  // First, check which allocations can reach `store targetSlot = ...`.
  // Trace each allocation forward through copies/wraps/unwraps inside the loop.
  const builderList: {
    readonly allocBlock: number;
    readonly allocOp: Instruction & { readonly kind: "record-new" };
    readonly slots: Set<number>;
    readonly values: Set<number>;
    feedsTarget: boolean;
  }[] = [];
  for (const alloc of allocOps) {
    if (alloc === undefined) continue;
    const bSlots = new Set<number>(),
      bValues = new Set<number>();
    bValues.add(alloc.op.id);
    let feedsTarget = false;
    let changed = true;
    while (changed) {
      changed = false;
      for (const id of loop.body) {
        const block = fn.blocks[id];
        if (block === undefined) return { fn: undefined, visited };
        for (const op of block.instructions) {
          if (op === undefined) throw "loop record instruction invariant";
          if (++visited > budget) return undefined;
          if (op.kind === "load" && bSlots.has(op.slot)) {
            if (!bValues.has(op.id)) {
              bValues.add(op.id);
              changed = true;
            }
          } else if (
            ((op.kind === "reference-value" && op.type === undefined) ||
              op.kind === "reference-wrap" ||
              op.kind === "general-wrap" ||
              (op.kind === "general-value" && op.type === "reference")) &&
            bValues.has(op.value)
          ) {
            if (!bValues.has(op.id)) {
              bValues.add(op.id);
              changed = true;
            }
          } else if (op.kind === "store" && bValues.has(op.value)) {
            if (op.slot === targetSlot) feedsTarget = true;
            else if (!opaqueSlots.has(op.slot) && !bSlots.has(op.slot)) {
              bSlots.add(op.slot);
              changed = true;
            }
          }
        }
      }
    }
    if (feedsTarget)
      builderList.push({
        allocBlock: alloc.block,
        allocOp: alloc.op,
        slots: bSlots,
        values: bValues,
        feedsTarget,
      });
  }
  if (builderList.length === 0) return miss("no allocation feeds target slot");
  // Ensure builder slots are disjoint across builders and only ever written by
  // their own builder inside the loop.
  for (let k = 0; k < builderList.length; k++) {
    const b = builderList[k];
    if (b === undefined) continue;
    for (const s of b.slots) {
      if (slotOwnerBuilder.has(s))
        return miss("shared builder slot s" + String(s));
      slotOwnerBuilder.set(s, k);
      allBuilderSlots.add(s);
    }
    allocToBuilder.set(b.allocOp.id, k);
    builders.push({
      allocBlock: b.allocBlock,
      allocOp: b.allocOp,
      slots: b.slots,
      values: b.values,
    });
  }
  for (const id of loop.body) {
    const block = fn.blocks[id];
    if (block === undefined) return { fn: undefined, visited };
    for (const op of block.instructions) {
      if (op === undefined) throw "loop record instruction invariant";
      if (++visited > budget) return undefined;
      if (op.kind === "store") {
        const owner = slotOwnerBuilder.get(op.slot);
        if (owner !== undefined) {
          const b = builders[owner];
          if (b === undefined || !b.values.has(op.value))
            return miss("builder slot s" + String(op.slot) + " overwritten");
        }
      }
    }
  }
  // Trace read-alias values and slots starting from `targetSlot`.
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of loop.body) {
      const block = fn.blocks[id];
      if (block === undefined) return { fn: undefined, visited };
      for (const op of block.instructions) {
        if (op === undefined) throw "loop record instruction invariant";
        if (++visited > budget) return undefined;
        if (op.kind === "load" && readAliasSlots.has(op.slot)) {
          if (!readAliasValues.has(op.id)) {
            readAliasValues.add(op.id);
            changed = true;
          }
        } else if (
          ((op.kind === "reference-value" && op.type === undefined) ||
            op.kind === "reference-wrap" ||
            op.kind === "general-wrap" ||
            (op.kind === "general-value" && op.type === "reference")) &&
          readAliasValues.has(op.value)
        ) {
          if (!readAliasValues.has(op.id)) {
            readAliasValues.add(op.id);
            changed = true;
          }
        } else if (op.kind === "store" && readAliasValues.has(op.value)) {
          if (allBuilderSlots.has(op.slot)) return { fn: undefined, visited };
          if (!opaqueSlots.has(op.slot) && !readAliasSlots.has(op.slot)) {
            readAliasSlots.add(op.slot);
            changed = true;
          }
        }
      }
    }
  }
  // Every store to a non-target read-alias slot inside the loop must store a
  // read-alias value (cannot mix with another object or reference-none).
  // Every store to `targetSlot` inside the loop must store either a builder
  // value or a read-alias value.
  for (const id of loop.body) {
    const block = fn.blocks[id];
    if (block === undefined) return { fn: undefined, visited };
    for (const op of block.instructions) {
      if (op === undefined) throw "loop record instruction invariant";
      if (++visited > budget) return undefined;
      if (op.kind === "store") {
        if (op.slot === targetSlot) {
          let fromBuilder = false;
          for (const b of builders)
            if (b !== undefined && b.values.has(op.value)) {
              fromBuilder = true;
              break;
            }
          if (!fromBuilder && !readAliasValues.has(op.value))
            return miss("non-builder store to target slot");
        } else if (readAliasSlots.has(op.slot)) {
          if (!readAliasValues.has(op.value))
            return miss("read-alias slot s" + String(op.slot) + " overwritten");
        }
      }
    }
  }
  // Validate every builder allocation's fields and check for non-escaping uses.
  const builderOfValue = new Map<number, number>();
  for (let k = 0; k < builders.length; k++) {
    const b = builders[k];
    if (b === undefined) continue;
    for (const v of b.values) builderOfValue.set(v, k);
    // Presence fields must be absent in record-new.
    for (let f = 0; f < layout.fields.length; f++) {
      const field = layout.fields[f];
      if (field === undefined) return { fn: undefined, visited };
      if (field.presenceOffset !== undefined) {
        if (
          b.allocOp.arguments[f] !== undefined ||
          b.allocOp.presence?.[f] !== undefined
        )
          return { fn: undefined, visited };
      } else if (b.allocOp.arguments[f] === undefined) {
        // An uninitialized non-presence field is allowed only if its type has
        // a safe default slot initializer (for must-init) AND it is written
        // before any commit to targetSlot (verified below).
        if (defaultInstructionFor(0, field.type, 0, 0) === undefined)
          return { fn: undefined, visited };
      }
    }
  }
  // Check every instruction and terminator inside the loop for escaping uses
  // of either `readAliasValues` or `builderOfValue`.
  let anyPresenceRead = false;
  const builderWrittenFields: Set<number>[] = builders.map(
    () => new Set<number>(),
  );
  const directReturnsOfTarget: number[] = [];
  for (const id of loop.body) {
    const block = fn.blocks[id];
    if (block === undefined) return { fn: undefined, visited };
    for (const op of block.instructions) {
      if (op === undefined) throw "loop record instruction invariant";
      if (++visited > budget) return undefined;
      if (
        (op.kind === "reference-value" && op.type === undefined) ||
        op.kind === "reference-wrap" ||
        op.kind === "general-wrap" ||
        (op.kind === "general-value" && op.type === "reference")
      ) {
        if (readAliasValues.has(op.value) || builderOfValue.has(op.value))
          continue;
      }
      if (op.kind === "general-is" && op.type === "object") {
        if (readAliasValues.has(op.value) || builderOfValue.has(op.value))
          continue;
      }
      if (op.kind === "store") {
        if (
          (readAliasSlots.has(op.slot) &&
            (readAliasValues.has(op.value) ||
              (op.slot === targetSlot && builderOfValue.has(op.value)))) ||
          (slotOwnerBuilder.has(op.slot) &&
            builderOfValue.get(op.value) === slotOwnerBuilder.get(op.slot))
        )
          continue;
      }
      if (op.kind === "record-read" && op.record === record) {
        if (readAliasValues.has(op.object)) {
          const field = layout.fields[op.field];
          if (field === undefined || field.presenceOffset !== undefined)
            return { fn: undefined, visited };
          continue;
        }
        const bIdx = builderOfValue.get(op.object);
        if (bIdx !== undefined) {
          const field = layout.fields[op.field];
          if (field === undefined || field.presenceOffset !== undefined)
            return { fn: undefined, visited };
          continue;
        }
      }
      if (op.kind === "record-has" && op.record === record) {
        if (readAliasValues.has(op.object)) {
          if (layout.fields[op.field]?.presenceOffset !== undefined)
            anyPresenceRead = true;
          continue;
        }
      }
      let escaped = false;
      visitInstructionOperands(op, (operand) => {
        if (readAliasValues.has(operand) || builderOfValue.has(operand))
          escaped = true;
      });
      if (escaped) return miss("escaped in " + op.kind + " at b" + String(id));
    }
    const term = block.terminator;
    if (term.kind === "record") {
      if (readAliasValues.has(term.object)) {
        if (term.record === record) {
          if (term.operation !== "read")
            return miss("mutated in place at b" + String(id));
          const field = layout.fields[term.field];
          if (field === undefined) return { fn: undefined, visited };
          if (field.presenceOffset !== undefined) anyPresenceRead = true;
        }
        continue;
      }
      const bIdx = builderOfValue.get(term.object);
      if (bIdx !== undefined) {
        if (term.record === record) {
          const field = layout.fields[term.field];
          if (
            field === undefined ||
            field.presenceOffset !== undefined ||
            term.operation === "delete"
          )
            return miss("unsupported builder record op at b" + String(id));
          if (term.operation === "write")
            builderWrittenFields[bIdx]?.add(term.field);
        }
        continue;
      }
    } else if (term.kind === "return") {
      const retValue = term.value;
      if (retValue !== undefined) {
        if (readAliasValues.has(retValue)) {
          directReturnsOfTarget.push(id);
          continue;
        }
        if (builderOfValue.has(retValue))
          return miss("builder returned directly");
      }
    }
    let escaped = false;
    visitTerminatorOperands(term, (operand) => {
      if (readAliasValues.has(operand) || builderOfValue.has(operand))
        escaped = true;
    });
    if (escaped)
      return miss("escaped in terminator " + term.kind + " at b" + String(id));
  }
  // Verify that for every builder with `null` non-presence arguments in
  // `record-new`, every path from `allocBlock` to a `store targetSlot = builder`
  // writes every such field (simple forward must-write dataflow on loop.body).
  for (let k = 0; k < builders.length; k++) {
    const b = builders[k];
    if (b === undefined) continue;
    const needed: number[] = [];
    for (let f = 0; f < layout.fields.length; f++) {
      const field = layout.fields[f];
      if (
        field !== undefined &&
        field.presenceOffset === undefined &&
        b.allocOp.arguments[f] === undefined
      )
        needed.push(f);
    }
    if (needed.length === 0) continue;
    let requiredMask = 0;
    for (const f of needed) requiredMask |= 1 << f;
    // Must-written bitmask at entry to each block in loop.body (starting at 0
    // right after allocOp in allocBlock).
    const inMask = new Map<number, number>();
    const pending: number[] = [b.allocBlock];
    const inQueue = new Set<number>();
    inQueue.add(b.allocBlock);
    inMask.set(b.allocBlock, 0);
    while (pending.length > 0) {
      const bid = pending.pop();
      if (bid === undefined) break;
      inQueue.delete(bid);
      const blk = fn.blocks[bid];
      if (blk === undefined) return { fn: undefined, visited };
      let mask = inMask.get(bid) ?? 0;
      for (const op of blk.instructions) {
        if (op === undefined) continue;
        if (op === b.allocOp) mask = 0;
        else if (
          op.kind === "store" &&
          op.slot === targetSlot &&
          b.values.has(op.value)
        ) {
          if ((mask & requiredMask) !== requiredMask)
            return miss("builder field not proven written before commit");
        }
      }
      const term = blk.terminator;
      let consMask = mask;
      if (
        term.kind === "record" &&
        term.record === record &&
        term.operation === "write" &&
        b.values.has(term.object)
      )
        consMask = mask | (1 << term.field);
      const pushEdge = (target: number, edgeMask: number): void => {
        if (!loop.body.has(target)) return;
        const prev = inMask.get(target);
        const next = prev === undefined ? edgeMask : prev & edgeMask;
        if (prev === undefined || next !== prev) {
          inMask.set(target, next);
          if (!inQueue.has(target)) {
            inQueue.add(target);
            pending.push(target);
          }
        }
      };
      if (term.kind === "jump") pushEdge(term.target, mask);
      else if (term.kind === "branch") {
        pushEdge(term.consequent, mask);
        pushEdge(term.alternate, mask);
      } else if (
        term.kind === "record" ||
        term.kind === "record-cell" ||
        term.kind === "cell"
      ) {
        pushEdge(term.consequent, consMask);
        pushEdge(term.alternate, mask);
      }
      const blkEx = blk.exception;
      if (blkEx !== undefined) pushEdge(blkEx.target, mask);
    }
  }
  // Liveness check at every loop exit (normal and exceptional):
  // - No non-target read-alias slot or builder slot may be live at any exit.
  // - Record which exit targets need `targetSlot` materialized.
  const trackedSlots: number[] = [targetSlot];
  for (const s of readAliasSlots) if (s !== targetSlot) trackedSlots.push(s);
  for (const s of allBuilderSlots) trackedSlots.push(s);
  const live = analyzeLiveSlots(fn, budget - visited, trackedSlots);
  if (live === undefined) return undefined;
  visited += live.work;
  const liveTargetExits = new Set<number>();
  for (const id of loop.body) {
    const block = fn.blocks[id];
    if (block === undefined) return { fn: undefined, visited };
    const exitTargets: number[] = [];
    for (const succ of blockSuccessors(block))
      if (succ !== undefined && !loop.body.has(succ)) exitTargets.push(succ);
    const exitEx = block.exception;
    if (exitEx !== undefined && !loop.body.has(exitEx.target))
      exitTargets.push(exitEx.target);
    for (const exit of exitTargets) {
      const liveHere = live.slots[exit] ?? [];
      for (const s of liveHere) {
        if (s === targetSlot) liveTargetExits.add(exit);
        else if (s !== undefined)
          return miss(
            "alias/builder slot s" +
              String(s) +
              " live at exit b" +
              String(exit),
          );
      }
    }
  }
  // Check that any non-presence fields that might be read in preheader for
  // presence-offset fields have safe default initializers.
  for (const field of layout.fields) {
    if (
      field !== undefined &&
      field.presenceOffset !== undefined &&
      defaultInstructionFor(0, field.type, 0, 0) === undefined
    )
      return { fn: undefined, visited };
  }
  // --- Rewrite! ---
  const slots: ScalarType[] = fn.slots.slice();
  const fieldSlots: number[] = [];
  const presenceSlots: (number | undefined)[] = [];
  for (const field of layout.fields) {
    if (field === undefined) throw "loop record field invariant";
    fieldSlots.push(slots.length);
    slots.push(field.type);
    if (field.presenceOffset !== undefined) {
      if (anyPresenceRead) {
        presenceSlots.push(slots.length);
        slots.push("boolean");
      } else presenceSlots.push(undefined);
    } else presenceSlots.push(undefined);
  }
  const dirtySlot = slots.length;
  slots.push("boolean");
  // Allocate per-builder field slots (only when a builder actually exists;
  // direct record-new with no separate builder writes can share one temp set).
  const builderFieldSlots: number[][] = [];
  for (let k = 0; k < builders.length; k++) {
    const bSlots: number[] = [];
    for (const field of layout.fields) {
      if (field === undefined) throw "loop record field invariant";
      if (field.presenceOffset !== undefined) {
        bSlots.push(-1);
      } else {
        bSlots.push(slots.length);
        slots.push(field.type);
      }
    }
    builderFieldSlots.push(bSlots);
  }
  const blocks: Block[] = fn.blocks.slice();
  let nextValue = nextValueStart;
  const newBlock = (block: Block): number => {
    const id = blocks.length;
    blocks.push({ ...block, id });
    return id;
  };
  let trapBlock = -1;
  const trap = (): number => {
    if (trapBlock < 0)
      trapBlock = newBlock({
        id: 0,
        instructions: [],
        terminator: { kind: "trap", start: 0, end: 0 },
      });
    return trapBlock;
  };
  // 1. Preheader: read `targetSlot`'s fields into `fieldSlots`, presence flags
  // into `presenceSlots`, set `dirtySlot = false`, and end with a fresh plain
  // jump preheader targeting `loop.header`.
  {
    const pre = blocks[preheaderId];
    if (pre === undefined) throw "loop record preheader invariant";
    const startInsts: Instruction[] = pre.instructions.slice();
    const dirtyFalse = nextValue++;
    startInsts.push(
      { kind: "constant", id: dirtyFalse, value: false, start: 0, end: 0 },
      { kind: "store", slot: dirtySlot, value: dirtyFalse, start: 0, end: 0 },
    );
    // Chain checked record reads for every non-presence field (and record-has
    // + guarded read for any presence field if read).
    let curBlockId = preheaderId;
    let curInsts = startInsts;
    for (let f = 0; f < layout.fields.length; f++) {
      const field = layout.fields[f],
        fSlot = fieldSlots[f];
      if (field === undefined || fSlot === undefined)
        throw "loop record field invariant";
      if (field.presenceOffset !== undefined) {
        const pSlot = presenceSlots[f];
        const def = defaultInstructionFor(nextValue++, field.type, 0, 0);
        if (def === undefined) throw "loop record default invariant";
        const defId = instructionResult(def);
        if (defId === undefined) throw "loop record default id invariant";
        curInsts.push(def, {
          kind: "store",
          slot: fSlot,
          value: defId,
          start: 0,
          end: 0,
        });
        if (pSlot !== undefined) {
          const obj = nextValue++,
            has = nextValue++;
          curInsts.push(
            { kind: "load", id: obj, slot: targetSlot, start: 0, end: 0 },
            {
              kind: "record-has",
              id: has,
              object: obj,
              record,
              field: f,
              start: 0,
              end: 0,
            },
            { kind: "store", slot: pSlot, value: has, start: 0, end: 0 },
          );
          // When present, read the field into fSlot before continuing.
          const readBlk = newBlock({
            id: 0,
            instructions: [],
            terminator: { kind: "trap", start: 0, end: 0 },
          });
          const nextBlk = newBlock({
            id: 0,
            instructions: [],
            terminator: { kind: "trap", start: 0, end: 0 },
          });
          const obj2 = nextValue++;
          blocks[readBlk] = {
            id: readBlk,
            instructions: [
              { kind: "load", id: obj2, slot: targetSlot, start: 0, end: 0 },
            ],
            terminator: {
              kind: "record",
              object: obj2,
              record,
              field: f,
              operation: "read",
              slot: fSlot,
              consequent: nextBlk,
              alternate: trap(),
              start: 0,
              end: 0,
            },
          };
          blocks[curBlockId] = {
            id: curBlockId,
            instructions: curInsts,
            terminator: {
              kind: "branch",
              condition: has,
              consequent: readBlk,
              alternate: nextBlk,
              start: 0,
              end: 0,
            },
          };
          curBlockId = nextBlk;
          curInsts = [];
        }
        continue;
      }
      const nextBlk = newBlock({
        id: 0,
        instructions: [],
        terminator: { kind: "trap", start: 0, end: 0 },
      });
      const obj = nextValue++;
      curInsts.push({
        kind: "load",
        id: obj,
        slot: targetSlot,
        start: 0,
        end: 0,
      });
      blocks[curBlockId] = {
        id: curBlockId,
        instructions: curInsts,
        terminator: {
          kind: "record",
          object: obj,
          record,
          field: f,
          operation: "read",
          slot: fSlot,
          consequent: nextBlk,
          alternate: trap(),
          start: 0,
          end: 0,
        },
      };
      curBlockId = nextBlk;
      curInsts = [];
    }
    blocks[curBlockId] = {
      id: curBlockId,
      instructions: curInsts,
      terminator: { kind: "jump", target: loop.header, start: 0, end: 0 },
    };
  }
  // 2. Exit materialization blocks: per exit target where `targetSlot` is live,
  // check `dirtySlot`; if true, allocate `record-new record` from `fieldSlots`
  // and store into `targetSlot`; then jump to `target`.
  const exitMaterializers = new Map<number, number>();
  const materialize = (target: number): number => {
    const existing = exitMaterializers.get(target);
    if (existing !== undefined) return existing;
    const allocInsts: Instruction[] = [];
    const args: (number | undefined)[] = [];
    for (let f = 0; f < layout.fields.length; f++) {
      const field = layout.fields[f],
        fSlot = fieldSlots[f];
      if (field === undefined || fSlot === undefined)
        throw "loop record field invariant";
      if (field.presenceOffset !== undefined) {
        args.push(undefined);
      } else {
        const val = nextValue++;
        allocInsts.push({
          kind: "load",
          id: val,
          slot: fSlot,
          start: 0,
          end: 0,
        });
        args.push(val);
      }
    }
    const obj = nextValue++;
    allocInsts.push({
      kind: "record-new",
      id: obj,
      record,
      arguments: args,
      start: 0,
      end: 0,
    });
    allocInsts.push({
      kind: "store",
      slot: targetSlot,
      value: obj,
      start: 0,
      end: 0,
    });
    const allocBlk = newBlock({
      id: 0,
      instructions: allocInsts,
      terminator: { kind: "jump", target, start: 0, end: 0 },
    });
    const dirty = nextValue++;
    const checkBlk = newBlock({
      id: 0,
      instructions: [
        { kind: "load", id: dirty, slot: dirtySlot, start: 0, end: 0 },
      ],
      terminator: {
        kind: "branch",
        condition: dirty,
        consequent: allocBlk,
        alternate: target,
        start: 0,
        end: 0,
      },
    });
    exitMaterializers.set(target, checkBlk);
    return checkBlk;
  };
  const retarget = (target: number): number =>
    !loop.body.has(target) && liveTargetExits.has(target)
      ? materialize(target)
      : target;
  // 3. Rewrite loop body blocks.
  for (const id of loop.body) {
    const block = blocks[id];
    if (block === undefined) throw "loop record block invariant";
    const instructions: Instruction[] = [];
    for (const op of block.instructions) {
      if (op === undefined) throw "loop record instruction invariant";
      // Drop dead loads/wraps/unwraps/stores of pure alias & builder slots
      // (their only remaining uses are rewritten below).
      if (op.kind === "record-new") {
        const bIdx = allocToBuilder.get(op.id);
        if (bIdx !== undefined) {
          const bSlots = builderFieldSlots[bIdx];
          if (bSlots === undefined) throw "loop record builder slot invariant";
          for (let f = 0; f < layout.fields.length; f++) {
            const field = layout.fields[f],
              bSlot = bSlots[f];
            if (field === undefined || bSlot === undefined || bSlot < 0)
              continue;
            const arg = op.arguments[f];
            if (arg !== undefined) {
              instructions.push({
                kind: "store",
                slot: bSlot,
                value: arg,
                start: op.start,
                end: op.end,
              });
            } else {
              const def = defaultInstructionFor(
                nextValue++,
                field.type,
                op.start,
                op.end,
              );
              if (def === undefined) throw "loop record default invariant";
              const defId = instructionResult(def);
              if (defId === undefined) throw "loop record default id invariant";
              instructions.push(def, {
                kind: "store",
                slot: bSlot,
                value: defId,
                start: op.start,
                end: op.end,
              });
            }
          }
          continue;
        }
      }
      if (op.kind === "load") {
        if (readAliasValues.has(op.id) || builderOfValue.has(op.id)) continue;
      }
      if (
        (op.kind === "reference-value" && op.type === undefined) ||
        op.kind === "reference-wrap" ||
        op.kind === "general-wrap" ||
        (op.kind === "general-value" && op.type === "reference")
      ) {
        if (readAliasValues.has(op.id) || builderOfValue.has(op.id)) continue;
      }
      if (
        op.kind === "general-is" &&
        op.type === "object" &&
        (readAliasValues.has(op.value) || builderOfValue.has(op.value))
      ) {
        instructions.push({
          kind: "constant",
          id: op.id,
          value: true,
          start: op.start,
          end: op.end,
        });
        continue;
      }
      if (op.kind === "store") {
        if (op.slot === targetSlot) {
          const bIdx = builderOfValue.get(op.value);
          if (bIdx !== undefined) {
            const bSlots = builderFieldSlots[bIdx];
            if (bSlots === undefined)
              throw "loop record builder slot invariant";
            for (let f = 0; f < layout.fields.length; f++) {
              const field = layout.fields[f],
                fSlot = fieldSlots[f],
                bSlot = bSlots[f];
              if (field === undefined || fSlot === undefined)
                throw "loop record field invariant";
              if (field.presenceOffset !== undefined) {
                const pSlot = presenceSlots[f];
                if (pSlot !== undefined) {
                  const fls = nextValue++;
                  instructions.push(
                    {
                      kind: "constant",
                      id: fls,
                      value: false,
                      start: op.start,
                      end: op.end,
                    },
                    {
                      kind: "store",
                      slot: pSlot,
                      value: fls,
                      start: op.start,
                      end: op.end,
                    },
                  );
                }
              } else if (bSlot !== undefined && bSlot >= 0) {
                const tmp = nextValue++;
                instructions.push(
                  {
                    kind: "load",
                    id: tmp,
                    slot: bSlot,
                    start: op.start,
                    end: op.end,
                  },
                  {
                    kind: "store",
                    slot: fSlot,
                    value: tmp,
                    start: op.start,
                    end: op.end,
                  },
                );
              }
            }
            const tr = nextValue++;
            instructions.push(
              {
                kind: "constant",
                id: tr,
                value: true,
                start: op.start,
                end: op.end,
              },
              {
                kind: "store",
                slot: dirtySlot,
                value: tr,
                start: op.start,
                end: op.end,
              },
            );
            continue;
          }
          if (readAliasValues.has(op.value)) continue;
        } else if (
          readAliasSlots.has(op.slot) ||
          slotOwnerBuilder.has(op.slot)
        ) {
          continue;
        }
      }
      if (op.kind === "record-read" && op.record === record) {
        if (readAliasValues.has(op.object)) {
          const fSlot = fieldSlots[op.field];
          if (fSlot === undefined) throw "loop record field slot invariant";
          instructions.push({
            kind: "load",
            id: op.id,
            slot: fSlot,
            start: op.start,
            end: op.end,
          });
          continue;
        }
        const bIdx = builderOfValue.get(op.object);
        if (bIdx !== undefined) {
          const bSlot = builderFieldSlots[bIdx]?.[op.field];
          if (bSlot === undefined || bSlot < 0)
            throw "loop record builder field slot invariant";
          instructions.push({
            kind: "load",
            id: op.id,
            slot: bSlot,
            start: op.start,
            end: op.end,
          });
          continue;
        }
      }
      if (
        op.kind === "record-has" &&
        op.record === record &&
        readAliasValues.has(op.object)
      ) {
        const pSlot = presenceSlots[op.field];
        if (pSlot !== undefined)
          instructions.push({
            kind: "load",
            id: op.id,
            slot: pSlot,
            start: op.start,
            end: op.end,
          });
        else
          instructions.push({
            kind: "constant",
            id: op.id,
            value: true,
            start: op.start,
            end: op.end,
          });
        continue;
      }
      instructions.push(op);
    }
    let term: Terminator = block.terminator;
    if (term.kind === "record" && readAliasValues.has(term.object)) {
      if (term.record !== record) {
        term = {
          kind: "jump",
          target: retarget(term.alternate),
          start: term.start,
          end: term.end,
        };
      } else {
        const fSlot = fieldSlots[term.field],
          pSlot = presenceSlots[term.field];
        if (fSlot === undefined) throw "loop record field slot invariant";
        if (pSlot !== undefined) {
          const pres = nextValue++,
            val = nextValue++;
          instructions.push({
            kind: "load",
            id: pres,
            slot: pSlot,
            start: term.start,
            end: term.end,
          });
          const hit = newBlock({
            id: 0,
            instructions: [
              {
                kind: "load",
                id: val,
                slot: fSlot,
                start: term.start,
                end: term.end,
              },
              {
                kind: "store",
                slot: term.slot,
                value: val,
                start: term.start,
                end: term.end,
              },
            ],
            terminator: {
              kind: "jump",
              target: retarget(term.consequent),
              start: term.start,
              end: term.end,
            },
          });
          term = {
            kind: "branch",
            condition: pres,
            consequent: hit,
            alternate: retarget(term.alternate),
            start: term.start,
            end: term.end,
          };
        } else {
          const val = nextValue++;
          instructions.push(
            {
              kind: "load",
              id: val,
              slot: fSlot,
              start: term.start,
              end: term.end,
            },
            {
              kind: "store",
              slot: term.slot,
              value: val,
              start: term.start,
              end: term.end,
            },
          );
          term = {
            kind: "jump",
            target: retarget(term.consequent),
            start: term.start,
            end: term.end,
          };
        }
      }
    } else if (term.kind === "record" && builderOfValue.has(term.object)) {
      const bIdx = builderOfValue.get(term.object);
      if (bIdx === undefined) throw "loop record builder invariant";
      if (term.record !== record) {
        term = {
          kind: "jump",
          target: retarget(term.alternate),
          start: term.start,
          end: term.end,
        };
      } else {
        const bSlot = builderFieldSlots[bIdx]?.[term.field];
        if (bSlot === undefined || bSlot < 0)
          throw "loop record builder field invariant";
        const val = nextValue++;
        if (term.operation === "read") {
          instructions.push(
            {
              kind: "load",
              id: val,
              slot: bSlot,
              start: term.start,
              end: term.end,
            },
            {
              kind: "store",
              slot: term.slot,
              value: val,
              start: term.start,
              end: term.end,
            },
          );
        } else {
          instructions.push(
            {
              kind: "load",
              id: val,
              slot: term.slot,
              start: term.start,
              end: term.end,
            },
            {
              kind: "store",
              slot: bSlot,
              value: val,
              start: term.start,
              end: term.end,
            },
          );
        }
        term = {
          kind: "jump",
          target: retarget(term.consequent),
          start: term.start,
          end: term.end,
        };
      }
    } else if (
      term.kind === "return" &&
      term.value !== undefined &&
      directReturnsOfTarget.includes(id)
    ) {
      const reloaded = nextValue++;
      const retBlk = newBlock({
        id: 0,
        instructions: [
          {
            kind: "load",
            id: reloaded,
            slot: targetSlot,
            start: term.start,
            end: term.end,
          },
        ],
        terminator: {
          kind: "return",
          value: reloaded,
          start: term.start,
          end: term.end,
        },
      });
      term = {
        kind: "jump",
        target: materialize(retBlk),
        start: term.start,
        end: term.end,
      };
    } else if (term.kind === "jump") {
      const target = retarget(term.target);
      if (target !== term.target) term = { ...term, target };
    } else if (
      term.kind === "branch" ||
      term.kind === "record" ||
      term.kind === "record-cell" ||
      term.kind === "cell"
    ) {
      const consequent = retarget(term.consequent),
        alternate = retarget(term.alternate);
      if (consequent !== term.consequent || alternate !== term.alternate)
        term = { ...term, consequent, alternate };
    }
    const handler = block.exception;
    const nextHandler =
      handler !== undefined &&
      !loop.body.has(handler.target) &&
      liveTargetExits.has(handler.target)
        ? { ...handler, target: materialize(handler.target) }
        : handler;
    blocks[id] =
      nextHandler === undefined
        ? { ...block, instructions, terminator: term }
        : { ...block, instructions, terminator: term, exception: nextHandler };
  }
  const compacted = compactReachableBlocks(
    { ...fn, slots },
    blocks,
    budget - visited,
  );
  if (compacted === undefined) return undefined;
  visited += compacted.visited;
  const candidateDebug =
    compacted.fn.debug === undefined
      ? undefined
      : retainDebugValues(compacted.fn, compacted.fn.blocks);
  const candidate: FunctionIR =
    candidateDebug === undefined
      ? compacted.fn
      : { ...compacted.fn, debug: candidateDebug };
  if (!recordReadsKept(fn, candidate)) {
    if (remarks !== undefined)
      remarks({
        pass: "scalarize-loop-records",
        outcome: "missed",
        function: fn.name,
        start: fn.blocks[loop.header]?.terminator.start ?? 0,
        end: fn.blocks[loop.header]?.terminator.end ?? 0,
        message:
          "loop-carried s" +
          String(targetSlot) +
          " (r" +
          String(record) +
          ") kept: record read proofs would drop",
      });
    return { fn: undefined, visited };
  }
  if (remarks !== undefined)
    remarks({
      pass: "scalarize-loop-records",
      outcome: "applied",
      function: fn.name,
      start: fn.blocks[loop.header]?.terminator.start ?? 0,
      end: fn.blocks[loop.header]?.terminator.end ?? 0,
      message:
        "loop-carried s" +
        String(targetSlot) +
        " (r" +
        String(record) +
        ") scalarized across " +
        String(layout.fields.length) +
        " fields",
    });
  return { fn: candidate, visited };
}
