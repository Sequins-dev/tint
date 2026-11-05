import type { FunctionIR } from "./model.ts";
import { instructionResult } from "./operands.ts";
import { valueLifetimes } from "./value-lifetimes.ts";
export interface TemporarySlotPlan {
  readonly slots: Uint32Array;
  readonly references: Uint32Array;
  readonly generals: Uint32Array;
}
/** Verified SSA plus caller-proven storage classes: 1 single managed pointer,
 * 2 tagged general value, 0 untracked. Separate pools preserve root encodings.
 * Reuse starts strictly after last use, including allocation/call operands. */
export function planTemporarySlots(
  fn: FunctionIR,
  classes: Uint8Array,
  maxWork: number = 1000000,
): TemporarySlotPlan | undefined {
  const lifetimes = valueLifetimes(fn, maxWork);
  if (lifetimes === undefined || classes.length < lifetimes.ends.length)
    return undefined;
  let work = lifetimes.work + lifetimes.ends.length * 3 + fn.blocks.length * 2,
    position = 0;
  if (work > maxWork) return undefined;
  const slots = new Uint32Array(lifetimes.ends.length),
    referenceEnds = new Uint32Array(lifetimes.ends.length),
    generalEnds = new Uint32Array(lifetimes.ends.length),
    references = new Uint32Array(fn.blocks.length),
    generals = new Uint32Array(fn.blocks.length);
  for (const block of fn.blocks) {
    if (block === undefined) throw "temporary slot block invariant";
    let referenceCount = 0,
      generalCount = 0;
    for (const op of block.instructions) {
      if (op === undefined) throw "temporary slot instruction invariant";
      position++;
      if (++work > maxWork) return undefined;
      const id = instructionResult(op);
      if (id === undefined) continue;
      const kind = classes[id];
      if (kind !== 1 && kind !== 2) continue;
      const ends = kind === 1 ? referenceEnds : generalEnds,
        count = kind === 1 ? referenceCount : generalCount;
      let slot = 0;
      for (; slot < count; slot++) {
        if (++work > maxWork) return undefined;
        if ((ends[slot] ?? 0) < position) break;
      }
      slots[id] = slot;
      ends[slot] = lifetimes.ends[id] ?? position;
      if (slot === count) {
        if (kind === 1) referenceCount++;
        else generalCount++;
      }
    }
    position++;
    references[block.id] = referenceCount;
    generals[block.id] = generalCount;
  }
  return { slots, references, generals };
}
