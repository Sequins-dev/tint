import { escapedFunction } from "./function-references.ts";
import type { FunctionBodySource, ModuleIR } from "./model.ts";
import { stableRecordLayouts } from "./record-facts.ts";
/** Verified closed IR with explicit external entries. 1 means that all callers
 * use direct calls within this module. Address-taken functions retain their public
 * contract even if construction is unreachable. Opaque writes could forge closure
 * objects and invalidate the proof, so they disable it. Exhaustion publishes no
 * partial facts. This does not prove absence of throws or safepoints. */
export function provenDirectOnlyFunctions(
  module: ModuleIR,
  roots: readonly number[],
  maxWork: number = 10000000,
  bodies?: FunctionBodySource,
): Uint8Array | undefined {
  if (
    !Number.isSafeInteger(maxWork) ||
    maxWork < module.functions.length ||
    !stableRecordLayouts(module, bodies)
  )
    return undefined;
  const direct = new Uint8Array(module.functions.length);
  direct.fill(1);
  let work = module.functions.length;
  for (const root of roots) {
    if (
      ++work > maxWork ||
      root === undefined ||
      !Number.isInteger(root) ||
      root < 0 ||
      root >= direct.length
    )
      return undefined;
    direct[root] = 0;
  }
  for (const header of module.functions) {
    if (header === undefined) throw "call boundary function invariant";
    const fn = bodies?.get(header.id) ?? header;
    try {
      if (fn.import === true) direct[fn.id] = 0;
      for (const block of fn.blocks) {
        if (block === undefined) throw "call boundary block invariant";
        if (++work > maxWork) return undefined;
        for (const op of block.instructions) {
          if (op === undefined) throw "call boundary instruction invariant";
          if (++work > maxWork) return undefined;
          const escaped = escapedFunction(op);
          if (escaped !== undefined) direct[escaped] = 0;
        }
      }
    } finally {
      bodies?.release(header.id);
    }
  }
  return direct;
}
