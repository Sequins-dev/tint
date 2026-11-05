/** Trusted runtime leaves; the native compiler caller must explicitly authorize
 * their HostOperation bindings. Node builds these functions but never runs them. */
export function mapMemory(byteLength: number): number {
  throw "HOST_UNAVAILABLE";
}
export function unmapMemory(address: number, byteLength: number): number {
  throw "HOST_UNAVAILABLE";
}
/** Trusted code storage; platform permission is granted by the image builder.
 * The owner retains mappings while code or data is reachable. Unregistered arenas
 * may be released with unmapMemory; permanently registered arenas stay mapped
 * through process exit, since the collector grant cannot be revoked. */
export function mapExecutableMemory(byteLength: number): number {
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

/** Current generated root-chain head, captured before any managed allocation. */
export function currentRootHead(): number {
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

/** Publish permanent control buffers for the optional inline allocation ABI.
 * state has eight uint32 words: top, limit, space base, reserved, then a reserved
 * native bitmap pointer at byte 16. Initially top/base are zero. limit is an
 * aligned semispace capacity; starts contains one bit per 16-byte object unit.
 * The caller owns both buffers outside the managed heap for the context lifetime.
 * Only top and space base may change after publication. Returns 0 or -1. */
export function configureLinearAllocation(
  state: Uint32Array,
  starts: Uint32Array,
): number {
  throw "HOST_UNAVAILABLE";
}

/** Publish the sixteen-word generational allocation/barrier control block.
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
