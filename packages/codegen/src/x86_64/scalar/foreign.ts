import {
  cLayout,
  cPromoteVariadic,
  cScalarBytes,
  cScalarSigned,
  linuxX86_64CTarget,
  type CCallLayout,
  type CScalar,
} from "@tint/abi/c";
import {
  nativeArrayDataOffset,
  nativeArrayLengthOffset,
  nativeArrayOwnerOffset,
  nativeHeaderFlagUnit,
  nativeHeaderFlagsShift,
  type PosixHostFacts,
} from "@tint/abi/host";
import {
  dynamicCallFrame,
  type ForeignCall,
  type ForeignMemoryAccess,
  type ScalarType,
} from "@tint/ir/scalar";
import type { Gpr, Memory, Xmm } from "../isa.ts";
import { branch } from "./host.ts";
import {
  bits,
  byte,
  gpr,
  imm,
  label,
  mem,
  setBoolean,
  word,
  xmm,
  type Emit,
} from "./machine.ts";

import { floatBits } from "./numbers.ts";

const rax = gpr(0),
  rcx = gpr(1),
  rdx = gpr(2),
  rsp = gpr(4);
const r10 = gpr(10),
  r11 = gpr(11);
const eax = word(0);
const x0 = xmm(0),
  x1 = xmm(1);
const argumentRegisters: readonly number[] = [7, 6, 2, 1, 8, 9];
export const sysVStagingBytes = 128;

function align(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}
function resultOffset(layout: CCallLayout): number {
  return align(layout.stackBytes, layout.result.alignment);
}
function callAlignment(layout: CCallLayout): number {
  return Math.max(
    layout.stackAlignment ?? 16,
    layout.result.class === "indirect" ? layout.result.alignment : 16,
  );
}
export function sysVOutgoingBytes(layout: CCallLayout): number {
  const used =
    layout.result.class === "indirect"
      ? resultOffset(layout) + layout.result.size
      : layout.stackBytes;
  return used + callAlignment(layout) - 16;
}

interface IntegerSite {
  readonly emit: Emit;
  readonly constant: (value: number) => Memory<64>;
  readonly site: string;
  readonly trap: string;
}

export interface CallSite extends IntegerSite {
  readonly abi: PosixHostFacts;
  readonly prototype: ForeignCall;
  readonly argument: (index: number) => Memory<64>;
  readonly call: (symbol: string) => void;
  readonly staging: (offset: number) => Memory<64>;
  readonly stack: Memory<64>;
}

function indexed(
  base: number,
  index: number,
  disp: number,
  scale: 1 | 8,
): Memory<64> {
  return {
    kind: "mem",
    width: 64,
    address: { kind: "base", base, index, disp, scale },
  };
}

function byteData(
  emit: Emit,
  source: Memory<64>,
  bytes: number,
  trap: string,
): void {
  emit({ op: "mov", dst: r11, src: source });
  if (bytes > 0) {
    emit({ op: "cmp", dst: mem(11, nativeArrayLengthOffset), src: imm(bytes) });
    branch(emit, "b", trap);
  }
  emit({ op: "mov", dst: r11, src: mem(11, nativeArrayDataOffset) });
}

/** Conversion leaves the exact raw integer in RAX. */
function toInteger(
  request: IntegerSite,
  input: Memory<64>,
  width: number,
  signed: boolean,
  site: string,
  trap: string = request.trap,
): void {
  const emit = request.emit,
    constant = request.constant;
  emit({ op: "movsd", dst: x0, src: input });
  if (!signed) {
    emit({ op: "ucomisd", dst: x0, src: constant(0) });
    branch(emit, "b", trap); // also unordered
    if (width === 8) {
      const upper = constant(9223372036854775808);
      const low = site + ":low";
      const done = site + ":integer";
      emit({ op: "ucomisd", dst: x0, src: upper });
      branch(emit, "b", low);
      emit({ op: "subsd", dst: x0, src: upper });
      emit({ op: "ucomisd", dst: x0, src: upper });
      branch(emit, "ae", trap);
      emit({ op: "cvttsd2si", dst: rax, src: x0 });
      emit({ op: "mov", dst: r10, src: bits(0, 0x80000000) });
      emit({ op: "or", dst: rax, src: r10 });
      emit({ op: "jmp", target: label(done) });
      emit({ op: "label", name: low });
      checkedSignedConversion(emit, trap);
      emit({ op: "label", name: done });
      return;
    }
  }
  checkedSignedConversion(emit, trap);
  if (width < 8) {
    const shift = (8 - width) * 8;
    emit({ op: "mov", dst: r10, src: rax });
    emit({ op: "shl", dst: r10, count: shift });
    if (signed) emit({ op: "sar", dst: r10, count: shift });
    else emit({ op: "shr", dst: r10, count: shift });
    emit({ op: "cmp", dst: r10, src: rax });
    branch(emit, "ne", trap);
  }
}

function float32Bits(emit: Emit, dst: Gpr<32>, src: Xmm): void {
  const move: {
    readonly op: "movd";
    readonly dst: Gpr<32>;
    readonly src: Xmm;
  } = { op: "movd", dst, src };
  emit(move);
}

function checkedSignedConversion(emit: Emit, trap: string): void {
  emit({ op: "cvttsd2si", dst: rax, src: x0 });
  emit({ op: "cvtsi2sd", dst: x1, src: rax });
  emit({ op: "ucomisd", dst: x0, src: x1 });
  branch(emit, "p", trap);
  branch(emit, "ne", trap);
}

/** Return the C integer as binary64 bits in RAX, trapping on precision loss. */
function fromInteger(
  request: IntegerSite,
  width: number,
  signed: boolean,
): void {
  const emit = request.emit,
    trap = request.trap,
    site = request.site;
  if (width < 8) {
    const shift = (8 - width) * 8;
    emit({ op: "shl", dst: rax, count: shift });
    if (signed) emit({ op: "sar", dst: rax, count: shift });
    else emit({ op: "shr", dst: rax, count: shift });
  }
  if (width === 8 && !signed) {
    const low = site + ":signed-range",
      done = site + ":converted";
    emit({ op: "test", dst: rax, src: rax });
    branch(emit, "ns", low);
    // Converting the low 63 bits and adding 2^63 could round twice.
    // Divide before converting and carry any discarded bit into rounding.
    emit({ op: "mov", dst: r10, src: rax });
    emit({ op: "and", dst: r10, src: imm(1) });
    emit({ op: "mov", dst: rcx, src: rax });
    emit({ op: "shr", dst: rcx, count: 1 });
    emit({ op: "or", dst: r10, src: rcx });
    emit({ op: "cvtsi2sd", dst: x0, src: r10 });
    emit({ op: "cvttsd2si", dst: r10, src: x0 });
    emit({ op: "add", dst: r10, src: r10 });
    emit({ op: "cmp", dst: r10, src: rax });
    branch(emit, "ne", trap);
    // A result rounded to 2^64 has a signed conversion sentinel.
    emit({ op: "addsd", dst: x0, src: x0 });
    emit({ op: "jmp", target: label(done) });
    emit({ op: "label", name: low });
    emit({ op: "cvtsi2sd", dst: x0, src: rax });
    emit({ op: "label", name: done });
  } else emit({ op: "cvtsi2sd", dst: x0, src: rax });
  if (width === 8 && signed) {
    emit({ op: "cvttsd2si", dst: r10, src: x0 });
    emit({ op: "cmp", dst: r10, src: rax });
    branch(emit, "ne", trap);
  }
  if (width === 8 && !signed) {
    // The low range also has to survive its round trip.
    const done = site + ":unsigned-exact";
    emit({ op: "test", dst: rax, src: rax });
    branch(emit, "s", done);
    emit({ op: "cvttsd2si", dst: r10, src: x0 });
    emit({ op: "cmp", dst: r10, src: rax });
    branch(emit, "ne", trap);
    emit({ op: "label", name: done });
  }
  floatBits(emit, rax, x0);
}

function readPart(emit: Emit, source: Memory<64>, bytes: number): void {
  if (bytes === 8) {
    emit({ op: "mov", dst: rax, src: source });
    return;
  }
  // Read only the live bytes. A packed record may end at a guard page.
  emit({ op: "lea", dst: rcx, src: source });
  emit({ op: "xor", dst: eax, src: eax });
  for (let at = bytes - 1; at >= 0; at--) {
    emit({ op: "shl", dst: rax, count: 8 });
    emit({ op: "mov", dst: byte(0), src: { ...mem(1, at), width: 8 } });
  }
}

function storePart(emit: Emit, target: Memory<64>, bytes: number): void {
  if (bytes === 8) {
    emit({ op: "mov", dst: target, src: r10 });
    return;
  }
  emit({ op: "lea", dst: rcx, src: target });
  for (let at = 0; at < bytes; at++) {
    emit({ op: "mov", dst: { ...mem(1, at), width: 8 }, src: byte(10) });
    if (at + 1 < bytes) emit({ op: "shr", dst: r10, count: 8 });
  }
}

/** Copy an exact record between the addresses in R11 and R10. This uses
 * bounded machine code even for records too large to unroll. */
function copyRecord(emit: Emit, size: number, site: string): void {
  const whole = size - (size % 8);
  if (whole > 0) {
    emit({ op: "xor", dst: word(1), src: word(1) });
    emit({ op: "label", name: site });
    emit({ op: "mov", dst: rax, src: indexed(11, 1, 0, 1) });
    emit({ op: "mov", dst: indexed(10, 1, 0, 1), src: rax });
    emit({ op: "add", dst: rcx, src: imm(8) });
    emit({ op: "cmp", dst: rcx, src: imm(whole) });
    branch(emit, "b", site);
  }
  for (let at = whole; at < size; at++) {
    emit({ op: "mov", dst: byte(0), src: { ...mem(11, at), width: 8 } });
    emit({ op: "mov", dst: { ...mem(10, at), width: 8 }, src: byte(0) });
  }
}

function loadRegisters(emit: Emit, from: (offset: number) => Memory<64>): void {
  for (let index = 0; index < argumentRegisters.length; index++) {
    const register = argumentRegisters[index];
    if (register === undefined) throw "SysV integer register invariant";
    emit({ op: "mov", dst: gpr(register), src: from(index * 8) });
  }
  for (let index = 0; index < 8; index++)
    emit({ op: "movsd", dst: xmm(index), src: from(64 + index * 8) });
}

/** Leaf-only C call through the existing IR and import-slot machinery. */
export function emitSysVCall(request: CallSite, layout: CCallLayout): void {
  const emit = request.emit,
    prototype = request.prototype,
    argument = request.argument,
    staging = request.staging,
    site = request.site,
    trap = request.trap;
  const signature = prototype.signature;
  const extra = prototype.indirect === true ? 1 : 0;
  if (extra !== 0) {
    toInteger(request, argument(0), 8, false, site + ":callee");
    emit({ op: "test", dst: rax, src: rax });
    branch(emit, "e", trap);
    emit({ op: "mov", dst: staging(48), src: rax });
  }
  const alignment = callAlignment(layout);
  if (alignment > 16) {
    emit({ op: "add", dst: rsp, src: imm(alignment - 16) });
    emit({ op: "and", dst: rsp, src: imm(-alignment) });
  }
  for (let index = 0; index < layout.arguments.length; index++) {
    const location = layout.arguments[index];
    const type = signature.parameters[index];
    const form = prototype.operands[index];
    if (location === undefined || type === undefined || form === undefined)
      throw "SysV operand invariant";
    const source = argument(index + extra);
    const slot = location.stackOffset;
    const parts = location.parts;
    if (form === "record") {
      byteData(emit, source, location.size, trap);
      if (parts === undefined) {
        emit({ op: "lea", dst: r10, src: mem(4, slot) });
        copyRecord(emit, location.size, site + ":copy:" + String(index));
      } else {
        for (const part of parts) {
          if (part === undefined) throw "SysV register part invariant";
          readPart(emit, mem(11, part.offset), part.bytes);
          emit({
            op: "mov",
            dst: staging(
              (part.bank === "integer" ? 0 : 64) + part.register * 8,
            ),
            src: rax,
          });
        }
      }
      continue;
    }
    if (form === "bytes" || form === "terminated-bytes") {
      let min = form === "terminated-bytes" ? 1 : 0;
      if (type.kind === "pointer" && type.pointee.kind === "record") {
        const pointee = cLayout(type.pointee, linuxX86_64CTarget);
        if (!pointee.ok) throw "SysV pointee layout invariant";
        min = Math.max(min, pointee.value.size);
      }
      byteData(emit, source, min, trap);
      if (form === "terminated-bytes") {
        emit({ op: "mov", dst: r10, src: source });
        emit({ op: "mov", dst: r10, src: mem(10, nativeArrayLengthOffset) });
        emit({
          op: "cmp",
          dst: { ...indexed(11, 10, -1, 1), width: 8 },
          src: imm(0),
        });
        branch(emit, "ne", trap);
      }
      emit({ op: "mov", dst: rax, src: r11 });
    } else if (form === "boolean") emit({ op: "mov", dst: rax, src: source });
    else if (type.kind === "scalar" && type.scalar === "f32") {
      emit({ op: "cvtsd2ss", dst: x0, src: source });
      const promoted = location.variadic ? cPromoteVariadic(type) : type;
      if (promoted.kind === "scalar" && promoted.scalar === "f64") {
        emit({ op: "cvtss2sd", dst: x0, src: x0 });
        floatBits(emit, rax, x0);
      } else float32Bits(emit, eax, x0);
    } else if (type.kind === "scalar" && type.scalar === "f64")
      emit({ op: "mov", dst: rax, src: source });
    else {
      const scalar: CScalar = type.kind === "scalar" ? type.scalar : "usize";
      toInteger(
        request,
        source,
        cScalarBytes(scalar),
        cScalarSigned(scalar, linuxX86_64CTarget),
        site + ":arg:" + String(index),
      );
    }
    emit({
      op: "mov",
      dst:
        slot >= 0
          ? mem(4, slot)
          : staging(location.gp >= 0 ? location.gp * 8 : 64 + location.fp * 8),
      src: rax,
    });
  }
  const result = layout.result;
  if (result.class === "indirect") {
    emit({ op: "lea", dst: rax, src: mem(4, resultOffset(layout)) });
    emit({ op: "mov", dst: staging(0), src: rax });
  }
  loadRegisters(emit, staging);
  emit({ op: "mov", dst: eax, src: imm(layout.vectorRegisters ?? 0) });
  if (extra === 0) request.call(request.abi.symbolPrefix + prototype.symbol);
  else emit({ op: "call", target: staging(48) });

  if (prototype.result === "record") {
    byteData(
      emit,
      argument(signature.parameters.length + extra),
      result.size,
      trap,
    );
    if (result.class === "indirect") {
      // SysV returns the hidden output address again in RAX. Read the
      // aligned caller-owned copy rather than exposing a managed buffer.
      emit({ op: "mov", dst: r10, src: r11 });
      emit({ op: "lea", dst: r11, src: mem(4, resultOffset(layout)) });
      copyRecord(emit, result.size, site + ":return-record");
    } else {
      const parts = result.parts;
      if (parts === undefined) throw "SysV result parts invariant";
      for (const part of parts) {
        if (part === undefined) throw "SysV result part invariant";
        if (part.bank === "sse") floatBits(emit, r10, xmm(part.register));
        else
          emit({ op: "mov", dst: r10, src: part.register === 0 ? rax : rdx });
        storePart(emit, mem(11, part.offset), part.bytes);
      }
    }
  }
  if (alignment > 16) emit({ op: "lea", dst: rsp, src: request.stack });
  if (prototype.result === "void" || prototype.result === "record") return;
  if (prototype.result === "boolean") {
    emit({ op: "test", dst: byte(0), src: byte(0) });
    setBoolean(emit, "ne", 0);
    return;
  }
  const type = signature.result;
  if (
    type.kind === "scalar" &&
    (type.scalar === "f32" || type.scalar === "f64")
  ) {
    if (type.scalar === "f32") emit({ op: "cvtss2sd", dst: x0, src: x0 });
    floatBits(emit, rax, x0);
    return;
  }
  const scalar: CScalar = type.kind === "scalar" ? type.scalar : "usize";
  const width = cScalarBytes(scalar);
  if (signature.errno === "negated-result") {
    const ok = site + ":errno";
    const status = width === 8 ? rax : eax;
    emit({ op: "test", dst: status, src: status });
    branch(emit, "ns", ok);
    request.call(request.abi.errnoSymbol);
    emit({ op: "mov", dst: eax, src: { ...mem(0, 0), width: 32 } });
    emit({ op: "neg", dst: status });
    emit({ op: "label", name: ok });
  }
  fromInteger(request, width, cScalarSigned(scalar, linuxX86_64CTarget));
}

/** The SysV use of the two unused integer words and the AAPCS64 X8 word.
 * X6 is stack alignment, X7 is sret alignment on input and a frame-relative
 * result offset on output. The X8 word carries the vector count for AL. */
export const sysVDynamicStackBytes = 1024;
export function emitSysVDynamicCall(request: CallSite): void {
  const emit = request.emit,
    site = request.site,
    trap = request.trap;
  const arg = request.argument,
    stage = request.staging;
  const layout = dynamicCallFrame;
  toInteger(request, arg(0), 8, false, site + ":address");
  emit({ op: "test", dst: rax, src: rax });
  branch(emit, "e", trap);
  emit({ op: "mov", dst: stage(0), src: rax });
  byteData(emit, arg(1), layout.size, trap);
  emit({ op: "mov", dst: stage(8), src: r11 });
  emit({ op: "mov", dst: mem(11, layout.bases), src: r11 });
  for (let index = 0; index < layout.byteOperands; index++) {
    byteData(emit, arg(index + 2), 0, trap);
    emit({ op: "mov", dst: r10, src: stage(8) });
    emit({ op: "mov", dst: mem(10, layout.bases + 8 + index * 8), src: r11 });
  }
  emit({ op: "mov", dst: r11, src: stage(8) });
  emit({ op: "mov", dst: rdx, src: mem(11, layout.patchCount) });
  emit({ op: "cmp", dst: rdx, src: imm(layout.patchCapacity) });
  branch(emit, "a", trap);
  const patchLoop = site + ":patch";
  const patchDone = site + ":patched";
  const patchSlot = site + ":patch-slot";
  const patchStore = site + ":patch-store";
  emit({ op: "xor", dst: word(1), src: word(1) });
  emit({ op: "label", name: patchLoop });
  emit({ op: "cmp", dst: rcx, src: rdx });
  branch(emit, "ae", patchDone);
  emit({
    op: "mov",
    dst: r10,
    src: indexed(11, 1, layout.patches + layout.patchArray, 8),
  });
  emit({ op: "cmp", dst: r10, src: imm(layout.byteOperands) });
  branch(emit, "a", trap);
  emit({ op: "mov", dst: rax, src: indexed(11, 10, layout.bases, 8) });
  emit({
    op: "add",
    dst: rax,
    src: indexed(11, 1, layout.patches + layout.patchArray * 2, 8),
  });
  emit({ op: "mov", dst: r10, src: indexed(11, 1, layout.patches, 8) });
  emit({ op: "test", dst: r10, src: imm(7) });
  branch(emit, "ne", trap);
  emit({ op: "cmp", dst: r10, src: imm(48) });
  branch(emit, "b", patchSlot);
  emit({ op: "cmp", dst: r10, src: imm(layout.stack) });
  branch(emit, "b", trap);
  emit({ op: "cmp", dst: r10, src: imm(layout.scratch) });
  branch(emit, "ae", trap);
  emit({ op: "label", name: patchSlot });
  // The one sret patch uses a frame-relative address. Align it in the
  // scratch area and give the runtime the actual offset of the C image.
  emit({ op: "test", dst: r10, src: r10 });
  branch(emit, "ne", patchStore);
  emit({ op: "cmp", dst: mem(11, 56), src: imm(0) });
  branch(emit, "e", patchStore);
  emit({ op: "mov", dst: gpr(8), src: mem(11, 56) });
  emit({ op: "cmp", dst: gpr(8), src: imm(layout.scratchCapacity) });
  branch(emit, "a", trap);
  emit({ op: "lea", dst: gpr(9), src: mem(8, -1) });
  emit({ op: "test", dst: gpr(9), src: gpr(8) });
  branch(emit, "ne", trap);
  emit({ op: "add", dst: rax, src: gpr(9) });
  emit({ op: "neg", dst: gpr(8) });
  emit({ op: "and", dst: rax, src: gpr(8) });
  emit({ op: "mov", dst: gpr(8), src: rax });
  emit({ op: "sub", dst: gpr(8), src: r11 });
  emit({ op: "cmp", dst: gpr(8), src: imm(layout.scratch) });
  branch(emit, "b", trap);
  emit({ op: "cmp", dst: gpr(8), src: imm(layout.size) });
  branch(emit, "ae", trap);
  emit({ op: "mov", dst: mem(11, 56), src: gpr(8) });
  emit({ op: "label", name: patchStore });
  emit({ op: "mov", dst: indexed(11, 10, 0, 1), src: rax });
  emit({ op: "inc", dst: rcx });
  emit({ op: "jmp", target: label(patchLoop) });
  emit({ op: "label", name: patchDone });

  emit({ op: "mov", dst: rdx, src: mem(11, layout.stackBytes) });
  emit({ op: "cmp", dst: rdx, src: imm(layout.stackCapacity) });
  branch(emit, "a", trap);
  emit({ op: "test", dst: rdx, src: imm(7) });
  branch(emit, "ne", trap);
  emit({ op: "mov", dst: r10, src: mem(11, 48) });
  emit({ op: "cmp", dst: r10, src: imm(16) });
  branch(emit, "b", trap);
  emit({ op: "cmp", dst: r10, src: imm(layout.stackCapacity) });
  branch(emit, "a", trap);
  emit({ op: "lea", dst: rax, src: mem(10, -1) });
  emit({ op: "test", dst: rax, src: r10 });
  branch(emit, "ne", trap);
  emit({ op: "add", dst: rsp, src: imm(layout.stackCapacity - 16) });
  emit({ op: "neg", dst: r10 });
  emit({ op: "and", dst: rsp, src: r10 });

  const copyLoop = site + ":stack";
  const copyDone = site + ":registers";
  emit({ op: "xor", dst: word(1), src: word(1) });
  emit({ op: "label", name: copyLoop });
  emit({ op: "cmp", dst: rcx, src: rdx });
  branch(emit, "ae", copyDone);
  emit({ op: "mov", dst: rax, src: indexed(11, 1, layout.stack, 1) });
  emit({ op: "mov", dst: indexed(4, 1, 0, 1), src: rax });
  emit({ op: "add", dst: rcx, src: imm(8) });
  emit({ op: "jmp", target: label(copyLoop) });
  emit({ op: "label", name: copyDone });

  loadRegisters(emit, (offset) => mem(11, offset));
  emit({ op: "mov", dst: rax, src: mem(11, layout.indirect) });
  emit({ op: "cmp", dst: rax, src: imm(8) });
  branch(emit, "a", trap);
  emit({ op: "call", target: stage(0) });
  emit({ op: "lea", dst: rsp, src: request.stack });
  emit({ op: "mov", dst: r11, src: stage(8) });
  emit({ op: "mov", dst: mem(11, 0), src: rax });
  emit({ op: "mov", dst: mem(11, 8), src: rdx });
  emit({ op: "movsd", dst: mem(11, layout.floats), src: x0 });
  emit({ op: "movsd", dst: mem(11, layout.floats + 8), src: x1 });
}

export interface MemorySite extends IntegerSite {
  readonly access: ForeignMemoryAccess;
  readonly argument: (index: number) => Memory<64>;
  readonly importSlot: (symbol: string) => Memory<64>;
}

function headerFlags(emit: Emit, base: number): void {
  emit({ op: "mov", dst: r10, src: mem(base, 0) });
  emit({ op: "shr", dst: r10, count: nativeHeaderFlagsShift });
  emit({ op: "and", dst: r10, src: imm(7) });
}

/** Leaf C memory operations. The argument homes are read before publishing
 * the RAX result. Only the shared typed-array header and data are accessed. */
export function emitSysVMemory(request: MemorySite): ScalarType | "void" {
  const emit = request.emit,
    access = request.access,
    arg = request.argument;
  const site = request.site,
    trap = request.trap;
  const operation = access.operation;
  if (operation === "available") {
    emit({
      op: "cmp",
      dst: request.importSlot(access.symbol ?? ""),
      src: imm(0),
    });
    setBoolean(emit, "ne", 0);
    return "boolean";
  }

  const type = access.type;
  const scalar: CScalar = type.kind === "scalar" ? type.scalar : "usize";
  const size = cScalarBytes(scalar);
  const signed = cScalarSigned(scalar, linuxX86_64CTarget);
  if (operation === "fits") {
    const invalid = site + ":out-of-range",
      done = site + ":fits";
    toInteger(request, arg(0), size, signed, site, invalid);
    emit({ op: "mov", dst: eax, src: imm(1) });
    emit({ op: "jmp", target: label(done) });
    emit({ op: "label", name: invalid });
    emit({ op: "xor", dst: eax, src: eax });
    emit({ op: "label", name: done });
    return "boolean";
  }

  if (operation === "adopt" || operation === "retarget") {
    toInteger(request, arg(1), 8, false, site + ":address");
    emit({ op: "mov", dst: rdx, src: rax });
    if (operation === "adopt") {
      toInteger(request, arg(2), 4, false, site + ":length");
      emit({ op: "mov", dst: r11, src: arg(0) });
      emit({ op: "cmp", dst: mem(11, 0), src: imm(2) });
      branch(emit, "ne", trap);
      emit({ op: "cmp", dst: mem(11, nativeArrayLengthOffset), src: imm(0) });
      branch(emit, "ne", trap);
      emit({
        op: "mov",
        dst: r10,
        src: bits(2, nativeHeaderFlagUnit / 4294967296),
      });
      emit({ op: "mov", dst: mem(11, 0), src: r10 });
      emit({ op: "mov", dst: mem(11, nativeArrayLengthOffset), src: rax });
      emit({ op: "mov", dst: mem(11, nativeArrayDataOffset), src: rdx });
      emit({ op: "mov", dst: rax, src: r11 });
      return "Uint8Array";
    }
    emit({ op: "mov", dst: r11, src: arg(0) });
    headerFlags(emit, 11);
    const borrowed = site + ":borrowed";
    emit({ op: "cmp", dst: r10, src: imm(1) });
    branch(emit, "e", borrowed);
    emit({ op: "cmp", dst: r10, src: imm(2) });
    branch(emit, "ne", trap);
    emit({ op: "mov", dst: rcx, src: mem(11, nativeArrayOwnerOffset) });
    headerFlags(emit, 1);
    emit({ op: "cmp", dst: r10, src: imm(1) });
    branch(emit, "ne", trap);
    emit({ op: "mov", dst: mem(1, nativeArrayDataOffset), src: rdx });
    emit({ op: "label", name: borrowed });
    emit({ op: "mov", dst: mem(11, nativeArrayDataOffset), src: rdx });
    return "void";
  }

  if (operation === "address" || operation === "stable") {
    emit({ op: "mov", dst: r11, src: arg(0) });
    headerFlags(emit, 11);
    if (operation === "address") {
      emit({ op: "mov", dst: rax, src: imm(-1) });
      emit({ op: "cmp", dst: r10, src: imm(1) });
      emit({
        op: "cmovcc",
        cc: "e",
        dst: rax,
        src: mem(11, nativeArrayDataOffset),
      });
      fromInteger(request, 8, true);
      return "number";
    }
    const ownedOrBorrowed = site + ":stable";
    emit({ op: "cmp", dst: r10, src: imm(2) });
    branch(emit, "ne", ownedOrBorrowed);
    emit({ op: "mov", dst: r11, src: mem(11, nativeArrayOwnerOffset) });
    headerFlags(emit, 11);
    emit({ op: "label", name: ownedOrBorrowed });
    emit({ op: "cmp", dst: r10, src: imm(1) });
    setBoolean(emit, "e", 0);
    return "boolean";
  }
  if (operation !== "load" && operation !== "store")
    throw "SysV C memory operation invariant";

  // The checked view lowering proves the member index and extent before
  // the instruction, and performs the integer fits check for stores.
  const stride = access.stride;
  if (operation === "store") {
    const value = arg(stride === undefined ? 1 : 2);
    if (scalar === "bool" || scalar === "f64")
      emit({ op: "mov", dst: rax, src: value });
    else if (scalar === "f32") {
      emit({ op: "cvtsd2ss", dst: x0, src: value });
      float32Bits(emit, eax, x0);
    } else toInteger(request, value, size, signed, site);
  }
  byteData(emit, arg(0), 0, trap);
  if (stride !== undefined) {
    emit({ op: "cvttsd2si", dst: rcx, src: arg(1) });
    emit({ op: "imul-imm", dst: rcx, src: rcx, immediate: imm(stride) });
    emit({ op: "add", dst: r11, src: rcx });
  }
  const field = mem(11, access.offset);
  if (operation === "store") {
    if (size === 8) emit({ op: "mov", dst: field, src: rax });
    else if (size === 4)
      emit({ op: "mov", dst: { ...field, width: 32 }, src: eax });
    else if (size === 2)
      emit({
        op: "mov",
        dst: { ...field, width: 16 },
        src: { kind: "gpr", index: 0, width: 16 },
      });
    else emit({ op: "mov", dst: { ...field, width: 8 }, src: byte(0) });
    return "void";
  }
  if (scalar === "f32") {
    emit({ op: "cvtss2sd", dst: x0, src: { ...field, width: 32 } });
    floatBits(emit, rax, x0);
  } else if (scalar === "f64") emit({ op: "mov", dst: rax, src: field });
  else {
    readPart(emit, field, size);
    if (scalar === "bool") {
      emit({ op: "test", dst: eax, src: eax });
      setBoolean(emit, "ne", 0);
      return "boolean";
    }
    fromInteger(request, size, signed);
  }
  return "number";
}
