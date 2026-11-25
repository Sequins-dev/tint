import {
  effectInvoke,
  instructionEffects,
  instructionResult,
  naturalLoops,
  type Block,
  type FunctionIR,
  type Instruction,
  type ScalarType,
  type Terminator,
} from "../scalar/index.ts";
import type { RemarkSink } from "./observer.ts";

export interface GeneralNumberShadows {
  readonly fn: FunctionIR;
  readonly visited: number;
  /** General slots given a number shadow. */
  readonly shadowed: number;
}

/** Operators whose scalar result is always a number. */
function numericBinary(operator: string): boolean {
  switch (operator) {
    case "+":
    case "-":
    case "*":
    case "/":
    case "%":
    case "**":
    case "&":
    case "|":
    case "^":
    case "<<":
    case ">>":
    case ">>>":
    case "imul":
    case "min":
    case "max":
      return true;
  }
  return false;
}
function numericUnary(operator: string): boolean {
  return (
    operator === "-" ||
    operator === "+" ||
    operator === "~" ||
    operator === "ceil" ||
    operator === "trunc" ||
    operator === "sqrt" ||
    operator === "uint32" ||
    operator === "boolean-number"
  );
}

/** The ID of the scalar number (not general value) `op` defines, if any. */
function numberResult(
  op: Instruction,
  slots: readonly ScalarType[],
): number | undefined {
  switch (op.kind) {
    case "constant":
      return typeof op.value === "number" ? op.id : undefined;
    case "binary":
      return numericBinary(op.operator) ? op.id : undefined;
    case "unary":
      return numericUnary(op.operator) ? op.id : undefined;
    case "load":
      return slots[op.slot] === "number" ? op.id : undefined;
    case "general-value":
      return op.type === "number" ? op.id : undefined;
    case "string-length":
    case "string-code-unit":
      return op.id;
  }
  return undefined;
}

/** The ID of the scalar of a category other than number `op` defines, if
 * any: a general value wrapping it is never a Number. */
function nonNumberResult(
  op: Instruction,
  slots: readonly ScalarType[],
): number | undefined {
  switch (op.kind) {
    case "constant":
      return typeof op.value === "number" ? undefined : op.id;
    case "string-literal":
    case "general-is":
      return op.id;
    case "binary":
      switch (op.operator) {
        case "===":
        case "!==":
        case "==":
        case "!=":
        case "<":
        case ">":
        case "<=":
        case ">=":
          return op.id;
      }
      return undefined;
    case "unary":
      return op.operator === "!" ||
        op.operator === "truthy" ||
        op.operator === "is-integer"
        ? op.id
        : undefined;
    case "load": {
      const type = slots[op.slot];
      return type === "boolean" ||
        type === "string" ||
        type === "reference" ||
        type === "Uint8Array" ||
        type === "Uint16Array" ||
        type === "Uint32Array" ||
        type === "Float64Array"
        ? op.id
        : undefined;
    }
    case "general-value":
      return op.type === "number" ? undefined : op.id;
  }
  return undefined;
}

/**
 * Gives general slots that are tested or read as numbers a number shadow:
 * a boolean slot that holds exactly "the slot holds a Number" and a number
 * slot that holds its value whenever it does. Every store to the slot also
 * stores both shadows (directly for a wrapped scalar of a known category or
 * an absent value), so `general-is number` on a load of the slot becomes a
 * load of the boolean, and `general-value number` becomes a load of the
 * number wherever a forward analysis proves the slot holds a Number on
 * every path (a dominating test, or stores of wrapped numbers around a
 * loop). Elsewhere the checked extraction stays. The general slot itself is
 * unchanged, so its other readers, stack maps and exception paths see the
 * same value; its stores die when nothing reads it any more.
 *
 * Slots written other than by `store` (record, cell and exception
 * destinations) keep their representation. A slot is shadowed only when its
 * loop-weighted number tests outweigh the cost of maintaining the shadow at
 * its stores. Verified IR; blocks are dense by ID.
 */
export function shadowGeneralNumbers(
  fn: FunctionIR,
  budget: number,
  remarks?: RemarkSink,
): GeneralNumberShadows | undefined {
  if (!Number.isSafeInteger(budget) || budget < 0) return undefined;
  let visited = 0;
  const slotCount = fn.slots.length;
  const candidates = new Uint8Array(slotCount);
  let count = 0;
  for (let slot = 0; slot < slotCount; slot++)
    if (fn.slots[slot] === "general") {
      candidates[slot] = 1;
      count++;
    }
  if (count === 0 || fn.import === true || fn.blocks.length === 0)
    return { fn, visited, shadowed: 0 };
  const blockCount = fn.blocks.length;
  let nextId = 0;
  for (const block of fn.blocks) {
    if (block === undefined) throw "general number block invariant";
    const exception = block.exception;
    if (exception !== undefined) candidates[exception.slot] = 0;
    const term = block.terminator;
    if (
      term.kind === "record" ||
      term.kind === "record-cell" ||
      term.kind === "cell"
    )
      candidates[term.slot] = 0;
    for (const op of block.instructions) {
      if (op === undefined) throw "general number instruction invariant";
      if (++visited > budget) return undefined;
      const id = instructionResult(op);
      if (id !== undefined && id >= nextId) nextId = id + 1;
    }
  }

  // Loop depth weights, 4 per level as slot homes rank them.
  const depthWeights = [1, 4, 16, 64, 256, 1024, 4096];
  const depth = new Uint8Array(blockCount);
  const forest = naturalLoops(fn, Math.max(1, budget - visited));
  if (forest === undefined) return undefined;
  visited += forest.visited;
  for (const loop of forest.loops) {
    if (loop === undefined) throw "general number loop invariant";
    for (const block of loop.body)
      if (block < blockCount && (depth[block] ?? 0) < 6)
        depth[block] = (depth[block] ?? 0) + 1;
  }
  const uses = new Float64Array(slotCount),
    costs = new Float64Array(slotCount),
    wrappedStores = new Uint8Array(slotCount);
  const copyEdges: {
    readonly from: number;
    readonly to: number;
    readonly weight: number;
  }[] = [];
  for (const block of fn.blocks) {
    if (block === undefined) throw "general number block invariant";
    const weight = depthWeights[depth[block.id] ?? 0] ?? 4096;
    const loads = new Map<number, number>(),
      wrapped = new Map<number, boolean>(),
      knownNonNumber = new Set<number>(),
      numbers = new Set<number>(),
      nonNumbers = new Set<number>(),
      slotWrapped = new Map<number, boolean>();
    for (const op of block.instructions) {
      if (op === undefined) throw "general number instruction invariant";
      if (++visited > budget) return undefined;
      const scalar = numberResult(op, fn.slots);
      if (scalar !== undefined) numbers.add(scalar);
      const other = nonNumberResult(op, fn.slots);
      if (other !== undefined) nonNumbers.add(other);
      if (op.kind === "load") {
        if (candidates[op.slot] === 1) loads.set(op.id, op.slot);
        if (slotWrapped.get(op.slot) === true) wrapped.set(op.id, true);
      } else if (op.kind === "general-wrap") {
        const isNum = numbers.has(op.value);
        wrapped.set(op.id, isNum);
        if (!isNum && nonNumbers.has(op.value)) knownNonNumber.add(op.id);
      } else if (op.kind === "general-none" || op.kind === "general-null") {
        knownNonNumber.add(op.id);
      } else if (
        (op.kind === "general-is" || op.kind === "general-value") &&
        op.type === "number"
      ) {
        const slot = loads.get(op.value);
        if (slot !== undefined) uses[slot] = (uses[slot] ?? 0) + 2 * weight;
      } else if (op.kind === "store") {
        const number = wrapped.get(op.value) === true;
        const cheapNonNumber = knownNonNumber.has(op.value);
        slotWrapped.set(op.slot, number);
        if (candidates[op.slot] === 1) {
          if (number) wrappedStores[op.slot] = 1;
          costs[op.slot] =
            (costs[op.slot] ?? 0) + (number || cheapNonNumber ? 1 : 3) * weight;
          const sourceSlot = loads.get(op.value);
          if (sourceSlot !== undefined && sourceSlot !== op.slot)
            copyEdges.push({ from: sourceSlot, to: op.slot, weight });
        }
      } else if ((instructionEffects(op) & effectInvoke) !== 0) {
        slotWrapped.clear();
      }
    }
  }
  // Shadow index + 1 per slot; 0 for slots without a shadow.
  const shadows = new Uint32Array(slotCount);
  const shadow = (slot: number): number => (shadows[slot] ?? 0) - 1;
  let shadowed = 0;
  for (let slot = 0; slot < slotCount; slot++) {
    if (candidates[slot] !== 1) continue;
    const benefit = uses[slot] ?? 0;
    if (benefit > 0 && benefit >= (costs[slot] ?? 0))
      shadows[slot] = ++shadowed;
  }
  // Also shadow merge temporaries that feed an already-shadowed slot (e.g.
  // `sum += x` merge slots): shadowing them avoids a `general-is` tag check on
  // every store into the shadowed destination.
  if (shadowed > 0) {
    for (const edge of copyEdges) {
      if (edge === undefined) continue;
      if (
        (shadows[edge.to] ?? 0) > 0 &&
        (shadows[edge.from] ?? 0) === 0 &&
        wrappedStores[edge.from] === 1
      ) {
        const multiplier = edge.weight > 1 ? 6 : 3;
        uses[edge.from] = (uses[edge.from] ?? 0) + multiplier * edge.weight;
      }
    }
    for (let slot = 0; slot < slotCount; slot++) {
      if (candidates[slot] !== 1 || (shadows[slot] ?? 0) > 0) continue;
      const benefit = uses[slot] ?? 0;
      if (benefit > 0 && benefit >= (costs[slot] ?? 0))
        shadows[slot] = ++shadowed;
    }
  }
  if (shadowed === 0) return { fn, visited, shadowed: 0 };

  const slots: ScalarType[] = fn.slots.slice();
  const presence = new Uint32Array(shadowed),
    payload = new Uint32Array(shadowed),
    shadowSlots = new Uint32Array(shadowed);
  for (let slot = 0; slot < slotCount; slot++) {
    const index = shadow(slot);
    if (index < 0) continue;
    shadowSlots[index] = slot;
    presence[index] = slots.length;
    slots.push("boolean");
    payload[index] = slots.length;
    slots.push("number");
  }

  // Track every candidate general slot in the forward must-analysis so known
  // numbers propagate across merge blocks through unshadowed temporaries
  // (e.g. writeAssignment / binary-op merge slots).
  const trackedSlots = new Uint32Array(slotCount);
  const tracked = (slot: number): number => (trackedSlots[slot] ?? 0) - 1;
  let trackedCount = 0;
  for (let slot = 0; slot < slotCount; slot++)
    if (candidates[slot] === 1) trackedSlots[slot] = ++trackedCount;
  const trackedSlotOf = new Uint32Array(trackedCount);
  for (let slot = 0; slot < slotCount; slot++) {
    const index = tracked(slot);
    if (index >= 0) trackedSlotOf[index] = slot;
  }

  // Forward conditional must-analysis: which candidate general slots hold a
  // Number at each reachable block entry. Optimistic start intersected over
  // executable edges; entry and exception targets know nothing.
  const reachable = new Uint8Array(blockCount);
  reachable[fn.entry] = 1;
  const known = new Uint8Array(blockCount * trackedCount).fill(1);
  for (let index = 0; index < trackedCount; index++)
    known[fn.entry * trackedCount + index] = 0;
  const exceptionTargets = new Uint8Array(blockCount);
  for (const block of fn.blocks) {
    if (block === undefined) throw "general number block invariant";
    const exception = block.exception;
    if (exception !== undefined) {
      exceptionTargets[exception.target] = 1;
      for (let index = 0; index < trackedCount; index++)
        known[exception.target * trackedCount + index] = 0;
    }
  }
  const state = new Uint8Array(trackedCount);
  // A load or test describes its slot only until the slot's next store:
  // entries record the slot's store generation with its tracked index.
  const generations = new Uint32Array(trackedCount);
  const describe = (index: number): number =>
    index + trackedCount * (generations[index] ?? 0);
  const described = (code: number | undefined): number => {
    if (code === undefined) return -1;
    const index = code % trackedCount;
    return Math.floor(code / trackedCount) === (generations[index] ?? 0)
      ? index
      : -1;
  };
  /** Applies the block's instructions to `state`; returns the tracked indices
   * proven on the branch's consequent (true) and alternate (false) edges, plus
   * a known branch outcome (1 = consequent only, 0 = alternate only, -1 = both
   * edges feasible). */
  function transfer(block: Block): {
    readonly onTrue: number;
    readonly onFalse: readonly number[];
    readonly branchOutcome: number;
  } {
    generations.fill(0);
    const loads = new Map<number, number>(),
      numbers = new Set<number>(),
      nonNumbers = new Set<number>(),
      wraps = new Set<number>(),
      notNumbers = new Set<number>(),
      elementResults = new Set<number>(),
      elementValueSlots = new Map<number, number[]>(),
      slotElementValue = new Map<number, number>(),
      tests = new Map<number, number>(),
      absentTests = new Map<number, number[]>(),
      boolValues = new Map<number, number>();
    for (const op of block.instructions) {
      if (op === undefined) throw "general number instruction invariant";
      visited++;
      const scalar = numberResult(op, fn.slots);
      if (scalar !== undefined) numbers.add(scalar);
      const other = nonNumberResult(op, fn.slots);
      if (other !== undefined) nonNumbers.add(other);
      if (op.kind === "constant" && typeof op.value === "boolean") {
        boolValues.set(op.id, op.value ? 1 : 0);
      } else if (op.kind === "unary" && op.operator === "!") {
        const operand = boolValues.get(op.operand);
        if (operand !== undefined) boolValues.set(op.id, operand === 1 ? 0 : 1);
        const tested = tests.get(op.operand);
        if (tested !== undefined) absentTests.set(op.id, [tested]);
      } else if (op.kind === "element-load" || op.kind === "element-length") {
        elementResults.add(op.id);
      } else if (op.kind === "general-none" || op.kind === "general-null") {
        notNumbers.add(op.id);
      } else if (op.kind === "load") {
        const index = tracked(op.slot);
        if (index >= 0) loads.set(op.id, describe(index));
      } else if (op.kind === "general-wrap") {
        if (numbers.has(op.value)) wraps.add(op.id);
        else if (nonNumbers.has(op.value)) notNumbers.add(op.id);
      } else if (op.kind === "general-is" && op.type === "number") {
        if (wraps.has(op.value)) {
          boolValues.set(op.id, 1);
        } else if (notNumbers.has(op.value)) {
          boolValues.set(op.id, 0);
        } else {
          const index = described(loads.get(op.value));
          if (index >= 0) {
            tests.set(op.id, describe(index));
            if (state[index] === 1) boolValues.set(op.id, 1);
          }
        }
      } else if (op.kind === "general-is" && op.type === "absent") {
        let elemId: number | undefined;
        if (elementResults.has(op.value)) elemId = op.value;
        else {
          const index = described(loads.get(op.value));
          if (index >= 0) elemId = slotElementValue.get(index);
        }
        if (elemId !== undefined) {
          const boundSlots = elementValueSlots.get(elemId);
          if (boundSlots !== undefined && boundSlots.length > 0)
            absentTests.set(op.id, boundSlots.slice());
        }
      } else if (op.kind === "store") {
        const index = tracked(op.slot);
        if (index < 0) continue;
        const copied = described(loads.get(op.value));
        const isNumber =
          wraps.has(op.value) || (copied >= 0 && (state[copied] ?? 0) === 1);
        state[index] = isNumber ? 1 : 0;
        const nextGen = (generations[index] ?? 0) + 1;
        generations[index] = nextGen;
        const elemId = elementResults.has(op.value)
          ? op.value
          : copied >= 0
            ? slotElementValue.get(copied)
            : undefined;
        if (elemId !== undefined) {
          slotElementValue.set(index, elemId);
          let list = elementValueSlots.get(elemId);
          if (list === undefined) {
            list = [];
            elementValueSlots.set(elemId, list);
          }
          list.push(describe(index));
        } else {
          slotElementValue.delete(index);
        }
      }
    }
    const term = block.terminator;
    if (term.kind !== "branch")
      return { onTrue: -1, onFalse: [], branchOutcome: -1 };
    const outcome = boolValues.get(term.condition);
    const onFalse: number[] = [];
    const falseCodes = absentTests.get(term.condition);
    if (falseCodes !== undefined) {
      for (const code of falseCodes) {
        const idx = described(code);
        if (idx >= 0) onFalse.push(idx);
      }
    }
    return {
      onTrue: described(tests.get(term.condition)),
      onFalse,
      branchOutcome: outcome === undefined ? -1 : outcome,
    };
  }
  const order = reversePostorder(fn);
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of order) {
      if (visited > budget) return undefined;
      if (reachable[id] !== 1) continue;
      const block = fn.blocks[id];
      if (block === undefined) throw "general number block invariant";
      for (let index = 0; index < trackedCount; index++)
        state[index] = known[id * trackedCount + index] ?? 0;
      const proven = transfer(block);
      const exception = block.exception;
      if (exception !== undefined && reachable[exception.target] !== 1) {
        reachable[exception.target] = 1;
        changed = true;
      }
      const term = block.terminator;
      const successors = normalSuccessors(term);
      for (let edge = 0; edge < successors.length; edge++) {
        if (proven.branchOutcome === 1 && edge === 1) continue;
        if (proven.branchOutcome === 0 && edge === 0) continue;
        const successor = successors[edge];
        if (successor === undefined) continue;
        if (reachable[successor] !== 1) {
          reachable[successor] = 1;
          changed = true;
        }
        if (exceptionTargets[successor] === 1) continue;
        for (let index = 0; index < trackedCount; index++) {
          const fact =
            (state[index] ?? 0) === 1 ||
            (edge === 0 && index === proven.onTrue) ||
            (edge === 1 && proven.onFalse.includes(index))
              ? 1
              : 0;
          const at = successor * trackedCount + index;
          if (fact === 0 && known[at] === 1) {
            known[at] = 0;
            changed = true;
          }
        }
      }
    }
  }

  // Rewrite.
  let proofs = 0;
  const blocks: Block[] = [];
  for (const block of fn.blocks) {
    if (block === undefined) throw "general number block invariant";
    generations.fill(0);
    if (reachable[block.id] === 1) {
      for (let index = 0; index < trackedCount; index++)
        state[index] = known[block.id * trackedCount + index] ?? 0;
    } else {
      state.fill(0);
    }
    const instructions: Instruction[] = [];
    const span = { start: block.terminator.start, end: block.terminator.end };
    if (block.id === fn.entry) {
      // Entry-defined slots (parameters, the receiver) start with their
      // incoming values; other slots start as undefined (false, 0).
      for (const slot of entryDefinedSlots(fn)) {
        const index = shadow(slot);
        if (index < 0) continue;
        const loaded = nextId++,
          test = nextId++,
          number = nextId++;
        instructions.push(
          { kind: "load", id: loaded, slot, start: span.start, end: span.end },
          {
            kind: "general-is",
            id: test,
            value: loaded,
            type: "number",
            start: span.start,
            end: span.end,
          },
          {
            kind: "store",
            slot: presence[index] ?? 0,
            value: test,
            start: span.start,
            end: span.end,
          },
          {
            kind: "general-value",
            id: number,
            value: loaded,
            type: "number",
            unchecked: true,
            start: span.start,
            end: span.end,
          },
          {
            kind: "store",
            slot: payload[index] ?? 0,
            value: number,
            start: span.start,
            end: span.end,
          },
        );
      }
    }
    const loads = new Map<number, number>(),
      knownLoads = new Set<number>(),
      numbers = new Set<number>(),
      nonNumbers = new Set<number>(),
      wraps = new Map<number, number>(),
      // General values that are never a Number: absent values and wrapped
      // scalars of another category.
      notNumbers = new Set<number>(),
      // Block-local values written to unshadowed general slots (e.g.
      // writeAssignment's temporary slot) so forwarding through them preserves
      // known scalar numbers without re-testing the general tag.
      unshadowedWrap = new Map<number, number>(),
      unshadowedCopy = new Map<number, number>(),
      unshadowedNotNumber = new Set<number>();
    for (const op of block.instructions) {
      if (op === undefined) throw "general number instruction invariant";
      if (++visited > budget) return undefined;
      const scalar = numberResult(op, fn.slots);
      if (scalar !== undefined) numbers.add(scalar);
      const other = nonNumberResult(op, fn.slots);
      if (other !== undefined) nonNumbers.add(other);
      if (op.kind === "load") {
        instructions.push(op);
        const trackIndex = tracked(op.slot);
        if (trackIndex >= 0) {
          const wrappedNumber =
            shadow(op.slot) < 0 ? unshadowedWrap.get(op.slot) : undefined;
          if (wrappedNumber !== undefined) {
            wraps.set(op.id, wrappedNumber);
          } else {
            const copiedDesc =
              shadow(op.slot) < 0 ? unshadowedCopy.get(op.slot) : undefined;
            if (copiedDesc !== undefined) {
              const copiedTrack = described(copiedDesc);
              if (copiedTrack >= 0) {
                loads.set(op.id, copiedDesc);
                if (state[copiedTrack] === 1) knownLoads.add(op.id);
              } else {
                loads.set(op.id, describe(trackIndex));
                if (state[trackIndex] === 1) knownLoads.add(op.id);
              }
            } else {
              if (shadow(op.slot) < 0 && unshadowedNotNumber.has(op.slot))
                notNumbers.add(op.id);
              loads.set(op.id, describe(trackIndex));
              if (state[trackIndex] === 1) knownLoads.add(op.id);
            }
          }
        }
        continue;
      }
      if (op.kind === "general-wrap") {
        // Wrapped scalars of an unknown category are tested at the store
        // like any value.
        if (numbers.has(op.value)) wraps.set(op.id, op.value);
        else if (nonNumbers.has(op.value)) notNumbers.add(op.id);
        instructions.push(op);
        continue;
      }
      if (op.kind === "general-none" || op.kind === "general-null") {
        notNumbers.add(op.id);
        instructions.push(op);
        continue;
      }
      if (op.kind === "general-is" && op.type === "number") {
        if (wraps.has(op.value)) {
          proofs++;
          instructions.push({
            kind: "constant",
            id: op.id,
            value: true,
            start: op.start,
            end: op.end,
          });
          continue;
        }
        const trackIndex = described(loads.get(op.value));
        if (trackIndex >= 0) {
          if (knownLoads.has(op.value)) {
            proofs++;
            instructions.push({
              kind: "constant",
              id: op.id,
              value: true,
              start: op.start,
              end: op.end,
            });
            continue;
          }
          const shadowIndex = shadow(trackedSlotOf[trackIndex] ?? 0);
          if (shadowIndex >= 0) {
            proofs++;
            instructions.push({
              kind: "load",
              id: op.id,
              slot: presence[shadowIndex] ?? 0,
              start: op.start,
              end: op.end,
            });
            continue;
          }
        }
      }
      if (
        op.kind === "general-value" &&
        op.type === "number" &&
        knownLoads.has(op.value)
      ) {
        const trackIndex = described(loads.get(op.value));
        if (trackIndex >= 0) {
          const shadowIndex = shadow(trackedSlotOf[trackIndex] ?? 0);
          if (shadowIndex >= 0) {
            proofs++;
            instructions.push({
              kind: "load",
              id: op.id,
              slot: payload[shadowIndex] ?? 0,
              start: op.start,
              end: op.end,
            });
            continue;
          }
          if (op.unchecked !== true) {
            proofs++;
            instructions.push({ ...op, unchecked: true });
            continue;
          }
        }
      }
      instructions.push(op);
      if (op.kind !== "store") {
        if ((instructionEffects(op) & effectInvoke) !== 0) {
          unshadowedWrap.clear();
          unshadowedCopy.clear();
          unshadowedNotNumber.clear();
        }
        continue;
      }
      const trackIndex = tracked(op.slot);
      if (trackIndex < 0) continue;
      const index = shadow(op.slot);
      const number = wraps.get(op.value),
        copiedTrack = described(loads.get(op.value)),
        copiedShadow =
          copiedTrack >= 0 ? shadow(trackedSlotOf[copiedTrack] ?? 0) : -1;
      if (index < 0) {
        unshadowedWrap.delete(op.slot);
        unshadowedCopy.delete(op.slot);
        unshadowedNotNumber.delete(op.slot);
        if (number !== undefined) unshadowedWrap.set(op.slot, number);
        else if (copiedShadow >= 0)
          unshadowedCopy.set(op.slot, describe(copiedTrack));
        else if (notNumbers.has(op.value)) unshadowedNotNumber.add(op.slot);
        state[trackIndex] =
          number !== undefined || knownLoads.has(op.value) ? 1 : 0;
        generations[trackIndex] = (generations[trackIndex] ?? 0) + 1;
        continue;
      }
      const at = { start: op.start, end: op.end };
      if (number !== undefined) {
        const yes = nextId++;
        instructions.push(
          {
            kind: "store",
            slot: payload[index] ?? 0,
            value: number,
            start: at.start,
            end: at.end,
          },
          {
            kind: "constant",
            id: yes,
            value: true,
            start: at.start,
            end: at.end,
          },
          {
            kind: "store",
            slot: presence[index] ?? 0,
            value: yes,
            start: at.start,
            end: at.end,
          },
        );
        state[trackIndex] = 1;
      } else if (copiedShadow >= 0) {
        // A copy between shadowed slots copies the shadows.
        const test = nextId++,
          value = nextId++;
        instructions.push(
          {
            kind: "load",
            id: test,
            slot: presence[copiedShadow] ?? 0,
            start: at.start,
            end: at.end,
          },
          {
            kind: "store",
            slot: presence[index] ?? 0,
            value: test,
            start: at.start,
            end: at.end,
          },
          {
            kind: "load",
            id: value,
            slot: payload[copiedShadow] ?? 0,
            start: at.start,
            end: at.end,
          },
          {
            kind: "store",
            slot: payload[index] ?? 0,
            value,
            start: at.start,
            end: at.end,
          },
        );
        state[trackIndex] = knownLoads.has(op.value) ? 1 : 0;
      } else if (knownLoads.has(op.value)) {
        // A copy from an unshadowed slot proven to hold a Number skips the
        // tag test and keeps the destination proven.
        const yes = nextId++,
          value = nextId++;
        instructions.push(
          {
            kind: "constant",
            id: yes,
            value: true,
            start: at.start,
            end: at.end,
          },
          {
            kind: "store",
            slot: presence[index] ?? 0,
            value: yes,
            start: at.start,
            end: at.end,
          },
          {
            kind: "general-value",
            id: value,
            value: op.value,
            type: "number",
            unchecked: true,
            start: at.start,
            end: at.end,
          },
          {
            kind: "store",
            slot: payload[index] ?? 0,
            value,
            start: at.start,
            end: at.end,
          },
        );
        state[trackIndex] = 1;
      } else if (notNumbers.has(op.value)) {
        // Both shadows are written on every store, so they are initialized
        // wherever the general slot is.
        const no = nextId++,
          zero = nextId++;
        instructions.push(
          {
            kind: "constant",
            id: no,
            value: false,
            start: at.start,
            end: at.end,
          },
          {
            kind: "store",
            slot: presence[index] ?? 0,
            value: no,
            start: at.start,
            end: at.end,
          },
          {
            kind: "constant",
            id: zero,
            value: 0,
            start: at.start,
            end: at.end,
          },
          {
            kind: "store",
            slot: payload[index] ?? 0,
            value: zero,
            start: at.start,
            end: at.end,
          },
        );
        state[trackIndex] = 0;
      } else {
        const test = nextId++,
          value = nextId++;
        instructions.push(
          {
            kind: "general-is",
            id: test,
            value: op.value,
            type: "number",
            start: at.start,
            end: at.end,
          },
          {
            kind: "store",
            slot: presence[index] ?? 0,
            value: test,
            start: at.start,
            end: at.end,
          },
          {
            kind: "general-value",
            id: value,
            value: op.value,
            type: "number",
            unchecked: true,
            start: at.start,
            end: at.end,
          },
          {
            kind: "store",
            slot: payload[index] ?? 0,
            value,
            start: at.start,
            end: at.end,
          },
        );
        state[trackIndex] = 0;
      }
      // Earlier loads of this slot no longer describe its value.
      generations[trackIndex] = (generations[trackIndex] ?? 0) + 1;
    }
    blocks.push({ ...block, instructions });
  }
  const first = fn.blocks[fn.entry];
  remarks?.({
    pass: "shadow-general-numbers",
    outcome: "applied",
    function: fn.name,
    start: first?.terminator.start ?? 0,
    end: first?.terminator.end ?? 0,
    message:
      String(shadowed) +
      " general slots shadowed, " +
      String(proofs) +
      " number tests rewritten",
  });
  return { fn: { ...fn, slots, blocks }, visited, shadowed };
}

/** Slots whose value is defined on entry: parameters and the receiver. */
function entryDefinedSlots(fn: FunctionIR): number[] {
  const slots: number[] = [];
  for (const parameter of fn.parameters)
    if (parameter !== undefined) slots.push(parameter);
  const receiver = fn.receiverSlot;
  if (receiver !== undefined) slots.push(receiver);
  return slots;
}

/** Normal (non-exception) successors; a branch's consequent first. */
function normalSuccessors(term: Terminator): number[] {
  const successors: number[] = [];
  if (term.kind === "jump") successors.push(term.target);
  else if (
    term.kind === "branch" ||
    term.kind === "record" ||
    term.kind === "record-cell" ||
    term.kind === "cell"
  ) {
    successors.push(term.consequent);
    successors.push(term.alternate);
  }
  return successors;
}

/** Blocks reachable from entry in reverse postorder (exception edges too). */
function reversePostorder(fn: FunctionIR): number[] {
  const count = fn.blocks.length;
  const seen = new Uint8Array(count),
    postorder: number[] = [],
    stack: number[] = [fn.entry],
    next: number[] = [0];
  seen[fn.entry] = 1;
  while (stack.length > 0) {
    const top = stack.length - 1;
    const id = stack[top] ?? 0,
      position = next[top] ?? 0;
    const block = fn.blocks[id];
    if (block === undefined) throw "general number block invariant";
    const successors = normalSuccessors(block.terminator);
    const exception = block.exception;
    if (exception !== undefined) successors.push(exception.target);
    const successor = successors[position];
    if (successor === undefined) {
      stack.pop();
      next.pop();
      postorder.push(id);
      continue;
    }
    next[top] = position + 1;
    if (seen[successor] === 1) continue;
    seen[successor] = 1;
    stack.push(successor);
    next.push(0);
  }
  return postorder.reverse();
}
