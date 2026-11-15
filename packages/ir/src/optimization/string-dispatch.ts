import {
  analyzeLiveSlots,
  instructionResult,
  visitInstructionOperands,
  type Block,
  type FunctionIR,
  type Instruction,
  type ScalarType,
  type Terminator,
} from "../scalar/index.ts";
import { compactReachableBlocks } from "./control-flow.ts";
import type { RemarkSink } from "./observer.ts";

/** Fewest literal tests worth a length dispatch, and most length groups
 * tested one after another rather than by bisection. */
const minimumTests = 3,
  linearGroups = 3;

/** One `value === "literal"` test block of a chain. */
interface Test {
  readonly block: Block;
  readonly slot: number;
  readonly literal: string;
  /** Successor when the value equals the literal, and otherwise. */
  readonly match: number;
  readonly miss: number;
  /** Slots the head also stores the tested value to. */
  readonly copies: readonly number[];
}

interface Chain {
  readonly tests: readonly Test[];
  /** Slots that copies of the value between the tests write. */
  readonly copies: readonly number[];
  /** Successor when no literal matches. */
  readonly exit: number;
}

interface Group {
  readonly length: number;
  readonly tests: Test[];
}

/**
 * Chains of string tests against literals on one value (`switch` cases,
 * `||` and else-if chains) compare the value with every literal in turn.
 * A string equals a literal only if their lengths match, so the chain
 * becomes a dispatch on the value's length (bisection, then equality)
 * leading to the tests of the literals with that length, in their original
 * order. Copies of the value between the tests are skipped, so their slots
 * must be dead wherever the chain exits.
 */
export function dispatchStringChains(
  fn: FunctionIR,
  budget: number,
  remarks?: RemarkSink,
): { fn: FunctionIR; visited: number; rewritten: number } | undefined {
  if (fn.import === true) return { fn, visited: 0, rewritten: 0 };
  let visited = 0;
  const chains: Chain[] = [],
    claimed = new Uint8Array(fn.blocks.length);
  for (const head of fn.blocks) {
    if (head === undefined) throw "dispatch block invariant";
    if (visited++ >= budget) return undefined;
    if (claimed[head.id] === 1) continue;
    const first = testOf(fn, head, true);
    if (first === undefined) continue;
    // Follow misses through further tests of the value and copies of it.
    const holding = new Set<number>(),
      seen = new Set<number>(),
      tests: Test[] = [first],
      copies: number[] = [],
      pendingCopies: number[] = [];
    holding.add(first.slot);
    for (const slot of first.copies) if (slot !== undefined) holding.add(slot);
    seen.add(head.id);
    let exit = first.miss,
      cursor = first.miss;
    while (!seen.has(cursor)) {
      if (visited++ >= budget) return undefined;
      seen.add(cursor);
      const block = fn.blocks[cursor];
      if (block === undefined) throw "dispatch successor invariant";
      const copy = copyOf(block);
      if (copy !== undefined && holding.has(copy.from)) {
        holding.add(copy.to);
        pendingCopies.push(copy.to);
        cursor = copy.next;
        continue;
      }
      const test = testOf(fn, block, false);
      if (test === undefined || !holding.has(test.slot)) break;
      tests.push(test);
      for (const slot of pendingCopies)
        if (slot !== undefined) copies.push(slot);
      pendingCopies.length = 0;
      exit = test.miss;
      cursor = test.miss;
    }
    if (tests.length < minimumTests) continue;
    for (const test of tests)
      if (test !== undefined) claimed[test.block.id] = 1;
    chains.push({ tests, copies, exit });
  }
  if (chains.length === 0) return { fn, visited, rewritten: 0 };
  // Skipped copies must be dead at every exit of their chain.
  const copied: number[] = [];
  for (const chain of chains) {
    if (chain === undefined) throw "dispatch chain invariant";
    for (const slot of chain.copies)
      if (slot !== undefined && !copied.includes(slot)) copied.push(slot);
  }
  let live: readonly (readonly number[])[] | undefined;
  if (copied.length > 0) {
    copied.sort((left, right) => left - right);
    const liveness = analyzeLiveSlots(fn, budget - visited, copied);
    if (liveness === undefined) return undefined;
    visited += liveness.work;
    live = liveness.slots;
  }
  const blocks: Block[] = [],
    slots: ScalarType[] = [],
    integerSlots: number[] = [];
  for (const block of fn.blocks) {
    if (block === undefined) throw "dispatch block invariant";
    blocks.push(block);
  }
  for (const slot of fn.slots) {
    if (slot === undefined) throw "dispatch slot invariant";
    slots.push(slot);
  }
  for (const slot of fn.integerSlots ?? []) {
    if (slot === undefined) throw "dispatch slot invariant";
    integerSlots.push(slot);
  }
  const values = { next: nextValueOf(fn) };
  let rewritten = 0;
  for (const chain of chains) {
    if (chain === undefined) throw "dispatch chain invariant";
    const head = chain.tests[0];
    if (head === undefined) throw "dispatch chain invariant";
    const term = head.block.terminator,
      start = term.start,
      end = term.end;
    if (live !== undefined && copyLiveAtExit(chain, live)) {
      if (remarks !== undefined)
        remarks({
          pass: "dispatch-string-chains",
          outcome: "missed",
          function: fn.name,
          start,
          end,
          message: "a copy of the tested string is read after the chain",
        });
      continue;
    }
    const groups = groupByLength(chain.tests);
    const lengthSlot = slots.length;
    slots.push("number");
    // String lengths are below 2^31.
    integerSlots.push(lengthSlot);
    const root = dispatch(
      blocks,
      values,
      groups,
      0,
      groups.length,
      chain.exit,
      head.slot,
      lengthSlot,
      start,
      end,
    );
    // The head computes the length once and enters the dispatch.
    const value = values.next++,
      length = values.next++;
    // Keep the head's other instructions; drop the test's own.
    const instructions: Instruction[] = [];
    if (term.kind !== "branch") throw "dispatch head invariant";
    const compare = definition(head.block, term.condition);
    if (compare === undefined || compare.kind !== "binary")
      throw "dispatch head invariant";
    for (const op of head.block.instructions) {
      if (op === undefined) throw "dispatch instruction invariant";
      const id = instructionResult(op);
      // The load stays for any copies; a dead load is swept later.
      if (
        op === compare ||
        (op.kind === "string-literal" &&
          (id === compare.left || id === compare.right))
      )
        continue;
      instructions.push(op);
    }
    instructions.push(
      { kind: "load", id: value, slot: head.slot, start, end },
      { kind: "string-length", id: length, string: value, start, end },
      { kind: "store", slot: lengthSlot, value: length, start, end },
    );
    blocks[head.block.id] = {
      id: head.block.id,
      instructions,
      terminator: { kind: "jump", target: root, start, end },
    };
    rewritten++;
    if (remarks !== undefined)
      remarks({
        pass: "dispatch-string-chains",
        outcome: "applied",
        function: fn.name,
        start,
        end,
        message:
          String(chain.tests.length) +
          " literal tests dispatched on " +
          String(groups.length) +
          " lengths",
      });
  }
  if (rewritten === 0) return { fn, visited, rewritten };
  integerSlots.sort((left, right) => left - right);
  const compacted = compactReachableBlocks(
    { ...fn, slots, integerSlots },
    blocks,
    budget - visited,
  );
  if (compacted === undefined) return undefined;
  return { fn: compacted.fn, visited: visited + compacted.visited, rewritten };
}

function copyLiveAtExit(
  chain: Chain,
  live: readonly (readonly number[])[],
): boolean {
  const exits: number[] = [chain.exit];
  for (const test of chain.tests)
    if (test !== undefined) exits.push(test.match);
  for (const exit of exits) {
    if (exit === undefined) throw "dispatch exit invariant";
    for (const slot of live[exit] ?? [])
      if (slot !== undefined && chain.copies.includes(slot)) return true;
  }
  return false;
}

/** The tests grouped by literal length, ascending; a repeated literal can
 * never match, so only its first test is kept. */
function groupByLength(tests: readonly Test[]): Group[] {
  const groups: Group[] = [],
    literals = new Set<string>();
  for (const test of tests) {
    if (test === undefined) throw "dispatch test invariant";
    if (literals.has(test.literal)) continue;
    literals.add(test.literal);
    let found: Group | undefined;
    for (const candidate of groups)
      if (candidate !== undefined && candidate.length === test.literal.length)
        found = candidate;
    if (found === undefined) {
      const group: Group = { length: test.literal.length, tests: [test] };
      groups.push(group);
    } else found.tests.push(test);
  }
  return groups.sort((left, right) => left.length - right.length);
}

function addBlock(
  blocks: Block[],
  instructions: Instruction[],
  terminator: Terminator,
): number {
  const id = blocks.length;
  blocks.push({ id, instructions, terminator });
  return id;
}

/** Entry of the dispatch over `groups[from, to)`: bisection on the length
 * slot, then equality with each remaining group's length. */
function dispatch(
  blocks: Block[],
  values: { next: number },
  groups: readonly Group[],
  from: number,
  to: number,
  exit: number,
  stringSlot: number,
  lengthSlot: number,
  start: number,
  end: number,
): number {
  if (to - from <= linearGroups) {
    let next = exit;
    for (let index = to - 1; index >= from; index--) {
      const group = groups[index];
      if (group === undefined) throw "dispatch group invariant";
      const tests = leaf(blocks, values, group, exit, stringSlot, start, end);
      next = lengthTest(
        blocks,
        values,
        "===",
        group.length,
        tests,
        next,
        lengthSlot,
        start,
        end,
      );
    }
    return next;
  }
  const middle = Math.floor((from + to) / 2),
    pivot = groups[middle];
  if (pivot === undefined) throw "dispatch group invariant";
  const below = dispatch(
    blocks,
    values,
    groups,
    from,
    middle,
    exit,
    stringSlot,
    lengthSlot,
    start,
    end,
  );
  const above = dispatch(
    blocks,
    values,
    groups,
    middle,
    to,
    exit,
    stringSlot,
    lengthSlot,
    start,
    end,
  );
  return lengthTest(
    blocks,
    values,
    "<",
    pivot.length,
    below,
    above,
    lengthSlot,
    start,
    end,
  );
}

function lengthTest(
  blocks: Block[],
  values: { next: number },
  operator: "===" | "<",
  length: number,
  consequent: number,
  alternate: number,
  lengthSlot: number,
  start: number,
  end: number,
): number {
  const value = values.next++,
    bound = values.next++,
    result = values.next++;
  const instructions: Instruction[] = [
    { kind: "load", id: value, slot: lengthSlot, start, end },
    { kind: "constant", id: bound, value: length, start, end },
    {
      kind: "binary",
      id: result,
      operator,
      left: value,
      right: bound,
      start,
      end,
    },
  ];
  return addBlock(blocks, instructions, {
    kind: "branch",
    condition: result,
    consequent,
    alternate,
    start,
    end,
  });
}

/** The literal tests of one length, in their original order. */
function leaf(
  blocks: Block[],
  values: { next: number },
  group: Group,
  exit: number,
  stringSlot: number,
  start: number,
  end: number,
): number {
  let next = exit;
  for (let index = group.tests.length - 1; index >= 0; index--) {
    const test = group.tests[index];
    if (test === undefined) throw "dispatch group invariant";
    const value = values.next++,
      literal = values.next++,
      equal = values.next++;
    const instructions: Instruction[] = [
      { kind: "load", id: value, slot: stringSlot, start, end },
      {
        kind: "string-literal",
        id: literal,
        value: test.literal,
        start,
        end,
      },
      {
        kind: "binary",
        id: equal,
        operator: "===",
        left: value,
        right: literal,
        start,
        end,
      },
    ];
    next = addBlock(blocks, instructions, {
      kind: "branch",
      condition: equal,
      consequent: test.match,
      alternate: next,
      start,
      end,
    });
  }
  return next;
}

/** A block testing a string slot against a literal. A chain's later tests
 * are skipped by the dispatch, so besides the test they may only hold
 * loads; the head keeps its other instructions. */
function testOf(fn: FunctionIR, block: Block, head: boolean): Test | undefined {
  const term = block.terminator;
  if (block.exception !== undefined || term.kind !== "branch") return undefined;
  const compare = definition(block, term.condition);
  if (
    compare === undefined ||
    compare.kind !== "binary" ||
    (compare.operator !== "===" && compare.operator !== "!==")
  )
    return undefined;
  const left = compare.left,
    right = compare.right;
  let slot: number | undefined,
    literal: string | undefined,
    loaded: number | undefined;
  const copies: number[] = [];
  for (const op of block.instructions) {
    if (op === undefined) throw "dispatch instruction invariant";
    if (op === compare) continue;
    const id = instructionResult(op);
    if (id === left || id === right) {
      if (op.kind === "load" && fn.slots[op.slot] === "string") {
        slot = op.slot;
        loaded = op.id;
      } else if (op.kind === "string-literal") literal = op.value;
      else return undefined;
    } else if (!head && op.kind !== "load") return undefined;
    // The compared values feed only the comparison, or, in the head,
    // copies of the tested value (a switch's discriminant temporary).
    if (
      head &&
      op.kind === "store" &&
      (op.value === left || op.value === right)
    ) {
      copies.push(op.slot);
      continue;
    }
    let shared = false;
    visitInstructionOperands(op, (used) => {
      if (used === left || used === right || used === term.condition)
        shared = true;
    });
    if (shared) return undefined;
  }
  if (slot === undefined || literal === undefined) return undefined;
  // The dispatch reloads the tested slot after the head's instructions:
  // only the loaded string may be stored to it or to a copy.
  for (const op of block.instructions)
    if (
      op !== undefined &&
      op.kind === "store" &&
      (op.slot === slot || copies.includes(op.slot)) &&
      op.value !== loaded
    )
      return undefined;
  const equal = compare.operator === "===",
    tested: number = slot ?? -1,
    text: string = literal ?? "";
  const result: Test = {
    block,
    slot: tested,
    literal: text,
    match: equal ? term.consequent : term.alternate,
    miss: equal ? term.alternate : term.consequent,
    copies,
  };
  return result;
}

/** The instruction of `block` defining value `id`. */
function definition(block: Block, id: number): Instruction | undefined {
  for (const op of block.instructions) {
    if (op === undefined) throw "dispatch instruction invariant";
    if (instructionResult(op) === id) return op;
  }
  return undefined;
}

/** A block that only copies one slot to another (and loads, unused). */
function copyOf(
  block: Block,
): { from: number; to: number; next: number } | undefined {
  const term = block.terminator;
  if (block.exception !== undefined || term.kind !== "jump") return undefined;
  let store: Instruction | undefined;
  for (const op of block.instructions) {
    if (op === undefined) throw "dispatch instruction invariant";
    if (op.kind === "store") {
      if (store !== undefined) return undefined;
      store = op;
    } else if (op.kind !== "load") return undefined;
  }
  if (store === undefined || store.kind !== "store") return undefined;
  for (const op of block.instructions)
    if (op !== undefined && op.kind === "load" && op.id === store.value)
      return { from: op.slot, to: store.slot, next: term.target };
  return undefined;
}

function nextValueOf(fn: FunctionIR): number {
  let next = 0;
  for (const block of fn.blocks) {
    if (block === undefined) throw "dispatch block invariant";
    for (const op of block.instructions) {
      if (op === undefined) throw "dispatch instruction invariant";
      const id = instructionResult(op);
      if (id !== undefined && id >= next) next = id + 1;
    }
  }
  return next;
}
