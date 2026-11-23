import { escapedFunction } from "./function-references.ts";
import { createNumberIndex } from "@tint/foundation/collections/key-index";
import { instructionResult } from "./operands.ts";
import type { FunctionBodySource, ModuleIR, ScalarType } from "./model.ts";
import { stableRecordLayouts } from "./record-facts.ts";
const unknown = 0xffffffff;
function recordBearing(type: ScalarType | "void"): boolean {
  return (
    type === "reference" ||
    type === "optional-reference" ||
    type === "general" ||
    type === "primitive"
  );
}
/** Per-value results of the record flow inference (see provenRecordFlows). */
export interface RecordFlowFacts {
  /** Per function, per block: 1 when the terminator's record access has its
   * exact descriptor, 3 when it is also never null; 0 otherwise. */
  readonly blocks: readonly Uint8Array[];
  /** The only record value `id` of function `fn` can hold besides null, or
   * -1 when it is unknown, mixed or not a record. */
  readonly descriptor: (fn: number, id: number) => number;
  /** Whether value `id` of function `fn` has an exact descriptor and is
   * never null. */
  readonly nonNull: (fn: number, id: number) => boolean;
}
/** Block-level proofs only; see provenRecordFacts. */
export function provenRecordFlows(
  module: ModuleIR,
  maxWork: number = 10000000,
  closedEntry: boolean = false,
  roots: readonly number[] | undefined = undefined,
  bodies?: FunctionBodySource,
): readonly Uint8Array[] | undefined {
  return provenRecordFacts(module, maxWork, closedEntry, roots, bodies)?.blocks;
}
/** Whole-module, flow-insensitive layout inference for verified closed IR. A finite
 * lattice joins no record / one descriptor / unknown. Constraints cover every
 * write, argument and return, including unreachable code. The worklist reaches a
 * fixed point before publishing any proof. Output bits: 1 exact descriptor,
 * 2 non-null origin (published only with bit 1). Nullable origins participate in
 * the same worklist; checked reference bridges filter null on successful paths.
 * Opaque boundaries and exhausted budgets retain guards. */
export function provenRecordFacts(
  module: ModuleIR,
  maxWork: number = 10000000,
  closedEntry: boolean = false,
  roots: readonly number[] | undefined = undefined,
  bodies?: FunctionBodySource,
): RecordFlowFacts | undefined {
  if (!Number.isSafeInteger(maxWork) || maxWork < 0) return undefined;
  if (module.functions.some((fn) => fn !== undefined && fn.import === true))
    return undefined;
  if (
    !stableRecordLayouts(module, bodies) ||
    module.functions.length > 0x1fffff
  )
    return undefined;
  if (roots !== undefined)
    for (const root of roots)
      if (
        root === undefined ||
        !Number.isInteger(root) ||
        root < 0 ||
        root >= module.functions.length
      )
        return undefined;
  const records = module.records ?? [],
    functions = module.functions;
  if (records.length === 0) return undefined;
  const slotBases = new Uint32Array(functions.length),
    denseBases = new Uint32Array(functions.length),
    denseExtents = new Uint32Array(functions.length),
    fieldBases = new Uint32Array(records.length),
    valueIds = createNumberIndex();
  let work = 0,
    nodes = functions.length * 2 + 2,
    valueCount = 0,
    denseSize = 0,
    sparseSize = 0,
    edgeCapacity = 0,
    externalFields = false;
  for (const header of functions) {
    if (header === undefined) throw "record flow function invariant";
    const fn = bodies?.get(header.id) ?? header;
    try {
      if (++work > maxWork) return undefined;
      if (fn.environment !== undefined) return undefined;
      slotBases[fn.id] = nodes;
      nodes += fn.slots.length;
      let functionValues = 0,
        maximumValue = -1;
      if (roots === undefined ? fn.exported : roots.includes(fn.id)) {
        if (recordBearing(fn.returnType)) externalFields = true;
        // An entry's receiver, like its parameters, may be a record whose
        // fields were written outside the module. Other receivers are
        // unknown values (merged below) but come from module code, so
        // they do not open every field.
        if (fn.receiverSlot !== undefined) externalFields = true;
        for (const slot of fn.parameters) {
          if (slot === undefined) throw "record flow parameter invariant";
          const type = fn.slots[slot];
          if (type === undefined) throw "record flow slot invariant";
          if (recordBearing(type)) externalFields = true;
        }
      }
      for (const block of fn.blocks) {
        if (block === undefined) throw "record flow block invariant";
        for (const op of block.instructions) {
          if (op === undefined) throw "record flow instruction invariant";
          if (++work > maxWork) return undefined;
          const id = instructionResult(op);
          if (id !== undefined) {
            maximumValue = Math.max(maximumValue, id);
            functionValues++;
            valueCount++;
          }
          edgeCapacity +=
            op.kind === "call"
              ? op.arguments.length + 2
              : op.kind === "record-new"
                ? op.arguments.length
                : 1;
        }
        edgeCapacity++;
        // A reusable module may expose a mutable graph through an exception and
        // be entered again. Executable startup consumes completion and exits.
        if (!closedEntry && block.terminator.kind === "throw")
          externalFields = true;
      }
      const extent = maximumValue + 1;
      if (extent <= functionValues * 4 + 16 && extent <= maxWork - denseSize) {
        denseBases[fn.id] = denseSize + 1;
        denseExtents[fn.id] = extent;
        denseSize += extent;
      } else sparseSize += functionValues;
    } finally {
      bodies?.release(header.id);
    }
  }
  const firstField = nodes;
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (record === undefined) throw "record flow record invariant";
    if (++work > maxWork) return undefined;
    fieldBases[i] = nodes;
    nodes += record.fields.length;
  }
  const firstValue = nodes;
  nodes += valueCount;
  if (nodes > maxWork || edgeCapacity > maxWork || nodes > 0x0fffffff)
    return undefined;
  const denseValues = new Uint32Array(denseSize),
    sparseValues = new Uint32Array(sparseSize),
    states = new Uint32Array(nodes),
    nulls = new Uint8Array(nodes),
    heads = new Uint32Array(nodes),
    targets = new Uint32Array(edgeCapacity),
    links = new Uint32Array(edgeCapacity),
    checked = new Uint8Array(edgeCapacity),
    pending = new Uint32Array(nodes * 4);
  let edgeCount = 0,
    nextValue = firstValue,
    tail = 0;
  function merge(
    node: number,
    incoming: number,
    nullable: number = incoming === unknown ? 3 : incoming === 0 ? 0 : 1,
  ): void {
    const previous = states[node] ?? 0,
      after =
        incoming === 0 || previous === incoming || previous === unknown
          ? previous
          : previous === 0
            ? incoming
            : unknown,
      beforeNull = nulls[node] ?? 0,
      afterNull = beforeNull | nullable;
    if (previous === after && beforeNull === afterNull) return;
    states[node] = after;
    nulls[node] = afterNull;
    pending[tail++] = node;
  }
  function edge(
    source: number,
    target: number,
    nonNull: boolean = false,
  ): void {
    if (edgeCount >= edgeCapacity) throw "record flow edge invariant";
    targets[edgeCount] = target;
    links[edgeCount] = heads[source] ?? 0;
    checked[edgeCount] = nonNull ? 1 : 0;
    heads[source] = ++edgeCount;
  }
  function value(fn: number, id: number): number {
    const base = denseBases[fn] ?? 0,
      node =
        base === 0
          ? sparseValues[valueIds.intern(fn * 4294967296 + id)]
          : denseValues[base - 1 + id];
    if (node === undefined || node === 0) throw "record flow value invariant";
    return node;
  }
  function slot(fn: number, id: number): number {
    return (slotBases[fn] ?? 0) + id;
  }
  function field(record: number, id: number): number {
    return (fieldBases[record] ?? 0) + id;
  }
  merge(1, unknown);
  if (externalFields)
    for (let node = firstField; node < firstValue; node++) merge(node, unknown);
  for (const header of functions) {
    if (header === undefined) throw "record flow function invariant";
    const fn = bodies?.get(header.id) ?? header;
    try {
      if (
        (roots === undefined ? fn.exported : roots.includes(fn.id)) &&
        fn.closureEnvironment !== undefined
      )
        merge(functions.length + fn.id + 2, unknown);
      if (fn.receiverSlot !== undefined)
        merge(slot(fn.id, fn.receiverSlot), unknown);
      if (roots === undefined ? fn.exported : roots.includes(fn.id))
        for (const parameter of fn.parameters) {
          if (parameter === undefined) throw "record flow parameter invariant";
          merge(slot(fn.id, parameter), unknown);
        }
      for (const block of fn.blocks) {
        if (block === undefined) throw "record flow block invariant";
        const exception = block.exception;
        if (exception !== undefined)
          merge(slot(fn.id, exception.slot), unknown);
        for (const op of block.instructions) {
          if (op === undefined) throw "record flow instruction invariant";
          if (++work > maxWork) return undefined;
          const escaped = escapedFunction(op);
          if (escaped !== undefined) {
            const target = functions[escaped];
            if (target === undefined)
              throw "record flow escaped function invariant";
            for (const parameter of target.parameters) {
              if (parameter === undefined)
                throw "record flow parameter invariant";
              merge(slot(target.id, parameter), unknown);
            }
          }
          const id = instructionResult(op);
          let result = 0;
          if (id !== undefined) {
            result = nextValue++;
            const base = denseBases[fn.id] ?? 0;
            if (base === 0)
              sparseValues[valueIds.intern(fn.id * 4294967296 + id)] = result;
            else denseValues[base - 1 + id] = result;
          }
          switch (op.kind) {
            case "record-new":
              merge(result, op.record + 1);
              for (let i = 0; i < op.arguments.length; i++) {
                const argument = op.arguments[i];
                if (argument !== undefined)
                  edge(value(fn.id, argument), field(op.record, i));
              }
              break;
            case "reference-none":
            case "general-null":
            case "general-none":
              merge(result, 0, 2);
              break;
            case "reference-wrap":
            case "reference-value":
            case "primitive-wrap":
            case "primitive-reference":
              edge(value(fn.id, op.value), result, true);
              break;
            case "general-wrap":
              edge(value(fn.id, op.value), result);
              break;
            case "general-value":
              if (op.type === "reference") edge(value(fn.id, op.value), result);
              else merge(result, unknown);
              break;
            case "record-read":
              // A proven read observes the field like a checked read terminator.
              edge(field(op.record, op.field), result);
              break;
            case "store":
              edge(value(fn.id, op.value), slot(fn.id, op.slot));
              break;
            case "load":
              edge(slot(fn.id, op.slot), result);
              break;
            case "closure-environment":
              edge(functions.length + fn.id + 2, result);
              break;
            case "call": {
              const target = functions[op.target];
              if (target === undefined) throw "record flow callee invariant";
              for (let i = 0; i < op.arguments.length; i++) {
                const argument = op.arguments[i],
                  parameter = target.parameters[i];
                if (argument === undefined || parameter === undefined)
                  throw "record flow argument invariant";
                edge(value(fn.id, argument), slot(target.id, parameter));
              }
              if (op.environment === "inherit")
                edge(
                  functions.length + fn.id + 2,
                  functions.length + op.target + 2,
                );
              if (id !== undefined) edge(op.target + 2, result);
              break;
            }
            case "call-indirect": {
              const target = functions[op.target];
              if (target === undefined) throw "record flow indirect invariant";
              for (const parameter of target.parameters) {
                if (parameter === undefined)
                  throw "record flow parameter invariant";
                merge(slot(target.id, parameter), unknown);
              }
              if (id !== undefined) merge(result, unknown);
              break;
            }
            case "function-new": {
              const target = functions[op.target];
              if (target === undefined) throw "record flow closure invariant";
              if (op.environment !== undefined)
                edge(
                  value(fn.id, op.environment),
                  functions.length + op.target + 2,
                );
              merge(result, unknown);
              break;
            }
            default:
              if (id !== undefined) merge(result, unknown);
          }
        }
        const term = block.terminator;
        if (term.kind === "return" && term.value !== undefined)
          edge(value(fn.id, term.value), fn.id + 2);
        else if (term.kind === "record" || term.kind === "record-cell") {
          if (term.operation === "read")
            edge(field(term.record, term.field), slot(fn.id, term.slot));
          else edge(slot(fn.id, term.slot), field(term.record, term.field));
        } else if (term.kind === "cell" && term.operation === "read")
          merge(slot(fn.id, term.slot), unknown);
      }
    } finally {
      bodies?.release(header.id);
    }
  }
  if (nextValue !== nodes) throw "record flow node invariant";
  for (let cursor = 0; cursor < tail; cursor++) {
    const node = pending[cursor];
    if (node === undefined) throw "record flow queue invariant";
    for (let item = heads[node] ?? 0; item !== 0; item = links[item - 1] ?? 0) {
      if (++work > maxWork) return undefined;
      const target = targets[item - 1];
      if (target === undefined) throw "record flow target invariant";
      const nullable = nulls[node] ?? 0;
      merge(
        target,
        states[node] ?? 0,
        checked[item - 1] === 1 && nullable !== 0 ? 1 : nullable,
      );
    }
  }
  const proofs: Uint8Array[] = [];
  for (const header of functions) {
    if (header === undefined) throw "record flow function invariant";
    const fn = bodies?.get(header.id) ?? header;
    try {
      const proven = new Uint8Array(fn.blocks.length);
      for (const block of fn.blocks) {
        if (block === undefined) throw "record flow block invariant";
        if (++work > maxWork) return undefined;
        const term = block.terminator;
        if (
          (term.kind === "record" || term.kind === "record-cell") &&
          states[value(fn.id, term.object)] === term.record + 1
        )
          proven[block.id] = nulls[value(fn.id, term.object)] === 1 ? 3 : 1;
      }
      proofs.push(proven);
    } finally {
      bodies?.release(header.id);
    }
  }
  /** The value's node, or 0 for an ID that is not an instruction result. */
  function lookup(fn: number, id: number): number {
    if (!Number.isSafeInteger(id) || id < 0 || fn < 0 || fn >= functions.length)
      return 0;
    const base = denseBases[fn] ?? 0;
    if (base !== 0)
      return id < (denseExtents[fn] ?? 0)
        ? (denseValues[base - 1 + id] ?? 0)
        : 0;
    return sparseValues[valueIds.intern(fn * 4294967296 + id)] ?? 0;
  }
  function descriptor(fn: number, id: number): number {
    const node = lookup(fn, id),
      state = node === 0 ? 0 : (states[node] ?? 0);
    return state === 0 || state === unknown ? -1 : state - 1;
  }
  return {
    blocks: proofs,
    descriptor,
    nonNull: (fn: number, id: number): boolean =>
      descriptor(fn, id) >= 0 && nulls[lookup(fn, id)] === 1,
  };
}
