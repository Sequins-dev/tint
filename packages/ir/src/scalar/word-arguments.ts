import { escapedFunction } from "./function-references.ts";
import type { ModuleIR } from "./model.ts";
import { stableRecordLayouts } from "./record-facts.ts";
import { provenWordFacts } from "./word-facts.ts";
/** Verified closed module only. Aggregate actual arguments at every direct call.
 * Roots and functions whose addresses escape retain unknown parameters. A single
 * conservative sweep leaves recursive parameter dependencies unknown; it never
 * assumes that source number annotations imply integer values. */
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
    if (
      work > maxWork ||
      fn.id !== argumentsBySlot.length ||
      fn.environment !== undefined
    )
      return undefined;
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
  for (const fn of module.functions) {
    if (fn === undefined) throw "word argument function invariant";
    const proof = provenWordFacts(
      fn,
      Math.min(1000000, maxWork - work),
      returns,
      undefined,
      undefined,
      true,
    );
    if (proof === undefined || proof.calls === undefined) return undefined;
    work += proof.work;
    for (const call of proof.calls) {
      if (call === undefined) throw "word argument call invariant";
      const target = module.functions[call.target],
        destination = argumentsBySlot[call.target];
      if (target === undefined || destination === undefined) return undefined;
      for (let i = 0; i < target.parameters.length; i++) {
        if (++work > maxWork) return undefined;
        const slot = target.parameters[i];
        if (slot === undefined) throw "word argument slot invariant";
        if (exposed[call.target] !== 1)
          destination[slot] = (destination[slot] ?? 0) | (call.masks[i] ?? 15);
      }
    }
  }
  return argumentsBySlot;
}
