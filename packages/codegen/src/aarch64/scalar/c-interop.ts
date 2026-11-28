import {
  cScalarBytes,
  cScalarSigned,
  type CScalar,
  type CSignature,
  type CTarget,
} from "@tint/abi/c";
import {
  nativeArrayDataOffset,
  nativeArrayLengthOffset,
  nativeArrayOwnerOffset,
  nativeHeaderFlagUnit,
  nativeHeaderFlagsShift,
  type PosixHostABI,
} from "@tint/abi/host";
import type { WordBuffer } from "@tint/foundation/binary/word-buffer";
import {
  callbackTransition,
  type ForeignCall,
  type ForeignMemoryAccess,
} from "@tint/ir/scalar";
import type { BaseRegister, Branch, Instruction } from "../isa.ts";
import { numericScalar, type ForeignCallPlan } from "./foreign-calls.ts";

export interface CInteropEmitContext {
  readonly instructions: WordBuffer;
  readonly address: (rd: number, offset: number) => void;
  readonly cTarget: () => CTarget;
  readonly callbackThunk: (
    signature: CSignature | undefined,
    ordinal: number,
    views?: readonly number[] | undefined,
    viewOffsets?: readonly number[],
    runtimePrototype?: boolean,
  ) => number;
  readonly compareImmediate: (rn: number, value: number) => void;
  readonly copyToFrame: (offset: number, bytes: number) => void;
  readonly dataPointer: (
    id: number,
    rd: number,
    terminated: boolean,
    minimum: number,
  ) => void;
  readonly dynamicCall: (call: ForeignCall, all: readonly number[]) => void;
  readonly emit: (i: Instruction) => void;
  readonly fixedScalarCall: (
    call: ForeignCall,
    frame: number,
    result: number,
  ) => void;
  readonly floatLoad: (rt: number, id: number, byteOffset?: number) => void;
  readonly floatStore: (rt: number, id: number) => void;
  readonly floatToInteger: (rd: number, rn: number, signed: boolean) => void;
  readonly foreignPlan: (call: ForeignCall) => ForeignCallPlan;
  readonly headerFlags: (rd: number, rn: number) => void;
  readonly host: () => PosixHostABI;
  readonly imm: (rd: number, value: number) => void;
  readonly imm64: (rd: number, lo: number, hi: number) => void;
  readonly importAddress: (rd: number, scratch: number, name: string) => void;
  readonly importCall: (name: string) => void;
  readonly integerToFloat: (
    rd: number,
    rn: number,
    signed: boolean,
    wide: boolean,
  ) => void;
  readonly loadBytes: (
    rd: number,
    base: BaseRegister,
    offset: number,
    bytes: number,
  ) => void;
  readonly narrowLoad: (
    half: boolean,
    rt: number,
    rn: BaseRegister,
    offset: number,
  ) => void;
  readonly narrowStore: (
    half: boolean,
    rt: number,
    rn: BaseRegister,
    offset: number,
  ) => void;
  readonly numberToInteger: (id: number, rd: number, scalar: CScalar) => void;
  readonly patchInstruction: (index: number, instruction: Instruction) => void;
  readonly popTransition: (
    state: number,
    record: number,
    returnAddressAt: number,
    words: readonly number[],
    returnPC?: number,
  ) => void;
  readonly provenInteger: (id: number, rd: number, scalar: CScalar) => void;
  readonly pushTransition: (
    state: number,
    dispatcher: number,
    callees: readonly number[],
    record: number,
    words: number[],
    notes?: readonly number[],
    views?: readonly number[],
  ) => number;
  readonly rawRegister: (id: number, scratch: number) => number;
  readonly rawValue: (rt: number, id: number) => void;
  readonly rejectSaturated: (rn: number, signed: boolean) => void;
  readonly saveRaw: (rt: number, id: number) => void;
  readonly scalarDynamicCall: (
    call: ForeignCall,
    operands: readonly number[],
    result: number,
  ) => void;
  readonly storeBytes: (
    rs: number,
    base: BaseRegister,
    offset: number,
    bytes: number,
  ) => void;
  readonly storedAsInteger: (id: number) => boolean;
  readonly thunkAddress: (rd: number, thunk: number | undefined) => void;
  readonly trapIf: (branch: Branch) => void;
  readonly viewValueToken: (id: number) => number;
}

export interface CMemoryInstruction {
  readonly kind: "c-memory";
  readonly access: ForeignMemoryAccess;
  readonly id: number | undefined;
  readonly arguments: readonly number[];
}

export interface CCallInstruction {
  readonly kind: "c-call";
  readonly call: ForeignCall;
  readonly id: number | undefined;
  readonly arguments: readonly number[];
}

export function emitCMemory(
  ctx: CInteropEmitContext,
  op: CMemoryInstruction,
  initialViewToken: number,
): number {
  let viewToken = initialViewToken;
  const {
    instructions,
    cTarget,
    callbackThunk,
    compareImmediate,
    dataPointer,
    emit,
    floatLoad,
    floatStore,
    floatToInteger,
    headerFlags,
    host,
    imm,
    imm64,
    importAddress,
    integerToFloat,
    loadBytes,
    narrowLoad,
    narrowStore,
    numberToInteger,
    patchInstruction,
    provenInteger,
    rawRegister,
    rawValue,
    rejectSaturated,
    saveRaw,
    storeBytes,
    storedAsInteger,
    trapIf,
    viewValueToken,
  } = ctx;
  // C memory through a Uint8Array (docs/native-ffi.md): not a
  // safepoint; x9-x13, d0 and d1 are scratch.
  const access = op.access,
    operands = op.arguments,
    base = operands[0],
    resultId = op.id;
  if (access.operation === "stable") {
    // Borrowed (flag 1), or a view (flag 2) of a borrowed
    // owner: data that no collection moves.
    const array = op.arguments[0];
    if (resultId === undefined || array === undefined)
      throw "c-memory stable invariant";
    rawValue(9, array);
    const flags = (): void => {
      emit({ op: "ldr", width: 64, rt: 10, rn: 9, offset: 0 });
      emit({
        op: "ubfm",
        width: 64,
        rd: 10,
        rn: 10,
        immr: nativeHeaderFlagsShift,
        imms: nativeHeaderFlagsShift + 2,
      });
    };
    flags();
    emit({
      op: "sub-imm",
      width: 64,
      rd: "zr",
      rn: 10,
      immediate: 2,
      shift: 0,
      setFlags: true,
    });
    const notView = instructions.length;
    emit({ op: "b.cond", condition: "ne", displacement: 0 });
    emit({
      op: "ldr",
      width: 64,
      rt: 9,
      rn: 9,
      offset: nativeArrayOwnerOffset,
    });
    flags();
    patchInstruction(notView, {
      op: "b.cond",
      condition: "ne",
      displacement: (instructions.length - notView) * 4,
    });
    emit({
      op: "sub-imm",
      width: 64,
      rd: "zr",
      rn: 10,
      immediate: 1,
      shift: 0,
      setFlags: true,
    });
    emit({ op: "cset", rd: 9, condition: "eq" });
    saveRaw(9, resultId);
    return viewToken;
  }
  if (access.operation === "runtime-callback-address") {
    if (resultId === undefined) throw "runtime callback address invariant";
    importAddress(
      9,
      10,
      "tint:callback-thunk:" +
        String(
          callbackThunk(
            access.callback,
            -1,
            undefined,
            [],
            access.callback !== undefined,
          ),
        ),
    );
    emit({ op: "scvtf-d-x", rd: 0, rn: 9 });
    floatStore(0, resultId);
    return viewToken;
  }
  if (access.operation === "callback-address") {
    // A registered callback thunk's entry.
    const prototype = access.callback,
      slot = access.slot;
    if (resultId === undefined || prototype === undefined || slot === undefined)
      throw "c-memory callback address invariant";
    importAddress(
      9,
      10,
      "tint:callback-thunk:" + String(callbackThunk(prototype, -1 - slot)),
    );
    emit({ op: "scvtf-d-x", rd: 0, rn: 9 });
    floatStore(0, resultId);
    return viewToken;
  }
  if (access.operation === "callback-key") {
    // The image's callback key word (startup resolves it).
    if (resultId === undefined) throw "c-memory callback key invariant";
    importAddress(9, 10, "tint:callback-key");
    emit({ op: "scvtf-d-x", rd: 0, rn: 9 });
    floatStore(0, resultId);
    return viewToken;
  }
  if (access.operation === "available") {
    // An absent weak import reads as zero.
    const symbol = access.symbol;
    if (resultId === undefined || symbol === undefined)
      throw "c-memory availability invariant";
    importAddress(9, 10, host().symbolPrefix + symbol);
    emit({ op: "ldr", width: 64, rt: 9, rn: 9, offset: 0 });
    emit({
      op: "sub-imm",
      width: 64,
      rd: "zr",
      rn: 9,
      immediate: 0,
      shift: 0,
      setFlags: true,
    });
    emit({ op: "cset", rd: 9, condition: "ne" });
    saveRaw(9, resultId);
    return viewToken;
  }
  if (base === undefined) throw "c-memory operand invariant";
  if (access.operation === "fits") {
    // The exact round trip of the c-call conversions, as a
    // boolean (w9): integral, in range, and for 64-bit types
    // not a saturation bound.
    if (resultId === undefined) throw "c-memory fits invariant";
    const scalar = numericScalar(access.type),
      bytes = cScalarBytes(scalar),
      signed = cScalarSigned(scalar, cTarget());
    floatLoad(0, base);
    if (bytes === 8) {
      floatToInteger(12, 0, signed);
      integerToFloat(1, 12, signed, true);
      emit({
        op: "add-imm",
        width: 64,
        rd: "zr",
        rn: 12,
        immediate: 1,
        shift: 0,
        setFlags: true,
      });
      emit({
        op: "cset",
        rd: 10,
        condition: signed ? "vc" : "ne",
      });
    } else if (bytes === 4 && !signed) {
      emit({ op: "fcvtzu-w-d", rd: 12, rn: 0 });
      emit({ op: "ucvtf-d-w", rd: 1, rn: 12 });
    } else {
      emit({ op: "fcvtzs-w-d", rd: 12, rn: 0 });
      emit({ op: "scvtf-d-w", rd: 1, rn: 12 });
    }
    emit({ op: "fcmp", rn: 0, rm: 1 });
    emit({ op: "cset", rd: 9, condition: "eq" });
    if (bytes < 4) {
      emit({
        op: signed ? "sbfm" : "ubfm",
        width: 32,
        rd: 10,
        rn: 12,
        immr: 0,
        imms: bytes * 8 - 1,
      });
      emit({
        op: "sub-reg",
        width: 32,
        rd: "zr",
        rn: 10,
        rm: 12,
        shift: "lsl",
        amount: 0,
        setFlags: true,
      });
      emit({ op: "cset", rd: 10, condition: "eq" });
    }
    if (bytes !== 4) emit({ op: "and-reg", width: 32, rd: 9, rn: 9, rm: 10 });
    saveRaw(9, resultId);
    return viewToken;
  }
  if (access.operation === "address-into") {
    const destination = operands[1];
    if (destination === undefined) throw "c-memory address output invariant";
    dataPointer(base, 12, false, 0);
    dataPointer(destination, 13, false, 8);
    emit({ op: "str", width: 64, rt: 12, rn: 13, offset: 0 });
    return viewToken;
  }
  if (access.operation === "address") {
    // The data address of an external (borrowed) array, or -1:
    // owned and view storage moves with collections.
    if (resultId === undefined) throw "c-memory result invariant";
    rawValue(9, base);
    emit({ op: "ldr", width: 64, rt: 10, rn: 9, offset: 0 });
    emit({
      op: "ubfm",
      width: 64,
      rd: 10,
      rn: 10,
      immr: nativeHeaderFlagsShift,
      imms: nativeHeaderFlagsShift + 2,
    });
    emit({
      op: "ldr",
      width: 64,
      rt: 11,
      rn: 9,
      offset: nativeArrayDataOffset,
    });
    emit({
      op: "orn-reg",
      width: 64,
      rd: 12,
      rn: "zr",
      rm: "zr",
    });
    emit({
      op: "sub-imm",
      width: 64,
      rd: "zr",
      rn: 10,
      immediate: 1,
      shift: 0,
      setFlags: true,
    });
    emit({
      op: "csel",
      width: 64,
      rd: 11,
      rn: 11,
      rm: 12,
      condition: "eq",
    });
    // Exact: user-space addresses are below 2^53.
    emit({ op: "scvtf-d-x", rd: 0, rn: 11 });
    floatStore(0, resultId);
    return viewToken;
  }
  if (access.operation === "retarget") {
    // An external array (borrowed flag exactly) gets a new data
    // address, or a view whose owner is one (foreign views):
    // then both. Lengths are unchanged; collectors never move
    // external data, so the pair stays consistent.
    const address = operands[1];
    if (address === undefined) throw "c-memory retarget invariant";
    numberToInteger(address, 12, "usize");
    rawValue(9, base);
    headerFlags(10, 9);
    compareImmediate(10, 1);
    const external = instructions.length;
    emit({ op: "b.cond", condition: "eq", displacement: 0 });
    compareImmediate(10, 2);
    trapIf({ op: "b.cond", condition: "ne" });
    emit({
      op: "ldr",
      width: 64,
      rt: 11,
      rn: 9,
      offset: nativeArrayOwnerOffset,
    });
    headerFlags(10, 11);
    compareImmediate(10, 1);
    trapIf({ op: "b.cond", condition: "ne" });
    emit({
      op: "str",
      width: 64,
      rt: 12,
      rn: 11,
      offset: nativeArrayDataOffset,
    });
    patchInstruction(external, {
      op: "b.cond",
      condition: "eq",
      displacement: (instructions.length - external) * 4,
    });
    emit({
      op: "str",
      width: 64,
      rt: 12,
      rn: 9,
      offset: nativeArrayDataOffset,
    });
    return viewToken;
  }
  if (access.operation === "adopt" || access.operation === "adopt-words") {
    // Owned and empty (header exactly the Uint8Array marker,
    // length 0) becomes an external view: borrowed flag, the
    // length and the address. The extent is unchanged (both
    // round to 32 bytes), so collectors see a valid object.
    const exact = access.operation === "adopt-words";
    const address = operands[1],
      length = operands[exact ? 3 : 2];
    if (address === undefined || length === undefined || resultId === undefined)
      throw "c-memory adopt invariant";
    if (exact) {
      const high = operands[2];
      if (high === undefined) throw "c-memory adopt high word invariant";
      numberToInteger(address, 12, "u32");
      numberToInteger(high, 11, "u32");
      emit({
        op: "add-reg",
        width: 64,
        rd: 12,
        rn: 12,
        rm: 11,
        shift: "lsl",
        amount: 32,
        setFlags: false,
      });
    } else numberToInteger(address, 12, "usize");
    numberToInteger(length, 13, "u32");
    rawValue(9, base);
    emit({ op: "ldr", width: 64, rt: 10, rn: 9, offset: 0 });
    emit({
      op: "sub-imm",
      width: 64,
      rd: "zr",
      rn: 10,
      immediate: 2,
      shift: 0,
      setFlags: true,
    });
    trapIf({ op: "b.cond", condition: "ne" });
    emit({
      op: "ldr",
      width: 32,
      rt: 10,
      rn: 9,
      offset: nativeArrayLengthOffset,
    });
    trapIf({ op: "cbnz", width: 32, rt: 10 });
    imm64(10, 2, nativeHeaderFlagUnit / 4294967296);
    emit({ op: "str", width: 64, rt: 10, rn: 9, offset: 0 });
    emit({
      op: "str",
      width: 64,
      rt: 13,
      rn: 9,
      offset: nativeArrayLengthOffset,
    });
    emit({
      op: "str",
      width: 64,
      rt: 12,
      rn: 9,
      offset: nativeArrayDataOffset,
    });
    saveRaw(9, resultId);
    return viewToken;
  }
  // A C view member: the view's creation proved its size
  // and the lowering checked a stored value and an element
  // index, so this is the data pointer and one access at the
  // constant offset (plus the index times the stride).
  const type = access.type,
    scalar = numericScalar(type),
    bytes = cScalarBytes(scalar),
    signed = cScalarSigned(scalar, cTarget()),
    stride = access.stride;
  const value = operands[stride === undefined ? 1 : 2];
  if (access.operation === "store") {
    if (value === undefined) throw "c-memory store invariant";
    if (scalar === "f64" || scalar === "f32") {
      floatLoad(0, value);
      if (scalar === "f32") {
        emit({ op: "fcvt-s-d", rd: 0, rn: 0 });
        emit({ op: "fmov-w-s", rd: 12, rn: 0 });
      }
    } else if (scalar === "bool") rawValue(12, value);
    else provenInteger(value, 12, scalar);
  }
  // x11 keeps the view's data pointer for the next access to
  // the same view (viewData); element and unaligned
  // addresses are formed in x13.
  const baseToken = viewValueToken(base);
  if (baseToken !== viewToken) {
    rawValue(9, base);
    emit({
      op: "ldr",
      width: 64,
      rt: 11,
      rn: 9,
      offset: nativeArrayDataOffset,
    });
  }
  viewToken = baseToken;
  let at = 11;
  if (stride !== undefined) {
    // The index is an integer in range (checked before).
    const index = operands[1];
    if (index === undefined) throw "c-memory index invariant";
    let position = 10;
    if (storedAsInteger(index)) position = rawRegister(index, 10);
    else {
      floatLoad(1, index);
      emit({ op: "fcvtzu-x-d", rd: 10, rn: 1 });
    }
    let shift = -1;
    for (let power = 0; power < 4; power++)
      if (stride === 1 << power) shift = power;
    if (shift >= 0)
      emit({
        op: "add-reg",
        width: 64,
        rd: 13,
        rn: 11,
        rm: position,
        shift: "lsl",
        amount: shift,
        setFlags: false,
      });
    else {
      imm(14, stride);
      emit({
        op: "madd",
        width: 64,
        rd: 13,
        rn: position,
        rm: 14,
        ra: 11,
      });
    }
    at = 13;
  }
  // Scaled immediate when aligned and in reach, else the
  // address is formed first (packed or distant members).
  let offset = access.offset;
  if (offset % bytes !== 0 || offset / bytes > 4095) {
    if (offset <= 4095)
      emit({
        op: "add-imm",
        width: 64,
        rd: 13,
        rn: at,
        immediate: offset,
        shift: 0,
        setFlags: false,
      });
    else {
      imm(10, offset);
      emit({
        op: "add-reg",
        width: 64,
        rd: 13,
        rn: at,
        rm: 10,
        shift: "lsl",
        amount: 0,
        setFlags: false,
      });
    }
    at = 13;
    offset = 0;
  }
  if (access.operation === "store") {
    if (scalar === "f64") emit({ op: "str-d", rt: 0, rn: at, offset });
    else if (bytes === 8)
      emit({ op: "str", width: 64, rt: 12, rn: at, offset });
    else if (bytes === 4)
      emit({ op: "str", width: 32, rt: 12, rn: at, offset });
    else narrowStore(bytes === 2, 12, at, offset);
    return viewToken;
  }
  if (resultId === undefined) throw "c-memory load invariant";
  if (scalar === "f64") {
    emit({ op: "ldr-d", rt: 0, rn: at, offset });
    floatStore(0, resultId);
    return viewToken;
  }
  if (bytes === 8) emit({ op: "ldr", width: 64, rt: 12, rn: at, offset });
  else if (bytes === 4) emit({ op: "ldr", width: 32, rt: 12, rn: at, offset });
  else narrowLoad(bytes === 2, 12, at, offset);
  if (scalar === "bool") {
    // C's _Bool holds 0 or 1; normalize anyway.
    emit({
      op: "sub-imm",
      width: 32,
      rd: "zr",
      rn: 12,
      immediate: 0,
      shift: 0,
      setFlags: true,
    });
    emit({ op: "cset", rd: 12, condition: "ne" });
    saveRaw(12, resultId);
    return viewToken;
  }
  if (scalar === "f32") {
    emit({ op: "fmov-s-w", rd: 0, rn: 12 });
    emit({ op: "fcvt-d-s", rd: 0, rn: 0 });
  } else if (bytes === 8) {
    // Exact or trap, as c-call results.
    rejectSaturated(12, signed);
    integerToFloat(0, 12, signed, true);
    floatToInteger(13, 0, signed);
    emit({
      op: "sub-reg",
      width: 64,
      rd: "zr",
      rn: 13,
      rm: 12,
      shift: "lsl",
      amount: 0,
      setFlags: true,
    });
    trapIf({ op: "b.cond", condition: "ne" });
  } else {
    if (bytes < 4 && signed)
      emit({
        op: "sbfm",
        width: 32,
        rd: 12,
        rn: 12,
        immr: 0,
        imms: bytes * 8 - 1,
      });
    integerToFloat(0, 12, signed, false);
  }
  floatStore(0, resultId);
  return viewToken;

  return viewToken;
}

export function emitCCall(
  ctx: CInteropEmitContext,
  op: CCallInstruction,
): void {
  const {
    instructions,
    address,
    cTarget,
    callbackThunk,
    copyToFrame,
    dataPointer,
    dynamicCall,
    emit,
    fixedScalarCall,
    floatLoad,
    floatStore,
    floatToInteger,
    foreignPlan,
    host,
    imm,
    imm64,
    importAddress,
    importCall,
    integerToFloat,
    loadBytes,
    narrowStore,
    numberToInteger,
    patchInstruction,
    popTransition,
    pushTransition,
    rawValue,
    rejectSaturated,
    saveRaw,
    scalarDynamicCall,
    storeBytes,
    thunkAddress,
    trapIf,
  } = ctx;
  if (op.call.dynamicScalar === true) {
    const result = op.id;
    if (result === undefined) throw "scalar dynamic status invariant";
    if (op.call.staticScalar === undefined)
      scalarDynamicCall(op.call, op.arguments, result);
    else {
      const frame = op.arguments[0];
      if (frame === undefined) throw "fixed scalar frame invariant";
      fixedScalarCall(op.call, frame, result);
    }
    return;
  }
  if (op.call.dynamic === true) {
    dynamicCall(op.call, op.arguments);
    return;
  }
  // Leaf C call (docs/native-ffi.md): not a safepoint, so no
  // stack map; x19-x28 and d8-d15 homes survive per AAPCS64.
  // Order: stack arguments and indirect copies, X registers
  // (and X8), then V registers last, because integer
  // conversions use d0/d1 as scratch. Helpers use x9-x14,
  // d16 and x16/x17 (the import sequence) only.
  const call = op.call,
    plan = foreignPlan(call),
    layout = plan.layout,
    target = cTarget();
  // An indirect call's callee address comes first: convert
  // it into x15 (untouched by the helpers below) before any
  // argument register is loaded.
  const indirect = call.indirect === true,
    mayCallback = call.mayCallback === true,
    // The prototype's operand forms (a may-callback call's
    // state operand comes first).
    forms = mayCallback ? call.operands.slice(2) : call.operands;
  let operands = op.arguments;
  // A may-callback call pushes its transition record onto the
  // calling thread's callback state block (operand 0) before
  // any argument register is loaded: previous record, this
  // frame's x29, the call's return address (patched once the
  // blr is emitted) and a clear entered flag.
  let returnAddressAt = -1,
    stateOperand = -1;
  // Callback operands: their thunks, and the transition words
  // holding their function values.
  const callbackThunks: number[] = [],
    callbackWords: number[] = [];
  if (mayCallback) {
    const state = operands[0],
      dispatcher = operands[1];
    if (state === undefined || dispatcher === undefined)
      throw "c-call state invariant";
    stateOperand = state;
    operands = operands.slice(2);
    // Direct callbacks (no adapter): the failure notes and
    // their views follow the prototype's operands.
    const prototypeEnd = call.signature.parameters.length,
      extras = operands.slice(prototypeEnd),
      notes = extras.slice(0, 2),
      views = extras.slice(2);
    let count = 0;
    for (let index = 0; index < prototypeEnd; index++)
      if (call.callbacks?.[index] !== undefined) count++;
    const callees: number[] = [];
    let viewIndex = 0;
    for (let index = 0; index < prototypeEnd; index++) {
      if (call.operands[index + 2] !== "callback") continue;
      const prototype = call.callbacks?.[index],
        callee = operands[index];
      if (prototype === undefined || callee === undefined)
        throw "c-call callback invariant";
      const direct = call.directCallbacks?.[index];
      if (direct === undefined)
        callbackThunks[index] = callbackThunk(prototype, callees.length);
      else {
        const offsets: number[] = [];
        for (let view = 0; view < direct.length; view++)
          offsets.push(
            callbackTransition.callbacks + (count + viewIndex + view) * 8,
          );
        viewIndex += direct.length;
        callbackThunks[index] = callbackThunk(
          prototype,
          callees.length,
          direct,
          offsets,
        );
      }
      callees.push(callee);
    }
    if (views.length !== viewIndex)
      throw "c-call direct callback view invariant";
    returnAddressAt = pushTransition(
      state,
      dispatcher,
      callees,
      plan.transition,
      callbackWords,
      notes,
      views,
    );
  }
  if (indirect) {
    const callee = operands[0];
    if (callee === undefined) throw "c-call callee invariant";
    numberToInteger(callee, 15, "usize");
    trapIf({ op: "cbz", width: 64, rt: 15 });
    operands = operands.slice(1);
  }
  function operand(index: number): number {
    const id = operands[index];
    if (id === undefined) throw "c-call argument invariant";
    return id;
  }
  // Stack arguments and indirect copies.
  for (let index = 0; index < layout.arguments.length; index++) {
    const location = layout.arguments[index],
      form = forms[index],
      type = call.signature.parameters[index];
    if (location === undefined || form === undefined || type === undefined)
      throw "c-call location invariant";
    const id = operand(index);
    if (location.class === "indirect") {
      const copy = plan.copies[index] ?? -1;
      dataPointer(id, 12, false, plan.minimums[index] ?? 0);
      copyToFrame(copy, location.size);
      if (location.stackOffset >= 0) {
        address(14, copy);
        emit({
          op: "str",
          width: 64,
          rt: 14,
          rn: "sp",
          offset: location.stackOffset,
        });
      }
      continue;
    }
    if (location.stackOffset < 0) continue;
    const offset = location.stackOffset;
    if (location.class === "composite" || location.class === "hfa") {
      dataPointer(id, 12, false, plan.minimums[index] ?? 0);
      copyToFrame(offset, location.size);
    } else if (location.class === "float") {
      floatLoad(16, id);
      if (location.size === 4 && !location.variadic) {
        emit({ op: "fcvt-s-d", rd: 16, rn: 16 });
        emit({ op: "fmov-w-s", rd: 14, rn: 16 });
        emit({ op: "str", width: 32, rt: 14, rn: "sp", offset });
      } else emit({ op: "str-d", rt: 16, rn: "sp", offset });
    } else if (form === "callback") {
      thunkAddress(14, callbackThunks[index]);
      emit({ op: "str", width: 64, rt: 14, rn: "sp", offset });
    } else if (form === "bytes" || form === "terminated-bytes") {
      dataPointer(
        id,
        14,
        form === "terminated-bytes",
        plan.minimums[index] ?? 0,
      );
      emit({ op: "str", width: 64, rt: 14, rn: "sp", offset });
    } else {
      const scalar = numericScalar(type);
      // A promoted variadic integer is range-checked as its
      // declared type and fills its 8-byte slot.
      if (form === "boolean") rawValue(14, id);
      else numberToInteger(id, 14, scalar);
      const bytes = location.variadic ? 8 : cScalarBytes(scalar);
      if (bytes === 8) emit({ op: "str", width: 64, rt: 14, rn: "sp", offset });
      else if (bytes === 4)
        emit({ op: "str", width: 32, rt: 14, rn: "sp", offset });
      else narrowStore(bytes === 2, 14, "sp", offset);
    }
  }
  // X registers.
  for (let index = 0; index < layout.arguments.length; index++) {
    const location = layout.arguments[index],
      form = forms[index],
      type = call.signature.parameters[index];
    if (location === undefined || form === undefined || type === undefined)
      throw "c-call location invariant";
    if (location.stackOffset >= 0 || location.gp < 0) continue;
    const id = operand(index),
      rd = location.gp;
    if (location.class === "indirect") address(rd, plan.copies[index] ?? 0);
    else if (location.class === "composite") {
      dataPointer(id, 12, false, plan.minimums[index] ?? 0);
      for (let word = 0; word < location.registers; word++)
        loadBytes(
          rd + word,
          12,
          word * 8,
          Math.min(8, location.size - word * 8),
        );
    } else if (form === "callback") thunkAddress(rd, callbackThunks[index]);
    else if (form === "bytes" || form === "terminated-bytes")
      dataPointer(
        id,
        rd,
        form === "terminated-bytes",
        plan.minimums[index] ?? 0,
      );
    else if (form === "boolean") rawValue(rd, id);
    else numberToInteger(id, rd, numericScalar(type));
  }
  const results = operands.length - layout.arguments.length;
  if (results === 1) {
    dataPointer(
      operand(layout.arguments.length),
      layout.result.class === "indirect" ? 8 : -1,
      false,
      plan.resultBytes,
    );
  }
  // V registers.
  for (let index = 0; index < layout.arguments.length; index++) {
    const location = layout.arguments[index];
    if (location === undefined) throw "c-call location invariant";
    if (location.stackOffset >= 0 || location.fp < 0) continue;
    const id = operand(index),
      rd = location.fp;
    if (location.class === "float") {
      floatLoad(rd, id);
      if (location.size === 4) emit({ op: "fcvt-s-d", rd, rn: rd });
    } else {
      dataPointer(id, 12, false, plan.minimums[index] ?? 0);
      for (let member = 0; member < location.registers; member++) {
        if (location.memberBytes === 8)
          emit({
            op: "ldr-d",
            rt: rd + member,
            rn: 12,
            offset: member * 8,
          });
        else {
          emit({
            op: "ldr",
            width: 32,
            rt: 13,
            rn: 12,
            offset: member * 4,
          });
          emit({ op: "fmov-s-w", rd: rd + member, rn: 13 });
        }
      }
    }
  }
  if (indirect) emit({ op: "blr", rn: 15 });
  else importCall(host().symbolPrefix + call.symbol);
  if (mayCallback)
    popTransition(
      stateOperand,
      plan.transition,
      returnAddressAt,
      callbackWords,
    );
  const resultId = op.id,
    result = layout.result,
    resultType = call.signature.result;
  if (call.result === "record") {
    if (result.class !== "indirect") {
      // Reload the result buffer's data pointer (its home is
      // callee-saved or in the frame).
      rawValue(9, operand(layout.arguments.length));
      emit({
        op: "ldr",
        width: 64,
        rt: 12,
        rn: 9,
        offset: nativeArrayDataOffset,
      });
      if (result.class === "composite")
        for (let word = 0; word < result.registers; word++)
          storeBytes(word, 12, word * 8, Math.min(8, result.size - word * 8));
      else
        for (let member = 0; member < result.registers; member++) {
          if (result.memberBytes === 8)
            emit({
              op: "str-d",
              rt: member,
              rn: 12,
              offset: member * 8,
            });
          else {
            emit({ op: "fmov-w-s", rd: 13, rn: member });
            emit({
              op: "str",
              width: 32,
              rt: 13,
              rn: 12,
              offset: member * 4,
            });
          }
        }
    }
    return;
  }
  if (call.result === "void") return;
  if (resultId === undefined) throw "verified c-call result invariant";
  const scalar = numericScalar(resultType);
  if (call.result === "boolean") {
    emit({
      op: "ubfm",
      width: 32,
      rd: 0,
      rn: 0,
      immr: 0,
      imms: 7,
    });
    saveRaw(0, resultId);
    return;
  }
  if (scalar === "f32" || scalar === "f64") {
    if (scalar === "f32") emit({ op: "fcvt-d-s", rd: 0, rn: 0 });
    floatStore(0, resultId);
    return;
  }
  const bytes = cScalarBytes(scalar),
    signed = cScalarSigned(scalar, target),
    wide = bytes === 8;
  if (bytes < 4)
    emit({
      op: signed ? "sbfm" : "ubfm",
      width: 32,
      rd: 0,
      rn: 0,
      immr: 0,
      imms: bytes * 8 - 1,
    });
  let success = -1,
    finish = -1;
  if (call.signature.errno === "negated-result") {
    // Exactly the host operations' -errno protocol.
    emit({
      op: "sub-imm",
      width: wide ? 64 : 32,
      rd: "zr",
      rn: 0,
      immediate: 0,
      shift: 0,
      setFlags: true,
    });
    success = instructions.length;
    emit({ op: "b.cond", condition: "ge", displacement: 0 });
    importCall(host().errnoSymbol);
    emit({ op: "ldr", width: 32, rt: 9, rn: 0, offset: 0 });
    emit({ op: "scvtf-d-w", rd: 0, rn: 9 });
    emit({ op: "fneg", rd: 0, rn: 0 });
    finish = instructions.length;
    emit({ op: "b", displacement: 0 });
  }
  const good = instructions.length;
  if (wide) {
    // 64-bit results must be exact numbers (|x| <= 2^53 or
    // otherwise representable); anything else traps.
    rejectSaturated(0, signed);
    integerToFloat(0, 0, signed, true);
    floatToInteger(9, 0, signed);
    emit({
      op: "sub-reg",
      width: 64,
      rd: "zr",
      rn: 9,
      rm: 0,
      shift: "lsl",
      amount: 0,
      setFlags: true,
    });
    trapIf({ op: "b.cond", condition: "ne" });
  } else integerToFloat(0, 0, signed || bytes < 4, false);
  const done = instructions.length;
  if (success >= 0) {
    patchInstruction(success, {
      op: "b.cond",
      condition: "ge",
      displacement: (good - success) * 4,
    });
    patchInstruction(finish, {
      op: "b",
      displacement: (done - finish) * 4,
    });
  }
  floatStore(0, resultId);
  return;
}
