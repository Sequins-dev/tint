import {
  analyzeLiveSlots,
  instructionResult,
  naturalLoops,
  provenInductionWords,
  recordReadsKept,
  retainDebugValues,
  substituteInstructionValues,
  substituteTerminatorValues,
  renumberInstructionResult,
  visitInstructionOperands,
  visitTerminatorOperands,
  type Block,
  type FunctionIR,
  type Instruction,
  type NaturalLoop,
  type ScalarType,
  type SlotBinding,
  type Terminator,
} from "../scalar/index.ts";
import { compactReachableBlocks, hasScriptOperations } from "./control-flow.ts";
import type { RemarkSink } from "./observer.ts";

export interface CountedLoopBounds {
  readonly fn: FunctionIR;
  readonly visited: number;
  /** Loops whose header now compares against a word bound. */
  readonly bounded: number;
}

/** Most instructions a bounded loop may have: its cold copy doubles them. */
const maxBoundedInstructions = 2000;
/** The largest uint32: a bound above it takes the cold copy. */
const maxWordBound = 4294967295;

/** Word bounds for counted loops with unknown bounds. A loop whose header
 * branches into its body on `i < b`, where the number slot `i` holds a
 * uint32 constant `s` on loop entry and steps by one, and the slot `b` is
 * not written in the loop, keeps its counter a double: `b` may be
 * fractional, negative, NaN or beyond 2^32, so nothing bounds `i` (see
 * provenInductionWords).
 *
 * The counter only takes integer values, and for an integer `i`,
 * `i < b` exactly when `i < ceil(b)`. So when `b <= 2^32 - 1` on entry the
 * header compares instead against a fresh slot holding the word
 * `ceil(max(b, s)) >>> 0`, computed once ahead of the loop: a word bound,
 * so the counter is a proven word. A bound at most `s` (including -0 and
 * -Infinity) becomes `s`, and NaN becomes 0, which is at most `s`: the
 * first test fails in both, as `i < b` does, so the body never runs and no
 * other counter value is ever compared. Only a bound above 2^32 - 1
 * (including +Infinity) enters a cold copy of the loop whose counter is a
 * fresh double slot, as is each other number slot the loop stores to that
 * is dead entering and leaving it, so the copy's values never reach the
 * hot loop's slots; the loop itself is not duplicated on the hot path.
 *
 * Counters the induction proof already accepts are left alone. The
 * rewrite is kept only when the induction proof accepts the counter,
 * and the counter is dead where the loop exits (the copy never writes it
 * back). Any counter qualifies, not only one that indexes: an outer loop's
 * counter feeds inner loops' arithmetic and bitwise operations. Loops with exception handlers, transfers
 * into the counter or bound, or a preheader that is not a plain jump are
 * left alone. Verified IR with dense block IDs only. */
export function boundCountedLoops(
  fn: FunctionIR,
  budget: number,
  remarks?: RemarkSink,
): CountedLoopBounds | undefined {
  if (!Number.isSafeInteger(budget) || budget < 0) return undefined;
  const count = fn.blocks.length;
  for (let index = 0; index < count; index++)
    if (fn.blocks[index]?.id !== index) return { fn, visited: 0, bounded: 0 };
  const forest = naturalLoops(fn, budget);
  if (forest === undefined) return undefined;
  let visited = forest.visited;
  if (forest.loops.length === 0) return { fn, visited, bounded: 0 };
  const predecessors: number[][] = [];
  for (let index = 0; index < count; index++) predecessors.push([]);
  let nextValue = 0;
  for (const block of fn.blocks) {
    if (block === undefined) throw "counted loop block invariant";
    for (const target of successors(block.terminator)) {
      if (target === undefined) throw "counted loop successor invariant";
      predecessors[target]?.push(block.id);
    }
    const exception = block.exception;
    if (exception !== undefined) predecessors[exception.target]?.push(block.id);
    for (const op of block.instructions) {
      if (op === undefined) throw "counted loop instruction invariant";
      if (++visited > budget) return undefined;
      const id = instructionResult(op);
      if (id !== undefined && id >= nextValue) nextValue = id + 1;
    }
  }
  // Innermost loops first (by body size); a block joins one copy.
  const loops: NaturalLoop[] = [];
  for (const loop of forest.loops) {
    if (loop === undefined) throw "counted loop invariant";
    let at = loops.length;
    while (at > 0 && (loops[at - 1]?.body.size ?? 0) > loop.body.size) at--;
    loops.splice(at, 0, loop);
  }
  // Counters already proven words (a length or other word bound) keep their
  // bound: the bound's own facts (such as string-length relations) matter.
  const proven = provenInductionWords(fn);
  let current = fn,
    bounded = 0,
    guardedBounded = false;
  const touched = new Uint8Array(count);
  for (const loop of loops) {
    if (loop === undefined) throw "counted loop invariant";
    let overlap = false;
    for (const id of loop.body)
      if (id !== undefined && touched[id] === 1) overlap = true;
    if (overlap) continue;
    const candidate = countedLoop(current, loop, predecessors);
    if (candidate === undefined || proven?.[candidate.counter] === 1) continue;
    visited += candidate.visited;
    if (visited > budget) return undefined;
    const missed = (message: string): void => {
      if (remarks !== undefined)
        remarks({
          pass: "bound-counted-loops",
          outcome: "missed",
          function: fn.name,
          start: candidate.start,
          end: candidate.end,
          message,
        });
    };
    const start = entryConstant(
      current,
      candidate.counter,
      candidate.preheader,
    );
    visited += start.visited;
    if (visited > budget) return undefined;
    const startValue = start.value;
    if (startValue === undefined) {
      missed("counter does not start at a uint32 constant");
      continue;
    }
    // The cold copy leaves its counter behind: nothing may read it after.
    // It also gives fresh slots to the other number slots the loop's stores
    // write that are dead entering and leaving it (values computed and used
    // within an iteration, such as loop invariants carried in slots), so
    // the copy's double counter never reaches the hot loop's slots and their
    // interval facts stay exact.
    const local = loopLocalCandidates(current, loop, candidate.counter);
    const live = analyzeLiveSlots(current, budget - visited, [
      candidate.counter,
      ...local,
    ]);
    if (live === undefined) return undefined;
    visited += live.work;
    let liveAfter = false,
      joined = false;
    for (const id of candidate.exits) {
      if (id === undefined) throw "counted loop exit invariant";
      if (live.slots[id]?.includes(candidate.counter) === true)
        liveAfter = true;
      if (predecessors[id]?.length === 1) joined = true;
    }
    if (liveAfter) {
      missed("counter is live after the loop");
      continue;
    }
    const renamed = local.filter(
      (slot) =>
        live.slots[loop.header]?.includes(slot) !== true &&
        candidate.exits.every((id) => live.slots[id]?.includes(slot) !== true),
    );
    const result = boundLoop(
      current,
      loop,
      candidate,
      startValue,
      nextValue,
      renamed,
    );
    visited += result.visited;
    if (visited > budget) return undefined;
    // The copy's exits join the loop's, and a guarded preheader joins two
    // branches into the cold entry: keep every proven record read intact.
    if (
      (joined || candidate.guard !== undefined) &&
      !recordReadsKept(current, result.fn)
    ) {
      missed("cold copy would join a proven record read's path");
      continue;
    }
    const proof = provenInductionWords(result.fn);
    if (proof === undefined || proof[candidate.counter] !== 1) {
      missed("counter not proven a word against the clamped bound");
      continue;
    }
    current = result.fn;
    nextValue = result.nextValue;
    bounded++;
    if (candidate.guard !== undefined) guardedBounded = true;
    // The copy's exits gain predecessors: a loop headed there is stale.
    for (const id of loop.body) if (id !== undefined) touched[id] = 1;
    for (const id of candidate.exits) if (id !== undefined) touched[id] = 1;
    touched[candidate.preheader] = 1;
    if (remarks !== undefined)
      remarks({
        pass: "bound-counted-loops",
        outcome: "applied",
        function: fn.name,
        start: candidate.start,
        end: candidate.end,
        message:
          "loop counter s" +
          String(candidate.counter) +
          " is a word below ceil(s" +
          String(candidate.bound) +
          ")",
      });
  }
  if (guardedBounded) {
    const compacted = compactReachableBlocks(
      current,
      current.blocks,
      budget - visited,
    );
    if (compacted === undefined) return undefined;
    current = compacted.fn;
    visited += compacted.visited;
  }
  const promoted = promoteBitwiseAccumulators(
    current,
    nextValue,
    budget - visited,
  );
  if (promoted === undefined) return undefined;
  visited += promoted.visited;
  return {
    fn: promoted.fn,
    visited,
    bounded: bounded + promoted.promoted,
  };
}

export interface DivisorVersions {
  readonly fn: FunctionIR;
  readonly visited: number;
  /** Loops given a version whose divisor is known positive. */
  readonly versioned: number;
}

/** Loop versions for remainders by a loop-invariant divisor. `x % d` with
 * an integer `d` that may be 0 yields NaN, so its result is a double. A
 * loop whose body takes a remainder by a load of a number slot `d` that the
 * loop never writes, where `d` is an integer or safe integer slot not
 * already proven nonzero, tests
 * `d > 0` once ahead of the loop. When that holds the loop runs reading `d`
 * from a fresh slot holding that positive value, which bounds proves a
 * nonzero slot, so codegen divides as int64s with an integer result;
 * otherwise a cold copy of the loop runs as written. The copy renames the
 * loop-local slots as boundCountedLoops' does, so its values never reach
 * the hot loop's slots. Innermost loops first, one divisor per loop (the
 * first in block order); loops with exception handlers, without a
 * plain-jump preheader, or above the size limit are left alone. Verified
 * IR with dense block IDs only. */
export function versionNonzeroDivisors(
  fn: FunctionIR,
  budget: number,
  remarks?: RemarkSink,
): DivisorVersions | undefined {
  if (!Number.isSafeInteger(budget) || budget < 0) return undefined;
  const count = fn.blocks.length;
  for (let index = 0; index < count; index++)
    if (fn.blocks[index]?.id !== index) return { fn, visited: 0, versioned: 0 };
  // Divisors worth a version: integer slots, whose remainders codegen can
  // keep integers once the divisor is known nonzero.
  const integral = new Uint8Array(fn.slots.length);
  let anyIntegral = false;
  for (const slot of fn.integerSlots ?? [])
    if (slot !== undefined) {
      integral[slot] = 1;
      anyIntegral = true;
    }
  for (const slot of fn.safeIntegerSlots ?? [])
    if (slot !== undefined) {
      integral[slot] = 1;
      anyIntegral = true;
    }
  // Divisors already proven nonzero need no version.
  for (const slot of fn.nonzeroSlots ?? [])
    if (slot !== undefined) integral[slot] = 0;
  if (!anyIntegral)
    return count > budget ? undefined : { fn, visited: count, versioned: 0 };
  const forest = naturalLoops(fn, budget);
  if (forest === undefined) return undefined;
  let visited = forest.visited;
  if (forest.loops.length === 0) return { fn, visited, versioned: 0 };
  const predecessors: number[][] = [];
  for (let index = 0; index < count; index++) predecessors.push([]);
  let nextValue = 0;
  for (const block of fn.blocks) {
    if (block === undefined) throw "divisor version block invariant";
    for (const target of successors(block.terminator)) {
      if (target === undefined) throw "divisor version successor invariant";
      predecessors[target]?.push(block.id);
    }
    const exception = block.exception;
    if (exception !== undefined) predecessors[exception.target]?.push(block.id);
    for (const op of block.instructions) {
      if (op === undefined) throw "divisor version instruction invariant";
      if (++visited > budget) return undefined;
      const id = instructionResult(op);
      if (id !== undefined && id >= nextValue) nextValue = id + 1;
    }
  }
  const loops: NaturalLoop[] = [];
  for (const loop of forest.loops) {
    if (loop === undefined) throw "divisor version loop invariant";
    let at = loops.length;
    while (at > 0 && (loops[at - 1]?.body.size ?? 0) > loop.body.size) at--;
    loops.splice(at, 0, loop);
  }
  let current = fn,
    versioned = 0;
  const touched = new Uint8Array(count);
  for (const loop of loops) {
    if (loop === undefined) throw "divisor version loop invariant";
    let overlap = false;
    for (const id of loop.body)
      if (id !== undefined && touched[id] === 1) overlap = true;
    if (overlap) continue;
    const candidate = divisorLoop(current, loop, predecessors, integral);
    if (candidate === undefined) continue;
    visited += candidate.visited;
    if (visited > budget) return undefined;
    const local = loopLocalCandidates(current, loop, -1);
    const live = analyzeLiveSlots(current, budget - visited, local);
    if (live === undefined) return undefined;
    visited += live.work;
    let joined = false;
    for (const id of candidate.exits)
      if (predecessors[id]?.length === 1) joined = true;
    const renamed = local.filter(
      (slot) =>
        live.slots[loop.header]?.includes(slot) !== true &&
        candidate.exits.every((id) => live.slots[id]?.includes(slot) !== true),
    );
    const result = versionLoop(current, loop, candidate, renamed, nextValue);
    visited += result.visited;
    if (visited > budget) return undefined;
    // The copy's exits join the loop's: a record read proven along the
    // unique-predecessor chain through an exit must stay proven.
    if (joined && !recordReadsKept(current, result.fn)) {
      if (remarks !== undefined)
        remarks({
          pass: "version-nonzero-divisors",
          outcome: "missed",
          function: fn.name,
          start: candidate.start,
          end: candidate.end,
          message: "cold copy would join a proven record read's path",
        });
      continue;
    }
    current = result.fn;
    nextValue = result.nextValue;
    versioned++;
    for (const id of loop.body) if (id !== undefined) touched[id] = 1;
    for (const id of candidate.exits) if (id !== undefined) touched[id] = 1;
    touched[candidate.preheader] = 1;
    if (remarks !== undefined)
      remarks({
        pass: "version-nonzero-divisors",
        outcome: "applied",
        function: fn.name,
        start: candidate.start,
        end: candidate.end,
        message: "remainders by s" + String(candidate.divisor) + " > 0",
      });
  }
  return { fn: current, visited, versioned };
}

interface DivisorLoop {
  readonly preheader: number;
  readonly divisor: number;
  /** Blocks outside the loop that its blocks branch to. */
  readonly exits: readonly number[];
  readonly start: number;
  readonly end: number;
  readonly visited: number;
}

/** The divisor slot and preheader of `loop`, when it has the shape
 * versionNonzeroDivisors handles. */
function divisorLoop(
  fn: FunctionIR,
  loop: NaturalLoop,
  predecessors: readonly (readonly number[])[],
  integral: Uint8Array,
): DivisorLoop | undefined {
  const outside = (predecessors[loop.header] ?? []).filter(
    (id) => !loop.body.has(id),
  );
  const preheaderId = outside[0];
  if (outside.length !== 1 || preheaderId === undefined) return undefined;
  const preheader = fn.blocks[preheaderId];
  if (
    preheader === undefined ||
    preheader.terminator.kind !== "jump" ||
    preheader.exception !== undefined
  )
    return undefined;
  let instructions = 0,
    divisor = -1,
    start = 0,
    end = 0;
  const exits: number[] = [];
  for (const id of loop.body) {
    if (id === undefined) throw "divisor version body invariant";
    const block = fn.blocks[id];
    if (block === undefined) throw "divisor version block invariant";
    if (block.exception !== undefined) return undefined;
    const t = block.terminator;
    for (const target of successors(t)) {
      if (target === undefined) throw "divisor version successor invariant";
      if (!loop.body.has(target) && !exits.includes(target)) exits.push(target);
    }
    const loaded = new Map<number, number>();
    for (const op of block.instructions) {
      if (op === undefined) throw "divisor version instruction invariant";
      instructions++;
      if (op.kind === "load") loaded.set(op.id, op.slot);
      else if (op.kind === "binary" && op.operator === "%" && divisor < 0) {
        const slot = loaded.get(op.right);
        if (
          slot !== undefined &&
          fn.slots[slot] === "number" &&
          integral[slot] === 1 &&
          !loop.writes.has(slot)
        ) {
          divisor = slot;
          start = op.start;
          end = op.end;
        }
      }
    }
  }
  if (divisor < 0 || instructions > maxBoundedInstructions) return undefined;
  return {
    preheader: preheaderId,
    divisor,
    exits,
    start,
    end,
    visited: instructions,
  };
}

/** `fn` with `loop` reading its divisor from a fresh slot, entered when the
 * divisor is positive, and a cold copy entered otherwise (see
 * versionNonzeroDivisors). */
function versionLoop(
  fn: FunctionIR,
  loop: NaturalLoop,
  candidate: DivisorLoop,
  renamed: readonly number[],
  firstValue: number,
): {
  readonly fn: FunctionIR;
  readonly nextValue: number;
  readonly visited: number;
} {
  let nextValue = firstValue,
    visited = 0;
  const blocks: Block[] = fn.blocks.slice(),
    slots: ScalarType[] = fn.slots.slice();
  const positive = slots.length;
  slots.push("number");
  const coldSlots = new Map<number, number>();
  for (const slot of renamed) {
    coldSlots.set(slot, slots.length);
    slots.push(fn.slots[slot] ?? "number");
  }
  const start0 = candidate.start,
    end0 = candidate.end;
  const copy = copyLoop(fn, blocks, loop, coldSlots, nextValue);
  nextValue = copy.nextValue;
  visited += copy.visited;
  // The hot loop reads the divisor from its positive slot.
  for (const id of loop.body) {
    if (id === undefined) throw "divisor version body invariant";
    const block = blocks[id];
    if (block === undefined) throw "divisor version block invariant";
    const instructions: Instruction[] = [];
    for (const op of block.instructions) {
      if (op === undefined) throw "divisor version instruction invariant";
      visited++;
      instructions.push(
        op.kind === "load" && op.slot === candidate.divisor
          ? { ...op, slot: positive }
          : op,
      );
    }
    blocks[id] = { ...block, instructions };
  }
  const loaded = nextValue++,
    hotEntry = blocks.length;
  blocks.push({
    id: hotEntry,
    instructions: [
      {
        kind: "load",
        id: loaded,
        slot: candidate.divisor,
        start: start0,
        end: end0,
      },
      {
        kind: "store",
        slot: positive,
        value: loaded,
        start: start0,
        end: end0,
      },
    ],
    terminator: { kind: "jump", target: loop.header, start: start0, end: end0 },
  });
  // The preheader enters the hot loop only for a positive divisor.
  const preheader = fn.blocks[candidate.preheader];
  if (preheader === undefined) throw "divisor version preheader invariant";
  const tested = nextValue++,
    zero = nextValue++,
    above = nextValue++;
  const guard: Instruction[] = preheader.instructions.slice();
  guard.push(
    {
      kind: "load",
      id: tested,
      slot: candidate.divisor,
      start: start0,
      end: end0,
    },
    { kind: "constant", id: zero, value: 0, start: start0, end: end0 },
    {
      kind: "binary",
      id: above,
      operator: ">",
      left: tested,
      right: zero,
      start: start0,
      end: end0,
    },
  );
  blocks[candidate.preheader] = {
    id: preheader.id,
    instructions: guard,
    terminator: {
      kind: "branch",
      condition: above,
      consequent: hotEntry,
      alternate: copy.header,
      start: start0,
      end: end0,
    },
  };
  // The positive slot and the copy's slots are the same source variables.
  const debug = fn.debug;
  let result: FunctionIR = { ...fn, slots, blocks };
  if (debug !== undefined) {
    const bindings: SlotBinding[] = debug.slots.slice();
    for (const binding of debug.slots) {
      if (binding === undefined) continue;
      if (binding.slot === candidate.divisor)
        bindings.push({ slot: positive, variable: binding.variable });
      const cold = coldSlots.get(binding.slot);
      if (cold !== undefined)
        bindings.push({ slot: cold, variable: binding.variable });
    }
    result = { ...fn, slots, blocks, debug: { ...debug, slots: bindings } };
  }
  return { fn: result, nextValue, visited };
}

/** Number slots other than `counter` that `loop` writes with store
 * instructions only (no terminator writes them), excluding parameters and
 * the receiver. */
function loopLocalCandidates(
  fn: FunctionIR,
  loop: NaturalLoop,
  counter: number,
): number[] {
  const terminatorWrites = new Set<number>();
  for (const id of loop.body) {
    const t = fn.blocks[id]?.terminator;
    if (
      t !== undefined &&
      (t.kind === "record" || t.kind === "record-cell" || t.kind === "cell")
    )
      terminatorWrites.add(t.slot);
  }
  const local: number[] = [];
  for (const slot of loop.writes)
    if (
      slot !== counter &&
      fn.slots[slot] === "number" &&
      !terminatorWrites.has(slot) &&
      !fn.parameters.includes(slot) &&
      fn.receiverSlot !== slot
    )
      local.push(slot);
  local.sort((left, right) => left - right);
  return local;
}

export { recordReadsKept } from "../scalar/index.ts";
interface CountedLoop {
  readonly preheader: number;
  readonly counter: number;
  readonly bound: number;
  /** Optional loop-invariant boolean guard slot tested at `loop.header`
   * before entering `testBlock` (`i < bound`). */
  readonly guard: number | undefined;
  readonly testBlock: number;
  /** The test block's `<` condition value ID. */
  readonly condition: number;
  /** Blocks outside the loop that its blocks branch to. */
  readonly exits: readonly number[];
  readonly start: number;
  readonly end: number;
  readonly visited: number;
}

/** The loop's counter and bound slots and its preheader, when the loop has
 * the shape boundCountedLoops handles. */
function countedLoop(
  fn: FunctionIR,
  loop: NaturalLoop,
  predecessors: readonly (readonly number[])[],
): CountedLoop | undefined {
  const header = fn.blocks[loop.header];
  if (header === undefined) throw "counted loop header invariant";
  const outside = (predecessors[loop.header] ?? []).filter(
    (id) => !loop.body.has(id),
  );
  const preheaderId = outside[0];
  if (outside.length !== 1 || preheaderId === undefined) return undefined;
  const preheader = fn.blocks[preheaderId];
  if (
    preheader === undefined ||
    preheader.terminator.kind !== "jump" ||
    preheader.exception !== undefined
  )
    return undefined;
  const hasGeneral = hasScriptOperations(fn);
  let guardSlot: number | undefined;
  let testBlock = header;
  const headerTerm = header.terminator;
  if (headerTerm.kind !== "branch") return undefined;
  if (
    hasGeneral &&
    header.exception === undefined &&
    header.instructions.length === 1 &&
    loop.body.has(headerTerm.consequent)
  ) {
    const only = header.instructions[0];
    if (
      only !== undefined &&
      only.kind === "load" &&
      only.id === headerTerm.condition &&
      fn.slots[only.slot] === "boolean" &&
      !loop.writes.has(only.slot)
    ) {
      const next = fn.blocks[headerTerm.consequent];
      const nextPreds = predecessors[headerTerm.consequent] ?? [];
      if (
        next !== undefined &&
        next.id !== header.id &&
        next.exception === undefined &&
        nextPreds.length === 1 &&
        nextPreds[0] === header.id
      ) {
        guardSlot = only.slot;
        testBlock = next;
      }
    }
  }
  const term = testBlock.terminator;
  // The body runs only while the test holds.
  if (
    term.kind !== "branch" ||
    !loop.body.has(term.consequent) ||
    loop.body.has(term.alternate)
  )
    return undefined;
  let condition: Instruction | undefined;
  const loaded = new Map<number, number>();
  for (const op of testBlock.instructions) {
    if (op === undefined) throw "counted loop instruction invariant";
    if (op.kind === "load") loaded.set(op.id, op.slot);
    if (instructionResult(op) === term.condition) condition = op;
  }
  if (
    condition === undefined ||
    condition.kind !== "binary" ||
    condition.operator !== "<"
  )
    return undefined;
  const counter = loaded.get(condition.left),
    bound = loaded.get(condition.right);
  if (
    counter === undefined ||
    bound === undefined ||
    counter === bound ||
    fn.slots[counter] !== "number" ||
    fn.slots[bound] !== "number" ||
    fn.parameters.includes(counter) ||
    fn.receiverSlot === counter ||
    !loop.writes.has(counter) ||
    loop.writes.has(bound)
  )
    return undefined;
  let instructions = 0;
  const exits: number[] = [];
  for (const id of loop.body) {
    if (id === undefined) throw "counted loop body invariant";
    const block = fn.blocks[id];
    if (block === undefined) throw "counted loop block invariant";
    if (block.exception !== undefined) return undefined;
    const t = block.terminator;
    if (
      (t.kind === "record" || t.kind === "record-cell" || t.kind === "cell") &&
      (t.slot === counter || t.slot === bound || t.slot === guardSlot)
    )
      return undefined;
    for (const target of successors(t)) {
      if (target === undefined) throw "counted loop successor invariant";
      if (!loop.body.has(target) && !exits.includes(target)) exits.push(target);
    }
    for (const op of block.instructions) {
      if (op === undefined) throw "counted loop instruction invariant";
      instructions++;
    }
  }
  if (instructions > maxBoundedInstructions) return undefined;
  return {
    preheader: preheaderId,
    counter,
    bound,
    guard: guardSlot,
    testBlock: testBlock.id,
    condition: term.condition,
    exits,
    start: condition.start,
    end: condition.end,
    visited: instructions,
  };
}

/** The uint32 constant `slot` holds on every path to the end of block `at`,
 * if any: a forward analysis over stores of constants defined in the
 * storing block. Entry values, other stores, transfers into the slot and
 * handler entries are unknown. */
function entryConstant(
  fn: FunctionIR,
  slot: number,
  at: number,
): { readonly value: number | undefined; readonly visited: number } {
  const count = fn.blocks.length,
    // Per block: 0 unvisited, 1 the constant `known[block]`, 2 unknown.
    state = new Uint8Array(count),
    known = new Float64Array(count),
    out = new Uint8Array(count),
    outValue = new Float64Array(count),
    worklist: number[] = [fn.entry];
  let visited = 0;
  state[fn.entry] = 2;
  const meet = (target: number, kind: number, value: number): void => {
    const before = state[target] ?? 0;
    if (before === 2) return;
    // Only uint32 constants other than -0 are tracked, so === is exact.
    if (before === 1 && kind === 1 && known[target] === value) return;
    state[target] = before === 0 ? kind : 2;
    known[target] = value;
    worklist.push(target);
  };
  const constants = new Map<number, number>();
  while (worklist.length > 0) {
    const id = worklist.pop();
    if (id === undefined) throw "counted loop worklist invariant";
    const block = fn.blocks[id];
    if (block === undefined) throw "counted loop block invariant";
    let kind = state[id] ?? 2,
      value = known[id] ?? 0;
    constants.clear();
    for (const op of block.instructions) {
      if (op === undefined) throw "counted loop instruction invariant";
      visited++;
      if (op.kind === "constant") {
        const literal = op.value;
        if (typeof literal === "number") constants.set(op.id, literal);
      } else if (op.kind === "store" && op.slot === slot) {
        const stored = constants.get(op.value);
        if (stored === undefined || !uint32(stored)) kind = 2;
        else {
          kind = 1;
          value = stored;
        }
      }
    }
    const t = block.terminator;
    if (
      (t.kind === "record" || t.kind === "record-cell" || t.kind === "cell") &&
      t.slot === slot &&
      t.operation !== "write"
    )
      kind = 2;
    out[id] = kind;
    outValue[id] = value;
    for (const target of successors(t)) {
      if (target === undefined) throw "counted loop successor invariant";
      meet(target, kind, value);
    }
    // A throw may leave the block before any of its stores.
    if (block.exception !== undefined) meet(block.exception.target, 2, 0);
  }
  return {
    value: out[at] === 1 ? outValue[at] : undefined,
    visited,
  };
}

/** A uint32 other than -0: `ceil(max(b, s)) >>> 0` is then at least `s`
 * whenever it is not NaN's 0. */
function uint32(value: number): boolean {
  return (
    Number.isInteger(value) &&
    value >= 0 &&
    value <= maxWordBound &&
    (value !== 0 || 1 / value > 0)
  );
}

/** `fn` with `loop`'s header testing a word bound computed in its
 * preheader, and a cold double-counter copy for bounds above 2^32 - 1 (see
 * boundCountedLoops). */
function boundLoop(
  fn: FunctionIR,
  loop: NaturalLoop,
  candidate: CountedLoop,
  start: number,
  firstValue: number,
  renamed: readonly number[],
): {
  readonly fn: FunctionIR;
  readonly nextValue: number;
  readonly visited: number;
} {
  let nextValue = firstValue,
    visited = 0;
  const blocks: Block[] = fn.blocks.slice(),
    slots: ScalarType[] = fn.slots.slice();
  const wordBound = slots.length;
  slots.push("number");
  const coldCounter = slots.length;
  slots.push("number");
  // The copy's own slot for each loop-local slot (see boundCountedLoops).
  const coldSlots = new Map<number, number>();
  coldSlots.set(candidate.counter, coldCounter);
  for (const slot of renamed) {
    coldSlots.set(slot, slots.length);
    slots.push(fn.slots[slot] ?? "number");
  }
  const start0 = candidate.start,
    end0 = candidate.end;
  // The cold copy: every body block, the counter renamed, exits unchanged.
  const copy = copyLoop(fn, blocks, loop, coldSlots, nextValue);
  nextValue = copy.nextValue;
  visited += copy.visited;
  const coldHeader = copy.header;
  const coldStart = nextValue++,
    coldEntry = blocks.length;
  const cold: Instruction[] = [];
  cold.push({
    kind: "constant",
    id: coldStart,
    value: start,
    start: start0,
    end: end0,
  });
  cold.push({
    kind: "store",
    slot: coldCounter,
    value: coldStart,
    start: start0,
    end: end0,
  });
  blocks.push({
    id: coldEntry,
    instructions: cold,
    terminator: { kind: "jump", target: coldHeader, start: start0, end: end0 },
  });
  // The hot path: wordBound = ceil(max(b, s)) >>> 0.
  const bound = nextValue++,
    first = nextValue++,
    floor = nextValue++,
    ceiling = nextValue++,
    zero = nextValue++,
    word = nextValue++,
    hotEntry = blocks.length;
  const hot: Instruction[] = [];
  hot.push({
    kind: "load",
    id: bound,
    slot: candidate.bound,
    start: start0,
    end: end0,
  });
  hot.push({
    kind: "constant",
    id: first,
    value: start,
    start: start0,
    end: end0,
  });
  hot.push({
    kind: "binary",
    id: floor,
    operator: "max",
    left: bound,
    right: first,
    start: start0,
    end: end0,
  });
  hot.push({
    kind: "unary",
    id: ceiling,
    operator: "ceil",
    operand: floor,
    start: start0,
    end: end0,
  });
  hot.push({ kind: "constant", id: zero, value: 0, start: start0, end: end0 });
  hot.push({
    kind: "binary",
    id: word,
    operator: ">>>",
    left: ceiling,
    right: zero,
    start: start0,
    end: end0,
  });
  hot.push({
    kind: "store",
    slot: wordBound,
    value: word,
    start: start0,
    end: end0,
  });
  blocks.push({
    id: hotEntry,
    instructions: hot,
    terminator: { kind: "jump", target: loop.header, start: start0, end: end0 },
  });
  // The preheader enters the cold copy when the optional guard is false or for
  // bounds above 2^32 - 1.
  const preheader = fn.blocks[candidate.preheader];
  if (preheader === undefined) throw "counted loop preheader invariant";
  const tested = nextValue++,
    limit = nextValue++,
    above = nextValue++;
  const boundGuardOps: Instruction[] = [
    {
      kind: "load",
      id: tested,
      slot: candidate.bound,
      start: start0,
      end: end0,
    },
    {
      kind: "constant",
      id: limit,
      value: maxWordBound,
      start: start0,
      end: end0,
    },
    {
      kind: "binary",
      id: above,
      operator: ">",
      left: tested,
      right: limit,
      start: start0,
      end: end0,
    },
  ];
  const boundBranch: Terminator = {
    kind: "branch",
    condition: above,
    consequent: coldEntry,
    alternate: hotEntry,
    start: start0,
    end: end0,
  };
  const exception = preheader.exception;
  const guardSlot = candidate.guard;
  if (guardSlot !== undefined) {
    const boundCheckId = blocks.length;
    blocks.push({
      id: boundCheckId,
      instructions: boundGuardOps,
      terminator: boundBranch,
    });
    const guardLoaded = nextValue++;
    const preOps = preheader.instructions.slice();
    preOps.push({
      kind: "load",
      id: guardLoaded,
      slot: guardSlot,
      start: start0,
      end: end0,
    });
    const guardBranch: Terminator = {
      kind: "branch",
      condition: guardLoaded,
      consequent: boundCheckId,
      alternate: coldEntry,
      start: start0,
      end: end0,
    };
    blocks[candidate.preheader] =
      exception === undefined
        ? { id: preheader.id, instructions: preOps, terminator: guardBranch }
        : {
            id: preheader.id,
            instructions: preOps,
            terminator: guardBranch,
            exception,
          };
  } else {
    const guard: Instruction[] = preheader.instructions.slice();
    for (const op of boundGuardOps) {
      if (op !== undefined) guard.push(op);
    }
    blocks[candidate.preheader] =
      exception === undefined
        ? { id: preheader.id, instructions: guard, terminator: boundBranch }
        : {
            id: preheader.id,
            instructions: guard,
            terminator: boundBranch,
            exception,
          };
  }
  // The header compares the counter with the word bound.
  const header = fn.blocks[loop.header];
  const testBlock = fn.blocks[candidate.testBlock];
  if (header === undefined || testBlock === undefined)
    throw "counted loop header invariant";
  const reloaded = nextValue++,
    instructions: Instruction[] = [];
  let headerTerminator = testBlock.terminator;
  if (guardSlot !== undefined) {
    const substitution = new Uint32Array(firstValue);
    for (const op of testBlock.instructions) {
      if (op === undefined) throw "counted loop instruction invariant";
      const substituted = substituteInstructionValues(op, substitution),
        result = instructionResult(op);
      let copied = substituted;
      if (result !== undefined) {
        const renamed = nextValue++;
        substitution[result] = renamed + 1;
        copied = renumberInstructionResult(substituted, renamed);
      }
      if (op.kind === "binary" && op.id === candidate.condition) {
        instructions.push({
          kind: "load",
          id: reloaded,
          slot: wordBound,
          start: start0,
          end: end0,
        });
        if (copied.kind === "binary")
          instructions.push({ ...copied, right: reloaded });
        else instructions.push(copied);
      } else instructions.push(copied);
    }
    headerTerminator = substituteTerminatorValues(
      testBlock.terminator,
      substitution,
    );
    blocks[candidate.testBlock] = {
      id: candidate.testBlock,
      instructions: [],
      terminator: { kind: "trap", start: start0, end: end0 },
    };
  } else {
    for (const op of header.instructions) {
      if (op === undefined) throw "counted loop instruction invariant";
      if (op.kind === "binary" && op.id === candidate.condition) {
        instructions.push({
          kind: "load",
          id: reloaded,
          slot: wordBound,
          start: start0,
          end: end0,
        });
        instructions.push({ ...op, right: reloaded });
      } else instructions.push(op);
    }
  }
  const headerException = header.exception;
  blocks[loop.header] =
    headerException === undefined
      ? { id: header.id, instructions, terminator: headerTerminator }
      : {
          id: header.id,
          instructions,
          terminator: headerTerminator,
          exception: headerException,
        };
  // The copy's counter is the same source variable.
  const debug = fn.debug;
  let result: FunctionIR = { ...fn, slots, blocks };
  if (debug !== undefined) {
    const bindings: SlotBinding[] = debug.slots.slice();
    for (const binding of debug.slots)
      if (binding !== undefined && binding.slot === candidate.counter)
        bindings.push({ slot: coldCounter, variable: binding.variable });
    result = { ...fn, slots, blocks, debug: { ...debug, slots: bindings } };
  }
  return { fn: result, nextValue, visited };
}

/** Appends to `blocks` a copy of `loop`'s body: fresh value IDs from
 * `firstValue`, the slots of `slotRenames` renamed in loads and stores,
 * edges within the loop routed to the copies and exits unchanged. Returns
 * the copy of the header. */
function copyLoop(
  fn: FunctionIR,
  blocks: Block[],
  loop: NaturalLoop,
  slotRenames: ReadonlyMap<number, number>,
  firstValue: number,
): {
  readonly header: number;
  readonly nextValue: number;
  readonly visited: number;
} {
  let nextValue = firstValue,
    visited = 0;
  const copies = new Map<number, number>();
  for (const id of loop.body) {
    if (id === undefined) throw "loop copy body invariant";
    copies.set(id, blocks.length);
    blocks.push({
      id: blocks.length,
      instructions: [],
      terminator: { kind: "trap", start: 0, end: 0 },
    });
  }
  const route = (target: number): number => copies.get(target) ?? target;
  const substitution = new Uint32Array(firstValue);
  for (const original of loop.body) {
    if (original === undefined) throw "loop copy body invariant";
    const block = fn.blocks[original],
      copyId = copies.get(original);
    if (block === undefined || copyId === undefined)
      throw "loop copy block invariant";
    substitution.fill(0);
    const instructions: Instruction[] = [];
    for (const op of block.instructions) {
      if (op === undefined) throw "loop copy instruction invariant";
      visited++;
      const substituted = substituteInstructionValues(op, substitution),
        result = instructionResult(op);
      let copied = substituted;
      if (result !== undefined) {
        const renamed = nextValue++;
        substitution[result] = renamed + 1;
        copied = renumberInstructionResult(substituted, renamed);
      }
      const slot =
        copied.kind === "load" || copied.kind === "store"
          ? slotRenames.get(copied.slot)
          : undefined;
      if (
        slot !== undefined &&
        (copied.kind === "load" || copied.kind === "store")
      )
        instructions.push({ ...copied, slot });
      else instructions.push(copied);
    }
    blocks[copyId] = {
      id: copyId,
      instructions,
      terminator: retarget(
        substituteTerminatorValues(block.terminator, substitution),
        route,
      ),
    };
  }
  const header = copies.get(loop.header);
  if (header === undefined) throw "loop copy entry invariant";
  return { header, nextValue, visited };
}

function successors(term: Terminator): number[] {
  if (term.kind === "jump") return [term.target];
  if (
    term.kind === "branch" ||
    term.kind === "record" ||
    term.kind === "record-cell" ||
    term.kind === "cell"
  )
    return term.consequent === term.alternate
      ? [term.consequent]
      : [term.consequent, term.alternate];
  return [];
}

function retarget(term: Terminator, route: (id: number) => number): Terminator {
  if (term.kind === "jump") return { ...term, target: route(term.target) };
  if (
    term.kind === "branch" ||
    term.kind === "record" ||
    term.kind === "record-cell" ||
    term.kind === "cell"
  )
    return {
      ...term,
      consequent: route(term.consequent),
      alternate: route(term.alternate),
    };
  return term;
}

function isInt32Bitwise(operator: string): boolean {
  return (
    operator === "^" ||
    operator === "|" ||
    operator === "&" ||
    operator === "<<" ||
    operator === ">>"
  );
}

function isPureHeaderBlock(block: Block): boolean {
  if (block.exception !== undefined || block.instructions.length > 16)
    return false;
  for (const op of block.instructions) {
    if (op === undefined) return false;
    if (
      op.kind !== "load" &&
      op.kind !== "constant" &&
      op.kind !== "binary" &&
      op.kind !== "unary" &&
      op.kind !== "array-length" &&
      op.kind !== "string-length"
    )
      return false;
  }
  return block.terminator.kind === "branch";
}

/** Checks whether `slot` is definitely initialized at the end of `targetBlock`
 * on every path from `fn.entry` (conservative on exception edges). */
function isDefinitelyInitializedAt(
  fn: FunctionIR,
  targetBlock: number,
  slot: number,
): boolean {
  if (slot < fn.parameters.length) return true;
  const count = fn.blocks.length;
  // 0 = unvisited, 1 = definitely initialized at block entry, 2 = maybe uninit
  const state = new Uint8Array(count);
  const worklist: number[] = [fn.entry];
  state[fn.entry] = 2;
  const meet = (target: number, value: number): void => {
    const before = state[target] ?? 0;
    if (before === 2) return;
    if (before === value) return;
    state[target] = before === 0 ? value : 2;
    worklist.push(target);
  };
  let targetOut = 0;
  while (worklist.length > 0) {
    const id = worklist.pop();
    if (id === undefined) break;
    const block = fn.blocks[id];
    if (block === undefined) return false;
    const entryVal = state[id] ?? 2;
    let outVal = entryVal;
    for (const op of block.instructions) {
      if (op !== undefined && op.kind === "store" && op.slot === slot)
        outVal = 1;
    }
    if (id === targetBlock) targetOut = outVal;
    const t = block.terminator;
    if (t.kind === "jump") {
      meet(t.target, outVal);
    } else if (t.kind === "branch") {
      meet(t.consequent, outVal);
      meet(t.alternate, outVal);
    } else if (
      t.kind === "record" ||
      t.kind === "record-cell" ||
      t.kind === "cell"
    ) {
      const consVal = t.operation === "read" && t.slot === slot ? 1 : outVal;
      meet(t.consequent, consVal);
      meet(t.alternate, outVal);
    }
    const exc = block.exception;
    if (exc !== undefined) meet(exc.target, entryVal);
  }
  return targetOut === 1;
}

/** True when every path from `start` inside `body` to `header` or `exitTarget`
 * passes through a `store` to `slot`. */
function isAlwaysWrittenPerIteration(
  blocks: readonly Block[],
  body: ReadonlySet<number>,
  header: number,
  start: number,
  exitTarget: number,
  slot: number,
): boolean {
  const seen = new Set<number>();
  seen.add(start);
  const queue: number[] = [start];
  while (queue.length > 0) {
    const id = queue.pop();
    if (id === undefined) break;
    const block = blocks[id];
    if (block === undefined) return false;
    let writes = false;
    for (const op of block.instructions) {
      if (op !== undefined && op.kind === "store" && op.slot === slot) {
        writes = true;
        break;
      }
    }
    if (writes) continue;
    for (const succ of successors(block.terminator)) {
      if (succ === header || succ === exitTarget || !body.has(succ))
        return false;
      if (!seen.has(succ)) {
        seen.add(succ);
        queue.push(succ);
      }
    }
  }
  return true;
}

/** Checks whether `slot` is proven to hold an exact signed 32-bit integer
 * (and never `-0`) at the end of `targetBlock` on every path from `fn.entry`.
 * Tracks all number slots jointly so sequential promoted loops preserve the
 * proof across writebacks. */
function isInt32AtEntry(
  fn: FunctionIR,
  targetBlock: number,
  slot: number,
  budget: number,
): boolean {
  const blockCount = fn.blocks.length,
    slotCount = fn.slots.length;
  if (blockCount === 0 || slotCount === 0) return false;
  if (blockCount * slotCount > 262144) return false;
  // 0 = unreachable, 1 = definitely signed int32 (not -0), 2 = unknown
  const entry = new Uint8Array(blockCount * slotCount);
  const entryBase = fn.entry * slotCount;
  for (let s = 0; s < slotCount; s++) entry[entryBase + s] = 2;
  const worklist: number[] = [fn.entry],
    inQueue = new Uint8Array(blockCount);
  inQueue[fn.entry] = 1;
  let targetOut = 0,
    work = 0;
  const cur = new Uint8Array(slotCount),
    int32Ids = new Set<number>();

  const propagate = (
    target: number,
    source: Uint8Array,
    excSlot: number,
  ): void => {
    const base = target * slotCount;
    let changed = false;
    for (let s = 0; s < slotCount; s++) {
      const incoming = s === excSlot ? 2 : (source[s] ?? 2),
        before = entry[base + s] ?? 0;
      if (before === 2 || before === incoming) continue;
      entry[base + s] = before === 0 ? incoming : 2;
      changed = true;
    }
    if (changed && inQueue[target] === 0) {
      inQueue[target] = 1;
      worklist.push(target);
    }
  };

  while (worklist.length > 0) {
    const id = worklist.pop();
    if (id === undefined) break;
    inQueue[id] = 0;
    const block = fn.blocks[id];
    if (block === undefined) return false;
    work += block.instructions.length + slotCount;
    if (work > budget) return false;
    const base = id * slotCount;
    for (let s = 0; s < slotCount; s++) cur[s] = entry[base + s] ?? 2;
    if (block.exception !== undefined)
      propagate(block.exception.target, cur, block.exception.slot);
    int32Ids.clear();
    for (const op of block.instructions) {
      if (op === undefined) continue;
      if (op.kind === "constant") {
        const v = op.value;
        if (
          typeof v === "number" &&
          Number.isInteger(v) &&
          v >= -2147483648 &&
          v <= 2147483647 &&
          !(v === 0 && 1 / v < 0)
        )
          int32Ids.add(op.id);
      } else if (op.kind === "load") {
        if (cur[op.slot] === 1) int32Ids.add(op.id);
      } else if (op.kind === "unary") {
        if (op.operator === "~") int32Ids.add(op.id);
      } else if (op.kind === "binary") {
        if (isInt32Bitwise(op.operator) || op.operator === "imul")
          int32Ids.add(op.id);
      } else if (op.kind === "store") {
        cur[op.slot] = int32Ids.has(op.value) ? 1 : 2;
      }
    }
    if (id === targetBlock) targetOut = cur[slot] ?? 2;
    const t = block.terminator;
    if (t.kind === "jump") {
      propagate(t.target, cur, -1);
    } else if (t.kind === "branch") {
      propagate(t.consequent, cur, -1);
      propagate(t.alternate, cur, -1);
    } else if (
      t.kind === "record" ||
      t.kind === "record-cell" ||
      t.kind === "cell"
    ) {
      propagate(t.alternate, cur, -1);
      if (t.operation !== "write") {
        const saved = cur[t.slot] ?? 2;
        cur[t.slot] = 2;
        propagate(t.consequent, cur, -1);
        cur[t.slot] = saved;
      } else {
        propagate(t.consequent, cur, -1);
      }
    }
  }
  return targetOut === 1;
}

/** Promotes loop-carried `number` slots whose every write stores a 32-bit
 * signed bitwise result to a fresh integer slot across the loop (`intAcc =
 * acc | 0` on non-empty entry, written back on exit). Pure bitwise loops work
 * for any initialized entry value; conditional updates or `(acc +/- x) | 0`
 * patterns require `acc` to already be an exact signed int32 at loop entry so
 * `intAcc` is bit-identical to `acc` on every iteration and on 0-iteration
 * exits. */
function promoteBitwiseAccumulators(
  fn: FunctionIR,
  startValueId: number,
  budget: number,
):
  | {
      readonly fn: FunctionIR;
      readonly visited: number;
      readonly promoted: number;
    }
  | undefined {
  if (budget < 0) return undefined;
  const forest = naturalLoops(fn, budget);
  if (forest === undefined) return undefined;
  let visited = forest.visited;
  if (forest.loops.length === 0) return { fn, visited, promoted: 0 };

  const predecessors: number[][] = [];
  for (let i = 0; i < fn.blocks.length; i++) predecessors.push([]);
  for (const block of fn.blocks) {
    if (block === undefined) return undefined;
    for (const succ of successors(block.terminator))
      predecessors[succ]?.push(block.id);
    const exc = block.exception;
    if (exc !== undefined) predecessors[exc.target]?.push(block.id);
  }

  const loops: NaturalLoop[] = [];
  for (const loop of forest.loops) {
    if (loop === undefined) continue;
    let at = loops.length;
    while (at > 0 && (loops[at - 1]?.body.size ?? 0) > loop.body.size) at--;
    loops.splice(at, 0, loop);
  }

  let fnHasHandlers = false;
  for (const block of fn.blocks)
    if (block?.exception !== undefined) {
      fnHasHandlers = true;
      break;
    }

  let current = fn,
    nextValue = startValueId,
    promoted = 0;
  const touched = new Set<number>();

  for (const loop of loops) {
    if (loop === undefined) continue;
    let overlap = false;
    for (const id of loop.body) if (touched.has(id)) overlap = true;
    if (overlap) continue;
    const outside = (predecessors[loop.header] ?? []).filter(
      (id) => !loop.body.has(id),
    );
    const preheaderId = outside[0];
    if (
      outside.length !== 1 ||
      preheaderId === undefined ||
      touched.has(preheaderId)
    )
      continue;
    const preheader = current.blocks[preheaderId],
      headerBlock = current.blocks[loop.header];
    if (
      preheader === undefined ||
      headerBlock === undefined ||
      preheader.exception !== undefined ||
      !isPureHeaderBlock(headerBlock)
    )
      continue;
    const preTerm = preheader.terminator;
    if (preTerm.kind !== "jump" || preTerm.target !== loop.header) continue;
    let condBlock = headerBlock,
      condBlockId = loop.header;
    const hdrTerm = headerBlock.terminator;
    if (
      headerBlock.instructions.length === 0 &&
      hdrTerm.kind === "jump" &&
      loop.body.has(hdrTerm.target) &&
      hdrTerm.target !== loop.header
    ) {
      const targetId = hdrTerm.target,
        targetBlock = current.blocks[targetId],
        targetPreds = predecessors[targetId] ?? [];
      if (
        targetBlock !== undefined &&
        targetBlock.exception === undefined &&
        isPureHeaderBlock(targetBlock) &&
        targetPreds.length === 1 &&
        targetPreds[0] === loop.header
      ) {
        condBlock = targetBlock;
        condBlockId = targetId;
      }
    }
    const hTerm = condBlock.terminator;
    if (
      hTerm.kind !== "branch" ||
      !loop.body.has(hTerm.consequent) ||
      loop.body.has(hTerm.alternate)
    )
      continue;
    let irreducible = false;
    for (const id of loop.body) {
      if (id === loop.header) continue;
      if ((predecessors[id] ?? []).some((p) => !loop.body.has(p))) {
        irreducible = true;
        break;
      }
    }
    if (irreducible) continue;

    const exitTarget = hTerm.alternate;
    const readInLoop = new Set<number>(),
      writtenInLoop = new Set<number>(),
      disqualified = new Set<number>(),
      needsEntryInt32 = new Set<number>(),
      addSubReadCount = new Map<number, number>(),
      writeCount = new Map<number, number>();
    let valid = true;
    for (const id of loop.body) {
      const block = current.blocks[id];
      if (block === undefined || block.exception !== undefined) {
        valid = false;
        break;
      }
      visited += block.instructions.length + 1;
      if (visited > budget) return undefined;
      const t = block.terminator;
      if (
        t.kind === "return" ||
        (fnHasHandlers && (t.kind === "throw" || t.kind === "throw-literal"))
      ) {
        valid = false;
        break;
      }
      const isPureAbort = (bid: number): boolean => {
        const tb = current.blocks[bid];
        if (tb === undefined || tb.exception !== undefined) return false;
        const tk = tb.terminator.kind;
        if (tk === "trap") return tb.instructions.length === 0;
        if (tk === "throw" || tk === "throw-literal") {
          for (const op of tb.instructions)
            if (op !== undefined && op.kind === "load") return false;
          return true;
        }
        return false;
      };
      for (const succ of successors(t))
        if (!loop.body.has(succ) && succ !== exitTarget) {
          if (!fnHasHandlers && isPureAbort(succ)) continue;
          valid = false;
          break;
        }
      if (!valid) break;
      if (
        (t.kind === "record" ||
          t.kind === "record-cell" ||
          t.kind === "cell") &&
        t.operation !== "write"
      )
        disqualified.add(t.slot);
      const loadSlots = new Map<number, number>(),
        bitwiseIds = new Set<number>(),
        usedByBitwise = new Set<number>(),
        usedByAddSub = new Set<number>(),
        usedByOther = new Set<number>();
      for (const op of block.instructions) {
        if (op === undefined) continue;
        if (op.kind === "load") {
          loadSlots.set(op.id, op.slot);
          readInLoop.add(op.slot);
          if (id === loop.header || id === condBlockId)
            disqualified.add(op.slot);
        } else if (op.kind === "store") {
          writtenInLoop.add(op.slot);
          writeCount.set(op.slot, (writeCount.get(op.slot) ?? 0) + 1);
          if (
            id === loop.header ||
            id === condBlockId ||
            !bitwiseIds.has(op.value)
          )
            disqualified.add(op.slot);
          if (loadSlots.has(op.value)) usedByOther.add(op.value);
        } else if (
          (op.kind === "binary" &&
            (isInt32Bitwise(op.operator) || op.operator === "imul")) ||
          (op.kind === "unary" && op.operator === "~")
        ) {
          bitwiseIds.add(op.id);
          if (op.kind === "binary") {
            usedByBitwise.add(op.left);
            usedByBitwise.add(op.right);
          } else usedByBitwise.add(op.operand);
        } else if (op.kind === "binary" && op.operator === ">>>") {
          // `>>>` only reads the low 32 bits of its operands (like `>>`),
          // though its output is uint32 so it is not added to `bitwiseIds`.
          usedByBitwise.add(op.left);
          usedByBitwise.add(op.right);
        } else if (
          op.kind === "binary" &&
          (op.operator === "+" || op.operator === "-")
        ) {
          usedByAddSub.add(op.left);
          usedByAddSub.add(op.right);
        } else {
          visitInstructionOperands(op, (v) => usedByOther.add(v));
        }
      }
      visitTerminatorOperands(t, (v) => usedByOther.add(v));
      for (const [valId, slot] of loadSlots) {
        if (usedByOther.has(valId)) {
          disqualified.add(slot);
        } else if (usedByAddSub.has(valId)) {
          needsEntryInt32.add(slot);
          addSubReadCount.set(slot, (addSubReadCount.get(slot) ?? 0) + 1);
        } else if (!usedByBitwise.has(valId)) {
          disqualified.add(slot);
        }
      }
    }
    if (!valid) continue;

    const accs: number[] = [],
      guardedAccs: { readonly slot: number; readonly checkNegZero: boolean }[] =
        [];
    let bodyInsts = 0;
    for (const id of loop.body)
      bodyInsts += current.blocks[id]?.instructions.length ?? 0;
    for (const slot of writtenInLoop) {
      if (
        !readInLoop.has(slot) ||
        disqualified.has(slot) ||
        current.slots[slot] !== "number"
      )
        continue;
      const alwaysWritten = isAlwaysWrittenPerIteration(
        current.blocks,
        loop.body,
        loop.header,
        hTerm.consequent,
        exitTarget,
        slot,
      );
      const requireInt32 = needsEntryInt32.has(slot) || !alwaysWritten;
      if (requireInt32) {
        if ((addSubReadCount.get(slot) ?? 0) > (writeCount.get(slot) ?? 0))
          continue;
        if (
          isInt32AtEntry(
            current,
            preheaderId,
            slot,
            Math.max(1, budget - visited),
          )
        ) {
          accs.push(slot);
        } else if (
          bodyInsts <= 2000 &&
          isDefinitelyInitializedAt(current, preheaderId, slot)
        ) {
          accs.push(slot);
          guardedAccs.push({ slot, checkNegZero: !alwaysWritten });
        }
      } else if (isDefinitelyInitializedAt(current, preheaderId, slot)) {
        accs.push(slot);
      }
    }
    if (accs.length === 0) continue;

    const candSlots = current.slots.slice(),
      candBlocks = current.blocks.slice(),
      accToInt = new Map<number, number>();
    let candNextValue = nextValue;
    for (const acc of accs) {
      const intSlot = candSlots.length;
      candSlots.push("number");
      accToInt.set(acc, intSlot);
    }

    // If any accumulator requires a dynamic int32 entry guard (e.g. after a
    // call that isn't statically proven int32), clone `loop.body` as a cold
    // fallback for non-int32 / -0 entry values.
    let coldHeader = -1;
    if (guardedAccs.length > 0) {
      const copies = new Map<number, number>();
      for (const id of loop.body) {
        copies.set(id, candBlocks.length);
        candBlocks.push({
          id: candBlocks.length,
          instructions: [],
          terminator: { kind: "trap", start: 0, end: 0 },
        });
      }
      const route = (t: number): number => copies.get(t) ?? t,
        copySub = new Uint32Array(candNextValue);
      for (const id of loop.body) {
        const orig = current.blocks[id],
          copyId = copies.get(id);
        if (orig === undefined || copyId === undefined) continue;
        copySub.fill(0);
        const insts: Instruction[] = [];
        for (const op of orig.instructions) {
          if (op === undefined) continue;
          const s = substituteInstructionValues(op, copySub),
            r = instructionResult(op);
          if (r !== undefined) {
            const renamed = candNextValue++;
            copySub[r] = renamed + 1;
            insts.push(renumberInstructionResult(s, renamed));
          } else insts.push(s);
        }
        candBlocks[copyId] = {
          id: copyId,
          instructions: insts,
          terminator: retarget(
            substituteTerminatorValues(orig.terminator, copySub),
            route,
          ),
        };
      }
      coldHeader = copies.get(loop.header) ?? -1;
      if (coldHeader < 0) continue;
    }

    // Clone the pure header check once in preheader: 0-iteration loops skip
    // initialization and exit untouched; >=1-iteration loops check any dynamic
    // int32 entry guards, then initialize `intAcc = acc | 0`.
    const entryCheckId = candBlocks.length,
      initId = entryCheckId + 1,
      wbId = entryCheckId + 2;

    const subst = new Uint32Array(candNextValue),
      checkInsts: Instruction[] = [];
    for (const op of condBlock.instructions) {
      if (op === undefined) continue;
      const s = substituteInstructionValues(op, subst),
        r = instructionResult(op);
      if (r !== undefined) {
        const renamed = candNextValue++;
        subst[r] = renamed + 1;
        checkInsts.push(renumberInstructionResult(s, renamed));
      } else checkInsts.push(s);
    }
    const checkTerm = substituteTerminatorValues(hTerm, subst);
    if (checkTerm.kind !== "branch") continue;
    candBlocks[preheaderId] = {
      ...preheader,
      terminator: { kind: "jump", target: entryCheckId, start: 0, end: 0 },
    };
    const firstAfterEntry = guardedAccs.length > 0 ? wbId + 1 : initId;
    candBlocks.push({
      id: entryCheckId,
      instructions: checkInsts,
      terminator: {
        ...checkTerm,
        consequent: firstAfterEntry,
        alternate: exitTarget,
      },
    });

    const initInsts: Instruction[] = [];
    for (const [acc, intSlot] of accToInt) {
      const vOld = candNextValue++,
        vZero = candNextValue++,
        vInt = candNextValue++;
      initInsts.push(
        { kind: "load", id: vOld, slot: acc, start: 0, end: 0 },
        { kind: "constant", id: vZero, value: 0, start: 0, end: 0 },
        {
          kind: "binary",
          id: vInt,
          operator: "|",
          left: vOld,
          right: vZero,
          start: 0,
          end: 0,
        },
        { kind: "store", slot: intSlot, value: vInt, start: 0, end: 0 },
      );
    }
    candBlocks.push({
      id: initId,
      instructions: initInsts,
      terminator: { kind: "jump", target: loop.header, start: 0, end: 0 },
    });

    const wbInsts: Instruction[] = [];
    for (const [acc, intSlot] of accToInt) {
      const v = candNextValue++;
      if (!needsEntryInt32.has(acc)) {
        const vZero = candNextValue++,
          vExt = candNextValue++;
        wbInsts.push(
          { kind: "load", id: v, slot: intSlot, start: 0, end: 0 },
          { kind: "constant", id: vZero, value: 0, start: 0, end: 0 },
          {
            kind: "binary",
            id: vExt,
            operator: "|",
            left: v,
            right: vZero,
            start: 0,
            end: 0,
          },
          { kind: "store", slot: acc, value: vExt, start: 0, end: 0 },
        );
      } else {
        wbInsts.push(
          { kind: "load", id: v, slot: intSlot, start: 0, end: 0 },
          { kind: "store", slot: acc, value: v, start: 0, end: 0 },
        );
      }
    }
    candBlocks.push({
      id: wbId,
      instructions: wbInsts,
      terminator: { kind: "jump", target: exitTarget, start: 0, end: 0 },
    });

    // Emit chained dynamic int32 entry guards (each checks `acc === (acc | 0)`,
    // and when `checkNegZero` is set, also rejects `-0` via `acc !== 0 || 1 / acc > 0`).
    for (let gi = 0; gi < guardedAccs.length; gi++) {
      const g = guardedAccs[gi];
      if (g === undefined) continue;
      const eqBlockId = candBlocks.length,
        isLast = gi === guardedAccs.length - 1;
      const vAcc = candNextValue++,
        vZero = candNextValue++,
        vInt = candNextValue++,
        vEq = candNextValue++;
      const eqTarget = g.checkNegZero
        ? eqBlockId + 1
        : isLast
          ? initId
          : eqBlockId + 1;
      candBlocks.push({
        id: eqBlockId,
        instructions: [
          { kind: "load", id: vAcc, slot: g.slot, start: 0, end: 0 },
          { kind: "constant", id: vZero, value: 0, start: 0, end: 0 },
          {
            kind: "binary",
            id: vInt,
            operator: "|",
            left: vAcc,
            right: vZero,
            start: 0,
            end: 0,
          },
          {
            kind: "binary",
            id: vEq,
            operator: "===",
            left: vAcc,
            right: vInt,
            start: 0,
            end: 0,
          },
        ],
        terminator: {
          kind: "branch",
          condition: vEq,
          consequent: eqTarget,
          alternate: coldHeader,
          start: 0,
          end: 0,
        },
      });
      if (g.checkNegZero) {
        const nzBlockId = candBlocks.length,
          invBlockId = nzBlockId + 1,
          nextTarget = isLast ? initId : invBlockId + 1;
        const vAcc2 = candNextValue++,
          vZero2 = candNextValue++,
          vNz = candNextValue++;
        candBlocks.push({
          id: nzBlockId,
          instructions: [
            { kind: "load", id: vAcc2, slot: g.slot, start: 0, end: 0 },
            { kind: "constant", id: vZero2, value: 0, start: 0, end: 0 },
            {
              kind: "binary",
              id: vNz,
              operator: "!==",
              left: vAcc2,
              right: vZero2,
              start: 0,
              end: 0,
            },
          ],
          terminator: {
            kind: "branch",
            condition: vNz,
            consequent: nextTarget,
            alternate: invBlockId,
            start: 0,
            end: 0,
          },
        });
        const vAcc3 = candNextValue++,
          vOne = candNextValue++,
          vInv = candNextValue++,
          vZero3 = candNextValue++,
          vPos = candNextValue++;
        candBlocks.push({
          id: invBlockId,
          instructions: [
            { kind: "load", id: vAcc3, slot: g.slot, start: 0, end: 0 },
            { kind: "constant", id: vOne, value: 1, start: 0, end: 0 },
            {
              kind: "binary",
              id: vInv,
              operator: "/",
              left: vOne,
              right: vAcc3,
              start: 0,
              end: 0,
            },
            { kind: "constant", id: vZero3, value: 0, start: 0, end: 0 },
            {
              kind: "binary",
              id: vPos,
              operator: ">",
              left: vInv,
              right: vZero3,
              start: 0,
              end: 0,
            },
          ],
          terminator: {
            kind: "branch",
            condition: vPos,
            consequent: nextTarget,
            alternate: coldHeader,
            start: 0,
            end: 0,
          },
        });
      }
    }

    for (const id of loop.body) {
      const b = candBlocks[id];
      if (b === undefined) continue;
      const rewritten: Instruction[] = [];
      for (const op of b.instructions) {
        if (op === undefined) continue;
        if (op.kind === "load") {
          const mapped = accToInt.get(op.slot);
          rewritten.push(mapped === undefined ? op : { ...op, slot: mapped });
        } else if (op.kind === "store") {
          const mapped = accToInt.get(op.slot);
          rewritten.push(mapped === undefined ? op : { ...op, slot: mapped });
        } else rewritten.push(op);
      }
      candBlocks[id] = {
        ...b,
        instructions: rewritten,
        terminator: retarget(b.terminator, (t) =>
          t === exitTarget ? wbId : t,
        ),
      };
    }

    const debug =
      current.debug === undefined
        ? undefined
        : retainDebugValues(current, candBlocks);
    const candidate: FunctionIR =
      debug === undefined
        ? { ...current, slots: candSlots, blocks: candBlocks }
        : { ...current, slots: candSlots, blocks: candBlocks, debug };
    if (!recordReadsKept(current, candidate)) continue;
    current = candidate;
    nextValue = candNextValue;
    promoted += accs.length;
    for (const id of loop.body) touched.add(id);
    touched.add(preheaderId);
  }
  return { fn: current, visited, promoted };
}
