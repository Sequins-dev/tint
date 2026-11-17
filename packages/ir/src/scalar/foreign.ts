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
 *   its C image. */
export type ForeignOperand =
  "number" | "boolean" | "bytes" | "terminated-bytes" | "record";
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
  /** The callee is an address, not an import: the first operand is that
   * address (a nonzero number, else trap) and the remaining operands are
   * the prototype's (docs/native-ffi.md, "Optional libraries"). `symbol`
   * names the C function for diagnostics. */
  readonly indirect?: true | undefined;
}
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
  patches: 224,
  patchArray: 128,
  patchCapacity: 16,
  stack: 608,
  stackCapacity: 512,
  scratch: 1120,
  scratchCapacity: 512,
  size: 1632,
  byteOperands: 8,
};
/** The universal trampoline call: operands are the callee address, the
 * frame and `dynamicCallFrame.byteOperands` borrowed byte arrays. */
export function dynamicForeignCall(): ForeignCall {
  const pointer: CType = { kind: "pointer", pointee: { kind: "void" } };
  const parameters: CType[] = [pointer, pointer],
    operands: ForeignOperand[] = ["number", "bytes"];
  for (let index = 0; index < dynamicCallFrame.byteOperands; index++) {
    parameters.push(pointer);
    operands.push("bytes");
  }
  return {
    symbol: "",
    signature: {
      parameters,
      result: { kind: "void" },
      fixedParameters: parameters.length,
      callClass: "leaf",
      errno: "none",
    },
    operands,
    result: "void",
    dynamic: true,
  };
}
/** Whether `call` is exactly the universal trampoline's shape. */
function dynamicShape(call: ForeignCall): boolean {
  const expected = dynamicForeignCall();
  if (
    call.symbol !== "" ||
    call.result !== "void" ||
    call.signature.result.kind !== "void" ||
    call.signature.callClass !== "leaf" ||
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
    const parameters: ScalarType[] = ["number"];
    for (let index = 1; index < call.operands.length; index++)
      parameters.push("Uint8Array");
    return { ok: true, value: { parameters, result: "void" } };
  }
  if (!validSymbol(call.symbol))
    return { ok: false, error: "invalid foreign symbol" };
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
    "load" | "store" | "fits" | "address" | "adopt" | "retarget" | "available";
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
}
export type ForeignMemoryTypesResult =
  | { readonly ok: true; readonly value: ForeignCallTypes }
  | { readonly ok: false; readonly error: string };
/** The IR operand and result types of a verified C memory access. */
export function foreignMemoryTypes(
  access: ForeignMemoryAccess,
): ForeignMemoryTypesResult {
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
