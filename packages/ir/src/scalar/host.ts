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
  /** Detach a native typed-array view (a general value): its length becomes
   * 0 and its data address sits one word before its owner's data, which
   * collections preserve and no attached view has (a negative byte
   * offset). Any other value is left unchanged. A typed program's views of
   * a realm ArrayBuffer observe its detachment this way. */
  | "native-array-detach"
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
  | "generational-state"
  | "external-memory-configure"
  | "external-memory-register"
  /** Register published code's safepoint table with the hosted stack-map
   * registry: (code address, code byte length, table address) -> 0 or -1. */
  | "stack-maps-register"
  | "memory-map"
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
   * evacuated semispace with it; the caller proves nothing live remains.
   * Defensively, both backends release only a range inside the context's
   * managed mapping or inside the releasable window its identity page
   * records (nativeIdentityReleasable*Offset: the shared string arena);
   * any other range, or a misaligned one, returns -1 and maps nothing. */
  | "memory-release"
  | "memory-read-word"
  | "memory-write-word"
  | "memory-move"
  /** Bounded copy of a Uint8Array into a caller-owned raw writable window:
   * (address, byteLength, offset, bytes) -> 0, or -1 for invalid input. */
  | "memory-write-bytes"
  /** A binary64 at an eight-byte-aligned offset of a caller-owned raw window,
   * with the memory-read-word bounds contract: (address, byteLength, offset)
   * reads it (NaN for invalid input); (address, byteLength, offset, value)
   * writes it and returns 0, or -1 for invalid input. */
  | "memory-read-float64"
  | "memory-write-float64"
  /** Bulk UTF-16 copies between strings and a caller-owned raw window.
   * memory-write-string copies every code unit of a string (two bytes each,
   * native byte order) to (address, byteLength, offset) and returns 0, or -1
   * when the units do not fit or an input is invalid. memory-read-string
   * returns a fresh string of `units` code units copied from the window;
   * invalid input traps. */
  | "memory-write-string"
  | "memory-read-string"
  /** Shared string bodies (docs/design-worker-runtime.md, "Shared string
   * bodies"): flat string objects outside every managed heap, in the
   * process's shared string arena, which every isolate may reference.
   * string-address returns a string object's address. string-at returns the
   * string object at an address the caller proves holds one; anything but an
   * exact, nonzero, eight-byte-aligned integer below 2^53 traps. string-copy
   * copies a flat string object verbatim (header, length and units), by the
   * extent its header gives, to (address, byteLength, offset) of a
   * caller-owned raw window and returns that extent in bytes, or -1 when the
   * string is not flat, does not fit or an input is invalid. */
  | "string-address"
  | "string-at"
  | "string-copy"
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
  | "sha256-rounds"
  /** Latin-1 and ASCII bulk text primitives (foundation's text/latin1.ts).
   * Binding replaces the function body with the IR instruction of the same
   * name (hostInstruction), never a host call; see the instructions'
   * contracts in model.ts. */
  | "string-from-latin1"
  | "string-copy-latin1"
  | "string-ascii-prefix"
  | "bytes-ascii-prefix"
  | "string-ascii-upper"
  | "string-ascii-lower"
  /** UTF-8 bulk text primitives (foundation's text/utf8.ts), bound the same
   * way to the IR instructions of the same names (string-from-utf8-whole:
   * string-from-utf8 with `whole`). */
  | "string-utf8-length"
  | "string-write-utf8"
  | "string-from-utf8"
  | "string-from-utf8-whole"
  /** The number-string cache (foundation's numeric/number-string-cache.ts),
   * bound the same way to the IR instructions of the same names. */
  | "number-string-cached"
  | "number-string-cache"
  /** Strings' cached array indices (the same module), likewise bound. */
  | "string-index-cached"
  | "string-index-cache"
  /** String transfer primitives (the IR instructions of the same names):
   * whether a string is flat, and its flat image written into a raw
   * window. */
  | "string-flat"
  | "string-flatten-into";
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
    case "native-array-detach":
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
    case "memory-read-float64":
      return ["number", "number", "number"];
    case "memory-write-float64":
    case "memory-read-string":
      return ["number", "number", "number", "number"];
    case "memory-write-string":
    case "string-copy":
      return ["number", "number", "number", "string"];
    case "string-address":
      return ["string"];
    case "string-at":
      return ["number"];
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
    case "string-from-latin1":
    case "bytes-ascii-prefix":
    case "string-from-utf8":
    case "string-from-utf8-whole":
      return ["Uint8Array", "number", "number"];
    case "string-copy-latin1":
    case "string-write-utf8":
      return ["string", "number", "number", "Uint8Array", "number"];
    case "string-ascii-prefix":
    case "string-utf8-length":
      return ["string", "number", "number"];
    case "number-string-cached":
      return ["number"];
    case "number-string-cache":
      return ["number", "string"];
    case "string-index-cached":
      return ["string"];
    case "string-index-cache":
      return ["string", "number"];
    case "string-ascii-upper":
    case "string-ascii-lower":
    case "string-flat":
      return ["string"];
    case "string-flatten-into":
      return ["number", "number", "string"];
  }
}
/** The instruction a binding of `operation` lowers to, for the operations
 * that are IR instructions rather than host calls; `id` is its result and
 * `args` hold the bound function's parameters in order. */
export function hostInstruction(
  operation: HostOperation,
  id: number,
  args: readonly number[],
): Instruction | undefined {
  const first = args[0] ?? 0,
    second = args[1] ?? 0,
    third = args[2] ?? 0;
  switch (operation) {
    case "string-from-latin1":
      return {
        kind: "string-from-latin1",
        id,
        bytes: first,
        begin: second,
        limit: third,
        start: 0,
        end: 0,
      };
    case "string-copy-latin1":
      return {
        kind: "string-copy-latin1",
        id,
        string: first,
        begin: second,
        limit: third,
        bytes: args[3] ?? 0,
        offset: args[4] ?? 0,
        start: 0,
        end: 0,
      };
    case "string-ascii-prefix":
      return {
        kind: "string-ascii-prefix",
        id,
        string: first,
        begin: second,
        limit: third,
        start: 0,
        end: 0,
      };
    case "string-ascii-upper":
    case "string-ascii-lower":
      return {
        kind: "string-ascii-case",
        id,
        string: first,
        upper: operation === "string-ascii-upper",
        start: 0,
        end: 0,
      };
    case "bytes-ascii-prefix":
      return {
        kind: "bytes-ascii-prefix",
        id,
        bytes: first,
        begin: second,
        limit: third,
        start: 0,
        end: 0,
      };
    case "string-utf8-length":
      return {
        kind: "string-utf8-length",
        id,
        string: first,
        begin: second,
        limit: third,
        start: 0,
        end: 0,
      };
    case "string-write-utf8":
      return {
        kind: "string-write-utf8",
        id,
        string: first,
        begin: second,
        limit: third,
        bytes: args[3] ?? 0,
        offset: args[4] ?? 0,
        start: 0,
        end: 0,
      };
    case "string-from-utf8":
      return {
        kind: "string-from-utf8",
        id,
        bytes: first,
        begin: second,
        limit: third,
        start: 0,
        end: 0,
      };
    case "string-from-utf8-whole":
      return {
        kind: "string-from-utf8",
        id,
        bytes: first,
        begin: second,
        limit: third,
        whole: true,
        start: 0,
        end: 0,
      };
    case "number-string-cached":
      return {
        kind: "number-string-cached",
        id,
        value: first,
        start: 0,
        end: 0,
      };
    case "number-string-cache":
      return {
        kind: "number-string-cache",
        value: first,
        string: second,
        start: 0,
        end: 0,
      };
    case "string-index-cached":
      return {
        kind: "string-index-cached",
        id,
        string: first,
        start: 0,
        end: 0,
      };
    case "string-index-cache":
      return {
        kind: "string-index-cache",
        string: first,
        value: second,
        start: 0,
        end: 0,
      };
    case "string-flat":
      return { kind: "string-flat", id, string: first, start: 0, end: 0 };
    case "string-flatten-into":
      return {
        kind: "string-flatten-into",
        id,
        address: first,
        byteLength: second,
        string: third,
        start: 0,
        end: 0,
      };
    default:
      return undefined;
  }
}
/** The result encoding is part of the capability's checked ABI. */
export function hostReturnType(
  operation: HostOperation,
): "number" | "general" | "string" | "void" | undefined {
  if (hostParameters(operation) === undefined) return undefined;
  if (
    operation === "string-from-latin1" ||
    operation === "string-from-utf8" ||
    operation === "string-from-utf8-whole" ||
    operation === "number-string-cached" ||
    operation === "string-ascii-upper" ||
    operation === "string-ascii-lower"
  )
    return "string";
  if (
    operation === "cpu-pause" ||
    operation === "collect-garbage" ||
    operation === "number-string-cache" ||
    operation === "string-index-cache" ||
    operation === "sha256-rounds" ||
    operation === "jit-debug-register" ||
    operation === "native-array-detach"
  )
    return "void";
  if (operation === "memory-read-string" || operation === "string-at")
    return "string";
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
        hostReturnType(binding.operation) === "void" ? undefined : args.length,
      bound = hostInstruction(binding.operation, args.length, args);
    instructions.push(
      bound ?? {
        kind: "host-call",
        operation: binding.operation,
        id: result,
        arguments: args,
        start: 0,
        end: 0,
      },
    );
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
