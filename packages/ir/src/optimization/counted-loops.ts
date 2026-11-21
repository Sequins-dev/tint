import {
  analyzeLiveSlots,
  instructionResult,
  naturalLoops,
  provenInductionWords,
  provenRecordReads,
  verifierRecordWork,
  substituteInstructionValues,
  substituteTerminatorValues,
  renumberInstructionResult,
  type Block,
  type FunctionIR,
  type Instruction,
  type NaturalLoop,
  type ScalarType,
  type SlotBinding,
  type Terminator,
} from "../scalar/index.ts";
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
 * fresh double slot; the loop itself is not duplicated on the hot path.
 *
 * Counters the induction proof already accepts are left alone. The
 * rewrite is kept only when the induction proof accepts the counter,
 * the counter is dead where the loop exits (the copy never writes it back)
 * and the loop indexes with it. Loops with exception handlers, transfers
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
    bounded = 0;
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
    const live = analyzeLiveSlots(current, budget - visited, [
      candidate.counter,
    ]);
    if (live === undefined) return undefined;
    visited += live.work;
    let liveAfter = false,
      joined = false;
    for (const id of candidate.exits) {
      if (id === undefined) throw "counted loop exit invariant";
      if ((live.slots[id]?.length ?? 0) > 0) liveAfter = true;
      if (predecessors[id]?.length === 1) joined = true;
    }
    if (liveAfter) {
      missed("counter is live after the loop");
      continue;
    }
    const result = boundLoop(current, loop, candidate, startValue, nextValue);
    visited += result.visited;
    if (visited > budget) return undefined;
    // The copy's exits join the loop's: a record read proven along the
    // unique-predecessor chain through an exit must stay proven.
    if (joined && !recordReadsKept(current, result.fn)) {
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
  return { fn: current, visited, bounded };
}

/** Whether every record read `before` proves (as the verifier does, with
 * or without module-stable layouts) is still proven in `after`, where
 * existing record reads keep their result IDs. */
export function recordReadsKept(
  before: FunctionIR,
  after: FunctionIR,
): boolean {
  for (let pass = 0; pass < 2; pass++) {
    const stable = pass === 1;
    const kept = provenRecordReads(before, verifierRecordWork, stable);
    if (kept === undefined) return false;
    const now = provenRecordReads(after, verifierRecordWork, stable);
    if (now === undefined) return false;
    for (let id = 0; id < kept.length; id++)
      if (kept[id] === 1 && now[id] !== 1) return false;
  }
  return true;
}

interface CountedLoop {
  readonly preheader: number;
  readonly counter: number;
  readonly bound: number;
  /** The header's condition and its block position. */
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
  const term = header.terminator;
  // The body runs only while the test holds.
  if (
    term.kind !== "branch" ||
    !loop.body.has(term.consequent) ||
    loop.body.has(term.alternate)
  )
    return undefined;
  let condition: Instruction | undefined;
  const loaded = new Map<number, number>();
  for (const op of header.instructions) {
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
  // The benefit: the counter indexes an array, vector or list (a call's
  // argument, as inline list accessors take it), which a double index
  // first converts and checks.
  let instructions = 0,
    indexUses = 0;
  const exits: number[] = [];
  for (const id of loop.body) {
    if (id === undefined) throw "counted loop body invariant";
    const block = fn.blocks[id];
    if (block === undefined) throw "counted loop block invariant";
    if (block.exception !== undefined) return undefined;
    const t = block.terminator;
    if (
      (t.kind === "record" || t.kind === "record-cell" || t.kind === "cell") &&
      (t.slot === counter || t.slot === bound)
    )
      return undefined;
    for (const target of successors(t)) {
      if (target === undefined) throw "counted loop successor invariant";
      if (!loop.body.has(target) && !exits.includes(target)) exits.push(target);
    }
    const loads = new Set<number>();
    for (const op of block.instructions) {
      if (op === undefined) throw "counted loop instruction invariant";
      instructions++;
      if (op.kind === "load" && op.slot === counter) loads.add(op.id);
      else if (
        (op.kind === "string-code-unit" ||
          op.kind === "reference-vector-read" ||
          op.kind === "reference-vector-write" ||
          op.kind === "array-valid" ||
          op.kind === "array-read" ||
          op.kind === "array-element" ||
          op.kind === "array-write" ||
          op.kind === "array-store") &&
        loads.has(op.index)
      )
        indexUses++;
      else if (op.kind === "call")
        for (const argument of op.arguments)
          if (argument !== undefined && loads.has(argument)) indexUses++;
    }
  }
  if (instructions > maxBoundedInstructions || indexUses === 0)
    return undefined;
  return {
    preheader: preheaderId,
    counter,
    bound,
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
  const start0 = candidate.start,
    end0 = candidate.end;
  // The cold copy: every body block, the counter renamed, exits unchanged.
  const copies = new Map<number, number>();
  for (const id of loop.body) {
    if (id === undefined) throw "counted loop body invariant";
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
    if (original === undefined) throw "counted loop body invariant";
    const block = fn.blocks[original],
      copyId = copies.get(original);
    if (block === undefined || copyId === undefined)
      throw "counted loop block invariant";
    substitution.fill(0);
    const instructions: Instruction[] = [];
    for (const op of block.instructions) {
      if (op === undefined) throw "counted loop instruction invariant";
      visited++;
      const substituted = substituteInstructionValues(op, substitution),
        result = instructionResult(op);
      let copied = substituted;
      if (result !== undefined) {
        const renamed = nextValue++;
        substitution[result] = renamed + 1;
        copied = renumberInstructionResult(substituted, renamed);
      }
      if (copied.kind === "load" && copied.slot === candidate.counter)
        instructions.push({ ...copied, slot: coldCounter });
      else if (copied.kind === "store" && copied.slot === candidate.counter)
        instructions.push({ ...copied, slot: coldCounter });
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
  const coldHeader = copies.get(loop.header);
  if (coldHeader === undefined) throw "counted loop entry invariant";
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
  // The preheader enters the cold copy only for bounds above 2^32 - 1.
  const preheader = fn.blocks[candidate.preheader];
  if (preheader === undefined) throw "counted loop preheader invariant";
  const tested = nextValue++,
    limit = nextValue++,
    above = nextValue++;
  const guard: Instruction[] = preheader.instructions.slice();
  guard.push({
    kind: "load",
    id: tested,
    slot: candidate.bound,
    start: start0,
    end: end0,
  });
  guard.push({
    kind: "constant",
    id: limit,
    value: maxWordBound,
    start: start0,
    end: end0,
  });
  guard.push({
    kind: "binary",
    id: above,
    operator: ">",
    left: tested,
    right: limit,
    start: start0,
    end: end0,
  });
  const branch: Terminator = {
    kind: "branch",
    condition: above,
    consequent: coldEntry,
    alternate: hotEntry,
    start: start0,
    end: end0,
  };
  const exception = preheader.exception;
  blocks[candidate.preheader] =
    exception === undefined
      ? { id: preheader.id, instructions: guard, terminator: branch }
      : {
          id: preheader.id,
          instructions: guard,
          terminator: branch,
          exception,
        };
  // The header compares the counter with the word bound.
  const header = fn.blocks[loop.header];
  if (header === undefined) throw "counted loop header invariant";
  const reloaded = nextValue++,
    instructions: Instruction[] = [];
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
  const headerException = header.exception;
  blocks[loop.header] =
    headerException === undefined
      ? { id: header.id, instructions, terminator: header.terminator }
      : {
          id: header.id,
          instructions,
          terminator: header.terminator,
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
