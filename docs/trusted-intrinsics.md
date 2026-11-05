# Trusted intrinsics and the host boundary

Status: proposed version 0 contract. No intrinsics, verifier, or runtime implementation
exists yet. This specifies the substrate needed by the existing strict profile,
not a separate bootstrap language or permission for arbitrary source casts.

## Keep the compiler ordinary

Scanner, parser, checker, IR, optimizer, instruction encoder, linker, Mach-O writer
and signer use ordinary TypeScript objects and byte buffers. Represent symbols,
relocations and target addresses as data, not pointers into the build process.
Writing arm64 bytes under Node does not require executing those bytes or allocating
executable memory. The native compiler uses the same core and buffer operations.

The trusted kernel consists of memory allocation/tracing, representation primitives,
foreign adapters and terminal failure handling. Implement policy and algorithms in
TypeScript; intrinsics supply only operations that cannot bottom out in ordinary
language semantics. Do not make the collector, file reader, hash table or instruction
encoder a single opaque intrinsic.

Three categories must remain distinct:

1. Ordinary libraries: source decoding, path handling, hashing/SHA-256, ordered
   tables, binary writers and layout calculations. Test these in both hosts.
2. Host interfaces: file/argument/diagnostic operations described by the
   [target contract](macos-arm64-target.md). Node and native adapters implement them.
3. Compiler-recognized operations: machine words, bounded regions, managed-storage
   publication, roots, foreign calls and fatal traps. These form the trusted boundary.

## Declaration and authority

Use a finite compiler-owned intrinsic registry with stable operation IDs, signatures,
effects, host availability and lowering rules. Proposed source modules live under
`tint:internal/`; the exact package spelling is not a public API commitment.
Recognition follows resolved declaration identity, never a function's spelling.
Renaming an import preserves its identity; shadowing it does not create an intrinsic.

A build manifest names the trusted runtime modules and capabilities they need.
Ordinary application modules cannot acquire authority by writing `declare`, copying
an interface, naming a file `runtime.ts`, or importing an arbitrary intrinsic.
Dependency traversal checks these permissions, including indirect calls. Changing
the manifest is an explicit change to the trusted code base, not a sandbox boundary
against somebody who controls the entire compiler build.

Opaque machine/region/reference-token types have compiler-recognized identities.
Their TypeScript declarations support checking under the development toolchain;
Tint's verifier enforces the additional rules. No `as`, non-null assertion, generic
instantiation or ambient declaration may fabricate one. Runtime descriptors are
compiler-emitted constants, not source-created objects that assert arbitrary layouts.

## Machine words

Use opaque `U32`, `I32`, `U64` and target-sized `USize` inside trusted lowering code.
These are not new meanings for ordinary `number`. Version 0 operations are:

- Checked conversion from Number: require finite integer, correct range and exact
  representability; otherwise return an explicit failure. Converting a wide word
  back to Number also requires exact representability.
- `u64FromParts(lo: U32, hi: U32)` and extraction of its two halves.
- Equality, unsigned ordering, bitwise operations, and logical shifts with counts
  explicitly masked to width minus one.
- Explicit wrapping add/subtract/multiply, and checked add/subtract/multiply for
  sizes/offsets. Size overflow must never wrap into a successful allocation.
- Bit reinterpretation between binary64 and U64 for serialization/representation
  work; numerical conversion is a different operation. Do not promise preservation
  of engine-dependent NaN payloads across Node/native execution.

Signed operations are added only for a concrete consumer such as a host result or
relocation range check. Specify division/shift/overflow rules before adding them;
never inherit the host CPU's exceptional behavior accidentally.

Node represents wide words as opaque pairs of 32-bit halves initially. Native
lowering uses machine words. Neither arbitrary pointers nor 64-bit image addresses
pass through a JavaScript Number. Ordinary binary writers can accept low/high halves
and use standard byte views; they need not depend on opaque native addresses.
This avoids requiring language-level BigInt for self-hosting without excluding it
from later language coverage.

## Raw regions and memory operations

A `Region` owns a byte allocation with a length, access permissions and live/dead
state. A `Slice` is a bounded borrow with an owner, offset and length. Neither is a
managed object reference or a freely constructible integer address.

The initial operation families are:

- `regionAlloc(size, alignment)`: obtain uninitialized raw storage or failure;
  no managed allocation or collection. The native adapter uses its raw allocator.
- `regionRelease(region)`: release owned storage and invalidate derived slices.
- `regionSlice(region, offset, length)`: checked range calculation, including
  overflow. Range/alignment failure returns failure before touching memory.
- Byte loads/stores and explicitly endian-selected 16/32/64-bit and binary64
  loads/stores. Unaligned buffer access is supported through safe lowering;
  native pointer fields require their declared alignment.
- Byte copy with memmove overlap semantics, fill, and checked subrange operations.

Loads require initialized bytes. Stores establish initialization for their range;
allocation does not implicitly make bytes valid. Debug implementations track lifetime,
bounds and initialization. Native code may remove checks only under a verified proof
or a documented trusted-kernel obligation. Raw-memory misuse is an internal failure,
never a new unchecked feature of ordinary strict TypeScript.

Do not store managed references in untraced regions using integer/byte stores.
Managed reference slots use the operations below. Raw-address extraction exists
only within a foreign-call or kernel borrow scope and is not a general conversion
to Number/U64. The checker rejects escaping these scoped values through returns,
closures, globals or heap storage. Raw resource ownership that is not statically
proved remains a trusted invariant, with debug checks and explicit cleanup; these
rules do not claim a complete linear type system.

## Managed allocation, references and roots

Generated ordinary allocations call TypeScript runtime routines. Their allocator
uses raw regions and free lists, triggers collection only at permitted safepoints,
and returns storage for a compiler-known descriptor. The descriptor records size,
alignment, field trace kinds and conditional/union tracing.

The compiler/runtime handshake contains these operations:

- Reserve managed storage for a verified descriptor; initialize all traceable state
  safely before linking the object into the collector's visible heap.
- Publish a rooted managed reference only after initialization. Recursive object
  construction uses valid null/empty states and roots, not visible garbage slots.
- Load/store a reference or general value with its descriptor. Stores participate
  in the collector protocol even though the first non-moving collector has no
  generational barrier. Do not bake permanent barrier absence into semantic IR.
- Push/pop shadow roots, initialize/update root slots, and publish result-state
  changes according to the [call contract](call-contract.md).
- Enter a safepoint with complete root metadata. The verifier checks all potentially
  live references, including environments, temporaries and exceptional paths.

Root operations are normally compiler-generated, not handwritten throughout runtime
source. Trusted collector access uses opaque reference tokens that cannot be forged
from numeric bits. The collector may inspect headers and trace slots under its
own non-reentrant phase; it must not call ordinary allocating APIs to do so.

A scoped borrow may expose managed backing bytes to a known non-reentrant host call.
Root the owner and forbid resizing, storage generalization or other invalidation
while the borrow exists. Non-moving collection alone does not establish backing
storage stability. Unknown/reentrant calls cannot use this narrow borrow protocol;
they require an explicitly designed pin/copy/foreign-handle adapter.

## Foreign calls and terminal failure

`foreignCall(importId, arguments)` refers to a statically verified manifest entry,
with fixed widths, calling convention, variadic layout where applicable, effects
and result/error interpretation. It does not accept an arbitrary symbol string or
raw function address from ordinary source. Target adapters implement their platform ABI
rules independently from Tint's internal ABI; Darwin is only the first mapping.
Import manifests, raw allocation and native publication are target-specific under
the [platform portability contract](platform-roadmap.md).

The initial file/memory imports return low-level status and errno information without
allocating. Higher-level wrappers construct structured failures after restoring a
safe managed execution state. The collector and allocation-failure path cannot
recursively allocate errors, strings, arrays or result wrapper objects.

Choose an initial OOM policy: after permitted collection and retry, unrecoverable
allocation failure terminates the standalone process through a non-allocating fatal
path. A static diagnostic is best effort. OOM is not initially a catchable language
exception, and fatal failure does not promise finally execution. Ordinary language
throws and file errors still use normal cleanup. Embeddable libraries must supply
a host fatal policy before being supported; they must not silently terminate a
foreign process. The precise future recoverable-OOM contract is deferred.

## Effects and verification

Every operation records memory reads/writes by region or managed storage, possible
managed allocation/collection, language throw, host interaction, reentry, and
termination. Operation ordering must preserve these effects and ordinary language
evaluation order. Unknown calls are conservative.

Trusted `noGC`/`noReentry` summaries are verified transitively for defined functions;
recursive groups are checked together. Foreign summaries are explicit assumptions
in the reviewed import manifest. A `noGC` function cannot call ordinary allocation,
format a diagnostic, construct an error object or invoke an unknown callback.
Raw allocation may fail or terminate but does not trigger managed collection.
These are compiler metadata/contracts, not arbitrary user-authored type predicates.
Intrinsic success/failure products use caller-owned scalar/union slots, not implicit
heap allocation. Ordinary source object construction still counts as allocation
unless verified lowering eliminates it; a noGC annotation cannot wish that away.

Verifier failures include mismatched widths, incorrect result descriptors, missing
roots, unchecked offset overflow, uninitialized published slots, escaping borrows,
forged descriptor/reference tokens and forbidden calls in collector code. An intrinsic
is not a bypass around exceptional control flow or the caller-owned result ABI.

## Node execution versus emitted runtime

The build graph distinguishes code executed by the compiler host from code emitted
for the target. Both hosts parse/check target runtime source; Node does not execute
native startup, mmap, tracing of native pointers or foreign ABI adapters to compile it.
Runtime descriptors are computed from layouts; they do not require executing target
constructors at build time.

Word and byte-region operations have Node reference implementations using pairs,
byte buffers and opaque handles. Those implementations are test/build adapters,
not a second compiler. Native-only calls reached from the Node build graph are a
build-time diagnostic, not silent stubs. Never return dummy pointers under Node.

Later JIT operations reserve a code arena, apply relocations, change write permission,
synchronize caches and publish an entry. Reserve these capabilities in the design
but do not implement them as self-hosting prerequisites. They consume the same
backend/link graph as file output.

The [IR/verifier contract](ir-contract.md) defines the checking stages for these
obligations; [heap/root descriptors](heap-descriptors.md) define the proposed memory
schemas the operations manipulate.

## Acceptance requirements

Use Node/native differential cases for word arithmetic and region bytes, and native
fixtures for root/host behavior. Cover carries, overflow, all shift boundaries,
endianness, overlapping copies, invalid slices, double release, use after release,
initialization, forced GC during construction, borrowed-buffer invalidation and
allocation failure injection. Negative verifier cases must reject forbidden effects
and forged capabilities before machine code is published.

Maintain one registry entry and tests per intrinsic. New operations require a concrete
consumer and an explanation of why ordinary TypeScript or an existing primitive is
insufficient. Exact IDs, declaration files and lowering encodings are implementation
work; the operation families and obligations above define the intended boundary.
