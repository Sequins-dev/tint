import { createNumberIndex } from "@tint/foundation/collections/key-index";
import { instructionResult } from "./operands.ts";
import type { Block, FunctionIR, Instruction } from "./model.ts";
/** Possible numeric outcomes: 1 = signed/unsigned 32-bit integer (never -0),
 * 2 = NaN,
 * 4 = other number, 8 = absent optional. Zero establishes no usable proof.
 * Consume verified IR. Every assignment participates, even on unreachable paths;
 * parameters and opaque writes remain unknown. Slot addresses cannot escape IR.
 * No result is published before convergence or after budget exhaustion. */
export interface WordFacts {
  readonly slots: Uint8Array;
  readonly returned: number;
  readonly work: number;
  readonly calls: readonly WordCallFacts[] | undefined;
}
export interface WordCallFacts {
  readonly target: number;
  readonly masks: Uint8Array;
}
export function provenWordFacts(
  fn: FunctionIR,
  maxWork: number = 1000000,
  callReturns: Uint8Array | undefined = undefined,
  inductionWords: Uint8Array | undefined = undefined,
  parameterWords: Uint8Array | undefined = undefined,
  collectCalls: boolean = false,
): WordFacts | undefined {
  if (!Number.isSafeInteger(maxWork) || maxWork < 0) return undefined;
  let count = fn.slots.length + 1,
    operations = 0,
    maximum = -1;
  for (const block of fn.blocks) {
    if (block === undefined) throw "word fact block invariant";
    for (const op of block.instructions) {
      if (op === undefined) throw "word fact instruction invariant";
      if (++operations > maxWork) return undefined;
      const id = instructionResult(op);
      if (id !== undefined) {
        count++;
        maximum = Math.max(maximum, id);
      }
    }
  }
  if (count > maxWork || count > 0x1fffffff) return undefined;
  const dense =
      maximum + 1 <= count * 4 + 16 && maximum + 1 <= maxWork
        ? new Uint32Array(maximum + 1)
        : undefined,
    sparse = createNumberIndex(),
    mapping: number[] = [],
    facts = new Uint8Array(count),
    arrayWords = new Uint8Array(count),
    heads = new Uint32Array(count),
    targets = new Uint32Array(operations + fn.blocks.length),
    next = new Uint32Array(operations + fn.blocks.length),
    unwrap = new Uint8Array(operations + fn.blocks.length),
    pending = new Uint32Array(count * 4);
  let valueCount = fn.slots.length + 1,
    edges = 0,
    tail = 0,
    work = operations;
  function node(id: number): number {
    if (dense !== undefined) {
      const n = dense[id];
      if (n === undefined || n === 0) throw "word fact value invariant";
      return n - 1;
    }
    const n = mapping[sparse.intern(id)];
    if (n === undefined) throw "word fact value invariant";
    return n;
  }
  function add(n: number, mask: number): void {
    // Only a completed control-flow certificate may override the coarse
    // arithmetic lattice for a local induction slot.
    if (
      n < fn.slots.length &&
      inductionWords !== undefined &&
      inductionWords[n] === 1
    )
      mask = 1;
    const before = facts[n] ?? 0,
      after = before | mask;
    if (before === after) return;
    facts[n] = after;
    pending[tail++] = n;
  }
  /** Unwrap modes: 0 copies the mask, 1 unwraps (absent becomes NaN), 2
   * unwraps an optional proven present (absent is impossible). */
  function edge(from: number, to: number, mode: number = 0): void {
    targets[edges] = to;
    next[edges] = heads[from] ?? 0;
    unwrap[edges] = mode;
    heads[from] = ++edges;
  }
  // `x ?? y` lowers to: store x to a slot; branch on optional-present(x); in
  // the consequent, load the slot and unwrap it. When that consequent has the
  // branch as its only entry and nothing writes the slot in between, the
  // unwrap never sees an absent value.
  const entries = new Uint32Array(fn.blocks.length);
  entries[fn.entry] = 2;
  for (const block of fn.blocks) {
    if (block === undefined) throw "word fact block invariant";
    const t = block.terminator;
    if (t.kind === "jump") entries[t.target] = (entries[t.target] ?? 0) + 1;
    else if (
      t.kind === "branch" ||
      t.kind === "record" ||
      t.kind === "cell" ||
      t.kind === "record-cell"
    ) {
      entries[t.consequent] = (entries[t.consequent] ?? 0) + 1;
      entries[t.alternate] = (entries[t.alternate] ?? 0) + 1;
    }
    if (block.exception !== undefined) entries[block.exception.target] = 2;
  }
  const presentGuards = new Uint32Array(fn.blocks.length);
  for (const block of fn.blocks) {
    if (block === undefined) throw "word fact block invariant";
    const t = block.terminator;
    if (
      t.kind !== "branch" ||
      t.consequent === t.alternate ||
      entries[t.consequent] !== 1
    )
      continue;
    // The tested optional and the last slot it was stored to in this block.
    let tested = -1,
      slot = -1;
    for (const op of block.instructions) {
      if (op === undefined) throw "word fact instruction invariant";
      if (op.kind === "optional-present" && op.id === t.condition)
        tested = op.value;
    }
    if (tested < 0) continue;
    for (const op of block.instructions) {
      if (op === undefined) throw "word fact instruction invariant";
      if (op.kind !== "store") continue;
      if (op.value === tested) slot = op.slot;
      else if (op.slot === slot) slot = -1;
    }
    if (slot >= 0) presentGuards[t.consequent] = slot + 1;
  }
  /** The optional-value in block reads a load of the guarded slot made
   * before any store to it there. */
  function presentUnwrap(block: Block, op: Instruction): boolean {
    const guarded = presentGuards[block.id] ?? 0;
    if (guarded === 0 || op.kind !== "optional-value") return false;
    for (const prior of block.instructions) {
      if (prior === undefined) throw "word fact instruction invariant";
      if (prior === op) return false;
      if (prior.kind === "store" && prior.slot === guarded - 1) return false;
      if (
        prior.kind === "load" &&
        prior.id === op.value &&
        prior.slot === guarded - 1
      )
        return true;
    }
    return false;
  }
  if (fn.receiverSlot !== undefined) add(fn.receiverSlot, 7);
  for (const slot of fn.parameters) {
    if (slot === undefined) throw "word fact parameter invariant";
    const incoming =
      parameterWords === undefined ? 0 : (parameterWords[slot] ?? 0);
    add(
      slot,
      incoming === 0
        ? fn.slots[slot] === "optional-number"
          ? 15
          : 7
        : incoming,
    );
  }
  for (const block of fn.blocks) {
    if (block === undefined) throw "word fact block invariant";
    for (const op of block.instructions) {
      if (op === undefined) throw "word fact instruction invariant";
      const id = instructionResult(op);
      let n = -1;
      if (id !== undefined) {
        n = valueCount++;
        if (dense !== undefined) dense[id] = n + 1;
        else mapping[sparse.intern(id)] = n;
      }
      if (op.kind === "store") {
        edge(node(op.value), op.slot);
        continue;
      }
      if (id === undefined) continue;
      if (op.kind === "load") {
        edge(op.slot, n);
        const type = fn.slots[op.slot];
        if (
          type === "Uint8Array" ||
          type === "Uint16Array" ||
          type === "Uint32Array"
        )
          arrayWords[n] = 1;
      } else if (op.kind === "constant") {
        const x = op.value;
        add(
          n,
          typeof x !== "number"
            ? 7
            : x !== x
              ? 2
              : Number.isInteger(x) &&
                  x >= -2147483648 &&
                  x <= 4294967295 &&
                  (x !== 0 || 1 / x > 0)
                ? 1
                : 4,
        );
      } else if (op.kind === "undefined") add(n, 8);
      else if (op.kind === "optional-wrap") edge(node(op.value), n);
      else if (op.kind === "optional-value")
        edge(node(op.value), n, presentUnwrap(block, op) ? 2 : 1);
      else if (op.kind === "optional-value-or") {
        // Absent selects the fallback, so the optional contributes only
        // its present outcomes.
        edge(node(op.value), n, 2);
        edge(node(op.fallback), n);
      } else if (op.kind === "array-read")
        add(n, arrayWords[node(op.array)] === 1 ? 9 : 15);
      else if (op.kind === "array-element")
        add(n, arrayWords[node(op.array)] === 1 ? 1 : 7);
      else if (op.kind === "array-length") add(n, 1);
      else if (
        op.kind === "unary" &&
        (op.operator === "~" || op.operator === "boolean-number")
      )
        add(n, 1);
      else if (op.kind === "unary" && op.operator === "+")
        edge(node(op.operand), n);
      else if (
        op.kind === "binary" &&
        ["&", "|", "^", "<<", ">>", ">>>", "imul"].includes(op.operator)
      )
        add(n, 1);
      else if (op.kind === "call" && callReturns !== undefined) {
        const known = callReturns[op.target] ?? 0;
        add(n, known === 0 ? 15 : known);
      } else {
        add(n, 15);
        if (op.kind === "array-new" && op.type !== "Float64Array")
          arrayWords[n] = 1;
        if (op.kind === "array-subarray")
          arrayWords[n] = arrayWords[node(op.array)] ?? 0;
      }
    }
    const t = block.terminator;
    if (t.kind === "return" && t.value !== undefined)
      edge(node(t.value), fn.slots.length);
    if (
      (t.kind === "record" || t.kind === "record-cell" || t.kind === "cell") &&
      t.operation === "read"
    )
      add(t.slot, 15);
    if (block.exception !== undefined) add(block.exception.slot, 15);
  }
  for (let head = 0; head < tail; head++) {
    if (++work > maxWork) return undefined;
    const n = pending[head];
    if (n === undefined) throw "word fact queue invariant";
    const mask = facts[n] ?? 0;
    for (let e = heads[n] ?? 0; e !== 0; e = next[e - 1] ?? 0) {
      if (++work > maxWork) return undefined;
      const dest = targets[e - 1];
      if (dest === undefined) throw "word fact edge invariant";
      add(
        dest,
        unwrap[e - 1] === 1
          ? (mask & 7) | ((mask & 8) !== 0 ? 2 : 0)
          : unwrap[e - 1] === 2
            ? mask & 7
            : mask,
      );
    }
  }
  const calls: WordCallFacts[] = [];
  if (collectCalls) {
    for (const block of fn.blocks) {
      if (block === undefined) throw "word call block invariant";
      for (const op of block.instructions) {
        if (op === undefined) throw "word call instruction invariant";
        if (++work > maxWork) return undefined;
        if (op.kind !== "call") continue;
        const masks = new Uint8Array(op.arguments.length);
        for (let i = 0; i < op.arguments.length; i++) {
          if (++work > maxWork) return undefined;
          const argument = op.arguments[i];
          if (argument === undefined) throw "word call argument invariant";
          const mask = facts[node(argument)] ?? 0;
          masks[i] = mask === 0 ? 15 : mask;
        }
        calls.push({ target: op.target, masks });
      }
    }
  }
  return {
    calls: collectCalls ? calls : undefined,
    slots: facts.subarray(0, fn.slots.length),
    returned: facts[fn.slots.length] ?? 0,
    work,
  };
}
