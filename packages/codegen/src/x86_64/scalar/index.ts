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
  nativeStackMapFooterMagic,
  nativeStackLimitOffset,
  nativeStackOverflowPayload,
  type PosixHostFacts,
} from "@tint/abi/host";
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
  verify,
  type Block,
  type FunctionIR,
  type Instruction,
  type ModuleIR,
  type RecordField,
  type RecordLayout,
  type ScalarType,
  type Span,
  type Terminator,
} from "@tint/ir/scalar";
import {
  encodeLayout,
  writeRel32,
  type NearFixup,
  type Instruction as MachineInstruction,
  type Address,
  type Memory,
} from "../isa.ts";
import {
  bits,
  byte,
  gpr,
  heapCursorOffset,
  heapEndOffset,
  rip,
  imm,
  imageRelocations,
  label,
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
  sysVOutgoingBytes,
  sysVStagingBytes,
} from "./foreign.ts";
import { branch, emitHostCall, exactInteger } from "./host.ts";
import { createNumberEmission, floatBits } from "./numbers.ts";
import { nativeSignatureTypeCode } from "../../scalar/signature.ts";
import {
  encodeWideStackMapTable,
  rootHeadBinding,
  type SafepointEntry,
} from "../../scalar/stack-maps.ts";
import {
  frameStackMaps,
  isRootType,
  type PendingSafepoint,
} from "./stack-maps.ts";

export { imageRelocations } from "./machine.ts";
export { appendExitEntry } from "./exit-entry.ts";

export interface X64Function {
  readonly id: number;
  readonly name: string;
  readonly offset: number;
}
export interface X64Module extends ImageRelocations {
  readonly code: Uint8Array;
  readonly data: Uint8Array;
  readonly functions: readonly X64Function[];
  readonly imports: readonly string[];
  readonly stackMaps: readonly {
    readonly codeOffset: number;
    readonly codeLength: number;
    readonly tableOffset: number;
  }[];
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

  const machine: MachineInstruction[] = [];
  const pendingMaps: PendingSafepoint[] = [];
  const emit: Emit = (insn) => {
    machine.push(insn);
  };
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
  function poolWords(name: string, words: readonly number[]): void {
    descriptors.set(name, { offset: poolBytes, words });
    poolBytes += words.length * 8;
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
  function descriptor(record: number): Memory<64> {
    const name = "record:" + String(record);
    if (!descriptors.has(name)) {
      const layout =
        record === functionRecord ? functionLayout : module.records?.[record];
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
  function importSlot(symbol: string): Memory<64> {
    imports.add(symbol);
    const key = "import:" + symbol;
    external.set(key, { kind: "import", name: symbol });
    return rip(key);
  }
  function foreign(symbol: string): void {
    emit({ op: "call", target: importSlot(symbol) });
  }

  const argumentsByFunction: Argument[][] = [];

  const signatures: { parameters: string; name: string }[] = [];
  const discardSignatures = new Map<string, Set<string>>();
  function signature(target: number): Memory<64> {
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
    let depth = -(savedEnvironment ?? callResult);
    let outgoing = 0;
    let needsForeign = false;
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
          if (op.call.mayCallback === true)
            fail(
              "UNSUPPORTED",
              "C callbacks are not supported on linux-x86_64",
            );
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
        if (op.kind === "call" || op.kind === "call-indirect") {
          const args = argumentsByFunction[op.target];
          if (args === undefined) throw "call layout invariant";
          for (const arg of args)
            if (arg?.kind === "stack")
              outgoing = Math.max(outgoing, arg.index + 8);
        }
      }
    }
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
        copyFrame(from, slot(handler.slot), 16);
        emit({ op: "jmp", target: label(blockLabel(fn.id, handler.target)) });
      }
    }

    const callSites: { block: number; index: number; label: string }[] = [];
    const ownRootHead = host !== undefined && rootHeadBinding(fn);
    function safepoint(block: Block, index: number): void {
      if (host === undefined) return;
      const name = fnLabel + ":safepoint:" + String(callSites.length);
      emit({ op: "label", name });
      callSites.push({ block: block.id, index, label: name });
    }

    const r10 = gpr(10),
      rdx = gpr(2),
      r9 = gpr(9);
    const x0 = xmm(0);
    const absent = bits(optionalNumberAbsentLow, optionalNumberAbsentHigh);
    function call(op: Instruction, block: Block, index: number): void {
      if (op.kind !== "call" && op.kind !== "call-indirect")
        throw "call invariant";
      const args = argumentsByFunction[op.target];
      const callee = module.functions[op.target];
      if (args === undefined || callee === undefined) throw "callee invariant";
      if (callee.import === true)
        fail("UNSUPPORTED", "unsupported managed import " + callee.name);
      if (op.kind === "call-indirect") {
        guardRecord(op.callee, functionRecord, trapLabel);
        emit({
          op: "mov",
          dst: rax,
          src: mem(9, nativeFunctionSignatureOffset),
        });
        emit({ op: "lea", dst: scratch, src: signature(op.target) });
        emit({ op: "cmp", dst: rax, src: scratch });
        if (op.discardResult === true) {
          const shape = signatures[op.target];
          if (shape === undefined) throw "discarded result signature invariant";
          const valid = fnLabel + ":signature:" + String(machine.length);
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
      emit({
        op: "call",
        target:
          op.kind === "call-indirect" ? r10 : label(functionLabel(op.target)),
      });
      safepoint(block, index);
      const received = fnLabel + ":call:" + String(machine.length);
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
    // The bounded runtime owns a fresh zero-filled arena. A future collector
    // can use the same allocation boundary, before constructor publication.
    function allocate(block: Block, site: string, denied: string): void {
      emit({ op: "mov", dst: rdx, src: frame(savedContext) });
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
      const fits = site + ":fits";
      emit({ op: "cmp", dst: scratch, src: mem(2, heapEndOffset) });
      branch(emit, "be", fits);
      emit({ op: "label", name: denied });
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
      emit({ op: "label", name: fits });
      emit({ op: "mov", dst: mem(2, heapCursorOffset), src: scratch });
    }

    function ownedArray(
      op: {
        readonly id: number;
        readonly type: ScalarType;
        readonly length: number;
      },
      block: Block,
    ): void {
      const site = fnLabel + ":array:" + String(op.id);
      const denied = site + ":invalid";
      const width = arrayWidth(op.type);
      exactInteger(emit, frame(home(op.length)), r9, denied);
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
      allocate(block, site, denied);
      emit({ op: "mov", dst: mem(0, 0), src: imm(arrayMarker(width)) });
      emit({ op: "mov", dst: mem(0, nativeArrayLengthOffset), src: r9 });
      emit({ op: "lea", dst: r10, src: mem(0, nativeArrayInlineOffset) });
      emit({ op: "mov", dst: mem(0, nativeArrayDataOffset), src: r10 });
      define(op.id, op.type);
    }

    function arrayView(
      op: {
        readonly id: number;
        readonly array: number;
        readonly begin: number;
        readonly length: number;
      },
      block: Block,
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
      allocate(block, site, denied);
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
      const invalid = fnLabel + ":index:" + String(machine.length);
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
      foreign(symbol);
      emit({ op: "mov", dst: eax, src: imm(1) });
      emit({ op: "jmp", target: label(done) });
      emit({ op: "label", name: invalid });
      emit({ op: "xor", dst: eax, src: eax });
      emit({ op: "label", name: done });
      define(op.id, "boolean");
    }

    // RDI/RSI hold the two string bases (RDI may already be advanced by a
    // code-unit offset), RDX the equal-length comparison extent in units.
    function compareUnits(symbol: string, equal: boolean): void {
      emit({ op: "lea", dst: gpr(7), src: mem(7, nativeStringDataOffset) });
      emit({ op: "lea", dst: gpr(6), src: mem(6, nativeStringDataOffset) });
      emit({ op: "shl", dst: rdx, count: 1 });
      foreign(symbol);
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
    ): void {
      const layout = module.records?.[op.record];
      if (layout === undefined) throw "x86-64 record constructor invariant";
      const site = fnLabel + ":record:" + String(op.id);
      emit({ op: "mov", dst: word(10), src: imm(layout.byteLength) });
      allocate(block, site, site + ":denied");
      emit({ op: "mov", dst: r9, src: rax });
      emit({ op: "lea", dst: scratch, src: descriptor(op.record) });
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
      emit({ op: "lea", dst: scratch, src: descriptor(record) });
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
          if (
            access.operation === "callback-key" ||
            access.operation === "callback-address"
          )
            return fail(
              "UNSUPPORTED",
              "C callbacks are not supported on linux-x86_64",
            );
          if (abi === undefined)
            return fail(
              "UNSUPPORTED",
              "C memory requires the hosted x86-64 target",
            );
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
            site: fnLabel + ":c-memory:" + String(machine.length),
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
          const site: CallSite = {
            emit,
            abi,
            prototype: op.call,
            argument: (index) => {
              const arg = args[index];
              if (arg === undefined) throw "SysV C argument invariant";
              return frame(home(arg));
            },
            call: foreign,
            staging: (offset) => frame(staging + offset),
            stack: frame(-frameBytes),
            constant,
            site: fnLabel + ":c:" + String(machine.length),
            trap: trapLabel,
          };
          if (op.call.dynamic === true) emitSysVDynamicCall(site);
          else emitSysVCall(site, layout);
          const id = op.id;
          if (id !== undefined)
            define(id, op.call.result === "boolean" ? "boolean" : "number");
          return;
        }
        case "host-call": {
          const args = op.arguments;
          const id = op.id;
          if (
            host === undefined ||
            id === undefined ||
            !emitHostCall({
              operation: op.operation,
              emit,
              policy: host,
              argument: (index) => {
                const arg = args[index];
                if (arg === undefined) throw "host argument invariant";
                return frame(home(arg));
              },
              call: foreign,
              scratch: frame(callResult),
              scratchNext: frame(callResult + 8),
              context: frame(savedContext),
              ownRootHead,
              constant,
              site: fnLabel + ":host:" + String(machine.length),
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
          define(id, "number");
          return;
        }
        case "array-new":
          if (host === undefined) break;
          ownedArray(op, block);
          return;
        case "array-subarray":
          if (host === undefined) break;
          arrayView(op, block);
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
          constructRecord(op, block);
          return;
        case "record-read": {
          const field = recordField(op.record, op.field);
          emit({ op: "mov", dst: r9, src: frame(home(op.object)) });
          transferField(field, home(op.id), true);
          types.set(op.id, field.type);
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
          allocate(block, site, site + ":denied");
          emit({ op: "mov", dst: r9, src: rax });
          emit({ op: "lea", dst: rax, src: descriptor(functionRecord) });
          emit({ op: "mov", dst: mem(9, 0), src: rax });
          emit({ op: "lea", dst: rax, src: rip(functionLabel(op.target)) });
          emit({ op: "mov", dst: mem(9, nativeFunctionEntryOffset), src: rax });
          if (closure === undefined) emit({ op: "xor", dst: eax, src: eax });
          else emit({ op: "mov", dst: rax, src: frame(home(closure)) });
          emit({
            op: "mov",
            dst: mem(9, nativeFunctionEnvironmentOffset),
            src: rax,
          });
          emit({ op: "lea", dst: rax, src: signature(op.target) });
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
        case "general-wrap": {
          const type = typeOf(op.value);
          if (
            type !== "number" &&
            type !== "boolean" &&
            type !== "string" &&
            type !== "Uint8Array" &&
            type !== "reference"
          )
            break;
          copy(emit, frame(home(op.value)), frame(home(op.id) + 8));
          emit({
            op: "mov",
            dst: eax,
            src: imm(
              type === "number"
                ? 1
                : type === "boolean"
                  ? 2
                  : type === "string"
                    ? 3
                    : 5,
            ),
          });
          define(op.id, "general");
          return;
        }
        case "general-value":
          if (
            op.type !== "number" &&
            op.type !== "boolean" &&
            op.type !== "string"
          )
            break;
          emit({
            op: "cmp",
            dst: frame(home(op.value)),
            src: imm(op.type === "number" ? 1 : op.type === "boolean" ? 2 : 3),
          });
          emit({ op: "jcc", cc: "ne", target: label(trapLabel) });
          emit({ op: "mov", dst: rax, src: frame(home(op.value) + 8) });
          define(op.id, op.type);
          return;
        case "unary": {
          const type = typeOf(op.operand);
          const src = frame(home(op.operand));
          const truth = op.operator === "!" || op.operator === "truthy";
          const predicate = truth || op.operator === "is-integer";
          if (
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
            (type === "number" || op.operator === "boolean-number") &&
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

    emit({ op: "label", name: fnLabel });
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
    emit({ op: "mov", dst: rbp, src: rsp });
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
    if (fn.entry !== 0)
      emit({ op: "jmp", target: label(blockLabel(fn.id, fn.entry)) });
    for (const block of fn.blocks) {
      if (block === undefined) throw "block invariant";
      blockId = block.id;
      emit({ op: "label", name: blockLabel(fn.id, block.id) });
      for (let index = 0; index < block.instructions.length; index++) {
        const op = block.instructions[index];
        if (op === undefined) throw "instruction invariant";
        span = { start: op.start, end: op.end };
        instruction(op, block, index);
      }
      const op = block.terminator;
      span = { start: op.start, end: op.end };
      terminate(op, block);
    }
    emit({ op: "label", name: done });
    emit({ op: "mov", dst: rsp, src: rbp });
    emit({ op: "pop", dst: rbp });
    emit({ op: "ret" });
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

  try {
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
      if (fn.import !== true) body(fn);
    }
    // A declaration by itself also needs a linker binding.
    for (const fn of module.functions) {
      if (fn?.import !== true) continue;
      functionId = fn.id;
      blockId = undefined;
      span = undefined;
      fail("UNSUPPORTED", "unsupported managed import " + fn.name);
    }
    functionId = undefined;
    blockId = undefined;
    span = undefined;
    numbers.helpers();
    emit({ op: "label", name: trapLabel });
    emit({ op: "ud2" });
    const encoded = encodeLayout(
      machine,
      (name) =>
        external.has(name) || strings.has(name) || descriptors.has(name),
    );
    const functions: X64Function[] = [];
    for (const fn of module.functions) {
      if (fn === undefined) throw "function invariant";
      const offset = encoded.labels.get(functionLabel(fn.id));
      if (offset === undefined) throw "function label invariant";
      functions.push({ id: fn.id, name: fn.name, offset });
    }
    const poolBase = Math.ceil(encoded.bytes.length / 8) * 8;
    let code = encoded.bytes;
    if (poolBytes !== 0) {
      code = new Uint8Array(poolBase + poolBytes);
      code.set(encoded.bytes);
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
    const imageFixups: NearFixup[] = [];
    for (const fixup of encoded.externalFixups) {
      if (fixup === undefined) throw "x86-64 fixup invariant";
      const offset =
        strings.get(fixup.ref.label)?.offset ??
        descriptors.get(fixup.ref.label)?.offset;
      if (offset === undefined) imageFixups.push(fixup);
      else
        writeRel32(
          code,
          fixup.fieldOffset,
          fixup.nextOffset,
          poolBase + offset,
        );
    }
    const stackMaps: X64Module["stackMaps"][number][] = [];
    if (host !== undefined) {
      const tableOffset = Math.ceil(code.length / 8) * 8;
      const entries: SafepointEntry[] = [];
      for (const site of pendingMaps) {
        if (site === undefined) throw "x86-64 safepoint invariant";
        const offset = encoded.labels.get(site.label);
        const start = encoded.labels.get(site.functionLabel);
        if (offset === undefined || start === undefined)
          throw "x86-64 safepoint label invariant";
        entries.push({ offset, start, map: site.map });
      }
      const words = encodeWideStackMapTable(entries);
      words.push(nativeStackMapFooterMagic, tableOffset);
      const moduleCode = new Uint8Array(tableOffset + words.length * 8);
      moduleCode.set(code);
      for (let i = 0; i < words.length; i++) {
        const value = words[i];
        if (
          value === undefined ||
          !writeWord64(
            moduleCode,
            tableOffset + i * 8,
            {
              lo: value % 4294967296,
              hi: Math.floor(value / 4294967296),
            },
            "little",
          ).ok
        )
          throw "x86-64 stack map word invariant";
      }
      stackMaps.push({
        codeOffset: 0,
        codeLength: encoded.bytes.length,
        tableOffset,
      });
      code = moduleCode;
    }
    const data = new Uint8Array(constants.length * 8);
    for (let i = 0; i < constants.length; i++) {
      const bits = constants[i];
      if (bits === undefined || !writeWord64(data, i * 8, bits, "little").ok)
        throw "binary64 data invariant";
    }
    const relocations = imageRelocations(imageFixups, external);
    return {
      ok: true,
      value: {
        code,
        data,
        functions,
        imports: [...imports],
        stackMaps,
        addressFixups: relocations.addressFixups,
        patchAddress: relocations.patchAddress,
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
