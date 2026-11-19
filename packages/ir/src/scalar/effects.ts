import { solveDataflow } from "@tint/foundation/graph/dataflow";
import type { FunctionBodySource, Instruction, ModuleIR } from "./model.ts";
export const effectThrow = 1;
export const effectAllocate = 2;
export const effectReadHeap = 4;
export const effectWriteHeap = 8;
export const effectInvoke = 16;
export const effectEscape = 32;
export const effectReadLocal = 64;
export const effectWriteLocal = 128;
export const effectUnknown = 255;
/** Conservative effects for verified scalar operations. Unknown/new operations
 * retain all effects until explicitly audited. Heap writes describe existing
 * reachable memory, not initialization of a fresh allocation. */
export function instructionEffects(op: Instruction): number {
  switch (op.kind) {
    case "load":
      return effectReadLocal;
    case "store":
      return effectWriteLocal;
    case "record-has":
    case "function-environment":
    case "general-record-is":
    case "general-is":
    case "general-record-descriptor":
    case "string-length":
    case "string-code-unit":
    case "string-starts-with":
    case "error-message":
    case "error-is":
    case "reference-vector-length":
    case "reference-vector-is":
    case "array-length":
    case "array-buffer":
    case "array-byte-offset":
    case "array-byte-length":
    case "array-valid":
    case "closure-environment":
    case "record-read":
    case "array-read":
    case "array-element":
    case "weak-slot-key":
    case "weak-slot-value":
    case "reference-vector-read":
      return effectReadHeap;
    case "array-copy":
    case "reference-vector-copy":
      return effectReadHeap | effectWriteHeap;
    case "array-write":
    case "array-store":
      return effectWriteHeap;
    // A leaf C call cannot allocate, throw, invoke managed code or retain a
    // managed pointer past its return; it may read and write any memory its
    // byte operands reach.
    case "c-call":
      // A may-callback call runs managed callbacks, which may allocate (and
      // so collect) and touch any heap memory.
      return op.call.mayCallback === true
        ? effectAllocate | effectReadHeap | effectWriteHeap
        : effectReadHeap | effectWriteHeap;
    // C memory accesses read or write only the bytes they name (adoption
    // rewrites the adopted array's header). An import slot never changes
    // after launch, so an availability query has no effect.
    case "c-memory":
      // The callback key word's address is a constant.
      return op.access.operation === "available" ||
        op.access.operation === "fits" ||
        op.access.operation === "callback-key" ||
        op.access.operation === "callback-address"
        ? 0
        : op.access.operation === "store"
          ? effectWriteHeap
          : op.access.operation === "adopt" ||
              op.access.operation === "retarget"
            ? effectReadHeap | effectWriteHeap
            : effectReadHeap;
    case "weak-slot-set-value":
    case "reference-vector-write":
      return effectWriteHeap | effectEscape;
    case "weak-slot-clear":
      return effectWriteHeap;
    case "weak-slot-new":
    case "record-new":
    case "function-new":
      return effectThrow | effectAllocate | effectReadHeap | effectEscape;
    case "error-new":
    case "array-new":
    case "reference-vector-new":
    case "array-subarray":
    case "string-concat":
    case "string-slice":
    case "string-from-code-units":
    case "string-allocate":
      return effectThrow | effectAllocate | effectReadHeap;
    case "string-write":
      return effectReadHeap | effectWriteHeap;
    case "function-address":
    case "record-descriptor-address":
    case "general-kind":
    case "general-equal":
    case "general-null":
    case "general-none":
    case "general-wrap":
    case "general-value":
    case "boolean-none":
    case "boolean-wrap":
    case "boolean-value":
    case "boolean-present":
    case "primitive-wrap":
    case "primitive-reference":
    case "string-none":
    case "string-wrap":
    case "string-value":
    case "string-present":
    case "reference-none":
    case "reference-wrap":
    case "reference-value":
    case "string-reference":
    case "reference-string":
    case "string-literal":
    case "constant":

    case "undefined":
    case "optional-wrap":
    case "optional-present":
    case "optional-value":
    case "optional-value-or":

    case "unary":
    case "binary":
      return 0;
    default:
      return effectUnknown;
  }
}
/** Closed verified module; opaque and host calls remain unknown. Results are
 * invalid after IR mutation and are published only after full convergence. */
export function summarizeEffects(
  module: ModuleIR,
  maxWork: number = 10000000,
  bodies?: FunctionBodySource,
): Uint32Array | undefined {
  if (!Number.isSafeInteger(maxWork) || maxWork < 1) return undefined;
  const count = module.functions.length;
  if (count > maxWork) return undefined;
  const effects = new Uint32Array(count),
    local = new Uint32Array(count);
  const callers: number[][] = [],
    callees: number[][] = [],
    seeds: number[] = [];
  let work = 0;
  for (const fn of module.functions) {
    if (fn === undefined || fn.id !== callers.length) return undefined;
    callers.push([]);
    callees.push([]);
    seeds.push(fn.id);
  }
  for (const header of module.functions) {
    if (header === undefined) return undefined;
    const fn = bodies?.get(header.id) ?? header;
    try {
      let mask = fn.import === true ? effectUnknown : 0;
      for (const block of fn.blocks) {
        if (block === undefined || ++work > maxWork) return undefined;
        const term = block.terminator;
        switch (term.kind) {
          case "throw":
          case "throw-literal":
            mask |= effectThrow;
            break;
          case "record":
          case "record-cell":
          case "cell":
            mask |=
              term.operation === "read"
                ? effectReadHeap
                : effectWriteHeap | effectEscape;
            break;
          case "return":
          case "jump":
          case "branch":
          case "trap":
            break;
          default:
            mask |= effectUnknown;
        }
        for (const op of block.instructions) {
          if (op === undefined || ++work > maxWork) return undefined;
          if (op.kind === "call") {
            const incoming = callers[op.target],
              outgoing = callees[fn.id];
            if (incoming === undefined || outgoing === undefined)
              return undefined;
            incoming.push(fn.id);
            outgoing.push(op.target);
          } else mask |= instructionEffects(op);
        }
      }
      local[fn.id] = mask & ~(effectReadLocal | effectWriteLocal);
    } finally {
      bodies?.release(header.id);
    }
  }
  let exhausted = false;
  const result = solveDataflow(
    callers,
    seeds,
    (id: number): boolean => {
      let mask = local[id] ?? effectUnknown;
      const outgoing = callees[id];
      if (outgoing === undefined) throw "effect callees invariant";
      for (const callee of outgoing) {
        if (++work > maxWork) {
          exhausted = true;
          return false;
        }
        if (callee === undefined) throw "effect target invariant";
        mask |= effects[callee] ?? effectUnknown;
      }
      if (effects[id] === mask) return false;
      effects[id] = mask;
      return true;
    },
    maxWork - work,
  );
  if (!result.complete || exhausted || work + result.work > maxWork)
    return undefined;
  return effects;
}
