import { escapedFunction } from "./function-references.ts";
import type { ModuleIR } from "./model.ts";
import { stableRecordLayouts } from "./record-facts.ts";
import { provenWordFacts } from "./word-facts.ts";
/** Verified closed module only. Aggregate actual arguments at every direct call.
 * Roots and functions whose addresses escape retain unknown parameters.
 * Sweeps repeat to a fixpoint so words flow through parameters passed along
 * call chains; a parameter that only receives itself (recursion) stays
 * unknown. It never assumes that source number annotations imply integer
 * values. */
export function provenWordArguments(
  module: ModuleIR,
  roots: readonly number[],
  returns: Uint8Array | undefined = undefined,
  maxWork: number = 10000000,
): readonly Uint8Array[] | undefined {
  if (
    !Number.isSafeInteger(maxWork) ||
    maxWork < 1 ||
    !stableRecordLayouts(module)
  )
    return undefined;
  let work = module.functions.length;
  if (work > maxWork) return undefined;
  const exposed = new Uint8Array(module.functions.length),
    argumentsBySlot: Uint8Array[] = [];
  for (const root of roots) {
    if (
      root === undefined ||
      !Number.isInteger(root) ||
      root < 0 ||
      root >= exposed.length
    )
      return undefined;
    if (++work > maxWork) return undefined;
    exposed[root] = 1;
  }
  for (const fn of module.functions) {
    if (fn === undefined) throw "word argument function invariant";
    if (fn.import === true) exposed[fn.id] = 1;
    work += fn.slots.length;
    if (work > maxWork || fn.id !== argumentsBySlot.length) return undefined;
    // Functions borrowing an environment keep unknown parameters; the rest
    // of the module is still proven.
    if (fn.environment !== undefined) exposed[fn.id] = 1;
    argumentsBySlot.push(new Uint8Array(fn.slots.length));
    for (const block of fn.blocks) {
      if (block === undefined) throw "word argument block invariant";
      if (++work > maxWork) return undefined;
      for (const op of block.instructions) {
        if (op === undefined) throw "word argument instruction invariant";
        if (++work > maxWork) return undefined;
        const escaped = escapedFunction(op);
        if (escaped !== undefined) exposed[escaped] = 1;
      }
    }
  }
  // Sweep to a fixpoint: each sweep proves every function with the argument
  // facts of the previous one for its own parameters, so words propagate
  // through parameters passed on along call chains. Masks only shrink (each
  // sweep's result is met with the previous one; both are sound), so the
  // sweeps terminate. Mask 0 means unknown.
  let current: Uint8Array[] | undefined;
  for (;;) {
    const prior = current;
    const next: Uint8Array[] = [];
    for (const fn of module.functions) {
      if (fn === undefined) throw "word argument function invariant";
      next.push(new Uint8Array(fn.slots.length));
    }
    for (const fn of module.functions) {
      if (fn === undefined) throw "word argument function invariant";
      const known =
        prior === undefined || exposed[fn.id] === 1 ? undefined : prior[fn.id];
      const proof = provenWordFacts(
        fn,
        maxWork - work,
        returns,
        undefined,
        known,
        true,
      );
      if (proof === undefined || proof.calls === undefined) return undefined;
      work += proof.work;
      for (const call of proof.calls) {
        if (call === undefined) throw "word argument call invariant";
        const target = module.functions[call.target],
          destination = next[call.target];
        if (target === undefined || destination === undefined) return undefined;
        for (let i = 0; i < target.parameters.length; i++) {
          if (++work > maxWork) return undefined;
          const slot = target.parameters[i];
          if (slot === undefined) throw "word argument slot invariant";
          if (exposed[call.target] !== 1)
            destination[slot] =
              (destination[slot] ?? 0) | (call.masks[i] ?? 15);
        }
      }
    }
    let changed = prior === undefined;
    if (prior !== undefined)
      for (let id = 0; id < next.length; id++) {
        const fresh = next[id],
          previous = prior[id];
        if (fresh === undefined || previous === undefined)
          throw "word argument sweep invariant";
        for (let slot = 0; slot < fresh.length; slot++) {
          const a = previous[slot] ?? 0,
            b = fresh[slot] ?? 0;
          const met = a === 0 ? b : b === 0 ? a : a & b;
          if (met !== b) fresh[slot] = met;
          if (met !== a) changed = true;
        }
      }
    current = next;
    if (!changed) break;
  }
  return current ?? argumentsBySlot;
}
