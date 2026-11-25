/** Trusted runtime leaves; the native compiler caller must explicitly authorize
 * their HostOperation bindings. Node builds these functions but never runs them. */
export function mapMemory(byteLength: number): number {
  throw "HOST_UNAVAILABLE";
}
export function unmapMemory(address: number, byteLength: number): number {
  throw "HOST_UNAVAILABLE";
}
/** Return the pages of [address, address + byteLength) (page-aligned, inside
 * a mapping the caller owns) to the OS; the range stays mapped read/write
 * and reads as zero. Returns 0 or -errno. */
export function releaseMemory(address: number, byteLength: number): number {
  throw "HOST_UNAVAILABLE";
}
/** The running kernel's page size in bytes: a power of two, fixed for the
 * life of the process. memory-release ranges are aligned to it. */
export function memoryPageBytes(): number {
  throw "HOST_UNAVAILABLE";
}
/** CPUs this process may run on (on Linux, its affinity mask), at least 1,
 * or 0 when the count is unknown. */
export function processorCount(): number {
  throw "HOST_UNAVAILABLE";
}
/** Read-only file access for the runtime's own host queries (cgroup CPU
 * limits), with the native-fs-host contract: paths are NUL-terminated
 * UTF-8 bytes, results are counts or descriptors, failures -errno. */
export function openRuntimeFile(path: Uint8Array): number {
  throw "HOST_UNAVAILABLE";
}
export function readRuntimeFile(fd: number, buffer: Uint8Array): number {
  throw "HOST_UNAVAILABLE";
}
export function closeRuntimeFile(fd: number): number {
  throw "HOST_UNAVAILABLE";
}
/** Trusted code storage; platform permission is granted by the image builder.
 * The owner retains mappings while code or data is reachable. Unregistered arenas
 * may be released with unmapMemory; permanently registered arenas stay mapped
 * through process exit, since the collector grant cannot be revoked. */
export function mapExecutableMemory(byteLength: number): number {
  throw "HOST_UNAVAILABLE";
}
/** Release a whole arena returned by mapExecutableMemory (the same address
 * and byte length): 0, or -errno. Executable arenas must not be released
 * with unmapMemory, which on Linux would leave the arena's writable view and
 * header mapped. Never release a registered arena (see above). */
export function unmapExecutableMemory(
  address: number,
  byteLength: number,
): number {
  throw "HOST_UNAVAILABLE";
}
/** In one native leaf, enter write mode, copy aligned instructions, flush
 * the instruction cache and restore execution mode. Returns 0 or -1. The caller
 * owns the window and excludes concurrent execution/mutation of the written code. */
export function writeExecutableMemory(
  address: number,
  byteLength: number,
  offset: number,
  code: Uint8Array,
): number {
  throw "HOST_UNAVAILABLE";
}
/** Trusted non-allocating, non-throwing Tint numeric entry, with no parameters.
 * The owner proves that address belongs to published, live compatible code. */
export function callExecutableNumber(address: number): number {
  throw "HOST_UNAVAILABLE";
}
/** Trusted non-allocating, non-throwing Tint (unknown) => unknown entry.
 * Caller roots the argument and proves code/result lifetimes; returned references
 * must remain valid independently of an eventual executable-arena release. */
export function callExecutableValue(address: number, value: unknown): unknown {
  throw "HOST_UNAVAILABLE";
}
/** Trusted same-context managed (callback: () => unknown) => unknown entry.
 * The owner proves published entry ownership, lifetime and exact ABI. Unlike the
 * borrowed value entry, this boundary may allocate, invoke callbacks and throw. */
export function callExecutableManaged(
  address: number,
  callback: () => unknown,
): unknown {
  throw "HOST_UNAVAILABLE";
}
/** The caller owns a live authorized window. Invalid bounds, alignment, numeric
 * inputs or words outside the exact integer domain return -1 without rounding. */
export function readMemoryWord(
  address: number,
  byteLength: number,
  offset: number,
): number {
  throw "HOST_UNAVAILABLE";
}
export function writeMemoryWord(
  address: number,
  byteLength: number,
  offset: number,
  value: number,
): number {
  throw "HOST_UNAVAILABLE";
}

/** Sequentially consistent raw-word atomics with the readMemoryWord window
 * contract. Each returns the word observed before the operation (0 for the
 * store), or -1 for invalid input or an observed word outside the exact
 * integer domain. compareExchange stores replacement only when the observed
 * word equals expected; fetchAdd's delta may be negative. For collector
 * workers sharing permanent raw control memory; never a mutator's objects. */
export function compareExchangeMemoryWord(
  address: number,
  byteLength: number,
  offset: number,
  expected: number,
  replacement: number,
): number {
  throw "HOST_UNAVAILABLE";
}
export function fetchAddMemoryWord(
  address: number,
  byteLength: number,
  offset: number,
  delta: number,
): number {
  throw "HOST_UNAVAILABLE";
}
export function loadAcquireMemoryWord(
  address: number,
  byteLength: number,
  offset: number,
): number {
  throw "HOST_UNAVAILABLE";
}
export function storeReleaseMemoryWord(
  address: number,
  byteLength: number,
  offset: number,
  value: number,
): number {
  throw "HOST_UNAVAILABLE";
}
/** Address of the image's collector worker thunk: a raw thread entry whose
 * argument is a permanent raw record holding, in word 0, a permanent native
 * function object taking that record address. It runs on its own stack with
 * a context that has no root chain or allocator. */
export function collectorWorkerEntry(): number {
  throw "HOST_UNAVAILABLE";
}
/** Raw address of a function object the caller proves permanent: created
 * while the runtime initializes from control memory, so never moved or
 * reclaimed. Collector worker setup only. */
export function permanentFunctionAddress(
  worker: (record: number) => number,
): number {
  throw "HOST_UNAVAILABLE";
}
/** Seq-cst compare/exchange of 1, 2 or 4 naturally aligned bytes with the
 * shared-memory leaf contract (see shared-atomics.ts): returns the observed
 * unsigned value, or -1 for invalid input. Collector start bits only. */
export function compareExchangeMemoryUnsigned(
  address: number,
  byteLength: number,
  offset: number,
  width: number,
  expected: number,
  replacement: number,
): number {
  throw "HOST_UNAVAILABLE";
}
/** CPU spin hint for collector waits (see spin-hint.ts). */
export function spinPause(): void {
  throw "HOST_UNAVAILABLE";
}
/** Data address of a typed array the caller proves permanent (borrowed
 * control storage or created while the runtime initializes). */
export function permanentArrayAddress(array: Uint32Array): number {
  throw "HOST_UNAVAILABLE";
}

/** Publish one permanent control-allocated, nonallocating and nonthrowing
 * registrar. It enforces region policy; the owner separately proves mapping,
 * read permission, lifetime and absence of managed edges. Publication is set-once.
 * Returns 0 or -1, and requires the hosted 80-byte runtime context. */
export function configureExternalMemory(
  register: (address: number, byteLength: number) => boolean,
): number {
  throw "HOST_UNAVAILABLE";
}
/** Grant permanent external leaf/metadata read access through the registered
 * runtime policy. Accepted windows must remain mapped through process exit and
 * contain no managed references requiring tracing. Returns 0 or -1. */
export function registerExternalMemory(
  address: number,
  byteLength: number,
): number {
  throw "HOST_UNAVAILABLE";
}

/** Force a full collection through the runtime allocator (request size 0).
 * Only the Test262 host binds this (as $262.gc); ordinary programs have no
 * binding. A safepoint: managed references may move. Throws
 * the managed heap exhaustion abort when the live data no longer fits after
 * collection. */
export function collectGarbage(): void {
  throw "HOST_UNAVAILABLE";
}

/** The hosted stack-map registry (0 without one), after recording the
 * calling function's frame as the start of the next stack walk: collectors
 * walk the caller's callers, so call it from the collecting function, before
 * any managed allocation, and pass the result to the walk. */
export function currentRootHead(): number {
  throw "HOST_UNAVAILABLE";
}

/** Trusted: register the safepoint table of published code at codeAddress
 * (codeByteLength bytes) with the hosted stack-map registry, so collections
 * can walk its frames. tableAddress is the table inside that code; the owner
 * keeps both mapped for the context's lifetime. Returns 0, or -1 for invalid
 * input or a full registry. Only explicit host bindings replace this. */
export function registerStackMaps(
  codeAddress: number,
  codeByteLength: number,
  tableAddress: number,
): number {
  throw "HOST_UNAVAILABLE";
}

/** Move raw bytes inside one caller-owned normal-memory window. Overlap is valid.
 * Exact nonnegative integer bounds are checked before writes. Returns 0 or -1;
 * the caller grants mapping/lifetime and must exclude concurrent mutation. */
export function moveMemory(
  address: number,
  byteLength: number,
  destinationOffset: number,
  sourceOffset: number,
  count: number,
): number {
  throw "HOST_UNAVAILABLE";
}

/** Publish the nineteen-word generational allocation/barrier control block.
 * All buffers are permanently owned, disjoint control storage. Initial young
 * top and old top are zero; young base equals the aligned old-prefix capacity.
 * The caller supplies zeroed start/dirty maps. Publication installs native data
 * pointers and resets the bounded dirty queue. Invalid state returns -1 without
 * replacing the current publication. See allocation-throughput.md for the ABI. */
export function configureGenerationalAllocation(
  state: Uint32Array,
  starts: Uint32Array,
  dirty: Uint8Array,
  queue: Float64Array,
): number {
  throw "HOST_UNAVAILABLE";
}

/** Trusted same-program native callable identity reads. The callback remains a
 * rooted managed value and is never invoked or converted into an address. The
 * returned permanent GC-descriptor/signature identity is not a semantic import
 * authorization. Explicit program-image host bindings are required; these are
 * not Script globals. Returns -1 for zero or addresses outside Number's exact
 * positive integer domain. Node cannot execute either leaf. */
export function nativeFunctionDescriptor(callback: () => unknown): number {
  throw "HOST_UNAVAILABLE";
}
export function nativeFunctionSignature(callback: () => unknown): number {
  throw "HOST_UNAVAILABLE";
}
/** Inspection-only unknown-value leaves. Non-functions return -1 after tag and
 * brand checks; no type assertion changes the value's callable signature. */
export function nativeValueFunctionDescriptor(value: unknown): number {
  throw "HOST_UNAVAILABLE";
}
export function nativeValueFunctionSignature(value: unknown): number {
  throw "HOST_UNAVAILABLE";
}

/** Concrete indexed callback profile of the same trusted managed call boundary.
 * Callable shapes stay explicit until host bindings support generic signatures.
 * These leaves inspect or pass the reference; they never call it in Node. */
export function callExecutableManagedWithIndex(
  address: number,
  callback: (base: unknown, step: number) => unknown,
): unknown {
  throw "HOST_UNAVAILABLE";
}
export function nativeFunctionDescriptorWithIndex(
  callback: (base: unknown, step: number) => unknown,
): number {
  throw "HOST_UNAVAILABLE";
}
export function nativeFunctionSignatureWithIndex(
  callback: (base: unknown, step: number) => unknown,
): number {
  throw "HOST_UNAVAILABLE";
}

/** Trusted opaque identity of this hosted heap/context. Realms share it; it is
 * permanent and never reissued after teardown. Zero denotes an unissued context.
 * Only explicit host bindings replace this declaration. */
export function currentContextDomain(): number {
  throw "HOST_UNAVAILABLE";
}

/** Trusted: 1 when value is the one a stack overflow throws (a prologue below
 * the stack limit throws undefined carrying a reserved payload), else 0. It
 * reads only the value, so it holds through any catch, rethrow or storage.
 * Only explicit host bindings replace this declaration. */
export function isStackOverflow(value: unknown): number {
  throw "HOST_UNAVAILABLE";
}

/** Trusted: the value a stack overflow throws (undefined carrying the
 * reserved payload), produced without touching the stack limit. The
 * allocators throw it for a request no heap can satisfy, so a JavaScript
 * boundary reports a RangeError instead of aborting the engine. Allocates
 * nothing. Only explicit host bindings replace this declaration. */
export function engineRangeError(): unknown {
  throw "HOST_UNAVAILABLE";
}

/** Trusted raw thread lifecycle. entry obeys the platform void*(void*) ABI,
 * establishes its own hosted context before executing managed code, and returns
 * a scalar status in 0..255. argument is a scalar or a raw shared mailbox address;
 * it must never point into a managed heap. The owner keeps code and shared storage
 * alive through join. Entry/argument must be exact nonnegative native integers.
 * Returns an opaque positive thread handle, or a negative platform error number.
 * Only explicit compiler bindings authorize these leaves; they are not globals. */
export function startNativeThread(entry: number, argument: number): number {
  throw "HOST_UNAVAILABLE";
}
/** Join exactly once, on the owner thread, with a live handle returned by start.
 * Returns the worker's scalar status or a negative platform error number. The
 * containing process's deadline remains authoritative for a stuck/failed worker;
 * asynchronous cancellation cannot safely unwind a managed heap. */
export function joinNativeThread(handle: number): number {
  throw "HOST_UNAVAILABLE";
}

/** Address of the image-owned worker startup thunk. The image must explicitly
 * enable threaded startup. Each call through this address allocates and tears
 * down an independent hosted heap, collector and context, then invokes the same
 * application export with the raw scalar argument. The process invokes it with 0.
 * Never substitute a managed function's code pointer for this entry. */
export function hostedThreadEntry(): number {
  throw "HOST_UNAVAILABLE";
}

/** Trusted futex-style kernel leaves. The owner grants a live aligned raw 32-bit
 * cell and excludes unmapping until every waiter has returned. Inputs are exact
 * nonnegative integers: expected is uint32, timeoutNanoseconds is zero for an
 * indefinite park or a positive relative duration. all is 0 (one) or 1 (all).
 * Results are raw platform statuses (negative error numbers or nonnegative
 * advisory wakes). Callers must recheck their atomic state and absolute deadline
 * after every return, including spurious wakes, interrupts and value mismatches.
 * These leaves never implement observable Atomics.wait/notify counts themselves. */
export function parkNativeWord(
  address: number,
  expected: number,
  timeoutNanoseconds: number,
): number {
  throw "HOST_UNAVAILABLE";
}
export function wakeNativeWord(address: number, all: number): number {
  throw "HOST_UNAVAILABLE";
}
