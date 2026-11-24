# @tint/codegen/aarch64/scalar

Direct native emission for the verified scalar IR subset. Depends only on scalar-ir
and the AArch64 encoder. No AST, operating-system services, executable format,
external assembler/linker, interpreter or upstream compiler dependency.

`emitModule(module, options = {})` verifies its input, plans scalar storage
and the Tint typed ABI, selects instructions, resolves local branches/direct calls,
and returns owned code bytes plus function metadata. Metadata includes IDs, names,
export markers, byte offsets/lengths, frame sizes and parameter locations.
`helpers` separately reports any shared numeric kernels appended after those functions. The code
is position-independent; copy the whole buffer without changing internal distances.
A caller can compose it with the existing Mach-O publisher. An export marker is not
an FFI adapter or a Mach-O exported symbol.

Failures return a diagnostic (IR, unsupported operation, frame/code limit or encoding)
with applicable function/block/source span. No partial code is exposed. Invalid input
budgets fail explicitly; budgets are integral byte counts from 4 through 0xffffffff.
Input follows scalar-ir's typed, immutable-during-use contract. Allocation failures
and internal compiler invariants may throw. Empty modules emit empty code, which is
not a publishable executable by itself.

## Representations and ABI

Number slots and values use binary64 bits; boolean slots use canonical 64-bit 0/1.
Constants use standard DataView operations to obtain their exact binary64 bits.
No integer substitution or fused arithmetic changes Number rounding. All semantic
slots and block-local values initially reside in 8-byte stack locations, except
optional-number values which use 16 bytes. This direct
spill strategy leaves future allocation/promotion independent of correctness.

The emitted code implements the scalar portion of Tint physical ABI version 0:

- x0 context, x1 environment, x2 receiver, x3 caller-owned result pointer.
- Number arguments independently occupy d0–d7; booleans occupy x4–x7.
- Overflow arguments use 8-byte slots in source order at incoming SP; the caller
  rounds the outgoing area to 16 bytes. Parameter metadata reports register numbers
  or stack byte offsets.
- Every call has its own 32-byte, 16-byte-aligned result area. The caller zeros it;
  the callee writes a scalar payload at offset 16, then publishes Normal state 1 at
  offset 0 and returns state 1 in w0. Void publishes state without a scalar payload.
- All functions save x29/x30 and align SP to 16 bytes. The backend uses only
  caller-saved x0–x16 and d0–d7 as needed, plus the frame/link registers. It does not
  allocate x18, x19–x28 or v8–v15. Frame size metadata excludes the 16-byte frame record.

The current graph is closed and statically typed; owned allocations use the explicit
allocator contract described below. Context is preserved
and passed through. Environment forwarding is explicit; unused receivers are zero.
Borrowed handles and module-owned literals require external lifetime guarantees.
Calls check normal/throw completion, and literal string throws propagate. Allocating,
foreign, reentrant, catch and finally operations remain future work.

Entry adapters must supply valid argument representations, zero hidden unused inputs,
an Empty result area, and an IEEE floating-point environment (round-to-nearest ties
to even, gradual underflow, no exception traps). Current native fixtures save FPCR,
set it to the baseline zero configuration and restore it at their foreign boundary.
The backend does not silently change a host's FPCR or validate foreign arguments.
General/live guards, FFI adapters, throws and GC remain future work.

## Supported operations and limits

Constants, loads/stores, unary plus/minus/complement, truthiness/negation,
binary + - * / %, bitwise AND/OR/XOR and all three shifts,
numeric comparisons, same-type scalar equality, branches, returns and direct calls.
NaN is falsy, unordered relational comparisons are false, and signed zero is
preserved. Short circuiting, conditional expressions and loops are already CFGs.

All operations currently accepted by the scalar IR now have native lowering.
[Native Number semantics](../../docs/native-number-semantics.md) documents the shared
conversion/remainder helpers, their clobbers, correctness argument and corpus.
Frames use direct loads/stores where possible and x17-based addressing beyond the
32 KiB immediate range. Frame offsets must fit 32 bits. Branches use existing
checked immediate ranges; no veneers or relaxation are inserted. A larger function
can therefore fail explicitly rather than silently truncating a frame/branch offset.
The output budget bounds instruction bytes, not peak memory or recursion at runtime.

This pass currently combines scalar representation/frame planning and instruction
selection. It does not yet implement the full representation/machine IR, optimizer,
register allocator or a runtime. The same input/output contracts can be hosted under
Node now and a native compiler later; executable-memory publication is separate.

The trusted `executable-call-managed` host operation uses the same context and
ordinary completion/exception convention as generated calls. It passes the callback
as a raw rooted reference, initializes the 32-byte completion record and copies the
returned general payload and tag immediately after status dispatch. Its effects
remain opaque and allocating; caller roots cannot be elided. Existing borrowed
executable-call operations retain their nonthrowing ABI. This does not publish code,
authorize addresses or establish a generational tracked-write proof.

## Evidence

`pnpm check` covers deterministic emission, immutable input, budgets, shared numeric helpers,
frame limits and independently expected argument placement. The AArch64
oracle separately validates instruction encodings.

`pnpm verify:scalar-native` requires macOS arm64. It parses, checks, lowers and emits
526 source fixtures (including 8,904 batched numeric cases), publishes/signs them with
Tint, verifies signatures, executes each
twice and compares scalar outputs/native assertions with JavaScript. NaNs are compared
by category; other values and signed zero are compared exactly. Cases cover binary64 edge
values, truthiness, comparisons, snapshots, calls, recursion, loops and mixed bank
spill arguments. A test-only foreign entry/_write adapter supplies the process
boundary; the scalar source itself has no foreign call support. No external compiler,
assembler, linker or signer participates in those builds. LLVM is an optional
instruction-validation oracle only. Linux/Windows execution is not established by
these macOS tests; the core emitter has no macOS policy.

## Typed-array object ABI

An array value occupies one 64-bit slot containing a non-null descriptor pointer.
The object occupies 32 bytes, aligned to at least 8, with a 64-bit kind marker at +0
(2=Uint8Array, 3=Uint16Array, 4=Uint32Array, 5=Float64Array), flags at +8, element count at +16
(high 32 bits zero) and data pointer at +24. Flag 1 denotes caller-owned borrowed
storage. Flag 0 denotes allocator-owned buffers, with inline data starting at +32. Array arguments share x4–x7 with
booleans, then use ordinary overflow slots. Results carry the descriptor pointer at
result offset 16. Descriptor identity is array identity, so the adapter must reuse
one descriptor per object, not merely per backing address.

The trusted adapter owns both descriptor and buffer for the entire native call graph;
length and data pointer remain immutable. Length is at most 2^32-1. Nonempty data must
be aligned to the element width with at least length*width accessible bytes and no address wrap.
An empty array may have a null data pointer. Backing may be writable even through a
const source binding. No detachment, resizing, sharing/concurrent mutation, subclasses
or custom properties are allowed by this initial adapter contract. This is not a
Node/V8 object layout or a general FFI-compatible typed-array structure.

Index validation compares the original Number to its unsigned-32 conversion, then
checks length. This handles fractions, NaN, infinities, negative and large indices
without converting them into accidental accesses. All loads/stores check bounds;
no speculative or invalid-index load is emitted. Values use the existing shared
ToUint32 kernel. Source fallback branches remain lazy. Borrowed and owned array handles
participate in root publication; borrowed backing still follows its caller-owned lifetime.

Ten native fixtures cover writes/conversion, invalid indices, lazy fallback, assignment
order/result values, loops, null-backed empty arrays, aliases, returned handles and
five-array-argument calls crossing the integer register budget. Buffer canaries check
that invalid writes leave adjacent storage intact.

Math.ceil and internal truncation use FRINTP/FRINTZ binary64 instructions. Integer
testing combines equality with truncation and an explicit finite-exponent check, so
infinity cannot pass as an integer. Boolean and borrowed-array inputs produce false.
Thirty-four additional native library fixtures cover directed rounding, signed zero,
subnormals, NaN/infinities, large numbers and fill's bounds/order/identity semantics.
They execute twice with results checked against Node's standard built-ins.

## Optional-number ABI

An optional-number occupies 16 bytes, aligned to 8: Number payload at offset 0,
canonical 64-bit presence tag at offset 8 (0 undefined, 1 Number). Undefined is
constructed with zeroed payload; a present NaN is distinct and preserves its payload
bits when copied. Scalar slots retain their existing eight-byte layout.

Optional arguments use a pointer to this two-word value in the shared integer
argument stream (x4-x7, then an eight-byte stack pointer slot). The callee copies
both words immediately into its own local storage; parameter assignment never
changes caller storage. The argument storage stays alive for the synchronous call.
Optional returns write payload/tag at result offsets 16/24 before publishing Normal
completion. The caller copies both words out of its result area. No returned pointer
references a callee stack slot, and recursion has independent result storage.

Trusted entry adapters must supply aligned accessible argument records with canonical
tags and valid payloads; source compilation does not validate arbitrary FFI pointers.
There is still no general FFI adapter, allocation, throw or GC-root behavior in this
subset. Fifteen native fixtures cover optional values through calls, recursive returns,
integer-register overflow arguments, copies, equality, truthiness, Number.isInteger,
raw element reads and lazy fallbacks, including present zero/NaN/infinities.

Fourteen narrowing fixtures additionally verify early returns, branch joins, negated
and reversed guards, short-circuit tests, local updates, guarded loop bodies and
argument snapshots. Narrowing uses existing optional extraction; the native ABI and
tag layout are unchanged.

## Caller-supplied environment cells

Functions with a scalar-IR environment declaration now preserve incoming x1 in their
frame. A cell terminator reloads that payload-base pointer, passes its
transfer-slot address to the shared cell-aarch64 helper, and branches on zero/nonzero
status to its explicit success/failure block. Helpers are deduplicated by operation,
layout and mutability, appended to the code image, budgeted and relocated internally.
`cellHelpers` reports their access contracts and code ranges separately from numeric
helpers. Ordinary no-environment functions keep their existing frame layout and ABI.

x1 points at an **environment payload**, not an object header or capture table. The
caller must supply the declared extent, valid 0/1 state bytes and valid typed payload
encodings in initialized cells. Boolean values use canonical 64-bit 0/1; optional
numbers retain their existing payload/tag encoding. Borrowed typed-array cells copy
an eight-byte descriptor handle whose lifetime covers the entire family. Environment
calls explicitly forward x1 under verified matching contracts. Code generation does
not allocate environment storage. Failed cell guards branch explicitly; source literal
throws use the independent normal/throw completion protocol.

`pnpm verify:environments` emits six scalar-IR modules and executes each internally
signed binary twice. Test adapters supply shared environments to separately emitted
initialize/read/write functions. Cases cover ordinary-call register clobbering, mutable
and immutable cells, repeat initialization, uninitialized/corrupt states, booleans,
optional absence and exact NaN payload bits. Bodies and cell branches use the production
IR/backend; allocation and entry calls are hand-emitted test adapters. No automatic
source-to-native closure conversion is claimed by this gate.

The IR `trap` terminator emits `BRK #0` for an unrecoverable internal contract failure.
This is not language exception handling.

Environment calls explicitly marked `inherit` forward the saved environment pointer.
Every emitted call checks completion before reading normal payloads. Throw propagates
through the caller's result area and restores its frame. Invalid completion states
trap. `throw-literal` writes state 2 with general-value string tag 3 at result offset
16 and a literal handle at offset 24. Normal return conventions are unchanged.

The module-owned literal pool deduplicates strings, preserving UTF-16 code units,
including NUL and lone surrogates. Each handle points to a flat string object: marker
1 at +0, pinned flag 1 at +8, uint64 code-unit count at +16, and little-endian UTF-16
units at +24. Pool metadata appears in `NativeModule.strings`.
This immutable, noncollecting storage is owned by the loaded module; retain that module
while any literal handle is live. Managed string allocation/GC integration is deferred.

SSA temporaries are block-local under the IR contract, so scalar-only functions reuse
their temporary frame region between blocks. Typed slots retain separate storage across edges. Frame limits and
all result/environment/argument storage remain checked independently.

Borrowed Uint8Array, Uint16Array and Uint32Array share descriptor shape and bounds
checks; the checked element type selects 1/2/4-byte address scaling and native loads
and stores. Writes truncate after numeric unsigned conversion. Out-of-range reads
produce undefined, and out-of-range writes do not touch memory. The array IR operations
are shared; distinct element types cannot silently substitute for one another.

## Native shadow roots

Functions with managed-reference slots or reference-valued call results publish a root
frame through the runtime context's first pointer-sized field (`x0 + 0`). Callers of any
such function, including transitive callers, must supply a valid runtime context with
an initialized root head. Scalar-only functions retain their existing context behavior.

Each root frame contains the previous frame pointer and an immutable descriptor
pointer. Descriptor data is an eight-byte root count followed by eight-byte offsets,
relative to the frame header. Only reference slots/SSA values are listed. Descriptors
are module-owned and exposed by `NativeModule.roots` for linking and inspection.

Reference storage is zeroed before parameter spill and publication. Reference-bearing
functions reuse pointer and tagged-general temporary pools across blocks, separately
from scalar temporary storage. Each block clears the largest prefix any incoming
normal or exceptional edge can leave. Verified values are block-local; local slots
and the closure environment retain separate storage across edges. The exception
stub publishes a thrown payload into its handler slot before temporary cleanup.
This reduces retained garbage and frame/root-map size. Cleanup scales with incoming
values rather than every block times the largest temporary pool. Bounded slot
liveness from `@tint/ir/scalar` additionally clears locals that no successor can
read before replacement. It preserves exception-handler and loop uses and falls
back to conservative roots when its work budget is exhausted.

Scalar-only functions continue reusing their block-local temporary region.

After parameters are copied, publication completes before entering the first block.
Normal and propagated-throw exits restore the saved head before releasing the stack.
Return payload publication and caller receipt have no intervening allocation/safepoint.
Heap scanning remains a separate runtime dependency.

`pnpm verify:roots` executes four native fixtures twice each, with repeated calls inside
each run. A nonallocating native probe observes nested root chains, descriptor contents,
reference values and zeroed return temporaries. It covers register and overflow-stack
reference parameters, normal return and literal-throw propagation, and verifies the
caller's prior root head is restored. It does not claim native collection.

## Guarded record access

The backend emits null and exact-descriptor checks before a record payload load/store.
The object's descriptor pointer occupies header offset zero. Matching accesses copy an
eight-byte field (or both words of a sixteen-byte optional number) without changing its bits; failures branch before touching payload or
transfer storage. Larger field offsets use address arithmetic rather than silently
truncating an immediate. Managed-reference transfer slots participate in shadow roots.

`NativeModule.records` identifies immutable descriptors appended to the module. Each
fixed-record descriptor contains allocation byte length, reference count and reference
field offsets, all eight-byte little-endian words. Scalar fields and collector header
flags are excluded from the reference list. Descriptor identity is module-private;
structural subtyping requires explicit shape dispatch or a proven matching layout.

Record stores are nonallocating and nonsafepointing. With `generationalBarriers`
enabled, reference-bearing record stores and managed-cell initialization/mutation
invoke a shared remembered-object leaf; numeric-only fields and reads omit it.
The leaf preserves cell completion status, deduplicates through a dirty bitmap,
and signals queue overflow without dropping the dirty bit. Raw-memory mutators and
borrowed reference environments require a separate barrier contract and are rejected
in this mode. Direct old-space allocations are remembered by the runtime before
constructor initialization. Immutable fields cannot be initialized through an ordinary
write. Non-generational execution remains available without generational barriers.

`pnpm verify:records` executes guarded numeric, boolean and reference reads/writes with
adapter-owned record storage. It checks exact NaN bits, descriptor/null failures,
unchanged failed writes, header canaries and root restoration. This gate demonstrates
native access, not native allocation or source-object compilation.

## Native record construction

`record-new` invokes a trusted raw allocator through the runtime context, then initializes
the descriptor, zero collector flags and every declared field before publishing its
rooted result. There is no safepoint during initialization. Padding is not traced and
need not be zeroed. Constructor inputs and the initially-zero result slot are already
in the caller's root frame at the allocation boundary.

The current private 64-bit context prefix is:

| Offset | Field                             |
| ------ | --------------------------------- |
| 0      | Shadow-root head                  |
| 8      | Managed region base pointer       |
| 16     | Raw allocator native entry        |
| 24     | Raw allocator environment pointer |
| 32     | Managed region extent in bytes    |

The callback uses the normal private call convention, accepts one Number byte length
and returns `number | undefined`, representing a region-relative byte offset. It must
reserve fresh unpublished storage of the requested size, aligned to sixteen bytes.
Its metadata/environment are raw runtime storage; they must not depend on allocating
managed objects. Collection/retry policy belongs in TypeScript runtime code around the
raw allocator, not in an opaque compiler intrinsic. The verified initial adapter uses
the existing compiled region allocator without collection/retry.

The backend rejects missing storage, malformed offsets, misalignment and out-of-region
ranges before forming an object pointer. The host must supply an aligned, live region
whose base-plus-extent does not wrap, and valid entry/environment pointers. Undefined
allocation results and malformed kernel results currently terminate with a trap;
normal throw completions propagate and restore roots. This private standalone failure
policy is not an embedding API.

`pnpm verify:construction` compiles the unchanged TypeScript region allocator and links
it with native record constructors. A probe checks rooted inputs at the allocator
callback. The gate checks distinct object addresses, fully initialized immutable fields,
retained reference chains, unchanged earlier objects and exact allocation accounting.
Backing memory starts poisoned, and sixteen constructions fill the region before the
seventeenth allocation tests exhaustion.
A separate exhaustion executable verifies terminal failure. Both run twice. Raw backing
storage and the host root are test-adapter-owned; native collection and production host
region setup remain separate work.

The construction gate also executes source record mutation and optional-field conversions,
and composes the unchanged bytes and word64 source modules using `@tint/ts-native/modules`.
Their endian writes, result records and error paths allocate through the same compiled
TypeScript allocator. This is source-module composition within one native module;
independent native module publication and native collection remain pending.

## Native string values

String SSA values, slots, parameters, results and record fields are distinct from
opaque object references but participate in the same root-publication machinery.
Record trace descriptors include string fields. The immediate header marker 1 is
reserved for flat strings, distinct from aligned record-descriptor pointers. Pinned
module-owned literals contain no outgoing references. A future collector must retain
module ownership for these immutable values and distinguish them from managed-region
allocations; native collection is not implemented yet.

`string-length` returns a Number count of UTF-16 units. `string-code-unit` implements
numeric `charCodeAt` index conversion (NaN selects zero, fractions truncate, invalid
ranges yield NaN). Equality compares code units, with pointer/length fast paths; it
never substitutes pointer identity for string value equality. Nonallocating private
leaf kernels use the same instruction encoder and shared label assembler as numeric
kernels. Flat strings must fit within a uint32 allocation extent, which also bounds
valid code-unit indices below 2^31. No intermediate UTF-8 conversion occurs.

`pnpm verify:strings` runs 531 native cases twice against JavaScript results, including
identical contents at distinct addresses, NUL/lone surrogates, empty strings, fractions,
NaN/infinities and out-of-bounds indices. The construction gate additionally exercises
source string constants, calls, records, comparisons and character reads alongside
its real word64/bytes dependencies.

`string-concat` uses the same allocation callback and offset validation as `record-new`.
A checked 64-bit length sum determines `align16(24 + 2 * length)`; lengths greater than
`0x7fffffec` trap before allocation because the aligned extent would exceed uint32.
Allocation size survives the callback in untraced stack scratch. Inputs are reloaded
from their roots afterwards. The nonallocating `string-concat-copy` kernel accepts
x9=destination, x10=left, x11=right, preserves x9 and clobbers x12–x16/flags. It writes
marker 1, flags 0, length and exact UTF-16 units before the result is rooted. Empty
concatenations currently allocate too; padding is not exposed or initialized.

The construction gate checks nested concatenations, empty operands, NUL/lone surrogates,
surrogate pairs, source evaluation order, string record storage, immutable inputs,
managed header flags, exact 400-byte accounting and exhaustion, each twice. This is
allocation without collection: a full region traps, with no GC retry yet. Other string operations and native collection remain pending.

`string-slice` shares checked extent computation, allocation and UTF-16 copy emission
with concatenation. Its normalization leaf takes x9=source, d0=begin, d1=limit,
x10=limit-present and returns x12=bounded start, x13=count; it clobbers d0–d3 and flags.
It handles NaN, infinities, truncation, negative-relative bounds and empty ranges before
integer conversion. Start/count/extent survive allocation in untraced stack scratch.
The source root is reloaded after allocation. The copy leaf takes x9=destination,
x10=source, x11=start, x12=count; it preserves x9 and clobbers x13–x16/flags.

The construction gate compares 15 source slice cases with Node results, checks every
managed header and exact 560-byte accounting, then verifies exhaustion and root-chain
restoration. Success/exhaustion images each run twice. Cases were originally split into small source functions for the old direct-address
frame limit; the backend now supports larger frames through indirect addressing.

`string-starts-with` shares the equality kernel's code-unit comparison loop. Its leaf
ABI takes x9=source, x10=search, d0=position and returns w9=boolean, clobbering x9–x15,
d0–d1 and flags. Numeric position is clamped before integer conversion and the remaining
source extent is checked before any character read. The native string gate includes
450 prefix cases covering NaN/infinities, negative/fractional/large positions, empty
search strings, NUL and partial surrogate matches. The source construction gate also
checks omitted/undefined positions and an allocator-owned receiver.

Typed-array parameters, locals, SSA loads and call results now participate in root
publication alongside strings and records. Their object headers distinguish borrowed
external storage from eventual allocator-owned buffers. A future native collector must
honor borrowed lifetimes/flags and trace only owned allocations; native collection is
not implemented. Scalar closure environments still explicitly borrow caller-owned
array objects and cannot become owners merely because transient array values are rooted.
The old 16-byte descriptor ABI is removed, and native adapters now supply the 32-byte
header plus an initialized runtime context.

The unchanged compiled region allocator, array-capturing factory fixtures and linked
bytes construction gate use the new ABI. Reusing non-reference SSA storage lets the
allocator initializer remain within the frame bound after array root publication.
A portable regression exercises 100 scalar-heavy blocks in a reference-bearing function
with a frame smaller than 256 bytes, while keeping its reference root distinct.

`array-new` allocates owned Uint8Array/Uint16Array/Uint32Array objects through the
same checked callback as records and strings. This low-level IR operation takes an
already-normalized exact uint32 element count, validates `align16(32 + length*width)`
using 64-bit arithmetic, and traps invalid counts or unrepresentable extents before
allocation. It does not itself implement JavaScript constructor argument coercion.
The initializer writes the header and zeros the entire data/padding extent without a
safepoint, then the result becomes a root. Empty buffers have a valid one-past-header
data pointer and a 32-byte allocation. The inline data pointer is stable under the
initial nonmoving heap policy; moving collection would need to recompute it.

The construction gate adds an IR fixture allocating all three widths plus an empty
buffer through the unchanged TypeScript allocator. It checks every initial element,
integer conversion on stores, owned headers and inline pointers, zero padding, retained
previous allocations, exact 176-byte accounting per call, roots and exhaustion. Each
success/exhaustion image runs twice. Source numeric-length construction is now connected;
managed collection remains pending.

The source construction gate adds omitted/undefined/NaN/fractional/negative-fraction
lengths, all element widths, returned buffers, one-time argument evaluation, zeroed
storage, fill/iteration, record-field tracing and alias mutation. It checks exact
352-byte accounting, headers, record references and exhaustion, twice per image.
Source constructor normalization is in the common lowerer, above the checked IR
primitive; invalid length exceptions currently use the allocation trap until structured
runtime error objects exist.

## Typed-array views

`array-subarray` allocates a 48-byte view through the shared callback. Common header
fields retain their offsets; flag 2 identifies a view, whose traced parent handle is
at +32 and padding at +40 is zero. The data pointer at +24 aliases parent data plus
begin*elementWidth. The element kind is preserved. Nested views retain their immediate
parent, so a future native collector must follow the +32 edge until it reaches owned
or explicitly borrowed storage. This edge is object ownership, not a trace of the raw
data pointer. Collection itself remains pending.

Bounds must be exact uint32 values and begin+count must fit the parent's element count;
validation uses 64-bit arithmetic before allocation. Both bounds survive allocation in
untraced scratch, while the parent is reloaded from its root before initialization.
Empty/reversed source ranges still create distinct rooted view objects without reading
backing bytes. Borrowed parents retain their existing external lifetime obligation.

The construction gate runs separate byte/halfword/word view executables. Each checks
nine relative-bound cases against Node, including omitted/undefined, NaN/infinities,
fractions, negative and reversed bounds, then nested views and alias writes in both
directions. It inspects every header, data offset and parent link, exact 576/592-byte
accounting and exhaustion; each success/exhaustion image runs twice. This verifies
owner-link representation and root publication, not collection of native views.

Float64Array uses the same managed object/view headers and traced handles as unsigned
typed arrays, with kind marker 5 and eight-byte elements. Reads/writes transfer IEEE-754
payloads directly; they do not pass through ToUint32. Consequently NaN, signed zero,
infinities and subnormals survive storage and float-to-float copies. Mixed copies apply
the destination element conversion through the common copy loop. Allocation sizing and
view offsets scale by eight. Existing fixed-buffer and borrowed-lifetime restrictions apply.

Stack allocation and stack-address materialization split offsets into shifted 4-KB units
and a low immediate, repeating shifted additions when necessary. Loads/stores beyond
32760 bytes use reserved scratch x17. Native fixtures
exercise optional argument addresses above 4 KB and a rooted allocating Float64 function;
this does not claim stack probing for future platform ABIs.

Internal code/data addresses use a four-instruction PC-relative sequence with a
32-bit magnitude, supporting both directions without assuming page alignment.
This avoids ADR's one-MiB range limit; x17 is scratch and flags are preserved.
Ordinary function calls and shared numeric/string and cell-helper calls use this
address sequence in x16 followed by `BLR`. Targets remain reachable in either
direction beyond the direct `BL` instruction's 128-MiB limit. Local control-flow
branches still use conditional/unconditional branch instructions.
Explicit output budgets remain supported; the default is the supported 32-bit
byte extent rather than a fixture-sized one-MiB cap.

Presence-bearing numeric record fields use a separate one-byte tag at their declared
presenceOffset. Construction zeros omitted payloads and publishes absence; supplied
values and subsequent writes publish presence after their payload. The source adapter
uses eight bytes of aligned presence storage followed by a sixteen-byte optional-number
payload. The verifier prevents overlap with headers, payloads or other presence tags.
These scalar fields add no managed roots. The native construction gate inspects presence
bytes directly and exercises omission, explicit undefined, writes, NaN and signed zero.

Optional managed references now use zero for undefined and nonzero pointers for present
values. The backend roots their slots/SSA temporaries, transports them through register
and stack arguments/results, and traces their record payload offsets. Explicit none,
wrap and checked-extraction IR operations preserve these contracts; extracting undefined
traps before it can become a required reference. A separate optional-property presence
byte still distinguishes omitted fields from explicitly stored undefined.

The root gate now runs twelve fixtures twice: required references, present optional
references and undefined optional references, each with register/stack calls and normal
or throwing completion. Construction fixtures inspect pointer/presence bytes, verify
round-trip identity and truthiness, and check undefined extraction and exhaustion traps.
Source module-entry lowering now uses this representation for object-or-undefined values.

Optional strings use zero-or-string pointers and participate in precise roots, record
traces, register/stack arguments and result transport. Presence instructions inspect the
pointer; truthiness reads length only after a nonzero check. Equality calls the shared
string content helper only when both operands are present. None and nonzero extraction
reuse the existing raw managed-value emission path. The root-chain gate now covers 20
required/optional object and optional string argument fixtures, each executed twice with
normal and throwing returns. Separate source fixtures exercise empty strings, owned versus
literal content equality, lazy fallback, exact optional fields and string-valued maps.

Managed function values use a 48-byte allocation: descriptor at 0, flags at 8, code
address at 16, environment reference at 24, image-private permanent physical-signature descriptor address at 32,
and zero padding at 40. The descriptor traces only offset 24; code/signature words are
not managed pointers. The descriptor is appended after source record descriptors only
when function-value instructions are used. Constructors use zero for noncapturing targets and a descriptor-checked managed reference
for targets with an owned environment contract. Borrowed environments cannot escape this way. Each construction has a distinct object identity.

Entrypoint addresses are relocated by the same emitter as direct branches. Indirect
calls validate the descriptor and signature, load the environment and entrypoint, and
use BLR through x16. They share direct-call argument placement, outgoing stack space,
result areas, completion checks and root restoration. Wrong descriptors or signatures
trap before entering incompatible code. Signature identities are scoped to the loaded image; equivalent ordered scalar
parameter/result encodings share one descriptor within an image. Descriptors are
emitted only for signatures referenced by function creation or indirect calls,
and exposed through `NativeModule.signatures` (version, offset, byte length and
full scalar parameter/result types, plus the equivalent local function IDs). Version1 stores four little-endian u64
words—version, byte length, parameter count and result encoding—followed by one
u64 encoding per ordered parameter. Scalar encodings are0:void,1:general,
2:optional-boolean,3:primitive,4:string,5:reference,6:optional-reference,
7:optional-string,8:number,9:boolean,10:Uint8Array,11:Uint16Array,12:Uint32Array,
13:Float64Array and14:optional-number. These nonmoving metadata pointers are not
GC references. Identical bytes in separate images do not imply shared identity;
foreign or separately compiled function-value interchange still needs a later
linking contract. Scalar encodings do not establish semantic record-shape
compatibility.

Native fixtures cover ten numeric arguments, six string/reference/optional-number
arguments, equivalent signatures on different function IDs, tagged throw propagation,
root restoration, exact allocation/exhaustion and descriptor/signature rejection. These
IR fixtures do not yet establish source-level escaping closure support.

Owned environment pointers are published in a dedicated root slot at offset 16 within
the function's root frame, before executing body code or allocating. This root is distinct
from SSA copies and is restored through the ordinary return/throw path. The function
object traces its environment, environment records trace shared cell references, and cell
records trace managed payloads. Initialization state bytes are untraced metadata.

Managed `record-cell` accesses share the existing cell helper generator and record
descriptor guard. No separate capture allocator, object tracer or cell-copy implementation
is used. Fixtures verify factory-returned counters, shared sibling captures, independent
activations, string/object replacement, late initialization and failure guards. Native
collection/reclamation and source-level closure conversion remain pending.

`string-from-code-units` uses the shared checked string extent calculation and
allocation callback. The result is rooted, its normal string header is initialized,
and the existing ToUint32 kernel converts each numeric operand before a halfword
store keeps the low 16 bits. Conversion does not allocate. This preserves lone
surrogates and handles non-finite, fractional, negative and wrapping values. Native
construction verification covers empty and multiargument calls, argument evaluation
order and exact allocation accounting.

General-value descriptor extension: root descriptors append a general-slot count
and offsets after the unconditional-reference offsets. Record descriptors append
the same count/offset sequence after their extent, reference count and reference
offsets. Each general offset points to the tag word; the payload is eight bytes
later. Consumers must validate the full 64-bit category and trace only reference
categories. General slots are not unconditional roots. This emitted metadata still
needs production native collector integration.

Emission retains validated 32-bit instruction words instead of instruction objects.
Local branch replacements pass through the same encoder; final serialization writes
those words without encoding them again. Value metadata uses numeric interning to
support sparse safe-integer IR IDs, and private block labels use indexed offsets
including distinct slots for exceptional exits. These construction optimizations
preserve the emitted bytes and source/GC metadata.

Executable clients may provide `closedRoots` to enable whole-module record-flow
proofs. Inferred matching descriptors omit their comparison while retaining null
branches. Local constructor/dominating-guard proofs remain independently applicable.
The high-level executable driver supplies its one-shot invocation as the root; generic
native compilation and library callers do not opt in implicitly. Failed or exhausted
analysis preserves the ordinary guards.

`NativeModule.functionDescriptor` explicitly identifies the synthetic function GC
record, or is undefined when no function-brand operation exists. An ordinary
record with the same 48-byte layout and environment reference at byte 24 never
acquires that role. The two caller-authorized `native-function-descriptor` and
`native-function-signature` host leaves require that same image-local function
brand before reading byte 0 or byte 32. They expose only permanent identities,
reject zero/unrepresentable Number addresses with -1, and retain conservative
host-call effects. They add neither cross-image bindings nor managed invocation.

## Symbolic managed imports

`EmissionOptions` contains the byte budget, target host ABI, debug-span flag,
allocation/barrier settings and closed-program roots. Defaults preserve the
previous local byte output; there is no positional-argument compatibility API.

An optional version-1 `managedABI` request names a canonical function brand and
explicit indirect-call signature witnesses. Each witness names its semantic
contract and exact ordered scalar parameter/result encodings. This is a request
for later trusted authorization, not evidence that physically equal private
signatures have equal semantics. Duplicate symbols/witnesses, missing brands,
wrong encodings, unused witnesses and creating a local function with an imported
witness are rejected before code is returned.

The emitted module has `linkage: "unresolved-managed"`, aligned eight-byte ZERO
pointer slots, and `managedImports` relocation metadata. Code addresses each local
slot then loads its complete 64-bit pointer; the emitter accepts no runtime
addresses. Function creation, environment access, indirect checks and general
`typeof` all use the same requested brand. Private record guards remain local;
physically equivalent unbound functions retain private signature identities.
`functionDescriptor` is undefined for an imported brand, whose explicit role is
`functionDescriptorImport`. Ordinary record layout metadata is not a brand role.

The standard hosted AOT composer rejects unresolved managed modules, including
those in allocator/runtime positions. A separate trusted resolver must validate
permanent identities and contracts before publication; this emitter neither
resolves imports nor admits managed invocation, allocation or throwing in the
closed dynamic profile.

Function-record and version-1 signature wire numbers come from the data-only
`@tint/abi/function` contract. `nativeSignatureTypeCode` remains this emitter's
scalar-IR adapter; identity checks, layout selection and emission stay here.
