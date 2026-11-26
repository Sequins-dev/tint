import {
  analyzeLiveSlots,
  naturalLoops,
  instructionResult,
  substituteInstructionValues,
  substituteTerminatorValues,
  visitInstructionOperands,
  visitTerminatorOperands,
  type Block,
  type FunctionIR,
  type Instruction,
  type ScalarType,
  type Terminator,
} from "../scalar/index.ts";
import type { RemarkSink } from "./observer.ts";

/** Interval facts over number slots and values: `integer` intervals hold
 * only finite integral numbers (never NaN) within [lo, hi], and -0 only when
 * `negativeZero` (then 0 is within [lo, hi]); other intervals carry no proof.
 * Bounds and comparisons treat -0 as 0, but `1 / x` and Object.is observe its
 * sign, so integer representations (integer slots) need intervals without
 * it. */
interface Interval {
  readonly lo: number;
  readonly hi: number;
  readonly integer: boolean;
  readonly negativeZero: boolean;
}
const top: Interval = {
  lo: -Infinity,
  hi: Infinity,
  integer: false,
  negativeZero: true,
};
const exact = 9007199254740992;
/** An integer interval; a -0 bound is normalized to 0. */
function integerInterval(
  lo: number,
  hi: number,
  negativeZero: boolean,
): Interval {
  return {
    lo: lo === 0 ? 0 : lo,
    hi: hi === 0 ? 0 : hi,
    integer: true,
    negativeZero: negativeZero && lo <= 0 && hi >= 0,
  };
}
function constant(value: number): Interval {
  return Number.isInteger(value)
    ? integerInterval(value, value, value === 0 && 1 / value < 0)
    : top;
}
function bounded(interval: Interval): boolean {
  return interval.integer && interval.lo >= -exact && interval.hi <= exact;
}
function hasZero(interval: Interval): boolean {
  return interval.lo <= 0 && interval.hi >= 0;
}
function add(left: Interval, right: Interval, sign: number): Interval {
  if (!left.integer || !right.integer) return top;
  const lo = sign > 0 ? left.lo + right.lo : left.lo - right.hi,
    hi = sign > 0 ? left.hi + right.hi : left.hi - right.lo;
  // A finite integer plus a bounded one cannot overflow to infinity (it
  // saturates by rounding long before), so an unbounded side stays sound
  // when the other is bounded.
  if (!bounded(left) && !bounded(right)) return top;
  // -0 + -0 and -0 - 0 are -0; every other sum of integers is +0 or nonzero.
  return integerInterval(
    lo,
    hi,
    left.negativeZero && (sign > 0 ? right.negativeZero : hasZero(right)),
  );
}
function multiply(left: Interval, right: Interval): Interval {
  if (!bounded(left) || !bounded(right)) return top;
  const products = [
    left.lo * right.lo,
    left.lo * right.hi,
    left.hi * right.lo,
    left.hi * right.hi,
  ];
  let lo = Infinity,
    hi = -Infinity;
  for (const product of products) {
    if (product === undefined) continue;
    if (product < lo) lo = product;
    if (product > hi) hi = product;
  }
  // A zero factor yields -0 against a negative factor or -0, and a -0
  // factor against a positive one.
  const negativeZero =
    (hasZero(left) && (right.lo < 0 || right.negativeZero)) ||
    (hasZero(right) && (left.lo < 0 || left.negativeZero)) ||
    (left.negativeZero && right.hi > 0) ||
    (right.negativeZero && left.hi > 0);
  return lo >= -exact && hi <= exact
    ? integerInterval(lo, hi, negativeZero)
    : top;
}
function remainder(left: Interval, right: Interval): Interval {
  // Non-negative finite integers modulo a positive integer (below the
  // largest divisor, and no larger than the dividend).
  if (!bounded(left) || left.lo < 0 || !right.integer || right.lo < 1)
    return top;
  // The remainder takes the dividend's sign: -0 only from -0.
  return integerInterval(0, Math.min(left.hi, right.hi - 1), left.negativeZero);
}
/** Math.min/Math.max of two integer intervals (the result is one of the
 * operands, so -0 only from a -0 operand). */
function extremum(left: Interval, right: Interval, min: boolean): Interval {
  if (!left.integer || !right.integer) return top;
  const negativeZero = left.negativeZero || right.negativeZero;
  return min
    ? integerInterval(
        Math.min(left.lo, right.lo),
        Math.min(left.hi, right.hi),
        negativeZero,
      )
    : integerInterval(
        Math.max(left.lo, right.lo),
        Math.max(left.hi, right.hi),
        negativeZero,
      );
}
function join(left: Interval, right: Interval): Interval {
  if (!left.integer || !right.integer) return top;
  return integerInterval(
    Math.min(left.lo, right.lo),
    Math.max(left.hi, right.hi),
    left.negativeZero || right.negativeZero,
  );
}
function same(left: Interval, right: Interval): boolean {
  return (
    left.integer === right.integer &&
    left.lo === right.lo &&
    left.hi === right.hi &&
    left.negativeZero === right.negativeZero
  );
}
function sameState(left: SparseState, right: SparseState): boolean {
  if (left.slots.length !== right.slots.length) return false;
  for (let i = 0; i < left.slots.length; i++) {
    const ls = left.slots[i],
      rs = right.slots[i],
      li = left.intervals[i],
      ri = right.intervals[i];
    if (ls !== rs || li === undefined || ri === undefined || !same(li, ri))
      return false;
  }
  return true;
}
/** Visits after which any block widens every slot still changing. */
const widenAnyAfter = 16;
/** Widening with int32/uint32 thresholds: stops at 32-bit integer boundaries
 * before jumping to infinity so forward joins of 0 and array-length keep their
 * uint32 proof across enclosing loops while still converging in <= 5 steps. */
function widen(previous: Interval, next: Interval): Interval {
  if (!previous.integer || !next.integer) return top;
  let lo = previous.lo;
  if (next.lo < previous.lo)
    lo = next.lo >= -2147483648 ? -2147483648 : -Infinity;
  let hi = previous.hi;
  if (next.hi > previous.hi)
    hi =
      next.hi <= 2147483647
        ? 2147483647
        : next.hi <= 4294967295
          ? 4294967295
          : Infinity;
  return integerInterval(lo, hi, previous.negativeZero || next.negativeZero);
}

/** A block-entry state: the integer intervals of tracked slots (by tracked
 * index), in parallel arrays; every other slot is top. */
interface SparseState {
  readonly slots: readonly number[];
  readonly intervals: readonly Interval[];
}
const emptyState: SparseState = { slots: [], intervals: [] };

/** Relational facts between number slots and sequence slots (strings and
 * typed arrays, whose lengths never change once created): Len(L, S, c) when
 * slot L holds the length of the sequence slot S holds minus c, Less(I, S, c)
 * when slot I holds a number whose sum with c is below that length. Offsets
 * c run from 0 to `maximumOffset`; Less facts are closed downward (Less(I, S,
 * c) brings every smaller offset), so meeting by intersection keeps implied
 * facts. Keys are ((c * slots + first) * slots + sequence) * 2, plus 1 for
 * Less. Facts come from instructions (storing a sequence length of S's
 * current value — a load of S or the value last stored to S — minus a
 * constant, or a copy of a slot) and from both edges of comparisons of
 * an index load (plus a constant) with such a length (`I + k < len - c`,
 * `I + k <= len - c`, in either operand order), comparing loads not
 * overwritten before the branch; any store to either slot, a terminator
 * transfer into it and exception entries end them. Block entry facts meet by
 * intersection. An access to S at `I`, `I + d` (d <= c) or `I - d` (d >= 0)
 * is then below the length; its interval proves the rest (an integer, not
 * negative). */
const maximumOffset = 7;
/** A sequence slot and how much less than its length a value is. */
interface SequenceLength {
  readonly sequence: number;
  readonly offset: number;
}
interface SequenceIndexWalk {
  /** Facts before the terminator. */
  readonly out: Set<number>;
  /** Facts a branch on such a comparison adds to each edge. */
  readonly taken: readonly number[];
  readonly untaken: readonly number[];
}
function copyFacts(facts: ReadonlySet<number>): Set<number> {
  const copy = new Set<number>();
  for (const key of facts) if (key !== undefined) copy.add(key);
  return copy;
}
interface SequenceIndexAnalysis {
  /** Interprets `block` from `facts`; `visit` receives each string code
   * unit and typed-array read or write whose index is proven below the
   * length of the sequence it accesses. */
  readonly walk: (
    block: Block,
    facts: ReadonlySet<number>,
    visit: (op: Instruction) => void,
  ) => SequenceIndexWalk;
  /** Converged entry facts by block ID, or undefined on exhaustion. */
  readonly entries: Map<number, Set<number>> | undefined;
  readonly work: number;
}
function analyzeSequenceIndices(
  fn: FunctionIR,
  byId: ReadonlyMap<number, Block>,
  blockValues: ReadonlyMap<number, ReadonlyMap<number, Interval>>,
  budget: number,
): SequenceIndexAnalysis {
  const slots = fn.slots.length;
  let work = 0;
  const key = (
    kind: number,
    offset: number,
    first: number,
    sequence: number,
  ): number => ((offset * slots + first) * slots + sequence) * 2 + kind;
  /** Less(index, sequence, offset) and every smaller offset. */
  function addLess(
    into: number[],
    index: number,
    sequence: number,
    offset: number,
  ): void {
    if (index === sequence) return;
    for (let c = Math.min(offset, maximumOffset); c >= 0; c--)
      into.push(key(1, c, index, sequence));
  }
  function walk(
    block: Block,
    facts: ReadonlySet<number>,
    visit: (op: Instruction) => void,
  ): SequenceIndexWalk {
    const live = copyFacts(facts),
      values = blockValues.get(block.id),
      loadSlot = new Map<number, number>(),
      loadAt = new Map<number, number>(),
      lastStore = new Map<number, number>(),
      constants = new Map<number, number>(),
      // Values stored to a slot: the slot and the position of the store.
      storedSlot = new Map<number, number>(),
      storedAt = new Map<number, number>(),
      // Lengths read in this block: the sequence slot, the position after
      // which it must not be overwritten, and the constant subtracted since.
      lengthOf = new Map<
        number,
        {
          readonly sequence: number;
          readonly at: number;
          readonly offset: number;
        }
      >(),
      // Loads of slots (possibly length slots) minus a constant.
      slotMinus = new Map<
        number,
        { readonly load: number; readonly offset: number }
      >(),
      // Index loads plus a constant (negative for subtraction).
      indexPlus = new Map<
        number,
        { readonly load: number; readonly delta: number }
      >(),
      // Values masked by a non-negative 31-bit (length - offset) mask, so
      // `0 <= value <= length - offset` (`value + (offset - 1) < length`).
      maskedLess = new Map<number, SequenceLength[]>();
    const kill = (slot: number): void => {
      const doomed: number[] = [];
      for (const fact of live) {
        if (fact === undefined) continue;
        const pair = Math.floor(fact / 2),
          rest = Math.floor(pair / slots);
        if (pair % slots === slot || rest % slots === slot) doomed.push(fact);
      }
      for (const fact of doomed) if (fact !== undefined) live.delete(fact);
    };
    /** The slot a value was loaded from, if not stored since the load, or
     * the slot it was stored to, if that store is the slot's last. */
    const current = (value: number): number => {
      const slot = loadSlot.get(value),
        at = loadAt.get(value);
      if (slot !== undefined && at !== undefined)
        return (lastStore.get(slot) ?? -1) < at ? slot : -1;
      const stored = storedSlot.get(value),
        storedPosition = storedAt.get(value);
      if (stored === undefined || storedPosition === undefined) return -1;
      return lastStore.get(stored) === storedPosition ? stored : -1;
    };
    /** Sequences whose length minus the offset `value` holds, now. */
    const lengthsOf = (value: number): SequenceLength[] => {
      const found: SequenceLength[] = [];
      const direct = lengthOf.get(value);
      if (
        direct !== undefined &&
        (lastStore.get(direct.sequence) ?? -1) < direct.at
      )
        found.push({ sequence: direct.sequence, offset: direct.offset });
      const derived = slotMinus.get(value);
      const slot = derived === undefined ? -1 : current(derived.load);
      if (derived !== undefined && slot >= 0)
        for (const fact of live) {
          if (fact === undefined || fact % 2 !== 0) continue;
          const pair = Math.floor(fact / 2),
            rest = Math.floor(pair / slots);
          if (rest % slots !== slot) continue;
          const offset = Math.floor(rest / slots) + derived.offset;
          if (offset <= maximumOffset)
            found.push({ sequence: pair % slots, offset });
        }
      return found;
    };
    /** The index slot and constant delta `value` holds, now. */
    const indexOf = (
      value: number,
    ): { readonly slot: number; readonly delta: number } | undefined => {
      const direct = current(value);
      if (direct >= 0) return { slot: direct, delta: 0 };
      const plus = indexPlus.get(value);
      if (plus === undefined) return undefined;
      const slot = current(plus.load);
      return slot < 0 ? undefined : { slot, delta: plus.delta };
    };
    /** `index + delta` below the length of `sequence`, now. */
    const below = (value: number, sequenceValue: number): boolean => {
      const sequence = current(sequenceValue);
      if (sequence < 0) return false;
      const masked = maskedLess.get(value);
      if (masked !== undefined)
        for (const entry of masked)
          if (entry !== undefined && entry.sequence === sequence) return true;
      const index = indexOf(value);
      if (index === undefined) return false;
      return (
        index.delta <= maximumOffset &&
        live.has(key(1, Math.max(index.delta, 0), index.slot, sequence))
      );
    };
    for (let position = 0; position < block.instructions.length; position++) {
      const op = block.instructions[position];
      if (op === undefined) throw "sequence index instruction invariant";
      work += 1 + live.size;
      if (op.kind === "load") {
        loadSlot.set(op.id, op.slot);
        loadAt.set(op.id, position);
        slotMinus.set(op.id, { load: op.id, offset: 0 });
      } else if (op.kind === "reference-value") {
        // Unwrapping an optional-reference keeps the same underlying object.
        const slot = loadSlot.get(op.value),
          at = loadAt.get(op.value);
        if (slot !== undefined && at !== undefined) {
          loadSlot.set(op.id, slot);
          loadAt.set(op.id, at);
        } else {
          const stored = storedSlot.get(op.value),
            storedPosition = storedAt.get(op.value);
          if (stored !== undefined && storedPosition !== undefined) {
            storedSlot.set(op.id, stored);
            storedAt.set(op.id, storedPosition);
          }
        }
      } else if (op.kind === "constant") {
        const literal = op.value;
        if (typeof literal === "number") constants.set(op.id, literal);
      } else if (op.kind === "string-length" || op.kind === "array-length") {
        const operand = op.kind === "string-length" ? op.string : op.array,
          sequence = current(operand);
        if (
          sequence >= 0 &&
          (op.kind === "array-length" || fn.slots[sequence] === "string")
        ) {
          // The sequence slot must not be stored after the load (or after
          // the store that put the sequence there).
          const loaded = loadAt.get(operand),
            stored = storedAt.get(operand);
          lengthOf.set(op.id, {
            sequence,
            at:
              loaded !== undefined
                ? loaded
                : stored !== undefined
                  ? stored + 1
                  : 0,
            offset: 0,
          });
        }
      } else if (
        op.kind === "binary" &&
        (op.operator === "+" || op.operator === "-")
      ) {
        // A constant whose integer value keeps the sum exact.
        const amount = (value: number): number | undefined => {
          const literal = constants.get(value);
          return literal !== undefined &&
            Number.isInteger(literal) &&
            Math.abs(literal) <= maximumOffset
            ? literal
            : undefined;
        };
        const right = amount(op.right),
          left = amount(op.left);
        if (op.operator === "-" && right !== undefined && right >= 0) {
          const length = lengthOf.get(op.left);
          if (length !== undefined && length.offset + right <= maximumOffset)
            lengthOf.set(op.id, {
              sequence: length.sequence,
              at: length.at,
              offset: length.offset + right,
            });
          const slot = slotMinus.get(op.left);
          if (slot !== undefined && slot.offset + right <= maximumOffset)
            slotMinus.set(op.id, {
              load: slot.load,
              offset: slot.offset + right,
            });
        }
        const step =
          op.operator === "-"
            ? right === undefined
              ? undefined
              : -right
            : right;
        if (step !== undefined && loadSlot.has(op.left))
          indexPlus.set(op.id, { load: op.left, delta: step });
        else if (
          op.operator === "+" &&
          left !== undefined &&
          loadSlot.has(op.right)
        )
          indexPlus.set(op.id, { load: op.right, delta: left });
      } else if (op.kind === "binary" && op.operator === "&") {
        // `x & mask` with a non-negative 31-bit mask holding `S.length - c`
        // (`c >= 1`) satisfies `0 <= (x & mask) <= S.length - c`, so
        // `(x & mask) + (c - 1) < S.length`.
        const derived: SequenceLength[] = [];
        for (const side of [op.left, op.right]) {
          if (side === undefined || nonNegativeMaskHi(values?.get(side)) < 0)
            continue;
          for (const length of lengthsOf(side))
            if (length.offset >= 1)
              derived.push({
                sequence: length.sequence,
                offset: length.offset - 1,
              });
        }
        if (derived.length > 0) maskedLess.set(op.id, derived);
      } else if (op.kind === "string-code-unit") {
        if (below(op.index, op.string)) visit(op);
      } else if (op.kind === "array-read" || op.kind === "array-write") {
        if (below(op.index, op.array)) visit(op);
      } else if (op.kind === "store") {
        // A copy of a slot carries its facts (as counted-loop and LICM
        // preheaders copy lengths and indices).
        const source = current(op.value);
        const lengths = lengthsOf(op.value);
        const masked = maskedLess.get(op.value);
        kill(op.slot);
        lastStore.set(op.slot, position);
        if (source >= 0 && source !== op.slot) {
          const copied: number[] = [];
          for (const fact of live) {
            if (fact === undefined) continue;
            const kind = fact % 2,
              pair = Math.floor(fact / 2),
              sequence = pair % slots,
              rest = Math.floor(pair / slots),
              first = rest % slots,
              offset = Math.floor(rest / slots);
            if (first === source && sequence !== op.slot)
              copied.push(key(kind, offset, op.slot, sequence));
            else if (
              sequence === source &&
              first !== op.slot &&
              fn.slots[op.slot] === fn.slots[source]
            )
              copied.push(key(kind, offset, first, op.slot));
          }
          for (const fact of copied) if (fact !== undefined) live.add(fact);
        }
        if (!loadSlot.has(op.value)) {
          storedSlot.set(op.value, op.slot);
          storedAt.set(op.value, position);
        }
        for (const length of lengths)
          if (length.sequence !== op.slot)
            live.add(key(0, length.offset, op.slot, length.sequence));
        if (masked !== undefined) {
          const added: number[] = [];
          for (const entry of masked)
            if (entry !== undefined)
              addLess(added, op.slot, entry.sequence, entry.offset);
          for (const fact of added) if (fact !== undefined) live.add(fact);
        }
      }
    }
    const term = block.terminator;
    if (
      term.kind === "record" ||
      term.kind === "record-cell" ||
      term.kind === "cell"
    )
      kill(term.slot);
    const none: SequenceIndexWalk = { out: live, taken: [], untaken: [] };
    if (term.kind !== "branch") return none;
    const condition = findDefinition(block, term.condition);
    if (condition === undefined || condition.kind !== "binary") return none;
    const taken: number[] = [],
      untaken: number[] = [];
    // `index + k < bound - c` (strict) or `<=` on each edge, by operator and
    // which side holds the index.
    const relate = (
      indexValue: number,
      boundValue: number,
      strictTaken: boolean | undefined,
      strictUntaken: boolean | undefined,
    ): void => {
      const index = indexOf(indexValue);
      if (index === undefined || index.delta < 0) return;
      for (const length of lengthsOf(boundValue)) {
        // `index + k < len - c` is Less(c + k); `<=` one offset less.
        const strict = length.offset + index.delta;
        if (strictTaken !== undefined)
          addLess(
            taken,
            index.slot,
            length.sequence,
            strictTaken ? strict : strict - 1,
          );
        if (strictUntaken !== undefined)
          addLess(
            untaken,
            index.slot,
            length.sequence,
            strictUntaken ? strict : strict - 1,
          );
      }
    };
    switch (condition.operator) {
      case "<":
        // taken: left < right; untaken: right <= left.
        relate(condition.left, condition.right, true, undefined);
        relate(condition.right, condition.left, undefined, false);
        break;
      case "<=":
        relate(condition.left, condition.right, false, undefined);
        relate(condition.right, condition.left, undefined, true);
        break;
      case ">":
        relate(condition.right, condition.left, true, undefined);
        relate(condition.left, condition.right, undefined, false);
        break;
      case ">=":
        relate(condition.right, condition.left, false, undefined);
        relate(condition.left, condition.right, undefined, true);
        break;
      default:
        break;
    }
    return { out: live, taken, untaken };
  }
  const entries = new Map<number, Set<number>>(),
    worklist: number[] = [fn.entry],
    queued = new Set<number>();
  queued.add(fn.entry);
  entries.set(fn.entry, new Set<number>());
  function meet(target: number, facts: Set<number>): void {
    const existing = entries.get(target);
    if (existing === undefined) entries.set(target, facts);
    else {
      const doomed: number[] = [];
      for (const fact of existing)
        if (fact !== undefined && !facts.has(fact)) doomed.push(fact);
      for (const fact of doomed) if (fact !== undefined) existing.delete(fact);
      work += existing.size + 1;
      if (doomed.length === 0) return;
    }
    if (!queued.has(target)) {
      queued.add(target);
      worklist.push(target);
    }
  }
  while (worklist.length > 0) {
    if (work > budget) return { walk, entries: undefined, work };
    const id = worklist.pop();
    if (id === undefined) throw "sequence index worklist invariant";
    queued.delete(id);
    const block = byId.get(id),
      entry = entries.get(id);
    if (block === undefined || entry === undefined)
      throw "sequence index block invariant";
    const result = walk(block, entry, (op: Instruction): void => {});
    if (block.exception !== undefined)
      meet(block.exception.target, new Set<number>());
    const term = block.terminator;
    if (term.kind === "jump") meet(term.target, copyFacts(result.out));
    else if (term.kind === "branch") {
      const taken = copyFacts(result.out),
        untaken = copyFacts(result.out);
      for (const fact of result.taken) if (fact !== undefined) taken.add(fact);
      for (const fact of result.untaken)
        if (fact !== undefined) untaken.add(fact);
      meet(term.consequent, taken);
      meet(term.alternate, untaken);
    } else if (
      term.kind === "record" ||
      term.kind === "record-cell" ||
      term.kind === "cell"
    ) {
      meet(term.consequent, copyFacts(result.out));
      meet(term.alternate, copyFacts(result.out));
    }
  }
  return { walk, entries, work };
}

export interface ArrayAccessSelection {
  readonly fn: FunctionIR;
  readonly visited: number;
  /** Typed-array accesses proven in bounds and selected unchecked. */
  readonly rewritten: number;
}

/** The largest safe integer, 2^53 - 1. */
const maxSafeInteger = 9007199254740991;
/** The integer an interval holds exactly, if it holds one. */
function constantOf(interval: Interval | undefined): number | undefined {
  return interval !== undefined &&
    interval.integer &&
    interval.lo === interval.hi &&
    !interval.negativeZero
    ? interval.lo
    : undefined;
}
/** Upper bound of an integer interval within [0, 2^31 - 1], else -1.
 * Bitwise `&` with any value in [0, hi] clears the sign bit and cannot set
 * bits above `hi`, so the result lies in [0, hi]. */
function nonNegativeMaskHi(interval: Interval | undefined): number {
  return interval !== undefined &&
    interval.integer &&
    interval.lo >= 0 &&
    interval.hi <= 2147483647
    ? interval.hi
    : -1;
}
/** Exact integer range of an in-bounds element read from an integer typed
 * array (never NaN, never -0), or undefined for floating-point or non-array
 * types. */
function integerArrayRange(type: ScalarType | undefined): Interval | undefined {
  if (type === undefined) return undefined;
  switch (type) {
    case "Uint8Array":
    case "Uint8ClampedArray":
      return integerInterval(0, 255, false);
    case "Int8Array":
      return integerInterval(-128, 127, false);
    case "Uint16Array":
      return integerInterval(0, 65535, false);
    case "Int16Array":
      return integerInterval(-32768, 32767, false);
    case "Uint32Array":
      return integerInterval(0, 4294967295, false);
    case "Int32Array":
      return integerInterval(-2147483648, 2147483647, false);
    default:
      return undefined;
  }
}
/** Selects unchecked typed-array accesses (`array-element`, `array-store`)
 * where the index is proven an integer within the array's length. Facts:
 * interval analysis over number slots (constants, + - * and % with integer
 * arithmetic, comparisons refining the branch edges they guard, widening at
 * revisited blocks), and fixed lengths of slots whose every write stores a
 * typed array created with a constant length (typed array lengths never
 * change). `x ?? c`, `x!` and presence tests of a selected read fold. */
export function selectArrayAccesses(
  fn: FunctionIR,
  budget: number,
  remarks?: RemarkSink,
): ArrayAccessSelection | undefined {
  let visited = 0;
  const slotCount = fn.slots.length;
  // Typed arrays: slots written only with new arrays, whose lengths (fixed
  // for a typed array) come from the converged intervals below.
  const lengths: (number | undefined)[] = [],
    arrayStores = new Map<
      number,
      { readonly block: number; readonly length: number }[]
    >();
  // Slots holding entry values or written by terminators and handlers.
  const opaque = new Uint8Array(slotCount),
    unknownArray = new Uint8Array(slotCount);
  for (const parameter of fn.parameters)
    if (parameter !== undefined) opaque[parameter] = 1;
  if (fn.receiverSlot !== undefined) opaque[fn.receiverSlot] = 1;
  const byId = new Map<number, Block>();
  for (const block of fn.blocks) {
    if (block === undefined) throw "bounds block invariant";
    byId.set(block.id, block);
    const exception = block.exception;
    if (exception !== undefined) opaque[exception.slot] = 1;
    const term = block.terminator;
    if (
      term.kind === "record" ||
      term.kind === "record-cell" ||
      term.kind === "cell"
    )
      opaque[term.slot] = 1;
    const created = new Map<number, number>();
    for (const op of block.instructions) {
      if (op === undefined) throw "bounds instruction invariant";
      if (visited >= budget) return undefined;
      visited++;
      if (op.kind === "array-new") created.set(op.id, op.length);
      else if (op.kind === "store") {
        const length = created.get(op.value);
        if (length === undefined) unknownArray[op.slot] = 1;
        else {
          let list = arrayStores.get(op.slot);
          if (list === undefined) {
            list = [];
            arrayStores.set(op.slot, list);
          }
          list.push({ block: block.id, length });
        }
      }
    }
  }
  // Functions without typed-array accesses still get integer slot facts
  // (loop counters over lists and strings).
  // Track only number slots whose values reach typed-array indices, array
  // lengths, comparisons or remainders (directly, through arithmetic, or
  // through stores into other tracked slots); states are dense over them.
  const relevant = new Uint8Array(slotCount);
  for (let changed = true; changed;) {
    changed = false;
    for (const block of fn.blocks) {
      if (block === undefined) throw "bounds block invariant";
      const dependencies = new Map<number, number[]>();
      const mark = (value: number): void => {
        for (const slot of dependencies.get(value) ?? [])
          if (slot !== undefined && relevant[slot] === 0) {
            relevant[slot] = 1;
            changed = true;
          }
      };
      const combine = (left: number, right: number): number[] => {
        const result: number[] = [];
        for (const slot of dependencies.get(left) ?? [])
          if (slot !== undefined) result.push(slot);
        for (const slot of dependencies.get(right) ?? [])
          if (slot !== undefined && !result.includes(slot)) result.push(slot);
        return result;
      };
      for (const op of block.instructions) {
        if (op === undefined) throw "bounds instruction invariant";
        if (visited >= budget) return undefined;
        visited++;
        if (op.kind === "load" && fn.slots[op.slot] === "number")
          dependencies.set(op.id, [op.slot]);
        else if (op.kind === "binary") {
          dependencies.set(op.id, combine(op.left, op.right));
          // Comparisons, remainders and bitwise ops consume integer/range facts.
          if (
            [
              "<",
              "<=",
              ">",
              ">=",
              "===",
              "!==",
              "%",
              "&",
              "|",
              "^",
              "<<",
              ">>",
              ">>>",
              "imul",
            ].includes(op.operator)
          ) {
            mark(op.left);
            mark(op.right);
          }
        } else if (op.kind === "unary")
          dependencies.set(op.id, combine(op.operand, op.operand));
        else if (op.kind === "optional-wrap")
          dependencies.set(op.id, combine(op.value, op.value));
        else if (
          op.kind === "array-read" ||
          op.kind === "array-write" ||
          op.kind === "array-element" ||
          op.kind === "array-store" ||
          op.kind === "array-valid" ||
          op.kind === "string-code-unit" ||
          op.kind === "reference-vector-read" ||
          op.kind === "reference-vector-write" ||
          op.kind === "general-element-load" ||
          op.kind === "general-element-store" ||
          op.kind === "general-slot-load" ||
          op.kind === "general-slot-store"
        )
          mark(op.index);
        else if (op.kind === "element-load" || op.kind === "element-store") {
          mark(op.index);
          if (op.cachedCount !== undefined) mark(op.cachedCount);
        } else if (op.kind === "array-new") mark(op.length);
        else if (op.kind === "string-slice") {
          mark(op.begin);
          mark(op.limit);
        } else if (op.kind === "store" && relevant[op.slot] === 1)
          mark(op.value);
      }
    }
  }
  // Dense index + 1 per tracked slot (0: untracked).
  const dense = new Uint32Array(slotCount);
  let trackedCount = 0;
  for (let slot = 0; slot < slotCount; slot++)
    if (relevant[slot] === 1) dense[slot] = ++trackedCount;
  const tracked = (slot: number): number => (dense[slot] ?? 0) - 1;
  if (trackedCount === 0)
    return {
      // Earlier safe integer facts are replaced whole (see below).
      fn:
        fn.safeIntegerSlots === undefined && fn.nonzeroSlots === undefined
          ? fn
          : {
              ...fn,
              ...(fn.safeIntegerSlots === undefined
                ? {}
                : { safeIntegerSlots: [], safeIntegerBounds: [] }),
              ...(fn.nonzeroSlots === undefined ? {} : { nonzeroSlots: [] }),
            },
      visited,
      rewritten: 0,
    };
  // Dataflow: an interval per tracked slot at each block entry, stored
  // sparsely as its integer intervals (any other interval is top) for slots
  // live into the block: a dead slot is stored before it is read, so its
  // interval proves nothing there. Work and memory follow live facts rather
  // than blocks x tracked slots, so the largest functions are analyzed too.
  const trackedSlots: number[] = [];
  for (let slot = 0; slot < slotCount; slot++)
    if (relevant[slot] === 1) trackedSlots.push(slot);
  const liveness = analyzeLiveSlots(fn, budget - visited, trackedSlots);
  if (liveness === undefined) return undefined;
  visited += liveness.work;
  const liveSlots = liveness.slots;
  // Dense scratch states (top outside the slots a block touches), reset
  // after each use, and generation stamps for membership tests.
  const scratch: Interval[] = [],
    hullScratch: Interval[] = [],
    incomingScratch: Interval[] = [];
  for (let index = 0; index < trackedCount; index++) {
    scratch.push(top);
    hullScratch.push(top);
    incomingScratch.push(top);
  }
  const liveStamps = new Uint32Array(trackedCount),
    touchedStamps = new Uint32Array(trackedCount);
  let liveGeneration = 0,
    touchedGeneration = 0;
  function fill(into: Interval[], state: SparseState): void {
    for (let at = 0; at < state.slots.length; at++)
      into[state.slots[at] ?? 0] = state.intervals[at] ?? top;
    visited += state.slots.length;
  }
  function reset(into: Interval[], slots: readonly number[]): void {
    for (const index of slots) if (index !== undefined) into[index] = top;
  }
  /** The tracked slots a block may make non-top: its entry facts and the
   * slots it stores. */
  function touchedBy(block: Block, entry: SparseState): number[] {
    touchedGeneration++;
    const touched: number[] = [];
    const touch = (index: number): void => {
      if (index < 0 || touchedStamps[index] === touchedGeneration) return;
      touchedStamps[index] = touchedGeneration;
      touched.push(index);
    };
    for (const index of entry.slots) if (index !== undefined) touch(index);
    for (const op of block.instructions) {
      if (op === undefined) throw "bounds instruction invariant";
      if (op.kind === "store") touch(tracked(op.slot));
    }
    return touched;
  }
  /** The integer intervals of `slots` in a dense state. */
  function collect(
    dense: readonly Interval[],
    slots: readonly number[],
  ): SparseState {
    const indices: number[] = [],
      intervals: Interval[] = [];
    for (const index of slots) {
      if (index === undefined) throw "bounds state invariant";
      const interval = dense[index] ?? top;
      if (!interval.integer) continue;
      indices.push(index);
      intervals.push(interval);
    }
    visited += slots.length;
    return { slots: indices, intervals };
  }
  /** `state` restricted to the slots live into `target`. */
  function pruned(target: number, state: SparseState): SparseState {
    liveGeneration++;
    const live = liveSlots[target] ?? [];
    for (const slot of live)
      if (slot !== undefined) {
        const index = tracked(slot);
        if (index >= 0) liveStamps[index] = liveGeneration;
      }
    const indices: number[] = [],
      intervals: Interval[] = [];
    for (let at = 0; at < state.slots.length; at++) {
      const index = state.slots[at] ?? 0;
      if (liveStamps[index] !== liveGeneration) continue;
      indices.push(index);
      intervals.push(state.intervals[at] ?? top);
    }
    visited += live.length + state.slots.length;
    return { slots: indices, intervals };
  }
  // Widening happens at loop headers, and only for the slots the loop
  // writes: a value an inner loop does not change keeps the bounds its
  // enclosing loop establishes.
  const forest = naturalLoops(fn, budget - visited);
  if (forest === undefined) return undefined;
  visited += forest.visited;
  const loopWrites = new Map<number, Set<number>>();
  for (const loop of forest.loops) {
    if (loop === undefined) throw "bounds loop invariant";
    const writes = new Set<number>();
    for (const slot of loop.writes) {
      const index = tracked(slot);
      if (index >= 0) writes.add(index);
    }
    loopWrites.set(loop.header, writes);
  }
  const entries = new Map<number, SparseState>(),
    visits = new Map<number, number>();
  entries.set(fn.entry, emptyState);
  const worklist: number[] = [fn.entry],
    queued = new Set<number>();
  queued.add(fn.entry);
  /** Joins `incoming` into `existing` (slots missing on either side are
   * top); `widenAt` > 0 widens changed slots as `merge` does. */
  function joined(
    existing: SparseState,
    incoming: SparseState,
    target: number,
    count: number,
  ): SparseState | undefined {
    fill(incomingScratch, incoming);
    const indices: number[] = [],
      intervals: Interval[] = [];
    let changed = false;
    for (let at = 0; at < existing.slots.length; at++) {
      const index = existing.slots[at] ?? 0,
        before = existing.intervals[at] ?? top;
      let after = join(before, incomingScratch[index] ?? top);
      // Loop headers widen the slots their loop writes. Any block still
      // changing after many visits widens too (cycles the loop forest
      // does not describe), so the fixpoint terminates in a bounded number
      // of rounds rather than relying on the work budget.
      if (
        count > 0 &&
        !same(after, before) &&
        ((count > 2 && (loopWrites.get(target)?.has(index) ?? false)) ||
          count > widenAnyAfter)
      )
        after = widen(before, after);
      if (!same(after, before)) changed = true;
      if (after.integer) {
        indices.push(index);
        intervals.push(after);
      }
    }
    reset(incomingScratch, incoming.slots);
    visited += existing.slots.length;
    return changed ? { slots: indices, intervals } : undefined;
  }
  function merge(target: number, state: SparseState): void {
    const existing = entries.get(target);
    if (existing === undefined) entries.set(target, pruned(target, state));
    else {
      const count = (visits.get(target) ?? 0) + 1;
      visits.set(target, count);
      const next = joined(existing, state, target, count);
      if (next === undefined) return;
      entries.set(target, next);
    }
    if (!queued.has(target)) {
      queued.add(target);
      worklist.push(target);
    }
  }
  /** Interprets a block from its entry state. `values` receives value
   * intervals, `loads` the slot a value was loaded from (while unchanged). */
  function run(
    block: Block,
    state: Interval[],
    values: Map<number, Interval>,
    loads: Map<number, number>,
    hull: Interval[] | undefined,
  ): void {
    const arrayTypes = new Map<number, ScalarType>(),
      readRanges = new Map<number, Interval>();
    for (const op of block.instructions) {
      if (op === undefined) throw "bounds instruction invariant";
      visited++;
      switch (op.kind) {
        case "constant": {
          const literal = op.value;
          if (typeof literal === "number") values.set(op.id, constant(literal));
          break;
        }
        case "load": {
          const slotType = fn.slots[op.slot];
          if (
            slotType !== undefined &&
            integerArrayRange(slotType) !== undefined
          )
            arrayTypes.set(op.id, slotType);
          const index = tracked(op.slot);
          if (index >= 0) {
            values.set(op.id, state[index] ?? top);
            loads.set(op.id, index);
          }
          break;
        }
        case "array-new":
          if (integerArrayRange(op.type) !== undefined)
            arrayTypes.set(op.id, op.type);
          break;
        case "reference-value": {
          const opType = op.type;
          if (opType !== undefined && integerArrayRange(opType) !== undefined)
            arrayTypes.set(op.id, opType);
          break;
        }
        case "array-element": {
          const range = integerArrayRange(arrayTypes.get(op.array));
          if (range !== undefined) values.set(op.id, range);
          break;
        }
        case "array-read": {
          const range = integerArrayRange(arrayTypes.get(op.array));
          if (range !== undefined) readRanges.set(op.id, range);
          break;
        }
        case "optional-value": {
          const range = readRanges.get(op.value);
          if (range !== undefined) values.set(op.id, range);
          break;
        }
        case "optional-value-or": {
          const range = readRanges.get(op.value),
            fallback = values.get(op.fallback);
          if (range !== undefined && fallback !== undefined)
            values.set(op.id, join(range, fallback));
          break;
        }
        case "store": {
          const index = tracked(op.slot);
          if (index >= 0) {
            const next = values.get(op.value) ?? top;
            state[index] = next;
            if (hull !== undefined)
              hull[index] = join(hull[index] ?? top, next);
            for (const [id, slot] of loads)
              if (slot === index) loads.delete(id);
            // A value stored directly into `slot` (and not overwritten before
            // the branch) equals `slot` at block exit, so branch comparisons
            // on that value refine `slot`.
            if (!loads.has(op.value)) loads.set(op.value, index);
          }
          break;
        }
        case "unary": {
          const operand = values.get(op.operand);
          if (op.operator === "uint32") {
            let lo = 0,
              hi = 4294967295;
            if (operand !== undefined && operand.integer) {
              lo = Math.max(lo, operand.lo);
              hi = Math.min(hi, operand.hi);
            }
            values.set(op.id, integerInterval(lo, hi, false));
            break;
          }
          if (operand === undefined || !operand.integer) break;
          if (op.operator === "trunc" || op.operator === "+")
            values.set(op.id, operand);
          else if (op.operator === "-")
            // Negating 0 yields -0.
            values.set(
              op.id,
              integerInterval(-operand.hi, -operand.lo, hasZero(operand)),
            );
          break;
        }
        case "array-length":
          // Typed array lengths are uint32.
          values.set(op.id, integerInterval(0, 4294967295, false));
          break;
        case "element-count":
          // Packed binary64 element counts are uint32 (0 on miss/invalidation).
          values.set(op.id, integerInterval(0, 4294967295, false));
          break;
        case "string-length":
          // A flat string (24-byte header, 2 bytes per unit) fits a
          // uint32-sized allocation, so its length is below 2^31.
          values.set(op.id, integerInterval(0, 2147483647, false));
          break;
        case "string-code-unit":
          if (op.inBounds === true)
            values.set(op.id, integerInterval(0, 65535, false));
          break;
        case "binary": {
          const left = values.get(op.left),
            right = values.get(op.right);
          // Bitwise results are 32-bit integers, never -0, whatever the
          // operands: `>>>` unsigned (`x >>> 0` keeps an integer x already
          // in that range, as counted-loops' word bounds), `&` with a
          // non-negative 31-bit mask within the mask, the others signed.
          if (op.operator === ">>>") {
            values.set(
              op.id,
              left !== undefined &&
                left.integer &&
                left.lo >= 0 &&
                left.hi <= 4294967295 &&
                constantOf(right) === 0
                ? integerInterval(left.lo, left.hi, false)
                : integerInterval(0, 4294967295, false),
            );
            break;
          }
          if (op.operator === "&") {
            const leftHi = nonNegativeMaskHi(left),
              rightHi = nonNegativeMaskHi(right);
            const mask =
              leftHi >= 0 && rightHi >= 0
                ? Math.min(leftHi, rightHi)
                : Math.max(leftHi, rightHi);
            values.set(
              op.id,
              mask >= 0
                ? integerInterval(0, mask, false)
                : integerInterval(-2147483648, 2147483647, false),
            );
            break;
          }
          if (["|", "^", "<<", ">>", "imul"].includes(op.operator)) {
            values.set(op.id, integerInterval(-2147483648, 2147483647, false));
            break;
          }
          if (left === undefined || right === undefined) break;
          if (op.operator === "+") values.set(op.id, add(left, right, 1));
          else if (op.operator === "-") values.set(op.id, add(left, right, -1));
          else if (op.operator === "*")
            values.set(op.id, multiply(left, right));
          else if (op.operator === "%")
            values.set(op.id, remainder(left, right));
          else if (op.operator === "min" || op.operator === "max")
            values.set(op.id, extremum(left, right, op.operator === "min"));
          break;
        }
        default:
          break;
      }
    }
  }
  function refine(
    state: Interval[],
    slot: number,
    other: Interval,
    operator: string,
    taken: boolean,
    slotOnLeft: boolean,
  ): void {
    const current = state[slot];
    if (current === undefined || !current.integer || !other.integer) return;
    // Normalize to `slot OP other` on this edge.
    let relation = operator;
    if (!slotOnLeft)
      relation =
        operator === "<"
          ? ">"
          : operator === ">"
            ? "<"
            : operator === "<="
              ? ">="
              : operator === ">="
                ? "<="
                : operator;
    if (!taken)
      relation =
        relation === "<"
          ? ">="
          : relation === ">="
            ? "<"
            : relation === "<="
              ? ">"
              : relation === ">"
                ? "<="
                : relation === "==="
                  ? "!=="
                  : relation === "!=="
                    ? "==="
                    : "";
    let lo = current.lo,
      hi = current.hi,
      negativeZero = current.negativeZero;
    if (relation === "<") hi = Math.min(hi, other.hi - 1);
    else if (relation === "<=") hi = Math.min(hi, other.hi);
    else if (relation === ">") lo = Math.max(lo, other.lo + 1);
    else if (relation === ">=") lo = Math.max(lo, other.lo);
    else if (relation === "===") {
      lo = Math.max(lo, other.lo);
      hi = Math.min(hi, other.hi);
      if (other.lo > 0 || other.hi < 0) negativeZero = false;
    } else if (relation === "!==") {
      if (other.lo !== other.hi) return;
      const point = other.lo;
      if (lo === point) lo = point + 1;
      else if (hi === point) hi = point - 1;
      else return;
      if (point === 0) negativeZero = false;
    } else return;
    state[slot] = integerInterval(lo, hi, negativeZero);
  }
  /** Interprets block `id` from `entry` and sends each successor's state to
   * `send` (branch edges refined, decided edges pruned). */
  function propagate(
    id: number,
    entry: SparseState,
    send: (target: number, state: SparseState) => void,
  ): void {
    const block = byId.get(id);
    if (block === undefined) throw "bounds block invariant";
    const touched = touchedBy(block, entry),
      state = scratch,
      hull = hullScratch,
      values = new Map<number, Interval>(),
      loads = new Map<number, number>();
    fill(state, entry);
    fill(hull, entry);
    run(block, state, values, loads, hull);
    const term: Terminator = block.terminator;
    if (
      term.kind === "record" ||
      term.kind === "record-cell" ||
      term.kind === "cell"
    )
      if (tracked(term.slot) >= 0) {
        const index = tracked(term.slot);
        state[index] = top;
      }
    const exception = block.exception;
    if (exception !== undefined) {
      const index = tracked(exception.slot);
      let saved = top;
      if (index >= 0) {
        saved = hull[index] ?? top;
        hull[index] = top;
      }
      const handler = collect(hull, touched);
      if (index >= 0) hull[index] = saved;
      send(exception.target, handler);
    }
    if (term.kind === "branch") {
      const condition = findDefinition(block, term.condition);
      let yes: SparseState | undefined, no: SparseState | undefined;
      if (
        condition !== undefined &&
        condition.kind === "binary" &&
        ["<", "<=", ">", ">=", "===", "!=="].includes(condition.operator)
      ) {
        const leftSlot = loads.get(condition.left),
          rightSlot = loads.get(condition.right),
          left = values.get(condition.left) ?? top,
          right = values.get(condition.right) ?? top;
        // Refine each edge on the dense state, then restore it.
        const leftBefore =
            leftSlot === undefined ? top : (state[leftSlot] ?? top),
          rightBefore =
            rightSlot === undefined ? top : (state[rightSlot] ?? top);
        for (const taken of [true, false]) {
          if (taken === undefined) throw "bounds edge invariant";
          if (leftSlot !== undefined)
            refine(state, leftSlot, right, condition.operator, taken, true);
          if (rightSlot !== undefined)
            refine(state, rightSlot, left, condition.operator, taken, false);
          const edge = collect(state, touched);
          if (taken) yes = edge;
          else no = edge;
          if (rightSlot !== undefined) state[rightSlot] = rightBefore;
          if (leftSlot !== undefined) state[leftSlot] = leftBefore;
        }
      }
      const unrefined =
        yes === undefined || no === undefined
          ? collect(state, touched)
          : undefined;
      const decided =
        condition === undefined ? undefined : decide(condition, values);
      if (decided !== false)
        send(term.consequent, yes ?? unrefined ?? emptyState);
      if (decided !== true) send(term.alternate, no ?? unrefined ?? emptyState);
    } else if (term.kind === "jump") send(term.target, collect(state, touched));
    else if (
      term.kind === "record" ||
      term.kind === "record-cell" ||
      term.kind === "cell"
    ) {
      const out = collect(state, touched);
      send(term.consequent, out);
      send(term.alternate, out);
    }
    reset(state, touched);
    reset(hull, touched);
  }
  while (worklist.length > 0) {
    if (visited >= budget) return undefined;
    const id = worklist.pop();
    if (id === undefined) throw "bounds worklist invariant";
    queued.delete(id);
    const entry = entries.get(id);
    if (entry === undefined) throw "bounds block invariant";
    propagate(id, entry, merge);
  }
  // Narrowing: from the widened post-fixpoint, recompute every entry as the
  // join of its predecessors' outputs (no widening). Each round stays sound
  // and recovers bounds that widening at enclosing loops discarded.
  for (let round = 0; round < 2; round++) {
    const next = new Map<number, SparseState>();
    next.set(fn.entry, emptyState);
    for (const block of fn.blocks) {
      if (block === undefined) throw "bounds block invariant";
      if (visited >= budget) return undefined;
      const entry = entries.get(block.id);
      if (entry === undefined) continue;
      propagate(block.id, entry, (target: number, state: SparseState): void => {
        const existing = next.get(target);
        if (existing === undefined) {
          next.set(target, pruned(target, state));
          return;
        }
        const narrowed = joined(existing, state, target, 0);
        if (narrowed !== undefined) next.set(target, narrowed);
      });
    }
    let narrowedAny = false;
    for (const [id, state] of next) {
      const prev = entries.get(id);
      if (prev === undefined || !sameState(prev, state)) {
        entries.set(id, state);
        narrowedAny = true;
      }
    }
    if (!narrowedAny) break;
  }
  // Rewrite with the converged entry states.
  let nextValue = 0;
  for (const block of fn.blocks) {
    if (block === undefined) throw "bounds block invariant";
    for (const op of block.instructions) {
      if (op === undefined) throw "bounds instruction invariant";
      const result = instructionResult(op);
      if (result !== undefined && result >= nextValue) nextValue = result + 1;
    }
  }
  const blockValues = new Map<number, Map<number, Interval>>();
  for (const block of fn.blocks) {
    if (block === undefined) throw "bounds block invariant";
    const entry = entries.get(block.id);
    if (entry === undefined) continue;
    const values = new Map<number, Interval>(),
      touched = touchedBy(block, entry);
    fill(scratch, entry);
    run(block, scratch, values, new Map<number, number>(), undefined);
    reset(scratch, touched);
    blockValues.set(block.id, values);
  }
  // Number slots whose every reachable write stores a proven 32-bit integer
  // (signed or unsigned) other than -0: codegen may hold them as integers.
  // Wider ones whose writes are all safe integers other than -0 are safe
  // integer slots, with the largest magnitude written as their bound. Either
  // kind whose writes all exclude 0 is also a nonzero slot.
  // Entry values (parameters, the receiver) and opaque writes are unknown.
  const integral = new Uint8Array(trackedCount),
    safe = new Uint8Array(trackedCount),
    nonzero = new Uint8Array(trackedCount),
    magnitudes = new Float64Array(trackedCount);
  for (let slot = 0; slot < slotCount; slot++) {
    const index = tracked(slot);
    if (index >= 0 && opaque[slot] !== 1 && fn.slots[slot] === "number") {
      integral[index] = 1;
      safe[index] = 1;
      nonzero[index] = 1;
    }
  }
  for (const block of fn.blocks) {
    if (block === undefined) throw "bounds block invariant";
    const values = blockValues.get(block.id);
    if (values === undefined) continue;
    for (const op of block.instructions) {
      if (op === undefined) throw "bounds instruction invariant";
      if (op.kind !== "store") continue;
      const index = tracked(op.slot);
      if (index < 0) continue;
      const interval = values.get(op.value);
      if (
        interval === undefined ||
        !interval.integer ||
        interval.negativeZero ||
        interval.lo < -maxSafeInteger ||
        interval.hi > maxSafeInteger
      ) {
        integral[index] = 0;
        safe[index] = 0;
        nonzero[index] = 0;
        continue;
      }
      if (interval.lo < -2147483648 || interval.hi > 4294967295)
        integral[index] = 0;
      // Integer intervals exclude NaN, so one excluding 0 is nonzero.
      if (hasZero(interval)) nonzero[index] = 0;
      magnitudes[index] = Math.max(
        magnitudes[index] ?? 0,
        -interval.lo,
        interval.hi,
      );
    }
  }
  const integerSlots: number[] = [],
    safeIntegerSlots: number[] = [],
    safeIntegerBounds: number[] = [],
    nonzeroSlots: number[] = [];
  for (let slot = 0; slot < slotCount; slot++) {
    const index = tracked(slot);
    if (index < 0) continue;
    if (nonzero[index] === 1 && (integral[index] === 1 || safe[index] === 1))
      nonzeroSlots.push(slot);
    if (integral[index] === 1) integerSlots.push(slot);
    else if (safe[index] === 1) {
      safeIntegerSlots.push(slot);
      safeIntegerBounds.push(magnitudes[index] ?? 0);
    }
  }
  // A typed array slot's length is the least length any reachable write
  // stores (unreachable writes store nothing).
  for (const [slot, stores] of arrayStores) {
    if (unknownArray[slot] === 1 || opaque[slot] === 1) continue;
    let length = Infinity;
    for (const store of stores) {
      if (store === undefined) throw "bounds store invariant";
      const values = blockValues.get(store.block);
      if (values === undefined) continue;
      const interval = values.get(store.length);
      if (interval === undefined || !interval.integer || interval.lo < 0) {
        length = -1;
        break;
      }
      length = Math.min(length, interval.lo);
    }
    if (length >= 0 && length !== Infinity) lengths[slot] = length;
  }
  // String code units and typed-array elements indexed below their
  // sequence's length (relational facts) and at a non-negative integer
  // (intervals) are in bounds.
  let sequenceAccesses = false;
  for (const block of fn.blocks) {
    if (block === undefined) throw "bounds block invariant";
    for (const op of block.instructions)
      if (
        op !== undefined &&
        ((op.kind === "string-code-unit" && op.inBounds !== true) ||
          op.kind === "array-read" ||
          op.kind === "array-write")
      )
        sequenceAccesses = true;
  }
  const sequenceIndices = sequenceAccesses
    ? analyzeSequenceIndices(fn, byId, blockValues, budget - visited)
    : undefined;
  if (sequenceIndices !== undefined) {
    visited += sequenceIndices.work;
    if (visited >= budget) return undefined;
  }
  let rewritten = 0;
  const blocks: Block[] = [];
  for (const block of fn.blocks) {
    if (block === undefined) throw "bounds block invariant";
    const values = blockValues.get(block.id);
    if (values === undefined) {
      blocks.push(block);
      continue;
    }
    const belowLength = new Set<Instruction>(),
      indexEntry = sequenceIndices?.entries?.get(block.id);
    if (sequenceIndices !== undefined && indexEntry !== undefined)
      sequenceIndices.walk(block, indexEntry, (op: Instruction): void => {
        belowLength.add(op);
      });
    // Uses inside the block (values are block-local), and which of them a
    // fold below absorbs or a 32-bit bitwise op consumes modulo 2^32.
    const uses = new Map<number, number>(),
      foldable = new Map<number, number>(),
      bitwiseUses = new Map<number, number>();
    const count = (id: number): void => {
      uses.set(id, (uses.get(id) ?? 0) + 1);
    };
    for (const op of block.instructions) {
      if (op === undefined) throw "bounds instruction invariant";
      visitInstructionOperands(op, count);
      if (
        op.kind === "optional-value-or" ||
        op.kind === "optional-value" ||
        op.kind === "optional-present"
      )
        foldable.set(op.value, (foldable.get(op.value) ?? 0) + 1);
      if (
        op.kind === "binary" &&
        ["&", "|", "^", "<<", ">>", ">>>", "imul"].includes(op.operator)
      ) {
        bitwiseUses.set(op.left, (bitwiseUses.get(op.left) ?? 0) + 1);
        bitwiseUses.set(op.right, (bitwiseUses.get(op.right) ?? 0) + 1);
      } else if (op.kind === "unary" && op.operator === "~") {
        bitwiseUses.set(op.operand, (bitwiseUses.get(op.operand) ?? 0) + 1);
      }
    }
    visitTerminatorOperands(block.terminator, count);
    const arrayLoads = new Map<number, number>();
    for (const op of block.instructions)
      if (
        op !== undefined &&
        op.kind === "load" &&
        unknownArray[op.slot] !== 1 &&
        opaque[op.slot] !== 1 &&
        lengths[op.slot] !== undefined
      )
        arrayLoads.set(op.id, op.slot);
    // Constant lengths bound the index interval; relational facts bound it
    // by the array's own length.
    const inBounds = (
      op: Instruction,
      array: number,
      index: number,
    ): boolean => {
      const slot = arrayLoads.get(array);
      const length = slot === undefined ? undefined : lengths[slot];
      const interval = values.get(index);
      return (
        interval !== undefined &&
        interval.integer &&
        interval.lo >= 0 &&
        ((length !== undefined && interval.hi <= length - 1) ||
          belowLength.has(op))
      );
    };
    // Remarks only: the facts behind a selection decision.
    const accessFacts = (array: number, index: number): string => {
      const slot = arrayLoads.get(array);
      const length = slot === undefined ? undefined : lengths[slot];
      const interval = values.get(index);
      return (
        "length " +
        (length === undefined ? "unknown" : String(length)) +
        ", index " +
        (interval === undefined
          ? "unknown"
          : (interval.integer ? "integer " : "number ") +
            "[" +
            String(interval.lo) +
            ", " +
            String(interval.hi) +
            "]")
      );
    };
    const selected = new Map<number, number>(),
      replaced = new Map<number, number>(),
      instructions: Instruction[] = [];
    let changed = false;
    for (const op of block.instructions) {
      if (op === undefined) throw "bounds instruction invariant";
      if (
        remarks !== undefined &&
        (op.kind === "array-read" || op.kind === "array-write")
      )
        remarks({
          pass: "select-array-access",
          outcome: inBounds(op, op.array, op.index) ? "applied" : "missed",
          function: fn.name,
          start: op.start,
          end: op.end,
          message:
            (inBounds(op, op.array, op.index)
              ? "unchecked " + op.kind + " selected: "
              : op.kind + " stays checked: ") + accessFacts(op.array, op.index),
        });
      if (op.kind === "array-read" && inBounds(op, op.array, op.index)) {
        const element = nextValue++;
        instructions.push({
          kind: "array-element",
          id: element,
          array: op.array,
          index: op.index,
          start: op.start,
          end: op.end,
          ...(op.inline === undefined ? {} : { inline: op.inline }),
        });
        selected.set(op.id, element);
        // Keep the optional only for uses the folds below do not absorb.
        if ((uses.get(op.id) ?? 0) !== (foldable.get(op.id) ?? 0))
          instructions.push({
            kind: "optional-wrap",
            id: op.id,
            value: element,
            start: op.start,
            end: op.end,
            ...(op.inline === undefined ? {} : { inline: op.inline }),
          });
        rewritten++;
        changed = true;
        continue;
      }
      if (op.kind === "string-code-unit" && belowLength.has(op)) {
        const interval = values.get(op.index);
        if (interval !== undefined && interval.integer && interval.lo >= 0) {
          instructions.push({
            kind: "string-code-unit",
            id: op.id,
            string: op.string,
            index: op.index,
            inBounds: true,
            start: op.start,
            end: op.end,
            ...(op.inline === undefined ? {} : { inline: op.inline }),
          });
          rewritten++;
          changed = true;
          continue;
        }
      }
      if (op.kind === "array-write" && inBounds(op, op.array, op.index)) {
        instructions.push({
          kind: "array-store",
          array: op.array,
          index: op.index,
          value: op.value,
          start: op.start,
          end: op.end,
          ...(op.inline === undefined ? {} : { inline: op.inline }),
        });
        rewritten++;
        changed = true;
        continue;
      }
      if (op.kind === "optional-value-or" || op.kind === "optional-value") {
        const element = selected.get(op.value);
        if (element !== undefined) {
          replaced.set(op.id, element);
          continue;
        }
      }
      if (op.kind === "optional-present" && selected.has(op.value)) {
        instructions.push({
          kind: "constant",
          id: op.id,
          value: true,
          start: op.start,
          end: op.end,
          ...(op.inline === undefined ? {} : { inline: op.inline }),
        });
        continue;
      }
      // An exact safe-integer product whose every use only observes its low
      // 32 bits (bitwise ops) equals Math.imul(left, right) modulo 2^32.
      if (
        op.kind === "binary" &&
        op.operator === "*" &&
        (uses.get(op.id) ?? 0) > 0 &&
        uses.get(op.id) === bitwiseUses.get(op.id)
      ) {
        const left = values.get(op.left),
          right = values.get(op.right);
        if (
          left !== undefined &&
          right !== undefined &&
          left.integer &&
          right.integer &&
          Math.max(Math.abs(left.lo), Math.abs(left.hi)) *
            Math.max(Math.abs(right.lo), Math.abs(right.hi)) <=
            maxSafeInteger
        ) {
          instructions.push({ ...op, operator: "imul" });
          rewritten++;
          changed = true;
          continue;
        }
      }
      instructions.push(op);
    }
    if (!changed) {
      blocks.push(block);
      continue;
    }
    const substitution = new Uint32Array(nextValue);
    for (const [from, to] of replaced) substitution[from] = to + 1;
    const substituted: Instruction[] = [];
    for (const op of instructions) {
      if (op === undefined) throw "bounds instruction invariant";
      substituted.push(
        replaced.size === 0
          ? op
          : substituteInstructionValues(op, substitution),
      );
    }
    blocks.push({
      ...block,
      instructions: substituted,
      terminator:
        replaced.size === 0
          ? block.terminator
          : substituteTerminatorValues(block.terminator, substitution),
    });
  }
  // Safe integer and nonzero facts replace any earlier ones whole (an
  // earlier list may name a slot that is now an integer slot).
  const facts: FunctionIR = {
    ...fn,
    ...(integerSlots.length === 0 ? {} : { integerSlots }),
    ...(safeIntegerSlots.length === 0 && fn.safeIntegerSlots === undefined
      ? {}
      : { safeIntegerSlots, safeIntegerBounds }),
    ...(nonzeroSlots.length === 0 && fn.nonzeroSlots === undefined
      ? {}
      : { nonzeroSlots }),
  };
  if (rewritten === 0) return { fn: facts, visited, rewritten: 0 };
  return { fn: { ...facts, blocks }, visited, rewritten };
}

/** A comparison's outcome when the intervals of its operands decide it.
 * Integer intervals exclude NaN, so `x !== x` is false for them. */
function decide(
  op: Instruction,
  values: ReadonlyMap<number, Interval>,
): boolean | undefined {
  if (op.kind !== "binary") return undefined;
  const left = values.get(op.left),
    right = values.get(op.right);
  if (left === undefined || right === undefined) return undefined;
  if (!left.integer || !right.integer) return undefined;
  if (op.left === op.right) {
    if (op.operator === "===" || op.operator === "<=" || op.operator === ">=")
      return true;
    if (op.operator === "!==" || op.operator === "<" || op.operator === ">")
      return false;
  }
  switch (op.operator) {
    case "<":
      return left.hi < right.lo
        ? true
        : left.lo >= right.hi
          ? false
          : undefined;
    case "<=":
      return left.hi <= right.lo
        ? true
        : left.lo > right.hi
          ? false
          : undefined;
    case ">":
      return left.lo > right.hi
        ? true
        : left.hi <= right.lo
          ? false
          : undefined;
    case ">=":
      return left.lo >= right.hi
        ? true
        : left.hi < right.lo
          ? false
          : undefined;
    default:
      return undefined;
  }
}
function findDefinition(block: Block, id: number): Instruction | undefined {
  for (const op of block.instructions)
    if (op !== undefined && instructionResult(op) === id) return op;
  return undefined;
}
