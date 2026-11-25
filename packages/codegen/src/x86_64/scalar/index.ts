import {
  nativeFunctionByteLength,
  nativeFunctionEntryOffset,
  nativeFunctionEnvironmentOffset,
  nativeFunctionReservedOffset,
  nativeFunctionSignatureOffset,
  nativeSignatureHeaderByteLength,
  nativeSignatureParameterByteLength,
  nativeSignatureVersion,
} from "@tint/abi/function";
import {
  classifySysVCCall as classifyCCall,
  linuxX86_64CTarget,
  type SysVCallLayout as CCallLayout,
} from "@tint/abi/c/sysv";
import {
  nativeActivationCalleeOffset,
  nativeActivationCountOffset,
  nativeActivationFrameOffset,
  nativeActivationTopOffset,
  nativeArrayDataOffset,
  nativeArrayInlineOffset,
  nativeArrayLengthOffset,
  nativeArrayOwnerOffset,
  nativeArrayViewByteLength,
  nativeHeaderFlagsShift,
  nativeHeaderFlagUnit,
  nativeStringDataOffset,
  nativeStringLengthOffset,
  nativeCStackReserveBytes,
  nativeGenerationalLargeObjectOffset,
  nativeGenerationalNurseryAddressOffset,
  nativeStackMapFooterMagic,
  nativeStackMapRegistryOffset,
  nativeStackLimitOffset,
  nativeStackOverflowPayload,
  nativeWorkerStopObserved,
  nativeWorkerStopPayload,
  nativeWorkerStopPointerOffset,
  nativeWorkerStopRequested,
  type PosixHostFacts,
} from "@tint/abi/host";
import {
  nativeWeakSlotByteLength,
  nativeWeakSlotKeyOffset,
  nativeWeakSlotMarker,
  nativeWeakSlotValueOffset,
} from "@tint/abi/weak-slot";
import type { ImageAddressTarget } from "@tint/abi/relocation";
import {
  encodeFloat64,
  writeUnsigned,
  writeWord64,
} from "@tint/foundation/binary/bytes";
import type { Word64 } from "@tint/foundation/binary/word64";
import {
  instructionResult,
  optionalNumberAbsentHigh,
  optionalNumberAbsentLow,
  scalarByteLength,
  trackedManagedWrites,
  verify,
  type Block,
  type FunctionIR,
  type GeneralTest,
  type Instruction,
  type ModuleIR,
  type RecordField,
  type RecordLayout,
  type ScalarType,
  type Span,
  type Terminator,
} from "@tint/ir/scalar";
import {
  createAssembler,
  patchRelative,
  type RelativeFixup,
  type Address,
  type Gpr,
  type Memory,
} from "../isa.ts";
import type { UnwindRange } from "@tint/abi/unwind";
import {
  collectionAfter,
  collectionBefore,
  collectionMetricBytes,
  collectionProbeArguments,
  createProbeEmission,
  type X64Probe,
  type X64SignpostSite,
} from "../probes.ts";
import {
  dwarfFramePointer,
  dwarfStackPointer,
  frameRows,
  frameSave,
  returnSave,
  resolveUnwind,
  type LabeledUnwind,
} from "../unwind.ts";
import {
  allocationStateOffset,
  allocatorEntryOffset,
  allocatorEnvironmentOffset,
  bits,
  byte,
  contextBytes,
  gpr,
  heapCursorOffset,
  heapEndOffset,
  hostedThreadEntryLabel,
  rip,
  imm,
  imageRelocations,
  label,
  managedBaseOffset,
  managedLengthOffset,
  mem,
  normal,
  resultBytes,
  resultPayload,
  thrown,
  setBoolean,
  word,
  xmm,
  type Emit,
  type ImageRelocations,
} from "./machine.ts";
import {
  emitSysVCall,
  emitSysVDynamicCall,
  emitSysVMemory,
  sysVDynamicStackBytes,
  type CallSite,
  type ForeignTransition,
  sysVOutgoingBytes,
  sysVStagingBytes,
} from "./foreign.ts";
import { branch, emitHostCall, exactInteger } from "./host.ts";
import {
  beginTransition,
  endTransition,
  callbackKeyLabel,
  callbackThunksLabel,
  callbackThunkKey,
  emitCallbackThunk,
  planTransition,
  type CallbackThunk,
  type TransitionPlan,
} from "./callbacks.ts";
import { createNumberEmission, floatBits } from "./numbers.ts";
import { nativeSignatureTypeCode } from "../../scalar/signature.ts";
import { emitExecutableMemory, serializeCode } from "./executable-memory.ts";
import {
  bindManagedABI,
  type ManagedABIRequest,
  type NativeManagedPointerImport,
} from "../../scalar/managed-abi.ts";
import {
  planWideStackMapTable,
  rootHeadBinding,
  type SafepointEntry,
  type WideStackMapPlan,
} from "../../scalar/stack-maps.ts";
import {
  frameStackMaps,
  isRootType,
  type PendingSafepoint,
} from "./stack-maps.ts";

export {
  imageRelocations,
  x64AddressPatcher,
  x64ModulePatcher,
} from "./machine.ts";
export { appendExitEntry } from "./exit-entry.ts";
export type { X64SignpostSite } from "../probes.ts";

export interface X64Function {
  readonly import?: true;
  readonly id: number;
  readonly name: string;
  readonly offset: number;
  readonly byteLength: number;
  readonly frame?: X64DebugFrame;
}
interface X64DebugFrame {
  readonly offset: number;
  readonly byteLength: number;
  readonly parameters: readonly X64DebugParameter[];
}
interface X64DebugParameter extends Span {
  readonly name: string;
  readonly type: "number" | "boolean";
  readonly frameOffset: number;
}
interface X64SourceRange extends Span {
  readonly offset: number;
  readonly byteLength: number;
}
export interface X64Module extends ImageRelocations {
  readonly code: Uint8Array;
  readonly data: Uint8Array;
  readonly functions: readonly X64Function[];
  readonly imports: readonly string[];
  readonly hostedThreadFixups: readonly RelativeFixup[];
  readonly far: boolean;
  readonly linearAllocation: boolean;
  readonly generationalBarriers: boolean;
  readonly managedImports: readonly NativeManagedPointerImport[];
  readonly managedFixups: readonly X64ManagedReference[];
  readonly liveSlotOffset?: number;
  readonly jitDebug?: {
    readonly descriptorOffset: number;
    readonly registerOffset: number;
  };
  readonly signatures: readonly X64Signature[];
  readonly records: readonly X64Record[];
  readonly functionDescriptor?: X64Record;
  readonly unwind: readonly UnwindRange[];
  readonly sourceRanges: readonly X64SourceRange[];
  readonly probes: readonly X64Probe[];
  readonly callbackKeyOffset?: number;
  readonly stackMaps: readonly {
    readonly codeOffset: number;
    readonly codeLength: number;
    readonly tableOffset: number;
  }[];
}
interface X64Signature {
  readonly functions: readonly number[];
  readonly offset: number;
  readonly parameters: readonly ScalarType[];
  readonly returnType: ScalarType | "void";
}
interface X64Record {
  readonly record: number;
  readonly offset: number;
}
export interface X64ManagedReference {
  readonly fixup: RelativeFixup;
  readonly import: number;
}
export interface X64ManagedOptions {
  readonly mode: "service" | "live";
  readonly bindings?: ManagedABIRequest;
  readonly functions: readonly number[];
  readonly records: readonly number[];
  /** Standalone managed units linked without an ELF GOT inline byte helpers. */
  readonly inlineBytes?: boolean;
}
export interface X64Diagnostic {
  readonly code: "INVALID_IR" | "UNSUPPORTED" | "FRAME_LIMIT" | "ENCODING";
  readonly message: string;
  readonly function: number | undefined;
  readonly block: number | undefined;
  readonly span: Span | undefined;
}
export type X64Emission =
  | { readonly ok: true; readonly value: X64Module }
  | { readonly ok: false; readonly error: X64Diagnostic };

interface Argument {
  readonly slot: number;
  readonly type: ScalarType;
  readonly kind: "integer" | "float" | "stack";
  readonly index: number;
}

const rax = gpr(0);
const eax = word(0);
const rsp = gpr(4);
const rbp = gpr(5);
const context = gpr(7);
const environment = gpr(6);
const receiver = gpr(2);
const result = gpr(1);
const scratch = gpr(11);
const trapLabel = "trap";
const clearAllocationLabel = "clear-allocation";
const rememberLabel = "remember-old-object";

type ElementBytes = 1 | 2 | 4 | 8;
function arrayWidth(type: ScalarType): ElementBytes {
  if (type === "Uint8Array") return 1;
  if (type === "Uint16Array") return 2;
  if (type === "Uint32Array") return 4;
  if (type === "Float64Array") return 8;
  throw "typed array width invariant";
}
function arrayMarker(width: ElementBytes): number {
  return width === 8 ? 5 : width === 4 ? 4 : width === 2 ? 3 : 2;
}
function typedArrayMarker(type: ScalarType | GeneralTest): number {
  return type === "Uint8Array"
    ? 2
    : type === "Uint16Array"
      ? 3
      : type === "Uint32Array"
        ? 4
        : type === "Float64Array"
          ? 5
          : 0;
}
function generalTag(type: string): number {
  return type === "number"
    ? 1
    : type === "boolean"
      ? 2
      : type === "string"
        ? 3
        : 5;
}
function align16(bytes: number): number {
  return Math.ceil(bytes / 16) * 16;
}
function frame(offset: number): Memory<64> {
  return mem(5, offset);
}
function functionLabel(id: number): string {
  return "function:" + String(id);
}
function blockLabel(id: number, block: number): string {
  return functionLabel(id) + ":block:" + String(block);
}
function argumentLayout(fn: FunctionIR): Argument[] {
  const args: Argument[] = [];
  let general = 8,
    float = 0,
    stack = 0;
  for (const slot of fn.parameters) {
    if (slot === undefined) throw "parameter slot invariant";
    const type = fn.slots[slot];
    if (type === undefined) throw "parameter type invariant";
    if (type === "number" && float < 8)
      args.push({ slot, type, kind: "float", index: float++ });
    else if (type !== "number" && general < 10)
      args.push({ slot, type, kind: "integer", index: general++ });
    else {
      args.push({ slot, type, kind: "stack", index: stack });
      stack += 8;
    }
  }
  return args;
}
function copy(emit: Emit, from: Memory<64>, to: Memory<64>): void {
  emit({ op: "mov", dst: rax, src: from });
  emit({ op: "mov", dst: to, src: rax });
}

export function emitModule(
  module: ModuleIR,
  host?: PosixHostFacts,
  generational: boolean = false,
  inlineAllocation: boolean = true,
  debugSpans: boolean = false,
  signposts: readonly X64SignpostSite[] = [],
  allocationProbes: boolean = false,
  far: boolean = false,
  managed?: X64ManagedOptions,
  jitDebug: boolean = false,
  workerFunctions?: ReadonlySet<string>,
  /** See trustedExecutableCode in the arm64 emitter's options. */
  trustedExecutableCode: boolean = false,
): X64Emission {
  const verified = verify(module);
  if (!verified.ok)
    return {
      ok: false,
      error: {
        code: "INVALID_IR",
        message: verified.error.message,
        function: verified.error.function,
        block: verified.error.block,
        span: undefined,
      },
    };
  const scriptEntry = module.functions.find((fn) => fn?.scriptEntry === true);
  if (scriptEntry !== undefined)
    return {
      ok: false,
      error: {
        code: "UNSUPPORTED",
        message: "x86-64 scalar: native JavaScript entry ABI",
        function: scriptEntry.id,
        block: undefined,
        span: undefined,
      },
    };

  let functionId: number | undefined;
  let blockId: number | undefined;
  let span: Span | undefined;
  let failure: X64Diagnostic | undefined;
  function fail(code: X64Diagnostic["code"], message: string): never {
    failure = {
      code,
      message: "x86-64 scalar: " + message,
      function: functionId,
      block: blockId,
      span,
    };
    throw message;
  }

  const assembler = createAssembler(far);
  let instructionCount = 0;
  const unwind: LabeledUnwind[] = [];
  const sourceLabels: { readonly name: string; readonly span: Span }[] = [];
  const debugFrames = new Map<number, readonly X64DebugParameter[]>();
  const pendingMaps: PendingSafepoint[] = [];
  const emit: Emit = (insn) => {
    assembler.instruction(insn);
    instructionCount++;
  };
  const policy = host?.signposts;
  const probes = createProbeEmission(
    emit,
    policy?.kind === "elf-usdt" ? policy.provider : "tint",
  );
  function markSource(span: Span): void {
    if (!debugSpans) return;
    const name = "source:" + String(sourceLabels.length);
    emit({ op: "label", name });
    sourceLabels.push({ name, span });
  }
  const numbers = createNumberEmission(emit);
  const constants: Word64[] = [];
  const strings = new Map<
    string,
    { readonly value: string; readonly offset: number }
  >();
  const descriptors = new Map<
    string,
    { readonly offset: number; readonly words: readonly number[] }
  >();
  let poolBytes = 0;
  const live = managed?.mode === "live";
  const debugDescriptor = "tint:jit-debug-descriptor";
  const debugRegister = "tint:jit-debug-register";
  function poolWords(name: string, words: readonly number[]): void {
    descriptors.set(name, { offset: poolBytes, words });
    poolBytes += words.length * 8;
  }
  const abiRequests: NativeManagedPointerImport[] = [];
  const entryImports = new Map<number, number>();
  const signatureImports = new Map<number, number>();
  const recordImports = new Map<number, number>();
  const managedNames = new Map<string, number>();
  const recordNames = new Map<number, string>();
  const signatureMembers = new Map<string, number[]>();
  let brand: number | undefined;
  function importedAddress(index: number): Memory<64> {
    const name = "managed:" + String(index);
    if (!managedNames.has(name)) {
      managedNames.set(name, index);
      poolWords(name, [0]);
    }
    return rip(name);
  }
  function address(dst: Gpr<64>, source: Memory<64>): void {
    const from = source.address;
    if (live && from.kind === "rip") {
      const ref = from.disp;
      if (typeof ref !== "number" && managedNames.has(ref.label)) {
        emit({ op: "mov", dst, src: source });
        return;
      }
    }
    emit({ op: "lea", dst, src: source });
  }
  function functionAddress(id: number): Memory<64> {
    const imported = entryImports.get(id);
    return imported === undefined
      ? rip(functionLabel(id))
      : importedAddress(imported);
  }
  const functionRecord = module.records?.length ?? 0;
  const functionLayout: RecordLayout = {
    byteLength: nativeFunctionByteLength,
    fields: [
      {
        offset: nativeFunctionEnvironmentOffset,
        type: "optional-reference",
        mutable: false,
      },
    ],
  };
  const errorRecord = functionRecord + 1;
  const errorLayout: RecordLayout = {
    byteLength: 16,
    fields: [{ offset: 8, type: "string", mutable: false }],
  };
  function descriptor(record: number): Memory<64> {
    const imported =
      record === functionRecord ? brand : recordImports.get(record);
    if (imported !== undefined) return importedAddress(imported);
    const name = "record:" + String(record);
    if (!descriptors.has(name)) {
      const layout =
        record === functionRecord
          ? functionLayout
          : record >= errorRecord
            ? errorLayout
            : module.records?.[record];
      if (layout === undefined) throw "x86-64 record layout invariant";
      const references: number[] = [];
      const generals: number[] = [];
      for (const field of layout.fields) {
        if (field === undefined) throw "x86-64 record field invariant";
        if (field.type === "general") generals.push(field.offset);
        else if (isRootType(field.type)) references.push(field.offset);
      }
      const words = [layout.byteLength, references.length];
      for (const offset of references)
        if (offset !== undefined) words.push(offset);
      words.push(generals.length);
      for (const offset of generals)
        if (offset !== undefined) words.push(offset);
      poolWords(name, words);
      if (managed !== undefined) recordNames.set(record, name);
    }
    return rip(name);
  }
  function literal(value: string): Memory<64> {
    const name = "literal:" + value;
    if (!strings.has(name)) {
      strings.set(name, { value, offset: poolBytes });
      poolBytes +=
        Math.ceil((nativeStringDataOffset + value.length * 2) / 8) * 8;
    }
    return rip(name);
  }
  const external = new Map<string, ImageAddressTarget>();
  const imports = new Set<string>();
  const callbackThunks = new Map<string, CallbackThunk>();
  let needsCallbackKey = false;
  function thunkAddress(thunk: CallbackThunk): Memory<64> {
    const name = callbackThunksLabel + ":" + callbackThunkKey(thunk);
    callbackThunks.set(name, thunk);
    needsCallbackKey = true;
    return rip(name);
  }
  const collectorWorker = "tint:collector-worker-entry";
  let needsCollectorWorker = false;
  function importSlot(symbol: string): Memory<64> {
    imports.add(symbol);
    const key = "import:" + symbol;
    external.set(key, { kind: "import", name: symbol });
    return rip(key);
  }
  function foreign(symbol: string): void {
    emit({ op: "call", target: importSlot(symbol) });
  }
  /** Live code and standalone service units have no ELF GOT. Use the same
   * caller-clobbered operands as the libc leaves for overlapping moves and
   * byte equality. */
  function bytesOperation(symbol: string): void {
    if (!live && managed?.inlineBytes !== true) {
      foreign(symbol);
      return;
    }
    const dst = gpr(7),
      src = gpr(6),
      left = gpr(2);
    const site = "live-bytes:" + String(instructionCount);
    const done = site + ":done",
      loop = site + ":loop";
    const destination: Memory<8> = { ...mem(7, 0), width: 8 };
    const source: Memory<8> = { ...mem(6, 0), width: 8 };
    emit({ op: "xor", dst: eax, src: eax });
    emit({ op: "test", dst: left, src: left });
    branch(emit, "e", done);
    if (symbol === (host?.symbolPrefix ?? "") + "memcmp") {
      emit({ op: "label", name: loop });
      emit({ op: "mov", dst: byte(0), src: destination });
      emit({ op: "sub", dst: byte(0), src: source });
      branch(emit, "ne", done);
      emit({ op: "add", dst, src: imm(1) });
      emit({ op: "add", dst: src, src: imm(1) });
      emit({ op: "sub", dst: left, src: imm(1) });
      branch(emit, "ne", loop);
    } else {
      const reverse = site + ":reverse";
      emit({ op: "cmp", dst, src });
      branch(emit, "a", reverse);
      emit({ op: "label", name: loop });
      emit({ op: "mov", dst: byte(0), src: source });
      emit({ op: "mov", dst: destination, src: byte(0) });
      emit({ op: "add", dst, src: imm(1) });
      emit({ op: "add", dst: src, src: imm(1) });
      emit({ op: "sub", dst: left, src: imm(1) });
      branch(emit, "ne", loop);
      emit({ op: "jmp", target: label(done) });
      emit({ op: "label", name: reverse });
      emit({ op: "sub", dst: left, src: imm(1) });
      const from: Memory<8> = {
        kind: "mem",
        width: 8,
        address: { kind: "base", base: 6, index: 2, disp: 0 },
      };
      const to: Memory<8> = {
        kind: "mem",
        width: 8,
        address: { kind: "base", base: 7, index: 2, disp: 0 },
      };
      emit({ op: "mov", dst: byte(0), src: from });
      emit({ op: "mov", dst: to, src: byte(0) });
      branch(emit, "ne", reverse);
    }
    emit({ op: "label", name: done });
  }

  const argumentsByFunction: Argument[][] = [];

  const signatures: { parameters: string; name: string }[] = [];
  const discardSignatures = new Map<string, Set<string>>();
  function signature(target: number): Memory<64> {
    const imported = signatureImports.get(target);
    if (imported !== undefined) return importedAddress(imported);
    const fn = module.functions[target];
    const args = argumentsByFunction[target];
    const shape = signatures[target];
    if (fn === undefined || args === undefined || shape === undefined)
      throw "x86-64 signature invariant";
    if (!descriptors.has(shape.name)) {
      const words = [
        nativeSignatureVersion,
        nativeSignatureHeaderByteLength +
          args.length * nativeSignatureParameterByteLength,
        args.length,
        nativeSignatureTypeCode(fn.returnType),
      ];
      for (const arg of args)
        if (arg !== undefined) words.push(nativeSignatureTypeCode(arg.type));
      poolWords(shape.name, words);
    }
    if (managed !== undefined) {
      let members = signatureMembers.get(shape.name);
      if (members === undefined) {
        members = [];
        signatureMembers.set(shape.name, members);
      }
      if (!members.includes(target)) members.push(target);
    }
    return rip(shape.name);
  }

  function constant(value: number): Memory<64> {
    const bits = encodeFloat64(value);
    const key = "constant:" + String(bits.hi) + ":" + String(bits.lo);
    if (!external.has(key)) {
      external.set(key, { kind: "data", offset: constants.length * 8 });
      constants.push(bits);
    }
    return {
      kind: "mem",
      width: 64,
      address: { kind: "rip", disp: label(key) },
    };
  }

  function body(fn: FunctionIR): void {
    const fnLabel = functionLabel(fn.id);
    const interruptible =
      workerFunctions?.has(
        fn.name.endsWith("$direct") ? fn.name.slice(0, -7) : fn.name,
      ) === true;
    const fnEnd = fnLabel + ":end";
    const done = fnLabel + ":return";
    const slots: number[] = [];
    const homes = new Map<number, number>();
    const types = new Map<number, ScalarType>();
    const savedContext = -8,
      savedResult = -16;
    const callResult = savedResult - resultBytes;
    const savedEnvironment =
      fn.environment !== undefined || fn.closureEnvironment !== undefined
        ? callResult - 8
        : undefined;
    const savedAllocationSize = (savedEnvironment ?? callResult) - 8;
    const signpost = signposts.find(
      (site) => site !== undefined && site.name === fn.name,
    );
    let depth = -(generational
      ? savedAllocationSize
      : (savedEnvironment ?? callResult));
    let outgoing = 0;
    let needsForeign = false;
    let needsExecutableMemory = false;
    let transitionCapacity = 0;
    const transitions = new Map<Instruction, TransitionPlan>();
    const plans = new Map<Instruction, CCallLayout>();
    for (const type of fn.slots) {
      if (type === undefined) throw "slot layout invariant";
      depth += scalarByteLength(type);
      slots.push(-depth);
    }
    for (const block of fn.blocks) {
      if (block === undefined) throw "block invariant";
      for (const op of block.instructions) {
        if (op === undefined) throw "instruction invariant";
        const id = instructionResult(op);
        if (id !== undefined) {
          // Every home can hold a complete two-word scalar. Compact layout
          // and reuse across liveness ranges are later optimizations.
          depth += 16;
          homes.set(id, -depth);
        }
        if (op.kind === "c-call") {
          if (op.call.mayCallback === true) {
            const transition = planTransition(op.call);
            transitions.set(op, transition);
            transitionCapacity = Math.max(transitionCapacity, transition.bytes);
          }
          const layout = classifyCCall(op.call.signature, linuxX86_64CTarget);
          if (!layout.ok) fail("UNSUPPORTED", layout.error);
          plans.set(op, layout.value);
          outgoing = Math.max(
            outgoing,
            op.call.dynamic === true
              ? sysVDynamicStackBytes
              : sysVOutgoingBytes(layout.value),
          );
          needsForeign = true;
        }
        if (
          op.kind === "host-call" &&
          (op.operation === "executable-map" ||
            op.operation === "executable-write")
        )
          needsExecutableMemory = true;
        if (op.kind === "call" || op.kind === "call-indirect") {
          const args = argumentsByFunction[op.target];
          if (args === undefined) throw "call layout invariant";
          for (const arg of args)
            if (arg?.kind === "stack")
              outgoing = Math.max(outgoing, arg.index + 8);
        }
      }
    }
    if (transitionCapacity !== 0) depth = align16(depth) + transitionCapacity;
    const transitionOffset = -depth;
    if (signpost !== undefined && signpost.metrics === true)
      depth += collectionMetricBytes;
    const metricOffset = -depth;
    if (needsExecutableMemory) depth += 7 * 8;
    const executableHomes = -depth;
    const staging = -(depth + sysVStagingBytes);
    const frameBytes = align16(
      depth + (needsForeign ? sysVStagingBytes : 0) + outgoing,
    );
    if (
      frameBytes + (host === undefined ? 0 : nativeCStackReserveBytes + 8) >=
      0x80000000
    )
      fail("FRAME_LIMIT", "frame exceeds signed displacement");
    function slot(id: number): number {
      const offset = slots[id];
      if (offset === undefined) throw "slot invariant";
      return offset;
    }
    function metric(offset: number): Memory<64> {
      return frame(metricOffset + offset);
    }
    function interval(site: X64SignpostSite, ending: boolean): void {
      const alternate = site.alternate;
      const parameter = site.parameter;
      if (alternate === undefined || parameter === undefined) {
        probes.interval(site.interval, ending);
        return;
      }
      const arg = fn.parameters[parameter];
      if (arg === undefined) throw "x86-64 probe argument invariant";
      const useAlternate =
        fnLabel + ":probe-alternate:" + String(instructionCount);
      const next = useAlternate + ":next";
      emit({ op: "cmp", dst: frame(slot(arg)), src: imm(0) });
      branch(emit, "e", useAlternate);
      probes.interval(site.interval, ending);
      emit({ op: "jmp", target: label(next) });
      emit({ op: "label", name: useAlternate });
      probes.interval(alternate, ending);
      emit({ op: "label", name: next });
    }
    function home(id: number): number {
      const offset = homes.get(id);
      if (offset === undefined) throw "value home invariant";
      return offset;
    }
    function typeOf(id: number): ScalarType {
      const type = types.get(id);
      if (type === undefined) throw "value type invariant";
      return type;
    }
    function copyFrame(from: number, to: number, bytes: number): void {
      for (let offset = 0; offset < bytes; offset += 8)
        copy(emit, frame(from + offset), frame(to + offset));
    }
    function define(id: number, type: ScalarType): void {
      types.set(id, type);
      emit({ op: "mov", dst: frame(home(id)), src: rax });
    }
    function publish(state: number, from: number, bytes: number): void {
      emit({ op: "mov", dst: scratch, src: frame(savedResult) });
      for (let offset = 0; offset < bytes; offset += 8)
        copy(emit, frame(from + offset), mem(11, resultPayload + offset));
      emit({ op: "mov", dst: mem(11, 0), src: imm(state) });
      emit({ op: "mov", dst: eax, src: imm(state) });
      emit({ op: "jmp", target: label(done) });
    }
    function raise(block: Block, from: number): void {
      const handler = block.exception;
      if (handler === undefined) publish(thrown, from, 16);
      else {
        if (interruptible) {
          const ordinary =
            fnLabel + ":ordinary-throw:" + String(instructionCount);
          emit({ op: "cmp", dst: frame(from), src: imm(0) });
          branch(emit, "ne", ordinary);
          emit({
            op: "cmp",
            dst: frame(from + 8),
            src: imm(nativeWorkerStopPayload),
          });
          branch(emit, "ne", ordinary);
          publish(thrown, from, 16);
          emit({ op: "label", name: ordinary });
        }
        copyFrame(from, slot(handler.slot), 16);
        emit({ op: "jmp", target: label(blockLabel(fn.id, handler.target)) });
      }
    }
    function pollWorkerStop(): void {
      if (!interruptible) return;
      const resumed = fnLabel + ":worker-resumed:" + String(instructionCount);
      emit({ op: "mov", dst: scratch, src: frame(savedContext) });
      emit({
        op: "mov",
        dst: scratch,
        src: mem(11, nativeStackMapRegistryOffset),
      });
      emit({
        op: "mov",
        dst: scratch,
        src: mem(11, nativeWorkerStopPointerOffset),
      });
      emit({ op: "test", dst: scratch, src: scratch });
      branch(emit, "e", resumed);
      // Aligned loads and stores on x86 have acquire and release ordering.
      emit({ op: "cmp", dst: mem(11, 0), src: imm(nativeWorkerStopRequested) });
      branch(emit, "ne", resumed);
      emit({ op: "mov", dst: mem(11, 0), src: imm(nativeWorkerStopObserved) });
      emit({ op: "mov", dst: frame(callResult), src: imm(0) });
      emit({
        op: "mov",
        dst: frame(callResult + 8),
        src: imm(nativeWorkerStopPayload),
      });
      publish(thrown, callResult, 16);
      emit({ op: "label", name: resumed });
    }

    const callSites: {
      block: number;
      index: number;
      label: string;
      transitionRoots?: readonly number[];
    }[] = [];
    const ownRootHead = host !== undefined && rootHeadBinding(fn);
    function safepoint(
      block: Block,
      index: number,
      at?: string,
      transitionRoots?: readonly number[],
    ): void {
      if (host === undefined) return;
      const name = at ?? fnLabel + ":safepoint:" + String(callSites.length);
      emit({ op: "label", name });
      callSites.push({
        block: block.id,
        index,
        label: name,
        ...(transitionRoots === undefined ? {} : { transitionRoots }),
      });
    }

    const r10 = gpr(10),
      rdx = gpr(2),
      r9 = gpr(9);
    const x0 = xmm(0);
    const absent = bits(optionalNumberAbsentLow, optionalNumberAbsentHigh);
    function call(op: Instruction, block: Block, index: number): void {
      if (op.kind !== "call" && op.kind !== "call-indirect")
        throw "call invariant";
      pollWorkerStop();
      const args = argumentsByFunction[op.target];
      const callee = module.functions[op.target];
      if (args === undefined || callee === undefined) throw "callee invariant";
      const imported = entryImports.get(op.target);
      if (callee.import === true && imported === undefined)
        fail("UNSUPPORTED", "unsupported managed import " + callee.name);
      if (op.kind === "call-indirect") {
        guardRecord(op.callee, functionRecord, trapLabel);
        emit({
          op: "mov",
          dst: rax,
          src: mem(9, nativeFunctionSignatureOffset),
        });
        address(scratch, signature(op.target));
        emit({ op: "cmp", dst: rax, src: scratch });
        if (op.discardResult === true && !signatureImports.has(op.target)) {
          const shape = signatures[op.target];
          if (shape === undefined) throw "discarded result signature invariant";
          const valid = fnLabel + ":signature:" + String(instructionCount);
          const matches = discardSignatures.get(shape.parameters);
          if (matches !== undefined)
            for (const match of matches) {
              if (match === undefined || match === shape.name) continue;
              branch(emit, "e", valid);
              emit({ op: "lea", dst: scratch, src: rip(match) });
              emit({ op: "cmp", dst: rax, src: scratch });
            }
          branch(emit, "ne", trapLabel);
          emit({ op: "label", name: valid });
        } else branch(emit, "ne", trapLabel);
        emit({
          op: "mov",
          dst: environment,
          src: mem(9, nativeFunctionEnvironmentOffset),
        });
        emit({ op: "mov", dst: r10, src: mem(9, nativeFunctionEntryOffset) });
      } else if (op.environment === "inherit") {
        if (savedEnvironment === undefined)
          throw "inherited environment invariant";
        emit({ op: "mov", dst: environment, src: frame(savedEnvironment) });
      } else emit({ op: "xor", dst: environment, src: environment });
      for (let i = 0; i < args.length; i++) {
        const arg = args[i],
          id = op.arguments[i];
        if (arg === undefined || id === undefined) throw "argument invariant";
        const source = frame(home(id));
        if (arg.kind === "float")
          emit({ op: "movsd", dst: xmm(arg.index), src: source });
        else {
          const dst = arg.kind === "integer" ? gpr(arg.index) : rax;
          if (scalarByteLength(arg.type) === 16)
            emit({ op: "lea", dst, src: source });
          else emit({ op: "mov", dst, src: source });
          if (arg.kind === "stack")
            emit({ op: "mov", dst: mem(4, arg.index), src: rax });
        }
      }
      emit({ op: "mov", dst: context, src: frame(savedContext) });
      if (op.receiver === undefined)
        emit({ op: "xor", dst: receiver, src: receiver });
      else emit({ op: "lea", dst: receiver, src: frame(home(op.receiver)) });
      emit({ op: "lea", dst: result, src: frame(callResult) });
      emit({ op: "mov", dst: frame(callResult), src: imm(0) });
      emit({ op: "mov", dst: frame(callResult + 8), src: imm(0) });
      if (op.kind === "call" && imported !== undefined)
        address(r10, importedAddress(imported));
      emit({
        op: "call",
        target:
          op.kind === "call-indirect" || imported !== undefined
            ? r10
            : label(functionLabel(op.target)),
      });
      safepoint(block, index);
      pollWorkerStop();
      const received = fnLabel + ":call:" + String(instructionCount);
      emit({ op: "cmp", dst: eax, src: imm(normal) });
      emit({ op: "jcc", cc: "e", target: label(received) });
      emit({ op: "cmp", dst: eax, src: imm(thrown) });
      emit({ op: "jcc", cc: "ne", target: label(trapLabel) });
      raise(block, callResult + resultPayload);
      emit({ op: "label", name: received });
      const returnType = callee.returnType;
      const id = op.id;
      if (id !== undefined && returnType !== "void") {
        copyFrame(
          callResult + resultPayload,
          home(id),
          scalarByteLength(returnType),
        );
        types.set(id, returnType);
      }
    }

    function numberBits(): void {
      emit({ op: "cvtsi2sd", dst: x0, src: rax });
      floatBits(emit, rax, x0);
    }
    function callExecutable(
      entry: Memory<64>,
      input: number | undefined,
      operation:
        | "executable-call-number"
        | "executable-call-value"
        | "executable-call-managed",
      id: number,
      block: Block,
      index: number,
    ): void {
      if (operation === "executable-call-managed") pollWorkerStop();
      serializeCode(emit);
      exactInteger(emit, entry, r10, trapLabel);
      emit({ op: "test", dst: r10, src: r10 });
      branch(emit, "le", trapLabel);
      emit({ op: "mov", dst: context, src: frame(savedContext) });
      emit({ op: "xor", dst: environment, src: environment });
      emit({ op: "xor", dst: receiver, src: receiver });
      emit({ op: "lea", dst: result, src: frame(callResult) });
      emit({ op: "mov", dst: frame(callResult), src: imm(0) });
      if (operation !== "executable-call-number") {
        if (input === undefined) throw "executable input invariant";
        const value = frame(home(input));
        if (operation === "executable-call-managed")
          emit({ op: "mov", dst: gpr(8), src: value });
        else emit({ op: "lea", dst: gpr(8), src: value });
      }
      emit({ op: "call", target: r10 });
      if (operation === "executable-call-managed") {
        safepoint(block, index);
        const received =
          fnLabel + ":executable-result:" + String(instructionCount);
        emit({ op: "cmp", dst: eax, src: imm(normal) });
        branch(emit, "e", received);
        emit({ op: "cmp", dst: eax, src: imm(thrown) });
        branch(emit, "ne", trapLabel);
        raise(block, callResult + resultPayload);
        emit({ op: "label", name: received });
      } else {
        emit({ op: "cmp", dst: eax, src: imm(normal) });
        branch(emit, "ne", trapLabel);
      }
      if (operation !== "executable-call-number")
        copy(emit, frame(callResult + resultPayload + 8), frame(home(id) + 8));
      emit({ op: "mov", dst: rax, src: frame(callResult + resultPayload) });
      define(id, operation === "executable-call-number" ? "number" : "general");
    }
    function allocationFailure(block: Block): void {
      emit({ op: "mov", dst: frame(callResult), src: imm(0) });
      emit({
        op: "mov",
        dst: rax,
        src: bits(
          nativeStackOverflowPayload % 4294967296,
          Math.floor(nativeStackOverflowPayload / 4294967296),
        ),
      });
      emit({ op: "mov", dst: frame(callResult + 8), src: rax });
      raise(block, callResult);
    }

    function callAllocator(block: Block, index: number, site: string): void {
      emit({ op: "mov", dst: context, src: frame(savedContext) });
      emit({
        op: "mov",
        dst: environment,
        src: mem(7, allocatorEnvironmentOffset),
      });
      emit({ op: "xor", dst: receiver, src: receiver });
      emit({ op: "lea", dst: result, src: frame(callResult) });
      emit({ op: "cvtsi2sd", dst: x0, src: r10 });
      if (allocationProbes) probes.interval("alloc.slow", false);
      emit({ op: "call", target: mem(7, allocatorEntryOffset) });
      safepoint(block, index);
      if (allocationProbes) probes.interval("alloc.slow", true);
      const received = site + ":allocator-returned";
      emit({ op: "cmp", dst: eax, src: imm(normal) });
      branch(emit, "e", received);
      emit({ op: "cmp", dst: eax, src: imm(thrown) });
      branch(emit, "ne", trapLabel);
      raise(block, callResult + resultPayload);
      emit({ op: "label", name: received });
    }

    /** R10 is the aligned allocation size. Only RAX survives, with the
     * cleared address. Constructors must reload movable arguments from homes. */
    function allocate(
      block: Block,
      index: number,
      site: string,
      denied: string,
    ): void {
      pollWorkerStop();
      emit({ op: "mov", dst: rdx, src: frame(savedContext) });
      const fits = site + ":fits";
      if (!generational) {
        emit({ op: "mov", dst: rax, src: mem(2, heapCursorOffset) });
        emit({
          op: "lea",
          dst: scratch,
          src: {
            kind: "mem",
            width: 64,
            address: { kind: "base", base: 0, index: 10, disp: 0 },
          },
        });
        emit({ op: "cmp", dst: scratch, src: mem(2, heapEndOffset) });
        branch(emit, "be", fits);
        emit({ op: "label", name: denied });
        allocationFailure(block);
        emit({ op: "label", name: fits });
        emit({ op: "mov", dst: mem(2, heapCursorOffset), src: scratch });
        return;
      }
      const slow = site + ":slow";
      const clear = site + ":clear";
      if (inlineAllocation) {
        // The allocator routes requests of at least the published threshold
        // directly to old space; match it before bumping.
        emit({ op: "mov", dst: scratch, src: mem(2, allocationStateOffset) });
        emit({
          op: "cmp",
          dst: word(10),
          src: { ...mem(11, nativeGenerationalLargeObjectOffset), width: 32 },
        });
        branch(emit, "ae", slow);
        // top + size against the limit: zero-extended uint32 offsets in
        // 64-bit registers, so a limit lowered below an in-flight top (a
        // debugger arming sampling) sends the next allocation to the slow
        // path instead of wrapping (docs/allocation-throughput.md).
        emit({ op: "mov", dst: eax, src: { ...mem(11, 4), width: 32 } });
        emit({ op: "mov", dst: word(9), src: { ...mem(11, 0), width: 32 } });
        emit({
          op: "lea",
          dst: gpr(8),
          src: {
            kind: "mem",
            width: 64,
            address: { kind: "base", base: 9, index: 10, disp: 0 },
          },
        });
        emit({ op: "cmp", dst: rax, src: gpr(8) });
        branch(emit, "b", slow);
        emit({ op: "mov", dst: { ...mem(11, 0), width: 32 }, src: word(8) });
        // A generational nursery keeps no start bits: it is bump-allocated
        // without gaps, so the compactor's rare fallback and heap tools walk
        // it by extents. The object's address is the nursery's absolute
        // address plus the young top before this allocation.
        emit({
          op: "mov",
          dst: rax,
          src: mem(11, nativeGenerationalNurseryAddressOffset),
        });
        emit({ op: "add", dst: rax, src: r9 });
        emit({ op: "jmp", target: label(clear) });
      }
      emit({ op: "label", name: slow });
      emit({ op: "mov", dst: frame(savedAllocationSize), src: r10 });
      callAllocator(block, index, site);
      exactInteger(emit, frame(callResult + resultPayload), rax, trapLabel);
      emit({ op: "test", dst: rax, src: imm(7) });
      branch(emit, "ne", trapLabel);
      emit({ op: "mov", dst: r10, src: frame(savedAllocationSize) });
      emit({ op: "mov", dst: rdx, src: frame(savedContext) });
      emit({ op: "mov", dst: scratch, src: mem(2, managedLengthOffset) });
      emit({ op: "sub", dst: scratch, src: r10 });
      branch(emit, "b", trapLabel);
      emit({ op: "cmp", dst: rax, src: scratch });
      branch(emit, "a", trapLabel);
      emit({ op: "add", dst: rax, src: mem(2, managedBaseOffset) });
      emit({ op: "label", name: clear });
      emit({ op: "call", target: label(clearAllocationLabel) });
      emit({ op: "jmp", target: label(fits) });
      emit({ op: "label", name: denied });
      allocationFailure(block);
      emit({ op: "label", name: fits });
    }

    function remember(): void {
      // The store leaves the object start in R9.
      if (!generational) return;
      emit({ op: "mov", dst: context, src: frame(savedContext) });
      emit({ op: "call", target: label(rememberLabel) });
    }

    function vectorGuard(
      value: number,
      register: Gpr<64>,
      invalid: string,
    ): void {
      emit({ op: "mov", dst: register, src: frame(home(value)) });
      emit({ op: "test", dst: register, src: register });
      branch(emit, "e", invalid);
      emit({ op: "cmp", dst: mem(register.index, 0), src: imm(6) });
      branch(emit, "ne", invalid);
    }

    function ownedIndexed(
      id: number,
      length: number,
      type: ScalarType,
      width: ElementBytes,
      marker: number,
      block: Block,
      index: number,
    ): void {
      const site = fnLabel + ":array:" + String(id);
      const denied = site + ":invalid";
      exactInteger(emit, frame(home(length)), r9, denied);
      emit({
        op: "mov",
        dst: word(11),
        src: imm(
          Math.floor((0xffffffff - nativeArrayInlineOffset - 7) / width),
        ),
      });
      emit({ op: "cmp", dst: r9, src: scratch });
      branch(emit, "a", denied);
      emit({
        op: "lea",
        dst: r10,
        src: {
          kind: "mem",
          width: 64,
          address: {
            kind: "base",
            index: 9,
            scale: width,
            disp: nativeArrayInlineOffset + 7,
          },
        },
      });
      emit({ op: "and", dst: r10, src: imm(-8) });
      allocate(block, index, site, denied);
      if (generational) exactInteger(emit, frame(home(length)), r9, trapLabel);
      emit({ op: "mov", dst: mem(0, 0), src: imm(marker) });
      emit({ op: "mov", dst: mem(0, nativeArrayLengthOffset), src: r9 });
      if (marker !== 6) {
        emit({ op: "lea", dst: r10, src: mem(0, nativeArrayInlineOffset) });
        emit({ op: "mov", dst: mem(0, nativeArrayDataOffset), src: r10 });
      }
      define(id, type);
    }

    function arrayView(
      op: {
        readonly id: number;
        readonly array: number;
        readonly begin: number;
        readonly length: number;
      },
      block: Block,
      index: number,
    ): void {
      const site = fnLabel + ":view:" + String(op.id);
      const denied = site + ":invalid";
      const type = typeOf(op.array);
      const width = arrayWidth(type);
      const length = gpr(8);
      exactInteger(emit, frame(home(op.begin)), r9, trapLabel);
      exactInteger(emit, frame(home(op.length)), length, trapLabel);
      emit({ op: "mov", dst: rdx, src: frame(home(op.array)) });
      emit({ op: "mov", dst: scratch, src: mem(2, nativeArrayLengthOffset) });
      emit({ op: "sub", dst: scratch, src: r9 });
      branch(emit, "b", trapLabel);
      emit({ op: "cmp", dst: length, src: scratch });
      branch(emit, "a", trapLabel);
      emit({ op: "mov", dst: r10, src: imm(nativeArrayViewByteLength) });
      allocate(block, index, site, denied);
      if (generational) {
        exactInteger(emit, frame(home(op.begin)), r9, trapLabel);
        exactInteger(emit, frame(home(op.length)), length, trapLabel);
      }
      emit({ op: "mov", dst: rdx, src: frame(home(op.array)) });
      emit({
        op: "mov",
        dst: scratch,
        src: bits(arrayMarker(width), 2 * (nativeHeaderFlagUnit / 4294967296)),
      });
      emit({ op: "mov", dst: mem(0, 0), src: scratch });
      emit({ op: "mov", dst: mem(0, nativeArrayLengthOffset), src: length });
      emit({ op: "mov", dst: scratch, src: mem(2, nativeArrayDataOffset) });
      emit({
        op: "lea",
        dst: r10,
        src: {
          kind: "mem",
          width: 64,
          address: { kind: "base", base: 11, index: 9, scale: width, disp: 0 },
        },
      });
      emit({ op: "mov", dst: mem(0, nativeArrayDataOffset), src: r10 });
      emit({ op: "mov", dst: mem(0, nativeArrayOwnerOffset), src: rdx });
      emit({
        op: "mov",
        dst: mem(0, nativeArrayViewByteLength - 8),
        src: imm(0),
      });
      define(op.id, type);
    }

    function marker(object: Gpr<64>, output: Gpr<64>): void {
      emit({ op: "mov", dst: output, src: mem(object.index, 0) });
      emit({ op: "shl", dst: output, count: 64 - nativeHeaderFlagsShift });
      emit({ op: "shr", dst: output, count: 64 - nativeHeaderFlagsShift });
    }

    function generalTruth(value: number, invert: boolean, site: string): void {
      const numeric = site + ":number";
      const string = site + ":string";
      const boolean = site + ":boolean";
      const done = site + ":done";
      emit({ op: "xor", dst: eax, src: eax });
      emit({ op: "mov", dst: r9, src: frame(home(value)) });
      emit({ op: "test", dst: r9, src: r9 });
      branch(emit, "e", done);
      emit({ op: "cmp", dst: r9, src: imm(4) });
      branch(emit, "e", done);
      emit({ op: "cmp", dst: r9, src: imm(6) });
      branch(emit, "a", trapLabel);
      emit({ op: "cmp", dst: r9, src: imm(1) });
      branch(emit, "e", numeric);
      emit({ op: "cmp", dst: r9, src: imm(2) });
      branch(emit, "e", boolean);
      emit({ op: "cmp", dst: r9, src: imm(3) });
      branch(emit, "e", string);
      emit({ op: "mov", dst: eax, src: imm(1) });
      emit({ op: "jmp", target: label(done) });
      emit({ op: "label", name: numeric });
      emit({ op: "movsd", dst: x0, src: frame(home(value) + 8) });
      emit({ op: "xorpd", dst: xmm(1), src: xmm(1) });
      emit({ op: "ucomisd", dst: x0, src: xmm(1) });
      // Both zero and NaN set ZF.
      setBoolean(emit, "ne", 0);
      emit({ op: "jmp", target: label(done) });
      emit({ op: "label", name: boolean });
      emit({ op: "mov", dst: rax, src: frame(home(value) + 8) });
      emit({ op: "jmp", target: label(done) });
      emit({ op: "label", name: string });
      emit({ op: "mov", dst: r9, src: frame(home(value) + 8) });
      emit({ op: "cmp", dst: mem(9, nativeStringLengthOffset), src: imm(0) });
      setBoolean(emit, "ne", 0);
      emit({ op: "label", name: done });
      if (invert) emit({ op: "xor", dst: eax, src: imm(1) });
    }

    function weakGuard(value: number): void {
      emit({ op: "cmp", dst: frame(home(value)), src: imm(5) });
      branch(emit, "ne", trapLabel);
      emit({ op: "mov", dst: r9, src: frame(home(value) + 8) });
      emit({ op: "test", dst: r9, src: r9 });
      branch(emit, "e", trapLabel);
      marker(r9, scratch);
      emit({ op: "cmp", dst: scratch, src: imm(nativeWeakSlotMarker) });
      branch(emit, "ne", trapLabel);
    }

    function arrayOwner(array: number, site: string): void {
      // Walk the view chain until the owned or borrowed backing array.
      emit({ op: "mov", dst: rax, src: frame(home(array)) });
      const loop = site + ":owner";
      const done = loop + ":done";
      emit({ op: "label", name: loop });
      emit({ op: "mov", dst: r10, src: mem(0, 0) });
      emit({ op: "shr", dst: r10, count: nativeHeaderFlagsShift });
      emit({ op: "and", dst: r10, src: imm(7) });
      emit({ op: "cmp", dst: r10, src: imm(2) });
      branch(emit, "ne", done);
      emit({ op: "mov", dst: rax, src: mem(0, nativeArrayOwnerOffset) });
      emit({ op: "jmp", target: label(loop) });
      emit({ op: "label", name: done });
    }

    function arrayElement(
      op:
        | {
            readonly kind: "array-valid" | "array-read" | "array-element";
            readonly array: number;
            readonly index: number;
            readonly id: number;
          }
        | {
            readonly kind: "array-write" | "array-store";
            readonly array: number;
            readonly index: number;
            readonly value: number;
          },
    ): void {
      const invalid = fnLabel + ":index:" + String(instructionCount);
      const done = invalid + ":done";
      const checked = op.kind !== "array-element" && op.kind !== "array-store";
      if (checked) exactInteger(emit, frame(home(op.index)), r9, invalid);
      else emit({ op: "cvttsd2si", dst: r9, src: frame(home(op.index)) });
      emit({ op: "mov", dst: scratch, src: frame(home(op.array)) });
      if (checked) {
        emit({ op: "cmp", dst: r9, src: mem(11, nativeArrayLengthOffset) });
        branch(emit, "ae", invalid);
      }
      const width = arrayWidth(typeOf(op.array));
      const store = op.kind === "array-write" || op.kind === "array-store";
      if (op.kind === "array-write" || op.kind === "array-store") {
        if (width === 8)
          emit({ op: "mov", dst: rax, src: frame(home(op.value)) });
        else {
          // ToUint32 preserves R9 but clobbers the array register.
          numbers.toWord(frame(home(op.value)));
          emit({ op: "mov", dst: scratch, src: frame(home(op.array)) });
        }
      }
      const address: Address = {
        kind: "base",
        base: 11,
        index: 9,
        scale: width,
        disp: 0,
      };
      if (op.kind === "array-valid") emit({ op: "mov", dst: eax, src: imm(1) });
      else {
        emit({ op: "mov", dst: scratch, src: mem(11, nativeArrayDataOffset) });
        if (store) {
          if (width === 1)
            emit({
              op: "mov",
              dst: { kind: "mem", width: 8, address },
              src: byte(0),
            });
          else if (width === 2)
            emit({
              op: "mov",
              dst: { kind: "mem", width: 16, address },
              src: { kind: "gpr", width: 16, index: 0 },
            });
          else if (width === 4)
            emit({
              op: "mov",
              dst: { kind: "mem", width: 32, address },
              src: eax,
            });
          else
            emit({
              op: "mov",
              dst: { kind: "mem", width: 64, address },
              src: rax,
            });
        } else if (width === 8) {
          emit({
            op: "movsd",
            dst: x0,
            src: { kind: "mem", width: 64, address },
          });
          floatBits(emit, rax, x0);
          // A stored NaN may have the same payload as optional-number absence.
          if (op.kind === "array-read") {
            emit({ op: "ucomisd", dst: x0, src: x0 });
            branch(emit, "np", done);
            emit({ op: "mov", dst: rax, src: bits(0, 0x7ff80000) });
          }
        } else {
          if (width === 1)
            emit({
              op: "movzx",
              dst: eax,
              src: { kind: "mem", width: 8, address },
            });
          else if (width === 2)
            emit({
              op: "movzx",
              dst: eax,
              src: { kind: "mem", width: 16, address },
            });
          else
            emit({
              op: "mov",
              dst: eax,
              src: { kind: "mem", width: 32, address },
            });
          numberBits();
        }
      }
      if (checked) {
        emit({ op: "jmp", target: label(done) });
        emit({ op: "label", name: invalid });
        if (op.kind === "array-read")
          emit({ op: "mov", dst: rax, src: absent });
        if (op.kind === "array-valid") emit({ op: "xor", dst: eax, src: eax });
        emit({ op: "label", name: done });
      }
      if (
        op.kind === "array-read" ||
        op.kind === "array-element" ||
        op.kind === "array-valid"
      )
        define(
          op.id,
          op.kind === "array-read"
            ? "optional-number"
            : op.kind === "array-element"
              ? "number"
              : "boolean",
        );
    }

    function arrayCopy(
      op: {
        readonly id: number;
        readonly array: number;
        readonly source: number;
        readonly offset: number;
      },
      symbol: string,
    ): void {
      const width = arrayWidth(typeOf(op.array));
      const invalid = fnLabel + ":copy:" + String(op.id);
      const done = invalid + ":done";
      exactInteger(emit, frame(home(op.offset)), r9, invalid);
      const destination = gpr(7),
        source = gpr(6);
      emit({ op: "mov", dst: destination, src: frame(home(op.array)) });
      emit({ op: "mov", dst: source, src: frame(home(op.source)) });
      emit({ op: "mov", dst: rax, src: mem(7, nativeArrayLengthOffset) });
      emit({ op: "sub", dst: rax, src: r9 });
      branch(emit, "b", invalid);
      emit({ op: "mov", dst: rdx, src: mem(6, nativeArrayLengthOffset) });
      emit({ op: "cmp", dst: rdx, src: rax });
      branch(emit, "a", invalid);
      emit({ op: "mov", dst: destination, src: mem(7, nativeArrayDataOffset) });
      emit({ op: "mov", dst: source, src: mem(6, nativeArrayDataOffset) });
      emit({
        op: "lea",
        dst: destination,
        src: {
          kind: "mem",
          width: 64,
          address: { kind: "base", base: 7, index: 9, scale: width, disp: 0 },
        },
      });
      emit({
        op: "lea",
        dst: rdx,
        src: {
          kind: "mem",
          width: 64,
          address: { kind: "base", index: 2, scale: width, disp: 0 },
        },
      });
      bytesOperation(symbol);
      emit({ op: "mov", dst: eax, src: imm(1) });
      emit({ op: "jmp", target: label(done) });
      emit({ op: "label", name: invalid });
      emit({ op: "xor", dst: eax, src: eax });
      emit({ op: "label", name: done });
      define(op.id, "boolean");
    }

    /** Allocate a flat string from its unit count in R9. The spare
     * word of this result home holds the count across the allocation. */
    function allocateString(id: number, block: Block, index: number): void {
      const site = fnLabel + ":allocate-string:" + String(id);
      const denied = site + ":invalid";
      const maxUnits = Math.floor((0xfffffff0 - nativeStringDataOffset) / 2);
      emit({ op: "cmp", dst: r9, src: imm(maxUnits) });
      branch(emit, "a", denied);
      emit({ op: "mov", dst: frame(home(id) + 8), src: r9 });
      emit({ op: "mov", dst: r10, src: imm(4) });
      emit({ op: "cmp", dst: r9, src: r10 });
      emit({ op: "cmovcc", cc: "a", dst: r10, src: r9 });
      emit({
        op: "lea",
        dst: r10,
        src: {
          kind: "mem",
          width: 64,
          address: {
            kind: "base",
            index: 10,
            scale: 2,
            disp: nativeStringDataOffset + 7,
          },
        },
      });
      emit({ op: "and", dst: r10, src: imm(-8) });
      allocate(block, index, site, denied);
      emit({ op: "mov", dst: mem(0, 0), src: imm(1) });
      emit({ op: "mov", dst: scratch, src: frame(home(id) + 8) });
      emit({ op: "mov", dst: mem(0, nativeStringLengthOffset), src: scratch });
    }

    function stringCopy(symbol: string): void {
      // RDI/RSI: string bases, possibly adjusted by a code-unit offset.
      // RDX: copy length in units.
      emit({ op: "lea", dst: gpr(7), src: mem(7, nativeStringDataOffset) });
      emit({ op: "lea", dst: gpr(6), src: mem(6, nativeStringDataOffset) });
      emit({ op: "shl", dst: rdx, count: 1 });
      bytesOperation(symbol);
    }

    function sliceIndex(value: number, dst: Gpr<64>, site: string): void {
      // RDX holds the string length. Clamp in binary64 before truncating,
      // then make strictly negative truncated bounds relative to length.
      const done = site + ":done";
      const x1 = xmm(1),
        x2 = xmm(2);
      emit({ op: "xor", dst, src: dst });
      emit({ op: "movsd", dst: x0, src: frame(home(value)) });
      emit({ op: "ucomisd", dst: x0, src: x0 });
      branch(emit, "p", done);
      emit({ op: "cvtsi2sd", dst: x1, src: rdx });
      emit({ op: "xorpd", dst: x2, src: x2 });
      emit({ op: "subsd", dst: x2, src: x1 });
      emit({ op: "minsd", dst: x0, src: x1 });
      emit({ op: "maxsd", dst: x0, src: x2 });
      emit({ op: "cvttsd2si", dst, src: x0 });
      emit({ op: "test", dst, src: dst });
      branch(emit, "ns", done);
      emit({ op: "add", dst, src: rdx });
      emit({ op: "label", name: done });
    }

    // RDI/RSI hold the two string bases (RDI may already be advanced by a
    // code-unit offset), RDX the equal-length comparison extent in units.
    function compareUnits(symbol: string, equal: boolean): void {
      emit({ op: "lea", dst: gpr(7), src: mem(7, nativeStringDataOffset) });
      emit({ op: "lea", dst: gpr(6), src: mem(6, nativeStringDataOffset) });
      emit({ op: "shl", dst: rdx, count: 1 });
      bytesOperation(symbol);
      emit({ op: "test", dst: eax, src: eax });
      setBoolean(emit, equal ? "e" : "ne", 0);
    }

    function stringEqual(
      left: Memory<64>,
      right: Memory<64>,
      equal: boolean,
      site: string,
      symbol: string,
    ): void {
      const same = site + ":same";
      const different = site + ":different";
      const done = site + ":done";
      const a = gpr(7),
        b = gpr(6);
      emit({ op: "mov", dst: a, src: left });
      emit({ op: "mov", dst: b, src: right });
      emit({ op: "cmp", dst: a, src: b });
      branch(emit, "e", same);
      emit({ op: "test", dst: a, src: a });
      branch(emit, "e", different);
      emit({ op: "test", dst: b, src: b });
      branch(emit, "e", different);
      emit({ op: "mov", dst: rdx, src: mem(7, nativeStringLengthOffset) });
      emit({ op: "cmp", dst: rdx, src: mem(6, nativeStringLengthOffset) });
      branch(emit, "ne", different);
      compareUnits(symbol, equal);
      emit({ op: "jmp", target: label(done) });
      emit({ op: "label", name: same });
      emit({ op: "mov", dst: eax, src: imm(equal ? 1 : 0) });
      emit({ op: "jmp", target: label(done) });
      emit({ op: "label", name: different });
      emit({ op: "mov", dst: eax, src: imm(equal ? 0 : 1) });
      emit({ op: "label", name: done });
    }

    function stringPrefix(
      op: {
        readonly id: number;
        readonly string: number;
        readonly search: number;
        readonly position: number;
      },
      symbol: string,
    ): void {
      const site = fnLabel + ":prefix:" + String(op.id);
      const clamped = site + ":clamped";
      const absent = site + ":absent";
      const done = site + ":done";
      const a = gpr(7),
        b = gpr(6),
        x1 = xmm(1);
      emit({ op: "mov", dst: a, src: frame(home(op.string)) });
      emit({ op: "mov", dst: b, src: frame(home(op.search)) });
      emit({ op: "mov", dst: r10, src: mem(7, nativeStringLengthOffset) });
      emit({ op: "movsd", dst: x0, src: frame(home(op.position)) });
      emit({ op: "xor", dst: word(9), src: word(9) });
      emit({ op: "xorpd", dst: x1, src: x1 });
      emit({ op: "ucomisd", dst: x0, src: x1 });
      // NaN and negative inputs clamp to zero. Positive overflow clamps to
      // the length before the integer conversion.
      branch(emit, "be", clamped);
      emit({ op: "mov", dst: r9, src: r10 });
      emit({ op: "cvtsi2sd", dst: x1, src: r10 });
      emit({ op: "ucomisd", dst: x0, src: x1 });
      branch(emit, "ae", clamped);
      emit({ op: "cvttsd2si", dst: r9, src: x0 });
      emit({ op: "label", name: clamped });
      emit({ op: "sub", dst: r10, src: r9 });
      emit({ op: "mov", dst: rdx, src: mem(6, nativeStringLengthOffset) });
      emit({ op: "cmp", dst: rdx, src: r10 });
      branch(emit, "a", absent);
      emit({
        op: "lea",
        dst: a,
        src: {
          kind: "mem",
          width: 64,
          address: { kind: "base", base: 7, index: 9, scale: 2, disp: 0 },
        },
      });
      compareUnits(symbol, true);
      emit({ op: "jmp", target: label(done) });
      emit({ op: "label", name: absent });
      emit({ op: "xor", dst: eax, src: eax });
      emit({ op: "label", name: done });
      define(op.id, "boolean");
    }

    function recordField(record: number, index: number): RecordField {
      const field = module.records?.[record]?.fields[index];
      if (field === undefined) throw "x86-64 record field invariant";
      if (
        field.offset + scalarByteLength(field.type) > 0x80000000 ||
        (field.presenceOffset ?? 0) >= 0x80000000
      )
        fail("FRAME_LIMIT", "record field exceeds signed displacement");
      return field;
    }

    function constructRecord(
      op: {
        readonly id: number;
        readonly record: number;
        readonly arguments: readonly (number | undefined)[];
        readonly presence?: readonly (number | undefined)[];
      },
      block: Block,
      siteIndex: number,
    ): void {
      const layout = module.records?.[op.record];
      if (layout === undefined) throw "x86-64 record constructor invariant";
      const site = fnLabel + ":record:" + String(op.id);
      emit({ op: "mov", dst: word(10), src: imm(layout.byteLength) });
      allocate(block, siteIndex, site, site + ":denied");
      emit({ op: "mov", dst: r9, src: rax });
      address(scratch, descriptor(op.record));
      emit({ op: "mov", dst: mem(9, 0), src: scratch });
      for (let index = 0; index < layout.fields.length; index++) {
        const field = recordField(op.record, index);
        const value = op.arguments[index];
        for (
          let offset = 0;
          offset < scalarByteLength(field.type);
          offset += 8
        ) {
          const destination = mem(9, field.offset + offset);
          if (value !== undefined)
            copy(emit, frame(home(value) + offset), destination);
          else if (field.type === "optional-number") {
            emit({ op: "mov", dst: rax, src: absent });
            emit({ op: "mov", dst: destination, src: rax });
          } else emit({ op: "mov", dst: destination, src: imm(0) });
        }
        const state = field.stateOffset ?? field.presenceOffset;
        if (state !== undefined) {
          const presence = op.presence?.[index];
          if (presence === undefined)
            emit({
              op: "mov",
              dst: eax,
              src: imm(value === undefined ? 0 : 1),
            });
          else emit({ op: "mov", dst: rax, src: frame(home(presence)) });
          emit({
            op: "mov",
            dst: { ...mem(9, state), width: 8 },
            src: byte(0),
          });
        }
      }
      emit({ op: "mov", dst: rax, src: r9 });
      define(op.id, "reference");
    }

    function guardRecord(
      object: number,
      record: number,
      alternate: string,
    ): void {
      emit({ op: "mov", dst: r9, src: frame(home(object)) });
      emit({ op: "test", dst: r9, src: r9 });
      branch(emit, "e", alternate);
      address(scratch, descriptor(record));
      emit({ op: "cmp", dst: mem(9, 0), src: scratch });
      branch(emit, "ne", alternate);
    }

    function transferField(
      field: RecordField,
      destination: number,
      read: boolean,
    ): void {
      for (let offset = 0; offset < scalarByteLength(field.type); offset += 8) {
        const member = mem(9, field.offset + offset);
        const wordHome = frame(destination + offset);
        if (read) copy(emit, member, wordHome);
        else copy(emit, wordHome, member);
      }
    }

    function optionalEqual(
      type: ScalarType,
      leftHome: number,
      rightHome: number,
      equal: boolean,
      site: string,
    ): void {
      const left = frame(leftHome),
        right = frame(rightHome);
      const scalar = site + ":scalar";
      const done = site + ":done";
      if (type === "optional-boolean") {
        emit({ op: "mov", dst: rax, src: frame(leftHome + 8) });
        emit({ op: "cmp", dst: rax, src: frame(rightHome + 8) });
        branch(emit, "ne", done);
        emit({ op: "test", dst: rax, src: rax });
        branch(emit, "e", done);
        emit({ op: "mov", dst: rax, src: left });
        emit({ op: "cmp", dst: rax, src: right });
        emit({ op: "label", name: done });
        setBoolean(emit, equal ? "e" : "ne", 0);
        return;
      }

      emit({ op: "mov", dst: scratch, src: absent });
      emit({ op: "cmp", dst: left, src: scratch });
      branch(emit, "ne", scalar);
      emit({ op: "cmp", dst: right, src: scratch });
      setBoolean(emit, equal ? "e" : "ne", 0);
      emit({ op: "jmp", target: label(done) });
      emit({ op: "label", name: scalar });
      if (!numbers.binary(equal ? "===" : "!==", left, right))
        throw "x86-64 number equality invariant";
      emit({ op: "label", name: done });
    }

    function instruction(op: Instruction, block: Block, index: number): void {
      switch (op.kind) {
        case "c-memory": {
          const abi = host,
            access = op.access;
          if (abi === undefined)
            return fail(
              "UNSUPPORTED",
              "C memory requires the hosted x86-64 target",
            );
          if (
            access.operation === "callback-key" ||
            access.operation === "callback-address"
          ) {
            const id = op.id;
            if (id === undefined) throw "callback address result invariant";
            let address = rip(callbackKeyLabel);
            needsCallbackKey = true;
            if (access.operation === "callback-address") {
              if (access.slot === undefined || access.callback === undefined)
                throw "registered callback invariant";
              address = thunkAddress({
                signature: access.callback,
                ordinal: -1 - access.slot,
                views: undefined,
              });
            }
            emit({ op: "lea", dst: rax, src: address });
            emit({ op: "cvtsi2sd", dst: x0, src: rax });
            floatBits(emit, rax, x0);
            define(id, "number");
            return;
          }
          const prefix = abi.symbolPrefix,
            args = op.arguments;
          const type = emitSysVMemory({
            emit,
            access,
            argument: (index) => {
              const arg = args[index];
              if (arg === undefined) throw "SysV C memory argument invariant";
              return frame(home(arg));
            },
            importSlot: (symbol) => importSlot(prefix + symbol),
            constant,
            site: fnLabel + ":c-memory:" + String(instructionCount),
            trap: trapLabel,
          });
          if (op.id !== undefined && type !== "void") define(op.id, type);
          return;
        }
        case "c-call": {
          const abi = host;
          const layout = plans.get(op);
          if (abi === undefined || layout === undefined)
            return fail("UNSUPPORTED", "unsupported SysV C call");
          const args = op.arguments;
          function argument(index: number): Memory<64> {
            const arg = args[index];
            if (arg === undefined) throw "SysV C argument invariant";
            return frame(home(arg));
          }
          const name = fnLabel + ":c:" + String(instructionCount);
          const plan = transitions.get(op);
          let transition: ForeignTransition | undefined;
          if (plan !== undefined) {
            const returnPC = name + ":return-pc";
            const state = {
              emit,
              trap: trapLabel,
              argument,
              call: foreign,
              context: frame(savedContext),
              returnPC,
              plan,
              record: (offset: number): Memory<64> =>
                frame(transitionOffset + offset),
            };
            const roots: number[] = [];
            for (const root of plan.roots) {
              if (root === undefined) throw "callback root invariant";
              roots.push(transitionOffset + root.offset);
            }
            transition = {
              begin(): void {
                beginTransition(state);
              },
              end(): void {
                safepoint(block, index, returnPC, roots);
                endTransition(state);
              },
              thunk(parameter: number): Memory<64> {
                for (const thunk of plan.thunks)
                  if (thunk !== undefined && thunk.parameter === parameter)
                    return thunkAddress(thunk);
                throw "callback parameter invariant";
              },
            };
          }
          const site: CallSite = {
            emit,
            abi,
            prototype: op.call,
            argument,
            call: foreign,
            staging: (offset) => frame(staging + offset),
            stack: frame(-frameBytes),
            constant,
            site: name,
            trap: trapLabel,
            ...(transition === undefined ? {} : { transition }),
          };
          if (op.call.dynamic === true) emitSysVDynamicCall(site);
          else emitSysVCall(site, layout);
          const id = op.id;
          if (id !== undefined)
            define(id, op.call.result === "boolean" ? "boolean" : "number");
          return;
        }
        case "host-call": {
          if (generational && op.operation === "collect-garbage") {
            pollWorkerStop();
            const site = fnLabel + ":collect:" + String(instructionCount);
            emit({ op: "xor", dst: word(10), src: word(10) });
            callAllocator(block, index, site);
            return;
          }
          if (op.operation === "engine-range-error" && host !== undefined) {
            const id = op.id;
            if (id === undefined) throw "range error result invariant";
            emit({
              op: "mov",
              dst: rax,
              src: bits(
                nativeStackOverflowPayload % 4294967296,
                Math.floor(nativeStackOverflowPayload / 4294967296),
              ),
            });
            emit({ op: "mov", dst: frame(home(id) + 8), src: rax });
            emit({ op: "xor", dst: eax, src: eax });
            define(id, "general");
            return;
          }
          const args = op.arguments;
          const id = op.id;
          function argument(index: number): Memory<64> {
            const arg = args[index];
            if (arg === undefined) throw "host argument invariant";
            return frame(home(arg));
          }
          const operation = op.operation;
          if (operation === "stack-overflow-is" && host !== undefined) {
            const input = args[0];
            if (id === undefined || input === undefined)
              throw "stack overflow identity invariant";
            const value = home(input);
            emit({ op: "cmp", dst: frame(value), src: imm(0) });
            setBoolean(emit, "e", 10);
            emit({
              op: "mov",
              dst: rax,
              src: bits(
                nativeStackOverflowPayload % 4294967296,
                Math.floor(nativeStackOverflowPayload / 4294967296),
              ),
            });
            emit({ op: "cmp", dst: frame(value + 8), src: rax });
            setBoolean(emit, "e", 0);
            emit({ op: "and", dst: eax, src: word(10) });
            emit({ op: "cvtsi2sd", dst: x0, src: eax });
            floatBits(emit, rax, x0);
            define(id, "number");
            return;
          }
          if (
            operation === "native-function-descriptor" ||
            operation === "native-function-signature" ||
            operation === "native-value-function-descriptor" ||
            operation === "native-value-function-signature"
          ) {
            const input = args[0];
            if (id === undefined || input === undefined)
              throw "function reflection invariant";
            const failed = fnLabel + ":reflection-invalid:" + String(id);
            const end = fnLabel + ":reflection-done:" + String(id);
            const generic =
              operation === "native-value-function-descriptor" ||
              operation === "native-value-function-signature";
            const from = home(input);
            if (generic) {
              emit({
                op: "cmp",
                dst: frame(from),
                src: imm(generalTag("reference")),
              });
              branch(emit, "ne", failed);
            }
            emit({ op: "mov", dst: r9, src: frame(from + (generic ? 8 : 0)) });
            emit({ op: "test", dst: r9, src: r9 });
            branch(emit, "e", failed);
            address(scratch, descriptor(functionRecord));
            emit({ op: "cmp", dst: mem(9, 0), src: scratch });
            branch(emit, "ne", failed);
            const offset =
              operation === "native-function-signature" ||
              operation === "native-value-function-signature"
                ? nativeFunctionSignatureOffset
                : 0;
            emit({ op: "mov", dst: rax, src: mem(9, offset) });
            emit({ op: "test", dst: rax, src: rax });
            branch(emit, "e", failed);
            emit({ op: "mov", dst: scratch, src: bits(0xffffffff, 0x1fffff) });
            emit({ op: "cmp", dst: rax, src: scratch });
            branch(emit, "a", failed);
            emit({ op: "jmp", target: label(end) });
            emit({ op: "label", name: failed });
            emit({ op: "mov", dst: rax, src: imm(-1) });
            emit({ op: "label", name: end });
            numberBits();
            define(id, "number");
            return;
          }
          if (jitDebug && operation === "jit-debug-descriptor") {
            if (id === undefined) throw "JIT descriptor result invariant";
            emit({ op: "lea", dst: rax, src: rip(debugDescriptor) });
            numberBits();
            define(id, "number");
            return;
          }
          if (jitDebug && operation === "jit-debug-register") {
            emit({ op: "call", target: label(debugRegister) });
            return;
          }
          if (
            host !== undefined &&
            (operation === "executable-call-managed" ||
              operation === "executable-call-value" ||
              operation === "executable-call-number")
          ) {
            if (id === undefined) throw "executable result invariant";
            callExecutable(argument(0), args[1], operation, id, block, index);
            return;
          }
          const hostPolicy = host;
          if (hostPolicy !== undefined && operation.startsWith("executable-")) {
            if (
              emitExecutableMemory(
                {
                  emit,
                  call: foreign,
                  argument,
                  privateWord: (index) => frame(executableHomes + index * 8),
                  name: fnLabel + ":executable:" + String(instructionCount),
                },
                hostPolicy,
                operation,
              )
            ) {
              if (id !== undefined) define(id, "number");
              return;
            }
          }
          if (
            host === undefined ||
            !emitHostCall({
              operation: op.operation,
              emit,
              policy: host,
              argument,
              call: foreign,
              threadEntry: (operation) => {
                if (operation === "hosted-thread-entry")
                  return rip(hostedThreadEntryLabel);
                needsCollectorWorker = true;
                return rip(collectorWorker);
              },
              scratch: frame(callResult),
              scratchNext: frame(callResult + 8),
              scratchResult: frame(callResult + resultPayload),
              context: frame(savedContext),
              ownRootHead,
              constant,
              site: fnLabel + ":host:" + String(instructionCount),
              trap: trapLabel,
            })
          ) {
            fail(
              "UNSUPPORTED",
              "unsupported host operation " +
                op.operation +
                " (requires slice 7)",
            );
          }
          if (id !== undefined) define(id, "number");
          return;
        }
        case "array-new": {
          if (host === undefined) break;
          const width = arrayWidth(op.type);
          ownedIndexed(
            op.id,
            op.length,
            op.type,
            width,
            arrayMarker(width),
            block,
            index,
          );
          return;
        }
        case "reference-vector-new":
          if (host === undefined) break;
          ownedIndexed(op.id, op.length, "reference", 8, 6, block, index);
          return;
        case "reference-vector-is": {
          const done = fnLabel + ":vector-test:" + String(op.id);
          emit({ op: "xor", dst: eax, src: eax });
          vectorGuard(op.vector, scratch, done);
          emit({ op: "mov", dst: eax, src: imm(1) });
          emit({ op: "label", name: done });
          define(op.id, "boolean");
          return;
        }
        case "reference-vector-length":
          vectorGuard(op.vector, scratch, trapLabel);
          emit({ op: "mov", dst: rax, src: mem(11, nativeArrayLengthOffset) });
          numberBits();
          define(op.id, "number");
          return;
        case "reference-vector-read":
        case "reference-vector-write": {
          const read = op.kind === "reference-vector-read";
          const done = fnLabel + ":vector-element:" + String(instructionCount);
          const invalid = read ? done : trapLabel;
          vectorGuard(op.vector, scratch, trapLabel);
          emit({ op: "xor", dst: eax, src: eax });
          exactInteger(emit, frame(home(op.index)), r9, invalid);
          emit({ op: "cmp", dst: r9, src: mem(11, nativeArrayLengthOffset) });
          branch(emit, "ae", invalid);
          const element: Memory<64> = {
            kind: "mem",
            width: 64,
            address: {
              kind: "base",
              base: 11,
              index: 9,
              scale: 8,
              disp: nativeArrayInlineOffset,
            },
          };
          if (op.kind === "reference-vector-read") {
            emit({ op: "mov", dst: rax, src: element });
            emit({ op: "label", name: done });
            define(op.id, "optional-reference");
          } else {
            emit({ op: "mov", dst: rax, src: frame(home(op.value)) });
            emit({ op: "mov", dst: element, src: rax });
            emit({ op: "mov", dst: r9, src: scratch });
            remember();
          }
          return;
        }
        case "reference-vector-copy": {
          const loop = fnLabel + ":copy-vector:" + String(instructionCount);
          const done = loop + ":done";
          const at = gpr(8);
          vectorGuard(op.source, r10, trapLabel);
          vectorGuard(op.target, scratch, trapLabel);
          exactInteger(emit, frame(home(op.count)), rdx, trapLabel);
          emit({ op: "cmp", dst: rdx, src: mem(10, nativeArrayLengthOffset) });
          branch(emit, "a", trapLabel);
          emit({ op: "cmp", dst: rdx, src: mem(11, nativeArrayLengthOffset) });
          branch(emit, "a", trapLabel);
          emit({ op: "test", dst: rdx, src: rdx });
          branch(emit, "e", done);
          emit({ op: "xor", dst: at, src: at });
          emit({ op: "label", name: loop });
          const source: Memory<64> = {
            kind: "mem",
            width: 64,
            address: {
              kind: "base",
              base: 10,
              index: 8,
              scale: 8,
              disp: nativeArrayInlineOffset,
            },
          };
          emit({ op: "mov", dst: rax, src: source });
          if (op.rebase) {
            emit({ op: "cmp", dst: rax, src: r10 });
            emit({ op: "cmovcc", cc: "e", dst: rax, src: scratch });
          }
          emit({
            op: "mov",
            dst: {
              ...source,
              address: {
                kind: "base",
                base: 11,
                index: 8,
                scale: 8,
                disp: nativeArrayInlineOffset,
              },
            },
            src: rax,
          });
          emit({ op: "inc", dst: at });
          emit({ op: "cmp", dst: at, src: rdx });
          branch(emit, "b", loop);
          emit({ op: "mov", dst: r9, src: scratch });
          remember();
          emit({ op: "label", name: done });
          return;
        }
        case "array-subarray":
          if (host === undefined) break;
          arrayView(op, block, index);
          return;
        case "array-length":
        case "array-byte-length":
          if (host === undefined) break;
          emit({ op: "mov", dst: scratch, src: frame(home(op.array)) });
          emit({ op: "mov", dst: rax, src: mem(11, nativeArrayLengthOffset) });
          if (op.kind === "array-byte-length") {
            const width = arrayWidth(typeOf(op.array));
            if (width > 1)
              emit({
                op: "shl",
                dst: rax,
                count: width === 2 ? 1 : width === 4 ? 2 : 3,
              });
          }
          numberBits();
          define(op.id, "number");
          return;
        case "array-buffer":
        case "array-byte-offset":
          if (host === undefined) break;
          arrayOwner(op.array, fnLabel + ":array-owner:" + String(op.id));
          if (op.kind === "array-buffer") define(op.id, "reference");
          else {
            emit({ op: "mov", dst: r10, src: mem(0, nativeArrayDataOffset) });
            emit({ op: "mov", dst: scratch, src: frame(home(op.array)) });
            emit({ op: "mov", dst: rax, src: mem(11, nativeArrayDataOffset) });
            emit({ op: "sub", dst: rax, src: r10 });
            numberBits();
            define(op.id, "number");
          }
          return;
        case "array-valid":
        case "array-read":
        case "array-element":
        case "array-write":
        case "array-store":
          if (host === undefined) break;
          arrayElement(op);
          return;
        case "array-copy":
          if (host === undefined) break;
          arrayCopy(op, host.symbolPrefix + "memmove");
          return;
        case "string-none":
          emit({ op: "xor", dst: eax, src: eax });
          define(op.id, "optional-string");
          return;
        case "string-wrap":
        case "string-value":
        case "string-present":
          emit({ op: "mov", dst: rax, src: frame(home(op.value)) });
          if (op.kind === "string-present") {
            emit({ op: "test", dst: rax, src: rax });
            setBoolean(emit, "ne", 0);
          }
          define(
            op.id,
            op.kind === "string-present"
              ? "boolean"
              : op.kind === "string-wrap"
                ? "optional-string"
                : "string",
          );
          return;
        case "string-starts-with":
          if (host === undefined) break;
          stringPrefix(op, host.symbolPrefix + "memcmp");
          return;
        case "string-from-code-units": {
          if (host === undefined) break;
          emit({ op: "mov", dst: r9, src: imm(op.values.length) });
          allocateString(op.id, block, index);
          define(op.id, "string");
          for (let unit = 0; unit < op.values.length; unit++) {
            const value = op.values[unit];
            if (value === undefined) throw "string code unit invariant";
            numbers.toWord(frame(home(value)));
            emit({ op: "mov", dst: r9, src: frame(home(op.id)) });
            emit({
              op: "mov",
              dst: { ...mem(9, nativeStringDataOffset + unit * 2), width: 16 },
              src: { kind: "gpr", width: 16, index: 0 },
            });
          }
          return;
        }
        case "string-allocate": {
          if (host === undefined) break;
          const invalid =
            fnLabel + ":allocate-string:" + String(op.id) + ":invalid";
          exactInteger(emit, frame(home(op.length)), r9, invalid);
          allocateString(op.id, block, index);
          define(op.id, "string");
          return;
        }
        case "string-concat": {
          if (host === undefined) break;
          const move = host.symbolPrefix + "memmove";
          emit({ op: "mov", dst: receiver, src: frame(home(op.left)) });
          emit({ op: "mov", dst: environment, src: frame(home(op.right)) });
          emit({ op: "mov", dst: r9, src: mem(2, nativeStringLengthOffset) });
          emit({ op: "add", dst: r9, src: mem(6, nativeStringLengthOffset) });
          allocateString(op.id, block, index);
          define(op.id, "string");
          emit({ op: "mov", dst: context, src: rax });
          emit({ op: "mov", dst: environment, src: frame(home(op.left)) });
          emit({ op: "mov", dst: rdx, src: mem(6, nativeStringLengthOffset) });
          stringCopy(move);
          emit({ op: "mov", dst: context, src: frame(home(op.id)) });
          emit({ op: "mov", dst: environment, src: frame(home(op.left)) });
          emit({ op: "mov", dst: rdx, src: mem(6, nativeStringLengthOffset) });
          emit({
            op: "lea",
            dst: context,
            src: {
              kind: "mem",
              width: 64,
              address: { kind: "base", base: 7, index: 2, scale: 2, disp: 0 },
            },
          });
          emit({ op: "mov", dst: environment, src: frame(home(op.right)) });
          emit({ op: "mov", dst: rdx, src: mem(6, nativeStringLengthOffset) });
          stringCopy(move);
          return;
        }
        case "string-slice": {
          if (host === undefined) break;
          const move = host.symbolPrefix + "memmove";
          const site = fnLabel + ":slice:" + String(op.id);
          const bounded = site + ":limit-bounded";
          const begin = gpr(8);
          emit({ op: "mov", dst: scratch, src: frame(home(op.string)) });
          emit({ op: "mov", dst: rdx, src: mem(11, nativeStringLengthOffset) });
          sliceIndex(op.begin, begin, site + ":begin");
          emit({ op: "mov", dst: scratch, src: absent });
          emit({ op: "cmp", dst: frame(home(op.limit)), src: scratch });
          emit({ op: "mov", dst: r9, src: rdx });
          branch(emit, "e", bounded);
          sliceIndex(op.limit, r9, site + ":limit");
          emit({ op: "label", name: bounded });
          emit({ op: "xor", dst: eax, src: eax });
          emit({ op: "sub", dst: r9, src: begin });
          emit({ op: "cmovcc", cc: "b", dst: r9, src: rax });
          emit({ op: "mov", dst: frame(home(op.id)), src: begin });
          allocateString(op.id, block, index);
          emit({ op: "mov", dst: context, src: rax });
          emit({ op: "mov", dst: environment, src: frame(home(op.string)) });
          emit({ op: "mov", dst: begin, src: frame(home(op.id)) });
          emit({
            op: "lea",
            dst: environment,
            src: {
              kind: "mem",
              width: 64,
              address: { kind: "base", base: 6, index: 8, scale: 2, disp: 0 },
            },
          });
          define(op.id, "string");
          emit({ op: "mov", dst: rdx, src: frame(home(op.id) + 8) });
          stringCopy(move);
          return;
        }
        case "string-write": {
          if (host === undefined) break;
          const move = host.symbolPrefix + "memmove";
          exactInteger(emit, frame(home(op.offset)), r9, trapLabel);
          emit({ op: "mov", dst: context, src: frame(home(op.target)) });
          emit({ op: "mov", dst: environment, src: frame(home(op.source)) });
          emit({ op: "mov", dst: rdx, src: mem(6, nativeStringLengthOffset) });
          emit({
            op: "mov",
            dst: scratch,
            src: mem(7, nativeStringLengthOffset),
          });
          emit({ op: "sub", dst: scratch, src: r9 });
          branch(emit, "b", trapLabel);
          emit({ op: "cmp", dst: rdx, src: scratch });
          branch(emit, "a", trapLabel);
          emit({
            op: "lea",
            dst: context,
            src: {
              kind: "mem",
              width: 64,
              address: { kind: "base", base: 7, index: 9, scale: 2, disp: 0 },
            },
          });
          stringCopy(move);
          return;
        }
        case "string-literal":
          if (host === undefined) break;
          emit({ op: "lea", dst: rax, src: literal(op.value) });
          define(op.id, "string");
          return;
        case "string-length":
          if (host === undefined) break;
          emit({ op: "mov", dst: scratch, src: frame(home(op.string)) });
          emit({ op: "mov", dst: rax, src: mem(11, nativeStringLengthOffset) });
          numberBits();
          define(op.id, "number");
          return;
        case "string-code-unit": {
          if (host === undefined) break;
          const site = fnLabel + ":code-unit:" + String(op.id);
          const ordered = site + ":ordered";
          const ready = site + ":ready";
          const invalid = site + ":invalid";
          const done = site + ":done";
          emit({ op: "movsd", dst: x0, src: frame(home(op.index)) });
          if (op.inBounds !== true) {
            // ToIntegerOrInfinity converts NaN to zero and truncates toward zero.
            emit({ op: "ucomisd", dst: x0, src: x0 });
            branch(emit, "np", ordered);
            emit({ op: "xor", dst: word(9), src: word(9) });
            emit({ op: "jmp", target: label(ready) });
            emit({ op: "label", name: ordered });
          }
          emit({ op: "cvttsd2si", dst: r9, src: x0 });
          emit({ op: "label", name: ready });
          emit({ op: "mov", dst: scratch, src: frame(home(op.string)) });
          if (op.inBounds !== true) {
            // The indefinite integer for overflow and Infinity is unsigned out of range.
            emit({
              op: "cmp",
              dst: r9,
              src: mem(11, nativeStringLengthOffset),
            });
            branch(emit, "ae", invalid);
          }
          emit({
            op: "movzx",
            dst: eax,
            src: {
              kind: "mem",
              width: 16,
              address: {
                kind: "base",
                base: 11,
                index: 9,
                scale: 2,
                disp: nativeStringDataOffset,
              },
            },
          });
          numberBits();
          if (op.inBounds !== true) {
            emit({ op: "jmp", target: label(done) });
            emit({ op: "label", name: invalid });
            emit({ op: "mov", dst: rax, src: bits(0, 0x7ff80000) });
            emit({ op: "label", name: done });
          }
          define(op.id, "number");
          return;
        }
        case "record-new":
          if (host === undefined) break;
          constructRecord(op, block, index);
          return;
        case "record-read": {
          const field = recordField(op.record, op.field);
          emit({ op: "mov", dst: r9, src: frame(home(op.object)) });
          transferField(field, home(op.id), true);
          types.set(op.id, field.type);
          return;
        }
        case "record-slot-read": {
          const field = recordField(op.record, op.field);
          // The index must be an integer in [0, count).
          exactInteger(emit, frame(home(op.index)), r9, trapLabel);
          emit({ op: "cmp", dst: r9, src: imm(op.count) });
          branch(emit, "ae", trapLabel);
          emit({
            op: "shl",
            dst: r9,
            count: scalarByteLength(field.type) === 16 ? 4 : 3,
          });
          emit({ op: "add", dst: r9, src: frame(home(op.object)) });
          transferField(field, home(op.id), true);
          types.set(op.id, field.type);
          return;
        }
        case "property-load":
        case "property-store": {
          // See the AArch64 emission: the receiver's first word against the
          // site's shape, then the value at the site's raw word index.
          const shape = recordField(op.record, 0);
          const site = fnLabel + ":" + op.kind + ":" + String(op.id);
          const missed = site + ":miss",
            done = site + ":done",
            hit = site + ":hit";
          if (op.kind === "property-load") {
            const inherited = op.inherited,
              stride = inherited ? 3 : 2,
              loadValue = site + ":load";
            emit({ op: "mov", dst: gpr(10), src: frame(home(op.site)) });
            emit({ op: "cmp", dst: frame(home(op.object)), src: imm(5) });
            if (inherited) {
              const isObject = site + ":obj",
                shapeReady = site + ":shape";
              const epoch = recordField(
                  op.siteRecord,
                  op.siteField + op.entries * 3,
                ),
                epochRecord = recordField(
                  op.siteRecord,
                  op.siteField + op.entries * 3 + 1,
                ),
                stringShape = recordField(
                  op.siteRecord,
                  op.siteField + op.entries * 3 + 2,
                ),
                current = recordField(op.epochRecord, op.epochField);
              branch(emit, "e", isObject);
              emit({ op: "cmp", dst: frame(home(op.object)), src: imm(3) });
              branch(emit, "ne", missed);
              emit({ op: "mov", dst: rax, src: mem(10, stringShape.offset) });
              emit({ op: "jmp", target: label(shapeReady) });
              emit({ op: "label", name: isObject });
              emit({ op: "mov", dst: r9, src: frame(home(op.object) + 8) });
              emit({ op: "mov", dst: rax, src: mem(9, shape.offset) });
              emit({ op: "label", name: shapeReady });
              // Direct inherited values are current while the epoch they were
              // found under is the epoch record's value.
              emit({
                op: "mov",
                dst: scratch,
                src: mem(10, epochRecord.offset),
              });
              emit({
                op: "mov",
                dst: scratch,
                src: mem(11, current.offset),
              });
              emit({ op: "cmp", dst: scratch, src: mem(10, epoch.offset) });
              branch(emit, "ne", missed);
            } else {
              branch(emit, "ne", missed);
              emit({ op: "mov", dst: r9, src: frame(home(op.object) + 8) });
              emit({ op: "mov", dst: rax, src: mem(9, shape.offset) });
            }
            // Every entry but the last branches to its own hit tail, which
            // loads the word index into rax (and the direct inherited value
            // address into r11).
            for (let entry = 0; entry < op.entries; entry++) {
              const first = op.siteField + entry * stride,
                entryShape = recordField(op.siteRecord, first);
              emit({ op: "cmp", dst: rax, src: mem(10, entryShape.offset) });
              const last = entry === op.entries - 1;
              const matched = site + ":entry" + String(entry);
              branch(emit, last ? "ne" : "e", last ? missed : matched);
            }
            const lastEntry = op.siteField + (op.entries - 1) * stride;
            if (inherited)
              emit({
                op: "lea",
                dst: scratch,
                src: mem(10, recordField(op.siteRecord, lastEntry + 2).offset),
              });
            emit({
              op: "mov",
              dst: rax,
              src: mem(10, recordField(op.siteRecord, lastEntry + 1).offset),
            });
            if (op.entries > 1) emit({ op: "jmp", target: label(hit) });
            for (let entry = 0; entry < op.entries - 1; entry++) {
              const first = op.siteField + entry * stride;
              emit({ op: "label", name: site + ":entry" + String(entry) });
              if (inherited)
                emit({
                  op: "lea",
                  dst: scratch,
                  src: mem(10, recordField(op.siteRecord, first + 2).offset),
                });
              emit({
                op: "mov",
                dst: rax,
                src: mem(10, recordField(op.siteRecord, first + 1).offset),
              });
              if (entry < op.entries - 2)
                emit({ op: "jmp", target: label(hit) });
            }
            if (op.entries > 1) emit({ op: "label", name: hit });
            const hasSpill =
              op.spillField !== undefined && op.spillRecord !== undefined;
            const spillLabel = site + ":spill";
            if (hasSpill || inherited) emit({ op: "test", dst: rax, src: rax });
            if (hasSpill) branch(emit, "s", spillLabel);
            if (inherited) branch(emit, "e", loadValue);
            emit({
              op: "lea",
              dst: scratch,
              src: {
                kind: "mem",
                width: 64,
                address: { kind: "base", base: 9, index: 0, scale: 8, disp: 0 },
              },
            });
            if (hasSpill) {
              const spillField = recordField(op.record, op.spillField!),
                spillNext = recordField(op.spillRecord!, 0),
                spillLoop = site + ":spillLoop",
                spillDone = site + ":spillDone";
              emit({ op: "jmp", target: label(loadValue) });
              emit({ op: "label", name: spillLabel });
              emit({ op: "mov", dst: r9, src: mem(9, spillField.offset) });
              emit({ op: "mov", dst: scratch, src: rax });
              emit({ op: "shr", dst: scratch, count: 16 });
              emit({ op: "and", dst: scratch, src: imm(0xffff) });
              emit({ op: "test", dst: scratch, src: scratch });
              branch(emit, "e", spillDone);
              emit({ op: "label", name: spillLoop });
              emit({ op: "mov", dst: r9, src: mem(9, spillNext.offset) });
              emit({ op: "dec", dst: scratch });
              branch(emit, "ne", spillLoop);
              emit({ op: "label", name: spillDone });
              emit({ op: "and", dst: rax, src: imm(0xffff) });
              emit({
                op: "lea",
                dst: scratch,
                src: {
                  kind: "mem",
                  width: 64,
                  address: {
                    kind: "base",
                    base: 9,
                    index: 0,
                    scale: 8,
                    disp: 0,
                  },
                },
              });
            }
            emit({ op: "label", name: loadValue });
            emit({ op: "mov", dst: gpr(10), src: mem(11, 8) });
            emit({ op: "mov", dst: frame(home(op.id) + 8), src: gpr(10) });
            emit({ op: "mov", dst: rax, src: mem(11, 0) });
            emit({ op: "jmp", target: label(done) });
            emit({ op: "label", name: missed });
            // The absent value: undefined's tag with payload 1.
            emit({ op: "mov", dst: frame(home(op.id) + 8), src: imm(1) });
            emit({ op: "xor", dst: eax, src: eax });
            emit({ op: "label", name: done });
            define(op.id, "general");
            return;
          }
          emit({ op: "cmp", dst: frame(home(op.object)), src: imm(5) });
          branch(emit, "ne", missed);
          emit({ op: "mov", dst: r9, src: frame(home(op.object) + 8) });
          emit({ op: "mov", dst: gpr(10), src: frame(home(op.site)) });
          const siteShape = recordField(op.siteRecord, op.siteField);
          emit({ op: "mov", dst: rax, src: mem(9, shape.offset) });
          emit({ op: "cmp", dst: rax, src: mem(10, siteShape.offset) });
          branch(emit, "ne", missed);
          const transition = recordField(op.siteRecord, op.siteField + 2),
            epoch = recordField(op.siteRecord, op.siteField + 3),
            epochRecord = recordField(op.siteRecord, op.siteField + 4),
            current = recordField(op.epochRecord, op.epochField);
          const existing = site + ":existing";
          emit({ op: "mov", dst: scratch, src: mem(10, transition.offset) });
          emit({ op: "test", dst: scratch, src: scratch });
          branch(emit, "e", existing);
          emit({ op: "mov", dst: rax, src: mem(10, epochRecord.offset) });
          emit({ op: "mov", dst: rax, src: mem(0, current.offset) });
          emit({ op: "cmp", dst: rax, src: mem(10, epoch.offset) });
          branch(emit, "ne", missed);
          emit({ op: "mov", dst: mem(9, shape.offset), src: scratch });
          emit({ op: "label", name: existing });
          emit({
            op: "mov",
            dst: rax,
            src: mem(10, recordField(op.siteRecord, op.siteField + 1).offset),
          });
          const word = (disp: number): Memory<64> => ({
            kind: "mem",
            width: 64,
            address: { kind: "base", base: 9, index: 0, scale: 8, disp },
          });
          emit({ op: "mov", dst: scratch, src: frame(home(op.value)) });
          emit({ op: "mov", dst: word(0), src: scratch });
          emit({ op: "mov", dst: scratch, src: frame(home(op.value) + 8) });
          emit({ op: "mov", dst: word(8), src: scratch });
          // An old object may now refer to a young value or shape.
          remember();
          emit({ op: "mov", dst: eax, src: imm(1) });
          emit({ op: "jmp", target: label(done) });
          emit({ op: "label", name: missed });
          emit({ op: "xor", dst: eax, src: eax });
          emit({ op: "label", name: done });
          define(op.id, "boolean");
          return;
        }
        case "script-entry": {
          const agent = recordField(op.realmRecord, op.agentField),
            activeField = recordField(op.agentRecord, op.activeField),
            registerCall = recordField(op.objectRecord, op.registerCallField),
            invoke = recordField(op.entryRecord, op.invokeField),
            context = recordField(op.entryRecord, op.contextField),
            constructible = recordField(op.entryRecord, op.constructibleField),
            realm = recordField(op.contextRecord, op.realmField),
            scriptOrModule = recordField(
              op.contextRecord,
              op.scriptOrModuleField,
            );
          const site = fnLabel + ":script-entry:" + String(op.id);
          const hit = site + ":hit",
            miss = site + ":miss",
            done = site + ":done";
          emit({ op: "xor", dst: eax, src: eax });
          emit({ op: "cmp", dst: frame(home(op.callee)), src: imm(5) });
          branch(emit, "ne", done);
          emit({ op: "mov", dst: r9, src: frame(home(op.callee) + 8) });
          emit({ op: "test", dst: r9, src: r9 });
          branch(emit, "e", done);
          address(scratch, descriptor(op.objectRecord));
          emit({ op: "cmp", dst: mem(9, 0), src: scratch });
          branch(emit, "ne", done);
          emit({ op: "mov", dst: r9, src: mem(9, registerCall.offset) });
          emit({ op: "test", dst: r9, src: r9 });
          branch(emit, "e", done);
          if (op.construct) {
            emit({ op: "cmp", dst: mem(9, constructible.offset), src: imm(0) });
            branch(emit, "e", done);
          }
          emit({ op: "mov", dst: gpr(10), src: mem(9, invoke.offset) });
          emit({ op: "test", dst: gpr(10), src: gpr(10) });
          branch(emit, "e", done);
          emit({ op: "mov", dst: r9, src: mem(9, context.offset) });
          emit({ op: "mov", dst: scratch, src: frame(home(op.realm)) });
          emit({ op: "mov", dst: scratch, src: mem(11, agent.offset) });
          emit({ op: "mov", dst: scratch, src: mem(11, activeField.offset) });
          emit({ op: "cmp", dst: r9, src: scratch });
          branch(emit, "e", hit);
          emit({ op: "test", dst: scratch, src: scratch });
          branch(emit, "e", done);
          emit({ op: "mov", dst: rax, src: mem(9, realm.offset) });
          emit({ op: "cmp", dst: rax, src: mem(11, realm.offset) });
          branch(emit, "ne", miss);
          emit({ op: "mov", dst: rax, src: mem(9, scriptOrModule.offset) });
          emit({ op: "cmp", dst: rax, src: mem(11, scriptOrModule.offset) });
          branch(emit, "ne", miss);
          emit({
            op: "mov",
            dst: rax,
            src: mem(9, scriptOrModule.offset + 8),
          });
          emit({
            op: "cmp",
            dst: rax,
            src: mem(11, scriptOrModule.offset + 8),
          });
          branch(emit, "ne", miss);
          emit({ op: "label", name: hit });
          emit({ op: "mov", dst: rax, src: gpr(10) });
          emit({ op: "jmp", target: label(done) });
          emit({ op: "label", name: miss });
          emit({ op: "xor", dst: eax, src: eax });
          emit({ op: "label", name: done });
          define(op.id, "optional-reference");
          return;
        }
        case "global-cell": {
          const declarative = recordField(op.scopeRecord, op.declarativeField),
            object = recordField(op.scopeRecord, op.objectField),
            global = recordField(op.scopeRecord, op.globalField),
            lexicalEpoch = recordField(op.globalRecord, op.lexicalEpochField),
            globalObject = recordField(op.globalRecord, op.globalObjectField),
            propertyEpoch = recordField(
              op.globalObjectRecord,
              op.propertyEpochField,
            ),
            cacheGlobal = recordField(op.cacheRecord, op.cacheGlobalField),
            cacheLexicalEpoch = recordField(
              op.cacheRecord,
              op.cacheLexicalEpochField,
            ),
            cacheObjectEpoch = recordField(
              op.cacheRecord,
              op.cacheObjectEpochField,
            ),
            cacheCell = recordField(op.cacheRecord, op.cacheCellField);
          const done = fnLabel + ":global-cell:" + String(op.id) + ":done";
          emit({ op: "xor", dst: eax, src: eax });
          emit({ op: "mov", dst: r9, src: frame(home(op.scope)) });
          emit({ op: "cmp", dst: mem(9, declarative.offset), src: imm(0) });
          branch(emit, "ne", done);
          emit({ op: "cmp", dst: mem(9, object.offset), src: imm(0) });
          branch(emit, "ne", done);
          emit({ op: "mov", dst: r9, src: mem(9, global.offset) });
          emit({ op: "mov", dst: gpr(10), src: frame(home(op.cache)) });
          emit({ op: "cmp", dst: r9, src: mem(10, cacheGlobal.offset) });
          branch(emit, "ne", done);
          emit({ op: "mov", dst: scratch, src: mem(9, lexicalEpoch.offset) });
          emit({
            op: "cmp",
            dst: scratch,
            src: mem(10, cacheLexicalEpoch.offset),
          });
          branch(emit, "ne", done);
          emit({ op: "mov", dst: r9, src: mem(9, globalObject.offset) });
          emit({ op: "mov", dst: scratch, src: mem(9, propertyEpoch.offset) });
          emit({
            op: "cmp",
            dst: scratch,
            src: mem(10, cacheObjectEpoch.offset),
          });
          branch(emit, "ne", done);
          emit({ op: "mov", dst: rax, src: mem(10, cacheCell.offset) });
          emit({ op: "label", name: done });
          define(op.id, "optional-reference");
          return;
        }
        case "element-load":
        case "element-store": {
          // See the AArch64 emission: the object's record descriptor, its
          // elements, the index as an integer below the number count, then
          // the binary64 element.
          const elements = recordField(op.record, op.field),
            count = recordField(op.elementsRecord, op.countField),
            storage = recordField(op.elementsRecord, op.storageField);
          const site = fnLabel + ":" + op.kind + ":" + String(op.id);
          const missed = site + ":miss",
            done = site + ":done";
          if (op.kind === "element-store") {
            // Only a Number (tag 1) overwrites a binary64 element.
            emit({ op: "cmp", dst: frame(home(op.value)), src: imm(1) });
            branch(emit, "ne", missed);
          }
          emit({ op: "cmp", dst: frame(home(op.object)), src: imm(5) });
          branch(emit, "ne", missed);
          emit({ op: "mov", dst: gpr(10), src: frame(home(op.object) + 8) });
          address(scratch, descriptor(op.record));
          emit({ op: "cmp", dst: mem(10, 0), src: scratch });
          branch(emit, "ne", missed);
          emit({ op: "mov", dst: gpr(10), src: mem(10, elements.offset) });
          emit({ op: "test", dst: gpr(10), src: gpr(10) });
          branch(emit, "e", missed);
          // An exact integer (R9) compares unsigned: negative ones are huge.
          exactInteger(emit, frame(home(op.index)), r9, missed);
          emit({ op: "movsd", dst: xmm(1), src: mem(10, count.offset) });
          emit({ op: "cvttsd2si", dst: rax, src: xmm(1) });
          emit({ op: "cmp", dst: r9, src: rax });
          branch(emit, "ae", missed);
          emit({ op: "mov", dst: gpr(10), src: mem(10, storage.offset) });
          emit({
            op: "mov",
            dst: gpr(10),
            src: mem(10, nativeArrayDataOffset),
          });
          const element: Memory<64> = {
            kind: "mem",
            width: 64,
            address: { kind: "base", base: 10, index: 9, scale: 8, disp: 0 },
          };
          if (op.kind === "element-store") {
            emit({ op: "mov", dst: rax, src: frame(home(op.value) + 8) });
            emit({ op: "mov", dst: element, src: rax });
            emit({ op: "mov", dst: eax, src: imm(1) });
            emit({ op: "jmp", target: label(done) });
            emit({ op: "label", name: missed });
            emit({ op: "xor", dst: eax, src: eax });
            emit({ op: "label", name: done });
            define(op.id, "boolean");
            return;
          }
          emit({ op: "mov", dst: rax, src: element });
          emit({ op: "mov", dst: frame(home(op.id) + 8), src: rax });
          // A Number: tag 1 and the element's bits.
          emit({ op: "mov", dst: eax, src: imm(1) });
          emit({ op: "jmp", target: label(done) });
          emit({ op: "label", name: missed });
          // The absent value: undefined's tag with payload 1.
          emit({ op: "mov", dst: frame(home(op.id) + 8), src: imm(1) });
          emit({ op: "xor", dst: eax, src: eax });
          emit({ op: "label", name: done });
          define(op.id, "general");
          return;
        }
        case "record-has": {
          const field = recordField(op.record, op.field);
          const site = fnLabel + ":record-has:" + String(op.id);
          const done = site + ":done";
          emit({ op: "xor", dst: eax, src: eax });
          guardRecord(op.object, op.record, done);
          const presence = field.presenceOffset;
          if (presence === undefined)
            emit({ op: "mov", dst: eax, src: imm(1) });
          else
            emit({
              op: "movzx",
              dst: eax,
              src: { ...mem(9, presence), width: 8 },
            });
          emit({ op: "label", name: done });
          define(op.id, "boolean");
          return;
        }
        case "reference-none":
          emit({ op: "xor", dst: eax, src: eax });
          define(op.id, "optional-reference");
          return;
        case "reference-wrap":
        case "reference-value":
          emit({ op: "mov", dst: rax, src: frame(home(op.value)) });
          emit({ op: "test", dst: rax, src: rax });
          branch(emit, "e", trapLabel);
          define(
            op.id,
            op.kind === "reference-wrap"
              ? "optional-reference"
              : (op.type ?? "reference"),
          );
          return;
        case "boolean-none":
          emit({ op: "xor", dst: eax, src: eax });
          emit({ op: "mov", dst: frame(home(op.id) + 8), src: rax });
          define(op.id, "optional-boolean");
          return;
        case "boolean-wrap":
          emit({ op: "mov", dst: rax, src: frame(home(op.value)) });
          emit({ op: "mov", dst: frame(home(op.id) + 8), src: imm(1) });
          define(op.id, "optional-boolean");
          return;
        case "boolean-present":
          emit({ op: "mov", dst: rax, src: frame(home(op.value) + 8) });
          define(op.id, "boolean");
          return;
        case "boolean-value":
          emit({ op: "cmp", dst: frame(home(op.value) + 8), src: imm(0) });
          branch(emit, "e", trapLabel);
          emit({ op: "mov", dst: rax, src: frame(home(op.value)) });
          define(op.id, "boolean");
          return;
        case "undefined":
          emit({ op: "mov", dst: rax, src: absent });
          define(op.id, "optional-number");
          return;
        case "optional-wrap":
        case "optional-present":
        case "optional-value":
        case "optional-value-or": {
          emit({ op: "mov", dst: rax, src: frame(home(op.value)) });
          emit({ op: "mov", dst: scratch, src: absent });
          emit({ op: "cmp", dst: rax, src: scratch });
          if (op.kind === "optional-present") setBoolean(emit, "ne", 0);
          else if (op.kind === "optional-value-or")
            emit({
              op: "cmovcc",
              cc: "e",
              dst: rax,
              src: frame(home(op.fallback)),
            });
          else {
            // Only the reserved signalling NaN can alias undefined.
            emit({
              op: "mov",
              dst: scratch,
              src: bits(optionalNumberAbsentLow, 0xffffffff),
            });
            emit({ op: "cmovcc", cc: "e", dst: rax, src: scratch });
          }
          define(
            op.id,
            op.kind === "optional-present"
              ? "boolean"
              : op.kind === "optional-wrap"
                ? "optional-number"
                : "number",
          );
          return;
        }
        case "constant": {
          const value = op.value;
          if (typeof value === "boolean") {
            emit({ op: "mov", dst: eax, src: imm(value ? 1 : 0) });
            define(op.id, "boolean");
          } else {
            emit({ op: "mov", dst: rax, src: constant(value) });
            define(op.id, "number");
          }
          return;
        }
        case "load": {
          const type = fn.slots[op.slot];
          if (type === undefined) throw "load slot invariant";
          copyFrame(slot(op.slot), home(op.id), scalarByteLength(type));
          types.set(op.id, type);
          return;
        }
        case "store":
          copyFrame(
            home(op.value),
            slot(op.slot),
            scalarByteLength(typeOf(op.value)),
          );
          return;
        case "activation-read": {
          // Records: @tint/abi/host nativeActivationRecordBytes. This target
          // has no script entries yet, so the chain stays empty; the reads
          // follow the shared layout with no register actuals.
          const record = op.record;
          if (record === undefined) {
            emit({ op: "mov", dst: rax, src: frame(savedContext) });
            emit({
              op: "mov",
              dst: rax,
              src: mem(0, nativeActivationTopOffset),
            });
          } else emit({ op: "cvttsd2si", dst: r9, src: frame(home(record)) });
          if (op.field === "callee" || op.field === "argument") {
            const index = op.index;
            const done = fnLabel + ":activation:" + String(op.id);
            if (index === undefined) {
              emit({
                op: "mov",
                dst: scratch,
                src: mem(9, nativeActivationCalleeOffset + 8),
              });
              emit({
                op: "mov",
                dst: rax,
                src: mem(9, nativeActivationCalleeOffset),
              });
            } else {
              // Missing actuals read undefined; the rest follow the frame
              // record (frame pointer + 16).
              const missing = done + ":missing";
              emit({ op: "cvttsd2si", dst: r10, src: frame(home(index)) });
              emit({
                op: "cmp",
                dst: r10,
                src: mem(9, nativeActivationCountOffset),
              });
              branch(emit, "ae", missing);
              emit({
                op: "mov",
                dst: r9,
                src: mem(9, nativeActivationFrameOffset),
              });
              emit({ op: "shr", dst: r9, count: 4 });
              emit({ op: "shl", dst: r9, count: 4 });
              emit({ op: "shl", dst: r10, count: 4 });
              emit({ op: "add", dst: r9, src: r10 });
              emit({ op: "mov", dst: scratch, src: mem(9, 24) });
              emit({ op: "mov", dst: rax, src: mem(9, 16) });
              emit({ op: "jmp", target: label(done) });
              emit({ op: "label", name: missing });
              emit({ op: "xor", dst: rax, src: rax });
              emit({ op: "xor", dst: scratch, src: scratch });
              emit({ op: "label", name: done });
            }
            emit({ op: "mov", dst: frame(home(op.id) + 8), src: scratch });
            define(op.id, "general");
            return;
          }
          if (op.field === "previous")
            emit({ op: "mov", dst: rax, src: mem(9, 0) });
          else if (op.field === "kind") {
            emit({
              op: "mov",
              dst: rax,
              src: mem(9, nativeActivationFrameOffset),
            });
            emit({ op: "and", dst: rax, src: imm(15) });
          } else if (op.field === "count")
            emit({
              op: "mov",
              dst: rax,
              src: mem(9, nativeActivationCountOffset),
            });
          numberBits();
          define(op.id, "number");
          return;
        }
        case "closure-environment":
          if (savedEnvironment === undefined)
            throw "closure environment invariant";
          emit({ op: "mov", dst: rax, src: frame(savedEnvironment) });
          define(op.id, "reference");
          return;
        case "function-environment":
          guardRecord(op.callee, functionRecord, trapLabel);
          emit({
            op: "mov",
            dst: rax,
            src: mem(9, nativeFunctionEnvironmentOffset),
          });
          define(op.id, "optional-reference");
          return;
        case "function-new": {
          if (host === undefined) break;
          const site = fnLabel + ":function:" + String(op.id);
          const closure = op.environment;
          if (closure !== undefined) {
            const layout = module.functions[op.target]?.closureEnvironment;
            if (layout === undefined)
              throw "function environment layout invariant";
            guardRecord(closure, layout, trapLabel);
          }
          emit({ op: "mov", dst: r10, src: imm(nativeFunctionByteLength) });
          allocate(block, index, site, site + ":denied");
          emit({ op: "mov", dst: r9, src: rax });
          address(rax, descriptor(functionRecord));
          emit({ op: "mov", dst: mem(9, 0), src: rax });
          address(rax, functionAddress(op.target));
          emit({ op: "mov", dst: mem(9, nativeFunctionEntryOffset), src: rax });
          if (closure === undefined) emit({ op: "xor", dst: eax, src: eax });
          else emit({ op: "mov", dst: rax, src: frame(home(closure)) });
          emit({
            op: "mov",
            dst: mem(9, nativeFunctionEnvironmentOffset),
            src: rax,
          });
          address(rax, signature(op.target));
          emit({
            op: "mov",
            dst: mem(9, nativeFunctionSignatureOffset),
            src: rax,
          });
          emit({
            op: "mov",
            dst: mem(9, nativeFunctionReservedOffset),
            src: imm(0),
          });
          emit({ op: "mov", dst: rax, src: r9 });
          define(op.id, "reference");
          return;
        }
        case "call-indirect":
        case "call":
          call(op, block, index);
          return;
        case "weak-slot-new": {
          if (host === undefined) break;
          const site = fnLabel + ":weak-slot:" + String(op.id);
          const publishValue = site + ":publish";
          emit({ op: "mov", dst: r10, src: imm(nativeWeakSlotByteLength) });
          allocate(block, index, site, site + ":denied");
          emit({ op: "mov", dst: r9, src: rax });
          emit({ op: "mov", dst: scratch, src: frame(home(op.ephemeron)) });
          emit({ op: "shl", dst: scratch, count: nativeHeaderFlagsShift });
          emit({ op: "or", dst: scratch, src: imm(nativeWeakSlotMarker) });
          emit({ op: "mov", dst: mem(9, 0), src: scratch });
          copy(emit, frame(home(op.key)), mem(9, nativeWeakSlotKeyOffset));
          copy(
            emit,
            frame(home(op.key) + 8),
            mem(9, nativeWeakSlotKeyOffset + 8),
          );
          emit({ op: "cmp", dst: frame(home(op.ephemeron)), src: imm(0) });
          branch(emit, "e", publishValue);
          copy(emit, frame(home(op.value)), mem(9, nativeWeakSlotValueOffset));
          copy(
            emit,
            frame(home(op.value) + 8),
            mem(9, nativeWeakSlotValueOffset + 8),
          );
          emit({ op: "label", name: publishValue });
          emit({ op: "mov", dst: frame(home(op.id) + 8), src: r9 });
          emit({ op: "mov", dst: eax, src: imm(5) });
          define(op.id, "general");
          return;
        }
        case "weak-slot-key":
        case "weak-slot-value": {
          weakGuard(op.cell);
          const offset =
            op.kind === "weak-slot-key"
              ? nativeWeakSlotKeyOffset
              : nativeWeakSlotValueOffset;
          copy(emit, mem(9, offset + 8), frame(home(op.id) + 8));
          emit({ op: "mov", dst: rax, src: mem(9, offset) });
          define(op.id, "general");
          return;
        }
        case "weak-slot-set-value":
          weakGuard(op.cell);
          emit({ op: "mov", dst: scratch, src: mem(9, 0) });
          emit({ op: "shr", dst: scratch, count: nativeHeaderFlagsShift });
          emit({ op: "test", dst: scratch, src: imm(1) });
          branch(emit, "e", trapLabel);
          copy(emit, frame(home(op.value)), mem(9, nativeWeakSlotValueOffset));
          copy(
            emit,
            frame(home(op.value) + 8),
            mem(9, nativeWeakSlotValueOffset + 8),
          );
          remember();
          return;
        case "weak-slot-clear":
          weakGuard(op.cell);
          for (
            let offset: number = nativeWeakSlotKeyOffset;
            offset < nativeWeakSlotByteLength;
            offset += 8
          )
            emit({ op: "mov", dst: mem(9, offset), src: imm(0) });
          return;
        case "error-new": {
          if (host === undefined) break;
          const site = fnLabel + ":error:" + String(op.id);
          const record =
            errorRecord +
            (op.error === "TypeError" ? 0 : op.error === "RangeError" ? 1 : 2);
          emit({ op: "mov", dst: r10, src: imm(errorLayout.byteLength) });
          allocate(block, index, site, site + ":denied");
          address(scratch, descriptor(record));
          emit({ op: "mov", dst: mem(0, 0), src: scratch });
          emit({ op: "mov", dst: scratch, src: frame(home(op.message)) });
          emit({ op: "mov", dst: mem(0, 8), src: scratch });
          define(op.id, "reference");
          return;
        }
        case "general-none":
        case "general-null":
          emit({ op: "mov", dst: frame(home(op.id) + 8), src: imm(0) });
          emit({
            op: "mov",
            dst: eax,
            src: imm(op.kind === "general-null" ? 4 : 0),
          });
          define(op.id, "general");
          return;
        case "general-wrap":
          copy(emit, frame(home(op.value)), frame(home(op.id) + 8));
          emit({ op: "mov", dst: eax, src: imm(generalTag(typeOf(op.value))) });
          define(op.id, "general");
          return;
        case "general-record-is":
        case "general-record-descriptor": {
          const reflection = op.kind === "general-record-descriptor";
          const done = fnLabel + ":record-test:" + String(op.id);
          emit({ op: "mov", dst: rax, src: imm(reflection ? -1 : 0) });
          emit({ op: "cmp", dst: frame(home(op.value)), src: imm(5) });
          branch(emit, "ne", done);
          emit({ op: "mov", dst: r9, src: frame(home(op.value) + 8) });
          emit({ op: "test", dst: r9, src: r9 });
          branch(emit, "e", done);
          address(scratch, descriptor(op.record));
          emit({ op: "cmp", dst: mem(9, 0), src: scratch });
          if (reflection)
            emit({ op: "cmovcc", cc: "e", dst: rax, src: scratch });
          else setBoolean(emit, "e", 0);
          emit({ op: "label", name: done });
          if (reflection) numberBits();
          define(op.id, reflection ? "number" : "boolean");
          return;
        }
        case "record-descriptor-address":
          address(rax, descriptor(op.record));
          numberBits();
          define(op.id, "number");
          return;
        case "function-address":
          address(
            rax,
            op.part === "entry"
              ? functionAddress(op.target)
              : signature(op.target),
          );
          numberBits();
          define(op.id, "number");
          return;
        case "general-is": {
          const type = op.type;
          if (type === "absent") {
            // property-load's miss: undefined's tag with payload 1.
            const done = fnLabel + ":absent:" + String(op.id);
            emit({ op: "xor", dst: eax, src: eax });
            emit({ op: "cmp", dst: frame(home(op.value)), src: imm(0) });
            branch(emit, "ne", done);
            emit({ op: "cmp", dst: frame(home(op.value) + 8), src: imm(1) });
            setBoolean(emit, "e", 0);
            emit({ op: "label", name: done });
            define(op.id, "boolean");
            return;
          }
          if (type === "nullish") {
            // Clear the only bit that differs between the two nullish tags.
            emit({ op: "mov", dst: r9, src: frame(home(op.value)) });
            emit({ op: "test", dst: r9, src: imm(-5) });
            setBoolean(emit, "e", 0);
            define(op.id, "boolean");
            return;
          }
          const targetTag =
            type === "undefined" ? 0 : type === "null" ? 4 : generalTag(type);
          const array = typedArrayMarker(type);
          emit({ op: "cmp", dst: frame(home(op.value)), src: imm(targetTag) });
          if (array === 0) setBoolean(emit, "e", 0);
          else {
            const done = fnLabel + ":array-kind:" + String(op.id);
            // MOV leaves the category comparison live.
            emit({ op: "mov", dst: eax, src: imm(0) });
            branch(emit, "ne", done);
            emit({ op: "mov", dst: r9, src: frame(home(op.value) + 8) });
            emit({ op: "test", dst: r9, src: r9 });
            branch(emit, "e", done);
            marker(r9, scratch);
            emit({ op: "cmp", dst: scratch, src: imm(array) });
            setBoolean(emit, "e", 0);
            emit({ op: "label", name: done });
          }
          define(op.id, "boolean");
          return;
        }
        case "general-value": {
          if (op.unchecked !== true) {
            emit({
              op: "cmp",
              dst: frame(home(op.value)),
              src: imm(generalTag(op.type)),
            });
            branch(emit, "ne", trapLabel);
          }
          emit({ op: "mov", dst: rax, src: frame(home(op.value) + 8) });
          const array = typedArrayMarker(op.type);
          if (array !== 0) {
            emit({ op: "test", dst: rax, src: rax });
            branch(emit, "e", trapLabel);
            marker(rax, scratch);
            emit({ op: "cmp", dst: scratch, src: imm(array) });
            branch(emit, "ne", trapLabel);
          }
          define(op.id, op.type);
          return;
        }
        case "general-kind": {
          const site = fnLabel + ":typeof:" + String(op.id);
          const done = site + ":done";
          const names = [
            "undefined",
            "number",
            "boolean",
            "string",
            "object",
            "object",
            "symbol",
            "bigint",
          ];
          emit({ op: "mov", dst: r9, src: frame(home(op.value)) });
          for (let tag = 0; tag < names.length; tag++) {
            const name = names[tag];
            if (name === undefined) throw "tagged kind invariant";
            const next = site + ":tag:" + String(tag);
            emit({ op: "cmp", dst: r9, src: imm(tag) });
            branch(emit, "ne", next);
            if (tag === 5) {
              const object = site + ":object";
              emit({ op: "mov", dst: rax, src: frame(home(op.value) + 8) });
              emit({ op: "test", dst: rax, src: rax });
              branch(emit, "e", object);
              address(scratch, descriptor(functionRecord));
              emit({ op: "cmp", dst: mem(0, 0), src: scratch });
              branch(emit, "ne", object);
              emit({ op: "lea", dst: rax, src: literal("function") });
              emit({ op: "jmp", target: label(done) });
              emit({ op: "label", name: object });
            }
            emit({ op: "lea", dst: rax, src: literal(name) });
            emit({ op: "jmp", target: label(done) });
            emit({ op: "label", name: next });
          }
          emit({ op: "jmp", target: label(trapLabel) });
          emit({ op: "label", name: done });
          define(op.id, "string");
          return;
        }
        case "general-equal": {
          if (host === undefined) break;
          const compareText = host.symbolPrefix + "memcmp";
          const site = fnLabel + ":general-equal:" + String(op.id);
          const equal = site + ":equal",
            numeric = site + ":number",
            text = site + ":text",
            done = site + ":done";
          const left = home(op.left),
            right = home(op.right);
          emit({ op: "xor", dst: eax, src: eax });
          emit({ op: "mov", dst: r9, src: frame(left) });
          emit({ op: "cmp", dst: r9, src: frame(right) });
          branch(emit, "ne", done);
          emit({ op: "cmp", dst: r9, src: imm(6) });
          branch(emit, "a", trapLabel);
          emit({ op: "test", dst: r9, src: r9 });
          branch(emit, "e", equal);
          emit({ op: "cmp", dst: r9, src: imm(4) });
          branch(emit, "e", equal);
          emit({ op: "cmp", dst: r9, src: imm(1) });
          branch(emit, "e", numeric);
          emit({ op: "cmp", dst: r9, src: imm(3) });
          branch(emit, "e", text);
          emit({ op: "mov", dst: scratch, src: frame(left + 8) });
          emit({ op: "cmp", dst: scratch, src: frame(right + 8) });
          setBoolean(emit, "e", 0);
          emit({ op: "jmp", target: label(done) });
          emit({ op: "label", name: numeric });
          numbers.binary("===", frame(left + 8), frame(right + 8));
          emit({ op: "jmp", target: label(done) });
          emit({ op: "label", name: text });
          stringEqual(
            frame(left + 8),
            frame(right + 8),
            true,
            site + ":units",
            compareText,
          );
          emit({ op: "jmp", target: label(done) });
          emit({ op: "label", name: equal });
          emit({ op: "mov", dst: eax, src: imm(1) });
          emit({ op: "label", name: done });
          define(op.id, "boolean");
          return;
        }
        case "error-message":
          emit({ op: "mov", dst: scratch, src: frame(home(op.value)) });
          emit({ op: "mov", dst: rax, src: mem(11, 8) });
          define(op.id, "string");
          return;
        case "error-is": {
          const site = fnLabel + ":error-test:" + String(op.id);
          const done = site + ":done",
            yes = site + ":yes";
          emit({ op: "xor", dst: eax, src: eax });
          emit({ op: "cmp", dst: frame(home(op.value)), src: imm(5) });
          branch(emit, "ne", done);
          emit({ op: "mov", dst: r9, src: frame(home(op.value) + 8) });
          emit({ op: "test", dst: r9, src: r9 });
          branch(emit, "e", done);
          const first = op.error === "RangeError" ? 1 : 0;
          const last = op.error === "Error" ? 2 : first;
          for (let kind: number = first; kind <= last; kind++) {
            address(scratch, descriptor(errorRecord + kind));
            emit({ op: "cmp", dst: mem(9, 0), src: scratch });
            branch(emit, "e", yes);
          }
          emit({ op: "jmp", target: label(done) });
          emit({ op: "label", name: yes });
          emit({ op: "mov", dst: eax, src: imm(1) });
          emit({ op: "label", name: done });
          define(op.id, "boolean");
          return;
        }
        case "primitive-wrap":
        case "primitive-reference":
        case "string-reference":
        case "reference-string":
          emit({ op: "mov", dst: rax, src: frame(home(op.value)) });
          if (
            op.kind === "primitive-wrap" ||
            op.kind === "primitive-reference"
          ) {
            emit({ op: "test", dst: rax, src: rax });
            branch(emit, "e", trapLabel);
          }
          define(
            op.id,
            op.kind === "primitive-wrap"
              ? "primitive"
              : op.kind === "reference-string"
                ? "string"
                : "reference",
          );
          return;
        case "unary": {
          const type = typeOf(op.operand);
          const src = frame(home(op.operand));
          const truth = op.operator === "!" || op.operator === "truthy";
          const predicate = truth || op.operator === "is-integer";
          if (type === "general" && truth) {
            generalTruth(
              op.operand,
              op.operator === "!",
              fnLabel + ":truth:" + String(op.id),
            );
            define(op.id, "boolean");
            return;
          }
          if (type === "optional-boolean" && predicate) {
            emit({ op: "xor", dst: eax, src: eax });
            if (truth) {
              emit({ op: "mov", dst: rax, src });
              emit({ op: "and", dst: rax, src: frame(home(op.operand) + 8) });
              if (op.operator === "!")
                emit({ op: "xor", dst: rax, src: imm(1) });
            }
          } else if (
            (type === "string" || type === "optional-string") &&
            predicate
          ) {
            emit({ op: "xor", dst: eax, src: eax });
            if (truth) {
              const absent = fnLabel + ":string-truth:" + String(op.id);
              emit({ op: "mov", dst: scratch, src });
              emit({ op: "test", dst: scratch, src: scratch });
              branch(emit, "e", absent);
              emit({
                op: "cmp",
                dst: mem(11, nativeStringLengthOffset),
                src: imm(0),
              });
              emit({ op: "label", name: absent });
              setBoolean(emit, op.operator === "!" ? "e" : "ne", 0);
            }
          } else if (
            (type === "boolean" ||
              type === "reference" ||
              type === "optional-reference") &&
            predicate
          ) {
            if (op.operator === "is-integer")
              emit({ op: "xor", dst: eax, src: eax });
            else {
              emit({ op: "cmp", dst: src, src: imm(0) });
              setBoolean(emit, op.operator === "!" ? "e" : "ne", 0);
            }
          } else if (
            (type === "number" ||
              (type === "optional-number" && predicate) ||
              op.operator === "boolean-number") &&
            numbers.unary(op.operator, src)
          ) {
            // The numeric selector leaves either the boolean or binary64 bits in RAX.
          } else
            fail(
              "UNSUPPORTED",
              "unsupported instruction unary " +
                op.operator +
                " (" +
                type +
                ")",
            );
          define(op.id, predicate ? "boolean" : "number");
          return;
        }
        case "binary": {
          const type = typeOf(op.left);
          const left = frame(home(op.left)),
            right = frame(home(op.right));
          const equal = op.operator === "===" || op.operator === "==";
          const unequal = op.operator === "!==" || op.operator === "!=";
          if (
            host !== undefined &&
            (type === "string" || type === "optional-string") &&
            (equal || unequal)
          ) {
            stringEqual(
              left,
              right,
              equal,
              fnLabel + ":string-equal:" + String(op.id),
              host.symbolPrefix + "memcmp",
            );
          } else if (
            (type === "boolean" ||
              type === "Uint8Array" ||
              type === "Uint16Array" ||
              type === "Uint32Array" ||
              type === "Float64Array" ||
              type === "reference" ||
              type === "optional-reference") &&
            (equal || unequal)
          ) {
            emit({ op: "mov", dst: rax, src: left });
            emit({ op: "cmp", dst: rax, src: right });
            setBoolean(emit, equal ? "e" : "ne", 0);
          } else if (
            (type === "optional-number" || type === "optional-boolean") &&
            (equal || unequal)
          ) {
            optionalEqual(
              type,
              home(op.left),
              home(op.right),
              equal,
              fnLabel + ":optional:" + String(op.id),
            );
          } else if (
            type !== "number" ||
            !numbers.binary(op.operator, left, right)
          ) {
            fail(
              "UNSUPPORTED",
              "unsupported instruction binary " +
                op.operator +
                " (" +
                type +
                ")",
            );
          }
          const predicate =
            equal || unequal || ["<", "<=", ">", ">="].includes(op.operator);
          define(op.id, predicate ? "boolean" : "number");
          return;
        }
      }
      fail("UNSUPPORTED", "unsupported instruction " + op.kind);
    }

    function terminate(op: Terminator, block: Block): void {
      switch (op.kind) {
        case "return": {
          const id = op.value;
          if (id === undefined) publish(normal, 0, 0);
          else publish(normal, home(id), scalarByteLength(typeOf(id)));
          return;
        }
        case "record":
        case "record-cell":
        case "cell": {
          const alternate = blockLabel(fn.id, op.alternate);
          let field: RecordField;
          if (op.kind === "cell") {
            const cell = fn.environment?.cells[op.cell];
            if (cell === undefined || savedEnvironment === undefined)
              throw "borrowed environment cell invariant";
            field = {
              offset: cell.valueOffset,
              type: cell.type,
              mutable: cell.mutable,
              stateOffset: cell.stateOffset,
            };
            emit({ op: "mov", dst: r9, src: frame(savedEnvironment) });
          } else {
            field = recordField(op.record, op.field);
            guardRecord(op.object, op.record, alternate);
          }
          const state = field.stateOffset;
          if (
            op.kind !== "record" &&
            op.operation === "write" &&
            !field.mutable
          ) {
            emit({ op: "jmp", target: label(alternate) });
            return;
          }
          if (op.kind !== "record") {
            if (state === undefined) throw "x86-64 record cell state invariant";
            if (op.kind === "cell" || op.initialized !== true) {
              emit({
                op: "cmp",
                dst: { ...mem(9, state), width: 8 },
                src: {
                  kind: "imm8",
                  value: op.operation === "initialize" ? 0 : 1,
                },
              });
              branch(emit, "ne", alternate);
            }
          }
          transferField(field, slot(op.slot), op.operation === "read");
          const publishState =
            op.operation === "initialize" ? state : field.presenceOffset;
          if (op.operation !== "read" && publishState !== undefined)
            emit({
              op: "mov",
              dst: { ...mem(9, publishState), width: 8 },
              src: { kind: "imm8", value: 1 },
            });
          if (
            op.kind !== "cell" &&
            op.operation !== "read" &&
            isRootType(field.type)
          )
            remember();
          emit({ op: "jmp", target: label(blockLabel(fn.id, op.consequent)) });
          return;
        }
        case "throw-literal":
          if (host === undefined) break;
          emit({ op: "lea", dst: rax, src: literal(op.value) });
          emit({ op: "mov", dst: frame(callResult), src: imm(3) });
          emit({ op: "mov", dst: frame(callResult + 8), src: rax });
          raise(block, callResult);
          return;
        case "throw":
          raise(block, home(op.value));
          return;
        case "trap":
          emit({ op: "jmp", target: label(trapLabel) });
          return;
        case "jump":
          emit({ op: "jmp", target: label(blockLabel(fn.id, op.target)) });
          return;
        case "branch":
          emit({ op: "cmp", dst: frame(home(op.condition)), src: imm(0) });
          emit({
            op: "jcc",
            cc: "ne",
            target: label(blockLabel(fn.id, op.consequent)),
          });
          emit({ op: "jmp", target: label(blockLabel(fn.id, op.alternate)) });
          return;
      }
      fail("UNSUPPORTED", "unsupported terminator " + op.kind);
    }

    if (managed !== undefined) emit({ op: "align-entry" });
    emit({ op: "label", name: fnLabel });
    const cfi = frameRows(emit, fnLabel);
    const saved = [returnSave, frameSave];
    if (host !== undefined) {
      const enter = fnLabel + ":enter";
      // Test the subtraction before touching the frame, with libc headroom.
      const overflow = fnLabel + ":overflow";
      emit({ op: "mov", dst: scratch, src: rsp });
      emit({ op: "sub", dst: scratch, src: mem(7, nativeStackLimitOffset) });
      branch(emit, "b", overflow);
      emit({
        op: "cmp",
        dst: scratch,
        src: imm(frameBytes + 8 + nativeCStackReserveBytes),
      });
      branch(emit, "ae", enter);
      emit({ op: "label", name: overflow });
      emit({ op: "mov", dst: mem(1, resultPayload), src: imm(0) });
      emit({
        op: "mov",
        dst: rax,
        src: bits(
          nativeStackOverflowPayload % 4294967296,
          Math.floor(nativeStackOverflowPayload / 4294967296),
        ),
      });
      emit({ op: "mov", dst: mem(1, resultPayload + 8), src: rax });
      emit({ op: "mov", dst: mem(1, 0), src: imm(thrown) });
      emit({ op: "mov", dst: eax, src: imm(thrown) });
      emit({ op: "ret" });
      emit({ op: "label", name: enter });
    }
    emit({ op: "push", src: rbp });
    if (host !== undefined) cfi.record(dwarfStackPointer, 16, saved);
    emit({ op: "mov", dst: rbp, src: rsp });
    if (host !== undefined) cfi.record(dwarfFramePointer, 16, saved);
    emit({ op: "sub", dst: rsp, src: imm(frameBytes) });
    emit({ op: "mov", dst: frame(savedResult), src: result });
    emit({ op: "mov", dst: frame(savedContext), src: context });
    if (savedEnvironment !== undefined)
      emit({ op: "mov", dst: frame(savedEnvironment), src: environment });
    const receiverSlot = fn.receiverSlot;
    if (receiverSlot !== undefined) {
      const offset = slot(receiverSlot),
        absent = fnLabel + ":receiver-absent";
      emit({ op: "mov", dst: frame(offset), src: imm(0) });
      emit({ op: "mov", dst: frame(offset + 8), src: imm(0) });
      emit({ op: "test", dst: receiver, src: receiver });
      emit({ op: "jcc", cc: "e", target: label(absent) });
      copy(emit, mem(2, 0), frame(offset));
      copy(emit, mem(2, 8), frame(offset + 8));
      emit({ op: "label", name: absent });
    }
    const args = argumentsByFunction[fn.id];
    if (args === undefined) throw "parameter layout invariant";
    for (const arg of args) {
      if (arg === undefined) throw "parameter invariant";
      const offset = slot(arg.slot);
      if (arg.kind === "float")
        emit({ op: "movsd", dst: frame(offset), src: xmm(arg.index) });
      else {
        const source =
          arg.kind === "integer" ? gpr(arg.index) : frame(16 + arg.index);
        if (scalarByteLength(arg.type) === 16) {
          emit({ op: "mov", dst: scratch, src: source });
          copy(emit, mem(11, 0), frame(offset));
          copy(emit, mem(11, 8), frame(offset + 8));
        } else {
          emit({ op: "mov", dst: rax, src: source });
          emit({ op: "mov", dst: frame(offset), src: rax });
        }
      }
    }
    if (signpost !== undefined) {
      if (signpost.metrics === true) {
        const arg =
          signpost.force === undefined
            ? undefined
            : fn.parameters[signpost.force];
        collectionBefore(
          emit,
          fnLabel,
          frame(savedContext),
          metric,
          arg === undefined ? undefined : frame(slot(arg)),
        );
      }
      interval(signpost, false);
    }
    if (fn.entry !== 0)
      emit({ op: "jmp", target: label(blockLabel(fn.id, fn.entry)) });
    if (debugSpans) {
      const debug = fn.debug;
      const parameters: X64DebugParameter[] = [];
      if (debug !== undefined) {
        const overwritten = new Set<number>();
        for (const block of fn.blocks) {
          if (block === undefined) throw "debug block invariant";
          if (block.exception !== undefined)
            overwritten.add(block.exception.slot);
          for (const op of block.instructions)
            if (op?.kind === "store") overwritten.add(op.slot);
        }
        for (const binding of debug.slots) {
          if (binding === undefined) throw "debug slot invariant";
          const variable = debug.variables[binding.variable];
          const type = fn.slots[binding.slot];
          if (
            variable !== undefined &&
            variable.parameter === true &&
            variable.inline === undefined &&
            fn.parameters.includes(binding.slot) &&
            !overwritten.has(binding.slot) &&
            (type === "number" || type === "boolean")
          )
            parameters.push({
              name: variable.name,
              start: variable.start,
              end: variable.end,
              type,
              frameOffset: slot(binding.slot),
            });
        }
      }
      debugFrames.set(fn.id, parameters);
      emit({ op: "label", name: fnLabel + ":debug-body" });
    }
    for (const block of fn.blocks) {
      if (block === undefined) throw "block invariant";
      blockId = block.id;
      emit({ op: "label", name: blockLabel(fn.id, block.id) });
      for (let index = 0; index < block.instructions.length; index++) {
        const op = block.instructions[index];
        if (op === undefined) throw "instruction invariant";
        span = { start: op.start, end: op.end };
        markSource(span);
        instruction(op, block, index);
      }
      const op = block.terminator;
      span = { start: op.start, end: op.end };
      markSource(span);
      terminate(op, block);
    }
    emit({ op: "label", name: done });
    if (debugSpans) markSource({ start: 0, end: 0 });
    if (signpost !== undefined) {
      if (signpost.metrics === true) {
        collectionAfter(emit, frame(savedContext), metric);
        probes.probe("gc__end", collectionProbeArguments);
      }
      interval(signpost, true);
    }
    emit({ op: "mov", dst: rsp, src: rbp });
    emit({ op: "pop", dst: rbp });
    if (host !== undefined) cfi.record(dwarfStackPointer, 8, [returnSave]);
    emit({ op: "ret" });
    emit({ op: "label", name: fnEnd });
    if (host !== undefined)
      unwind.push({ start: fnLabel, end: fnEnd, rule: "rows", rows: cfi.rows });
    if (callSites.length > 0)
      for (const map of frameStackMaps(
        fn,
        fnLabel,
        frameBytes,
        slots,
        homes,
        types,
        callSites,
        fn.closureEnvironment === undefined ? undefined : savedEnvironment,
      ))
        if (map !== undefined) pendingMaps.push(map);
  }

  function collectorLeaves(): void {
    // Allocation from a reused nursery (or an old range released by a
    // major) must still produce cleared storage, including record padding.
    emit({ op: "label", name: clearAllocationLabel });
    emit({ op: "mov", dst: context, src: rax });
    emit({ op: "mov", dst: result, src: gpr(10) });
    const clear = clearAllocationLabel + ":word";
    emit({ op: "label", name: clear });
    emit({ op: "mov", dst: mem(7, 0), src: imm(0) });
    emit({ op: "add", dst: context, src: imm(8) });
    emit({ op: "sub", dst: result, src: imm(8) });
    branch(emit, "ne", clear);
    emit({ op: "ret" });

    // Context in RDI, written object in R9. Only old objects may have an
    // edge to the next nursery. The serial dirty bit deduplicates the queue.
    emit({ op: "label", name: rememberLabel });
    const done = rememberLabel + ":done";
    const overflow = rememberLabel + ":overflow";
    emit({ op: "mov", dst: scratch, src: mem(7, allocationStateOffset) });
    emit({ op: "cmp", dst: { ...mem(11, 24), width: 32 }, src: imm(0) });
    branch(emit, "e", done);
    emit({ op: "mov", dst: rax, src: gpr(9) });
    emit({ op: "sub", dst: rax, src: mem(7, managedBaseOffset) });
    emit({ op: "mov", dst: word(10), src: { ...mem(11, 12), width: 32 } });
    emit({ op: "cmp", dst: rax, src: gpr(10) });
    branch(emit, "ae", done);
    emit({ op: "mov", dst: gpr(10), src: rax });
    emit({ op: "shr", dst: gpr(10), count: 6 });
    emit({ op: "add", dst: gpr(10), src: mem(11, 32) });
    emit({ op: "mov", dst: result, src: rax });
    emit({ op: "shr", dst: result, count: 3 });
    emit({ op: "and", dst: result, src: imm(7) });
    emit({ op: "mov", dst: word(8), src: imm(1) });
    emit({ op: "shl", dst: word(8), count: "cl" });
    const card: Memory<8> = { ...mem(10, 0), width: 8 };
    emit({ op: "test", dst: card, src: byte(8) });
    branch(emit, "ne", done);
    emit({ op: "or", dst: card, src: byte(8) });
    emit({ op: "mov", dst: word(8), src: { ...mem(11, 48), width: 32 } });
    emit({ op: "cmp", dst: word(8), src: { ...mem(11, 52), width: 32 } });
    branch(emit, "ae", overflow);
    emit({ op: "cvtsi2sd", dst: xmm(0), src: rax });
    emit({ op: "mov", dst: gpr(10), src: mem(11, 40) });
    emit({
      op: "movsd",
      dst: {
        kind: "mem",
        width: 64,
        address: { kind: "base", base: 10, index: 8, scale: 8, disp: 0 },
      },
      src: xmm(0),
    });
    emit({ op: "add", dst: { ...mem(11, 48), width: 32 }, src: imm(1) });
    emit({ op: "ret" });
    emit({ op: "label", name: overflow });
    emit({ op: "mov", dst: { ...mem(11, 56), width: 32 }, src: imm(1) });
    emit({ op: "label", name: done });
    emit({ op: "ret" });
  }

  try {
    if (
      generational &&
      !trackedManagedWrites(module, undefined, trustedExecutableCode)
    )
      fail(
        "INVALID_IR",
        "generational mutator requires tracked managed writes",
      );
    for (const fn of module.functions) {
      if (fn === undefined) throw "function invariant";
      const args = argumentLayout(fn);
      argumentsByFunction.push(args);
      let parameters = "";
      for (const arg of args)
        if (arg !== undefined) parameters += ":" + arg.type;
      signatures.push({
        parameters,
        name: "signature:" + fn.returnType + parameters,
      });
    }
    const abi = managed?.bindings;
    if (abi !== undefined) {
      const witnesses = new Uint8Array(module.functions.length);
      for (const fn of module.functions) {
        if (fn === undefined) throw "managed function invariant";
        for (const block of fn.blocks) {
          if (block === undefined) throw "managed block invariant";
          for (const op of block.instructions)
            if (op?.kind === "function-new" || op?.kind === "call-indirect")
              witnesses[op.target] =
                (witnesses[op.target] ?? 0) |
                (op.kind === "function-new" ? 1 : 2);
        }
      }
      brand = bindManagedABI(
        module,
        abi,
        witnesses,
        {
          requests: abiRequests,
          entries: entryImports,
          signatures: signatureImports,
          records: recordImports,
        },
        (code, message) => fail(code, message),
      );
      for (let index = 0; index < abiRequests.length; index++)
        importedAddress(index);
    }
    const published = managed;
    if (published !== undefined) {
      descriptor(functionRecord);
      for (const record of published.records)
        if (record !== undefined) descriptor(record);
      for (const fn of published.functions) if (fn !== undefined) signature(fn);
    }
    for (const fn of module.functions) {
      if (fn === undefined) throw "function invariant";
      for (const block of fn.blocks) {
        if (block === undefined) throw "block invariant";
        for (const op of block.instructions) {
          if (op?.kind !== "function-new") continue;
          const shape = signatures[op.target];
          if (shape === undefined) throw "function signature invariant";
          signature(op.target);
          let matches = discardSignatures.get(shape.parameters);
          if (matches === undefined) {
            matches = new Set<string>();
            discardSignatures.set(shape.parameters, matches);
          }
          matches.add(shape.name);
        }
      }
    }
    for (const fn of module.functions) {
      if (fn === undefined) throw "function invariant";
      functionId = fn.id;
      blockId = undefined;
      span = undefined;
      if (generational && fn.environment !== undefined)
        for (const cell of fn.environment.cells) {
          if (cell === undefined) throw "environment cell invariant";
          if (isRootType(cell.type))
            fail(
              "INVALID_IR",
              "generational mutator cannot track a borrowed reference environment",
            );
        }
      if (fn.import !== true) body(fn);
    }
    // A declaration by itself also needs a linker binding.
    for (const fn of module.functions) {
      if (fn?.import !== true) continue;
      if (entryImports.has(fn.id)) continue;
      functionId = fn.id;
      blockId = undefined;
      span = undefined;
      fail("UNSUPPORTED", "unsupported managed import " + fn.name);
    }
    functionId = undefined;
    blockId = undefined;
    span = undefined;
    const leafStart = "tint:leaf-helpers";
    const leafEnd = leafStart + ":end";
    emit({ op: "label", name: leafStart });
    numbers.helpers();
    if (generational) collectorLeaves();
    probes.emitStubs();
    if (jitDebug) {
      emit({ op: "label", name: debugRegister });
      emit({ op: "nop" });
      emit({ op: "ret" });
    }
    emit({ op: "label", name: leafEnd });
    if (host !== undefined)
      unwind.push({ start: leafStart, end: leafEnd, rule: "leaf", rows: [] });
    if (needsCollectorWorker) {
      // SysV void*(void*) entry. The permanent work closure gets its own
      // bounded, nonallocating context, with no mutator stack or root chain.
      const rsp = gpr(4);
      const rbp = gpr(5);
      const rdi = gpr(7);
      const rsi = gpr(6);
      const rdx = gpr(2);
      const rcx = gpr(1);
      const entry = gpr(11);
      const done = collectorWorker + ":done";
      const end = collectorWorker + ":end";
      const saveOffset = contextBytes + resultBytes;
      const bytes = saveOffset + (far ? 16 : 0);
      const cfi = frameRows(emit, collectorWorker);
      const saved = [returnSave, frameSave];
      emit({ op: "label", name: collectorWorker });
      emit({ op: "push", src: rbp });
      cfi.record(dwarfStackPointer, 16, saved);
      emit({ op: "sub", dst: rsp, src: imm(bytes) });
      cfi.record(dwarfStackPointer, bytes + 16, saved);
      if (far) {
        emit({ op: "mov", dst: mem(4, saveOffset), src: gpr(14) });
        emit({ op: "mov", dst: mem(4, saveOffset + 8), src: gpr(15) });
        const farSaved = saved.slice();
        farSaved.push(
          { register: 14, offset: -32 },
          { register: 15, offset: -24 },
        );
        cfi.record(dwarfStackPointer, bytes + 16, farSaved);
      }
      for (let offset = 0; offset < contextBytes; offset += 8)
        emit({ op: "mov", dst: mem(4, offset), src: imm(0) });
      emit({ op: "lea", dst: rax, src: mem(4, -262144) });
      emit({ op: "mov", dst: mem(4, nativeStackLimitOffset), src: rax });
      emit({ op: "cvtsi2sd", dst: xmm(0), src: rdi });
      emit({ op: "mov", dst: rax, src: mem(7, 0) });
      emit({
        op: "mov",
        dst: rsi,
        src: mem(0, nativeFunctionEnvironmentOffset),
      });
      emit({ op: "mov", dst: entry, src: mem(0, nativeFunctionEntryOffset) });
      emit({ op: "mov", dst: rdi, src: rsp });
      emit({ op: "xor", dst: word(2), src: word(2) });
      emit({ op: "lea", dst: rcx, src: mem(4, contextBytes) });
      emit({ op: "xor", dst: word(5), src: word(5) });
      emit({ op: "call", target: entry });
      emit({ op: "cmp", dst: eax, src: imm(normal) });
      emit({ op: "mov", dst: eax, src: imm(70) });
      branch(emit, "ne", done);
      emit({
        op: "cvttsd2si",
        dst: rax,
        src: mem(4, contextBytes + resultPayload),
      });
      emit({ op: "label", name: done });
      if (far) {
        emit({ op: "mov", dst: gpr(14), src: mem(4, saveOffset) });
        emit({ op: "mov", dst: gpr(15), src: mem(4, saveOffset + 8) });
      }
      emit({ op: "add", dst: rsp, src: imm(bytes) });
      cfi.record(dwarfStackPointer, 16, [returnSave, frameSave]);
      emit({ op: "pop", dst: rbp });
      cfi.record(dwarfStackPointer, 8, [returnSave]);
      emit({ op: "ret" });
      emit({ op: "label", name: end });
      unwind.push({
        start: collectorWorker,
        end,
        rule: "rows",
        rows: cfi.rows,
      });
    }
    if (callbackThunks.size !== 0) {
      emit({ op: "label", name: callbackThunksLabel });
      for (const [site, thunk] of callbackThunks) {
        if (thunk === undefined) throw "callback thunk invariant";
        unwind.push(
          emitCallbackThunk({
            emit,
            site,
            thunk,
            call: foreign,
            constant,
            trap: trapLabel,
            far,
          }),
        );
      }
      emit({ op: "label", name: callbackThunksLabel + ":end" });
    }
    emit({ op: "label", name: trapLabel });
    emit({ op: "ud2" });
    const callbackKeyOffset = needsCallbackKey
      ? constants.length * 8
      : undefined;
    if (callbackKeyOffset !== undefined)
      external.set(callbackKeyLabel, {
        kind: "data",
        offset: callbackKeyOffset,
      });
    const sharedDataBytes =
      constants.length * 8 + (callbackKeyOffset === undefined ? 0 : 8);
    if (jitDebug)
      external.set(debugDescriptor, { kind: "data", offset: sharedDataBytes });
    // Reserve the complete module span before copying code chunks. Large
    // compilations cannot keep separate instruction, pool and map buffers.
    const instructionBytes = assembler.byteLength();
    const poolBase = Math.ceil(instructionBytes / 8) * 8;
    const constantsBase = poolBase + poolBytes;
    const poolEnd = constantsBase + (live ? constants.length * 8 : 0);
    const withPool = poolEnd > poolBase ? poolEnd : instructionBytes;
    const tableOffset = Math.ceil(withPool / 8) * 8;
    const stackMaps: X64Module["stackMaps"][number][] = [];
    let stackMapPlan: WideStackMapPlan | undefined;
    if (host !== undefined) {
      const entries: SafepointEntry[] = [];
      for (const site of pendingMaps) {
        if (site === undefined) throw "x86-64 safepoint invariant";
        const offset = assembler.labels.get(site.label);
        const start = assembler.labels.get(site.functionLabel);
        if (offset === undefined || start === undefined)
          throw "x86-64 safepoint label invariant";
        entries.push({ offset, start, map: site.map });
      }
      pendingMaps.length = 0;
      stackMapPlan = planWideStackMapTable(entries);
      const thunkStart = assembler.labels.get(callbackThunksLabel);
      stackMaps.push({
        codeOffset: 0,
        codeLength: thunkStart ?? instructionBytes,
        tableOffset,
      });
      if (thunkStart !== undefined) {
        const end = assembler.labels.get(callbackThunksLabel + ":end");
        if (end === undefined) throw "callback range invariant";
        stackMaps.push({
          codeOffset: thunkStart,
          codeLength: end - thunkStart,
          tableOffset: -1,
        });
      }
    }
    const encoded = assembler.finish(
      (name) =>
        name === hostedThreadEntryLabel ||
        external.has(name) ||
        strings.has(name) ||
        descriptors.has(name),
      stackMapPlan === undefined
        ? withPool
        : tableOffset + (stackMapPlan.wordLength + 2) * 8,
    );
    const code = encoded.bytes;
    const functions: X64Function[] = [];
    for (const fn of module.functions) {
      if (fn === undefined) throw "function invariant";
      if (fn.import === true) {
        functions.push({
          id: fn.id,
          name: fn.name,
          import: true,
          offset: 0,
          byteLength: 0,
        });
        continue;
      }
      const name = functionLabel(fn.id);
      const offset = encoded.labels.get(name);
      const end = encoded.labels.get(name + ":end");
      if (offset === undefined || end === undefined)
        throw "function label invariant";
      const body = encoded.labels.get(name + ":debug-body");
      const leave = encoded.labels.get(name + ":return");
      const parameters = debugFrames.get(fn.id);
      const frame =
        body === undefined ||
        leave === undefined ||
        parameters === undefined ||
        body >= leave
          ? undefined
          : { offset: body, byteLength: leave - body, parameters };
      functions.push({
        id: fn.id,
        name: fn.name,
        offset,
        byteLength: end - offset,
        ...(frame === undefined ? {} : { frame }),
      });
    }
    if (stackMapPlan !== undefined) {
      let offset = tableOffset;
      function writeMapWord(value: number): void {
        if (
          !writeWord64(
            code,
            offset,
            {
              lo: value % 4294967296,
              hi: Math.floor(value / 4294967296),
            },
            "little",
          ).ok
        )
          throw "x86-64 stack map word invariant";
        offset += 8;
      }
      stackMapPlan.forEachWord(writeMapWord);
      writeMapWord(nativeStackMapFooterMagic);
      writeMapWord(tableOffset);
    }
    if (poolEnd > poolBase) {
      for (const [, item] of strings) {
        if (item === undefined) throw "x86-64 literal invariant";
        const start = poolBase + item.offset;
        code[start] = 1;
        if (
          !writeUnsigned(
            code,
            start + nativeStringLengthOffset,
            4,
            item.value.length,
            "little",
          ).ok
        )
          throw "x86-64 literal length invariant";
        for (let i = 0; i < item.value.length; i++)
          if (
            !writeUnsigned(
              code,
              start + nativeStringDataOffset + i * 2,
              2,
              item.value.charCodeAt(i),
              "little",
            ).ok
          )
            throw "x86-64 literal unit invariant";
      }
    }
    for (const [, item] of descriptors) {
      if (item === undefined) throw "x86-64 descriptor invariant";
      for (let index = 0; index < item.words.length; index++) {
        const value = item.words[index];
        if (
          value === undefined ||
          !writeWord64(
            code,
            poolBase + item.offset + index * 8,
            { lo: value, hi: 0 },
            "little",
          ).ok
        )
          throw "x86-64 descriptor word invariant";
      }
    }
    const imageFixups: RelativeFixup[] = [];
    const hostedThreadFixups: RelativeFixup[] = [];
    const managedFixups: X64ManagedReference[] = [];
    for (const fixup of encoded.externalFixups) {
      if (fixup === undefined) throw "x86-64 fixup invariant";
      if (fixup.ref.label === hostedThreadEntryLabel) {
        hostedThreadFixups.push(fixup);
        continue;
      }
      const imported = managedNames.get(fixup.ref.label);
      if (imported !== undefined && managed?.mode === "service") {
        managedFixups.push({ fixup, import: imported });
        continue;
      }
      const local =
        strings.get(fixup.ref.label)?.offset ??
        descriptors.get(fixup.ref.label)?.offset;
      const constant = live ? external.get(fixup.ref.label) : undefined;
      const offset =
        constant?.kind === "data"
          ? constantsBase + constant.offset
          : local === undefined
            ? undefined
            : poolBase + local;
      if (offset === undefined) imageFixups.push(fixup);
      else {
        const status = patchRelative(code, fixup, fixup.fieldOffset, offset);
        if (status === "range") throw "x86-64 rel32 displacement out of range";
        if (status !== "complete") throw "x86-64 pool fixup invariant";
      }
    }
    const data = new Uint8Array(
      live ? 0 : sharedDataBytes + (jitDebug ? 24 : 0),
    );
    if (jitDebug) data[sharedDataBytes] = 1; // struct jit_descriptor.version
    for (let i = 0; i < constants.length; i++) {
      const word = constants[i];
      if (
        word === undefined ||
        !writeWord64(
          live ? code : data,
          (live ? constantsBase : 0) + i * 8,
          word,
          "little",
        ).ok
      )
        throw "binary64 data invariant";
    }
    const relocations = imageRelocations(imageFixups, external);
    const managedImports: NativeManagedPointerImport[] = [];
    for (let index = 0; index < abiRequests.length; index++) {
      const request = abiRequests[index];
      const slot = descriptors.get("managed:" + String(index));
      if (request === undefined || slot === undefined)
        throw "managed import invariant";
      managedImports.push({ ...request, offset: poolBase + slot.offset });
    }
    const nativeRecords: X64Record[] = [];
    let functionDescriptor: X64Record | undefined;
    for (const [record, name] of recordNames) {
      const item = descriptors.get(name);
      if (item === undefined) throw "managed record invariant";
      const info = { record, offset: poolBase + item.offset };
      if (record === functionRecord) functionDescriptor = info;
      else if (record < functionRecord) nativeRecords.push(info);
    }
    const nativeSignatures: X64Signature[] = [];
    for (const [name, members] of signatureMembers) {
      const id = members[0];
      if (id === undefined) throw "managed signature member invariant";
      const fn = module.functions[id];
      const item = descriptors.get(name);
      if (fn === undefined || item === undefined)
        throw "managed signature invariant";
      const args = argumentsByFunction[id];
      if (args === undefined) throw "managed signature arguments invariant";
      const parameters: ScalarType[] = [];
      for (const arg of args) {
        if (arg === undefined) throw "managed argument invariant";
        parameters.push(arg.type);
      }
      nativeSignatures.push({
        functions: members,
        offset: poolBase + item.offset,
        parameters,
        returnType: fn.returnType,
      });
    }
    const sourceRanges: X64SourceRange[] = [];
    const debugRegisterOffset = encoded.labels.get(debugRegister);
    for (let index = 0; index + 1 < sourceLabels.length; index++) {
      const row = sourceLabels[index],
        next = sourceLabels[index + 1];
      if (row === undefined || next === undefined)
        throw "debug label invariant";
      if (row.span.start >= row.span.end) continue;
      const offset = encoded.labels.get(row.name);
      const end = encoded.labels.get(next.name);
      if (offset === undefined || end === undefined)
        throw "debug source boundary invariant";
      if (end > offset)
        sourceRanges.push({ ...row.span, offset, byteLength: end - offset });
    }
    return {
      ok: true,
      value: {
        code,
        data,
        functions,
        imports: [...imports],
        hostedThreadFixups,
        far,
        linearAllocation: inlineAllocation,
        generationalBarriers: generational,
        managedImports,
        managedFixups,
        ...(live ? { liveSlotOffset: poolBase } : {}),
        ...(debugRegisterOffset === undefined
          ? {}
          : {
              jitDebug: {
                descriptorOffset: sharedDataBytes,
                registerOffset: debugRegisterOffset,
              },
            }),
        ...(functionDescriptor === undefined ? {} : { functionDescriptor }),
        signatures: nativeSignatures,
        records: nativeRecords,
        unwind: resolveUnwind(unwind, encoded.labels),
        sourceRanges,
        probes: probes.resolve(encoded.labels),
        ...(callbackKeyOffset === undefined ? {} : { callbackKeyOffset }),
        stackMaps,
        addressFixups: relocations.addressFixups,
        ...(relocations.relativeFixups === undefined
          ? {}
          : { relativeFixups: relocations.relativeFixups }),
        ...(relocations.patchAddress === undefined
          ? {}
          : { patchAddress: relocations.patchAddress }),
      },
    };
  } catch (caught) {
    return {
      ok: false,
      error: failure ?? {
        code: "ENCODING",
        message:
          typeof caught === "string"
            ? caught
            : "x86-64 scalar: encoding failed",
        function: functionId,
        block: blockId,
        span,
      },
    };
  }
}
