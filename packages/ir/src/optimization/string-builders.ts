import {
  blockSuccessors,
  instructionResult,
  maximumStringLength,
  naturalLoops,
  visitInstructionOperands,
  visitTerminatorOperands,
  type Block,
  type FunctionIR,
  type Instruction,
  type NaturalLoop,
  type ScalarType,
  type Terminator,
} from "../scalar/index.ts";
import type { RemarkSink } from "./observer.ts";

export interface LoopStringBuilders {
  readonly fn: FunctionIR;
  readonly visited: number;
  /** Loops whose appends to a string now write into a builder. */
  readonly rewritten: number;
}

/** Fewest code units a builder buffer grows to. */
const minimumCapacity = 16;
/** Growths that concatenate exactly before the buffer takes over. */
const exactGrowths = 3;

/** One piece of an inlined multi-piece string-allocate written directly into
 * a loop builder buffer instead of through a temporary string. */
interface InlinePiece {
  readonly literal?: string;
  readonly value: number;
  readonly sourceSlot?: number;
}
/** A single-use `string-allocate` filled by contiguous `string-write`s right
 * before an append's `string-concat` (as emitted by multi-piece templates and
 * `+` chains). */
interface InlineAllocation {
  readonly allocIndex: number;
  readonly writeIndices: readonly number[];
  readonly lengthValue: number;
  readonly oneByte: boolean;
  readonly twoByteValue: number;
  readonly pieces: readonly InlinePiece[];
}
/** One `s = s + piece` of a candidate slot: the load of the slot, the
 * concatenation and the store back, in one block. */
interface Append {
  readonly block: number;
  readonly load: number;
  readonly concat: number;
  readonly store: number;
  readonly piece: number;
  readonly inline?: InlineAllocation;
  readonly start: number;
  readonly end: number;
}

interface Candidate {
  readonly loop: NaturalLoop;
  readonly preheader: number;
  readonly slot: number;
  readonly appends: readonly Append[];
}

/**
 * Loops that build a string by appending to a local (`s += piece`, or
 * `s = s + piece`) copy the whole string at every append. When a loop's
 * only uses of a string slot are such appends, the loop instead appends
 * into a builder: a buffer string with spare capacity (string-allocate,
 * filled by string-write) and its written length, both in fresh slots. A
 * full buffer grows to about twice the needed length, copying once, and a
 * two-byte piece moves a one-byte buffer to a two-byte one. The first
 * growths (exactGrowths) concatenate exactly instead, as the loop did, so
 * a loop of a few appends (joining a handful of parts) copies no more than
 * before and its result stays flat; the buffer takes over after them.
 * Every loop exit stores the written prefix back to the slot: the buffer
 * itself when it is exactly full, otherwise its slice (string-slice), whose
 * kind is canonical. The buffer's unwritten tail is never read.
 *
 * The slot keeps its value from before the loop until an exit, which no
 * one observes: the loop's blocks have no exception edges (a throw leaves
 * the function, where the local is dead), and functions whose debug
 * metadata binds the slot to a source variable are left unchanged.
 * Allocation limits fail where the concatenation would: a result longer
 * than the maximum string length requests that length, which throws.
 */
export function buildLoopStrings(
  fn: FunctionIR,
  budget: number,
  remarks?: RemarkSink,
): LoopStringBuilders | undefined {
  if (!Number.isSafeInteger(budget) || budget < 0)
    throw "INVALID_OPTIMIZATION_BUDGET";
  if (fn.import === true) return { fn, visited: 0, rewritten: 0 };
  let current = fn,
    visited = 0,
    rewritten = 0;
  // Each round rewrites one loop, then recomputes loops and uses.
  for (let round = 0; round < 16; round++) {
    const remaining = budget - visited;
    if (remaining <= 0) return undefined;
    const found = findCandidate(current, remaining);
    if (found === undefined) return undefined;
    visited += found.visited;
    const candidate = found.candidate;
    if (candidate === undefined) break;
    current = rewriteLoop(current, candidate);
    rewritten++;
    if (remarks !== undefined) {
      const first = candidate.appends[0];
      remarks({
        pass: "build-loop-strings",
        outcome: "applied",
        function: fn.name,
        start: first === undefined ? 0 : first.start,
        end: first === undefined ? 0 : first.end,
        message:
          String(candidate.appends.length) +
          " appends to a string build it in a buffer",
      });
    }
  }
  return { fn: current, visited, rewritten };
}

/** The first loop and string slot this pass can rewrite, outer loops first
 * (an append in a nested loop then needs one builder for the whole nest). */
function findCandidate(
  fn: FunctionIR,
  budget: number,
): { readonly candidate: Candidate | undefined; visited: number } | undefined {
  const forest = naturalLoops(fn, budget);
  if (forest === undefined) return undefined;
  let visited = forest.visited;
  if (forest.loops.length === 0) return { candidate: undefined, visited };
  const byId = new Map<number, Block>(),
    predecessors = new Map<number, number[]>();
  let maximum = -1;
  for (const block of fn.blocks) {
    if (block === undefined) throw "string builder block invariant";
    byId.set(block.id, block);
    for (const op of block.instructions) {
      if (op === undefined) throw "string builder instruction invariant";
      const id = instructionResult(op);
      if (id !== undefined && id > maximum) maximum = id;
    }
  }
  for (const block of fn.blocks) {
    if (block === undefined) throw "string builder block invariant";
    for (const target of blockSuccessors(block)) {
      if (target === undefined) throw "string builder successor invariant";
      const list = predecessors.get(target);
      if (list === undefined) predecessors.set(target, [block.id]);
      else list.push(block.id);
    }
  }
  // Uses of every value, so an append's load and concatenation are known
  // to have no other reader.
  const uses = new Uint32Array(maximum + 1);
  const count = (id: number): void => {
    if (id >= 0 && id <= maximum) uses[id] = (uses[id] ?? 0) + 1;
  };
  for (const block of fn.blocks) {
    if (block === undefined) throw "string builder block invariant";
    for (const op of block.instructions) {
      if (op === undefined) throw "string builder instruction invariant";
      visitInstructionOperands(op, count);
      visited++;
    }
    visitTerminatorOperands(block.terminator, count);
  }
  if (visited > budget) return undefined;
  const debugSlots = new Set<number>();
  const debug = fn.debug;
  if (debug !== undefined)
    for (const binding of debug.slots) {
      if (binding === undefined) throw "string builder debug invariant";
      debugSlots.add(binding.slot);
    }
  const loops = forest.loops.slice();
  loops.sort((left, right) => right.body.size - left.body.size);
  for (const loop of loops) {
    if (loop === undefined) throw "string builder loop invariant";
    const outside = (predecessors.get(loop.header) ?? []).filter(
      (id) => id !== undefined && !loop.body.has(id),
    );
    const preheaderId = outside[0];
    if (outside.length !== 1 || preheaderId === undefined) continue;
    const preheader = byId.get(preheaderId);
    if (
      preheader === undefined ||
      preheader.terminator.kind !== "jump" ||
      preheader.exception !== undefined
    )
      continue;
    // No exception edges, and every exit is a jump or branch.
    let unsupported = false;
    for (const id of loop.body) {
      const block = byId.get(id);
      if (block === undefined || block.exception !== undefined) {
        unsupported = true;
        continue;
      }
      const kind = block.terminator.kind;
      if (kind === "jump" || kind === "branch") continue;
      for (const target of blockSuccessors(block))
        if (target !== undefined && !loop.body.has(target)) unsupported = true;
    }
    if (unsupported) continue;
    for (const slot of loop.writes) {
      if (fn.slots[slot] !== "string" || debugSlots.has(slot)) continue;
      const appends = slotAppends(fn, loop, byId, uses, slot);
      visited += loop.body.size;
      if (appends !== undefined && appends.length > 0)
        return {
          candidate: { loop, preheader: preheaderId, slot, appends },
          visited,
        };
    }
  }
  return { candidate: undefined, visited };
}

/** Every access of `slot` in the loop when each is part of an append (a
 * load read only by a string-concat's left operand whose only use is a
 * store back to the slot, all in one block); otherwise undefined. */
function slotAppends(
  fn: FunctionIR,
  loop: NaturalLoop,
  byId: ReadonlyMap<number, Block>,
  uses: Uint32Array,
  slot: number,
): Append[] | undefined {
  const appends: Append[] = [];
  for (const id of loop.body) {
    const block = byId.get(id);
    if (block === undefined) return undefined;
    if (terminatorSlot(block.terminator) === slot) return undefined;
    const instructions = block.instructions;
    // Pending loads of the slot, by value, and concatenations of them.
    const loads = new Map<number, number>(),
      concats = new Map<number, number>();
    for (let index = 0; index < instructions.length; index++) {
      const op = instructions[index];
      if (op === undefined) return undefined;
      if (op.kind === "load" && op.slot === slot) {
        if ((uses[op.id] ?? 0) !== 1) return undefined;
        loads.set(op.id, index);
        continue;
      }
      if (op.kind === "string-concat" && loads.has(op.left)) {
        if (loads.has(op.right) || (uses[op.id] ?? 0) !== 1) return undefined;
        concats.set(op.id, index);
        continue;
      }
      if (op.kind === "store" && op.slot === slot) {
        const concatIndex = concats.get(op.value);
        if (concatIndex === undefined) return undefined;
        const concat = instructions[concatIndex];
        if (concat === undefined || concat.kind !== "string-concat")
          return undefined;
        const loadIndex = loads.get(concat.left);
        if (loadIndex === undefined) return undefined;
        loads.delete(concat.left);
        concats.delete(op.value);
        const inline = matchInlineAllocation(
          block,
          loadIndex,
          concatIndex,
          concat.right,
          uses,
          slot,
        );
        appends.push({
          block: id,
          load: loadIndex,
          concat: concatIndex,
          store: index,
          piece: concat.right,
          ...(inline === undefined ? {} : { inline }),
          start: concat.start,
          end: concat.end,
        });
        continue;
      }
      // Any other reader of a pending load or concatenation disqualifies.
      let reads = false;
      visitInstructionOperands(op, (value) => {
        if (loads.has(value) || concats.has(value)) reads = true;
      });
      if (reads) return undefined;
    }
    if (loads.size !== 0 || concats.size !== 0) return undefined;
    let terminatorReads = false;
    visitTerminatorOperands(block.terminator, (value) => {
      if (loads.has(value) || concats.has(value)) terminatorReads = true;
    });
    if (terminatorReads) return undefined;
    // Values are block-local and an append splits its block at the
    // concatenation: no value defined before it may be read after it.
    if (crossesSplit(block, appends, id)) return undefined;
  }
  return fn.slots[slot] === "string" ? appends : undefined;
}

/** Linear combination of a nonnegative integer constant and variable string
 * lengths (`string-length(v)`), used to prove contiguous `string-write`
 * offsets covering `[0, alloc.length)`. */
interface LengthSum {
  readonly constant: number;
  readonly terms: readonly number[];
}
function sameLengthSum(left: LengthSum, right: LengthSum): boolean {
  if (left.constant !== right.constant) return false;
  if (left.terms.length !== right.terms.length) return false;
  for (let i = 0; i < left.terms.length; i++)
    if (left.terms[i] !== right.terms[i]) return false;
  return true;
}
function addLengthSums(left: LengthSum, right: LengthSum): LengthSum {
  const sum = left.constant + right.constant;
  const terms: number[] = [];
  for (const term of left.terms) if (term !== undefined) terms.push(term);
  for (const term of right.terms) if (term !== undefined) terms.push(term);
  terms.sort((a, b) => a - b);
  return { constant: sum, terms };
}
/** Recognize when `piece` is a single-use `string-allocate` in `block` filled
 * contiguously by `m >= 2` `string-write`s immediately feeding `concatIndex`,
 * with no intervening side effects. */
function matchInlineAllocation(
  block: Block,
  loadIndex: number,
  concatIndex: number,
  piece: number,
  uses: Uint32Array,
  slot: number,
): InlineAllocation | undefined {
  const instructions = block.instructions;
  const defs = new Map<number, Instruction>();
  const defIndex = new Map<number, number>();
  let allocIndex = -1;
  for (let i = 0; i < concatIndex; i++) {
    const op = instructions[i];
    if (op === undefined) return undefined;
    const result = instructionResult(op);
    if (result !== undefined) {
      defs.set(result, op);
      defIndex.set(result, i);
      if (result === piece && op.kind === "string-allocate") allocIndex = i;
    }
  }
  if (allocIndex < 0) return undefined;
  const alloc = instructions[allocIndex];
  if (alloc === undefined || alloc.kind !== "string-allocate") return undefined;
  const writeIndices: number[] = [];
  for (let i = allocIndex + 1; i < concatIndex; i++) {
    const op = instructions[i];
    if (op === undefined) return undefined;
    if (op.kind === "string-write" && op.target === piece) {
      if (op.source === piece || op.offset === piece) return undefined;
      writeIndices.push(i);
      continue;
    }
    if (i === loadIndex) continue;
    // Allow only pure local instructions between allocation and concat so
    // removing the temporary allocation cannot reorder side effects or throws.
    if (
      op.kind !== "constant" &&
      op.kind !== "string-literal" &&
      op.kind !== "load" &&
      op.kind !== "binary" &&
      op.kind !== "unary" &&
      op.kind !== "string-length" &&
      op.kind !== "string-two-byte"
    )
      return undefined;
  }
  if (writeIndices.length < 2) return undefined;
  if ((uses[piece] ?? 0) !== writeIndices.length + 1) return undefined;
  const memo = new Map<number, LengthSum>();
  const failed = new Set<number>();
  function resolveLength(id: number): LengthSum | undefined {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    if (failed.has(id)) return undefined;
    // Guard against unexpected cycles before recursing.
    failed.add(id);
    const def = defs.get(id);
    if (def === undefined) return undefined;
    let resolved: LengthSum | undefined;
    if (def.kind === "constant") {
      const value = def.value;
      if (
        typeof value === "number" &&
        Number.isSafeInteger(value) &&
        value >= 0
      )
        resolved = { constant: value, terms: [] };
    } else if (def.kind === "string-length") {
      const target = defs.get(def.string);
      if (target !== undefined && target.kind === "string-literal")
        resolved = { constant: target.value.length, terms: [] };
      else resolved = { constant: 0, terms: [def.string] };
    } else if (def.kind === "binary" && def.operator === "+") {
      const left = resolveLength(def.left),
        right = resolveLength(def.right);
      if (left !== undefined && right !== undefined)
        resolved = addLengthSums(left, right);
    }
    if (resolved !== undefined) {
      failed.delete(id);
      memo.set(id, resolved);
    }
    return resolved;
  }
  let running: LengthSum = { constant: 0, terms: [] };
  const pieces: InlinePiece[] = [];
  for (const writeIndex of writeIndices) {
    if (writeIndex === undefined) return undefined;
    const write = instructions[writeIndex];
    if (write === undefined || write.kind !== "string-write") return undefined;
    const offset = resolveLength(write.offset);
    if (offset === undefined || !sameLengthSum(offset, running))
      return undefined;
    const srcDef = defs.get(write.source);
    if (srcDef !== undefined && srcDef.kind === "string-literal") {
      running = {
        constant: running.constant + srcDef.value.length,
        terms: running.terms,
      };
      pieces.push({ literal: srcDef.value, value: write.source });
    } else {
      running = addLengthSums(running, { constant: 0, terms: [write.source] });
      let sourceSlot: number | undefined;
      if (
        srcDef !== undefined &&
        srcDef.kind === "load" &&
        srcDef.slot !== slot
      ) {
        const at = defIndex.get(write.source);
        if (at !== undefined) {
          let overwritten = false;
          for (let j = at + 1; j < concatIndex; j++) {
            const between = instructions[j];
            if (
              between !== undefined &&
              between.kind === "store" &&
              between.slot === srcDef.slot
            ) {
              overwritten = true;
              break;
            }
          }
          if (!overwritten) sourceSlot = srcDef.slot;
        }
      }
      pieces.push(
        sourceSlot === undefined
          ? { value: write.source }
          : { value: write.source, sourceSlot },
      );
    }
  }
  const total = resolveLength(alloc.length);
  if (total === undefined || !sameLengthSum(total, running)) return undefined;
  const twoByteDef = defs.get(alloc.twoByte);
  const oneByte =
    twoByteDef !== undefined &&
    twoByteDef.kind === "constant" &&
    twoByteDef.value === false;
  return {
    allocIndex,
    writeIndices,
    lengthValue: alloc.length,
    oneByte,
    twoByteValue: alloc.twoByte,
    pieces,
  };
}

/** Whether a value defined before one of the block's appends is read after
 * its concatenation (which itself consumes the slot's load and the piece;
 * a piece read again later counts). */
function crossesSplit(
  block: Block,
  appends: readonly Append[],
  id: number,
): boolean {
  const defined = new Map<number, number>();
  const instructions = block.instructions;
  for (let index = 0; index < instructions.length; index++) {
    const op = instructions[index];
    if (op === undefined) throw "string builder instruction invariant";
    const result = instructionResult(op);
    if (result !== undefined) defined.set(result, index);
  }
  for (const append of appends) {
    if (append === undefined) throw "string builder append invariant";
    if (append.block !== id) continue;
    const split = append.concat;
    let crosses = false;
    const check = (value: number): void => {
      const at = defined.get(value);
      if (at !== undefined && at < split) crosses = true;
    };
    for (let index = split + 1; index < instructions.length; index++) {
      const op = instructions[index];
      if (op === undefined) throw "string builder instruction invariant";
      if (index === append.store) continue;
      visitInstructionOperands(op, check);
    }
    visitTerminatorOperands(block.terminator, check);
    if (crosses) return true;
  }
  return false;
}

/** The slot a terminator writes, if any. */
function terminatorSlot(term: Terminator): number | undefined {
  if (term.kind === "record" || term.kind === "record-cell") return term.slot;
  if (term.kind === "cell") return term.slot;
  return undefined;
}

/** `term` (a jump or branch: findCandidate admits no other loop exit) with
 * every successor `from` replaced by `to`. */
function retarget(term: Terminator, from: number, to: number): Terminator {
  if (term.kind === "jump")
    return {
      kind: "jump",
      target: term.target === from ? to : term.target,
      start: term.start,
      end: term.end,
    };
  if (term.kind === "branch")
    return {
      kind: "branch",
      condition: term.condition,
      consequent: term.consequent === from ? to : term.consequent,
      alternate: term.alternate === from ? to : term.alternate,
      start: term.start,
      end: term.end,
    };
  throw "string builder exit invariant";
}

function rewriteLoop(fn: FunctionIR, candidate: Candidate): FunctionIR {
  let nextValue = 0,
    nextBlock = 0;
  for (const block of fn.blocks) {
    if (block === undefined) throw "string builder block invariant";
    if (block.id >= nextBlock) nextBlock = block.id + 1;
    for (const op of block.instructions) {
      if (op === undefined) throw "string builder instruction invariant";
      const id = instructionResult(op);
      if (id !== undefined && id >= nextValue) nextValue = id + 1;
    }
  }
  const slots: ScalarType[] = fn.slots.slice();
  const bufferSlot = slots.length,
    lengthSlot = bufferSlot + 1,
    pieceSlot = bufferSlot + 2,
    growthSlot = bufferSlot + 3;
  slots.push("string", "number", "string", "number");
  const slot = candidate.slot;
  const first = candidate.appends[0];
  const start = first === undefined ? 0 : first.start,
    end = first === undefined ? 0 : first.end;
  const added: Block[] = [];
  const replaced = new Map<number, Block>();
  // Instruction builders: each appends to `out` with the first append's span.
  function value(): number {
    return nextValue++;
  }
  function load(out: Instruction[], from: number): number {
    const id = value();
    out.push({ kind: "load", id, slot: from, start, end });
    return id;
  }
  function store(out: Instruction[], to: number, stored: number): void {
    out.push({ kind: "store", slot: to, value: stored, start, end });
  }
  function stringLength(out: Instruction[], string: number): number {
    const id = value();
    out.push({ kind: "string-length", id, string, start, end });
    return id;
  }
  function stringTwoByte(out: Instruction[], string: number): number {
    const id = value();
    out.push({ kind: "string-two-byte", id, string, start, end });
    return id;
  }
  function binary(
    out: Instruction[],
    operator: string,
    left: number,
    right: number,
  ): number {
    const id = value();
    out.push({ kind: "binary", id, operator, left, right, start, end });
    return id;
  }
  function unary(
    out: Instruction[],
    operator: string,
    operand: number,
  ): number {
    const id = value();
    out.push({ kind: "unary", id, operator, operand, start, end });
    return id;
  }
  function constant(out: Instruction[], number: number): number {
    const id = value();
    out.push({ kind: "constant", id, value: number, start, end });
    return id;
  }
  function stringLiteral(out: Instruction[], text: string): number {
    const id = value();
    out.push({ kind: "string-literal", id, value: text, start, end });
    return id;
  }
  function branch(
    condition: number,
    consequent: number,
    alternate: number,
  ): Terminator {
    return { kind: "branch", condition, consequent, alternate, start, end };
  }
  function jump(target: number): Terminator {
    return { kind: "jump", target, start, end };
  }
  // Before the loop: the builder starts as the slot's string, exactly full.
  const preheader = fn.blocks.find(
    (block) => block !== undefined && block.id === candidate.preheader,
  );
  if (preheader === undefined) throw "string builder preheader invariant";
  {
    const out = preheader.instructions.slice();
    const seed = load(out, slot);
    store(out, bufferSlot, seed);
    store(out, lengthSlot, stringLength(out, seed));
    store(out, growthSlot, constant(out, 0));
    replaced.set(preheader.id, {
      id: preheader.id,
      instructions: out,
      terminator: preheader.terminator,
    });
  }
  // Appends: each splits its block at the concatenation.
  const byBlock = new Map<number, Append[]>();
  for (const append of candidate.appends) {
    if (append === undefined) throw "string builder append invariant";
    const list = byBlock.get(append.block);
    if (list === undefined) byBlock.set(append.block, [append]);
    else list.push(append);
  }
  /** Final block (holding the original terminator) of each body block. */
  const tails = new Map<number, number>();
  for (const block of fn.blocks) {
    if (block === undefined) throw "string builder block invariant";
    const appends = byBlock.get(block.id);
    if (appends === undefined) continue;
    const skip = new Set<number>(),
      splits = new Map<number, Append>();
    for (const append of appends) {
      if (append === undefined) throw "string builder append invariant";
      skip.add(append.load);
      skip.add(append.store);
      const inline = append.inline;
      if (inline !== undefined) {
        skip.add(inline.allocIndex);
        for (const writeIndex of inline.writeIndices)
          if (writeIndex !== undefined) skip.add(writeIndex);
      }
      splits.set(append.concat, append);
    }
    let id = block.id,
      out: Instruction[] = [];
    for (let index = 0; index < block.instructions.length; index++) {
      const op = block.instructions[index];
      if (op === undefined) throw "string builder instruction invariant";
      if (skip.has(index)) continue;
      const append = splits.get(index);
      if (append === undefined) {
        out.push(op);
        continue;
      }
      const inline = append.inline;
      if (inline !== undefined) {
        // Multi-piece append: write every piece directly into the builder
        // buffer without allocating or copying a temporary string.
        const pieceLengthSlot = slots.length;
        slots.push("number");
        let pieceWideSlot = -1;
        if (!inline.oneByte) {
          pieceWideSlot = slots.length;
          slots.push("boolean");
        }
        const resolvedSlots: number[] = [];
        for (const piece of inline.pieces) {
          if (piece === undefined)
            throw "string builder inline piece invariant";
          if (piece.literal !== undefined) {
            resolvedSlots.push(-1);
          } else if (piece.sourceSlot !== undefined) {
            resolvedSlots.push(piece.sourceSlot);
          } else {
            const fresh = slots.length;
            slots.push("string");
            store(out, fresh, piece.value);
            resolvedSlots.push(fresh);
          }
        }
        store(out, pieceLengthSlot, inline.lengthValue);
        if (pieceWideSlot >= 0) store(out, pieceWideSlot, inline.twoByteValue);
        const grow = nextBlock++,
          exact = nextBlock++,
          allocate = nextBlock++,
          write = nextBlock++,
          rest = nextBlock++;
        const need = binary(
          out,
          "+",
          load(out, lengthSlot),
          inline.lengthValue,
        );
        const full = binary(
          out,
          ">",
          need,
          stringLength(out, load(out, bufferSlot)),
        );
        let fitTarget = write;
        if (!inline.oneByte) {
          const kindCheck = nextBlock++,
            bufferKind = nextBlock++;
          fitTarget = kindCheck;
          const pieceChecks: Instruction[] = [];
          const pieceTwoByte = load(pieceChecks, pieceWideSlot);
          added.push({
            id: kindCheck,
            instructions: pieceChecks,
            terminator: branch(pieceTwoByte, bufferKind, write),
          });
          const bufferChecks: Instruction[] = [];
          const bufferTwoByte = stringTwoByte(
            bufferChecks,
            load(bufferChecks, bufferSlot),
          );
          added.push({
            id: bufferKind,
            instructions: bufferChecks,
            terminator: branch(bufferTwoByte, write, grow),
          });
        }
        const head: Block = {
          id,
          instructions: out,
          terminator: branch(full, grow, fitTarget),
        };
        if (id === block.id) replaced.set(id, head);
        else added.push(head);
        const growths: Instruction[] = [];
        const count = load(growths, growthSlot);
        store(
          growths,
          growthSlot,
          binary(growths, "+", count, constant(growths, 1)),
        );
        added.push({
          id: grow,
          instructions: growths,
          terminator: branch(
            binary(growths, "<", count, constant(growths, exactGrowths)),
            exact,
            allocate,
          ),
        });
        const emitWide = (
          targetOut: Instruction[],
          oldBuffer: number,
        ): number =>
          inline.oneByte
            ? stringTwoByte(targetOut, oldBuffer)
            : binary(
                targetOut,
                "!==",
                binary(
                  targetOut,
                  "|",
                  unary(
                    targetOut,
                    "boolean-number",
                    stringTwoByte(targetOut, oldBuffer),
                  ),
                  unary(
                    targetOut,
                    "boolean-number",
                    load(targetOut, pieceWideSlot),
                  ),
                ),
                constant(targetOut, 0),
              );
        // Exact growth allocates the exact needed length and copies the old
        // buffer, then jumps to `write` to copy each piece directly.
        const exactOps: Instruction[] = [];
        const exactOld = load(exactOps, bufferSlot);
        const exactNeeded = binary(
          exactOps,
          "+",
          load(exactOps, lengthSlot),
          load(exactOps, pieceLengthSlot),
        );
        const exactGrown = value();
        exactOps.push({
          kind: "string-allocate",
          id: exactGrown,
          length: exactNeeded,
          twoByte: emitWide(exactOps, exactOld),
          start,
          end,
        });
        exactOps.push({
          kind: "string-write",
          target: exactGrown,
          offset: constant(exactOps, 0),
          source: exactOld,
          start,
          end,
        });
        store(exactOps, bufferSlot, exactGrown);
        added.push({
          id: exact,
          instructions: exactOps,
          terminator: jump(write),
        });
        const growth: Instruction[] = [];
        const oldBuffer = load(growth, bufferSlot);
        const needed = binary(
          growth,
          "+",
          load(growth, lengthSlot),
          load(growth, pieceLengthSlot),
        );
        const doubled = binary(
          growth,
          "+",
          binary(growth, "+", needed, needed),
          constant(growth, minimumCapacity),
        );
        const capacity = binary(
          growth,
          "max",
          needed,
          binary(growth, "min", doubled, constant(growth, maximumStringLength)),
        );
        const grown = value();
        growth.push({
          kind: "string-allocate",
          id: grown,
          length: capacity,
          twoByte: emitWide(growth, oldBuffer),
          start,
          end,
        });
        growth.push({
          kind: "string-write",
          target: grown,
          offset: constant(growth, 0),
          source: oldBuffer,
          start,
          end,
        });
        store(growth, bufferSlot, grown);
        added.push({
          id: allocate,
          instructions: growth,
          terminator: jump(write),
        });
        const writes: Instruction[] = [];
        const buffer = load(writes, bufferSlot);
        const baseOffset = load(writes, lengthSlot);
        let relValue = -1,
          relConstant = 0;
        for (let k = 0; k < inline.pieces.length; k++) {
          const piece = inline.pieces[k],
            pieceSrcSlot = resolvedSlots[k];
          if (piece === undefined || pieceSrcSlot === undefined)
            throw "string builder inline piece invariant";
          let offset: number;
          if (relValue < 0) {
            offset =
              relConstant === 0
                ? baseOffset
                : binary(
                    writes,
                    "+",
                    baseOffset,
                    constant(writes, relConstant),
                  );
          } else {
            if (relConstant > 0) {
              relValue = binary(
                writes,
                "+",
                relValue,
                constant(writes, relConstant),
              );
              relConstant = 0;
            }
            offset = binary(writes, "+", baseOffset, relValue);
          }
          const literal = piece.literal;
          const isLast = k + 1 === inline.pieces.length;
          if (literal !== undefined) {
            const source = stringLiteral(writes, literal);
            writes.push({
              kind: "string-write",
              target: buffer,
              offset,
              source,
              start,
              end,
            });
            if (!isLast) relConstant += literal.length;
          } else {
            const source = load(writes, pieceSrcSlot);
            writes.push({
              kind: "string-write",
              target: buffer,
              offset,
              source,
              start,
              end,
            });
            if (!isLast) {
              const pieceLen = stringLength(writes, source);
              if (relValue < 0 && relConstant === 0) relValue = pieceLen;
              else if (relValue < 0) {
                relValue = binary(
                  writes,
                  "+",
                  constant(writes, relConstant),
                  pieceLen,
                );
                relConstant = 0;
              } else relValue = binary(writes, "+", relValue, pieceLen);
            }
          }
        }
        // Update lengthSlot directly from `baseOffset + pieceLengthSlot` after
        // the writes so `baseOffset` stays live in `lengthSlot`'s register and
        // the loop-carried length recurrence is one addition.
        store(
          writes,
          lengthSlot,
          binary(writes, "+", baseOffset, load(writes, pieceLengthSlot)),
        );
        added.push({ id: write, instructions: writes, terminator: jump(rest) });
        id = rest;
        out = [];
        continue;
      }
      // The check: grow when the piece does not fit, or is two-byte for a
      // one-byte buffer; otherwise write it in place.
      const grow = nextBlock++,
        kindCheck = nextBlock++,
        bufferKind = nextBlock++,
        exact = nextBlock++,
        allocate = nextBlock++,
        write = nextBlock++,
        rest = nextBlock++;
      store(out, pieceSlot, append.piece);
      const need = binary(
        out,
        "+",
        load(out, lengthSlot),
        stringLength(out, append.piece),
      );
      const full = binary(
        out,
        ">",
        need,
        stringLength(out, load(out, bufferSlot)),
      );
      const head: Block = {
        id,
        instructions: out,
        terminator: branch(full, grow, kindCheck),
      };
      if (id === block.id) replaced.set(id, head);
      else added.push(head);
      const pieceChecks: Instruction[] = [];
      const pieceTwoByte = stringTwoByte(
        pieceChecks,
        load(pieceChecks, pieceSlot),
      );
      added.push({
        id: kindCheck,
        instructions: pieceChecks,
        terminator: branch(pieceTwoByte, bufferKind, write),
      });
      const bufferChecks: Instruction[] = [];
      const bufferTwoByte = stringTwoByte(
        bufferChecks,
        load(bufferChecks, bufferSlot),
      );
      added.push({
        id: bufferKind,
        instructions: bufferChecks,
        terminator: branch(bufferTwoByte, write, grow),
      });
      // The first growths concatenate exactly. Until then the buffer is
      // exactly full (the seed or a concatenation), so it is the prefix.
      const growths: Instruction[] = [];
      const count = load(growths, growthSlot);
      store(
        growths,
        growthSlot,
        binary(growths, "+", count, constant(growths, 1)),
      );
      added.push({
        id: grow,
        instructions: growths,
        terminator: branch(
          binary(growths, "<", count, constant(growths, exactGrowths)),
          exact,
          allocate,
        ),
      });
      const joins: Instruction[] = [];
      const joined = value();
      joins.push({
        kind: "string-concat",
        id: joined,
        left: load(joins, bufferSlot),
        right: load(joins, pieceSlot),
        start,
        end,
      });
      store(joins, bufferSlot, joined);
      store(joins, lengthSlot, stringLength(joins, joined));
      added.push({ id: exact, instructions: joins, terminator: jump(rest) });
      // Grow to max(need, min(2 * need + 16, the maximum length)): past the
      // maximum, need itself is requested and the allocation throws as the
      // concatenation would. The buffer is two-byte when it or the piece is.
      const growth: Instruction[] = [];
      const oldBuffer = load(growth, bufferSlot),
        grownPiece = load(growth, pieceSlot);
      const needed = binary(
        growth,
        "+",
        load(growth, lengthSlot),
        stringLength(growth, grownPiece),
      );
      const doubled = binary(
        growth,
        "+",
        binary(growth, "+", needed, needed),
        constant(growth, minimumCapacity),
      );
      const capacity = binary(
        growth,
        "max",
        needed,
        binary(growth, "min", doubled, constant(growth, maximumStringLength)),
      );
      const wide = binary(
        growth,
        "!==",
        binary(
          growth,
          "|",
          unary(growth, "boolean-number", stringTwoByte(growth, oldBuffer)),
          unary(growth, "boolean-number", stringTwoByte(growth, grownPiece)),
        ),
        constant(growth, 0),
      );
      const grown = value();
      growth.push({
        kind: "string-allocate",
        id: grown,
        length: capacity,
        twoByte: wide,
        start,
        end,
      });
      // The whole old buffer: its written prefix and its spare tail.
      growth.push({
        kind: "string-write",
        target: grown,
        offset: constant(growth, 0),
        source: oldBuffer,
        start,
        end,
      });
      store(growth, bufferSlot, grown);
      added.push({
        id: allocate,
        instructions: growth,
        terminator: jump(write),
      });
      // Write the piece, then continue the block.
      const writes: Instruction[] = [];
      const buffer = load(writes, bufferSlot),
        length = load(writes, lengthSlot),
        piece = load(writes, pieceSlot);
      writes.push({
        kind: "string-write",
        target: buffer,
        offset: length,
        source: piece,
        start,
        end,
      });
      store(
        writes,
        lengthSlot,
        binary(writes, "+", length, stringLength(writes, piece)),
      );
      added.push({ id: write, instructions: writes, terminator: jump(rest) });
      id = rest;
      out = [];
    }
    // Body blocks have no exception edges (findCandidate).
    const tail: Block = { id, instructions: out, terminator: block.terminator };
    if (id === block.id) replaced.set(id, tail);
    else added.push(tail);
    tails.set(block.id, id);
  }
  // Exits: each edge leaving the loop stores the written prefix back.
  for (const id of candidate.loop.body) {
    const original = fn.blocks.find(
      (block) => block !== undefined && block.id === id,
    );
    if (original === undefined) throw "string builder body invariant";
    const tailId = tails.get(id) ?? id;
    let tail =
      replaced.get(tailId) ??
      added.find((block) => block !== undefined && block.id === tailId) ??
      original;
    const exits = new Set<number>();
    for (const target of blockSuccessors(original)) {
      if (target === undefined) throw "string builder successor invariant";
      if (!candidate.loop.body.has(target)) exits.add(target);
    }
    for (const target of exits) {
      const exit = nextBlock++,
        whole = nextBlock++,
        prefix = nextBlock++;
      const checks: Instruction[] = [];
      const exact = binary(
        checks,
        "===",
        load(checks, lengthSlot),
        stringLength(checks, load(checks, bufferSlot)),
      );
      added.push({
        id: exit,
        instructions: checks,
        terminator: branch(exact, whole, prefix),
      });
      const wholeStores: Instruction[] = [];
      store(wholeStores, slot, load(wholeStores, bufferSlot));
      added.push({
        id: whole,
        instructions: wholeStores,
        terminator: jump(target),
      });
      const prefixStores: Instruction[] = [];
      const buffer = load(prefixStores, bufferSlot);
      const limit = value();
      prefixStores.push({
        kind: "optional-wrap",
        id: limit,
        value: load(prefixStores, lengthSlot),
        start,
        end,
      });
      const sliced = value();
      prefixStores.push({
        kind: "string-slice",
        id: sliced,
        string: buffer,
        begin: constant(prefixStores, 0),
        limit,
        start,
        end,
      });
      store(prefixStores, slot, sliced);
      added.push({
        id: prefix,
        instructions: prefixStores,
        terminator: jump(target),
      });
      tail = {
        id: tail.id,
        instructions: tail.instructions,
        terminator: retarget(tail.terminator, target, exit),
      };
    }
    if (tail.id === original.id || replaced.has(tail.id))
      replaced.set(tail.id, tail);
    else {
      const index = added.findIndex(
        (block) => block !== undefined && block.id === tail.id,
      );
      if (index < 0) added.push(tail);
      else added[index] = tail;
    }
  }
  const blocks: Block[] = [];
  for (const block of fn.blocks) {
    if (block === undefined) throw "string builder block invariant";
    blocks.push(replaced.get(block.id) ?? block);
  }
  for (const block of added) {
    if (block === undefined) throw "string builder block invariant";
    blocks.push(block);
  }
  // Block IDs are dense: new blocks took the next IDs, in creation order.
  blocks.sort((left, right) => left.id - right.id);
  return { ...fn, slots, blocks };
}
