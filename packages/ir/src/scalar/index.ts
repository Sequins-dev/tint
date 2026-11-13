export {
  escapedFunction,
  referencedFunction,
  remapReferencedFunction,
} from "./function-references.ts";
export {
  bindWeakOperations,
  type WeakOperation,
  type WeakBinding,
} from "./weak.ts";
export {
  createFunctionBuilder,
  type FunctionBuilder,
} from "./function-builder.ts";
/** Flat UTF-16 result limit: align16(24 + 2 * length) fits uint32 allocation sizes. */
export const maximumStringLength = 0x7fffffec;
export { analyzeRecordAccesses } from "./record-facts.ts";
import { provenRecordReads, stableDescriptors } from "./record-facts.ts";
export {
  promoteSlots,
  lowerSSA,
  type SSAFunction,
  type SSABlock,
  type SSAParameter,
  type SSAEdge,
} from "./ssa.ts";
export {
  effectThrow,
  effectAllocate,
  effectReadHeap,
  effectWriteHeap,
  effectInvoke,
  effectEscape,
  effectReadLocal,
  effectWriteLocal,
  effectUnknown,
  instructionEffects,
  summarizeEffects,
} from "./effects.ts";
export { provenDirectOnlyFunctions } from "./call-boundaries.ts";
export {
  substitutedValue,
  substituteInstructionValues,
  substituteTerminatorValues,
} from "./substitution.ts";
export { valueLifetimes, type ValueLifetimes } from "./value-lifetimes.ts";
export {
  planTemporarySlots,
  type TemporarySlotPlan,
} from "./temporary-slots.ts";
export { provenWordArguments } from "./word-arguments.ts";
export { provenInductionWords } from "./induction-words.ts";
export { wordOnlyValues } from "./word-uses.ts";
import { initializationSlots } from "./initialization-slots.ts";
export { provenNoSafepoints } from "./safepoints.ts";
export { provenWordFacts, type WordFacts } from "./word-facts.ts";
import { instructionResult } from "./operands.ts";
export { instructionResult } from "./operands.ts";
export {
  immediateDominators,
  dominates,
  type Dominators,
} from "./dominators.ts";
export { provenRecordFlows } from "./record-flow.ts";
import {
  createNumberIndex,
  createStringIndex,
} from "@tint/foundation/collections/key-index";
export {
  provenRecordGuards,
  dataflowRecordGuards,
  stableRecordLayouts,
  stableDescriptors,
} from "./record-facts.ts";
export { deadSlotsAtEntry, analyzeLiveSlots } from "./liveness.ts";
export {
  visitInstructionOperands,
  visitTerminatorOperands,
} from "./operands.ts";
import {
  createBits,
  hasBit,
  setBit,
  intersectBits,
  intersectBitWindows,
  copyBitRange,
} from "@tint/foundation/collections/bit-vector";
import { hostParameters, hostReturnType } from "./host.ts";
export {
  hostParameters,
  hostReturnType,
  bindHostOperations,
  type HostOperation,
  type HostBinding,
  type HostBindingResult,
} from "./host.ts";
export type * from "./model.ts";
import type {
  ModuleIR,
  Instruction,
  Verification,
  Diagnostic,
  ScalarType,
  Span,
  Block,
} from "./model.ts";
/** Operations whose runtime calls can complete by throwing. */
export function instructionMayThrow(op: Instruction): boolean {
  switch (op.kind) {
    case "host-call":
      return (
        op.operation === "executable-call-managed" ||
        op.operation === "collect-garbage"
      );
    case "call":
    case "call-indirect":
    case "error-new":
    case "record-new":
    case "function-new":
    case "array-new":
    case "weak-slot-new":
    case "reference-vector-new":
    case "array-subarray":
    case "string-concat":
    case "string-slice":
    case "string-from-code-units":
    case "string-allocate":
      return true;
    default:
      return false;
  }
}
function natural(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}
/** Bytes occupied by a value in the current 64-bit scalar IR storage ABI. */
export function scalarByteLength(type: ScalarType): number {
  return type === "general" ||
    type === "optional-number" ||
    type === "optional-boolean"
    ? 16
    : 8;
}
function scalar(value: string): boolean {
  return (
    value === "general" ||
    value === "primitive" ||
    value === "optional-boolean" ||
    value === "reference" ||
    value === "optional-reference" ||
    value === "optional-string" ||
    value === "string" ||
    value === "number" ||
    value === "boolean" ||
    value === "Uint32Array" ||
    value === "Float64Array" ||
    value === "Uint8Array" ||
    value === "Uint16Array" ||
    value === "optional-number"
  );
}
function successors(block: Block): readonly number[] {
  const t = block.terminator;
  const normal: readonly number[] =
    t.kind === "jump"
      ? [t.target]
      : t.kind === "branch" ||
          t.kind === "cell" ||
          t.kind === "record" ||
          t.kind === "record-cell"
        ? [t.consequent, t.alternate]
        : [];
  const handler = block.exception;
  if (handler === undefined) return normal;
  const result: number[] = [];
  for (const next of normal) {
    if (next === undefined) throw "successor invariant";
    result.push(next);
  }
  result.push(handler.target);
  return result;
}
export function verify(module: ModuleIR): Verification {
  const abort = {};
  let failure: Diagnostic | undefined,
    fnId = 0,
    blockId: number | undefined,
    instruction: number | undefined;
  function fail(code: Diagnostic["code"], message: string): never {
    failure = { code, function: fnId, block: blockId, instruction, message };
    throw abort;
  }
  function span(node: Span): void {
    if (!natural(node.start) || !natural(node.end) || node.end < node.start)
      fail("GRAPH", "invalid source span");
  }
  function equal(actual: string, expected: string): void {
    if (actual !== expected)
      fail("TYPE", "expected " + expected + ", received " + actual);
  }
  try {
    // Reuse numeric scratch across layouts. A native Set<number> stores linked
    // entries, making per-byte membership checks quadratic in layout size.
    const recordBytes =
      (module.records?.length ?? 0) === 0 ? undefined : createNumberIndex();
    let occupiedBytes = 0;
    function occupyRecordByte(offset: number): boolean {
      if (recordBytes === undefined) throw "record byte index invariant";
      if (recordBytes.intern(offset) !== occupiedBytes) return false;
      occupiedBytes++;
      return true;
    }
    for (const record of module.records ?? []) {
      if (record === undefined) fail("GRAPH", "missing record");
      if (
        !natural(record.byteLength) ||
        record.byteLength < 16 ||
        record.byteLength > 0xffffffff ||
        record.byteLength % 16 !== 0
      )
        fail("GRAPH", "invalid record extent");
      if (recordBytes === undefined) throw "record byte index invariant";
      recordBytes.clear();
      occupiedBytes = 0;
      for (const field of record.fields) {
        if (field === undefined) fail("GRAPH", "missing record field");
        if (!scalar(field.type)) fail("TYPE", "unsupported record field type");
        if (
          !natural(field.offset) ||
          field.offset < 16 ||
          field.offset % 8 !== 0 ||
          field.offset + scalarByteLength(field.type) > record.byteLength
        )
          fail("GRAPH", "invalid or overlapping record field");
        for (let word = 0; word < scalarByteLength(field.type); word++) {
          if (!occupyRecordByte(field.offset + word))
            fail("GRAPH", "overlapping record field");
        }
        const stateOffset = field.stateOffset,
          presenceOffset = field.presenceOffset;
        if (stateOffset !== undefined) {
          if (
            presenceOffset !== undefined ||
            !natural(stateOffset) ||
            stateOffset < 16 ||
            stateOffset >= record.byteLength ||
            !occupyRecordByte(stateOffset)
          )
            fail("GRAPH", "invalid or overlapping cell state byte");
        }
        if (presenceOffset !== undefined) {
          if (
            field.type !== "optional-number" &&
            field.type !== "optional-boolean" &&
            field.type !== "optional-reference" &&
            field.type !== "optional-string" &&
            field.type !== "general"
          )
            fail(
              "TYPE",
              "presence fields require an optional or general value representation",
            );
          if (
            !natural(presenceOffset) ||
            presenceOffset < 16 ||
            presenceOffset >= record.byteLength ||
            !occupyRecordByte(presenceOffset)
          )
            fail("GRAPH", "invalid or overlapping record presence tag");
        }
      }
    }
    const names = createStringIndex<number>();
    for (let i = 0; i < module.functions.length; i++) {
      const f = module.functions[i];
      fnId = i;
      if (f === undefined || f.id !== i || names.has(f.name))
        fail("GRAPH", "function IDs must be dense and names unique");
      names.set(f.name, i);
      if (!scalar(f.returnType) && f.returnType !== "void")
        fail("TYPE", "invalid return type");
      for (const t of f.slots)
        if (t === undefined || !scalar(t)) fail("TYPE", "invalid slot type");
      const closureEnvironment = f.closureEnvironment;
      if (closureEnvironment !== undefined) {
        if (
          !natural(closureEnvironment) ||
          module.records?.[closureEnvironment] === undefined
        )
          fail("GRAPH", "unknown managed closure environment record");
        if (f.environment !== undefined)
          fail("GRAPH", "managed and borrowed environments cannot coexist");
      }
      if (f.environment !== undefined) {
        const env = f.environment,
          ranges: { start: number; end: number }[] = [];
        if (!natural(env.byteLength) || env.byteLength > 65536)
          fail("GRAPH", "invalid environment extent");
        for (const cell of env.cells) {
          if (cell === undefined) fail("GRAPH", "missing environment cell");
          if (
            !scalar(cell.type) ||
            cell.type === "reference" ||
            cell.type === "string" ||
            [
              "Uint8Array",
              "Uint16Array",
              "Uint32Array",
              "Float64Array",
            ].includes(cell.type) !==
              (cell.borrowed === true)
          )
            fail(
              "TYPE",
              "reference cells must explicitly borrow a caller-owned unsigned typed-array handle",
            );
          const size = scalarByteLength(cell.type);
          if (
            !natural(cell.stateOffset) ||
            cell.stateOffset > 4095 ||
            !natural(cell.valueOffset) ||
            cell.valueOffset > 4095 ||
            cell.stateOffset >= env.byteLength ||
            cell.valueOffset + size > env.byteLength
          )
            fail("GRAPH", "environment cell is outside its extent");
          ranges.push(
            { start: cell.stateOffset, end: cell.stateOffset + 1 },
            { start: cell.valueOffset, end: cell.valueOffset + size },
          );
        }
        ranges.sort((a, b) => a.start - b.start);
        for (let j = 1; j < ranges.length; j++) {
          const a = ranges[j - 1],
            b = ranges[j];
          if (a !== undefined && b !== undefined && a.end > b.start)
            fail("GRAPH", "environment cell ranges overlap");
        }
      }
      const receiverSlot = f.receiverSlot;
      if (
        receiverSlot !== undefined &&
        (!natural(receiverSlot) ||
          f.slots[receiverSlot] !== "general" ||
          f.parameters.includes(receiverSlot))
      )
        fail("GRAPH", "receiver slot must be a separate general slot");
      const params = new Uint8Array(f.slots.length);
      for (const p of f.parameters) {
        if (
          p === undefined ||
          !natural(p) ||
          f.slots[p] === undefined ||
          params[p] === 1
        )
          fail("GRAPH", "invalid parameter slot");
        params[p] = 1;
      }
      let previousInteger = -1;
      for (const slot of f.integerSlots ?? []) {
        if (
          slot === undefined ||
          !natural(slot) ||
          slot <= previousInteger ||
          f.slots[slot] !== "number" ||
          params[slot] === 1 ||
          slot === receiverSlot
        )
          fail("GRAPH", "integer slots must be ascending local number slots");
        previousInteger = slot ?? previousInteger;
      }
      if (f.import !== undefined) {
        if (
          f.import !== true ||
          f.exported ||
          f.blocks.length !== 0 ||
          f.entry !== 0 ||
          f.environment !== undefined ||
          f.closureEnvironment !== undefined ||
          f.receiverSlot !== undefined ||
          f.slots.length !== f.parameters.length
        )
          fail("GRAPH", "managed imports require an ABI-only declaration");
      }
    }
    for (const f of module.functions) {
      if (f === undefined) fail("GRAPH", "missing function");
      fnId = f.id;
      blockId = undefined;
      instruction = undefined;
      if (f.import === true) continue;
      if (!natural(f.entry) || f.blocks[f.entry] === undefined)
        fail("GRAPH", "missing entry block");
      const predecessors: number[][] = f.blocks.map(() => []);
      for (let i = 0; i < f.blocks.length; i++) {
        const b = f.blocks[i];
        blockId = i;
        if (b === undefined || b.id !== i)
          fail("GRAPH", "block IDs must be dense");
        span(b.terminator);
        const handler = b.exception;
        if (
          handler !== undefined &&
          (!natural(handler.slot) || f.slots[handler.slot] !== "general")
        )
          fail("TYPE", "exception receiver must be a general value slot");
        for (const target of successors(b)) {
          if (
            target === undefined ||
            !natural(target) ||
            f.blocks[target] === undefined
          )
            fail("GRAPH", "unknown successor");
          const incoming = predecessors[target];
          if (incoming !== undefined) incoming.push(i);
        }
      }
      const reachable = new Uint8Array(f.blocks.length),
        pending = [f.entry];
      let reachableCount = 0;
      while (pending.length) {
        const id = pending.pop();
        if (id === undefined || reachable[id] === 1) continue;
        reachable[id] = 1;
        reachableCount++;
        const b = f.blocks[id];
        if (b === undefined) throw "reachability invariant";
        for (const successor of successors(b)) {
          if (successor === undefined) fail("GRAPH", "missing successor");
          pending.push(successor);
        }
      }
      if (reachableCount !== f.blocks.length)
        fail("GRAPH", "unreachable blocks must be removed");
      const definitions = createNumberIndex(),
        valueTypes: (ScalarType | undefined)[] = [],
        valueBlocks: number[] = [];
      for (const b of f.blocks) {
        if (b === undefined) fail("GRAPH", "missing block");
        blockId = b.id;
        const ownerBlock = b.id;
        function use(id: number): ScalarType {
          if (!natural(id))
            return fail("VALUE", "value must be defined earlier in this block");
          const index = definitions.intern(id);
          const type = valueTypes[index];
          if (type === undefined || valueBlocks[index] !== ownerBlock)
            return fail("VALUE", "value must be defined earlier in this block");
          return type;
        }
        function define(id: number, type: ScalarType): void {
          if (!natural(id)) fail("VALUE", "invalid or duplicate value ID");
          const index = definitions.intern(id);
          if (valueTypes[index] !== undefined)
            fail("VALUE", "invalid or duplicate value ID");
          valueTypes[index] = type;
          valueBlocks[index] = ownerBlock;
        }
        const functionSlots = f.slots;
        function slot(id: number): ScalarType {
          const t = functionSlots[id];
          if (!natural(id) || t === undefined)
            return fail("GRAPH", "unknown slot");
          return t;
        }
        for (let i = 0; i < b.instructions.length; i++) {
          instruction = i;
          const op = b.instructions[i];
          if (op === undefined) throw "instruction invariant";
          span(op);
          switch (op.kind) {
            case "record-read": {
              const type = use(op.object);
              if (type !== "reference" && type !== "optional-reference")
                fail("TYPE", "record read requires a reference");
              const field = module.records?.[op.record]?.fields[op.field];
              if (
                !natural(op.record) ||
                !natural(op.field) ||
                field === undefined ||
                field.stateOffset !== undefined
              )
                fail("TYPE", "record read requires a valid non-cell field");
              define(op.id, field.type);
              break;
            }
            case "record-has": {
              const type = use(op.object);
              if (type !== "reference" && type !== "optional-reference")
                fail("TYPE", "record presence requires an object reference");
              if (
                !natural(op.record) ||
                !natural(op.field) ||
                module.records?.[op.record]?.fields[op.field] === undefined
              )
                fail(
                  "GRAPH",
                  "record presence requires a known descriptor and field",
                );
              define(op.id, "boolean");
              break;
            }
            case "general-equal":
              equal(use(op.left), "general");
              equal(use(op.right), "general");
              define(op.id, "boolean");
              break;
            case "general-kind":
              equal(use(op.value), "general");
              define(op.id, "string");
              break;
            case "function-address": {
              const target = module.functions[op.target];
              if (!natural(op.target) || target === undefined)
                fail("GRAPH", "function address requires a known target");
              if (target.import === true)
                fail("GRAPH", "managed imports have no local address");
              if (
                target.environment !== undefined ||
                target.closureEnvironment !== undefined ||
                target.receiverSlot !== undefined
              )
                fail(
                  "GRAPH",
                  "function address target must be environment-free",
                );
              if (op.part !== "entry" && op.part !== "signature")
                fail("GRAPH", "invalid function address part");
              define(op.id, "number");
              break;
            }
            case "record-descriptor-address":
              if (
                !natural(op.record) ||
                module.records?.[op.record] === undefined
              )
                fail("GRAPH", "record identity requires a known descriptor");
              define(op.id, "number");
              break;
            case "general-record-is":
            case "general-record-descriptor":
              equal(use(op.value), "general");
              if (
                !natural(op.record) ||
                module.records?.[op.record] === undefined
              )
                fail(
                  "GRAPH",
                  "general record operation requires a known descriptor",
                );
              define(
                op.id,
                op.kind === "general-record-is" ? "boolean" : "number",
              );
              break;
            case "general-null":
            case "general-none":
              define(op.id, "general");
              break;
            case "general-wrap": {
              const t = use(op.value);
              if (
                t !== "number" &&
                t !== "boolean" &&
                t !== "string" &&
                t !== "reference" &&
                t !== "Uint8Array" &&
                t !== "Uint16Array" &&
                t !== "Uint32Array" &&
                t !== "Float64Array"
              )
                fail("TYPE", "general packing requires a concrete category");
              define(op.id, "general");
              break;
            }
            case "general-value":
              equal(use(op.value), "general");
              if (
                op.type !== "number" &&
                op.type !== "boolean" &&
                op.type !== "string" &&
                op.type !== "reference"
              )
                fail("TYPE", "unsupported general extraction category");
              define(op.id, op.type);
              break;
            case "boolean-none":
              define(op.id, "optional-boolean");
              break;
            case "boolean-wrap":
              equal(use(op.value), "boolean");
              define(op.id, "optional-boolean");
              break;
            case "boolean-value":
            case "boolean-present":
              equal(use(op.value), "optional-boolean");
              define(op.id, "boolean");
              break;
            case "primitive-wrap":
              equal(use(op.value), "reference");
              define(op.id, "primitive");
              break;
            case "primitive-reference":
              equal(use(op.value), "primitive");
              define(op.id, "reference");
              break;
            case "string-none":
              define(op.id, "optional-string");
              break;
            case "string-wrap":
              equal(use(op.value), "string");
              define(op.id, "optional-string");
              break;
            case "string-value":
            case "string-present":
              equal(use(op.value), "optional-string");
              define(op.id, op.kind === "string-value" ? "string" : "boolean");
              break;
            case "reference-none":
              define(op.id, "optional-reference");
              break;
            case "reference-wrap":
              if (
                ![
                  "reference",
                  "Uint8Array",
                  "Uint16Array",
                  "Uint32Array",
                  "Float64Array",
                ].includes(use(op.value))
              )
                fail(
                  "TYPE",
                  "reference wrapping requires a reference or typed array",
                );
              define(op.id, "optional-reference");
              break;
            case "reference-value":
              if (
                ![
                  "reference",
                  "Uint8Array",
                  "Uint16Array",
                  "Uint32Array",
                  "Float64Array",
                ].includes(op.type ?? "reference")
              )
                fail("TYPE", "invalid reference extraction type");
              equal(use(op.value), "optional-reference");
              define(op.id, op.type ?? "reference");
              break;
            case "array-subarray": {
              const type = use(op.array);
              if (
                ![
                  "Uint8Array",
                  "Uint16Array",
                  "Uint32Array",
                  "Float64Array",
                ].includes(type)
              )
                fail("TYPE", "subarray requires unsigned typed array");
              equal(use(op.begin), "number");
              equal(use(op.length), "number");
              define(op.id, type);
              break;
            }
            case "weak-slot-new":
              equal(use(op.key), "general");
              equal(use(op.value), "general");
              equal(use(op.ephemeron), "boolean");
              define(op.id, "general");
              break;
            case "weak-slot-key":
            case "weak-slot-value":
              equal(use(op.cell), "general");
              define(op.id, "general");
              break;
            case "weak-slot-set-value":
              equal(use(op.cell), "general");
              equal(use(op.value), "general");
              break;
            case "weak-slot-clear":
              equal(use(op.cell), "general");
              break;
            case "reference-vector-new":
              equal(use(op.length), "number");
              define(op.id, "reference");
              break;
            case "reference-vector-is":
              equal(use(op.vector), "optional-reference");
              define(op.id, "boolean");
              break;
            case "reference-vector-length":
              equal(use(op.vector), "reference");
              define(op.id, "number");
              break;
            case "reference-vector-read":
              equal(use(op.vector), "reference");
              equal(use(op.index), "number");
              define(op.id, "optional-reference");
              break;
            case "reference-vector-write":
              equal(use(op.vector), "reference");
              equal(use(op.index), "number");
              equal(use(op.value), "optional-reference");
              break;
            case "reference-vector-copy":
              equal(use(op.source), "reference");
              equal(use(op.target), "reference");
              equal(use(op.count), "number");
              break;
            case "array-new":
              if (
                ![
                  "Uint8Array",
                  "Uint16Array",
                  "Uint32Array",
                  "Float64Array",
                ].includes(op.type)
              )
                fail("TYPE", "invalid allocated array kind");
              equal(use(op.length), "number");
              define(op.id, op.type);
              break;
            case "string-literal":
              if (typeof op.value !== "string")
                fail("TYPE", "invalid string literal");
              define(op.id, "string");
              break;
            case "string-starts-with":
              equal(use(op.string), "string");
              equal(use(op.search), "string");
              equal(use(op.position), "number");
              define(op.id, "boolean");
              break;
            case "string-slice":
              equal(use(op.string), "string");
              equal(use(op.begin), "number");
              equal(use(op.limit), "optional-number");
              define(op.id, "string");
              break;
            case "string-from-code-units":
              for (const value of op.values) {
                if (value === undefined) fail("VALUE", "missing code unit");
                equal(use(value), "number");
              }
              define(op.id, "string");
              break;
            case "string-concat":
              equal(use(op.left), "string");
              equal(use(op.right), "string");
              define(op.id, "string");
              break;
            case "string-allocate":
              equal(use(op.length), "number");
              define(op.id, "string");
              break;
            case "string-write":
              equal(use(op.target), "string");
              equal(use(op.offset), "number");
              equal(use(op.source), "string");
              break;
            case "string-length":
              equal(use(op.string), "string");
              define(op.id, "number");
              break;
            case "string-code-unit":
              equal(use(op.string), "string");
              equal(use(op.index), "number");
              define(op.id, "number");
              break;
            case "closure-environment":
              if (f.closureEnvironment === undefined)
                fail("GRAPH", "function has no managed closure environment");
              define(op.id, "reference");
              break;
            case "function-environment":
              equal(use(op.callee), "reference");
              define(op.id, "optional-reference");
              break;
            case "function-new": {
              const target = module.functions[op.target];
              if (!natural(op.target) || target === undefined)
                fail("GRAPH", "unknown function value target");
              if (target.import === true)
                fail(
                  "GRAPH",
                  "managed imports cannot construct function values",
                );
              if (target.environment !== undefined)
                fail(
                  "GRAPH",
                  "capturing function values require an owned environment",
                );
              if (target.closureEnvironment !== undefined) {
                if (op.environment === undefined)
                  fail(
                    "GRAPH",
                    "capturing function value requires its managed environment",
                  );
                equal(use(op.environment), "reference");
              } else if (op.environment !== undefined)
                fail(
                  "GRAPH",
                  "noncapturing function value cannot receive an environment",
                );
              define(op.id, "reference");
              break;
            }
            case "record-new": {
              const record = module.records?.[op.record];
              if (!natural(op.record) || record === undefined)
                fail("GRAPH", "unknown record constructor");
              if (op.arguments.length !== record.fields.length)
                fail("TYPE", "record construction requires every field");
              if (
                op.presence !== undefined &&
                op.presence.length !== record.fields.length
              )
                fail("TYPE", "record presence overrides require every field");
              for (let i = 0; i < op.arguments.length; i++) {
                const arg = op.arguments[i],
                  field = record.fields[i];
                if (field === undefined) throw "record arity invariant";
                const presence = op.presence?.[i];
                if (presence !== undefined) {
                  if (field.presenceOffset === undefined || arg === undefined)
                    fail(
                      "TYPE",
                      "dynamic presence requires an optional field payload",
                    );
                  equal(use(presence), "boolean");
                }
                if (arg === undefined) {
                  if (
                    field.presenceOffset === undefined &&
                    field.stateOffset === undefined
                  )
                    fail("TYPE", "required record field cannot be omitted");
                } else equal(use(arg), field.type);
              }
              define(op.id, "reference");
              break;
            }
            case "error-new":
              if (op.error !== "TypeError" && op.error !== "RangeError")
                fail("TYPE", "invalid error brand");
              equal(use(op.message), "string");
              define(op.id, "reference");
              break;
            case "error-is":
              if (op.error !== "TypeError" && op.error !== "RangeError")
                fail("TYPE", "invalid error brand");
              equal(use(op.value), "general");
              define(op.id, "boolean");
              break;
            case "host-call": {
              const parameters = hostParameters(op.operation);
              if (
                parameters === undefined ||
                parameters.length !== op.arguments.length
              )
                fail("TYPE", "invalid host call signature");
              for (let index = 0; index < op.arguments.length; index++) {
                const argument = op.arguments[index],
                  parameter = parameters[index];
                if (argument === undefined || parameter === undefined)
                  fail("TYPE", "host call argument invariant");
                equal(use(argument), parameter);
              }
              const resultType = hostReturnType(op.operation);
              if (resultType === undefined)
                fail("TYPE", "invalid host return signature");
              if (resultType === "void") {
                if (op.id !== undefined)
                  fail("TYPE", "void host call has a result");
              } else {
                if (op.id === undefined)
                  fail("TYPE", "host call result is missing");
                define(op.id, resultType);
              }
              break;
            }
            case "constant":
              define(
                op.id,
                typeof op.value === "number" ? "number" : "boolean",
              );
              break;
            case "array-buffer":
            case "array-byte-offset":
            case "array-byte-length":
            case "array-length":
              if (
                ![
                  "Uint8Array",
                  "Uint16Array",
                  "Uint32Array",
                  "Float64Array",
                ].includes(use(op.array))
              )
                fail(
                  "TYPE",
                  "array operand must be an unsigned integer typed array",
                );
              define(
                op.id,
                op.kind === "array-buffer" ? "reference" : "number",
              );
              break;
            case "array-copy": {
              const destination = use(op.array);
              if (
                ![
                  "Uint8Array",
                  "Uint16Array",
                  "Uint32Array",
                  "Float64Array",
                ].includes(destination)
              )
                fail("TYPE", "bulk copy requires typed arrays");
              equal(use(op.source), destination);
              equal(use(op.offset), "number");
              define(op.id, "boolean");
              break;
            }
            case "array-valid":
            case "array-read":
            case "array-element":
            case "array-write":
            case "array-store":
              if (
                ![
                  "Uint8Array",
                  "Uint16Array",
                  "Uint32Array",
                  "Float64Array",
                ].includes(use(op.array))
              )
                fail(
                  "TYPE",
                  "array operand must be an unsigned integer typed array",
                );
              equal(use(op.index), "number");
              if (op.kind === "array-write" || op.kind === "array-store")
                equal(use(op.value), "number");
              else
                define(
                  op.id,
                  op.kind === "array-valid"
                    ? "boolean"
                    : op.kind === "array-element"
                      ? "number"
                      : "optional-number",
                );
              break;
            case "undefined":
              define(op.id, "optional-number");
              break;
            case "optional-wrap":
              equal(use(op.value), "number");
              define(op.id, "optional-number");
              break;
            case "optional-present":
            case "optional-value":
              equal(use(op.value), "optional-number");
              define(
                op.id,
                op.kind === "optional-present" ? "boolean" : "number",
              );
              break;
            case "optional-value-or":
              equal(use(op.value), "optional-number");
              equal(use(op.fallback), "number");
              define(op.id, "number");
              break;
            case "load":
              define(op.id, slot(op.slot));
              break;
            case "store":
              equal(use(op.value), slot(op.slot));
              break;
            case "unary": {
              const t = use(op.operand);
              if (
                t === "primitive" ||
                (t === "general" &&
                  op.operator !== "!" &&
                  op.operator !== "truthy")
              )
                fail(
                  "TYPE",
                  "primitive operations require payload-aware runtime lowering",
                );
              if (
                op.operator === "!" ||
                op.operator === "truthy" ||
                op.operator === "is-integer"
              )
                define(op.id, "boolean");
              else if (op.operator === "boolean-number") {
                equal(t, "boolean");
                define(op.id, "number");
              } else if (
                ["+", "-", "~", "ceil", "trunc", "sqrt", "uint32"].includes(
                  op.operator,
                )
              ) {
                equal(t, "number");
                define(op.id, "number");
              } else fail("TYPE", "unsupported unary operator");
              break;
            }
            case "binary": {
              const a = use(op.left),
                c = use(op.right);
              if (
                a === "primitive" ||
                c === "primitive" ||
                a === "general" ||
                c === "general"
              )
                fail(
                  "TYPE",
                  "primitive operations require payload-aware runtime lowering",
                );
              if (["===", "!==", "==", "!="].includes(op.operator)) {
                equal(a, c);
                define(op.id, "boolean");
              } else if (
                [
                  "+",
                  "-",
                  "*",
                  "/",
                  "%",
                  "<<",
                  ">>",
                  ">>>",
                  "&",
                  "|",
                  "^",
                  "imul",
                  "<",
                  ">",
                  "<=",
                  ">=",
                ].includes(op.operator)
              ) {
                equal(a, "number");
                equal(c, "number");
                define(
                  op.id,
                  ["<", ">", "<=", ">="].includes(op.operator)
                    ? "boolean"
                    : "number",
                );
              } else fail("TYPE", "unsupported binary operator");
              break;
            }
            case "call-indirect":
            case "call": {
              if (op.receiver !== undefined) equal(use(op.receiver), "general");
              const target = module.functions[op.target];
              if (!natural(op.target) || target === undefined)
                fail("GRAPH", "unknown callee");
              if (
                target.import === true &&
                op.kind === "call" &&
                (op.environment === "inherit" || op.receiver !== undefined)
              )
                fail(
                  "GRAPH",
                  "managed imports take no environment or receiver",
                );
              if (target.import === true && op.kind === "call-indirect")
                fail(
                  "GRAPH",
                  "managed imports cannot be indirect-call witnesses",
                );
              if (op.kind === "call-indirect")
                equal(use(op.callee), "reference");
              else if (op.environment === "inherit") {
                const caller = f.environment,
                  callee = target.environment;
                if (
                  caller === undefined ||
                  callee === undefined ||
                  caller.byteLength !== callee.byteLength ||
                  caller.cells.length !== callee.cells.length ||
                  caller.cells.some((c, i): boolean => {
                    const other = callee.cells[i];
                    return (
                      c === undefined ||
                      other === undefined ||
                      c.type !== other.type ||
                      c.stateOffset !== other.stateOffset ||
                      c.valueOffset !== other.valueOffset ||
                      c.mutable !== other.mutable ||
                      c.borrowed !== other.borrowed
                    );
                  })
                )
                  fail(
                    "GRAPH",
                    "inherited environment requires matching caller and callee layouts",
                  );
              } else if (
                target.environment !== undefined ||
                target.closureEnvironment !== undefined
              )
                fail(
                  "GRAPH",
                  "environment callee requires explicit environment forwarding",
                );
              if (op.arguments.length !== target.parameters.length)
                fail("TYPE", "call arity mismatch");
              for (let j = 0; j < op.arguments.length; j++) {
                const value = op.arguments[j],
                  parameter = target.parameters[j];
                if (value === undefined || parameter === undefined)
                  throw "argument invariant";
                const t = target.slots[parameter];
                if (t === undefined) throw "signature invariant";
                equal(use(value), t);
              }
              const returnType = target.returnType,
                resultId = op.id;
              if (returnType === "void") {
                if (resultId !== undefined)
                  fail("TYPE", "void call defines no value");
              } else {
                if (resultId === undefined)
                  fail("TYPE", "value call requires a result");
                define(resultId, returnType);
              }
              break;
            }
          }
        }
        instruction = undefined;
        const t = b.terminator;
        if (t.kind === "throw") equal(use(t.value), "general");
        if (t.kind === "branch") equal(use(t.condition), "boolean");
        if (t.kind === "cell") {
          const cell = f.environment?.cells[t.cell];
          if (!natural(t.cell) || cell === undefined)
            fail("GRAPH", "unknown environment cell");
          if (!["initialize", "read", "write"].includes(t.operation))
            fail("GRAPH", "unknown cell operation");
          equal(slot(t.slot), cell.type);
        }
        if (t.kind === "record-cell") {
          equal(use(t.object), "reference");
          const field = module.records?.[t.record]?.fields[t.field];
          if (!natural(t.record) || !natural(t.field) || field === undefined)
            fail("GRAPH", "unknown managed cell field");
          if (
            field.stateOffset === undefined ||
            field.stateOffset > 4095 ||
            field.offset > 4095
          )
            fail(
              "GRAPH",
              "managed cell requires directly addressable state and payload offsets",
            );
          if (!["initialize", "read", "write"].includes(t.operation))
            fail("GRAPH", "unknown managed cell operation");
          if (t.initialized === true && t.operation === "initialize")
            fail("GRAPH", "a cell initialization cannot be proven initialized");
          equal(slot(t.slot), field.type);
        }
        if (t.kind === "record") {
          equal(use(t.object), "reference");
          const record = module.records?.[t.record],
            field = record?.fields[t.field];
          if (!natural(t.record) || !natural(t.field) || field === undefined)
            fail("GRAPH", "unknown record field");
          if (field.stateOffset !== undefined)
            fail(
              "TYPE",
              "initialized cell fields require guarded record-cell access",
            );
          if (t.operation !== "read" && t.operation !== "write")
            fail("GRAPH", "unknown record operation");
          if (t.operation === "write" && !field.mutable)
            fail("TYPE", "record field is immutable");
          equal(slot(t.slot), field.type);
        }
        if (t.kind === "return") {
          if (t.value === undefined) equal("void", f.returnType);
          else equal(use(t.value), f.returnType);
        }
      }
      // Must-initialization: greatest fixed point of predecessor intersections.
      // Entry includes only parameters, even if a backedge targets it.
      const tracked = initializationSlots(f),
        slotCount = tracked.count;
      // Every read is covered by a parameter or a bounded local definition proof.
      // Graph and operand verification above still runs for these functions.
      if (slotCount === 0) continue;
      function initialize(bits: Uint32Array, slot: number): void {
        const index = tracked.indices[slot] ?? 0;
        if (index !== 0) setBit(bits, index - 1);
      }
      function initialized(bits: Uint32Array, slot: number): boolean {
        const index = tracked.indices[slot] ?? 0;
        return index === 0 || hasBit(bits, index - 1);
      }
      function edgeBit(slot: number | undefined): number {
        return slot === undefined ? -1 : (tracked.indices[slot] ?? 0) - 1;
      }
      const words = Math.ceil(slotCount / 32),
        matrixWords = words * f.blocks.length,
        inputs = new Uint32Array(matrixWords),
        outputs = new Uint32Array(matrixWords),
        exceptionOutputs = new Uint32Array(matrixWords),
        out = createBits(slotCount, true),
        exceptionalOut = createBits(slotCount, true);
      inputs.fill(0xffffffff);
      // Parameters are excluded by initializationSlots. Entry starts with no
      // tracked facts; backedges must never strengthen this boundary.
      inputs.fill(0, f.entry * words, (f.entry + 1) * words);
      outputs.fill(0xffffffff);
      exceptionOutputs.fill(0xffffffff);
      // Incoming facts only shrink. Meet each changed edge into this cached
      // matrix instead of rescanning every predecessor whenever a block runs.
      const blockCount = f.blocks.length,
        pendingBlocks = new Uint32Array(blockCount),
        queued = new Uint8Array(blockCount);
      for (let id = 0; id < blockCount; id++) pendingBlocks[id] = id;
      queued.fill(1);
      let head = 0,
        tail = 0,
        pendingCount = blockCount,
        checkingIndex = 0;
      while (pendingCount > 0 || checkingIndex < blockCount) {
        const checking = pendingCount === 0;
        let id = checkingIndex;
        if (checking) checkingIndex++;
        else {
          const scheduled = pendingBlocks[head];
          if (scheduled === undefined) throw "initialization queue invariant";
          id = scheduled;
          head++;
          if (head === blockCount) head = 0;
          pendingCount--;
          queued[id] = 0;
        }
        const b = f.blocks[id];
        if (b === undefined) fail("GRAPH", "missing block");
        copyBitRange(out, inputs, b.id * words);
        if (!checking) exceptionalOut.fill(0xffffffff);
        let position = 0;
        if (checking) blockId = b.id;
        for (const op of b.instructions) {
          if (op === undefined) fail("GRAPH", "missing instruction");
          if (checking) {
            instruction = position;
            if (op.kind === "load" && !initialized(out, op.slot))
              fail(
                "INITIALIZATION",
                "slot is not initialized on every incoming path",
              );
          }
          position++;
          if (!checking && instructionMayThrow(op))
            intersectBits(exceptionalOut, out);
          if (op.kind === "store") initialize(out, op.slot);
        }
        const terminator = b.terminator;
        if (
          checking &&
          (terminator.kind === "cell" ||
            terminator.kind === "record" ||
            terminator.kind === "record-cell") &&
          terminator.operation !== "read" &&
          !initialized(out, terminator.slot)
        )
          fail(
            "INITIALIZATION",
            "guarded write/initialization requires an initialized transfer slot",
          );
        if (
          !checking &&
          (b.terminator.kind === "throw" ||
            b.terminator.kind === "throw-literal")
        )
          intersectBits(exceptionalOut, out);
        if (!checking) {
          let normalChanged = false,
            exceptionChanged = false;
          const blockBase = b.id * words;
          for (let word = 0; word < words; word++) {
            const index = blockBase + word,
              normal = out[word] ?? 0,
              exceptional = exceptionalOut[word] ?? 0;
            if (outputs[index] !== normal) normalChanged = true;
            if (exceptionOutputs[index] !== exceptional)
              exceptionChanged = true;
            outputs[index] = normal;
            exceptionOutputs[index] = exceptional;
          }
          if (normalChanged || exceptionChanged) {
            let one = -1,
              two = -1;
            if (normalChanged) {
              if (terminator.kind === "jump") one = terminator.target;
              else if (
                terminator.kind === "branch" ||
                terminator.kind === "cell" ||
                terminator.kind === "record" ||
                terminator.kind === "record-cell"
              ) {
                one = terminator.consequent;
                two = terminator.alternate;
              }
            }
            const handler = exceptionChanged ? b.exception : undefined;
            for (let edge = 0; edge < 3; edge++) {
              const target =
                edge === 0
                  ? one
                  : edge === 1
                    ? two
                    : handler === undefined
                      ? -1
                      : handler.target;
              if (target < 0) continue;
              const addedSlot =
                edge === 2
                  ? handler?.slot
                  : (terminator.kind === "cell" ||
                        terminator.kind === "record" ||
                        terminator.kind === "record-cell") &&
                      terminator.operation === "read" &&
                      terminator.consequent === target &&
                      terminator.alternate !== target
                    ? terminator.slot
                    : undefined;
              const changed = intersectBitWindows(
                inputs,
                target * words,
                edge === 2 ? exceptionOutputs : outputs,
                blockBase,
                words,
                edgeBit(addedSlot),
              );
              if (!changed || queued[target] === 1) continue;
              pendingBlocks[tail] = target;
              tail++;
              if (tail === blockCount) tail = 0;
              pendingCount++;
              queued[target] = 1;
            }
          }
        }
      }
    }
    let stableLayouts: boolean | undefined;
    for (const fn of module.functions) {
      if (fn === undefined) throw "record proof function invariant";
      let proofs: Uint8Array | undefined;
      fnId = fn.id;
      for (const block of fn.blocks) {
        if (block === undefined) throw "record proof block invariant";
        blockId = block.id;
        for (let index = 0; index < block.instructions.length; index++) {
          const op = block.instructions[index];
          if (op === undefined) throw "record proof instruction invariant";
          if (op.kind !== "record-read") continue;
          instruction = index;
          if (proofs === undefined) {
            stableLayouts ??= stableDescriptors(module);
            proofs = provenRecordReads(fn, 1000000, stableLayouts);
          }
          if (proofs === undefined || proofs[op.id] !== 1)
            fail("TYPE", "record read lacks a proven layout");
        }
      }
    }
  } catch (error) {
    if (error !== abort) throw error;
  }
  if (failure !== undefined) return { ok: false, error: failure };
  return { ok: true };
}
export {
  naturalLoops,
  blockSuccessors,
  type NaturalLoop,
  type LoopForest,
} from "./loops.ts";
