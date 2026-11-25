# Native memory boundary

Caller-authorized runtime leaves for mapping/unmapping memory and reading/writing
unsigned words in a live, caller-owned window. Node compiles these functions but
execution under Node throws `HOST_UNAVAILABLE`. Each native binding must be named
in the compiler request and the module declared as a runtime capability provider.

`mapMemory` obtains zero-filled writable private anonymous memory; `unmapMemory`
releases it. Failures return negative errno captured at the host boundary. macOS
uses libSystem `mmap`/`munmap`; target policy supplies the mapping flags. No C or
platform linker is involved. The current address contract is the exact nonnegative
integer domain supported by Number, suitable for the current macOS address space.

Word access takes base address, window length, and byte offset. It checks exact
integer inputs, eight-byte alignment, bounds, and the supported word domain.
Reads/writes return -1 on invalid arguments or unrepresentable words. A valid read
returns its word; a successful write returns zero. These checks do not establish
ownership or keep mappings alive: only trusted runtime adapters may supply the
window. Released or invented windows must never reach these leaves.

The raw-memory operations do not allocate managed objects or run collection. They supply the
raw boundary used by the TypeScript allocator and tracing policies; they do not
implement ownership, tracing, page protection, executable memory, or heap policy.

`moveMemory(base, length, destinationOffset, sourceOffset, count)` moves raw bytes
within one authorized normal-memory window. It preserves every bit, supports
overlap and unaligned ranges, and returns zero on success or -1 on invalid numeric
inputs or bounds, before any write. Zero-length ranges may be one-past the window.
The generated leaf uses word copies and byte tails; it neither allocates nor calls
a platform library. Mapping validity and exclusive access remain caller obligations.

`configureGenerationalAllocation(state, starts, dirty, queue)` publishes sixteen
state words plus permanent nursery-start, dirty-object, and Float64 queue buffers.
Publication validates zero initial tops, the aligned old prefix and nursery extent,
bitmap capacities, and a nonempty queue before mutating the context. The runtime
owns zeroing and lifetime of these disjoint buffers. Queue count/capacity and overflow
are maintained jointly by the runtime and generated nonallocating barrier. See
`docs/allocation-throughput.md` for the state layout and runtime policy; the intrinsic
itself performs no collection.

## Trusted native function identities

`nativeFunctionDescriptor(callback)` and `nativeFunctionSignature(callback)` are
explicitly authorized leaves for the trusted managed-code loader. Bind them in
the **program image containing the callback**, not the separately compiled
runtime image: each image owns a different function brand. They verify the
callback's native function descriptor, then return its permanent function-brand
or signature identity. They never invoke the callback, inspect its environment,
expose its entry address, allocate or retain a movable callback address.

The callback remains a normal rooted managed value. Returned identities are
permanent positive integer addresses; zero or values above `Number.MAX_SAFE_INTEGER`
return -1 before conversion. This uses the existing Number address ABI for the
current host, not a promise that every future 64-bit address fits that ABI.
Identities alone do not authorize a cross-image signature or semantic shape.
No Script globals, `$262` methods or automatic host grants expose these leaves.
Node execution continues to throw `HOST_UNAVAILABLE`.

## Trusted managed executable calls

`callExecutableManaged(address, callback)` enters a caller-authorized, published
Tint `(reference) => general` entry in the same managed context. Unlike the
nonallocating, nonthrowing borrowed `callExecutableValue` operation, this distinct
capability permits allocation, callback invocation and ordinary thrown completion.
The callback is a rooted function reference, not a pointer to a general-value pair.
The trusted owner proves the entry's exact ABI, lifetime and code ownership; numeric
address validation alone establishes none of these. No automatic host grants are
provided. Image construction additionally requires `allowJit`.

The emitter retains caller roots, initializes the completion area and immediately
copies both returned payload words into traced storage before any safepoint. Throws
use ordinary caller handlers or propagate as completion status 2; invalid statuses
trap. Generational emission remains unsupported for this opaque boundary pending
a separate tracked-write proof. Node execution throws `HOST_UNAVAILABLE` without
invoking the callback.

The indexed profile uses `callExecutableManagedWithIndex`,
`nativeFunctionDescriptorWithIndex` and `nativeFunctionSignatureWithIndex` for a
callback of type `(unknown, number) => unknown`. It uses the same reference ABI
and host operations as the zero-argument profile, with separately checked concrete
callable shapes. Neither profile grants execution or metadata authority by default.

`@tint/native-runtime/intrinsics/shared-atomics` is a separate trusted facade for aligned
1/2/4-byte unsigned accesses, bit-exact 64-bit loads/stores and seq-cst 64-bit
compare/exchange. Explicit fixture/program bindings authorize these leaves;
ordinary compiler/Script capability tables do not grant them automatically.

The caller owns a live normal-memory window. Numeric inputs, width, order,
alignment and range are checked before payload access. Order codes are zero for
unordered and one for seq-cst. Unsigned reads return an exact uint32 value or -1;
other operations return zero or -1. A successful CAS returns the observed word
through two caller-owned `Uint32Array` scratch elements, so callers compare both
halves to determine whether replacement occurred. Scratch must be live, exclusively
owned and disjoint from the accessed word; failure preserves its contents.

64-bit payloads use exact lo/hi halves and one native payload load/store; arbitrary
uint64 values never pass through Number. These nonallocating leaves do not provide
shared-block allocation, registry/lifetime management, Script SAB or worker APIs.
