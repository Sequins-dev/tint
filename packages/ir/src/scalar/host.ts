import type { ScalarType, ModuleIR, Instruction, FunctionIR } from "./model.ts";
export type HostOperation =
  | "hosted-thread-entry"
  | "word-park"
  | "word-wake"
  | "thread-start"
  | "thread-join"
  | "cpu-pause"
  /** Forced full collection through the runtime allocator (request size 0).
   * Test262 host only; a safepoint that may throw the heap exhaustion abort. */
  | "collect-garbage"
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
  | "environment-copy"
  | "native-function-descriptor"
  | "native-function-signature"
  | "native-value-function-descriptor"
  | "native-value-function-signature"
  | "root-head"
  | "context-domain"
  /** Whether a general value is the one a stack overflow throws (tag 0 with
   * the reserved payload): 1 or 0. Reads only the value, never context state. */
  | "stack-overflow-is"
  /** The value a stack overflow throws (tag 0 with the reserved payload),
   * produced without entering emergency mode. The allocators throw it for a
   * request that can never fit (an impossible string length or a size above
   * the heap's capacity), so a JavaScript boundary turns it into a RangeError
   * exactly as it does an overflow. Allocates nothing. */
  | "engine-range-error"
  | "allocation-state"
  | "generational-state"
  | "external-memory-configure"
  | "external-memory-register"
  /** Register published code's safepoint table with the hosted stack-map
   * registry: (code address, code byte length, table address) -> 0 or -1. */
  | "stack-maps-register"
  | "memory-map"
  /** Registration-stub storage. Only the reviewed FFI runtime owns these
   * windows and publishes fixed native thunks through this capability. */
  | "executable-callback-map"
  | "executable-callback-write"
  | "executable-callback-unmap"
  | "executable-map"
  | "executable-write"
  | "executable-call-number"
  | "executable-call-value"
  | "executable-call-managed"
  /** Release an executable arena: (address, byteLength) -> 0, or -errno.
   * The window must be a whole arena from executable-map (on Linux its
   * header and writable view go with it; another window reports -EINVAL). */
  | "executable-unmap"
  | "memory-unmap"
  /** Return a page-aligned range of a private anonymous mapping to the OS
   * while keeping it mapped read/write: (address, byteLength) -> 0, or
   * -errno. The range reads as zero afterwards. The collector releases an
   * evacuated semispace with it; the caller proves nothing live remains. */
  | "memory-release"
  | "memory-read-word"
  | "memory-write-word"
  | "memory-move"
  /** Bounded copy of a Uint8Array into a caller-owned raw writable window:
   * (address, byteLength, offset, bytes) -> 0, or -1 for invalid input. */
  | "memory-write-bytes"
  /** GDB/LLDB JIT interface of a jitDebugInterface image: the address of
   * __jit_debug_descriptor, and a call of __jit_debug_register_code. */
  | "jit-debug-descriptor"
  | "jit-debug-register"
  | "process-id"
  /** The running kernel's memory page size in bytes (a power of two). The
   * runtime aligns memory-release ranges to it; it is fixed for the life of
   * the process. */
  | "memory-page-bytes"
  /** CPUs this process may run on (on Linux, its affinity mask), at least 1,
   * or 0 when the count is unknown. Sizes the collector's worker pool. */
  | "processor-count"
  /** 1 when the CPU implements the ARMv8 SHA-256 instructions that
   * sha256-rounds emits, else 0. Fixed for the life of the process. */
  | "cpu-sha256"
  /** The operating system the image was compiled for, as a constant
   * nativeTargetOS* code (@tint/abi/host) fixed by code generation from the
   * build target's host ABI. Reads nothing at run time. */
  | "target-os"
  | "target-architecture"
  /** Sequentially consistent raw-word atomics over a caller-authorized window,
   * with the memory-read-word bounds contract: (address, byteLength, offset,
   * ...). Each returns the word observed before the operation (0 for the
   * store), or -1 for invalid input or an observed word outside the exact
   * integer domain. They exist for runtime collector workers that share raw
   * control memory; they never address managed objects of a running mutator. */
  | "memory-compare-exchange-word"
  | "memory-fetch-add-word"
  | "memory-load-acquire-word"
  | "memory-store-release-word"
  /** Address of the image's collector worker thunk (see startup). */
  | "collector-worker-entry"
  /** Raw address of a function object the caller proves permanent (allocated
   * in control memory, never moved or reclaimed). Collector setup only. */
  | "permanent-function-address"
  /** Data address of a typed array the caller proves permanent (control
   * storage borrowed or allocated while the runtime initializes). */
  | "permanent-array-address"
  | "shared-read-unsigned"
  | "shared-write-unsigned"
  | "shared-read-word64"
  | "shared-write-word64"
  | "shared-compare-exchange-unsigned"
  | "shared-compare-exchange-word64"
  /** One SHA-256 compression over (state, schedule, constants) Uint32Arrays,
   * exactly as foundation's compressSha256RoundsPortable: schedule words 16-63 are
   * written and the block is added into state. Short views trap. */
  | "sha256-rounds";
/** Code generation shares the executable mapping ABI with callback stubs. */
export function executableHostOperation(
  operation: HostOperation,
): HostOperation {
  switch (operation) {
    case "executable-callback-map":
      return "executable-map";
    case "executable-callback-write":
      return "executable-write";
    case "executable-callback-unmap":
      return "executable-unmap";
    default:
      return operation;
  }
}
/** Internal filesystem ABI: failures return -errno captured immediately. Paths
 * are NUL-terminated UTF-8 byte arrays; read/write cover the supplied view. */
export function hostParameters(
  operation: HostOperation,
): readonly ScalarType[] | undefined {
  switch (executableHostOperation(operation)) {
    case "word-park":
      return ["number", "number", "number"];
    case "word-wake":
    case "thread-start":
      return ["number", "number"];
    case "thread-join":
      return ["number"];
    case "hosted-thread-entry":
    case "collector-worker-entry":
    case "cpu-pause":
    case "collect-garbage":
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
    case "permanent-function-address":
      return ["reference"];
    case "native-value-function-descriptor":
    case "native-value-function-signature":
      return ["general"];
    case "external-memory-register":
      return ["number", "number"];
    case "stack-maps-register":
      return ["number", "number", "number"];
    case "generational-state":
      return ["Uint32Array", "Uint32Array", "Uint8Array", "Float64Array"];
    case "permanent-array-address":
      return ["Uint32Array"];
    case "sha256-rounds":
      return ["Uint32Array", "Uint32Array", "Uint32Array"];
    case "allocation-state":
      return ["Uint32Array", "Uint32Array"];
    case "argument-length":
      return ["number"];
    case "argument-copy":
      return ["number", "Uint8Array"];
    case "environment-copy":
      return ["Uint8Array", "Uint8Array"];
    case "argument-count":
    case "jit-debug-descriptor":
    case "jit-debug-register":
    case "process-id":
    case "memory-page-bytes":
    case "processor-count":
    case "cpu-sha256":
    case "target-os":
    case "target-architecture":
    case "monotonic-time":
    case "wall-clock-time":
    case "random-word":
    case "context-domain":
    case "root-head":
    case "engine-range-error":
      return [];
    case "stack-overflow-is":
      return ["general"];
    case "memory-map":
    case "executable-map":
    case "executable-call-number":
      return ["number"];
    case "executable-call-managed":
      return ["number", "reference"];
    case "executable-call-value":
      return ["number", "general"];
    case "executable-write":
    case "memory-write-bytes":
      return ["number", "number", "number", "Uint8Array"];
    case "executable-unmap":
    case "memory-unmap":
    case "memory-release":
      return ["number", "number"];
    case "memory-read-word":
    case "memory-load-acquire-word":
      return ["number", "number", "number"];
    case "memory-compare-exchange-word":
      return ["number", "number", "number", "number", "number"];
    case "memory-fetch-add-word":
    case "memory-store-release-word":
      return ["number", "number", "number", "number"];
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
  if (
    operation === "cpu-pause" ||
    operation === "collect-garbage" ||
    operation === "sha256-rounds" ||
    operation === "jit-debug-register"
  )
    return "void";
  return operation === "executable-call-value" ||
    operation === "executable-call-managed" ||
    operation === "engine-range-error"
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
