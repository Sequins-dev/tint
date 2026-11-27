import {
  blockSuccessors,
  effectInvoke,
  instructionEffects,
  instructionMayThrow,
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
    case "string-two-byte":
      return "boolean";
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
 * checked read moves only when every path entering the loop body from its
 * header must reach that block without exiting, looping back, or throwing
 * first — keeping union-dispatch later layouts (including through bridge
 * blocks) and branch-guarded checks conditional.
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
  const formatterCache = new Map<number, boolean>();
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
      predecessors,
      slots,
      module,
      fn,
      () => nextValue++,
      () => nextBlock++,
      budget - visited,
      proofs,
      formatterCache,
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
  unconditional: boolean,
  objectInvariant: boolean,
  trappingFailure: boolean,
  field: RecordField | undefined,
): string {
  if (field === undefined) return "unknown field";
  if (field.mutable) return "field is mutable";
  if (!objectInvariant) return "object is not loop invariant";
  if (!trappingFailure) return "failed check does not trap";
  if (!unconditional)
    return "not executed unconditionally on every loop iteration";
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
  readonly unknownProven: boolean;
  /** False when moving any check cost a direct read its proof. */
  readonly readHoists: boolean;
}
/** Whether entering `loop`'s body from `loop.header` must reach `targetId`
 * along acyclic, non-throwing paths before returning to `loop.header`,
 * leaving `loop.body`, or terminating. Keeps conditional checks (later union
 * layouts behind direct or bridged failure edges, branch-guarded checks, and
 * checks after early exits or throwing calls) inside the loop. */
function mustReachBeforeExit(
  loop: NaturalLoop,
  targetId: number,
  byId: ReadonlyMap<number, Block>,
  allowThrow: boolean = false,
): boolean {
  if (targetId === loop.header) return true;
  const header = byId.get(loop.header);
  if (header === undefined) return false;
  // 1 = active on current DFS path (cycle avoiding targetId fails);
  // 2 = every path from this block reaches targetId before exit or header.
  const state = new Map<number, number>();
  const stack: number[] = [];
  let entered = false;
  for (const next of blockSuccessors(header)) {
    if (next === undefined || !loop.body.has(next)) continue;
    entered = true;
    if (next === targetId) continue;
    if (next === loop.header) return false;
    if (state.get(next) === undefined) stack.push(next);
  }
  if (!entered) return false;
  while (stack.length > 0) {
    const top = stack.pop();
    if (top === undefined) break;
    if (top < 0) {
      state.set(-top - 1, 2);
      continue;
    }
    const seen = state.get(top);
    if (seen === 2) continue;
    if (seen === 1) return false;
    const block = byId.get(top);
    if (block === undefined) return false;
    if (!allowThrow)
      for (const op of block.instructions)
        if (op !== undefined && instructionMayThrow(op)) return false;
    const successors = blockSuccessors(block);
    if (successors.length === 0) return false;
    state.set(top, 1);
    stack.push(-top - 1);
    for (const next of successors) {
      if (next === undefined || next === targetId) continue;
      if (next === loop.header || !loop.body.has(next)) return false;
      const nextState = state.get(next);
      if (nextState === 1) return false;
      if (nextState === undefined) stack.push(next);
    }
  }
  return true;
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
  for (const block of fn.blocks) {
    if (block === undefined) throw "licm block invariant";
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
  return { provenOrigins, unknownProven, readHoists };
}

/** Whether `fn` directly contains a `number-string-cache` instruction. */
function containsNumberStringCache(fn: FunctionIR): boolean {
  for (const block of fn.blocks) {
    if (block === undefined) continue;
    for (const op of block.instructions)
      if (op !== undefined && op.kind === "number-string-cache") return true;
  }
  return false;
}
/** Whether `target` is the runtime's pure number-to-string formatter: takes
 * one number, returns a string, and populates the internal number-string cache
 * (`number-string-cache`, directly or through its 1-hop cache wrapper), with
 * no user-visible side effects. */
function isNumberFormatter(
  module: ModuleIR,
  target: number,
  cache: Map<number, boolean>,
): boolean {
  const cached = cache.get(target);
  if (cached !== undefined) return cached;
  let result = false;
  const callee = module.functions.find(
    (item) => item !== undefined && item.id === target,
  );
  if (
    callee !== undefined &&
    callee.import !== true &&
    callee.parameters.length === 1 &&
    callee.returnType === "string"
  ) {
    const param = callee.parameters[0];
    if (param !== undefined && callee.slots[param] === "number") {
      if (containsNumberStringCache(callee)) {
        result = true;
      } else {
        for (const block of callee.blocks) {
          if (block === undefined) continue;
          for (const op of block.instructions) {
            if (op === undefined || op.kind !== "call") continue;
            const helper = module.functions.find(
              (item) => item !== undefined && item.id === op.target,
            );
            if (
              helper !== undefined &&
              helper.import !== true &&
              containsNumberStringCache(helper)
            ) {
              result = true;
              break;
            }
          }
          if (result) break;
        }
      }
    }
  }
  cache.set(target, result);
  return result;
}
/** A loop-invariant `number-string-cached` lookup plus its miss-call block
 * (`stringOperand` lowering for numbers) that can move as one diamond to the
 * loop preheader. */
interface NumberStringDiamond {
  readonly numId: number;
  readonly cachedIndex: number;
  readonly storeIndex: number;
  readonly lengthIndex: number;
  readonly condIndex: number;
  readonly resultSlot: number;
  readonly target: number;
  readonly missBlockId: number;
  readonly doneBlockId: number;
  readonly start: number;
  readonly end: number;
}
function matchNumberStringDiamond(
  block: Block,
  term: Terminator,
  loop: NaturalLoop,
  byId: ReadonlyMap<number, Block>,
  predecessors: ReadonlyMap<number, readonly number[]>,
  invariant: ReadonlyMap<number, Instruction>,
  module: ModuleIR,
  formatterCache: Map<number, boolean>,
): NumberStringDiamond | undefined {
  if (block.exception !== undefined || term.kind !== "branch") return undefined;
  const missId = term.consequent,
    doneId = term.alternate;
  if (missId === loop.header || !loop.body.has(missId)) return undefined;
  const missPreds = predecessors.get(missId);
  if (missPreds === undefined || missPreds.length !== 1) return undefined;
  const missBlock = byId.get(missId);
  if (
    missBlock === undefined ||
    missBlock.exception !== undefined ||
    missBlock.instructions.length !== 3
  )
    return undefined;
  const missTerm = missBlock.terminator;
  if (missTerm.kind !== "jump" || missTerm.target !== doneId) return undefined;
  const m0 = missBlock.instructions[0],
    m1 = missBlock.instructions[1],
    m2 = missBlock.instructions[2];
  if (
    m0 === undefined ||
    m0.kind !== "load" ||
    m1 === undefined ||
    m1.kind !== "call" ||
    m1.id === undefined ||
    m1.arguments.length !== 1 ||
    m1.arguments[0] !== m0.id ||
    m2 === undefined ||
    m2.kind !== "store" ||
    m2.value !== m1.id
  )
    return undefined;
  if (!isNumberFormatter(module, m1.target, formatterCache)) return undefined;
  const argSlot = m0.slot,
    resultSlot = m2.slot;
  const ops = block.instructions;
  const uses = new Map<number, number>();
  const countUse = (value: number): void => {
    uses.set(value, (uses.get(value) ?? 0) + 1);
  };
  for (const op of ops)
    if (op !== undefined) visitInstructionOperands(op, countUse);
  visitTerminatorOperands(term, countUse);
  let condIndex = -1;
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (op !== undefined && instructionResult(op) === term.condition)
      condIndex = i;
  }
  if (condIndex < 0) return undefined;
  const condOp = ops[condIndex];
  if (
    condOp === undefined ||
    condOp.kind !== "binary" ||
    condOp.operator !== "===" ||
    uses.get(condOp.id) !== 1
  )
    return undefined;
  let lengthIndex = -1,
    zeroIndex = -1;
  for (let i = 0; i < condIndex; i++) {
    const op = ops[i];
    if (op === undefined) continue;
    const id = instructionResult(op);
    if (id === condOp.left || id === condOp.right) {
      if (op.kind === "string-length") lengthIndex = i;
      else if (op.kind === "constant" && op.value === 0) zeroIndex = i;
    }
  }
  if (lengthIndex < 0 || zeroIndex < 0) return undefined;
  const lengthOp = ops[lengthIndex];
  if (
    lengthOp === undefined ||
    lengthOp.kind !== "string-length" ||
    uses.get(lengthOp.id) !== 1
  )
    return undefined;
  const cachedId = lengthOp.string;
  let cachedIndex = -1,
    storeIndex = -1;
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (op === undefined) continue;
    if (op.kind === "number-string-cached" && op.id === cachedId)
      cachedIndex = i;
    else if (op.kind === "store" && op.slot === resultSlot) {
      if (op.value === cachedId && i > cachedIndex) storeIndex = i;
      else if (storeIndex >= 0) return undefined;
    }
  }
  if (cachedIndex < 0 || storeIndex < 0 || uses.get(cachedId) !== 2)
    return undefined;
  const cachedOp = ops[cachedIndex];
  if (cachedOp === undefined || cachedOp.kind !== "number-string-cached")
    return undefined;
  const numId = cachedOp.value;
  const numDef = invariant.get(numId);
  if (numDef === undefined) return undefined;
  // Confirm `missBlock`'s `argSlot` holds the exact same invariant number.
  let argMatches = numDef.kind === "load" && numDef.slot === argSlot;
  if (!argMatches) {
    let lastStoreValue: number | undefined;
    for (const op of ops)
      if (op !== undefined && op.kind === "store" && op.slot === argSlot)
        lastStoreValue = op.value;
    argMatches = lastStoreValue === numId;
  }
  if (!argMatches) return undefined;
  if (!mustReachBeforeExit(loop, block.id, byId, true)) return undefined;
  return {
    numId,
    cachedIndex,
    storeIndex,
    lengthIndex,
    condIndex,
    resultSlot,
    target: m1.target,
    missBlockId: missId,
    doneBlockId: doneId,
    start: cachedOp.start,
    end: cachedOp.end,
  };
}

function hoistLoop(
  loop: NaturalLoop,
  preheader: Block,
  byId: ReadonlyMap<number, Block>,
  predecessors: ReadonlyMap<number, readonly number[]>,
  slots: ScalarType[],
  module: ModuleIR,
  fn: FunctionIR,
  newValue: () => number,
  newBlock: () => number,
  budget: number,
  proofs: RecordProof,
  formatterCache: Map<number, boolean>,
  remarks: RemarkSink | undefined,
): LoopMotion | undefined {
  let visited = 0;
  // Instructions appended to the preheader, and the value each moved
  // (original) value has there.
  const preheaderCode: Instruction[] = [];
  let preheaderTerminator: Terminator = preheader.terminator;
  const added: Block[] = [];
  const blocks: Block[] = [];
  const repurposed = new Map<number, Block>();
  let hoisted = 0,
    readHoisted = false,
    preheaderSplit = false;
  const { provenOrigins, unknownProven, readHoists } = proofs;
  let lengthsChange = false;
  for (const id of loop.body) {
    const block = byId.get(id);
    if (block === undefined) throw "licm block invariant";
    for (const op of block.instructions)
      if (op !== undefined && changesArrayLength(op)) lengthsChange = true;
  }
  for (const id of loop.body) {
    if (repurposed.has(id)) continue;
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
      const trappingFailure =
        failure !== undefined &&
        failure.instructions.length === 0 &&
        failure.terminator.kind === "trap";
      const eligible =
        readHoists &&
        !preheaderSplit &&
        !readHoisted &&
        !unknownProven &&
        objectOrigin !== undefined &&
        !provenOrigins.has(objectOrigin) &&
        invariant.has(term.object) &&
        trappingFailure &&
        field !== undefined &&
        !field.mutable;
      const unconditional =
        eligible || remarks !== undefined
          ? mustReachBeforeExit(loop, block.id, byId)
          : false;
      readHoist = eligible && unconditional;
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
              unconditional,
              invariant.has(term.object),
              trappingFailure,
              field,
            ),
        });
    }
    const diamond =
      !readHoist && !preheaderSplit
        ? matchNumberStringDiamond(
            block,
            term,
            loop,
            byId,
            predecessors,
            invariant,
            module,
            formatterCache,
          )
        : undefined;
    // Uses outside the invariant set: roots to carry in slots.
    const uses = new Set<number>();
    for (let i = 0; i < block.instructions.length; i++) {
      const op = block.instructions[i];
      if (op === undefined) throw "licm instruction invariant";
      if (
        diamond !== undefined &&
        (i === diamond.cachedIndex ||
          i === diamond.storeIndex ||
          i === diamond.lengthIndex ||
          i === diamond.condIndex)
      )
        continue;
      const result = instructionResult(op);
      if (result !== undefined && invariant.has(result)) continue;
      visitInstructionOperands(op, (operand: number): void => {
        uses.add(operand);
      });
    }
    if (!readHoist && diamond === undefined)
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
    if (roots.length === 0 && !readHoist && diamond === undefined) {
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
      preheaderSplit = true;
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
    let hoistedStringSlot: number | undefined;
    if (diamond !== undefined) {
      preheaderSplit = true;
      hoistedStringSlot = slots.length;
      slots.push("string");
      const numValue = clone(diamond.numId);
      const numDef = invariant.get(diamond.numId);
      let preheaderArgSlot: number;
      if (numDef !== undefined && numDef.kind === "load") {
        preheaderArgSlot = numDef.slot;
      } else {
        preheaderArgSlot = slots.length;
        slots.push("number");
        preheaderCode.push({
          kind: "store",
          slot: preheaderArgSlot,
          value: numValue,
          start: diamond.start,
          end: diamond.end,
        });
      }
      const cached = newValue(),
        length = newValue(),
        zero = newValue(),
        missCond = newValue();
      preheaderCode.push(
        {
          kind: "number-string-cached",
          id: cached,
          value: numValue,
          start: diamond.start,
          end: diamond.end,
        },
        {
          kind: "store",
          slot: hoistedStringSlot,
          value: cached,
          start: diamond.start,
          end: diamond.end,
        },
        {
          kind: "string-length",
          id: length,
          string: cached,
          start: diamond.start,
          end: diamond.end,
        },
        {
          kind: "constant",
          id: zero,
          value: 0,
          start: diamond.start,
          end: diamond.end,
        },
        {
          kind: "binary",
          id: missCond,
          operator: "===",
          left: length,
          right: zero,
          start: diamond.start,
          end: diamond.end,
        },
      );
      // Reuse the old in-loop miss block's ID for the preheader miss block so
      // block IDs remain dense without renumbering.
      const preheaderMiss = diamond.missBlockId,
        continuation = newBlock();
      const missArg = newValue(),
        missFormatted = newValue();
      repurposed.set(preheaderMiss, {
        id: preheaderMiss,
        instructions: [
          {
            kind: "load",
            id: missArg,
            slot: preheaderArgSlot,
            start: diamond.start,
            end: diamond.end,
          },
          {
            kind: "call",
            id: missFormatted,
            target: diamond.target,
            arguments: [missArg],
            start: diamond.start,
            end: diamond.end,
          },
          {
            kind: "store",
            slot: hoistedStringSlot,
            value: missFormatted,
            start: diamond.start,
            end: diamond.end,
          },
        ],
        terminator: {
          kind: "jump",
          target: continuation,
          start: diamond.start,
          end: diamond.end,
        },
      });
      added.push({
        id: continuation,
        instructions: [],
        terminator: preheaderTerminator,
      });
      preheaderTerminator = {
        kind: "branch",
        condition: missCond,
        consequent: preheaderMiss,
        alternate: continuation,
        start: diamond.start,
        end: diamond.end,
      };
      hoisted++;
      if (remarks !== undefined)
        remarks({
          pass: "hoist-loop-invariants",
          outcome: "applied",
          function: fn.name,
          start: diamond.start,
          end: diamond.end,
          message:
            "hoisted number-string-cached conversion out of loop b" +
            String(loop.header) +
            " to preheader b" +
            String(preheader.id),
        });
    }
    // The block: roots become loads of their slots; other invariant pure
    // operations they fed are dropped (their loads and constants are left
    // to dead-scalar cleanup); a hoisted read becomes a slot copy.
    // Keep every operation the block still needs, transitively (backwards):
    // non-invariant operations, and invariant ones whose values a kept
    // operation or the terminator uses. Roots become loads of their slots.
    const needed = new Set<number>();
    if (!readHoist && diamond === undefined)
      visitTerminatorOperands(term, (operand) => {
        needed.add(operand);
      });
    const keep: boolean[] = [];
    for (let i = block.instructions.length - 1; i >= 0; i--) {
      const op = block.instructions[i];
      if (op === undefined) throw "licm instruction invariant";
      if (
        diamond !== undefined &&
        (i === diamond.cachedIndex ||
          i === diamond.lengthIndex ||
          i === diamond.condIndex)
      ) {
        keep[i] = false;
        continue;
      }
      if (diamond !== undefined && i === diamond.storeIndex) {
        keep[i] = true;
        continue;
      }
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
      if (
        diamond !== undefined &&
        hoistedStringSlot !== undefined &&
        i === diamond.storeIndex
      ) {
        const loaded = newValue();
        instructions.push(
          {
            kind: "load",
            id: loaded,
            slot: hoistedStringSlot,
            start: op.start,
            end: op.end,
          },
          {
            kind: "store",
            slot: diamond.resultSlot,
            value: loaded,
            start: op.start,
            end: op.end,
          },
        );
        continue;
      }
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
    } else if (diamond !== undefined) {
      terminator = {
        kind: "jump",
        target: diamond.doneBlockId,
        start: term.start,
        end: term.end,
      };
    }
    blocks.push({ ...block, instructions, terminator });
  }
  if (hoisted === 0) return { blocks: [], added: [], hoisted: 0, visited };
  for (const [, block] of repurposed) blocks.push(block);
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
    case "string-two-byte":
      return { ...op, id, string: at(op.string) };
    case "function-environment":
      return { ...op, id, callee: at(op.callee) };
    case "reference-value":
      return { ...op, id, value: at(op.value) };
    default:
      throw "licm rename invariant";
  }
}
