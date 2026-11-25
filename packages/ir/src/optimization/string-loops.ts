import {
  instructionResult,
  naturalLoops,
  substituteInstructionValues,
  substituteTerminatorValues,
  renumberInstructionResult,
  type Block,
  type FunctionIR,
  type Instruction,
  type NaturalLoop,
  type Terminator,
} from "../scalar/index.ts";
import { recordReadsKept } from "./counted-loops.ts";
import type { RemarkSink } from "./observer.ts";

export interface StringLoopVersions {
  readonly fn: FunctionIR;
  readonly visited: number;
  /** Loops now entered through a copy for each flat string kind. */
  readonly versioned: number;
}

/** Most instructions a versioned loop may have: it gains two copies. */
const maxVersionedInstructions = 96;

/**
 * A loop that reads code units of a string held in a slot it never writes
 * (`for (...) text.charCodeAt(i)`) redoes the string's kind dispatch at
 * every read: its header's kind, and a slice's parent and start. When the
 * loop is small, its preheader instead tests the string once: a flat
 * one-byte string enters a copy of the loop whose reads of that slot are
 * marked `unitKind: "one-byte"`, a flat two-byte string a copy marked
 * `"two-byte"`, and anything else (a slice) the loop itself, unchanged.
 * Marked reads load their unit directly. The copies share the loop's slots
 * and exits, so nothing after the loop changes.
 *
 * The innermost loops are versioned first, and a block joins at most one
 * versioned loop. Loops whose preheader is not a plain jump, or whose
 * copies would join a proven record read's path at an exit, are left
 * alone, as are functions with debug metadata. Verified IR with dense
 * block IDs only.
 */
export function versionStringLoops(
  fn: FunctionIR,
  budget: number,
  remarks?: RemarkSink,
): StringLoopVersions | undefined {
  if (!Number.isSafeInteger(budget) || budget < 0) return undefined;
  const count = fn.blocks.length;
  if (fn.import === true || fn.debug !== undefined || count === 0)
    return { fn, visited: 0, versioned: 0 };
  for (let index = 0; index < count; index++)
    if (fn.blocks[index]?.id !== index) return { fn, visited: 0, versioned: 0 };
  // Cheap filter: no unmarked code-unit read anywhere.
  let reads = false,
    scanned = 0;
  for (const block of fn.blocks)
    for (const op of block?.instructions ?? []) {
      if (++scanned > budget) return undefined;
      if (op?.kind === "string-code-unit" && op.unitKind === undefined)
        reads = true;
    }
  if (!reads) return { fn, visited: scanned, versioned: 0 };
  const forest = naturalLoops(fn, budget - scanned);
  if (forest === undefined) return undefined;
  let visited = scanned + forest.visited;
  const predecessors: number[][] = [];
  for (let index = 0; index < count; index++) predecessors.push([]);
  let nextValue = 0;
  for (const block of fn.blocks) {
    if (block === undefined) throw "string loop block invariant";
    for (const target of successors(block.terminator))
      predecessors[target]?.push(block.id);
    const exception = block.exception;
    if (exception !== undefined) predecessors[exception.target]?.push(block.id);
    for (const op of block.instructions) {
      if (op === undefined) throw "string loop instruction invariant";
      if (++visited > budget) return undefined;
      const id = instructionResult(op);
      if (id !== undefined && id >= nextValue) nextValue = id + 1;
    }
  }
  // Innermost loops first (by body size).
  const loops: NaturalLoop[] = [];
  for (const loop of forest.loops) {
    if (loop === undefined) throw "string loop invariant";
    let at = loops.length;
    while (at > 0 && (loops[at - 1]?.body.size ?? 0) > loop.body.size) at--;
    loops.splice(at, 0, loop);
  }
  let current = fn,
    versioned = 0;
  const touched = new Uint8Array(count);
  for (const loop of loops) {
    if (loop === undefined) throw "string loop invariant";
    let overlap = false;
    for (const id of loop.body)
      if (id !== undefined && touched[id] === 1) overlap = true;
    if (overlap) continue;
    const candidate = stringLoop(current, loop, predecessors);
    visited += candidate.visited;
    if (visited > budget) return undefined;
    if (candidate.slot < 0) continue;
    const result = versionLoop(current, loop, candidate, nextValue);
    visited += result.visited;
    if (visited > budget) return undefined;
    // The copies' exits join the loop's: a record read proven along the
    // unique-predecessor chain through an exit must stay proven.
    if (!recordReadsKept(current, result.fn)) {
      if (remarks !== undefined)
        remarks({
          pass: "version-string-loops",
          outcome: "missed",
          function: fn.name,
          start: candidate.start,
          end: candidate.end,
          message: "copies would join a proven record read's path",
        });
      continue;
    }
    current = result.fn;
    nextValue = result.nextValue;
    versioned++;
    for (const id of loop.body) if (id !== undefined) touched[id] = 1;
    if (remarks !== undefined)
      remarks({
        pass: "version-string-loops",
        outcome: "applied",
        function: fn.name,
        start: candidate.start,
        end: candidate.end,
        message: `${candidate.reads} code-unit reads entered by string kind`,
      });
  }
  return { fn: current, visited, versioned };
}

interface StringLoop {
  /** The string slot, or -1 when the loop is not a candidate. */
  readonly slot: number;
  readonly preheader: number;
  readonly reads: number;
  readonly start: number;
  readonly end: number;
  readonly visited: number;
}

/** The string slot whose code-unit reads the loop would version on: the
 * most read string slot the loop never writes. */
function stringLoop(
  fn: FunctionIR,
  loop: NaturalLoop,
  predecessors: readonly (readonly number[])[],
): StringLoop {
  const none: StringLoop = {
    slot: -1,
    preheader: -1,
    reads: 0,
    start: 0,
    end: 0,
    visited: 0,
  };
  const outside = (predecessors[loop.header] ?? []).filter(
    (id) => !loop.body.has(id),
  );
  const preheaderId = outside[0];
  if (outside.length !== 1 || preheaderId === undefined) return none;
  const preheader = fn.blocks[preheaderId];
  if (
    preheader === undefined ||
    preheader.terminator.kind !== "jump" ||
    preheader.exception !== undefined
  )
    return none;
  let visited = 0,
    size = 0,
    start = 0,
    end = 0;
  const written = new Set<number>(),
    reads = new Map<number, number>(),
    candidates: number[] = [];
  for (const id of loop.body) {
    const block = id === undefined ? undefined : fn.blocks[id];
    if (block === undefined) throw "string loop body invariant";
    const loaded = new Map<number, number>();
    for (const op of block.instructions) {
      if (op === undefined) throw "string loop instruction invariant";
      visited++;
      size++;
      if (op.kind === "load") loaded.set(op.id, op.slot);
      else if (op.kind === "store") written.add(op.slot);
      else if (op.kind === "string-code-unit" && op.unitKind === undefined) {
        const slot = loaded.get(op.string);
        if (slot !== undefined && fn.slots[slot] === "string") {
          const seen = reads.get(slot);
          if (seen === undefined) candidates.push(slot);
          reads.set(slot, (seen ?? 0) + 1);
          if (start === 0 && end === 0) {
            start = op.start;
            end = op.end;
          }
        }
      }
    }
    const t = block.terminator;
    // Cell and record transfers write their slot (reads) or read it.
    if (t.kind === "record" || t.kind === "record-cell" || t.kind === "cell")
      written.add(t.slot);
    const exception = block.exception;
    if (exception !== undefined) written.add(exception.slot);
  }
  if (size > maxVersionedInstructions) return { ...none, visited };
  let slot = -1,
    most = 0;
  for (const candidate of candidates) {
    if (candidate === undefined) throw "string loop candidate invariant";
    const uses = reads.get(candidate) ?? 0;
    if (!written.has(candidate) && uses > most) {
      slot = candidate;
      most = uses;
    }
  }
  return slot < 0
    ? { ...none, visited }
    : { slot, preheader: preheaderId, reads: most, start, end, visited };
}

/** `fn` with `loop` entered through a flat one-byte copy, a flat two-byte
 * copy or itself, by the string in `candidate.slot` (see
 * versionStringLoops). */
function versionLoop(
  fn: FunctionIR,
  loop: NaturalLoop,
  candidate: StringLoop,
  firstValue: number,
): {
  readonly fn: FunctionIR;
  readonly nextValue: number;
  readonly visited: number;
} {
  let nextValue = firstValue,
    visited = 0;
  const blocks: Block[] = fn.blocks.slice(),
    start = candidate.start,
    end = candidate.end;
  /** A copy of every body block with the slot's code-unit reads marked. */
  function copyLoop(unitKind: "one-byte" | "two-byte"): number {
    const copies = new Map<number, number>();
    for (const id of loop.body) {
      if (id === undefined) throw "string loop body invariant";
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
      if (original === undefined) throw "string loop body invariant";
      const block = fn.blocks[original],
        copyId = copies.get(original);
      if (block === undefined || copyId === undefined)
        throw "string loop block invariant";
      substitution.fill(0);
      const instructions: Instruction[] = [],
        fromSlot = new Set<number>();
      for (const op of block.instructions) {
        if (op === undefined) throw "string loop instruction invariant";
        visited++;
        const substituted = substituteInstructionValues(op, substitution),
          result = instructionResult(op);
        let copied = substituted;
        if (result !== undefined) {
          const renamed = nextValue++;
          substitution[result] = renamed + 1;
          copied = renumberInstructionResult(substituted, renamed);
        }
        if (copied.kind === "load" && copied.slot === candidate.slot)
          fromSlot.add(copied.id);
        if (copied.kind === "string-code-unit" && fromSlot.has(copied.string))
          instructions.push({ ...copied, unitKind });
        else instructions.push(copied);
      }
      const exception = block.exception;
      const copy: Block = {
        id: copyId,
        instructions,
        terminator: retarget(
          substituteTerminatorValues(block.terminator, substitution),
          route,
        ),
      };
      blocks[copyId] =
        exception === undefined
          ? copy
          : {
              ...copy,
              exception: { ...exception, target: route(exception.target) },
            };
    }
    const header = copies.get(loop.header);
    if (header === undefined) throw "string loop header invariant";
    return header;
  }
  // Values are block-local, so each copied block renames only its own
  // results (the substitution covers the original IDs).
  const oneByte = copyLoop("one-byte"),
    twoByte = copyLoop("two-byte");
  // The preheader tests the string once: flat (string-flat), then its kind.
  const preheader = fn.blocks[candidate.preheader];
  if (preheader === undefined) throw "string loop preheader invariant";
  const kindBlock = blocks.length;
  const loaded = nextValue++,
    flat = nextValue++,
    one = nextValue++,
    isFlat = nextValue++;
  const guard: Instruction[] = preheader.instructions.slice();
  guard.push({ kind: "load", id: loaded, slot: candidate.slot, start, end });
  guard.push({ kind: "string-flat", id: flat, string: loaded, start, end });
  guard.push({ kind: "constant", id: one, value: 1, start, end });
  guard.push({
    kind: "binary",
    id: isFlat,
    operator: "===",
    left: flat,
    right: one,
    start,
    end,
  });
  blocks[candidate.preheader] = {
    id: preheader.id,
    instructions: guard,
    terminator: {
      kind: "branch",
      condition: isFlat,
      consequent: kindBlock,
      alternate: loop.header,
      start,
      end,
    },
  };
  const reloaded = nextValue++,
    wide = nextValue++;
  blocks.push({
    id: kindBlock,
    instructions: [
      { kind: "load", id: reloaded, slot: candidate.slot, start, end },
      { kind: "string-two-byte", id: wide, string: reloaded, start, end },
    ],
    terminator: {
      kind: "branch",
      condition: wide,
      consequent: twoByte,
      alternate: oneByte,
      start,
      end,
    },
  });
  return { fn: { ...fn, blocks }, nextValue, visited };
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
