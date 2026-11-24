import { referencedFunction } from "../scalar/function-references.ts";
import {
  stableRecordLayouts,
  stableDescriptors,
  type ModuleIR,
} from "../scalar/index.ts";
export interface ClosedReachability {
  readonly functions: Uint8Array;
  readonly records: Uint8Array;
  /** Unique referenced layout IDs in discovery order, for sparse set operations. */
  readonly recordIds: readonly number[];
  readonly work: number;
}
/** Verified closed IR, explicit entry roots, and all direct/indirect contract and
 * closure-construction edges. No IR copying or renumbering; exhaustion publishes
 * nothing. Shared by pruning and representation-ownership proofs. With
 * foreignEntries, code outside the module (published JIT entries, threads)
 * may call back in, but only through functions the caller lists as roots or
 * function values traced here; raw memory writes still decline. Such traces
 * support pruning, never representation-ownership proofs. */
export function traceClosedModule(
  module: ModuleIR,
  roots: readonly number[],
  maxWork: number = 10000000,
  foreignEntries: boolean = false,
): ClosedReachability | undefined {
  if (
    !(foreignEntries ? stableDescriptors(module) : stableRecordLayouts(module))
  )
    return undefined;
  return traceModuleReferences(module, roots, maxWork);
}
/** Transitive function and record references in verified IR. This reports graph
 * facts only; it does not authorize representation changes or assume opacity. */
export function traceModuleReferences(
  module: ModuleIR,
  roots: readonly number[],
  maxWork: number = 10000000,
): ClosedReachability | undefined {
  if (!Number.isSafeInteger(maxWork) || maxWork < 0 || roots.length === 0)
    return undefined;
  const functions = module.functions,
    records = module.records ?? [],
    live = new Uint8Array(functions.length),
    layouts = new Uint8Array(records.length),
    pending = new Uint32Array(functions.length);
  const recordIds: number[] = [];
  let tail = 0,
    work = 0;
  function include(id: number): void {
    if (live[id] === 1) return;
    live[id] = 1;
    pending[tail++] = id;
  }
  function includeRecord(id: number): void {
    if (layouts[id] === 1) return;
    layouts[id] = 1;
    recordIds.push(id);
  }
  for (const root of roots) {
    if (
      root === undefined ||
      !Number.isInteger(root) ||
      root < 0 ||
      root >= functions.length
    )
      return undefined;
    include(root);
  }
  for (let head = 0; head < tail; head++) {
    if (++work > maxWork) return undefined;
    const id = pending[head],
      fn = id === undefined ? undefined : functions[id];
    if (fn === undefined) throw "reachable function invariant";
    if (fn.closureEnvironment !== undefined)
      includeRecord(fn.closureEnvironment);
    for (const block of fn.blocks) {
      if (block === undefined) throw "reachable block invariant";
      for (const op of block.instructions) {
        if (op === undefined) throw "reachable instruction invariant";
        if (++work > maxWork) return undefined;
        const target = referencedFunction(op);
        if (target !== undefined) include(target);
        if (
          op.kind === "record-new" ||
          op.kind === "general-record-is" ||
          op.kind === "general-record-descriptor" ||
          op.kind === "record-descriptor-address" ||
          op.kind === "record-has" ||
          op.kind === "record-read" ||
          op.kind === "record-slot-read"
        )
          includeRecord(op.record);
        else if (op.kind === "property-load" || op.kind === "property-store") {
          includeRecord(op.record);
          includeRecord(op.siteRecord);
          includeRecord(op.epochRecord);
        }
      }
      const t = block.terminator;
      if (t.kind === "record" || t.kind === "record-cell")
        includeRecord(t.record);
    }
  }
  return { functions: live, records: layouts, recordIds, work };
}
