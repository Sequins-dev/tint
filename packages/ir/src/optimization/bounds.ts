import {
  naturalLoops,
  instructionResult,
  substituteInstructionValues,
  substituteTerminatorValues,
  visitInstructionOperands,
  visitTerminatorOperands,
  type Block,
  type FunctionIR,
  type Instruction,
  type Terminator,
} from "../scalar/index.ts";

/** Interval facts over number slots and values: `integer` intervals hold
 * only finite integral numbers (never NaN or -0 is irrelevant here) within
 * [lo, hi]; other intervals carry no proof. */
interface Interval {
  readonly lo: number;
  readonly hi: number;
  readonly integer: boolean;
}
const top: Interval = { lo: -Infinity, hi: Infinity, integer: false };
const exact = 9007199254740992;
function constant(value: number): Interval {
  return Number.isInteger(value)
    ? { lo: value, hi: value, integer: true }
    : top;
}
function bounded(interval: Interval): boolean {
  return interval.integer && interval.lo >= -exact && interval.hi <= exact;
}
function add(left: Interval, right: Interval, sign: number): Interval {
  if (!left.integer || !right.integer) return top;
  const lo = sign > 0 ? left.lo + right.lo : left.lo - right.hi,
    hi = sign > 0 ? left.hi + right.hi : left.hi - right.lo;
  // A finite integer plus a bounded one cannot overflow to infinity (it
  // saturates by rounding long before), so an unbounded side stays sound
  // when the other is bounded.
  if (!bounded(left) && !bounded(right)) return top;
  return { lo, hi, integer: true };
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
  return lo >= -exact && hi <= exact ? { lo, hi, integer: true } : top;
}
function remainder(left: Interval, right: Interval): Interval {
  // Non-negative finite integers modulo a positive integer constant.
  if (
    !bounded(left) ||
    left.lo < 0 ||
    !right.integer ||
    right.lo !== right.hi ||
    right.lo <= 0
  )
    return top;
  return { lo: 0, hi: Math.min(left.hi, right.lo - 1), integer: true };
}
function join(left: Interval, right: Interval): Interval {
  if (!left.integer || !right.integer) return top;
  return {
    lo: Math.min(left.lo, right.lo),
    hi: Math.max(left.hi, right.hi),
    integer: true,
  };
}
function same(left: Interval, right: Interval): boolean {
  return (
    left.integer === right.integer &&
    left.lo === right.lo &&
    left.hi === right.hi
  );
}
/** Widening for loop convergence: a bound that moved becomes infinite. */
function widen(previous: Interval, next: Interval): Interval {
  if (!previous.integer || !next.integer) return top;
  return {
    lo: next.lo < previous.lo ? -Infinity : previous.lo,
    hi: next.hi > previous.hi ? Infinity : previous.hi,
    integer: true,
  };
}

export interface ArrayAccessSelection {
  readonly fn: FunctionIR;
  readonly visited: number;
  /** The function exceeded the analysis state bound and was left as is. */
  readonly skipped?: boolean;
  /** Typed-array accesses proven in bounds and selected unchecked. */
  readonly rewritten: number;
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
  // lengths or comparisons (directly, through arithmetic, or through stores
  // into other tracked slots); states are dense over them.
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
          if (["<", "<=", ">", ">="].includes(op.operator)) {
            mark(op.left);
            mark(op.right);
          }
        } else if (op.kind === "unary")
          dependencies.set(op.id, combine(op.operand, op.operand));
        else if (op.kind === "array-read" || op.kind === "array-write")
          mark(op.index);
        else if (op.kind === "array-new") mark(op.length);
        else if (op.kind === "store" && relevant[op.slot] === 1) mark(op.value);
      }
    }
  }
  // Dense index + 1 per tracked slot (0: untracked).
  const dense = new Uint32Array(slotCount);
  let trackedCount = 0;
  for (let slot = 0; slot < slotCount; slot++)
    if (relevant[slot] === 1) dense[slot] = ++trackedCount;
  const tracked = (slot: number): number => (dense[slot] ?? 0) - 1;
  // Bound the analysis state (blocks x tracked slots); larger functions
  // keep their checked accesses.
  if (trackedCount === 0) return { fn, visited, rewritten: 0 };
  if (trackedCount * fn.blocks.length > 4000000)
    return { fn, visited, rewritten: 0, skipped: true };
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
  // Dataflow: interval per number slot at each block entry.
  const entries = new Map<number, Interval[]>(),
    visits = new Map<number, number>();
  const initial: Interval[] = [];
  for (let slot = 0; slot < trackedCount; slot++) initial.push(top);
  entries.set(fn.entry, initial);
  const worklist: number[] = [fn.entry],
    queued = new Set<number>();
  queued.add(fn.entry);
  function merge(target: number, state: readonly Interval[]): void {
    const existing = entries.get(target);
    if (existing === undefined) {
      entries.set(target, state.slice());
    } else {
      const count = (visits.get(target) ?? 0) + 1;
      visits.set(target, count);
      let changed = false;
      for (let slot = 0; slot < trackedCount; slot++) {
        const before = existing[slot],
          incoming = state[slot];
        if (before === undefined || incoming === undefined)
          throw "bounds state invariant";
        let after = join(before, incoming);
        if (
          count > 2 &&
          !same(after, before) &&
          (loopWrites.get(target)?.has(slot) ?? false)
        )
          after = widen(before, after);
        if (!same(after, before)) {
          existing[slot] = after;
          changed = true;
        }
      }
      if (!changed) return;
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
          const index = tracked(op.slot);
          if (index >= 0) {
            values.set(op.id, state[index] ?? top);
            loads.set(op.id, index);
          }
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
            values.set(op.id, { lo, hi, integer: true });
            break;
          }
          if (operand === undefined || !operand.integer) break;
          if (op.operator === "trunc" || op.operator === "+")
            values.set(op.id, operand);
          else if (op.operator === "-")
            values.set(op.id, {
              lo: -operand.hi,
              hi: -operand.lo,
              integer: true,
            });
          break;
        }
        case "array-length":
          // Typed array lengths are uint32.
          values.set(op.id, { lo: 0, hi: 4294967295, integer: true });
          break;
        case "string-length":
          // A flat string (24-byte header, 2 bytes per unit) fits a
          // uint32-sized allocation, so its length is below 2^31.
          values.set(op.id, { lo: 0, hi: 2147483647, integer: true });
          break;
        case "binary": {
          const left = values.get(op.left),
            right = values.get(op.right);
          if (left === undefined || right === undefined) break;
          if (op.operator === "+") values.set(op.id, add(left, right, 1));
          else if (op.operator === "-") values.set(op.id, add(left, right, -1));
          else if (op.operator === "*")
            values.set(op.id, multiply(left, right));
          else if (op.operator === "%")
            values.set(op.id, remainder(left, right));
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
                : "";
    let lo = current.lo,
      hi = current.hi;
    if (relation === "<") hi = Math.min(hi, other.hi - 1);
    else if (relation === "<=") hi = Math.min(hi, other.hi);
    else if (relation === ">") lo = Math.max(lo, other.lo + 1);
    else if (relation === ">=") lo = Math.max(lo, other.lo);
    else return;
    state[slot] = { lo, hi, integer: true };
  }
  /** Interprets block `id` from `entry` and sends each successor's state to
   * `send` (branch edges refined, decided edges pruned). */
  function propagate(
    id: number,
    entry: readonly Interval[],
    send: (target: number, state: Interval[]) => void,
  ): void {
    const block = byId.get(id);
    if (block === undefined) throw "bounds block invariant";
    const state = entry.slice(),
      values = new Map<number, Interval>(),
      loads = new Map<number, number>(),
      hull = entry.slice();
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
      const handler = hull.slice(),
        index = tracked(exception.slot);
      if (index >= 0) handler[index] = top;
      send(exception.target, handler);
    }
    if (term.kind === "branch") {
      const yes = state.slice(),
        no = state.slice();
      const condition = findDefinition(block, term.condition);
      if (
        condition !== undefined &&
        condition.kind === "binary" &&
        ["<", "<=", ">", ">="].includes(condition.operator)
      ) {
        const leftSlot = loads.get(condition.left),
          rightSlot = loads.get(condition.right),
          left = values.get(condition.left) ?? top,
          right = values.get(condition.right) ?? top;
        if (leftSlot !== undefined) {
          refine(yes, leftSlot, right, condition.operator, true, true);
          refine(no, leftSlot, right, condition.operator, false, true);
        }
        if (rightSlot !== undefined) {
          refine(yes, rightSlot, left, condition.operator, true, false);
          refine(no, rightSlot, left, condition.operator, false, false);
        }
      }
      const decided =
        condition === undefined ? undefined : decide(condition, values);
      if (decided !== false) send(term.consequent, yes);
      if (decided !== true) send(term.alternate, no);
    } else if (term.kind === "jump") send(term.target, state);
    else if (
      term.kind === "record" ||
      term.kind === "record-cell" ||
      term.kind === "cell"
    ) {
      send(term.consequent, state);
      send(term.alternate, state);
    }
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
  for (let round = 0; round < 3; round++) {
    const next = new Map<number, Interval[]>();
    next.set(fn.entry, initial.slice());
    for (const block of fn.blocks) {
      if (block === undefined) throw "bounds block invariant";
      if (visited >= budget) return undefined;
      const entry = entries.get(block.id);
      if (entry === undefined) continue;
      propagate(block.id, entry, (target: number, state: Interval[]): void => {
        const existing = next.get(target);
        if (existing === undefined) {
          next.set(target, state.slice());
          return;
        }
        for (let slot = 0; slot < trackedCount; slot++)
          existing[slot] = join(existing[slot] ?? top, state[slot] ?? top);
      });
    }
    for (const [id, state] of next) entries.set(id, state);
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
    const values = new Map<number, Interval>();
    run(block, entry.slice(), values, new Map<number, number>(), undefined);
    blockValues.set(block.id, values);
  }
  // Number slots whose every reachable write stores a proven 32-bit integer
  // (signed or unsigned): codegen may hold them as integers. Entry values
  // (parameters, the receiver) and opaque writes are unknown.
  const integral = new Uint8Array(trackedCount);
  for (let slot = 0; slot < slotCount; slot++) {
    const index = tracked(slot);
    if (index >= 0 && opaque[slot] !== 1 && fn.slots[slot] === "number")
      integral[index] = 1;
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
        interval.lo < -2147483648 ||
        interval.hi > 4294967295
      )
        integral[index] = 0;
    }
  }
  const integerSlots: number[] = [];
  for (let slot = 0; slot < slotCount; slot++) {
    const index = tracked(slot);
    if (index >= 0 && integral[index] === 1) integerSlots.push(slot);
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
  let rewritten = 0;
  const blocks: Block[] = [];
  for (const block of fn.blocks) {
    if (block === undefined) throw "bounds block invariant";
    const values = blockValues.get(block.id);
    if (values === undefined) {
      blocks.push(block);
      continue;
    }
    // Uses inside the block (values are block-local), and which of them a
    // fold below absorbs.
    const uses = new Map<number, number>(),
      foldable = new Map<number, number>();
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
    const inBounds = (array: number, index: number): boolean => {
      const slot = arrayLoads.get(array);
      const length = slot === undefined ? undefined : lengths[slot];
      const interval = values.get(index);
      return (
        length !== undefined &&
        interval !== undefined &&
        interval.integer &&
        interval.lo >= 0 &&
        interval.hi <= length - 1
      );
    };
    const selected = new Map<number, number>(),
      replaced = new Map<number, number>(),
      instructions: Instruction[] = [];
    let changed = false;
    for (const op of block.instructions) {
      if (op === undefined) throw "bounds instruction invariant";
      if (op.kind === "array-read" && inBounds(op.array, op.index)) {
        const element = nextValue++;
        instructions.push({
          kind: "array-element",
          id: element,
          array: op.array,
          index: op.index,
          start: op.start,
          end: op.end,
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
          });
        rewritten++;
        changed = true;
        continue;
      }
      if (op.kind === "array-write" && inBounds(op.array, op.index)) {
        instructions.push({
          kind: "array-store",
          array: op.array,
          index: op.index,
          value: op.value,
          start: op.start,
          end: op.end,
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
        });
        continue;
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
  if (rewritten === 0)
    return {
      fn: integerSlots.length === 0 ? fn : { ...fn, integerSlots },
      visited,
      rewritten: 0,
    };
  return {
    fn:
      integerSlots.length === 0
        ? { ...fn, blocks }
        : { ...fn, integerSlots, blocks },
    visited,
    rewritten,
  };
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
