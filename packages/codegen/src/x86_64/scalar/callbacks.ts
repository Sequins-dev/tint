import {
  cScalarBytes,
  cScalarSigned,
  cTypeName,
  type CScalar,
  type CSignature,
} from "@tint/abi/c";
import {
  classifySysVCCall,
  linuxX86_64CTarget,
  sysVCallbackFrame,
} from "@tint/abi/c/sysv";
import {
  nativeFunctionEntryOffset,
  nativeFunctionEnvironmentOffset,
} from "@tint/abi/function";
import {
  nativeArrayDataOffset,
  nativeArrayOwnerOffset,
  nativeCallbackThunkTransitionOffset,
} from "@tint/abi/host";
import {
  callbackEntered,
  callbackState,
  callbackTransition,
  dynamicCallFrame,
  directCallbackExtras,
  transitionBytes,
  type ForeignCall,
} from "@tint/ir/scalar";
import type { Memory } from "../isa.ts";
import {
  dwarfStackPointer,
  frameRows,
  frameSave,
  returnSave,
  type LabeledUnwind,
} from "../unwind.ts";
import {
  argumentRegisters,
  byteData,
  fromInteger,
  toInteger,
  type IntegerSite,
} from "./foreign.ts";
import { branch } from "./host.ts";
import {
  gpr,
  imm,
  label,
  mem,
  normal,
  resultPayload,
  rip,
  thrown,
  word,
  xmm,
  type Emit,
} from "./machine.ts";

const rax = gpr(0),
  rdx = gpr(2),
  rsp = gpr(4),
  rbp = gpr(5);
const rdi = gpr(7),
  rsi = gpr(6),
  rcx = gpr(1),
  r8 = gpr(8),
  r9 = gpr(9);
const r10 = gpr(10),
  r11 = gpr(11),
  eax = word(0),
  x0 = xmm(0);
const layout = callbackTransition;
export const callbackKeyLabel = "tint:callback-key";
export const callbackThunksLabel = "tint:callback-thunks";

interface CallbackView {
  readonly parameter: number;
  readonly offset: number;
}
export interface CallbackThunk {
  readonly signature: CSignature | undefined;
  readonly ordinal: number;
  readonly views: readonly CallbackView[] | undefined;
}
interface CallbackRoot {
  readonly operand: number;
  readonly offset: number;
}
interface PlannedCallback extends CallbackThunk {
  readonly parameter: number;
}
export interface TransitionPlan {
  readonly bytes: number;
  readonly roots: readonly CallbackRoot[];
  readonly thunks: readonly PlannedCallback[];
}

/** Call operands copied into the transition are independent GC roots. */
export function planTransition(call: ForeignCall): TransitionPlan {
  const roots: CallbackRoot[] = [{ operand: 1, offset: layout.registered }];
  const thunks: PlannedCallback[] = [];
  const dynamic = call.dynamic === true;
  const count = dynamic
    ? call.dynamicScalar === true
      ? 0
      : dynamicCallFrame.callbackOperands
    : (call.callbacks ?? []).filter((item) => item !== undefined).length;
  const end = call.operands.length - directCallbackExtras(call);
  let view = 0;
  if (call.directCallbacks !== undefined) {
    roots.push({ operand: end, offset: layout.onThrow });
    roots.push({ operand: end + 1, offset: layout.onInvalid });
  }
  for (
    let parameter = 0;
    parameter < (dynamic ? count : call.signature.parameters.length);
    parameter++
  ) {
    const signature = call.callbacks?.[parameter];
    if (!dynamic && signature === undefined) continue;
    const ordinal = thunks.length;
    const operand = dynamic
      ? 4 + dynamicCallFrame.byteOperands + parameter
      : 2 + parameter;
    roots.push({ operand, offset: layout.callbacks + ordinal * 8 });
    const direct = call.directCallbacks?.[parameter];
    const views: CallbackView[] = [];
    if (direct !== undefined) {
      for (const index of direct) {
        if (index === undefined) throw "callback view invariant";
        const offset = layout.callbacks + (count + view) * 8;
        roots.push({ operand: end + 2 + view, offset });
        views.push({ parameter: index, offset });
        view++;
      }
    }
    thunks.push({
      parameter,
      signature,
      ordinal,
      views: direct === undefined ? undefined : views,
    });
  }
  return { bytes: transitionBytes(count, view) + 16, roots, thunks };
}

interface TransitionSite {
  readonly emit: Emit;
  readonly trap: string;
  readonly call: (symbol: string) => void;
  readonly argument: (index: number) => Memory<64>;
  readonly record: (offset: number) => Memory<64>;
  readonly context: Memory<64>;
  readonly returnPC: string;
  readonly plan: TransitionPlan;
}

export function beginTransition(site: TransitionSite): void {
  const emit = site.emit,
    record = site.record;
  site.call("pthread_self");
  emit({ op: "mov", dst: record(layout.thread), src: rax });
  emit({ op: "mov", dst: record(layout.frame), src: rbp });
  emit({ op: "lea", dst: rax, src: rip(site.returnPC) });
  emit({ op: "mov", dst: record(layout.returnAddress), src: rax });
  emit({ op: "mov", dst: rax, src: site.context });
  emit({ op: "mov", dst: record(layout.context), src: rax });
  emit({
    op: "mov",
    dst: record(layout.entered),
    src: imm(callbackEntered.idle),
  });
  for (const root of site.plan.roots) {
    if (root === undefined) throw "callback root invariant";
    emit({ op: "mov", dst: rax, src: site.argument(root.operand) });
    emit({ op: "mov", dst: record(root.offset), src: rax });
  }
  byteData(emit, site.argument(0), callbackState.size, site.trap);
  emit({ op: "mov", dst: record(site.plan.bytes - 16), src: r11 });
  emit({ op: "mov", dst: rax, src: mem(11, callbackState.current) });
  emit({ op: "mov", dst: record(layout.previous), src: rax });
  emit({ op: "lea", dst: rax, src: record(0) });
  emit({ op: "mov", dst: mem(11, callbackState.current), src: rax });
}

/** Preserve the two integer and SSE result registers on return from C. */
export function endTransition(site: TransitionSite): void {
  const emit = site.emit;
  emit({ op: "mov", dst: r11, src: site.record(site.plan.bytes - 16) });
  emit({ op: "mov", dst: r10, src: site.record(layout.previous) });
  emit({ op: "mov", dst: mem(11, callbackState.current), src: r10 });
}

export function callbackThunkKey(thunk: CallbackThunk): string {
  const signature = thunk.signature;
  let key = String(thunk.ordinal);
  if (signature !== undefined) {
    key += ":" + cTypeName(signature.result);
    for (const type of signature.parameters) {
      if (type === undefined) throw "callback signature invariant";
      key += ":" + cTypeName(type);
    }
  }
  if (thunk.views !== undefined) {
    key += ":direct";
    for (const view of thunk.views) {
      if (view === undefined) throw "callback view invariant";
      key += ":" + view.parameter + ":" + view.offset;
    }
  }
  return key;
}

interface ThunkSite extends IntegerSite {
  readonly thunk: CallbackThunk;
  readonly call: (symbol: string) => void;
  readonly far: boolean;
}

/** A synthetic frame record at RBP preserves the walker contract at +48.
 * DWARF recovers the C frame from the actual SysV saves below the caller's SP. */
export function emitCallbackThunk(site: ThunkSite): LabeledUnwind {
  const emit = site.emit,
    thunk = site.thunk,
    name = site.site;
  const signature = thunk.signature;
  const direct = thunk.views !== undefined,
    registered = thunk.ordinal < 0,
    runtimeRegistered = registered && signature === undefined;
  const classified =
    signature === undefined
      ? undefined
      : classifySysVCCall(signature, linuxX86_64CTarget);
  if (classified !== undefined && !classified.ok)
    throw "SysV callback: " + classified.error;
  const locations = classified?.ok === true ? classified.value.arguments : [];
  if (locations.length + (registered ? 1 : 0) > 8)
    throw "SysV callback takes too many arguments";
  const physical = sysVCallbackFrame;
  const outgoing = physical.outgoingBytes,
    frameBytes = physical.frameBytes,
    payload = 208;
  const transition = mem(5, nativeCallbackThunkTransitionOffset);
  const finished = name + ":finished";
  const zero = name + ":zero";
  const onThrow = name + ":throw";
  const badArgument = name + ":invalid-argument";
  const badResult = name + ":invalid-result";
  const noteInvalid = name + ":note-invalid";
  const noteFailed = name + ":note-failed";
  const end = name + ":end";
  const wrongThread = runtimeRegistered ? name + ":wrong-thread" : site.trap;
  const missingTransition = runtimeRegistered
    ? name + ":missing-transition"
    : site.trap;
  const brokenDispatcher = runtimeRegistered
    ? name + ":broken-dispatcher"
    : site.trap;
  const converted = 240;
  const cfi = frameRows(emit, name);
  const saves = [returnSave, frameSave];
  emit({ op: "label", name });
  emit({ op: "push", src: rbp });
  cfi.record(dwarfStackPointer, 16, saves);
  emit({ op: "sub", dst: rsp, src: imm(frameBytes) });
  cfi.record(dwarfStackPointer, frameBytes + 16, saves);
  emit({ op: "lea", dst: rbp, src: mem(4, outgoing) });
  if (runtimeRegistered) {
    emit({ op: "mov", dst: mem(5, converted), src: r10 });
    emit({ op: "mov", dst: mem(5, converted + 8), src: rax });
  }
  if (site.far) {
    // The reserved scratch saves fit between the completion and arguments.
    emit({ op: "mov", dst: mem(5, 224), src: gpr(14) });
    emit({ op: "mov", dst: mem(5, 232), src: gpr(15) });
    const farSaves = saves.slice();
    farSaves.push(
      { register: 14, offset: 224 + outgoing - frameBytes - 16 },
      { register: 15, offset: 232 + outgoing - frameBytes - 16 },
    );
    cfi.record(dwarfStackPointer, frameBytes + 16, farSaves);
  }
  emit({ op: "mov", dst: rax, src: mem(4, frameBytes) });
  emit({ op: "mov", dst: mem(5, 0), src: rax });
  emit({ op: "mov", dst: rax, src: mem(4, frameBytes + 8) });
  emit({ op: "mov", dst: mem(5, 8), src: rax });
  for (let index = 0; index < argumentRegisters.length; index++) {
    const register = argumentRegisters[index];
    if (register === undefined) throw "SysV callback register invariant";
    emit({
      op: "mov",
      dst: mem(5, physical.registers + index * 8),
      src: gpr(register),
    });
  }
  for (let index = 0; index < 8; index++)
    emit({
      op: "movsd",
      dst: mem(5, physical.floats + index * 8),
      src: xmm(index),
    });

  if (runtimeRegistered) {
    site.call("pthread_self");
    emit({ op: "cmp", dst: rax, src: mem(5, converted + 8) });
    branch(emit, "ne", wrongThread);
  }
  emit({
    op: "mov",
    dst: word(7),
    src: { ...rip(callbackKeyLabel), width: 32 },
  });
  site.call("pthread_getspecific");
  emit({ op: "test", dst: rax, src: rax });
  branch(emit, "e", wrongThread);
  emit({ op: "mov", dst: r11, src: mem(0, callbackState.current) });
  emit({ op: "test", dst: r11, src: r11 });
  branch(emit, "e", missingTransition);
  emit({ op: "mov", dst: transition, src: r11 });
  site.call("pthread_self");
  emit({ op: "mov", dst: r11, src: transition });
  emit({ op: "cmp", dst: rax, src: mem(11, layout.thread) });
  branch(emit, "ne", wrongThread);
  emit({
    op: "cmp",
    dst: mem(11, layout.entered),
    src: imm(callbackEntered.failed),
  });
  branch(emit, "e", zero);
  emit({
    op: "cmp",
    dst: mem(11, layout.entered),
    src: imm(callbackEntered.idle),
  });
  branch(emit, "ne", missingTransition);
  emit({
    op: "mov",
    dst: mem(11, layout.entered),
    src: imm(callbackEntered.running),
  });

  // Convert into disjoint homes before loading the managed calling convention.
  let numbers = registered ? 1 : 0,
    references = 0;
  if (registered) {
    if (runtimeRegistered)
      emit({ op: "mov", dst: rax, src: mem(5, converted) });
    else emit({ op: "mov", dst: rax, src: imm(-1 - thunk.ordinal) });
    emit({ op: "cvtsi2sd", dst: x0, src: rax });
    emit({ op: "movsd", dst: mem(5, converted), src: x0 });
    if (runtimeRegistered) {
      emit({ op: "cvtsi2sd", dst: x0, src: rbp });
      emit({ op: "movsd", dst: mem(5, converted + 8), src: x0 });
      numbers++;
    }
  }
  for (let index = 0; index < locations.length; index++) {
    const location = locations[index];
    const type = signature?.parameters[index];
    if (location === undefined || type === undefined)
      throw "SysV callback argument invariant";
    const source =
      location.stackOffset >= 0
        ? mem(5, physical.stack + location.stackOffset)
        : mem(
            5,
            location.gp >= 0
              ? physical.registers + location.gp * 8
              : physical.floats + location.fp * 8,
          );
    const view = thunk.views?.find(
      (item) => item !== undefined && item.parameter === index,
    );
    if (view !== undefined) {
      emit({ op: "mov", dst: rax, src: source });
      emit({ op: "test", dst: rax, src: rax });
      branch(emit, "e", badArgument);
      emit({ op: "mov", dst: r11, src: transition });
      emit({ op: "mov", dst: r10, src: mem(11, view.offset) });
      emit({ op: "mov", dst: r11, src: mem(10, nativeArrayOwnerOffset) });
      emit({ op: "mov", dst: mem(11, nativeArrayDataOffset), src: rax });
      emit({ op: "mov", dst: mem(10, nativeArrayDataOffset), src: rax });
      // Temporarily use the outgoing slots for all reference arguments.
      emit({ op: "mov", dst: mem(4, references * 8), src: r10 });
      references++;
      continue;
    }
    const scalar: CScalar = type.kind === "scalar" ? type.scalar : "usize";
    if (type.kind !== "scalar" && type.kind !== "pointer")
      throw "SysV callback arguments require scalars or pointers";
    if (scalar === "f32")
      emit({ op: "cvtss2sd", dst: x0, src: { ...source, width: 32 } });
    else if (scalar === "f64") emit({ op: "movsd", dst: x0, src: source });
    else {
      emit({ op: "mov", dst: rax, src: source });
      fromInteger(
        {
          emit,
          constant: site.constant,
          site: name + ":argument:" + index,
          trap: direct ? badArgument : site.trap,
        },
        cScalarBytes(scalar),
        cScalarSigned(scalar, linuxX86_64CTarget),
      );
    }
    emit({ op: "movsd", dst: mem(5, converted + numbers * 8), src: x0 });
    numbers++;
  }
  for (let index = 0; index < (registered ? 8 : numbers); index++) {
    if (index >= numbers)
      emit({ op: "mov", dst: mem(5, converted + index * 8), src: imm(0) });
    emit({ op: "movsd", dst: xmm(index), src: mem(5, converted + index * 8) });
  }
  if (references > 0) emit({ op: "mov", dst: r8, src: mem(4, 0) });
  if (references > 1) emit({ op: "mov", dst: r9, src: mem(4, 8) });
  for (let index = 2; index < references; index++) {
    emit({ op: "mov", dst: r10, src: mem(4, index * 8) });
    emit({ op: "mov", dst: mem(4, (index - 2) * 8), src: r10 });
  }
  if (signature === undefined && !runtimeRegistered)
    emit({ op: "cvtsi2sd", dst: x0, src: rbp });

  function callFunction(offset: number): void {
    emit({ op: "mov", dst: r11, src: transition });
    emit({ op: "mov", dst: r10, src: mem(11, offset) });
    emit({ op: "mov", dst: rdi, src: mem(11, layout.context) });
    emit({
      op: "mov",
      dst: rsi,
      src: mem(10, nativeFunctionEnvironmentOffset),
    });
    emit({ op: "xor", dst: word(2), src: word(2) });
    emit({ op: "lea", dst: rcx, src: mem(5, payload - resultPayload) });
    emit({ op: "call", target: mem(10, nativeFunctionEntryOffset) });
  }
  callFunction(
    registered ? layout.registered : layout.callbacks + thunk.ordinal * 8,
  );
  emit({ op: "cmp", dst: eax, src: imm(normal) });
  branch(emit, "ne", direct ? onThrow : brokenDispatcher);
  const result = signature?.result;
  if (result === undefined) {
    // The SysV adapter returns one when it wrote the result words.
    emit({ op: "mov", dst: r11, src: transition });
    emit({
      op: "mov",
      dst: mem(11, layout.entered),
      src: imm(callbackEntered.idle),
    });
    emit({ op: "cmp", dst: mem(5, payload), src: imm(0) });
    branch(emit, "e", zero);
    emit({ op: "mov", dst: rax, src: mem(5, physical.registers) });
    emit({ op: "movsd", dst: x0, src: mem(5, physical.floats) });
  } else if (result.kind === "void") emit({ op: "xor", dst: eax, src: eax });
  else {
    if (result.kind !== "scalar" && result.kind !== "pointer")
      throw "SysV callback returns a scalar or pointer";
    const scalar: CScalar = result.kind === "scalar" ? result.scalar : "usize";
    if (scalar === "f32" || scalar === "f64") {
      emit({ op: "movsd", dst: x0, src: mem(5, payload) });
      if (scalar === "f32") emit({ op: "cvtsd2ss", dst: x0, src: x0 });
    } else
      toInteger(
        site,
        mem(5, payload),
        cScalarBytes(scalar),
        cScalarSigned(scalar, linuxX86_64CTarget),
        name + ":return",
        direct ? badResult : site.trap,
      );
  }
  emit({ op: "mov", dst: r11, src: transition });
  emit({
    op: "mov",
    dst: mem(11, layout.entered),
    src: imm(callbackEntered.idle),
  });
  emit({ op: "jmp", target: label(finished) });
  if (direct) {
    emit({ op: "label", name: onThrow });
    emit({ op: "cmp", dst: eax, src: imm(thrown) });
    branch(emit, "ne", site.trap);
    emit({ op: "lea", dst: r8, src: mem(5, payload) });
    callFunction(layout.onThrow);
    emit({ op: "jmp", target: label(noteFailed) });
    emit({ op: "label", name: badArgument });
    emit({ op: "xor", dst: eax, src: eax });
    emit({ op: "jmp", target: label(noteInvalid) });
    emit({ op: "label", name: badResult });
    emit({ op: "mov", dst: eax, src: imm(1) });
    emit({ op: "label", name: noteInvalid });
    emit({ op: "cvtsi2sd", dst: x0, src: eax });
    callFunction(layout.onInvalid);
    emit({ op: "label", name: noteFailed });
    emit({ op: "cmp", dst: eax, src: imm(normal) });
    branch(emit, "ne", site.trap);
    emit({ op: "mov", dst: r11, src: transition });
    emit({
      op: "mov",
      dst: mem(11, layout.entered),
      src: imm(callbackEntered.failed),
    });
  }
  emit({ op: "label", name: zero });
  emit({ op: "xor", dst: eax, src: eax });
  emit({ op: "xorpd", dst: x0, src: x0 });
  emit({ op: "label", name: finished });
  if (site.far) {
    emit({ op: "mov", dst: gpr(14), src: mem(5, 224) });
    emit({ op: "mov", dst: gpr(15), src: mem(5, 232) });
  }
  emit({ op: "add", dst: rsp, src: imm(frameBytes) });
  cfi.record(dwarfStackPointer, 16, saves);
  emit({ op: "pop", dst: rbp });
  cfi.record(dwarfStackPointer, 8, [returnSave]);
  emit({ op: "ret" });
  if (runtimeRegistered) {
    function fatal(target: string, message: string): void {
      emit({ op: "label", name: target });
      cfi.record(dwarfStackPointer, frameBytes + 16, saves);
      for (let i = 0; i < message.length; i += 4) {
        let data = 0;
        let scale = 1;
        for (let byte = 0; byte < 4 && i + byte < message.length; byte++) {
          data += message.charCodeAt(i + byte) * scale;
          scale *= 256;
        }
        emit({
          op: "mov",
          dst: { ...mem(5, physical.registers + i), width: 32 },
          src: imm(data),
        });
      }
      emit({ op: "mov", dst: word(7), src: imm(2) });
      emit({ op: "lea", dst: rsi, src: mem(5, physical.registers) });
      emit({ op: "mov", dst: word(2), src: imm(message.length) });
      site.call("write");
      site.call("abort");
      emit({ op: "jmp", target: label(site.trap) });
    }
    fatal(brokenDispatcher, "node:ffi callback dispatcher failed\n");
    fatal(
      wrongThread,
      "Callbacks can only be invoked on the system thread they were created on\n",
    );
    fatal(missingTransition, "node:ffi callback outside an FFI transition\n");
  }
  emit({ op: "label", name: end });
  return { start: name, end, rule: "rows", rows: cfi.rows };
}
