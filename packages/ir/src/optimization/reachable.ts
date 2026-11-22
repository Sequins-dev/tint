import {
  referencedFunction,
  remapReferencedFunction,
} from "../scalar/function-references.ts";
import {
  traceClosedModule,
  traceModuleReferences,
  type ClosedReachability,
} from "./reachability.ts";
import {
  type ModuleIR,
  type FunctionIR,
  type Block,
  type Instruction,
  type Terminator,
  type SourceVariable,
} from "../scalar/index.ts";
export interface ClosedPruning {
  readonly module: ModuleIR;
  /** Original index to compact index plus one; zero means absent. */
  readonly functionIds: Uint32Array;
  readonly recordIds: Uint32Array;
  readonly work: number;
  readonly removedFunctions: number;
  readonly removedRecords: number;
}
/** Consume verified IR with explicit closed-world roots. Symbol visibility is not
 * an external entry contract. Retain direct targets, closure constructors and
 * indirect-call signature targets. Raw memory capabilities keep the original
 * module. With foreignEntries the roots must include every function foreign
 * code can enter (managed surface identities, native service imports).
 * Budget exhaustion publishes nothing and never mutates the input. */
export function pruneClosedModule(
  module: ModuleIR,
  roots: readonly number[],
  maxWork: number = 10000000,
  foreignEntries: boolean = false,
): ClosedPruning | undefined {
  const traced = traceClosedModule(module, roots, maxWork, foreignEntries);
  return traced === undefined
    ? undefined
    : pruneTracedModule(module, traced, maxWork);
}

/** Prune by explicit IR references. Only a backend that rejects opaque code
 * and descriptor access in every retained operation can use this entry. */
export function pruneModuleReferences(
  module: ModuleIR,
  roots: readonly number[],
  maxWork: number,
): ClosedPruning | undefined {
  const traced = traceModuleReferences(module, roots, maxWork);
  return traced === undefined
    ? undefined
    : pruneTracedModule(module, traced, maxWork);
}

function pruneTracedModule(
  module: ModuleIR,
  traced: ClosedReachability,
  maxWork: number,
): ClosedPruning | undefined {
  const functions = module.functions,
    records = module.records ?? [],
    live = traced.functions,
    layouts = traced.records;
  let work = traced.work;
  const functionIds = new Uint32Array(functions.length),
    recordIds = new Uint32Array(records.length);
  let functionCount = 0,
    recordCount = 0;
  for (let i = 0; i < functions.length; i++)
    if (live[i] === 1) functionIds[i] = ++functionCount;
  for (let i = 0; i < records.length; i++)
    if (layouts[i] === 1) recordIds[i] = ++recordCount;
  const removedFunctions = functions.length - functionCount,
    removedRecords = records.length - recordCount;
  if (removedFunctions === 0 && removedRecords === 0)
    return {
      module,
      functionIds,
      recordIds,
      work,
      removedFunctions,
      removedRecords,
    };
  function fnId(id: number): number {
    const mapped = functionIds[id];
    if (mapped === undefined || mapped === 0)
      throw "reachable target invariant";
    return mapped - 1;
  }
  function recordId(id: number): number {
    const mapped = recordIds[id];
    if (mapped === undefined || mapped === 0)
      throw "reachable layout invariant";
    return mapped - 1;
  }
  const kept: FunctionIR[] = [],
    keptRecords = records.filter((_, i) => layouts[i] === 1);
  for (const fn of functions) {
    if (fn === undefined) throw "reachable function invariant";
    if (live[fn.id] !== 1) continue;
    const blocks: Block[] = [];
    for (const block of fn.blocks) {
      if (block === undefined) throw "reachable block invariant";
      let instructions: Instruction[] | undefined;
      for (let i = 0; i < block.instructions.length; i++) {
        const op = block.instructions[i];
        if (op === undefined) throw "reachable instruction invariant";
        if (++work > maxWork) return undefined;
        let rewritten = op;
        const reference = referencedFunction(op);
        if (reference !== undefined) {
          const target = fnId(reference);
          rewritten = remapReferencedFunction(op, target);
        } else if (
          op.kind === "record-new" ||
          op.kind === "general-record-is" ||
          op.kind === "general-record-descriptor" ||
          op.kind === "record-descriptor-address" ||
          op.kind === "record-has" ||
          op.kind === "record-read" ||
          op.kind === "record-slot-read"
        ) {
          const record = recordId(op.record);
          if (record !== op.record) rewritten = { ...op, record };
        } else if (op.kind === "property-cell") {
          const record = recordId(op.record),
            cellRecord = recordId(op.cellRecord),
            siteRecord = recordId(op.siteRecord);
          if (
            record !== op.record ||
            cellRecord !== op.cellRecord ||
            siteRecord !== op.siteRecord
          )
            rewritten = { ...op, record, cellRecord, siteRecord };
        }
        if (rewritten !== op && instructions === undefined)
          instructions = block.instructions.slice(0, i);
        if (instructions !== undefined) instructions.push(rewritten);
      }
      const t = block.terminator;
      let terminator: Terminator = t;
      if (t.kind === "record" || t.kind === "record-cell") {
        const record = recordId(t.record);
        if (record !== t.record) terminator = { ...t, record };
      }
      blocks.push(
        instructions === undefined && terminator === t
          ? block
          : {
              ...block,
              instructions:
                instructions === undefined ? block.instructions : instructions,
              terminator,
            },
      );
    }
    const environment = fn.closureEnvironment;
    // Debug record references follow their layouts or are dropped.
    const debug = fn.debug,
      variables: SourceVariable[] = [];
    if (debug !== undefined)
      for (const variable of debug.variables) {
        if (variable === undefined) throw "reachable debug invariant";
        const record = variable.record,
          mapped = record === undefined ? 0 : (recordIds[record] ?? 0);
        variables.push({
          name: variable.name,
          start: variable.start,
          end: variable.end,
          parameter: variable.parameter,
          ...(mapped === 0 ? {} : { record: mapped - 1 }),
          ...(variable.inline === undefined ? {} : { inline: variable.inline }),
        });
      }
    kept.push({
      ...fn,
      id: fnId(fn.id),
      blocks,
      ...(debug === undefined ? {} : { debug: { ...debug, variables } }),
      ...(environment === undefined
        ? {}
        : { closureEnvironment: recordId(environment) }),
    });
  }
  return {
    module: { functions: kept, records: keptRecords },
    functionIds,
    recordIds,
    work,
    removedFunctions,
    removedRecords,
  };
}
