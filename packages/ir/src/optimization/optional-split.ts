import {
  analyzeLiveSlots,
  instructionResult,
  provenWordFacts,
  visitInstructionOperands,
  visitTerminatorOperands,
  type Block,
  type FunctionIR,
  type Instruction,
  type ScalarType,
  type SlotBinding,
  type ValueBinding,
} from "../scalar/index.ts";
import type { RemarkSink } from "./observer.ts";

export interface OptionalSplit {
  readonly fn: FunctionIR;
  readonly visited: number;
  /** Optional-number slots replaced by a presence and a value slot. */
  readonly split: number;
}

/** A comparison of a loaded optional with `undefined`: presence decides it. */
function undefinedTest(
  op: Instruction,
  undefinedValues: ReadonlySet<number>,
  loaded: number,
): boolean {
  if (op.kind !== "binary") return false;
  const operator = op.operator;
  if (
    operator !== "===" &&
    operator !== "!==" &&
    operator !== "==" &&
    operator !== "!="
  )
    return false;
  return (
    (op.left === loaded && undefinedValues.has(op.right)) ||
    (op.right === loaded && undefinedValues.has(op.left))
  );
}

/** Splits each optional-number slot that is only stored and inspected
 * (presence, value, comparison with undefined) into a boolean presence slot
 * and a number value slot, so both can live in registers instead of a
 * two-word frame location. An absent optional stores false and NaN (the
 * value an absent optional number converts to); the value slot of a slot
 * live at entry starts as NaN, the presence slot as its zero (false).
 * Slots used by terminators, exception handlers, parameters or any other
 * operation keep their representation, as do slots holding only 32-bit
 * integers or undefined, which codegen keeps in one word. Verified IR. */
export function splitOptionalNumbers(
  fn: FunctionIR,
  budget: number,
  remarks?: RemarkSink,
): OptionalSplit | undefined {
  if (!Number.isSafeInteger(budget) || budget < 0) return undefined;
  let visited = 0;
  const candidates = new Uint8Array(fn.slots.length);
  let count = 0;
  for (let slot = 0; slot < fn.slots.length; slot++)
    if (fn.slots[slot] === "optional-number") {
      candidates[slot] = 1;
      count++;
    }
  if (count === 0 || fn.import === true) return { fn, visited, split: 0 };
  for (const parameter of fn.parameters)
    if (parameter !== undefined) candidates[parameter] = 0;
  const receiver = fn.receiverSlot;
  if (receiver !== undefined) candidates[receiver] = 0;
  let nextId = 0;
  for (const block of fn.blocks) {
    if (block === undefined) throw "optional split block invariant";
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
      if (op === undefined) throw "optional split instruction invariant";
      if (++visited > budget) return undefined;
      const id = instructionResult(op);
      if (id !== undefined && id >= nextId) nextId = id + 1;
    }
  }
  // Every use of a candidate's loaded value must be rewritable; a store of
  // one into another candidate copies both parts, so excluding one slot can
  // exclude others: repeat until stable.
  function settle(): boolean {
    let changed = true;
    while (changed) {
      changed = false;
      for (const block of fn.blocks) {
        if (block === undefined) throw "optional split block invariant";
        const loads = new Map<number, number>(),
          undefinedValues = new Set<number>();
        const reject = (id: number): void => {
          const slot = loads.get(id);
          if (slot !== undefined && candidates[slot] === 1) {
            candidates[slot] = 0;
            changed = true;
          }
        };
        for (const op of block.instructions) {
          if (op === undefined) throw "optional split instruction invariant";
          if (++visited > budget) return false;
          if (op.kind === "undefined") undefinedValues.add(op.id);
          if (op.kind === "load") {
            if (candidates[op.slot] === 1) loads.set(op.id, op.slot);
            continue;
          }
          if (op.kind === "store") {
            if (candidates[op.slot] !== 1) reject(op.value);
            continue;
          }
          if (
            (op.kind === "optional-present" || op.kind === "optional-value") &&
            loads.has(op.value)
          )
            continue;
          if (op.kind === "binary") {
            const left = op.left,
              right = op.right;
            if (
              loads.has(left) &&
              !loads.has(right) &&
              undefinedTest(op, undefinedValues, left)
            )
              continue;
            if (
              loads.has(right) &&
              !loads.has(left) &&
              undefinedTest(op, undefinedValues, right)
            )
              continue;
          }
          visitInstructionOperands(op, reject);
        }
        visitTerminatorOperands(block.terminator, reject);
      }
    }
    return true;
  }
  function remaining(): number {
    let left = 0;
    for (let slot = 0; slot < fn.slots.length; slot++)
      if (candidates[slot] === 1) left++;
    return left;
  }
  if (!settle()) return undefined;
  if (remaining() === 0) return { fn, visited, split: 0 };
  // Only slots proven to hold a non-integer number: codegen keeps
  // integer-or-absent optionals in one word, using facts (call returns,
  // arguments) this pass cannot see.
  const facts = provenWordFacts(fn, budget - visited);
  if (facts === undefined) return undefined;
  visited += facts.work;
  let excluded = false;
  for (let slot = 0; slot < fn.slots.length; slot++) {
    const mask = facts.slots[slot] ?? 0;
    if (candidates[slot] === 1 && (mask & 6) === 0) {
      candidates[slot] = 0;
      excluded = true;
    }
  }
  if (excluded && !settle()) return undefined;
  const split: number[] = [];
  for (let slot = 0; slot < fn.slots.length; slot++)
    if (candidates[slot] === 1) split.push(slot);
  if (split.length === 0) return { fn, visited, split: 0 };

  const slots: ScalarType[] = fn.slots.slice(),
    presence = new Map<number, number>(),
    values = new Map<number, number>();
  for (const slot of split) {
    if (slot === undefined) throw "optional split slot invariant";
    presence.set(slot, slots.length);
    slots.push("boolean");
    values.set(slot, slots.length);
    slots.push("number");
  }
  const liveness = analyzeLiveSlots(fn, budget - visited, split);
  if (liveness === undefined) return undefined;
  visited += liveness.work;
  const removed = new Set<number>();
  const blocks: Block[] = [];
  for (const block of fn.blocks) {
    if (block === undefined) throw "optional split block invariant";
    const instructions: Instruction[] = [],
      loads = new Map<number, number>(),
      producers = new Map<number, Instruction>();
    if (block.id === fn.entry)
      for (const slot of liveness.slots[block.id] ?? []) {
        const target = slot === undefined ? undefined : values.get(slot);
        if (target === undefined) continue;
        const id = nextId++;
        instructions.push({
          kind: "constant",
          id,
          value: NaN,
          start: 0,
          end: 0,
        });
        instructions.push({
          kind: "store",
          slot: target,
          value: id,
          start: 0,
          end: 0,
        });
      }
    for (const op of block.instructions) {
      if (op === undefined) throw "optional split instruction invariant";
      visited++;
      const result = instructionResult(op);
      if (result !== undefined) producers.set(result, op);
      if (op.kind === "load" && candidates[op.slot] === 1) {
        loads.set(op.id, op.slot);
        removed.add(op.id);
        continue;
      }
      if (op.kind === "store" && candidates[op.slot] === 1) {
        const present = presence.get(op.slot),
          number = values.get(op.slot);
        if (present === undefined || number === undefined)
          throw "optional split store invariant";
        const start = op.start,
          end = op.end,
          inline = op.inline;
        const source = loads.get(op.value),
          producer = producers.get(op.value);
        let flag: number, payload: number;
        if (source !== undefined) {
          // A copy between split slots: copy both parts.
          const sourcePresent = presence.get(source),
            sourceValue = values.get(source);
          if (sourcePresent === undefined || sourceValue === undefined)
            throw "optional split copy invariant";
          flag = nextId++;
          instructions.push({
            kind: "load",
            id: flag,
            slot: sourcePresent,
            start,
            end,
            inline,
          });
          payload = nextId++;
          instructions.push({
            kind: "load",
            id: payload,
            slot: sourceValue,
            start,
            end,
            inline,
          });
        } else if (producer !== undefined && producer.kind === "undefined") {
          flag = nextId++;
          instructions.push({
            kind: "constant",
            id: flag,
            value: false,
            start,
            end,
            inline,
          });
          payload = nextId++;
          instructions.push({
            kind: "constant",
            id: payload,
            value: NaN,
            start,
            end,
            inline,
          });
        } else if (
          producer !== undefined &&
          producer.kind === "optional-wrap"
        ) {
          flag = nextId++;
          instructions.push({
            kind: "constant",
            id: flag,
            value: true,
            start,
            end,
            inline,
          });
          payload = producer.value;
        } else {
          flag = nextId++;
          instructions.push({
            kind: "optional-present",
            id: flag,
            value: op.value,
            start,
            end,
            inline,
          });
          payload = nextId++;
          instructions.push({
            kind: "optional-value",
            id: payload,
            value: op.value,
            start,
            end,
            inline,
          });
        }
        instructions.push({
          kind: "store",
          slot: present,
          value: flag,
          start,
          end,
          inline,
        });
        instructions.push({
          kind: "store",
          slot: number,
          value: payload,
          start,
          end,
          inline,
        });
        continue;
      }
      if (op.kind === "optional-present" || op.kind === "optional-value") {
        const slot = loads.get(op.value);
        if (slot !== undefined) {
          const target =
            op.kind === "optional-present"
              ? presence.get(slot)
              : values.get(slot);
          if (target === undefined) throw "optional split use invariant";
          instructions.push({
            kind: "load",
            id: op.id,
            slot: target,
            start: op.start,
            end: op.end,
            inline: op.inline,
          });
          continue;
        }
      }
      if (op.kind === "binary") {
        const slot = loads.get(op.left) ?? loads.get(op.right);
        if (slot !== undefined) {
          const target = presence.get(slot);
          if (target === undefined) throw "optional split test invariant";
          const start = op.start,
            end = op.end,
            inline = op.inline;
          if (op.operator === "!==" || op.operator === "!=")
            instructions.push({
              kind: "load",
              id: op.id,
              slot: target,
              start,
              end,
              inline,
            });
          else {
            const flag = nextId++;
            instructions.push({
              kind: "load",
              id: flag,
              slot: target,
              start,
              end,
              inline,
            });
            instructions.push({
              kind: "unary",
              id: op.id,
              operator: "!",
              operand: flag,
              start,
              end,
              inline,
            });
          }
          continue;
        }
      }
      instructions.push(op);
    }
    blocks.push({ ...block, instructions });
  }
  const sink = remarks;
  if (sink !== undefined)
    for (const slot of split) {
      if (slot === undefined) throw "optional split slot invariant";
      sink({
        pass: "split-optional-numbers",
        outcome: "applied",
        function: fn.name,
        start: 0,
        end: 0,
        message:
          "optional-number slot s" +
          String(slot) +
          " held as presence s" +
          String(presence.get(slot) ?? -1) +
          " and value s" +
          String(values.get(slot) ?? -1),
      });
    }
  const debug = fn.debug;
  let rewritten: FunctionIR = { ...fn, slots, blocks };
  if (debug !== undefined) {
    const slotBindings: SlotBinding[] = [];
    for (const binding of debug.slots)
      if (binding !== undefined && candidates[binding.slot] !== 1)
        slotBindings.push(binding);
    const valueBindings: ValueBinding[] = [];
    for (const binding of debug.values)
      if (binding !== undefined && !removed.has(binding.value))
        valueBindings.push(binding);
    rewritten = {
      ...rewritten,
      debug: { ...debug, slots: slotBindings, values: valueBindings },
    };
  }
  return { fn: rewritten, visited, split: split.length };
}
