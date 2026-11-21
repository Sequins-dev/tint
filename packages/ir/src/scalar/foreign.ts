import { cScalarBytes, type CSignature, type CType } from "@tint/abi/c";
import type {
  FunctionIR,
  Instruction,
  ModuleIR,
  ReturnType,
  ScalarType,
} from "./model.ts";
/** How one c-call operand reaches C (docs/native-ffi.md):
 * - `number`: a C integer or float scalar, converted with an exactness
 *   check (integers) or rounding (f32), or a raw address (`Address<T>`, a
 *   C pointer converted exactly as a 64-bit unsigned integer);
 * - `boolean`: C bool (0 or 1);
 * - `bytes`: a Uint8Array's data pointer, borrowed for the leaf call; a
 *   record pointee requires at least the record's size;
 * - `terminated-bytes`: as `bytes`, and the array must end in NUL;
 * - `record`: a struct by value, read from a Uint8Array holding at least
 *   its C image;
 * - `callback`: a function value C may call during a may-callback call
 *   (the call stores it in its transition record and passes C a thunk). */
export type ForeignOperand =
  "number" | "boolean" | "bytes" | "terminated-bytes" | "record" | "callback";
/** A `record` result is written into a trailing Uint8Array operand (at
 * least the record's size) and the instruction has no SSA result. */
export type ForeignResult = "void" | "number" | "boolean" | "record";
/** A call of the imported C `symbol` (unprefixed; the target adds its
 * symbol prefix) with one concrete prototype. Only leaf calls exist in IR:
 * they never re-enter managed code, so they are not safepoints and cannot
 * throw or allocate. */
export interface ForeignCall {
  readonly symbol: string;
  readonly signature: CSignature;
  readonly operands: readonly ForeignOperand[];
  readonly result: ForeignResult;
  /** The universal trampoline (`dynamicForeignCall`): the callee is the
   * first operand's address and every argument comes from a call frame
   * (docs/native-ffi.md, "Dynamic calls"); `symbol` is empty. */
  readonly dynamic?: true | undefined;
  /** The growable scalar frame has an exact target and no borrowed operands.
   * Its boolean result reports whether the outgoing stack window fit. */
  readonly dynamicScalar?: true | undefined;
  /** A runtime-selected, compile-time classified scalar trampoline. The
   * same validated exact-word frame reaches it, without frame dispatch. */
  readonly staticScalar?: CSignature | undefined;
  /** The callee is an address, not an import: the first operand is that
   * address (a nonzero number, else trap) and the remaining operands are
   * the prototype's (docs/native-ffi.md, "Optional libraries"). `symbol`
   * names the C function for diagnostics. */
  readonly indirect?: true | undefined;
  /** A may-callback call (docs/native-ffi.md, "Callbacks"): the signature's
   * call class is `may-callback`, the first operand is the calling
   * thread's callback state block (external storage of at least
   * `callbackState.size` bytes), the second the registered-callback
   * dispatcher (a function value registered thunks call with their id)
   * and the remaining operands are the prototype's. The call pushes a transition record onto the state block
   * for the call's duration, so C may enter Tint through callback thunks;
   * it is a safepoint, and its caller keeps no reference in a register
   * across it. */
  readonly mayCallback?: true | undefined;
  /** Per prototype operand: the C prototype of a `callback` operand (its
   * thunk's ABI), else undefined. */
  readonly callbacks?: readonly (CSignature | undefined)[] | undefined;
  /** Per prototype operand: for a `callback` operand whose thunk calls the
   * TypeScript function itself (no adapter), the indices of its parameters
   * delivered as record views (possibly none); else undefined. Such calls
   * end with the failure notes, `(error: unknown) => void` for exceptions
   * and `(code: number) => void` for invalid values (0: a null record
   * pointer, 1: a result outside its C type), then each direct callback's
   * views (one Uint8Array per listed parameter, in order). */
  readonly directCallbacks?:
    readonly (readonly number[] | undefined)[] | undefined;
}
/** The operands after a may-callback call's prototype operands: the two
 * failure notes and the direct callbacks' views (none without direct
 * callbacks). */
export function directCallbackExtras(call: ForeignCall): number {
  const direct = call.directCallbacks;
  if (direct === undefined) return 0;
  let extras = 2;
  for (let index = 0; index < direct.length; index++)
    extras += direct[index]?.length ?? 0;
  return extras;
}
/** A may-callback call's transition record, in its caller's outgoing frame
 * area (16-aligned): the caller's frame pointer and the call's return
 * address (its safepoint), laid out as a frame record so the stack walk
 * can resume there, then the previous record, whether a callback is
 * running under it, the calling thread's identity (its thread pointer
 * register), the caller's context, the registered-callback dispatcher,
 * then the call's callback function values (`callbacks`, one word each).
 * The call's stack map lists the dispatcher and callback words, so
 * collections update them. The callback state block's first word is the
 * innermost record (0: none). Byte offsets; the size is
 * `transitionBytes(callback count)`. */
export const callbackTransition = {
  frame: 0,
  returnAddress: 8,
  previous: 16,
  entered: 24,
  thread: 32,
  context: 40,
  registered: 48,
  onThrow: 56,
  onInvalid: 64,
  callbacks: 72,
};
/** `entered` values: no callback running, one running, or a direct
 * callback of this call failed (later invocations return 0 at once). */
export const callbackEntered = { idle: 0, running: 1, failed: 2 };
/** A transition record's bytes for `count` callbacks and `views` direct
 * callback views after them (16-aligned). */
export function transitionBytes(count: number, views: number = 0): number {
  return (
    Math.ceil((callbackTransition.callbacks + (count + views) * 8) / 16) * 16
  );
}
export const callbackState = { current: 0, size: 8 };
/** The universal trampoline's call frame, a Uint8Array the runtime fills
 * from `classifyCCall` (docs/native-ffi.md, "Dynamic calls"). Byte offsets:
 * - `registers`: x0..x7, then `floats`: d0..d7 (a float's low 32 bits),
 *   then `indirect`: x8; after the call x0, x1 and d0..d3 are stored back
 *   at the same offsets;
 * - `stackBytes`: how many bytes of `stack` (a multiple of 8, at most
 *   `stackCapacity`) are copied to the outgoing argument area;
 * - `patchCount` patches (at most `patchCapacity`) each store
 *   `bases[base] + addend` at frame byte `target` (8-aligned, below
 *   `scratch`): patch k's target, base index and addend are words k of
 *   the arrays at `patches`, `patches + patchArray` and `patches + 2 *
 *   patchArray`; the trampoline writes `bases` itself: the frame's data
 *   address, then the data address of each of its `byteOperands` borrowed
 *   arrays. Patches are how borrowed (movable) data and the frame's own
 *   `scratch` (indirect record copies, record results) reach C: addresses
 *   are formed inside the leaf call, where nothing moves. */
export const dynamicCallFrame = {
  registers: 0,
  floats: 64,
  indirect: 128,
  stackBytes: 136,
  patchCount: 144,
  bases: 152,
  patches: 256,
  patchArray: 128,
  patchCapacity: 16,
  stack: 640,
  stackCapacity: 512,
  scratch: 1152,
  scratchCapacity: 512,
  size: 1664,
  byteOperands: 8,
  /** Callback function values a may-callback dynamic call takes; their
   * universal thunks' entries are bases 1 + byteOperands onward. */
  callbackOperands: 4,
};
/** Header of a growable scalar call. Stack words follow the header. The
 * frame contains no managed pointers, and may live in stable storage. */
export const dynamicScalarFrame = {
  registers: 0,
  floats: 64,
  stackBytes: 128,
  target: 136,
  size: 144,
};

/** Use the shared callback transition without scoped callback operands. */
export function dynamicScalarCall(
  callbacks: boolean,
  staticScalar?: CSignature,
): ForeignCall {
  const pointer: CType = { kind: "pointer", pointee: { kind: "void" } };
  const parameters: CType[] = callbacks
    ? [pointer, pointer, pointer]
    : [pointer];
  const operands: ForeignOperand[] = callbacks
    ? ["bytes", "callback", "bytes"]
    : ["bytes"];
  const call: ForeignCall = {
    symbol: "",
    signature: {
      parameters,
      result: { kind: "scalar", scalar: "bool" },
      fixedParameters: parameters.length,
      callClass: callbacks ? "may-callback" : "leaf",
      errno: "none",
    },
    operands,
    result: "boolean",
    dynamic: true,
    dynamicScalar: true,
    ...(staticScalar === undefined ? {} : { staticScalar }),
  };
  return callbacks ? { ...call, mayCallback: true } : call;
}

/** The universal trampoline call: operands are the callee address, the
 * frame and `dynamicCallFrame.byteOperands` borrowed byte arrays. With
 * `callbacks` it is a may-callback call: the callback state and
 * dispatcher come first and `dynamicCallFrame.callbackOperands` callback
 * function values last (each reached through a universal callback thunk,
 * docs/native-ffi.md, "Dynamic callbacks"). */
export function dynamicForeignCall(callbacks: boolean = false): ForeignCall {
  const pointer: CType = { kind: "pointer", pointee: { kind: "void" } };
  const parameters: CType[] = [],
    operands: ForeignOperand[] = [];
  if (callbacks) {
    parameters.push(pointer, pointer);
    operands.push("bytes", "callback");
  }
  parameters.push(pointer, pointer);
  operands.push("number", "bytes");
  for (let index = 0; index < dynamicCallFrame.byteOperands; index++) {
    parameters.push(pointer);
    operands.push("bytes");
  }
  if (callbacks)
    for (let index = 0; index < dynamicCallFrame.callbackOperands; index++) {
      parameters.push(pointer);
      operands.push("callback");
    }
  const call: ForeignCall = {
    symbol: "",
    signature: {
      parameters,
      result: { kind: "void" },
      fixedParameters: parameters.length,
      callClass: callbacks ? "may-callback" : "leaf",
      errno: "none",
    },
    operands,
    result: "void",
    dynamic: true,
  };
  return callbacks ? { ...call, mayCallback: true } : call;
}
/** Whether `call` is exactly the universal trampoline's shape. */
function dynamicShape(call: ForeignCall): boolean {
  const specialized = call.staticScalar;
  if (
    specialized !== undefined &&
    (call.dynamicScalar !== true ||
      call.mayCallback === true ||
      specialized.callClass !== "leaf" ||
      specialized.errno !== "none" ||
      specialized.fixedParameters !== specialized.parameters.length ||
      specialized.parameters.some(
        (type) => type?.kind !== "scalar" && type?.kind !== "pointer",
      ) ||
      (specialized.result.kind !== "scalar" &&
        specialized.result.kind !== "pointer" &&
        specialized.result.kind !== "void"))
  )
    return false;
  const expected =
    call.dynamicScalar === true
      ? dynamicScalarCall(call.mayCallback === true)
      : dynamicForeignCall(call.mayCallback === true);
  const result = call.signature.result;
  if (
    call.symbol !== "" ||
    call.result !== expected.result ||
    call.callbacks !== undefined ||
    (call.dynamicScalar === true
      ? result.kind !== "scalar" || result.scalar !== "bool"
      : result.kind !== "void") ||
    call.signature.fixedParameters !== expected.signature.fixedParameters ||
    call.signature.callClass !== expected.signature.callClass ||
    call.signature.errno !== "none" ||
    call.signature.parameters.length !== expected.signature.parameters.length ||
    call.operands.length !== expected.operands.length
  )
    return false;
  for (let index = 0; index < expected.operands.length; index++) {
    const type = call.signature.parameters[index];
    if (call.operands[index] !== expected.operands[index]) return false;
    if (type === undefined || type.kind !== "pointer") return false;
  }
  return true;
}
export interface ForeignCallTypes {
  readonly parameters: readonly ScalarType[];
  readonly result: ReturnType;
}
export type ForeignCallTypesResult =
  | { readonly ok: true; readonly value: ForeignCallTypes }
  | { readonly ok: false; readonly error: string };
function validSymbol(symbol: string): boolean {
  if (symbol.length === 0) return false;
  for (let index = 0; index < symbol.length; index++) {
    const code = symbol.charCodeAt(index);
    if (!(
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      code === 95 ||
      (index > 0 && code >= 48 && code <= 57)
    ))
      return false;
  }
  return true;
}
/** The IR operand and result types of a verified foreign call, or why the
 * call is malformed. Operand forms must agree with the C types. */
export function foreignCallTypes(call: ForeignCall): ForeignCallTypesResult {
  const signature = call.signature;
  if (call.dynamic === true) {
    if (!dynamicShape(call))
      return { ok: false, error: "malformed dynamic foreign call" };
    const parameters: ScalarType[] = [];
    for (let index = 0; index < call.operands.length; index++) {
      const operand = call.operands[index];
      parameters.push(
        operand === "number"
          ? "number"
          : operand === "callback"
            ? "reference"
            : "Uint8Array",
      );
    }
    return {
      ok: true,
      value: {
        parameters,
        result: call.dynamicScalar === true ? "boolean" : "void",
      },
    };
  }
  if (call.dynamicScalar === true || call.staticScalar !== undefined)
    return { ok: false, error: "scalar call requires a trampoline" };
  if (!validSymbol(call.symbol))
    return { ok: false, error: "invalid foreign symbol" };
  if (call.mayCallback === true) {
    if (call.indirect === true || signature.callClass !== "may-callback")
      return { ok: false, error: "malformed may-callback call" };
    if (call.operands[0] !== "bytes" || call.operands[1] !== "callback")
      return {
        ok: false,
        error: "a may-callback call takes its state and dispatcher first",
      };
    // Each callback operand names its C prototype, and only those do; a
    // direct callback is a callback.
    const callbacks = call.callbacks ?? [],
      directs = call.directCallbacks ?? [],
      extras = directCallbackExtras(call),
      prototypeEnd = call.operands.length - extras;
    if (prototypeEnd < 2)
      return { ok: false, error: "direct callbacks need their operands" };
    for (let index = 2; index < prototypeEnd; index++) {
      if (
        (call.operands[index] === "callback") !==
        (callbacks[index - 2] !== undefined)
      )
        return { ok: false, error: "callback operands need their prototypes" };
      if (
        directs[index - 2] !== undefined &&
        callbacks[index - 2] === undefined
      )
        return { ok: false, error: "direct callbacks are callbacks" };
    }
    for (let index = prototypeEnd; index < call.operands.length; index++)
      if (call.operands[index] !== "callback")
        return {
          ok: false,
          error: "direct callback notes and views are function values",
        };
    // The prototype checks as a leaf call with each callback as an address;
    // a callback operand is a function value.
    const operands: ForeignOperand[] = [];
    for (let index = 2; index < prototypeEnd; index++) {
      const operand = call.operands[index];
      if (operand === undefined) throw "foreign operand invariant";
      operands.push(operand === "callback" ? "number" : operand);
    }
    const direct = foreignCallTypes({
      symbol: call.symbol,
      signature: { ...signature, callClass: "leaf" },
      operands,
      result: call.result,
    });
    if (!direct.ok) return direct;
    const parameters: ScalarType[] = ["Uint8Array", "reference"];
    for (let index = 0; index < direct.value.parameters.length; index++) {
      const parameter = direct.value.parameters[index];
      if (parameter === undefined) throw "foreign parameter invariant";
      parameters.push(
        call.operands[index + 2] === "callback" ? "reference" : parameter,
      );
    }
    // The failure notes are function values, the views Uint8Arrays.
    for (let index = 0; index < extras; index++)
      parameters.push(index < 2 ? "reference" : "Uint8Array");
    return { ok: true, value: { parameters, result: direct.value.result } };
  }
  if (call.callbacks !== undefined)
    return { ok: false, error: "callbacks need a may-callback call" };
  if (call.indirect === true) {
    const direct = foreignCallTypes({
      symbol: call.symbol,
      signature,
      operands: call.operands,
      result: call.result,
    });
    if (!direct.ok) return direct;
    const parameters: ScalarType[] = ["number"];
    for (let index = 0; index < direct.value.parameters.length; index++) {
      const parameter = direct.value.parameters[index];
      if (parameter === undefined) throw "foreign parameter invariant";
      parameters.push(parameter);
    }
    return { ok: true, value: { parameters, result: direct.value.result } };
  }
  if (signature.callClass !== "leaf")
    return {
      ok: false,
      error:
        "only leaf foreign calls are supported (call class " +
        signature.callClass +
        ")",
    };
  if (call.operands.length !== signature.parameters.length)
    return { ok: false, error: "foreign operand count mismatch" };
  const parameters: ScalarType[] = [];
  for (let index = 0; index < signature.parameters.length; index++) {
    const type = signature.parameters[index],
      operand = call.operands[index];
    if (type === undefined || operand === undefined)
      throw "foreign operand invariant";
    switch (operand) {
      case "number":
        if (
          type.kind !== "pointer" &&
          (type.kind !== "scalar" || type.scalar === "bool")
        )
          return {
            ok: false,
            error: "number operand needs a C number or pointer type",
          };
        parameters.push("number");
        break;
      case "boolean":
        if (type.kind !== "scalar" || type.scalar !== "bool")
          return { ok: false, error: "boolean operand needs C bool" };
        parameters.push("boolean");
        break;
      case "bytes":
      case "terminated-bytes":
        if (type.kind !== "pointer")
          return { ok: false, error: "byte operand needs a C pointer" };
        parameters.push("Uint8Array");
        break;
      case "record":
        if (type.kind !== "record")
          return { ok: false, error: "record operand needs a C record" };
        parameters.push("Uint8Array");
        break;
      case "callback":
        return { ok: false, error: "callbacks need a may-callback call" };
    }
  }
  const result = signature.result;
  switch (call.result) {
    case "void":
      if (result.kind !== "void")
        return { ok: false, error: "void result needs C void" };
      if (signature.errno !== "none")
        return { ok: false, error: "errno capture needs an integer result" };
      return { ok: true, value: { parameters, result: "void" } };
    case "number":
      if (result.kind === "pointer") {
        if (signature.errno !== "none")
          return { ok: false, error: "errno capture needs an integer result" };
        return { ok: true, value: { parameters, result: "number" } };
      }
      if (result.kind !== "scalar" || result.scalar === "bool")
        return {
          ok: false,
          error: "number result needs a C number or pointer type",
        };
      if (
        signature.errno === "negated-result" &&
        result.scalar !== "i32" &&
        result.scalar !== "i64" &&
        result.scalar !== "isize"
      )
        return {
          ok: false,
          error: "negated errno needs an i32, i64 or isize result",
        };
      return { ok: true, value: { parameters, result: "number" } };
    case "boolean":
      if (result.kind !== "scalar" || result.scalar !== "bool")
        return { ok: false, error: "boolean result needs C bool" };
      if (signature.errno !== "none")
        return { ok: false, error: "errno capture needs an integer result" };
      return { ok: true, value: { parameters, result: "boolean" } };
    case "record":
      if (result.kind !== "record")
        return { ok: false, error: "record result needs a C record" };
      if (signature.errno !== "none")
        return { ok: false, error: "errno capture needs an integer result" };
      parameters.push("Uint8Array");
      return { ok: true, value: { parameters, result: "void" } };
  }
}
/** A C memory access through a Uint8Array's data pointer
 * (docs/native-ffi.md, "C views" and "External storage"):
 * - `load`/`store`: a C view member (only the view lowering emits them): the
 *   C scalar or pointer `type` at byte `offset` of an array whose view
 *   creation proved it holds `minimum` bytes (typed-array lengths never
 *   change), so there is no length check; a stored value already passed the
 *   member's contract check (exact integers in range), so its conversion
 *   cannot fail (f32 rounds). With `stride`, the operand after the array is
 *   an element index already proven an integer in [0, `length`), and the
 *   access is at `offset + index * stride`;
 * - `address`: the data address of an external (borrowed, non-moving)
 *   array, or -1 for any other array (owned storage moves);
 * - `adopt`: turn an owned empty array into an external view of `length`
 *   bytes at `address` (trusted: the caller owns the memory and keeps it
 *   alive while the view is reachable); returns the same array;
 * - `retarget`: point an external view's data at `address` (trusted: a
 *   released view moves to an inaccessible guard of at least its length,
 *   so later accesses fault; typed-array lengths never change);
 * - `fits`: whether a number converts exactly to integer or pointer `type`
 *   (an integer in its range; a view store's contract check, offset and
 *   minimum 0);
 * - `available`: whether imported C `symbol` is bound (no operands): a
 *   weak import of an absent optional library reads as zero, so this is a
 *   load of the import slot and a comparison with zero. */
export interface ForeignMemoryAccess {
  readonly operation:
    | "load"
    | "store"
    | "fits"
    | "address"
    | "address-into"
    | "adopt"
    | "adopt-words"
    | "retarget"
    | "available"
    | "callback-key"
    | "callback-address"
    | "runtime-callback-address"
    | "stable";
  /** Loads and stores: the field's C scalar or pointer type (else void,
   * with offset and minimum 0). */
  readonly type: CType;
  readonly offset: number;
  readonly minimum: number;
  /** `available` only: the unprefixed C symbol. */
  readonly symbol?: string | undefined;
  /** Element loads and stores: bytes between elements and their count. */
  readonly stride?: number | undefined;
  readonly length?: number | undefined;
  /** Callback entry prototype. `callback-address` also takes a static slot.
   * `runtime-callback-address` instead reads the id supplied by its stub. */
  readonly callback?: CSignature | undefined;
  readonly slot?: number | undefined;
}
export type ForeignMemoryTypesResult =
  | { readonly ok: true; readonly value: ForeignCallTypes }
  | { readonly ok: false; readonly error: string };
/** The IR operand and result types of a verified C memory access. */
export function foreignMemoryTypes(
  access: ForeignMemoryAccess,
): ForeignMemoryTypesResult {
  // `callback-key` (docs/native-ffi.md, "Callbacks"): the address of the
  // image's callback key word, the pthread key under which each thread's
  // callback state block is found by thunks. `stable`: whether an array's
  // data never moves (external storage, or a view of it such as foreign
  // memory): what C may hold across callbacks.
  if (access.operation === "runtime-callback-address") {
    const prototype = access.callback;
    if (prototype !== undefined) {
      const parameter = prototype.parameters[0];
      if (
        prototype.parameters.length !== 1 ||
        prototype.fixedParameters !== 1 ||
        prototype.callClass !== "leaf" ||
        prototype.errno !== "none" ||
        parameter?.kind !== "scalar" ||
        parameter.scalar !== "i32" ||
        prototype.result.kind !== "scalar" ||
        prototype.result.scalar !== "i32"
      )
        return { ok: false, error: "malformed runtime callback prototype" };
    }
    return { ok: true, value: { parameters: [], result: "number" } };
  }
  if (access.operation === "callback-address") {
    const slot = access.slot;
    return access.callback !== undefined &&
      slot !== undefined &&
      Number.isSafeInteger(slot) &&
      slot >= 0 &&
      access.type.kind === "void" &&
      access.offset === 0 &&
      access.minimum === 0
      ? { ok: true, value: { parameters: [], result: "number" } }
      : { ok: false, error: "malformed callback address" };
  }
  if (access.callback !== undefined || access.slot !== undefined)
    return { ok: false, error: "only callback addresses name a thunk" };
  if (access.operation === "callback-key" || access.operation === "stable") {
    if (
      access.type.kind !== "void" ||
      access.offset !== 0 ||
      access.minimum !== 0 ||
      access.symbol !== undefined ||
      access.stride !== undefined
    )
      return { ok: false, error: "malformed callback access" };
    return access.operation === "callback-key"
      ? { ok: true, value: { parameters: [], result: "number" } }
      : { ok: true, value: { parameters: ["Uint8Array"], result: "boolean" } };
  }
  if ((access.operation === "available") !== (access.symbol !== undefined))
    return { ok: false, error: "only availability queries name a symbol" };
  const stride = access.stride,
    count = access.length;
  if ((stride === undefined) !== (count === undefined))
    return { ok: false, error: "element accesses have a stride and length" };
  if (
    access.operation !== "load" &&
    access.operation !== "store" &&
    stride !== undefined
  )
    return { ok: false, error: "only loads and stores index elements" };
  if (access.operation === "fits") {
    const type = access.type;
    if (
      (type.kind !== "pointer" &&
        (type.kind !== "scalar" ||
          type.scalar === "bool" ||
          type.scalar === "f32" ||
          type.scalar === "f64")) ||
      access.offset !== 0 ||
      access.minimum !== 0
    )
      return { ok: false, error: "fits checks integer or pointer types" };
    return { ok: true, value: { parameters: ["number"], result: "boolean" } };
  }
  if (access.operation !== "load" && access.operation !== "store") {
    if (
      access.type.kind !== "void" ||
      access.offset !== 0 ||
      access.minimum !== 0
    )
      return { ok: false, error: "only field accesses have a type" };
    if (access.operation === "available")
      return validSymbol(access.symbol ?? "")
        ? { ok: true, value: { parameters: [], result: "boolean" } }
        : { ok: false, error: "invalid foreign symbol" };
    if (access.operation === "address-into")
      return {
        ok: true,
        value: { parameters: ["Uint8Array", "Uint8Array"], result: "void" },
      };
    if (access.operation === "adopt-words")
      return {
        ok: true,
        value: {
          parameters: ["Uint8Array", "number", "number", "number"],
          result: "Uint8Array",
        },
      };
    return access.operation === "address"
      ? { ok: true, value: { parameters: ["Uint8Array"], result: "number" } }
      : access.operation === "retarget"
        ? {
            ok: true,
            value: { parameters: ["Uint8Array", "number"], result: "void" },
          }
        : {
            ok: true,
            value: {
              parameters: ["Uint8Array", "number", "number"],
              result: "Uint8Array",
            },
          };
  }
  const type = access.type;
  let bytes = 8,
    value: ScalarType = "number";
  if (type.kind === "scalar") {
    bytes = cScalarBytes(type.scalar);
    if (type.scalar === "bool") value = "boolean";
  } else if (type.kind !== "pointer")
    return { ok: false, error: "C fields are scalars or pointers" };
  let extent = 0;
  if (stride !== undefined && count !== undefined) {
    if (
      !Number.isSafeInteger(stride) ||
      !Number.isSafeInteger(count) ||
      stride < bytes ||
      count < 1
    )
      return { ok: false, error: "invalid C element stride" };
    extent = (count - 1) * stride;
  }
  if (
    !Number.isSafeInteger(access.offset) ||
    !Number.isSafeInteger(access.minimum) ||
    access.offset < 0 ||
    access.minimum > 2147483647 ||
    access.offset + extent + bytes > access.minimum
  )
    return { ok: false, error: "C field outside its record" };
  const parameters: ScalarType[] =
    stride === undefined ? ["Uint8Array"] : ["Uint8Array", "number"];
  if (access.operation === "store") parameters.push(value);
  return {
    ok: true,
    value: {
      parameters,
      result: access.operation === "load" ? value : "void",
    },
  };
}
/** One bound runtime function: its body becomes a single c-call (`call`)
 * or C memory access (`memory`); exactly one is present. */
export interface ForeignBinding {
  readonly function: number;
  readonly call?: ForeignCall | undefined;
  readonly memory?: ForeignMemoryAccess | undefined;
}
export type ForeignBindingResult =
  | { readonly ok: true; readonly value: ModuleIR }
  | { readonly ok: false; readonly error: string };
/** Replace each bound function's body with one c-call over its parameters
 * (after ordinary source checking/lowering, like bindHostOperations). The
 * declared parameter and return types must match the call exactly. */
export function bindForeignCalls(
  module: ModuleIR,
  bindings: readonly ForeignBinding[],
): ForeignBindingResult {
  if (bindings.length === 0) return { ok: true, value: module };
  const functions = module.functions.slice(),
    seen = new Set<number>();
  for (const binding of bindings) {
    if (binding === undefined) throw "foreign binding invariant";
    const fn = functions[binding.function];
    if (fn === undefined || seen.has(binding.function))
      return { ok: false, error: "invalid or duplicate foreign binding" };
    seen.add(binding.function);
    const call = binding.call,
      memory = binding.memory;
    if ((call === undefined) === (memory === undefined))
      return { ok: false, error: "a foreign binding is a call or an access" };
    // View accesses rely on checks only the view lowering emits.
    if (
      memory !== undefined &&
      (memory.operation === "load" ||
        memory.operation === "store" ||
        memory.operation === "fits")
    )
      return {
        ok: false,
        error: "c-memory " + fn.name + ": view accesses are not bindable",
      };
    const label =
      call === undefined
        ? "c-memory " + fn.name
        : call.dynamic === true
          ? "dynamic c-call " + fn.name
          : call.symbol;
    const types =
      call !== undefined
        ? foreignCallTypes(call)
        : memory !== undefined
          ? foreignMemoryTypes(memory)
          : undefined;
    if (types === undefined) throw "foreign binding kind invariant";
    if (!types.ok) return { ok: false, error: label + ": " + types.error };
    const parameters = types.value.parameters;
    if (
      fn.environment !== undefined ||
      fn.closureEnvironment !== undefined ||
      fn.returnType !== types.value.result ||
      fn.parameters.length !== parameters.length
    )
      return {
        ok: false,
        error: label + ": foreign binding signature mismatch",
      };
    const instructions: Instruction[] = [],
      args: number[] = [];
    for (let index = 0; index < parameters.length; index++) {
      const slot = fn.parameters[index];
      if (slot === undefined || fn.slots[slot] !== parameters[index])
        return {
          ok: false,
          error: label + ": foreign binding parameter mismatch",
        };
      instructions.push({ kind: "load", id: index, slot, start: 0, end: 0 });
      args.push(index);
    }
    const result = types.value.result === "void" ? undefined : args.length;
    if (call !== undefined)
      instructions.push({
        kind: "c-call",
        call,
        id: result,
        arguments: args,
        start: 0,
        end: 0,
      });
    else if (memory !== undefined)
      instructions.push({
        kind: "c-memory",
        access: memory,
        id: result,
        arguments: args,
        start: 0,
        end: 0,
      });
    const replacement: FunctionIR = {
      ...fn,
      entry: 0,
      blocks: [
        {
          id: 0,
          instructions,
          terminator: { kind: "return", value: result, start: 0, end: 0 },
        },
      ],
    };
    functions[binding.function] = replacement;
  }
  return { ok: true, value: { ...module, functions } };
}
