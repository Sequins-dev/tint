/** Dynamic C calls (docs/native-ffi.md, "Dynamic calls"): libraries opened
 * at run time (dlopen/dlsym/dlclose/dlerror as leaf c-calls) and calls of
 * any C function address through one AOT-compiled universal trampoline,
 * driven by the same classifier the compiler uses (`classifyCCall`): no
 * libffi, no JIT.
 *
 * A `ForeignFunction` is a classified signature, a call frame and per-call
 * argument state. Callers set each argument in a typed form (numbers,
 * booleans, exact 64-bit words, borrowed byte arrays, record images), call
 * `invoke`, then read the result in a typed form. This is the interface a
 * `node:ffi` layer adapts (its BigInt and union conversions wait for the
 * typed/untyped convergence): it never needs to know registers or stack
 * slots.
 *
 * Borrowed byte arrays never have their (movable) addresses computed here:
 * the frame names them through patches, which the trampoline resolves
 * inside the leaf call, where no collection can run.
 *
 * KNOWN DEFECT (typed-pipeline gap, docs/native-ffi.md#known-defects):
 * dlfcn failures are TypeErrors with dlerror's text; Node throws Errors. */
import {
  classifyCCall,
  darwinArm64CTarget,
  linuxArm64CTarget,
  linuxX86_64CTarget,
  cPromoteVariadic,
  type CCallLayout,
  type CSignature,
  type CTarget,
  type CType,
  type CValueLocation,
} from "@tint/abi/c";
import {
  Cell,
  DynamicFrame,
  RTLD_LAZY,
  TARGET_AAPCS64,
  dlclose,
  dlerror,
  dlopen,
  dlopen$self,
  dlsym,
} from "tint:c/dl";
import type { View } from "tint:ffi";
import { callForeign, callForeignCallbacks } from "./primitives.ts";
import {
  allocate,
  callbackDispatcher,
  stableBytes,
  callbackState,
  rethrowCallbackFailure,
} from "./index.ts";
import { bytesAt } from "./unsafe.ts";
import { readCString } from "./c-string.ts";

/** A C prototype and C type as data (@tint/abi/c's model). */
export type ForeignSignature = CSignature;
export type ForeignType = CType;
/** Frame offsets (DynamicFrame's layout, dynamicCallFrame in the IR). */
const frameFloats = 64,
  frameIndirect = 128,
  frameStack = 640,
  frameScratch = 1152,
  scratchCapacity = 512,
  stackCapacity = 512,
  patchCapacity = 16,
  byteOperands = 8,
  callbackOperands = 4;
/** A universal callback thunk's frame (docs/native-ffi.md, "Dynamic
 * callbacks"): C's x0..x7 and d0..d7 as saved, its stack arguments after
 * the frame; the callback writes its result over the saved x0 and d0. */
const thunkRegisters = 64,
  thunkFloats = 128,
  thunkFrame = 192;
/** A dynamic callback: the C arguments as numbers (bools 0 or 1), its
 * result as a number (ignored for void). */
export type DynamicCallback = (args: number[]) => number;
/** A classified C function at an address, with its argument state. */
export interface ForeignFunction {
  readonly address: number;
  readonly signature: CSignature;
  readonly layout: CCallLayout;
  /** The trampoline frame (DynamicFrame.size bytes). */
  readonly frame: Uint8Array;
  /** One 8-byte conversion cell. */
  readonly cell: Uint8Array;
  /** The last call's result registers: the trampoline writes x0, x1 and
   * d0-d3 over the frame's argument words, which `settle` restores. */
  readonly results: Uint8Array;
  /** Per parameter: the borrowed array (pointer parameters set by bytes)
   * or the shared empty array. */
  readonly bytes: Uint8Array[];
  /** Per parameter: its byte operand (pointer parameters), else -1. */
  readonly slots: number[];
  /** Per parameter: the scratch offset of an indirect record copy, else -1. */
  readonly copies: number[];
  /** Per parameter: whether it has a value for the next call. */
  readonly assigned: boolean[];
  /** The scratch offset of an indirect record result, else -1. */
  readonly resultCopy: number;
  /** Per parameter: its callback adapter (a pointer set by setCallback). */
  readonly callbacks: (((frame: number) => number) | undefined)[];
  /** What a callback raised during the current call (rethrown after it). */
  failure: { failed: boolean; error: unknown };
}
const noBytes = new Uint8Array(0);
/** x0 and x1, then d0-d3: the result registers the trampoline stores. */
const resultBytes = 48;
/** Non-moving frames for calls with callbacks, one per nesting depth
 * (kept for reuse): a collection inside a callback may move a function's
 * own frame while C still holds addresses in its scratch area (x8's
 * indirect result, by-value record copies). */
const callbackFrames: Uint8Array[] = [];
const callbackNesting = { depth: 0 };

function cTarget(): CTarget {
  if (TARGET_AAPCS64 === 2) return linuxX86_64CTarget;
  return TARGET_AAPCS64 === 1 ? linuxArm64CTarget : darwinArm64CTarget;
}
function exactAddress(value: number, what: string): number {
  if (!Number.isInteger(value) || value < 0 || value >= 18446744073709551616)
    throw new TypeError("invalid " + what + " address");
  return value;
}
/** A C function at `address` with prototype `signature` (leaf calls only:
 * the function must not call back into Tint). */
export function foreignFunction(
  address: number,
  signature: CSignature,
): ForeignFunction {
  if (exactAddress(address, "function") === 0)
    throw new TypeError("null C function address");
  if (signature.callClass !== "leaf")
    throw new TypeError("dynamic calls are leaf calls");
  const classified = classifyCCall(signature, cTarget());
  if (!classified.ok) throw new TypeError(classified.error);
  const layout = classified.value;
  if (layout.stackBytes > stackCapacity)
    throw new RangeError("too many stack arguments for a dynamic call");
  const bytes: Uint8Array[] = [],
    slots: number[] = [],
    copies: number[] = [],
    assigned: boolean[] = [];
  let operand = 0,
    scratch = 0;
  for (let index = 0; index < signature.parameters.length; index++) {
    const type = signature.parameters[index],
      location = layout.arguments[index];
    if (type === undefined || location === undefined)
      throw "dynamic signature invariant";
    bytes.push(noBytes);
    assigned.push(false);
    if (type.kind === "pointer") {
      if (operand >= byteOperands)
        throw new RangeError("a dynamic call takes at most 8 pointers");
      slots.push(operand++);
    } else slots.push(-1);
    if (location.class === "indirect") {
      copies.push(scratch);
      scratch += Math.ceil(location.size / 16) * 16;
    } else copies.push(-1);
  }
  let resultCopy = -1;
  if (layout.result.class === "indirect") {
    resultCopy = scratch;
    scratch += Math.ceil(layout.result.size / 16) * 16;
    if (TARGET_AAPCS64 === 2) scratch += layout.result.alignment - 1;
  }
  if (scratch > scratchCapacity)
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
    copies,
    assigned,
    resultCopy,
    callbacks: assigned.map(() => undefined),
    failure: { failed: false, error: undefined },
  };
}
function parameter(fn: ForeignFunction, index: number): CType {
  const type = fn.signature.parameters[index];
  if (type === undefined) throw new RangeError("no C parameter " + index);
  return type;
}
function argumentLocation(fn: ForeignFunction, index: number): CValueLocation {
  const location = fn.layout.arguments[index];
  if (location === undefined) throw new RangeError("no C parameter " + index);
  return location;
}
/** The frame byte offset of a register or stack argument's first word. */
function wordOffset(location: CValueLocation): number {
  if (location.stackOffset >= 0) return frameStack + location.stackOffset;
  return location.gp >= 0 ? location.gp * 8 : frameFloats + location.fp * 8;
}
function copyCell(fn: ForeignFunction, offset: number, count: number): void {
  for (let index = 0; index < count; index++)
    fn.frame[offset + index] = fn.cell[index] ?? 0;
}
function clearWord(fn: ForeignFunction, offset: number): void {
  for (let index = 0; index < 8; index++) fn.frame[offset + index] = 0;
}
/** Store the scalar in `fn.cell` (already converted as `scalar`) at the
 * argument's place: registers take the full extended word, stack slots the
 * C size (a variadic slot its 8 bytes). */
function placeScalar(fn: ForeignFunction, index: number, scalar: string): void {
  const location = argumentLocation(fn, index),
    view = Cell.view(fn.cell);
  const float = scalar === "f32" || scalar === "f64";
  if (!float && !wide(scalar)) {
    // Extend narrow integers to the whole word (the caller's extension on
    // Apple targets, harmless elsewhere).
    const value = cellValue(view, scalar);
    if (isSigned(scalar)) view.i64 = value;
    else view.u64 = value;
  }
  const offset = wordOffset(location);
  if (location.stackOffset >= 0) {
    copyCell(fn, offset, location.variadic ? 8 : location.size);
    return;
  }
  clearWord(fn, offset);
  copyCell(fn, offset, scalar === "f32" ? 4 : 8);
}
/** 64-bit integers and addresses fill their word already. */
function wide(scalar: string): boolean {
  return (
    scalar === "i64" ||
    scalar === "u64" ||
    scalar === "isize" ||
    scalar === "usize" ||
    scalar === "address"
  );
}
function isSigned(scalar: string): boolean {
  return (
    scalar === "i8" ||
    scalar === "i16" ||
    scalar === "i32" ||
    scalar === "i64" ||
    scalar === "isize" ||
    (scalar === "char" && cTarget().charSigned)
  );
}
/** Write `value` into the cell as C scalar `scalar` (exact integers in
 * range, else TypeError; f32 rounds). */
function setCell(fn: ForeignFunction, scalar: string, value: number): void {
  const view = Cell.view(fn.cell);
  view.u64 = 0;
  if (scalar === "i8") view.i8 = value;
  else if (scalar === "u8" || scalar === "bool") view.u8 = value;
  else if (scalar === "char") {
    if (cTarget().charSigned) view.i8 = value;
    else view.u8 = value;
  } else if (scalar === "i16") view.i16 = value;
  else if (scalar === "u16") view.u16 = value;
  else if (scalar === "i32") view.i32 = value;
  else if (scalar === "u32") view.u32 = value;
  else if (scalar === "i64" || scalar === "isize") view.i64 = value;
  else if (scalar === "u64" || scalar === "usize") view.u64 = value;
  else if (scalar === "f32") view.f32 = value;
  else if (scalar === "f64") view.f64 = value;
  else if (scalar === "address") view.address = value;
  else throw "dynamic scalar invariant";
}
function cellValue(view: View<Cell>, scalar: string): number {
  if (scalar === "i8") return view.i8;
  if (scalar === "u8" || scalar === "bool") return view.u8;
  if (scalar === "char") return cTarget().charSigned ? view.i8 : view.u8;
  if (scalar === "i16") return view.i16;
  if (scalar === "u16") return view.u16;
  if (scalar === "i32") return view.i32;
  if (scalar === "u32") return view.u32;
  if (scalar === "f32") return view.f32;
  if (scalar === "f64") return view.f64;
  throw "dynamic scalar invariant";
}
/** The scalar name a C scalar or pointer type converts as. */
function scalarOf(type: CType): string {
  if (type.kind === "pointer") return "address";
  if (type.kind === "scalar") return type.scalar;
  throw new TypeError("not a C scalar or pointer parameter");
}
/** Set number argument `index`: an integer, float or pointer (an address)
 * parameter. Integers and addresses must be exact and in range (else
 * TypeError); f32 rounds. */
export function setNumber(
  fn: ForeignFunction,
  index: number,
  value: number,
): void {
  const type = parameter(fn, index),
    scalar = scalarOf(type);
  if (scalar === "bool") throw new TypeError("C bool takes a boolean");
  setCell(fn, scalar, value);
  if (TARGET_AAPCS64 === 2 && argumentLocation(fn, index).variadic) {
    const promoted = cPromoteVariadic(type);
    if (promoted.kind === "scalar" && promoted.scalar !== scalar) {
      const rounded = cellValue(Cell.view(fn.cell), scalar);
      setCell(fn, promoted.scalar, rounded);
      placeScalar(fn, index, promoted.scalar);
      fn.assigned[index] = true;
      return;
    }
  }
  if (scalar === "address") fn.bytes[index] = noBytes;
  placeScalar(fn, index, scalar);
  fn.assigned[index] = true;
}
/** Set C bool argument `index`. */
export function setBoolean(
  fn: ForeignFunction,
  index: number,
  value: boolean,
): void {
  if (scalarOf(parameter(fn, index)) !== "bool")
    throw new TypeError("not a C bool parameter");
  setCell(fn, "bool", value ? 1 : 0);
  placeScalar(fn, index, "bool");
  fn.assigned[index] = true;
}
/** Set a 64-bit integer or pointer argument from its exact two 32-bit
 * halves (two's complement for signed types): every 64-bit value,
 * including those a number cannot hold. */
export function setWords(
  fn: ForeignFunction,
  index: number,
  low: number,
  high: number,
): void {
  const scalar = scalarOf(parameter(fn, index));
  if (
    scalar !== "i64" &&
    scalar !== "u64" &&
    scalar !== "isize" &&
    scalar !== "usize" &&
    scalar !== "address"
  )
    throw new TypeError("not a 64-bit C parameter");
  const view = Cell.view(fn.cell);
  view.halves.low = low;
  view.halves.high = high;
  if (scalar === "address") fn.bytes[index] = noBytes;
  placeScalar(fn, index, "u64");
  fn.assigned[index] = true;
}
/** Pass `bytes`' data to pointer argument `index`, borrowed for the call
 * (C may read and write it until it returns, never after). */
export function setBytes(
  fn: ForeignFunction,
  index: number,
  bytes: Uint8Array,
): void {
  if (parameter(fn, index).kind !== "pointer")
    throw new TypeError("not a C pointer parameter");
  fn.bytes[index] = bytes;
  fn.assigned[index] = true;
}
/** Pass record argument `index` by value from its C image `image` (at
 * least the record's size). */
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
  const parts = location.parts;
  if (TARGET_AAPCS64 === 2 && parts !== undefined) {
    for (const part of parts) {
      if (part === undefined) throw "SysV argument part invariant";
      const offset =
        (part.bank === "integer" ? 0 : frameFloats) + part.register * 8;
      clearWord(fn, offset);
      for (let at = 0; at < part.bytes; at++)
        fn.frame[offset + at] = image[part.offset + at] ?? 0;
    }
  } else if (location.class === "indirect") {
    const copy = frameScratch + (fn.copies[index] ?? 0);
    for (let at = 0; at < location.size; at++)
      fn.frame[copy + at] = image[at] ?? 0;
  } else if (location.stackOffset >= 0) {
    const offset = frameStack + location.stackOffset;
    for (let at = 0; at < location.size; at++)
      fn.frame[offset + at] = image[at] ?? 0;
  } else if (location.class === "hfa") {
    // One member per V register, in its low bytes.
    for (let member = 0; member < location.registers; member++) {
      const offset = frameFloats + (location.fp + member) * 8;
      clearWord(fn, offset);
      for (let at = 0; at < location.memberBytes; at++)
        fn.frame[offset + at] = image[member * location.memberBytes + at] ?? 0;
    }
  } else {
    const offset = location.gp * 8;
    for (let word = 0; word < location.registers; word++)
      clearWord(fn, offset + word * 8);
    for (let at = 0; at < location.size; at++)
      fn.frame[offset + at] = image[at] ?? 0;
  }
  fn.assigned[index] = true;
}
/** Pass a TypeScript function as pointer argument `index`: C may call it
 * during this function's calls (made may-callback calls) with prototype
 * `signature` (scalar, bool and pointer parameters and result). What it
 * throws is rethrown after the call; C then gets 0 from it. */
export function setCallback(
  fn: ForeignFunction,
  index: number,
  signature: CSignature,
  callback: DynamicCallback,
): void {
  if (TARGET_AAPCS64 === 2)
    throw new TypeError("C callbacks are not supported on linux-x86_64");
  if (parameter(fn, index).kind !== "pointer")
    throw new TypeError("not a C pointer parameter");
  const classified = classifyCCall(signature, cTarget());
  if (!classified.ok) throw new TypeError(classified.error);
  const layout = classified.value;
  for (const location of layout.arguments) {
    if (location === undefined) throw "dynamic callback invariant";
    if (location.class !== "integer" && location.class !== "float")
      throw new TypeError("callback arguments are C scalars or pointers");
  }
  let used = 0;
  for (const other of fn.callbacks) if (other !== undefined) used++;
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
          throw "dynamic callback invariant";
        const word =
          location.stackOffset >= 0
            ? frame + thunkFrame + location.stackOffset
            : location.class === "float"
              ? frame + thunkFloats + location.fp * 8
              : frame + thunkRegisters + location.gp * 8;
        const view = Cell.view(bytesAt(word, 8)),
          scalar = scalarOf(type);
        args.push(
          wide(scalar)
            ? wordNumber(view.halves.low, view.halves.high, scalar)
            : cellValue(view, scalar),
        );
      }
      const value = callback(args);
      const result = signature.result;
      if (result.kind === "void") return 0;
      const scalar = scalarOf(result);
      if (scalar === "f32" || scalar === "f64") {
        const view = Cell.view(bytesAt(frame + thunkFloats, 8));
        view.u64 = 0;
        if (scalar === "f32") view.f32 = value;
        else view.f64 = value;
      } else {
        const view = Cell.view(bytesAt(frame + thunkRegisters, 8));
        view.u64 = 0;
        if (isSigned(scalar)) view.i64 = cellRange(value, scalar);
        else view.u64 = cellRange(value, scalar);
      }
      return 0;
    } catch (error) {
      failure.failed = true;
      failure.error = error;
      return 0;
    }
  };
  fn.bytes[index] = noBytes;
  fn.assigned[index] = true;
}
/** `value` checked against C integer `scalar`'s range (TypeError). */
function cellRange(value: number, scalar: string): number {
  const probe = new Uint8Array(8);
  const view = Cell.view(probe);
  if (scalar === "i8") view.i8 = value;
  else if (scalar === "u8" || scalar === "bool") view.u8 = value;
  else if (scalar === "i16") view.i16 = value;
  else if (scalar === "u16") view.u16 = value;
  else if (scalar === "i32") view.i32 = value;
  else if (scalar === "u32") view.u32 = value;
  else if (isSigned(scalar)) view.i64 = value;
  else view.u64 = value;
  return value;
}
/** A 64-bit word's number (exact, else RangeError). */
function wordNumber(low: number, high: number, scalar: string): number {
  const negative =
    high >= 2147483648 && (scalar === "i64" || scalar === "isize");
  let magnitudeLow = low,
    magnitudeHigh = high;
  if (negative) {
    magnitudeLow = (4294967296 - low) % 4294967296;
    magnitudeHigh = 4294967295 - high + (low === 0 ? 1 : 0);
  }
  if (!exactWords(magnitudeLow, magnitudeHigh))
    throw new RangeError("C value is not exactly representable");
  const magnitude = magnitudeHigh * 4294967296 + magnitudeLow;
  return negative ? -magnitude : magnitude;
}
/** Call the function with the arguments set since its creation (each
 * keeps its value until set again). */
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
  for (let slot = 0; slot < byteOperands; slot++) operands.push(noBytes);
  for (let index = 0; index < fn.assigned.length; index++) {
    if (fn.assigned[index] !== true)
      throw new TypeError("C argument " + index + " is not set");
    const location = argumentLocation(fn, index),
      slot = fn.slots[index] ?? -1,
      borrowed = fn.bytes[index] ?? noBytes,
      copy = fn.copies[index] ?? -1;
    if (slot >= 0 && borrowed !== noBytes) {
      operands[slot] = borrowed;
      patch(wordOffset(location), slot + 1, 0);
    } else if (copy >= 0) patch(wordOffset(location), 0, frameScratch + copy);
  }
  if (TARGET_AAPCS64 === 2) {
    const stackAlignment = frame.x[6], resultAlignment = frame.x[7];
    if (stackAlignment === undefined || resultAlignment === undefined)
      throw "SysV frame metadata invariant";
    stackAlignment.u = fn.layout.stackAlignment ?? 16;
    resultAlignment.u = fn.resultCopy < 0 ? 0 : fn.layout.result.alignment;
    frame.x8.u = fn.layout.vectorRegisters ?? 0;
    if (fn.resultCopy >= 0) patch(0, 0, frameScratch + fn.resultCopy);
  } else if (fn.resultCopy >= 0)
    patch(frameIndirect, 0, frameScratch + fn.resultCopy);
  // Callbacks: a may-callback trampoline, each callback's argument word
  // patched with its universal thunk's entry (bases after the bytes).
  const callees: ((frame: number) => number)[] = [];
  for (let index = 0; index < fn.callbacks.length; index++) {
    const callee = fn.callbacks[index];
    if (callee === undefined) continue;
    patch(
      wordOffset(argumentLocation(fn, index)),
      1 + byteOperands + callees.length,
      0,
    );
    callees.push(callee);
  }
  frame.patchCount = patches;
  frame.stackBytes = fn.layout.stackBytes;
  if (callees.length > 0) {
    // Collections run inside callbacks: C may hold only non-moving data.
    for (let slot = 0; slot < byteOperands; slot++) {
      const borrowed = operands[slot] ?? noBytes;
      if (borrowed !== noBytes && !stableBytes(borrowed))
        throw new TypeError(
          "calls with callbacks take external storage or foreign memory",
        );
    }
    const dispatcher = callbackDispatcher();
    const idle = (frame: number): number => 0;
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
/** The trampoline writes the result registers (x0, x1, d0-d3) over the
 * frame's argument words. Before a call (`returned` false) `fn.results`
 * keeps those argument words; after it, they are exchanged with the
 * results, so arguments stay set for the next call. */
function settle(fn: ForeignFunction, returned: boolean): void {
  for (let at = 0; at < resultBytes; at++) {
    const offset = at < 16 ? at : frameFloats + at - 16,
      word = fn.frame[offset] ?? 0;
    if (returned) fn.frame[offset] = fn.results[at] ?? 0;
    fn.results[at] = word;
  }
}
/** Result register word `offset` (frame layout) of the last call. */
function resultByte(fn: ForeignFunction, offset: number): number {
  return (
    fn.results[offset < frameFloats ? offset : offset - frameFloats + 16] ?? 0
  );
}
/** Load result register word `offset` into the cell. */
function resultCell(fn: ForeignFunction, offset: number): void {
  for (let index = 0; index < 8; index++)
    fn.cell[index] = resultByte(fn, offset + index);
}
/** The last call's number result: an integer, float or pointer. A 64-bit
 * value a number cannot hold exactly throws RangeError (read it with
 * `resultLow`/`resultHigh`). */
export function resultNumber(fn: ForeignFunction): number {
  const type = fn.signature.result,
    scalar = scalarOf(type);
  if (scalar === "bool") throw new TypeError("a C bool result is a boolean");
  const view = Cell.view(fn.cell);
  if (scalar === "f32" || scalar === "f64") {
    resultCell(fn, frameFloats);
    return cellValue(view, scalar);
  }
  resultCell(fn, 0);
  if (wide(scalar)) {
    const low = view.halves.low,
      high = view.halves.high;
    const negative =
      high >= 2147483648 && (scalar === "i64" || scalar === "isize");
    // Magnitude halves (two's complement negation for negative values).
    let magnitudeLow = low,
      magnitudeHigh = high;
    if (negative) {
      magnitudeLow = (4294967296 - low) % 4294967296;
      magnitudeHigh = 4294967295 - high + (low === 0 ? 1 : 0);
    }
    if (!exactWords(magnitudeLow, magnitudeHigh))
      throw new RangeError("C result is not exactly representable");
    const magnitude = magnitudeHigh * 4294967296 + magnitudeLow;
    return negative ? -magnitude : magnitude;
  }
  return cellValue(view, scalar);
}
/** Whether high * 2^32 + low is exactly a binary64 value. */
function exactWords(low: number, high: number): boolean {
  if (high < 2097152) return true;
  // Low bits below the 53 significant ones must be zero.
  let dropped = 1;
  for (let rest = high; rest >= 2097152; rest = Math.floor(rest / 2))
    dropped *= 2;
  return low % dropped === 0;
}
/** The last call's result register x0 as two 32-bit halves (every 64-bit
 * integer or pointer result exactly). */
export function resultLow(fn: ForeignFunction): number {
  resultCell(fn, 0);
  return Cell.view(fn.cell).halves.low;
}
export function resultHigh(fn: ForeignFunction): number {
  resultCell(fn, 0);
  return Cell.view(fn.cell).halves.high;
}
/** The last call's C bool result. */
export function resultBoolean(fn: ForeignFunction): boolean {
  if (scalarOf(fn.signature.result) !== "bool")
    throw new TypeError("not a C bool result");
  return resultByte(fn, 0) !== 0;
}
/** Copy the last call's record result into `into` (at least its size). */
export function resultRecord(fn: ForeignFunction, into: Uint8Array): void {
  const result = fn.layout.result;
  if (fn.signature.result.kind !== "record")
    throw new TypeError("not a C record result");
  if (into.length < result.size)
    throw new RangeError("a C record result needs " + result.size + " bytes");
  const parts = result.parts;
  if (TARGET_AAPCS64 === 2 && parts !== undefined) {
    // NO_CLASS bytes are padding rather than a returned register.
    for (let at = 0; at < result.size; at++) into[at] = 0;
    for (const part of parts) {
      if (part === undefined) throw "SysV result part invariant";
      const offset =
        (part.bank === "integer" ? 0 : frameFloats) + part.register * 8;
      for (let at = 0; at < part.bytes; at++)
        into[part.offset + at] = resultByte(fn, offset + at);
    }
  } else if (result.class === "indirect") {
    let from = frameScratch + fn.resultCopy;
    if (TARGET_AAPCS64 === 2) {
      const aligned = DynamicFrame.view(fn.frame).x[7];
      if (aligned === undefined) throw "SysV result metadata invariant";
      from = aligned.u;
    }
    for (let at = 0; at < result.size; at++)
      into[at] = fn.frame[from + at] ?? 0;
  } else if (result.class === "hfa") {
    for (let member = 0; member < result.registers; member++)
      for (let at = 0; at < result.memberBytes; at++)
        into[member * result.memberBytes + at] = resultByte(
          fn,
          frameFloats + member * 8 + at,
        );
  } else for (let at = 0; at < result.size; at++) into[at] = resultByte(fn, at);
}
/** dlerror's text, or `fallback` when it reports none. */
function loaderError(fallback: string): TypeError {
  const message = dlerror();
  return new TypeError(message === 0 ? fallback : readCString(message));
}
/** An open library: its handle's exact 64-bit word. */
export interface LibraryHandle {
  readonly low: number;
  readonly high: number;
}
function isNull(handle: LibraryHandle): boolean {
  return handle.low === 0 && handle.high === 0;
}
/** dlopen(path, RTLD_LAZY) (as libuv's uv_dlopen). */
export function openLibrary(path: string): LibraryHandle {
  const handle = dlopen(path, RTLD_LAZY);
  if (isNull(handle)) throw loaderError("dlopen failed: " + path);
  return handle;
}
/** dlopen(NULL): the program itself and every library it loaded. */
export function openProgram(): LibraryHandle {
  const handle = dlopen$self(0, RTLD_LAZY);
  if (isNull(handle)) throw loaderError("dlopen failed");
  return handle;
}
/** The address of symbol `name` in library `handle` (dlsym; an error
 * throws, a symbol whose value is NULL is 0). */
export function findSymbol(handle: LibraryHandle, name: string): number {
  if (isNull(handle)) throw new TypeError("null library handle");
  dlerror();
  const symbol = dlsym({ low: handle.low, high: handle.high }, name);
  if (isNull(symbol)) {
    const message = dlerror();
    if (message !== 0) throw new TypeError(readCString(message));
    return 0;
  }
  // User-space code addresses are below 2^53 on arm64 (48-bit VAs).
  if (symbol.high >= 2097152)
    throw new RangeError("symbol address out of range");
  return symbol.high * 4294967296 + symbol.low;
}
/** Close library `handle` (dlclose). Its function addresses become
 * invalid; calling one afterwards is undefined behaviour, as in C. */
export function closeLibrary(handle: LibraryHandle): void {
  if (isNull(handle)) throw new TypeError("null library handle");
  if (dlclose({ low: handle.low, high: handle.high }) !== 0)
    throw loaderError("dlclose failed");
}
/** Opened optional libraries by image name, and those that failed. */
const optionalLibraries = new Map<string, LibraryHandle>(),
  absentLibraries = new Set<string>();
/** The address of `name` in optional library `image`, opened (once) with
 * dlopen at first use, or -1 when the library or the symbol is absent
 * (docs/native-ffi.md, "Optional libraries"): what ELF images use where
 * Mach-O has weak imports. */
export function optionalSymbol(image: string, name: string): number {
  if (absentLibraries.has(image)) return -1;
  const handle = optionalLibraries.get(image) ?? openOptional(image);
  if (handle === undefined) return -1;
  try {
    const address = findSymbol(handle, name);
    return address === 0 ? -1 : address;
  } catch (error) {
    return -1;
  }
}
/** dlopen optional library `image` once: its handle, or undefined (and
 * remembered as absent) when it cannot be loaded. */
function openOptional(image: string): LibraryHandle | undefined {
  try {
    const handle = openLibrary(image);
    optionalLibraries.set(image, handle);
    return handle;
  } catch (error) {
    absentLibraries.add(image);
    return undefined;
  }
}
