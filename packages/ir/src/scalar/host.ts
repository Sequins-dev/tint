import type { ScalarType, ModuleIR, Instruction, FunctionIR } from "./model.ts";
export type HostOperation =
  | "hosted-thread-entry"
  | "word-park"
  | "word-wake"
  | "thread-start"
  | "thread-join"
  | "cpu-pause"
  | "monotonic-time"
  | "wall-clock-time"
  | "random-word"
  | "open-read"
  | "open-exclusive"
  | "read"
  | "write"
  | "close"
  | "chmod"
  | "rename"
  | "unlink"
  | "read-link"
  | "argument-count"
  | "argument-length"
  | "argument-copy"
  | "native-function-descriptor"
  | "native-function-signature"
  | "native-value-function-descriptor"
  | "native-value-function-signature"
  | "root-head"
  | "context-domain"
  | "allocation-state"
  | "generational-state"
  | "external-memory-configure"
  | "external-memory-register"
  | "memory-map"
  | "executable-map"
  | "executable-write"
  | "executable-call-number"
  | "executable-call-value"
  | "executable-call-managed"
  | "memory-unmap"
  | "memory-read-word"
  | "memory-write-word"
  | "memory-move"
  | "shared-read-unsigned"
  | "shared-write-unsigned"
  | "shared-read-word64"
  | "shared-write-word64"
  | "shared-compare-exchange-unsigned"
  | "shared-compare-exchange-word64";
/** Internal filesystem ABI: failures return -errno captured immediately. Paths
 * are NUL-terminated UTF-8 byte arrays; read/write cover the supplied view. */
export function hostParameters(
  operation: HostOperation,
): readonly ScalarType[] | undefined {
  switch (operation) {
    case "word-park":
      return ["number", "number", "number"];
    case "word-wake":
    case "thread-start":
      return ["number", "number"];
    case "thread-join":
      return ["number"];
    case "hosted-thread-entry":
    case "cpu-pause":
      return [];
    case "shared-read-unsigned":
      return ["number", "number", "number", "number", "number"];
    case "shared-compare-exchange-unsigned":
    case "shared-write-unsigned":
    case "shared-write-word64":
      return ["number", "number", "number", "number", "number", "number"];
    case "shared-read-word64":
      return ["number", "number", "number", "number", "Uint32Array"];
    case "shared-compare-exchange-word64":
      return [
        "number",
        "number",
        "number",
        "number",
        "number",
        "number",
        "number",
        "Uint32Array",
      ];
    case "native-function-descriptor":
    case "native-function-signature":
    case "external-memory-configure":
      return ["reference"];
    case "native-value-function-descriptor":
    case "native-value-function-signature":
      return ["general"];
    case "external-memory-register":
      return ["number", "number"];
    case "generational-state":
      return ["Uint32Array", "Uint32Array", "Uint8Array", "Float64Array"];
    case "allocation-state":
      return ["Uint32Array", "Uint32Array"];
    case "argument-length":
      return ["number"];
    case "argument-copy":
      return ["number", "Uint8Array"];
    case "argument-count":
    case "monotonic-time":
    case "wall-clock-time":
    case "random-word":
    case "context-domain":
    case "root-head":
      return [];
    case "memory-map":
    case "executable-map":
    case "executable-call-number":
      return ["number"];
    case "executable-call-managed":
      return ["number", "reference"];
    case "executable-call-value":
      return ["number", "general"];
    case "executable-write":
      return ["number", "number", "number", "Uint8Array"];
    case "memory-unmap":
      return ["number", "number"];
    case "memory-read-word":
      return ["number", "number", "number"];
    case "memory-move":
      return ["number", "number", "number", "number", "number"];
    case "memory-write-word":
      return ["number", "number", "number", "number"];
    case "open-exclusive":
      return ["Uint8Array", "number"];
    case "open-read":
    case "unlink":
      return ["Uint8Array"];
    case "read":
    case "write":
      return ["number", "Uint8Array"];
    case "close":
      return ["number"];
    case "chmod":
      return ["number", "number"];
    case "read-link":
    case "rename":
      return ["Uint8Array", "Uint8Array"];
  }
}
/** The result encoding is part of the capability's checked ABI. */
export function hostReturnType(
  operation: HostOperation,
): "number" | "general" | "void" | undefined {
  if (hostParameters(operation) === undefined) return undefined;
  if (operation === "cpu-pause") return "void";
  return operation === "executable-call-value" ||
    operation === "executable-call-managed"
    ? "general"
    : "number";
}
export interface HostBinding {
  readonly function: number;
  readonly operation: HostOperation;
}
export type HostBindingResult =
  | { readonly ok: true; readonly value: ModuleIR }
  | { readonly ok: false; readonly error: string };
/** Apply caller-authorized host bindings after ordinary source checking/lowering. */
export function bindHostOperations(
  module: ModuleIR,
  bindings: readonly HostBinding[],
): HostBindingResult {
  const functions = module.functions.slice(),
    seen = new Set<number>();
  for (const binding of bindings) {
    if (binding === undefined) throw "host binding invariant";
    const fn = functions[binding.function],
      parameters = hostParameters(binding.operation);
    if (
      fn === undefined ||
      parameters === undefined ||
      seen.has(binding.function)
    )
      return { ok: false, error: "invalid or duplicate host binding" };
    seen.add(binding.function);
    if (
      fn.environment !== undefined ||
      fn.closureEnvironment !== undefined ||
      fn.returnType !== hostReturnType(binding.operation) ||
      fn.parameters.length !== parameters.length
    )
      return { ok: false, error: "host binding signature mismatch" };
    const instructions: Instruction[] = [],
      args: number[] = [];
    for (let index = 0; index < parameters.length; index++) {
      const slot = fn.parameters[index];
      if (slot === undefined || fn.slots[slot] !== parameters[index])
        return { ok: false, error: "host binding parameter mismatch" };
      instructions.push({ kind: "load", id: index, slot, start: 0, end: 0 });
      args.push(index);
    }
    const result =
      hostReturnType(binding.operation) === "void" ? undefined : args.length;
    instructions.push({
      kind: "host-call",
      operation: binding.operation,
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
