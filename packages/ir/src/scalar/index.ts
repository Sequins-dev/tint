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
/** Flat UTF-16 result limit: align8(16 + 2 * length) fits uint32 allocation sizes. */
export const maximumStringLength = 0x7fffffec;
/** Work limit of the verifier's direct record read proofs. Verification fails
 * loudly past it; passes that must keep IR verifiable check against it. */
export const verifierRecordWork = 1000000;
/** Name prefix of the cached-vector dense list readers that
 * cacheListVectors creates: (vector, list, index), where the vector is the
 * list's current root vector or none. Codegen inlines them on that trust. */
export const cachedListReadPrefix = "__tint_reference_list_readv$";
/** Name prefix of cacheListVectors' vector accessors: (list or none) to the
 * list's root when it is a reference vector, else none. */
export const listVectorPrefix = "__tint_reference_list_vector$";
export { analyzeRecordAccesses, provenRecordReads } from "./record-facts.ts";
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
  renumberInstructionResult,
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
export {
  indirectCallClass,
  indirectCallTargets,
  type IndirectCallTargets,
} from "./call-targets.ts";
export {
  provenWordFacts,
  provenWordReturns,
  type WordFacts,
} from "./word-facts.ts";
export { functionHeader } from "./model.ts";
import { instructionResult } from "./operands.ts";
export { instructionResult } from "./operands.ts";
export {
  immediateDominators,
  dominates,
  type Dominators,
} from "./dominators.ts";
export {
  provenRecordFacts,
  provenRecordFlows,
  type RecordFlowFacts,
} from "./record-flow.ts";
import {
  createNumberIndex,
  createStringIndex,
} from "@tint/foundation/collections/key-index";
export {
  provenRecordGuards,
  dataflowRecordGuards,
  stableRecordLayouts,
  stableDescriptors,
  trackedManagedWrites,
} from "./record-facts.ts";
export {
  deadSlotsAtEntry,
  analyzeLiveSlots,
  analyzeLiveSlotRows,
  analyzeLiveSlotRowsPrecisely,
  analyzeLiveSlotsPrecisely,
  fitsLiveRows,
  liveRowWords,
  liveSlotsIntoEntry,
  type SlotLiveness,
  type SlotLiveRows,
} from "./liveness.ts";
export {
  slotVariables,
  removedStoreBinding,
  retainDebugValues,
} from "./debug.ts";
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
import { foreignCallTypes, foreignMemoryTypes } from "./foreign.ts";
export {
  foreignCallTypes,
  foreignMemoryTypes,
  type ForeignMemoryAccess,
  type ForeignMemoryTypesResult,
  bindForeignCalls,
  dynamicForeignCall,
  dynamicCallFrame,
  callbackTransition,
  callbackEntered,
  directCallbackExtras,
  callbackState,
  transitionBytes,
  type ForeignCall,
  type ForeignOperand,
  type ForeignResult,
  type ForeignCallTypes,
  type ForeignCallTypesResult,
  type ForeignBinding,
  type ForeignBindingResult,
} from "./foreign.ts";
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
  FunctionBodySource,
  FunctionIR,
  FunctionDebug,
  Instruction,
  Verification,
  Diagnostic,
  ScalarType,
  Span,
  Block,
  RecordField,
  RecordLayout,
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
  return type === "general" || type === "optional-boolean" ? 16 : 8;
}
/** Managed object header (one word: the descriptor address) preceding every
 * record payload; see nativeHeaderByteLength in @tint/abi/host. */
export const recordHeaderBytes = 8;
/** Managed allocation granule: object starts and extents (records
 * included) are multiples of it, and the moving collectors keep one start bit
 * and one dirty bit per granule. */
export const recordAllocationAlignment = 8;
/** A record field before placement. */
export interface RecordFieldShape {
  readonly type: ScalarType;
  readonly mutable: boolean;
  /** Carries a presence byte. */
  readonly optional: boolean;
  /** Carries a cell initialization state byte. */
  readonly initialized?: boolean;
  /** May be omitted at construction (see RecordField.deferred). */
  readonly deferred?: boolean;
}
/** The shared physical record layout. Payload words (all 8-byte multiples
 * with 8-byte alignment) follow the header in field order, so they need no
 * padding; the one-byte presence and state tags pack after them (a word
 * per tag before), and the extent rounds up to the allocation granule. */
export function placeRecordFields(
  fields: readonly RecordFieldShape[],
  payloadOffset: number = recordHeaderBytes,
  alignment: number = recordAllocationAlignment,
): RecordLayout {
  let cursor = payloadOffset;
  const offsets: number[] = [];
  for (const field of fields) {
    if (field === undefined) throw "record shape invariant";
    if (field.optional && field.initialized === true)
      throw "record presence and initialization require separate fields";
    if (
      field.deferred === true &&
      (field.optional || field.initialized === true)
    )
      throw "deferred record fields carry no tag";
    offsets.push(cursor);
    cursor += scalarByteLength(field.type);
  }
  const placed: RecordField[] = [];
  for (let index = 0; index < fields.length; index++) {
    const field = fields[index],
      offset = offsets[index];
    if (field === undefined || offset === undefined)
      throw "record shape invariant";
    const tag = field.optional || field.initialized === true ? cursor++ : -1;
    placed.push({
      type: field.type,
      mutable: field.mutable,
      offset,
      ...(field.optional ? { presenceOffset: tag } : {}),
      ...(field.initialized === true ? { stateOffset: tag } : {}),
      ...(field.deferred === true ? { deferred: true } : {}),
    });
  }
  return {
    byteLength: Math.ceil(cursor / alignment) * alignment,
    fields: placed,
  };
}
/** `optional-number` is one NaN-boxed binary64 word: a present number is its
 * own IEEE-754 bits and `undefined` is the reserved signalling NaN
 * 0xFFF7_FFFF_FFFF_FFFF (these are its high and low 32-bit halves).
 *
 * Soundness rests on one invariant: no present optional number has the
 * reserved bits. AArch64 floating-point arithmetic never returns a
 * signalling NaN (a signalling operand is quieted, and the default NaN is
 * quiet), so arithmetic results cannot equal it whatever their inputs, and
 * FPCR stays untouched. Bitwise sources can: typed-array and memory reads,
 * and FNEG/FABS or plain moves of such bits. Every wrap of a number that is
 * not provably quiet therefore quiets it first (FMAX x, x: the identity for
 * every non-NaN, -0 included, and a quiet NaN for every NaN). Unwrapping
 * quiets too, so `undefined` becomes a quiet NaN number. Zeroed storage is
 * +0, not `undefined`: allocations of optional-number fields store the
 * reserved bits explicitly. */
export const optionalNumberAbsentHigh = 0xfff7ffff;
export const optionalNumberAbsentLow = 0xffffffff;
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
export function verify(
  module: ModuleIR,
  bodies?: FunctionBodySource,
): Verification {
  let held = -1;
  function releaseBody(): void {
    if (held >= 0) bodies?.release(held);
    held = -1;
  }
  function readBody(header: FunctionIR): FunctionIR {
    releaseBody();
    if (bodies === undefined) return header;
    held = header.id;
    return bodies.get(held);
  }
  let hasRecordReads = false;
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
  /** Inline provenance names a site of the function's debug metadata. */
  function origin(
    site: number | undefined,
    debug: FunctionDebug | undefined,
  ): void {
    if (
      site !== undefined &&
      (!natural(site) ||
        debug === undefined ||
        site >= debug.inlineSites.length)
    )
      fail("GRAPH", "invalid inline provenance");
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
        record.byteLength < recordHeaderBytes ||
        record.byteLength > 0xffffffff ||
        record.byteLength % recordAllocationAlignment !== 0
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
          field.offset < recordHeaderBytes ||
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
            stateOffset < recordHeaderBytes ||
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
            presenceOffset < recordHeaderBytes ||
            presenceOffset >= record.byteLength ||
            !occupyRecordByte(presenceOffset)
          )
            fail("GRAPH", "invalid or overlapping record presence tag");
        }
      }
    }
    const names = createStringIndex<number>();
    for (let i = 0; i < module.functions.length; i++) {
      const header = module.functions[i];
      fnId = i;
      if (header === undefined || header.id !== i || names.has(header.name))
        fail("GRAPH", "function IDs must be dense and names unique");
      const f = readBody(header);
      names.set(f.name, i);
      if (!scalar(f.returnType) && f.returnType !== "void")
        fail("TYPE", "invalid return type");
      for (const t of f.slots)
        if (t === undefined || !scalar(t)) fail("TYPE", "invalid slot type");
      const debug = f.debug;
      if (debug !== undefined) {
        // Inline sites nest outward: a parent precedes its children.
        for (let site = 0; site < debug.inlineSites.length; site++) {
          const entry = debug.inlineSites[site];
          if (entry === undefined) fail("GRAPH", "missing inline site");
          span(entry);
          const parent = entry.parent;
          if (parent !== undefined && (!natural(parent) || parent >= site))
            fail("GRAPH", "invalid inline site parent");
        }
        for (const variable of debug.variables) {
          if (variable === undefined) fail("GRAPH", "missing debug variable");
          span(variable);
          const record = variable.record,
            inline = variable.inline;
          if (
            variable.name.length === 0 ||
            (record !== undefined &&
              (!natural(record) || module.records?.[record] === undefined)) ||
            (inline !== undefined &&
              (!natural(inline) || inline >= debug.inlineSites.length))
          )
            fail("GRAPH", "invalid debug variable");
        }
        for (const binding of debug.slots) {
          if (binding === undefined) fail("GRAPH", "missing slot binding");
          if (
            !natural(binding.slot) ||
            binding.slot >= f.slots.length ||
            !natural(binding.variable) ||
            binding.variable >= debug.variables.length
          )
            fail("GRAPH", "invalid slot binding");
        }
        for (const binding of debug.values) {
          if (binding === undefined) fail("GRAPH", "missing value binding");
          if (
            !natural(binding.value) ||
            !Number.isInteger(binding.after) ||
            binding.after < -1 ||
            !natural(binding.variable) ||
            binding.variable >= debug.variables.length
          )
            fail("GRAPH", "invalid value binding");
        }
      }
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
      if (
        f.scriptEntry === true &&
        (f.import === true ||
          f.exported ||
          f.receiverSlot !== undefined ||
          f.parameters.length !== 4 ||
          f.slots[f.parameters[0] ?? -1] !== "general" ||
          f.slots[f.parameters[1] ?? -1] !== "general" ||
          f.slots[f.parameters[2] ?? -1] !== "general" ||
          f.slots[f.parameters[3] ?? -1] !== "optional-reference" ||
          f.returnType !== "general")
      )
        fail(
          "TYPE",
          "invalid JavaScript entry header " +
            f.name +
            " " +
            f.parameters.map((slot) => f.slots[slot]).join(",") +
            " -> " +
            f.returnType +
            (f.exported ? " (exported)" : ""),
        );
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
      const safeSlots = f.safeIntegerSlots ?? [],
        safeBounds = f.safeIntegerBounds ?? [];
      if (safeSlots.length !== safeBounds.length)
        fail("GRAPH", "safe integer slots need one bound each");
      let previousSafe = -1;
      for (let index = 0; index < safeSlots.length; index++) {
        const slot = safeSlots[index],
          bound = safeBounds[index];
        if (
          slot === undefined ||
          !natural(slot) ||
          slot <= previousSafe ||
          f.slots[slot] !== "number" ||
          params[slot] === 1 ||
          slot === receiverSlot ||
          (f.integerSlots ?? []).includes(slot) ||
          bound === undefined ||
          !Number.isSafeInteger(bound) ||
          bound < 0
        )
          fail(
            "GRAPH",
            "safe integer slots must be ascending local number slots with safe bounds",
          );
        previousSafe = slot ?? previousSafe;
      }
      let previousNonzero = -1;
      for (const slot of f.nonzeroSlots ?? []) {
        if (
          slot === undefined ||
          !natural(slot) ||
          slot <= previousNonzero ||
          f.slots[slot] !== "number" ||
          params[slot] === 1 ||
          slot === receiverSlot
        )
          fail("GRAPH", "nonzero slots must be ascending local number slots");
        previousNonzero = slot ?? previousNonzero;
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
    for (const header of module.functions) {
      if (header === undefined) fail("GRAPH", "missing function");
      const f = readBody(header);
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
        origin(b.terminator.inline, f.debug);
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
          origin(op.inline, f.debug);
          switch (op.kind) {
            case "record-read": {
              hasRecordReads = true;
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
            case "general-is":
              equal(use(op.value), "general");
              if (
                op.type !== "undefined" &&
                op.type !== "number" &&
                op.type !== "boolean" &&
                op.type !== "string" &&
                op.type !== "null" &&
                op.type !== "Uint8Array" &&
                op.type !== "Uint16Array" &&
                op.type !== "Uint32Array" &&
                op.type !== "Float64Array" &&
                op.type !== "object"
              )
                fail("TYPE", "general test requires a known category");
              define(op.id, "boolean");
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
                op.type !== "reference" &&
                op.type !== "Uint8Array" &&
                op.type !== "Uint16Array" &&
                op.type !== "Uint32Array" &&
                op.type !== "Float64Array"
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
            case "string-reference":
              equal(use(op.value), "optional-string");
              define(op.id, "optional-reference");
              break;
            case "reference-string":
              equal(use(op.value), "optional-reference");
              define(op.id, "optional-string");
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
                    field.stateOffset === undefined &&
                    field.deferred !== true
                  )
                    fail("TYPE", "required record field cannot be omitted");
                } else equal(use(arg), field.type);
              }
              define(op.id, "reference");
              break;
            }
            case "error-new":
              if (
                op.error !== "TypeError" &&
                op.error !== "RangeError" &&
                op.error !== "Error"
              )
                fail("TYPE", "invalid error brand");
              equal(use(op.message), "string");
              define(op.id, "reference");
              break;
            case "error-is":
              if (
                op.error !== "TypeError" &&
                op.error !== "RangeError" &&
                op.error !== "Error"
              )
                fail("TYPE", "invalid error brand");
              equal(use(op.value), "general");
              define(op.id, "boolean");
              break;
            case "error-message":
              equal(use(op.value), "reference");
              define(op.id, "string");
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
            case "c-call": {
              const types = foreignCallTypes(op.call);
              if (!types.ok) fail("TYPE", "invalid c-call: " + types.error);
              const parameters = types.value.parameters;
              if (parameters.length !== op.arguments.length)
                fail("TYPE", "c-call argument count mismatch");
              for (let index = 0; index < op.arguments.length; index++) {
                const argument = op.arguments[index],
                  parameter = parameters[index];
                if (argument === undefined || parameter === undefined)
                  fail("TYPE", "c-call argument invariant");
                equal(use(argument), parameter);
              }
              const resultType = types.value.result;
              if (resultType === "void") {
                if (op.id !== undefined)
                  fail("TYPE", "void c-call has a result");
              } else {
                if (op.id === undefined)
                  fail("TYPE", "c-call result is missing");
                define(op.id, resultType);
              }
              break;
            }
            case "c-memory": {
              const types = foreignMemoryTypes(op.access);
              if (!types.ok) fail("TYPE", "invalid c-memory: " + types.error);
              const parameters = types.value.parameters;
              if (parameters.length !== op.arguments.length)
                fail("TYPE", "c-memory argument count mismatch");
              for (let index = 0; index < op.arguments.length; index++) {
                const argument = op.arguments[index],
                  parameter = parameters[index];
                if (argument === undefined || parameter === undefined)
                  fail("TYPE", "c-memory argument invariant");
                equal(use(argument), parameter);
              }
              const resultType = types.value.result;
              if (resultType === "void") {
                if (op.id !== undefined)
                  fail("TYPE", "c-memory store has a result");
              } else {
                if (op.id === undefined)
                  fail("TYPE", "c-memory result is missing");
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
                  "min",
                  "max",
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
              const scriptArguments =
                op.kind === "call-indirect" ? op.scriptArguments : undefined;
              if (
                (target.scriptEntry === true) !==
                (scriptArguments !== undefined)
              )
                fail("TYPE", "JavaScript entry requires a JavaScript call");
              if (scriptArguments !== undefined && op.receiver !== undefined)
                fail(
                  "TYPE",
                  "JavaScript calls take the receiver in the header",
                );
              for (const argument of scriptArguments ?? []) {
                if (argument === undefined)
                  fail("TYPE", "missing actual argument");
                equal(use(argument), "general");
              }
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
              if (
                op.kind === "call-indirect" &&
                op.discardResult &&
                returnType !== "void"
              )
                fail("TYPE", "discarded call result requires a void witness");
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
            case "script-argument-count":
            case "script-argument-area":
              if (f.scriptEntry !== true)
                fail("TYPE", "argument storage requires a JavaScript entry");
              define(op.id, "number");
              break;
            case "script-argument": {
              const frame = op.frame;
              if (frame === undefined && f.scriptEntry !== true)
                fail("TYPE", "actual arguments require a JavaScript entry");
              if (frame !== undefined) {
                equal(use(frame.count), "number");
                equal(use(frame.registers), "number");
                equal(use(frame.stack), "number");
              }
              equal(use(op.index), "number");
              define(op.id, "general");
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
    releaseBody();
    if (!hasRecordReads) return { ok: true };
    const stableLayouts = stableDescriptors(module, bodies);
    for (const header of module.functions) {
      if (header === undefined) throw "record proof function invariant";
      const fn = readBody(header);
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
            proofs = provenRecordReads(fn, verifierRecordWork, stableLayouts);
          }
          if (proofs === undefined || proofs[op.id] !== 1)
            fail("TYPE", "record read lacks a proven layout");
        }
      }
    }
  } catch (error) {
    if (error !== abort) throw error;
  } finally {
    releaseBody();
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
