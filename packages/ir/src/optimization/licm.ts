import {
  blockSuccessors,
  effectInvoke,
  instructionEffects,
  instructionResult,
  naturalLoops,
  recordReadsKept,
  visitInstructionOperands,
  visitTerminatorOperands,
  type Block,
  type FunctionIR,
  type Instruction,
  type ModuleIR,
  type NaturalLoop,
  type RecordField,
  type ScalarType,
  type Terminator,
} from "../scalar/index.ts";
import type { OptimizationRemark, RemarkSink } from "./observer.ts";

export interface InvariantMotion {
  readonly fn: FunctionIR;
  readonly visited: number;
  /** Values (and checked reads) moved to loop preheaders. */
  readonly hoisted: number;
  /** Rounds redone without moving checked reads (a visible fallback). */
  readonly redone: number;
}

/** The result type of a pure operation LICM may move, or undefined. */
function pureType(op: Instruction): ScalarType | undefined {
  switch (op.kind) {
    case "binary":
      return ["===", "!==", "==", "!=", "<", ">", "<=", ">="].includes(
        op.operator,
      )
        ? "boolean"
        : "number";
    case "unary":
      return op.operator === "!" ||
        op.operator === "truthy" ||
        op.operator === "is-integer"
        ? "boolean"
        : "number";
    case "array-length":
    case "string-length":
      return "number";
    case "function-environment":
      return "optional-reference";
    case "reference-value":
      return "reference";
    default:
      return undefined;
  }
}

/** Whether `op` may change a native typed array's length: code it runs may
 * detach a typed view of a realm ArrayBuffer (its length becomes 0), and C
 * memory adoption or retargeting rewrites an array's header. */
function changesArrayLength(op: Instruction): boolean {
  if (op.kind === "c-call") return op.call.mayCallback === true;
  if (op.kind === "c-memory")
    return (
      op.access.operation === "adopt" ||
      op.access.operation === "adopt-words" ||
      op.access.operation === "retarget"
    );
  return (instructionEffects(op) & effectInvoke) !== 0;
}
/** Loop-invariant code motion over the scalar IR. Within each natural loop
 * that has a unique preheader (its only outside predecessor, ending in an
 * unconditional jump), operations whose operands are loop invariant
 * (constants, loads of slots the loop never writes, other invariant
 * operations) move to the preheader:
 *
 * - pure, non-trapping operations (arithmetic and comparisons, string
 *   lengths, which never change, typed-array lengths in loops where nothing
 *   changes one (changesArrayLength), and function environments);
 * - checked reads of immutable record fields (`record` terminators whose
 *   failure edge traps): the check still runs, once, before the loop.
 *
 * Values used in the loop are carried in fresh slots. Moved operations are
 * speculative only in executing when the loop body would not; none has an
 * effect, and a check that would trap in the body traps in the preheader. A
 * check entered on another check's failure edge (a later layout of a union
 * dispatch) stays: its trap is conditional on that earlier failure.
 * Repeated rounds lift computations out of nested loops. A direct record
 * read in the loop may rest on a moved check through slot copies the origin
 * test does not follow (as after inlining): a round that leaves any verified
 * read unproven is redone without moving checked reads. */
export function hoistLoopInvariants(
  fn: FunctionIR,
  module: ModuleIR,
  budget: number,
  remarks?: RemarkSink,
): InvariantMotion | undefined {
  let visited = 0,
    hoisted = 0,
    redone = 0,
    current = fn;
  for (let round = 0; round < 8; round++) {
    // Remarks wait for the round that is kept.
    const pending: OptimizationRemark[] = [];
    const sink: RemarkSink | undefined =
      remarks === undefined
        ? undefined
        : (remark) => {
            pending.push(remark);
          };
    let result = hoistRound(current, module, budget - visited, sink, true);
    if (result === undefined) return undefined;
    visited += result.visited;
    if (result.hoisted === 0) {
      flush(pending, remarks);
      break;
    }
    if (!recordReadsKept(current, result.fn)) {
      redone++;
      pending.length = 0;
      if (remarks !== undefined)
        pending.push({
          pass: "hoist-loop-invariants",
          outcome: "missed",
          function: fn.name,
          start: 0,
          end: 0,
          message:
            "round " +
            String(round + 1) +
            " redone without moving checked reads: a moved check left a direct record read unproven",
        });
      result = hoistRound(current, module, budget - visited, sink, false);
      if (result === undefined) return undefined;
      visited += result.visited;
      if (result.hoisted === 0 || !recordReadsKept(current, result.fn)) {
        flush(pending, remarks);
        break;
      }
    }
    flush(pending, remarks);
    hoisted += result.hoisted;
    current = result.fn;
  }
  return { fn: current, visited, hoisted, redone };
}
function flush(
  pending: readonly OptimizationRemark[],
  remarks: RemarkSink | undefined,
): void {
  if (remarks === undefined) return;
  const sink: RemarkSink = remarks;
  for (const remark of pending) if (remark !== undefined) sink(remark);
}

/** One LICM round over every loop. */
interface RoundMotion {
  readonly fn: FunctionIR;
  readonly visited: number;
  readonly hoisted: number;
}
function hoistRound(
  fn: FunctionIR,
  module: ModuleIR,
  budget: number,
  remarks: RemarkSink | undefined,
  /** Whether checked reads may move (see hoistLoopInvariants). */
  readHoists: boolean,
): RoundMotion | undefined {
  const forest = naturalLoops(fn, budget);
  if (forest === undefined) return undefined;
  let visited = forest.visited;
  if (forest.loops.length === 0) return { fn, visited, hoisted: 0 };
  const byId = new Map<number, Block>();
  let nextValue = 0,
    nextBlock = 0;
  for (const block of fn.blocks) {
    if (block === undefined) throw "licm block invariant";
    byId.set(block.id, block);
    if (block.id >= nextBlock) nextBlock = block.id + 1;
    for (const op of block.instructions) {
      if (op === undefined) throw "licm instruction invariant";
      const id = instructionResult(op);
      if (id !== undefined && id >= nextValue) nextValue = id + 1;
    }
  }
  const predecessors = new Map<number, number[]>();
  for (const block of fn.blocks) {
    if (block === undefined) throw "licm block invariant";
    for (const target of blockSuccessors(block)) {
      if (target === undefined) throw "licm successor invariant";
      const list = predecessors.get(target);
      if (list === undefined) predecessors.set(target, [block.id]);
      else list.push(block.id);
    }
  }
  const slots: ScalarType[] = fn.slots.slice();
  const replaced = new Map<number, Block>(),
    added: Block[] = [];
  let hoisted = 0;
  // Loops whose blocks another loop already rewrote this round wait for the
  // next round (they would see stale block contents).
  const touched = new Set<number>();
  let recordProof: RecordProof | undefined;
  for (const loop of forest.loops) {
    if (loop === undefined) throw "licm loop invariant";
    let stale = false;
    for (const id of loop.body) if (touched.has(id)) stale = true;
    const outside = (predecessors.get(loop.header) ?? []).filter(
      (id) => id !== undefined && !loop.body.has(id),
    );
    const preheaderId = outside[0];
    if (outside.length !== 1 || preheaderId === undefined) {
      if (remarks !== undefined)
        missedLoop(
          remarks,
          fn,
          byId.get(loop.header),
          String(outside.length) +
            " entering predecessors (needs exactly one preheader)",
        );
      continue;
    }
    const preheader = byId.get(preheaderId);
    if (stale || touched.has(preheaderId)) continue;
    if (
      preheader === undefined ||
      preheader.terminator.kind !== "jump" ||
      preheader.exception !== undefined
    ) {
      if (remarks !== undefined)
        missedLoop(
          remarks,
          fn,
          byId.get(loop.header),
          "the preheader does not end in a plain jump",
        );
      continue;
    }
    // `naturalLoops` groups DFS back-edge cycles without checking dominance.
    // A hoisted slot stored in `preheader` is initialized at every block in
    // `loop.body` only when `preheader` strictly dominates the whole body, and
    // hoisting an invariant load into `preheader` requires every body block to
    // be reachable from `loop.header` inside `loop.body`.
    let irreducible = loop.body.has(fn.entry);
    if (!irreducible) {
      for (const id of loop.body) {
        if (id === loop.header) continue;
        for (const from of predecessors.get(id) ?? []) {
          if (from !== undefined && !loop.body.has(from)) {
            irreducible = true;
            break;
          }
        }
        if (irreducible) break;
      }
    }
    if (!irreducible) {
      const seen = new Set<number>();
      seen.add(loop.header);
      const queue: number[] = [loop.header];
      for (let cursor = 0; cursor < queue.length; cursor++) {
        const id = queue[cursor];
        if (id === undefined) continue;
        const block = byId.get(id);
        if (block === undefined) continue;
        for (const next of blockSuccessors(block)) {
          if (next !== undefined && loop.body.has(next) && !seen.has(next)) {
            seen.add(next);
            queue.push(next);
          }
        }
      }
      if (seen.size !== loop.body.size) irreducible = true;
    }
    if (irreducible) {
      if (remarks !== undefined)
        missedLoop(
          remarks,
          fn,
          byId.get(loop.header),
          "loop is irreducible (non-header entry or unreachable body block)",
        );
      continue;
    }
    // This round reads the original function for every loop. Recompute the
    // proof summary only after committing a round that rewrites it.
    const proofs = recordProof ?? recordProofs(fn, readHoists);
    recordProof = proofs;
    const motion = hoistLoop(
      loop,
      preheader,
      byId,
      slots,
      module,
      fn,
      () => nextValue++,
      () => nextBlock++,
      budget - visited,
      proofs,
      remarks,
    );
    if (motion === undefined) return undefined;
    visited += motion.visited;
    if (motion.hoisted === 0) continue;
    hoisted += motion.hoisted;
    for (const block of motion.blocks) {
      if (block === undefined) throw "licm block invariant";
      replaced.set(block.id, block);
      touched.add(block.id);
    }
    for (const id of loop.body) touched.add(id);
    touched.add(preheaderId);
    for (const block of motion.added) {
      if (block === undefined) throw "licm block invariant";
      added.push(block);
    }
  }
  if (hoisted === 0) return { fn, visited, hoisted: 0 };
  const blocks: Block[] = [];
  for (const block of fn.blocks) {
    if (block === undefined) throw "licm block invariant";
    blocks.push(replaced.get(block.id) ?? block);
  }
  for (const block of added) {
    if (block === undefined) throw "licm block invariant";
    blocks.push(block);
  }
  return { fn: { ...fn, slots, blocks }, visited, hoisted };
}

interface LoopMotion {
  readonly blocks: readonly Block[];
  readonly added: readonly Block[];
  readonly hoisted: number;
  readonly visited: number;
}

/** A loop LICM declined as a whole, at its header's terminator. */
function missedLoop(
  remarks: RemarkSink,
  fn: FunctionIR,
  header: Block | undefined,
  reason: string,
): void {
  remarks({
    pass: "hoist-loop-invariants",
    outcome: "missed",
    function: fn.name,
    start: header === undefined ? 0 : header.terminator.start,
    end: header === undefined ? 0 : header.terminator.end,
    message:
      "loop at b" +
      (header === undefined ? "?" : String(header.id)) +
      " not optimized: " +
      reason,
  });
}
/** Why a checked record read in a loop stays there (remarks only). */
function readHoistRefusal(
  readHoists: boolean,
  readHoisted: boolean,
  unknownProven: boolean,
  originKnown: boolean,
  originProven: boolean,
  afterFailedCheck: boolean,
  objectInvariant: boolean,
  trappingFailure: boolean,
  field: RecordField | undefined,
): string {
  if (field === undefined) return "unknown field";
  if (field.mutable) return "field is mutable";
  if (!objectInvariant) return "object is not loop invariant";
  if (!trappingFailure) return "failed check does not trap";
  if (afterFailedCheck) return "reached only when another check fails";
  if (!readHoists)
    return "moving a check would leave a direct read in the function unproven";
  if (readHoisted) return "one read already hoisted from this loop";
  if (unknownProven || !originKnown)
    return "object origin unknown to the layout proofs";
  if (originProven)
    return "an unchecked access relies on this check's layout proof";
  return "not selected";
}
interface RecordProof {
  readonly provenOrigins: ReadonlySet<number>;
  readonly failureTargets: ReadonlySet<number>;
  readonly unknownProven: boolean;
  /** False when moving any check cost a direct read its proof. */
  readonly readHoists: boolean;
}
// The slot a block-local value derives from (through unwraps and
// environment reads), which identifies the object a record access uses.
function recordObjectOrigin(block: Block, value: number): number | undefined {
  let current = value;
  for (let depth = 0; depth < 8; depth++) {
    let definition: Instruction | undefined;
    for (const op of block.instructions)
      if (op !== undefined && instructionResult(op) === current)
        definition = op;
    if (definition === undefined) return undefined;
    if (definition.kind === "load") return definition.slot;
    if (definition.kind === "reference-value") current = definition.value;
    else if (definition.kind === "function-environment")
      current = definition.callee;
    else return undefined;
  }
  return undefined;
}
function constructedIn(block: Block, value: number): boolean {
  for (const op of block.instructions)
    if (op !== undefined && op.kind === "record-new" && op.id === value)
      return true;
  return false;
}
/** The slot whose value a stored value copies (through reference unwraps
 * and wraps), as the verifier's layout trace follows slot stores. Looks up
 * the block's definitions so far. */
function copiedSlot(
  definitions: ReadonlyMap<number, Instruction>,
  value: number,
): number | undefined {
  let current = value;
  for (let depth = 0; depth < 8; depth++) {
    const definition = definitions.get(current);
    if (definition === undefined) return undefined;
    if (definition.kind === "load") return definition.slot;
    if (
      definition.kind === "reference-value" ||
      definition.kind === "reference-wrap"
    )
      current = definition.value;
    else return undefined;
  }
  return undefined;
}
function recordProofs(fn: FunctionIR, readHoists: boolean): RecordProof {
  // Objects of unchecked record operations anywhere in the function, whose
  // layout proof may rest on a checked read in the loop: such reads stay in
  // place. A proof traces its object's slot back through stores of copied
  // slots, so every slot such a slot copies (transitively) counts too.
  const provenOrigins = new Set<number>();
  // Slot -> the slots stored into it as copies.
  const copies = new Map<number, number[]>();
  let unknownProven = false;
  // Blocks entered on the failure edge of another check, such as the later
  // layouts of a union dispatch: they run only when that check failed, so a
  // trap there is not implied by the object's type and must not move ahead
  // of the earlier check.
  const failureTargets = new Set<number>();
  for (const block of fn.blocks) {
    if (block === undefined) throw "licm block invariant";
    const exit = block.terminator;
    if (
      exit.kind === "record" ||
      exit.kind === "record-cell" ||
      exit.kind === "cell"
    )
      failureTargets.add(exit.alternate);
    const definitions = new Map<number, Instruction>();
    for (const op of block.instructions) {
      if (op === undefined) continue;
      const result = instructionResult(op);
      if (result !== undefined) definitions.set(result, op);
      if (op.kind === "record-read" || op.kind === "record-has") {
        const slot = recordObjectOrigin(block, op.object);
        if (slot !== undefined) provenOrigins.add(slot);
        // An object constructed in the same block has its layout from the
        // construction, not from any check a hoist could move.
        else if (!constructedIn(block, op.object)) unknownProven = true;
      } else if (op.kind === "store") {
        const source = copiedSlot(definitions, op.value);
        if (source !== undefined && source !== op.slot) {
          const sources = copies.get(op.slot);
          if (sources === undefined) copies.set(op.slot, [source]);
          else sources.push(source);
        }
      }
    }
  }
  const pending: number[] = [];
  for (const slot of provenOrigins) pending.push(slot);
  while (pending.length > 0) {
    const slot = pending.pop();
    if (slot === undefined) break;
    for (const source of copies.get(slot) ?? [])
      if (source !== undefined && !provenOrigins.has(source)) {
        provenOrigins.add(source);
        pending.push(source);
      }
  }
  return { provenOrigins, failureTargets, unknownProven, readHoists };
}

function hoistLoop(
  loop: NaturalLoop,
  preheader: Block,
  byId: ReadonlyMap<number, Block>,
  slots: ScalarType[],
  module: ModuleIR,
  fn: FunctionIR,
  newValue: () => number,
  newBlock: () => number,
  budget: number,
  proofs: RecordProof,
  remarks: RemarkSink | undefined,
): LoopMotion | undefined {
  let visited = 0;
  // Instructions appended to the preheader, and the value each moved
  // (original) value has there.
  const preheaderCode: Instruction[] = [];
  let preheaderTerminator: Terminator = preheader.terminator;
  const added: Block[] = [];
  const blocks: Block[] = [];
  let hoisted = 0,
    readHoisted = false;
  const { provenOrigins, failureTargets, unknownProven, readHoists } = proofs;
  let lengthsChange = false;
  for (const id of loop.body) {
    const block = byId.get(id);
    if (block === undefined) throw "licm block invariant";
    for (const op of block.instructions)
      if (op !== undefined && changesArrayLength(op)) lengthsChange = true;
  }
  for (const id of loop.body) {
    const block = byId.get(id);
    if (block === undefined) throw "licm block invariant";
    // Invariant values of this block: original id -> definition.
    const invariant = new Map<number, Instruction>(),
      moved = new Map<number, number>();
    const operandsInvariant = (op: Instruction): boolean => {
      let ok = true;
      visitInstructionOperands(op, (operand: number): void => {
        if (!invariant.has(operand)) ok = false;
      });
      return ok;
    };
    for (const op of block.instructions) {
      if (op === undefined) throw "licm instruction invariant";
      if (visited >= budget) return undefined;
      visited++;
      if (op.kind === "constant") invariant.set(op.id, op);
      else if (op.kind === "load" && !loop.writes.has(op.slot))
        invariant.set(op.id, op);
      else if (
        pureType(op) !== undefined &&
        (op.kind !== "array-length" || !lengthsChange) &&
        operandsInvariant(op) &&
        // A reference unwrap's payload type is known for environments.
        (op.kind !== "reference-value" ||
          invariant.get(op.value)?.kind === "function-environment")
      ) {
        const result = instructionResult(op);
        if (result !== undefined) invariant.set(result, op);
      }
    }
    // A checked read of an immutable field of an invariant object.
    const term = block.terminator;
    let readHoist = false;
    if (term.kind === "record" && term.operation === "read") {
      const failure = byId.get(term.alternate);
      const field = module.records?.[term.record]?.fields[term.field];
      const objectOrigin = recordObjectOrigin(block, term.object);
      readHoist =
        readHoists &&
        !readHoisted &&
        !unknownProven &&
        !failureTargets.has(block.id) &&
        objectOrigin !== undefined &&
        !provenOrigins.has(objectOrigin) &&
        invariant.has(term.object) &&
        failure !== undefined &&
        failure.instructions.length === 0 &&
        failure.terminator.kind === "trap" &&
        field !== undefined &&
        !field.mutable;
      if (!readHoist && remarks !== undefined)
        remarks({
          pass: "hoist-loop-invariants",
          outcome: "missed",
          function: fn.name,
          start: term.start,
          end: term.end,
          message:
            "record read r" +
            String(term.record) +
            ".f" +
            String(term.field) +
            " stays in loop b" +
            String(loop.header) +
            ": " +
            readHoistRefusal(
              readHoists,
              readHoisted,
              unknownProven,
              objectOrigin !== undefined,
              objectOrigin !== undefined && provenOrigins.has(objectOrigin),
              failureTargets.has(block.id),
              invariant.has(term.object),
              failure !== undefined &&
                failure.instructions.length === 0 &&
                failure.terminator.kind === "trap",
              field,
            ),
        });
    }
    // Uses outside the invariant set: roots to carry in slots.
    const uses = new Set<number>();
    for (const op of block.instructions) {
      if (op === undefined) throw "licm instruction invariant";
      const result = instructionResult(op);
      if (result !== undefined && invariant.has(result)) continue;
      visitInstructionOperands(op, (operand: number): void => {
        uses.add(operand);
      });
    }
    if (!readHoist)
      visitTerminatorOperands(term, (operand: number): void => {
        uses.add(operand);
      });
    const roots: number[] = [];
    // Only scalar values travel through slots: record layout proofs follow
    // references through their definitions, not through fresh slots.
    for (const [value, op] of invariant) {
      const type = pureType(op);
      if (
        uses.has(value) &&
        op.kind !== "constant" &&
        op.kind !== "load" &&
        (type === "number" || type === "boolean")
      )
        roots.push(value);
    }
    if (roots.length === 0 && !readHoist) {
      blocks.push(block);
      continue;
    }
    // Clone the invariant computation into the preheader (in order).
    const clone: (value: number) => number = (value: number): number => {
      const existing = moved.get(value);
      if (existing !== undefined) return existing;
      const op = invariant.get(value);
      if (op === undefined) throw "licm clone invariant";
      const operands: number[] = [];
      visitInstructionOperands(op, (operand: number): void => {
        operands.push(operand);
      });
      const remap = new Map<number, number>();
      for (const operand of operands)
        if (operand !== undefined) remap.set(operand, clone(operand));
      const fresh = newValue();
      preheaderCode.push(renamed(op, fresh, remap));
      moved.set(value, fresh);
      return fresh;
    };
    const carried = new Map<number, number>();
    for (const root of roots) {
      if (root === undefined) throw "licm root invariant";
      const op = invariant.get(root);
      const type = op === undefined ? undefined : pureType(op);
      if (type === undefined) throw "licm type invariant";
      const slot = slots.length;
      slots.push(type);
      preheaderCode.push({
        kind: "store",
        slot,
        value: clone(root),
        start: preheader.terminator.start,
        end: preheader.terminator.end,
      });
      carried.set(root, slot);
      hoisted++;
      if (remarks !== undefined && op !== undefined)
        remarks({
          pass: "hoist-loop-invariants",
          outcome: "applied",
          function: fn.name,
          start: op.start,
          end: op.end,
          message:
            "hoisted " +
            op.kind +
            " v" +
            String(root) +
            " out of loop b" +
            String(loop.header) +
            " to preheader b" +
            String(preheader.id),
        });
    }
    let readSlot: number | undefined;
    if (readHoist && term.kind === "record") {
      readHoisted = true;
      // The read's destination type, carried in a fresh slot.
      const type = fn.slots[term.slot];
      if (type === undefined) throw "licm read slot invariant";
      readSlot = slots.length;
      slots.push(type);
      const object = clone(term.object);
      const continuation = newBlock();
      added.push({
        id: continuation,
        instructions: [],
        terminator: preheaderTerminator,
      });
      preheaderTerminator = {
        kind: "record",
        object,
        record: term.record,
        field: term.field,
        operation: "read",
        slot: readSlot,
        consequent: continuation,
        alternate: term.alternate,
        start: term.start,
        end: term.end,
      };
      hoisted++;
      if (remarks !== undefined)
        remarks({
          pass: "hoist-loop-invariants",
          outcome: "applied",
          function: fn.name,
          start: term.start,
          end: term.end,
          message:
            "hoisted checked read of immutable field r" +
            String(term.record) +
            ".f" +
            String(term.field) +
            " out of loop b" +
            String(loop.header),
        });
    }
    // The block: roots become loads of their slots; other invariant pure
    // operations they fed are dropped (their loads and constants are left
    // to dead-scalar cleanup); a hoisted read becomes a slot copy.
    // Keep every operation the block still needs, transitively (backwards):
    // non-invariant operations, and invariant ones whose values a kept
    // operation or the terminator uses. Roots become loads of their slots.
    const needed = new Set<number>();
    if (!readHoist)
      visitTerminatorOperands(term, (operand) => {
        needed.add(operand);
      });
    const keep: boolean[] = [];
    for (let i = block.instructions.length - 1; i >= 0; i--) {
      const op = block.instructions[i];
      if (op === undefined) throw "licm instruction invariant";
      const result = instructionResult(op);
      const isRoot = result !== undefined && carried.has(result);
      const droppable =
        result !== undefined &&
        invariant.has(result) &&
        pureType(op) !== undefined &&
        !needed.has(result);
      const kept = isRoot || !droppable;
      keep[i] = kept;
      if (kept && !isRoot)
        visitInstructionOperands(op, (operand: number): void => {
          needed.add(operand);
        });
    }
    const instructions: Instruction[] = [];
    for (let i = 0; i < block.instructions.length; i++) {
      const op = block.instructions[i];
      if (op === undefined) throw "licm instruction invariant";
      if (keep[i] !== true) continue;
      const result = instructionResult(op);
      const slot = result === undefined ? undefined : carried.get(result);
      if (result !== undefined && slot !== undefined) {
        instructions.push({
          kind: "load",
          id: result,
          slot,
          start: op.start,
          end: op.end,
        });
        continue;
      }
      instructions.push(op);
    }
    let terminator: Terminator = term;
    if (readSlot !== undefined && term.kind === "record") {
      const value = newValue();
      instructions.push({
        kind: "load",
        id: value,
        slot: readSlot,
        start: term.start,
        end: term.end,
      });
      instructions.push({
        kind: "store",
        slot: term.slot,
        value,
        start: term.start,
        end: term.end,
      });
      terminator = {
        kind: "jump",
        target: term.consequent,
        start: term.start,
        end: term.end,
      };
    }
    blocks.push({ ...block, instructions, terminator });
  }
  if (hoisted === 0) return { blocks: [], added: [], hoisted: 0, visited };
  const preheaderInstructions = preheader.instructions.slice();
  for (const op of preheaderCode) {
    if (op === undefined) throw "licm instruction invariant";
    preheaderInstructions.push(op);
  }
  blocks.push({
    ...preheader,
    instructions: preheaderInstructions,
    terminator: preheaderTerminator,
  });
  return { blocks, added, hoisted, visited };
}

/** `op` defining `id`, with operands renamed by `remap`. */
function renamed(
  op: Instruction,
  id: number,
  remap: ReadonlyMap<number, number>,
): Instruction {
  const at = (value: number): number => remap.get(value) ?? value;
  switch (op.kind) {
    case "constant":
      return { ...op, id };
    case "load":
      return { ...op, id };
    case "binary":
      return { ...op, id, left: at(op.left), right: at(op.right) };
    case "unary":
      return { ...op, id, operand: at(op.operand) };
    case "array-length":
      return { ...op, id, array: at(op.array) };
    case "string-length":
      return { ...op, id, string: at(op.string) };
    case "function-environment":
      return { ...op, id, callee: at(op.callee) };
    case "reference-value":
      return { ...op, id, value: at(op.value) };
    default:
      throw "licm rename invariant";
  }
}
