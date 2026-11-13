import {
  analyzeLiveSlots,
  instructionResult,
  scalarByteLength,
  visitInstructionOperands,
  visitTerminatorOperands,
  type FunctionIR,
  type InlineSite,
  type Instruction,
  type ScalarType,
} from "@tint/ir/scalar";

/** Where one 8-byte word of a variable lives: memory at the frame pointer
 * (x29) plus `offset`, or a general (x0-x30) or FP (d0-d31) register. */
export type NativeDebugWord =
  | { readonly kind: "frame"; readonly offset: number }
  | { readonly kind: "general"; readonly register: number }
  | { readonly kind: "float"; readonly register: number };
/** A module-relative code range over which the variable's words hold it. */
export interface NativeDebugLocation {
  readonly offset: number;
  readonly byteLength: number;
  readonly words: readonly NativeDebugWord[];
}
/** A source variable (see FunctionDebug) with the code ranges where its
 * current value is known to be in the described storage. Elsewhere it is
 * unavailable: never a stale or shared word. */
export interface NativeDebugVariable {
  readonly name: string;
  readonly parameter: boolean;
  /** Declaration span, in the IR's source coordinates. */
  readonly start: number;
  readonly end: number;
  readonly type: ScalarType;
  /** A number held as an int64 integer. */
  readonly integer: boolean;
  readonly record?: number | undefined;
  readonly inline?: number | undefined;
  readonly locations: readonly NativeDebugLocation[];
}
/** Code whose innermost inline site is `site` (FunctionDebug.inlineSites). */
export interface NativeInlineRange {
  readonly site: number;
  readonly offset: number;
  readonly byteLength: number;
}
export interface NativeFunctionDebug {
  readonly variables: readonly NativeDebugVariable[];
  readonly inlineSites: readonly InlineSite[];
  readonly inlineRanges: readonly NativeInlineRange[];
}
interface Operation {
  readonly block: number;
  /** Instruction index, or -1 for the terminator. */
  readonly index: number;
  readonly inline: number;
  readonly offset: number;
  byteLength: number;
}
interface Interval {
  readonly slot: number;
  readonly start: number;
  end: number;
}
/** Collects, during emission of one function, the facts its debug variables
 * and inline scopes need: which code each IR operation became, the register
 * homes in force in each block, where values are saved to their homes, and
 * where register-homed references are spilled around safepoints. It never
 * changes emitted code. */
export interface DebugTracker {
  /** At a block's first word, once its register homes are settled: the
   * emitter's home (storage map entry) of a slot's or a value's word. */
  block(
    block: number,
    slotHome: (slot: number, word: number) => number,
    valueHome: (id: number) => number,
  ): void;
  operation(block: number, index: number, inline: number, at: number): void;
  end(at: number): void;
  /** A value's home received its value, ending at `at`. */
  saved(id: number, at: number): void;
  /** Spilled reference homes: their frame words hold them from `at`... */
  spilled(slots: readonly number[], at: number): void;
  /** ...until they are reloaded at `at`. */
  reloaded(at: number): void;
  /** A frame word a leaf frame keeps in FP register `register` throughout. */
  promoted(byteOffset: number, register: number): void;
  finish(context: DebugFrameContext): NativeFunctionDebug;
}
export interface DebugFrameContext {
  readonly slotOffset: (slot: number) => number;
  /** A value's home word (sp-relative), its type, and whether a number is
   * held as an int64; undefined when its home is not a plain encoding. */
  readonly valueStorage: (id: number) =>
    | {
        readonly offset: number;
        readonly type: ScalarType;
        readonly integer: boolean;
      }
    | undefined;
  /** sp-relative frame words are fp-relative after this adjustment. */
  readonly frameBytes: number;
  readonly integerSlots: Uint8Array;
  readonly managed: (type: ScalarType) => boolean;
  /** Operations during which the collector may move objects. */
  readonly collects: (op: Instruction) => boolean;
  /** Code ranges where the frame (and fp) is established. */
  readonly frameRanges: readonly {
    readonly offset: number;
    readonly byteLength: number;
  }[];
}
/** A variable held by an SSA value: an explicit ValueBinding, or the value
 * a load of a named slot produced, which holds the variable until the slot
 * is stored again. Positions are instruction indices in the value's block
 * (the terminator is at the block's instruction count). */
interface Holder {
  readonly variable: number;
  readonly value: number;
  readonly block: number;
  /** The holder starts after this position. */
  readonly start: number;
  /** The last position at which the value holds the variable. */
  readonly end: number;
  /** Whether `end` is the value's last use (its home may then be reused). */
  readonly lastUse: boolean;
}
/** A slot binding's live interval: the slot holds the variable before each
 * instruction from `from` to `to` (inclusive positions) of `block`. */
interface SlotInterval {
  readonly binding: number;
  readonly block: number;
  readonly from: number;
  readonly to: number;
}
interface Analysis {
  readonly holders: readonly Holder[];
  readonly intervals: readonly SlotInterval[];
  /** Slot binding indices with an interval, by block. */
  readonly liveBindings: readonly (readonly number[])[];
  /** Held values, by defining block. */
  readonly heldValues: readonly (readonly number[])[];
}
function successors(fn: FunctionIR, block: number): number[] {
  const source = fn.blocks[block];
  if (source === undefined) throw "debug block invariant";
  const term = source.terminator,
    result: number[] = [];
  if (term.kind === "jump") result.push(term.target);
  else if (
    term.kind === "branch" ||
    term.kind === "cell" ||
    term.kind === "record" ||
    term.kind === "record-cell"
  ) {
    if (term.consequent >= 0) result.push(term.consequent);
    if (term.alternate >= 0) result.push(term.alternate);
  }
  const handler = source.exception;
  if (handler !== undefined) result.push(handler.target);
  return result;
}
/** Instruction-precise liveness of the named slots, as intervals: a slot is
 * described only before instructions that may still read its current value.
 * Where it is dead its storage may be shared or stale. Work is linear in
 * instructions plus live-set sizes. */
function slotIntervals(fn: FunctionIR, out: SlotInterval[]): void {
  const debug = fn.debug;
  if (debug === undefined || debug.slots.length === 0) return;
  const tracked: number[] = [],
    trackedIndex = new Map<number, number>(),
    bindingsOf: number[][] = [];
  for (let index = 0; index < debug.slots.length; index++) {
    const binding = debug.slots[index];
    if (binding === undefined) throw "debug slot binding invariant";
    let position = trackedIndex.get(binding.slot);
    if (position === undefined) {
      position = tracked.length;
      trackedIndex.set(binding.slot, position);
      tracked.push(binding.slot);
      bindingsOf.push([]);
    }
    bindingsOf[position]?.push(index);
  }
  const liveness = analyzeLiveSlots(fn, 50000000, tracked);
  if (liveness === undefined) return;
  // Live end positions plus one by tracked slot (0: dead), and those set.
  const ends = new Uint32Array(tracked.length);
  function emit(slot: number, block: number, from: number, to: number): void {
    for (const binding of bindingsOf[slot] ?? []) {
      if (binding === undefined) throw "debug binding list invariant";
      out.push({ binding, block, from, to });
    }
  }
  for (const source of fn.blocks) {
    if (source === undefined) throw "debug block invariant";
    const block = source.id,
      length = source.instructions.length,
      active: number[] = [];
    function live(slot: number, position: number): void {
      if (ends[slot] !== 0) return;
      ends[slot] = position + 1;
      active.push(slot);
    }
    for (const successor of successors(fn, block)) {
      if (successor === undefined) throw "debug successor invariant";
      for (const slot of liveness.slots[successor] ?? []) {
        if (slot === undefined) throw "debug liveness invariant";
        const index = trackedIndex.get(slot);
        if (index !== undefined) live(index, length);
      }
    }
    const term = source.terminator;
    if (
      term.kind === "cell" ||
      term.kind === "record" ||
      term.kind === "record-cell"
    ) {
      const index = trackedIndex.get(term.slot);
      if (index !== undefined) live(index, length);
    }
    // A throw may leave from any point of a protected block: slots its
    // handler reads stay live throughout, except the handler's own slot,
    // which receives the thrown value on that edge.
    const handler = source.exception,
      protectedSlots = new Set<number>();
    if (handler !== undefined)
      for (const slot of liveness.slots[handler.target] ?? []) {
        if (slot === undefined) throw "debug liveness invariant";
        const index = trackedIndex.get(slot);
        if (index !== undefined && slot !== handler.slot)
          protectedSlots.add(index);
      }
    for (let position = length - 1; position >= 0; position--) {
      const op = source.instructions[position];
      if (op === undefined) throw "debug instruction invariant";
      if (op.kind !== "store" && op.kind !== "load") continue;
      const index = trackedIndex.get(op.slot);
      if (index === undefined) continue;
      if (op.kind === "load") live(index, position);
      else if (ends[index] !== 0 && !protectedSlots.has(index)) {
        // Live after the store only.
        emit(index, block, position + 1, (ends[index] ?? 1) - 1);
        ends[index] = 0;
      }
    }
    for (const index of protectedSlots) live(index, length);
    for (const index of active) {
      if (index === undefined) throw "debug active invariant";
      const end = ends[index] ?? 0;
      if (end === 0) continue;
      emit(index, block, 0, end - 1);
      ends[index] = 0;
    }
  }
}
interface Candidate {
  readonly variable: number;
  readonly value: number;
  /** The anchor value (-1: the value's definition). */
  readonly start: number;
  readonly until: number;
}
/** Explicit value bindings and the values loads of named slots produce. */
function valueHolders(fn: FunctionIR, out: Holder[]): void {
  const debug = fn.debug;
  if (debug === undefined) return;
  const named = new Map<number, number[]>();
  for (const binding of debug.slots) {
    if (binding === undefined) throw "debug slot binding invariant";
    let variables = named.get(binding.slot);
    if (variables === undefined) {
      variables = [];
      named.set(binding.slot, variables);
    }
    variables.push(binding.variable);
  }
  const explicit = new Map<number, ValueBindingLike[]>();
  for (const binding of debug.values) {
    if (binding === undefined) throw "debug value binding invariant";
    let list = explicit.get(binding.value);
    if (list === undefined) {
      list = [];
      explicit.set(binding.value, list);
    }
    list.push(binding);
  }
  for (const source of fn.blocks) {
    if (source === undefined) throw "debug block invariant";
    const length = source.instructions.length,
      defined = new Map<number, number>(),
      lastUse = new Map<number, number>(),
      nextStore: number[] = [],
      // Next store position by slot, filled scanning backwards.
      stores = new Map<number, number>();
    for (let position = length - 1; position >= 0; position--) {
      const op = source.instructions[position];
      if (op === undefined) throw "debug instruction invariant";
      nextStore.push(
        op.kind === "load" ? (stores.get(op.slot) ?? length + 1) : 0,
      );
      if (op.kind === "store") stores.set(op.slot, position);
    }
    nextStore.reverse();
    const candidates: Candidate[] = [];
    for (let position = 0; position < length; position++) {
      const op = source.instructions[position];
      if (op === undefined) throw "debug instruction invariant";
      visitInstructionOperands(op, (id) => {
        if (defined.has(id)) lastUse.set(id, position);
      });
      const id = instructionResult(op);
      if (id === undefined) continue;
      defined.set(id, position);
      for (const binding of explicit.get(id) ?? []) {
        if (binding === undefined) throw "debug binding list invariant";
        candidates.push({
          variable: binding.variable,
          value: id,
          start: binding.after,
          until: length + 1,
        });
      }
      if (op.kind === "load")
        for (const variable of named.get(op.slot) ?? []) {
          if (variable === undefined) throw "debug slot variable invariant";
          candidates.push({
            variable,
            value: id,
            start: -1,
            // The slot's next store gives the variable a new value.
            until: (nextStore[position] ?? length + 1) - 1,
          });
        }
    }
    visitTerminatorOperands(source.terminator, (id) => {
      if (defined.has(id)) lastUse.set(id, length);
    });
    // Anchors resolve to positions; holders of one variable end where the
    // next one in the block starts.
    const placed: { candidate: Candidate; start: number }[] = [];
    for (const candidate of candidates) {
      if (candidate === undefined) throw "debug candidate invariant";
      const definition = defined.get(candidate.value) ?? -1;
      let start = definition;
      if (candidate.start >= 0) {
        const anchor = defined.get(candidate.start);
        if (anchor === undefined) continue;
        start = Math.max(start, anchor);
      }
      placed.push({ candidate, start });
    }
    placed.sort((a, b) =>
      a.candidate.variable !== b.candidate.variable
        ? a.candidate.variable - b.candidate.variable
        : a.start - b.start,
    );
    for (let index = 0; index < placed.length; index++) {
      const entry = placed[index];
      if (entry === undefined) throw "debug placed invariant";
      const candidate = entry.candidate,
        last = lastUse.get(candidate.value);
      if (last === undefined) continue;
      let end = Math.min(last, candidate.until);
      for (let next = index + 1; next < placed.length; next++) {
        const other = placed[next];
        if (other === undefined) throw "debug placed invariant";
        if (other.candidate.variable !== candidate.variable) break;
        if (other.start > entry.start) {
          end = Math.min(end, other.start);
          break;
        }
      }
      if (end <= entry.start) continue;
      out.push({
        variable: candidate.variable,
        value: candidate.value,
        block: source.id,
        start: entry.start,
        end,
        lastUse: end === last,
      });
    }
  }
}
interface ValueBindingLike {
  readonly variable: number;
  readonly value: number;
  readonly after: number;
}
function analyze(fn: FunctionIR): Analysis {
  const holders: Holder[] = [],
    intervals: SlotInterval[] = [],
    liveBindings: number[][] = [],
    heldValues: number[][] = [];
  valueHolders(fn, holders);
  slotIntervals(fn, intervals);
  for (let block = 0; block < fn.blocks.length; block++) {
    liveBindings.push([]);
    heldValues.push([]);
  }
  for (const interval of intervals) {
    if (interval === undefined) throw "debug interval invariant";
    const list = liveBindings[interval.block];
    if (list !== undefined && list[list.length - 1] !== interval.binding)
      list.push(interval.binding);
  }
  for (const holder of holders) {
    if (holder === undefined) throw "debug holder invariant";
    heldValues[holder.block]?.push(holder.value);
  }
  return { holders, intervals, liveBindings, heldValues };
}
export function createDebugTracker(fn: FunctionIR): DebugTracker | undefined {
  const debug = fn.debug;
  if (
    debug === undefined ||
    (debug.variables.length === 0 && debug.inlineSites.length === 0)
  )
    return undefined;
  const analysis = analyze(fn),
    operations: Operation[] = [],
    // Sampled homes of live slot bindings' words, by binding and block.
    slotHomes = new Map<number, number[]>(),
    valueHomes = new Map<number, number>(),
    saves = new Map<number, number>(),
    held = new Set<number>(),
    spills: Interval[] = [],
    open: Interval[] = [],
    promotedWords = new Map<number, number>();
  for (const holder of analysis.holders) {
    if (holder === undefined) throw "debug holder invariant";
    held.add(holder.value);
  }
  let current: Operation | undefined;
  function close(at: number): void {
    const op = current;
    if (op === undefined) return;
    current = undefined;
    op.byteLength = at - op.offset;
    if (op.byteLength > 0) operations.push(op);
  }
  return {
    block(block, slotHome, valueHome) {
      for (const index of analysis.liveBindings[block] ?? []) {
        if (index === undefined) throw "debug live binding invariant";
        const binding = debug.slots[index];
        if (binding === undefined) throw "debug slot binding invariant";
        const type = fn.slots[binding.slot];
        if (type === undefined) throw "debug slot invariant";
        const homes: number[] = [];
        for (let word = 0; word < scalarByteLength(type) / 8; word++)
          homes.push(slotHome(binding.slot, word));
        slotHomes.set(index * fn.blocks.length + block, homes);
      }
      for (const id of analysis.heldValues[block] ?? []) {
        if (id === undefined) throw "debug held value invariant";
        valueHomes.set(id, valueHome(id));
      }
    },
    operation(block, index, inline, at) {
      close(at);
      current = { block, index, inline, offset: at, byteLength: 0 };
    },
    end(at) {
      close(at);
    },
    saved(id, at) {
      if (held.has(id) && !saves.has(id)) saves.set(id, at);
    },
    spilled(slots, at) {
      for (const slot of slots) {
        if (slot === undefined) throw "debug spill invariant";
        const interval: Interval = { slot, start: at, end: at };
        open.push(interval);
        spills.push(interval);
      }
    },
    reloaded(at) {
      for (const interval of open) {
        if (interval === undefined) throw "debug spill invariant";
        interval.end = at;
      }
      open.length = 0;
    },
    promoted(byteOffset, register) {
      promotedWords.set(byteOffset, register);
    },
    finish(context) {
      return describe(fn, analysis, {
        operations,
        slotHomes,
        valueHomes,
        saves,
        spills,
        promotedWords,
        context,
      });
    },
  };
}
interface Facts {
  readonly operations: readonly Operation[];
  readonly slotHomes: ReadonlyMap<number, readonly number[]>;
  readonly valueHomes: ReadonlyMap<number, number>;
  readonly saves: ReadonlyMap<number, number>;
  readonly spills: readonly Interval[];
  readonly promotedWords: ReadonlyMap<number, number>;
  readonly context: DebugFrameContext;
}
function sameWords(
  a: readonly NativeDebugWord[],
  b: readonly NativeDebugWord[],
): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index++) {
    const left = a[index],
      right = b[index];
    if (left === undefined || right === undefined) return false;
    if (left.kind !== right.kind) return false;
    if (left.kind === "frame" && right.kind === "frame") {
      if (left.offset !== right.offset) return false;
    } else if (left.kind !== "frame" && right.kind !== "frame") {
      if (left.register !== right.register) return false;
    }
  }
  return true;
}
interface Pending {
  readonly offset: number;
  readonly byteLength: number;
  readonly words: readonly NativeDebugWord[];
  /** Lower wins where ranges overlap. */
  readonly priority: number;
}
/** Clip to frame-valid code, resolve overlaps (lower priority value, then
 * earlier start, wins) and merge adjacent ranges with the same storage. */
function normalize(
  ranges: Pending[],
  frames: DebugFrameContext["frameRanges"],
): NativeDebugLocation[] {
  ranges.sort((a, b) =>
    a.priority !== b.priority ? a.priority - b.priority : a.offset - b.offset,
  );
  // Accepted pieces stay sorted and disjoint per priority pass.
  let accepted: Pending[] = [];
  let index = 0;
  while (index < ranges.length) {
    const priority = ranges[index]?.priority ?? 0,
      merged: Pending[] = [];
    let cursor = 0,
      coveredUntil = -1;
    for (; index < ranges.length; index++) {
      const range = ranges[index];
      if (range === undefined) throw "debug range invariant";
      if (range.priority !== priority) break;
      let from = Math.max(range.offset, coveredUntil);
      const end = range.offset + range.byteLength;
      // Subtract the higher-priority pieces (sorted, disjoint).
      while (cursor < accepted.length) {
        const taken = accepted[cursor];
        if (taken === undefined) throw "debug accepted invariant";
        if (taken.offset + taken.byteLength <= from) cursor++;
        else break;
      }
      let scan = cursor;
      while (from < end) {
        const taken = accepted[scan];
        if (taken === undefined || taken.offset >= end) {
          merged.push({
            offset: from,
            byteLength: end - from,
            words: range.words,
            priority,
          });
          break;
        }
        if (taken.offset > from)
          merged.push({
            offset: from,
            byteLength: taken.offset - from,
            words: range.words,
            priority,
          });
        from = Math.max(from, taken.offset + taken.byteLength);
        scan++;
      }
      coveredUntil = Math.max(coveredUntil, end);
    }
    const combined: Pending[] = [];
    let left = 0,
      right = 0;
    while (left < accepted.length || right < merged.length) {
      const a = accepted[left],
        b = merged[right];
      if (b === undefined || (a !== undefined && a.offset <= b.offset)) {
        if (a === undefined) throw "debug merge invariant";
        combined.push(a);
        left++;
      } else {
        combined.push(b);
        right++;
      }
    }
    accepted = combined;
  }
  const result: NativeDebugLocation[] = [];
  let frame = 0;
  for (const piece of accepted) {
    if (piece === undefined) throw "debug piece invariant";
    const end = piece.offset + piece.byteLength;
    while (frame < frames.length) {
      const range = frames[frame];
      if (range === undefined) throw "debug frame invariant";
      if (range.offset + range.byteLength <= piece.offset) frame++;
      else break;
    }
    for (let scan = frame; scan < frames.length; scan++) {
      const range = frames[scan];
      if (range === undefined) throw "debug frame invariant";
      if (range.offset >= end) break;
      const from = Math.max(piece.offset, range.offset),
        to = Math.min(end, range.offset + range.byteLength);
      if (to <= from) continue;
      const previous = result[result.length - 1];
      if (
        previous !== undefined &&
        previous.offset + previous.byteLength === from &&
        sameWords(previous.words, piece.words)
      )
        result[result.length - 1] = {
          offset: previous.offset,
          byteLength: to - previous.offset,
          words: previous.words,
        };
      else
        result.push({
          offset: from,
          byteLength: to - from,
          words: piece.words,
        });
    }
  }
  return result;
}
function homeWord(
  home: number,
  frameOffset: number,
  facts: Facts,
): NativeDebugWord {
  if (home >= 32) return { kind: "general", register: home - 32 };
  if (home !== 0) return { kind: "float", register: home };
  const promoted = facts.promotedWords.get(frameOffset);
  if (promoted !== undefined) return { kind: "float", register: promoted };
  return { kind: "frame", offset: frameOffset - facts.context.frameBytes };
}
function describe(
  fn: FunctionIR,
  analysis: Analysis,
  facts: Facts,
): NativeFunctionDebug {
  const debug = fn.debug;
  if (debug === undefined) throw "debug metadata invariant";
  const context = facts.context;
  // Operations by block and position (the terminator at the block length).
  const positions: (Operation | undefined)[][] = [];
  for (const block of fn.blocks) {
    if (block === undefined) throw "debug block invariant";
    const list: (Operation | undefined)[] = [];
    for (let index = 0; index <= block.instructions.length; index++)
      list.push(undefined);
    positions.push(list);
  }
  for (const op of facts.operations) {
    if (op === undefined) throw "debug operation invariant";
    const list = positions[op.block],
      block = fn.blocks[op.block];
    if (list === undefined || block === undefined) continue;
    list[op.index < 0 ? block.instructions.length : op.index] = op;
  }
  /** The contiguous code of positions from..to of a block, if any. */
  function span(
    block: number,
    from: number,
    to: number,
  ): { start: number; end: number } | undefined {
    const list = positions[block];
    if (list === undefined) return undefined;
    let first: Operation | undefined, last: Operation | undefined;
    for (let index = from; index <= to && first === undefined; index++)
      first = list[index];
    for (let index = to; index >= from && last === undefined; index--)
      last = list[index];
    if (first === undefined || last === undefined) return undefined;
    return { start: first.offset, end: last.offset + last.byteLength };
  }
  function collects(block: number, index: number): boolean {
    const instruction = fn.blocks[block]?.instructions[index];
    return instruction !== undefined && context.collects(instruction);
  }
  const ranges: Pending[][] = [],
    encodings: ({ type: ScalarType; integer: boolean } | undefined)[] = [];
  for (let index = 0; index < debug.variables.length; index++) {
    ranges.push([]);
    encodings.push(undefined);
  }
  function encoded(
    variable: number,
    type: ScalarType,
    integer: boolean,
  ): boolean {
    const known = encodings[variable];
    if (known === undefined) {
      encodings[variable] = { type, integer };
      return true;
    }
    return known.type === type && known.integer === integer;
  }
  // Slot-held ranges take priority over value holders.
  for (const interval of analysis.intervals) {
    if (interval === undefined) throw "debug interval invariant";
    const binding = debug.slots[interval.binding],
      homes = facts.slotHomes.get(
        interval.binding * fn.blocks.length + interval.block,
      );
    if (binding === undefined) throw "debug slot binding invariant";
    const type = fn.slots[binding.slot],
      out = ranges[binding.variable];
    if (type === undefined || out === undefined || homes === undefined)
      continue;
    if (
      !encoded(binding.variable, type, context.integerSlots[binding.slot] === 1)
    )
      continue;
    const base = context.slotOffset(binding.slot),
      words: NativeDebugWord[] = [];
    let registerReference = false;
    for (let word = 0; word < homes.length; word++) {
      const home = homes[word] ?? 0;
      if (home >= 32 && homes.length === 1 && context.managed(type))
        registerReference = true;
      words.push(homeWord(home, base + word * 8, facts));
    }
    if (!registerReference) {
      const code = span(interval.block, interval.from, interval.to);
      if (code !== undefined)
        out.push({
          offset: code.start,
          byteLength: code.end - code.start,
          words,
          priority: 0,
        });
      continue;
    }
    // A register-homed reference: while an operation may collect, only the
    // frame word is updated. It holds the reference between the spill and
    // the reload; elsewhere in that operation nothing is described.
    const list = positions[interval.block];
    if (list === undefined) continue;
    for (let index = interval.from; index <= interval.to; index++) {
      const op = list[index];
      if (op === undefined) continue;
      if (!collects(interval.block, index)) {
        out.push({
          offset: op.offset,
          byteLength: op.byteLength,
          words,
          priority: 0,
        });
        continue;
      }
      const end = op.offset + op.byteLength;
      for (const spill of facts.spills) {
        if (spill === undefined) throw "debug spill invariant";
        if (
          spill.slot !== binding.slot ||
          spill.start < op.offset ||
          spill.start >= end
        )
          continue;
        out.push({
          offset: op.offset,
          byteLength: spill.start - op.offset,
          words,
          priority: 0,
        });
        out.push({
          offset: spill.start,
          byteLength: spill.end - spill.start,
          words: [{ kind: "frame", offset: base - context.frameBytes }],
          priority: 0,
        });
        out.push({
          offset: spill.end,
          byteLength: end - spill.end,
          words,
          priority: 0,
        });
      }
    }
  }
  for (const holder of analysis.holders) {
    if (holder === undefined) throw "debug holder invariant";
    const storage = context.valueStorage(holder.value),
      saved = facts.saves.get(holder.value),
      home = facts.valueHomes.get(holder.value),
      out = ranges[holder.variable];
    if (
      storage === undefined ||
      saved === undefined ||
      home === undefined ||
      out === undefined ||
      scalarByteLength(storage.type) !== 8 ||
      !encoded(holder.variable, storage.type, storage.integer)
    )
      continue;
    const word = homeWord(home, storage.offset, facts);
    // A register-homed reference is stale once the collector may run.
    let end = holder.end;
    const reference = context.managed(storage.type) && word.kind !== "frame";
    if (reference)
      for (let index = holder.start + 1; index <= end; index++)
        if (collects(holder.block, index)) {
          end = index - 1;
          break;
        }
    if (end <= holder.start) continue;
    const list = positions[holder.block],
      code = span(holder.block, holder.start + 1, end);
    if (list === undefined || code === undefined) continue;
    // At the value's last use only that operation's first word is certain:
    // the operation may reuse the home for its own result.
    let stop = code.end;
    const last = list[end];
    if (holder.lastUse && end === holder.end && last !== undefined)
      stop = last.offset + 4;
    const start = Math.max(code.start, saved);
    if (stop > start)
      out.push({
        offset: start,
        byteLength: stop - start,
        words: [word],
        priority: 1,
      });
  }
  const result: NativeDebugVariable[] = [];
  for (let variable = 0; variable < debug.variables.length; variable++) {
    const source = debug.variables[variable],
      list = ranges[variable],
      encoding = encodings[variable];
    if (source === undefined || list === undefined)
      throw "debug variable invariant";
    result.push({
      name: source.name,
      parameter: source.parameter,
      start: source.start,
      end: source.end,
      type: encoding === undefined ? "number" : encoding.type,
      integer: encoding === undefined ? false : encoding.integer,
      record: source.record,
      inline: source.inline,
      locations: normalize(list, context.frameRanges),
    });
  }
  const inlineRanges: NativeInlineRange[] = [];
  for (const op of facts.operations) {
    if (op === undefined) throw "debug operation invariant";
    if (op.inline < 0) continue;
    const previous = inlineRanges[inlineRanges.length - 1];
    if (
      previous !== undefined &&
      previous.site === op.inline &&
      previous.offset + previous.byteLength === op.offset
    )
      inlineRanges[inlineRanges.length - 1] = {
        site: previous.site,
        offset: previous.offset,
        byteLength: previous.byteLength + op.byteLength,
      };
    else
      inlineRanges.push({
        site: op.inline,
        offset: op.offset,
        byteLength: op.byteLength,
      });
  }
  return {
    variables: result,
    inlineSites: debug.inlineSites,
    inlineRanges,
  };
}
