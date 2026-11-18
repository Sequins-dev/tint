import type { FunctionBodySource, ModuleIR } from "./model.ts";
import { effectAllocate, effectUnknown, summarizeEffects } from "./effects.ts";
/** Verified closed IR. Allocation is the only cooperative GC entry; opaque
 * calls retain every effect. Incomplete analysis never publishes root-elision
 * proofs. Recompute after modifying the module. */
export function provenNoSafepoints(
  module: ModuleIR,
  maxWork: number = 10000000,
  bodies?: FunctionBodySource,
): Uint8Array | undefined {
  const effects = summarizeEffects(module, maxWork, bodies);
  if (effects === undefined) return undefined;
  const safe = new Uint8Array(effects.length);
  for (let id = 0; id < effects.length; id++)
    safe[id] = ((effects[id] ?? effectUnknown) & effectAllocate) === 0 ? 1 : 0;
  return safe;
}
