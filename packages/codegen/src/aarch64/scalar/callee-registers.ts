import { canInlineCellRead } from "./leaf-registers.ts";
import type { FunctionIR } from "@tint/ir/scalar";
export interface CalleeSavedSlots {
  readonly registers: Uint8Array;
  readonly count: number;
}
/** Scalar locals only: references and tagged values must stay visible to GC.
 * Remaining cell helpers expose an address, so their slots stay in memory.
 * Select at most eight reused slots; d8..d15 are saved/restored by the emitter. */
export function calleeSavedSlots(
  fn: FunctionIR,
  maxWork: number = 1000000,
  excluded: Uint8Array | undefined = undefined,
): CalleeSavedSlots | undefined {
  if (!Number.isSafeInteger(maxWork) || maxWork < 1 || fn.slots.length > 65536)
    return undefined;
  const counts = new Uint32Array(fn.slots.length),
    escaped = new Uint8Array(fn.slots.length),
    registers = new Uint8Array(fn.slots.length);
  let work = fn.slots.length * 8;
  if (work > maxWork) return undefined;
  for (const block of fn.blocks) {
    if (++work > maxWork) return undefined;
    if (block === undefined) throw "callee slot block invariant";
    for (const op of block.instructions) {
      if (op === undefined) throw "callee slot instruction invariant";
      if (++work > maxWork) return undefined;
      if (op.kind === "load" || op.kind === "store")
        counts[op.slot] = (counts[op.slot] ?? 0) + 1;
    }
    const term = block.terminator;
    if (term.kind === "cell" || term.kind === "record-cell") {
      if (canInlineCellRead(fn, term))
        counts[term.slot] = (counts[term.slot] ?? 0) + 1;
      else escaped[term.slot] = 1;
    } else if (term.kind === "record")
      counts[term.slot] = (counts[term.slot] ?? 0) + 1;
  }
  let count = 0;
  for (let register = 8; register < 16; register++) {
    let best = -1,
      score = 1;
    for (let slot = 0; slot < fn.slots.length; slot++) {
      const type = fn.slots[slot],
        uses = counts[slot] ?? 0;
      if (
        (type === "number" || type === "boolean") &&
        escaped[slot] !== 1 &&
        (excluded === undefined || excluded[slot] !== 1) &&
        registers[slot] === 0 &&
        uses > score
      ) {
        best = slot;
        score = uses;
      }
    }
    if (best < 0) break;
    registers[best] = register;
    count++;
  }
  return count === 0 ? undefined : { registers, count };
}
export interface IntegerSlotHomes {
  /** Per slot: 32 + a callee-saved GP register, or 0. */
  readonly registers: Uint8Array;
  /** Registers used, from x28 downward. */
  readonly saved: readonly number[];
}
/** Integer slots (int64 storage, never references) most often accessed get
 * callee-saved GP homes from x28 downward, at most `limit` of them; word
 * temporaries keep x19 up to the lowest home. Calls and helpers preserve
 * them, so a home holds its slot for the whole function. */
export function integerSlotHomes(
  fn: FunctionIR,
  integerSlots: Uint8Array,
  limit: number,
  maxWork: number = 1000000,
): IntegerSlotHomes | undefined {
  if (!Number.isSafeInteger(maxWork) || maxWork < 1 || fn.slots.length > 65536)
    return undefined;
  const counts = new Uint32Array(fn.slots.length),
    registers = new Uint8Array(fn.slots.length);
  let work = fn.slots.length * (limit + 1),
    candidates = false;
  for (let slot = 0; slot < fn.slots.length; slot++)
    if (integerSlots[slot] === 1) candidates = true;
  if (!candidates || work > maxWork) return undefined;
  for (const block of fn.blocks) {
    if (block === undefined) throw "integer home block invariant";
    for (const op of block.instructions) {
      if (op === undefined) throw "integer home instruction invariant";
      if (++work > maxWork) return undefined;
      if (
        (op.kind === "load" || op.kind === "store") &&
        integerSlots[op.slot] === 1
      )
        counts[op.slot] = (counts[op.slot] ?? 0) + 1;
    }
  }
  const saved: number[] = [];
  for (let register = 28; register > 28 - limit; register--) {
    let best = -1,
      score = 1;
    for (let slot = 0; slot < fn.slots.length; slot++) {
      const uses = counts[slot] ?? 0;
      if (integerSlots[slot] === 1 && registers[slot] === 0 && uses > score) {
        best = slot;
        score = uses;
      }
    }
    if (best < 0) break;
    registers[best] = 32 + register;
    saved.push(register);
  }
  return saved.length === 0 ? undefined : { registers, saved };
}
