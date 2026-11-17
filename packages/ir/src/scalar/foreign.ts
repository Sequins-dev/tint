import type { CSignature } from "@tint/abi/c";
import type {
  FunctionIR,
  Instruction,
  ModuleIR,
  ReturnType,
  ScalarType,
} from "./model.ts";
/** How one c-call operand reaches C (docs/native-ffi.md):
 * - `number`: a C integer or float scalar, converted with an exactness
 *   check (integers) or rounding (f32);
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
  if (!validSymbol(call.symbol))
    return { ok: false, error: "invalid foreign symbol" };
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
        if (type.kind !== "scalar" || type.scalar === "bool")
          return { ok: false, error: "number operand needs a C number type" };
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
      if (result.kind !== "scalar" || result.scalar === "bool")
        return { ok: false, error: "number result needs a C number type" };
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
export interface ForeignBinding {
  readonly function: number;
  readonly call: ForeignCall;
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
    const types = foreignCallTypes(binding.call);
    if (!types.ok)
      return {
        ok: false,
        error: binding.call.symbol + ": " + types.error,
      };
    const parameters = types.value.parameters;
    if (
      fn.environment !== undefined ||
      fn.closureEnvironment !== undefined ||
      fn.returnType !== types.value.result ||
      fn.parameters.length !== parameters.length
    )
      return {
        ok: false,
        error: binding.call.symbol + ": foreign binding signature mismatch",
      };
    const instructions: Instruction[] = [],
      args: number[] = [];
    for (let index = 0; index < parameters.length; index++) {
      const slot = fn.parameters[index];
      if (slot === undefined || fn.slots[slot] !== parameters[index])
        return {
          ok: false,
          error: binding.call.symbol + ": foreign binding parameter mismatch",
        };
      instructions.push({ kind: "load", id: index, slot, start: 0, end: 0 });
      args.push(index);
    }
    const result = types.value.result === "void" ? undefined : args.length;
    instructions.push({
      kind: "c-call",
      call: binding.call,
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
