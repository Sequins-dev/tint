/** Linux x86-64 call-frame policy for tint:ffi/unsafe. The dynamic
 * loader, public value types, scalar readers and argument bookkeeping are
 * shared with the default implementation. */
import type { CSignature } from "@tint/abi/c";
import {
  classifySysVCCall,
  linuxX86_64CTarget,
  sysVCallbackFrame,
  type SysVCallLayout,
} from "@tint/abi/c/sysv";
import { Cell, DynamicFrame } from "tint:c/dl";
import { callForeign, callForeignCallbacks } from "./primitives.ts";
import {
  allocate,
  callbackDispatcher,
  callbackState,
  rethrowCallbackFailure,
  stableBytes,
} from "./index.ts";
import { bytesAt } from "./unsafe.ts";
import {
  argumentLocation,
  byteOperands,
  callbackOperands,
  cellRange,
  cellValue,
  clearWord,
  exactAddress,
  frameFloats,
  frameScratch,
  frameStack,
  noBytes,
  parameter,
  patchCapacity,
  resultByte,
  resultBytes,
  scalarOf,
  scratchCapacity,
  setNumber as setScalarNumber,
  settle,
  stackCapacity,
  wide,
  wordNumber,
  wordOffset,
  type ForeignFunction as SharedForeignFunction,
  type DynamicCallback,
} from "./dynamic.ts";

export {
  closeLibrary,
  findSymbol,
  openLibrary,
  openProgram,
  optionalSymbol,
  resultBoolean,
  resultHigh,
  resultLow,
  resultNumber,
  setBoolean,
  setBytes,
  setWords,
  type DynamicCallback,
  type ForeignSignature,
  type ForeignType,
  type LibraryHandle,
} from "./dynamic.ts";

export interface ForeignFunction extends SharedForeignFunction {
  readonly layout: SysVCallLayout;
}
const callbackFrames: Uint8Array[] = [];
const callbackNesting = { depth: 0 };

export function foreignFunction(
  address: number,
  signature: CSignature,
): ForeignFunction {
  if (exactAddress(address, "function") === 0)
    throw new TypeError("null C function address");
  if (signature.callClass === "async")
    throw new TypeError("dynamic calls are synchronous");
  const classified = classifySysVCCall(signature, linuxX86_64CTarget);
  if (!classified.ok) throw new TypeError(classified.error);
  const layout = classified.value;
  if (
    layout.stackBytes > stackCapacity ||
    layout.stackAlignment > stackCapacity
  )
    throw new RangeError("too many stack arguments for a dynamic call");
  const bytes: Uint8Array[] = [],
    slots: number[] = [],
    assigned: boolean[] = [];
  let operand = 0;
  for (let index = 0; index < signature.parameters.length; index++) {
    const type = signature.parameters[index];
    if (type === undefined) throw "dynamic signature invariant";
    bytes.push(noBytes);
    assigned.push(false);
    if (type.kind === "pointer") {
      if (operand >= byteOperands)
        throw new RangeError("a dynamic call takes at most 8 pointers");
      slots.push(operand++);
    } else slots.push(-1);
  }
  const resultCopy = layout.result.class === "indirect" ? 0 : -1;
  if (
    resultCopy >= 0 &&
    layout.result.size + layout.result.alignment - 1 > scratchCapacity
  )
    throw new RangeError("records too large for a dynamic call");
  return {
    address,
    signature,
    layout,
    frame: new Uint8Array(DynamicFrame.size),
    cell: new Uint8Array(Cell.size),
    results: new Uint8Array(resultBytes),
    bytes,
    slots,
    copies: [],
    assigned,
    resultCopy,
    callbacks: [],
    failure: { failed: false, error: undefined },
  };
}

export function setNumber(
  fn: ForeignFunction,
  index: number,
  value: number,
): void {
  const type = parameter(fn, index),
    location = argumentLocation(fn, index);
  if (type.kind !== "scalar" || type.scalar !== "f32" || !location.variadic) {
    setScalarNumber(fn, index, value);
    return;
  }
  // Default C promotions preserve the f32 rounding before widening to f64.
  const view = Cell.view(fn.cell);
  view.f32 = value;
  view.f64 = view.f32;
  const offset = wordOffset(location);
  for (let byte = 0; byte < 8; byte++)
    fn.frame[offset + byte] = fn.cell[byte] ?? 0;
  fn.assigned[index] = true;
}

export function setRecord(
  fn: ForeignFunction,
  index: number,
  image: Uint8Array,
): void {
  const type = parameter(fn, index),
    location = argumentLocation(fn, index);
  if (type.kind !== "record") throw new TypeError("not a C record parameter");
  if (image.length < location.size)
    throw new RangeError("a C record image needs " + location.size + " bytes");
  if (location.stackOffset >= 0) {
    const offset = frameStack + location.stackOffset;
    for (let at = 0; at < location.size; at++)
      fn.frame[offset + at] = image[at] ?? 0;
  } else {
    const parts = fn.layout.arguments[index]?.parts;
    if (parts === undefined) throw "SysV record argument invariant";
    for (const part of parts) {
      if (part === undefined) throw "SysV record part invariant";
      const to = (part.bank === "sse" ? frameFloats : 0) + part.register * 8;
      clearWord(fn, to);
      for (let at = 0; at < part.bytes; at++)
        fn.frame[to + at] = image[part.offset + at] ?? 0;
    }
  }
  fn.assigned[index] = true;
}

export function setCallback(
  fn: ForeignFunction,
  index: number,
  signature: CSignature,
  callback: DynamicCallback,
): void {
  if (parameter(fn, index).kind !== "pointer")
    throw new TypeError("not a C pointer parameter");
  if (
    signature.callClass !== "leaf" ||
    signature.fixedParameters !== signature.parameters.length
  )
    throw new TypeError("callbacks need a fixed C prototype");
  const classified = classifySysVCCall(signature, linuxX86_64CTarget);
  if (!classified.ok) throw new TypeError(classified.error);
  const layout = classified.value;
  for (const type of signature.parameters) {
    if (type === undefined) throw "dynamic callback parameter invariant";
    scalarOf(type);
  }
  const result = signature.result;
  const resultScalar = result.kind === "void" ? "void" : scalarOf(result);
  let used = 0;
  for (const adapter of fn.callbacks) if (adapter !== undefined) used++;
  if (fn.callbacks[index] === undefined && used >= callbackOperands)
    throw new RangeError("a dynamic call takes at most 4 callbacks");
  const failure = fn.failure;
  fn.callbacks[index] = (frame: number): number => {
    if (failure.failed) return 0;
    try {
      const args: number[] = [];
      for (let at = 0; at < layout.arguments.length; at++) {
        const location = layout.arguments[at],
          type = signature.parameters[at];
        if (location === undefined || type === undefined)
          throw "dynamic callback argument invariant";
        const raw = scalarOf(type);
        const scalar = raw === "char" ? "i8" : raw;
        const offset =
          location.stackOffset >= 0
            ? sysVCallbackFrame.stack + location.stackOffset
            : location.gp >= 0
              ? sysVCallbackFrame.registers + location.gp * 8
              : sysVCallbackFrame.floats + location.fp * 8;
        const view = Cell.view(bytesAt(frame + offset, 8));
        args.push(
          wide(scalar)
            ? wordNumber(view.halves.low, view.halves.high, scalar)
            : cellValue(view, scalar),
        );
      }
      const value = callback(args);
      if (resultScalar === "void") return 1;
      const scalar = resultScalar === "char" ? "i8" : resultScalar;
      const float = scalar === "f32" || scalar === "f64";
      const offset = float
        ? sysVCallbackFrame.floats
        : sysVCallbackFrame.registers;
      const view = Cell.view(bytesAt(frame + offset, 8));
      if (scalar === "f32") {
        view.u64 = 0;
        view.f32 = value;
      } else if (scalar === "f64") view.f64 = value;
      else {
        if (scalar === "bool" && value !== 0 && value !== 1)
          throw new TypeError("callback result is not a C boolean");
        const checked = cellRange(value, scalar);
        if (checked < 0) view.i64 = checked;
        else view.u64 = checked;
      }
      return 1;
    } catch (error) {
      failure.failed = true;
      failure.error = error;
      return 0;
    }
  };
  fn.bytes[index] = noBytes;
  fn.assigned[index] = true;
}

export function invoke(fn: ForeignFunction): void {
  const frame = DynamicFrame.view(fn.frame);
  let patches = 0;
  function patch(target: number, base: number, addend: number): void {
    if (patches >= patchCapacity) throw new RangeError("too many patches");
    frame.patchTargets[patches] = target;
    frame.patchBases[patches] = base;
    frame.patchAddends[patches] = addend;
    patches++;
  }
  const operands: Uint8Array[] = [];
  const callees: ((frame: number) => number)[] = [];
  for (let slot = 0; slot < byteOperands; slot++) operands.push(noBytes);
  for (let index = 0; index < fn.assigned.length; index++) {
    if (fn.assigned[index] !== true)
      throw new TypeError("C argument " + index + " is not set");
    const location = argumentLocation(fn, index),
      slot = fn.slots[index] ?? -1,
      borrowed = fn.bytes[index] ?? noBytes;
    if (slot >= 0 && borrowed !== noBytes) {
      operands[slot] = borrowed;
      patch(wordOffset(location), slot + 1, 0);
    }
    const callback = fn.callbacks[index];
    if (callback !== undefined) {
      patch(wordOffset(location), 1 + byteOperands + callees.length, 0);
      callees.push(callback);
    }
  }
  const stack = frame.x[6],
    sret = frame.x[7];
  if (stack === undefined || sret === undefined)
    throw "SysV call frame invariant";
  stack.u = fn.layout.stackAlignment;
  sret.u = fn.resultCopy >= 0 ? fn.layout.result.alignment : 0;
  frame.x8.u = fn.layout.vectorRegisters;
  if (fn.resultCopy >= 0) patch(0, 0, frameScratch + fn.resultCopy);
  frame.patchCount = patches;
  frame.stackBytes = fn.layout.stackBytes;
  if (callees.length > 0 || fn.signature.callClass === "may-callback") {
    for (const borrowed of operands) {
      if (
        borrowed !== undefined &&
        borrowed !== noBytes &&
        !stableBytes(borrowed)
      )
        throw new TypeError(
          "calls with callbacks take external storage or foreign memory",
        );
    }
    const dispatcher = callbackDispatcher();
    const idle = (_frame: number): number => 0;
    const depth = callbackNesting.depth;
    if (callbackFrames.length <= depth)
      callbackFrames.push(allocate(DynamicFrame.size));
    const stable = callbackFrames[depth] ?? noBytes;
    settle(fn, false);
    stable.set(fn.frame);
    fn.failure.failed = false;
    fn.failure.error = undefined;
    callbackNesting.depth = depth + 1;
    try {
      callForeignCallbacks(
        callbackState(),
        dispatcher,
        fn.address,
        stable,
        operands[0] ?? noBytes,
        operands[1] ?? noBytes,
        operands[2] ?? noBytes,
        operands[3] ?? noBytes,
        operands[4] ?? noBytes,
        operands[5] ?? noBytes,
        operands[6] ?? noBytes,
        operands[7] ?? noBytes,
        callees[0] ?? idle,
        callees[1] ?? idle,
        callees[2] ?? idle,
        callees[3] ?? idle,
      );
    } finally {
      callbackNesting.depth = depth;
    }
    fn.frame.set(stable);
    settle(fn, true);
    rethrowCallbackFailure();
    if (fn.failure.failed) {
      const error = fn.failure.error;
      fn.failure.failed = false;
      fn.failure.error = undefined;
      throw error;
    }
    return;
  }
  settle(fn, false);
  callForeign(
    fn.address,
    fn.frame,
    operands[0] ?? noBytes,
    operands[1] ?? noBytes,
    operands[2] ?? noBytes,
    operands[3] ?? noBytes,
    operands[4] ?? noBytes,
    operands[5] ?? noBytes,
    operands[6] ?? noBytes,
    operands[7] ?? noBytes,
  );
  settle(fn, true);
}

export function resultRecord(fn: ForeignFunction, into: Uint8Array): void {
  const result = fn.layout.result;
  if (fn.signature.result.kind !== "record")
    throw new TypeError("not a C record result");
  if (into.length < result.size)
    throw new RangeError("a C record result needs " + result.size + " bytes");
  if (result.class === "indirect") {
    const sret = DynamicFrame.view(fn.frame).x[7];
    if (sret === undefined) throw "SysV call frame invariant";
    const from = sret.u;
    for (let at = 0; at < result.size; at++)
      into[at] = fn.frame[from + at] ?? 0;
  } else {
    const parts = result.parts;
    if (parts === undefined) throw "SysV record result invariant";
    for (const part of parts) {
      if (part === undefined) throw "SysV record part invariant";
      const from = (part.bank === "sse" ? frameFloats : 0) + part.register * 8;
      for (let at = 0; at < part.bytes; at++)
        into[part.offset + at] = resultByte(fn, from + at);
    }
  }
}
