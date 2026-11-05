# Heap, tracing and root descriptors

Status: version 0 design with initial contracts implemented in
[storage-layout](../packages/storage-layout/README.md),
[trace-plan](../packages/trace-plan/README.md) and
[gc-tracing](../packages/gc-tracing/README.md). Layout and tracing/marking tests run
under Node; native descriptor serialization, allocation, root lowering and collection
are not implemented. The schemas are portable; offsets and byte
encodings are produced by target layout, not copied from the compiler host.

## Reference and object layout

A managed reference points to the start of an allocation header. Null is a zero
pointer in the initial target mapping; language null/undefined remain distinct
values in their applicable representations. Interior pointers are scoped borrows,
not general managed references.

Proposed header: descriptor pointer followed by a target-word flags field. Initially
flags contain the collector mark bit; reserved bits start zero. Object allocation
extent, free-list ownership and region membership live in allocator side metadata,
so a corrupted or invalid descriptor cannot authorize an out-of-bounds scan. Validate
membership before dereferencing a traced candidate in checked builds.

Payload offset is the header size rounded to the layout's payload alignment. Total
allocation size includes the header, trailing payload and allocator rounding. For
the first 64-bit target, use a 16-byte header and 16-byte allocation alignment;
normal supported payload alignments are at most 16. These are target defaults,
not constants in the portable collector or IR. Record them in TargetDataLayout.

References preserve identity across ordinary calls and collections. A layout change
cannot merely overwrite a descriptor pointer if the existing bytes do not match it.
Live object generalization uses a stable identity object and replaceable backing
storage, with both old/new representations rooted during preparation.

## Descriptor schema

A layout descriptor has a format version, layout ID, fixed payload size/alignment,
optional trailing-storage specification, and a trace plan. Field access metadata may
share the layout ID but does not have to live in the collector's trace table.
Use explicit byte offsets relative to payload/slot bases; do not infer them from
source property order or TypeScript type names.

Store descriptors in immutable raw metadata regions registered with the instance.
AOT descriptors may reside in the image. Initially retain dynamically produced
layout metadata for the instance lifetime: simple and safe, but account for its
memory separately and bound growth. Finer descriptor reclamation is later work.
No metadata region can be freed while an object, root, code version or another
live descriptor depends on it. This policy does not require retaining obsolete
machine-code bytes forever.

Logical descriptor references are IDs until linked. Native publication resolves
them to addresses and applies required relocations; serialized files never contain
pointers into the build process. The Node compiler stores the same schema as ordinary
records. Runtime descriptor addresses are raw metadata pointers, not managed edges.

Trace plans contain a small, closed instruction vocabulary:

- `Ref(offset)`: nullable direct managed-reference slot.
- `Value(offset)`: general value slot; inspect its actual category and trace only
  reference-bearing payloads using the target's general-value representation.
- `Inline(offset, plan)`: fixed embedded storage with another trace plan.
- `Select(tagOffset, tagWidth, cases)`: read an internal storage tag and select an
  embedded payload plan. Include any allowed internal Empty state explicitly.
- `Repeat(dataOffset, stride, countSource, elementPlan)`: initialized variable/fixed
  elements; count is constant or a validated scalar field in the containing storage.

No operation calls user code, performs property lookup or triggers managed allocation.
Descriptor validation checks field bounds/alignment, tag cases, nonzero strides,
checked range arithmetic and legal nesting. Inline plan cycles are forbidden;
recursive object graphs traverse Ref edges instead. Use an iterative raw worklist
for both object traversal and nested plan evaluation.

A Repeat specification also identifies capacity/extent limits. At scan time validate
that initialized count fits capacity and the allocation extent before reading slots.
An invalid tag or count is a runtime invariant failure, not a request to scan arbitrary
bytes or treat everything as non-reference. Do not sweep after an incomplete mark.

## Common layouts

Fixed records trace only reference-bearing fields. Strings initially contain a
code-unit length and inline UTF-16 units, with no managed edges unless a later string
representation adds them. Binding cells include initialization state plus typed or
general storage; an uninitialized binding must not be read as ordinary undefined.
Closures trace their environment and other managed state, while native entry addresses
are handled by code-version lifetime metadata, not as heap object pointers.

Unions use an internal storage tag and an aligned payload. Select traces the active
representation; its tag is not evidence that a structural TypeScript test is true.
Optional fields use a presence state distinct from explicit undefined. An absent
reference field's bytes need not be traced, but clearing retired references is a
useful checked-build discipline and prevents accidental retention by broader plans.

Arrays use a stable owner object with length and a managed backing reference. Backing
storage has capacity, initialized extent and element storage. Initialize each newly
scannable reference/general-value slot before increasing initialized extent. Hole or
presence state governs language reads independently of GC safety. Capacity alone
must never cause scanning uninitialized bytes. On truncation/delete, clear discarded
references and update presence state without a safepoint in the transition.

Maps/sets use shared backing machinery with explicit occupied/deleted states; their
trace plans must not scan dead entries. Preserving key order is a collection algorithm
obligation, separate from its trace plan. Byte buffers may initially use managed
backing allocations, eliminating an external-memory ownership hook for that case.
If external storage is introduced, account and release it through trusted allocator
metadata, never a user finalizer invoked during sweep.

A live object owner can hold prototype, shape metadata and backing reference.
The backing's own descriptor describes actual storage. Strict objects can use direct
fields. Both participate in the same heap and Ref traversal.

## Allocation and publication protocol

An allocation request may collect before obtaining storage. After reservation, the
runtime establishes header, safe initial tags/counts and reference slots in a noGC,
noReentry interval. It registers the allocation as traceable and returns a reference
through the rooted call/result protocol. It cannot expose random reference bits.

Constructors that need allocating helpers first root this safely initialized object.
Write scalar/reference fields using managed operations. Internal Empty states are
permitted only where the descriptor supports them; source initialization checking
prevents application reads of incomplete state. Publishing a completed union or a
new backing/tag pair is a short noGC/noReentry transition after preparation.

This is a cooperative single-threaded protocol, not a claim that multiple stores
are hardware-atomic. Future concurrency requires an additional publication design.
Allocation may not recursively call the managed allocator to make its own metadata
or error objects. See [trusted intrinsics](trusted-intrinsics.md) for fatal OOM policy.

## Shadow-root records

Use the same trace-plan vocabulary for roots and heap payloads. A root record has
three target pointers: previous record, root descriptor and slot-base address.
A descriptor supplies the root storage extent and trace plan. The initial 64-bit
mapping occupies 24 header bytes rounded to 32 for a 16-byte-aligned frame allocation;
root slots are separately laid out and addressed by slot-base. Other targets select
their own frame alignment and offsets.

The execution context owns the root-chain head. Frame setup initializes slots and
links the record before any collecting call. Frame exit restores the prior head
on both normal and throw paths. Entry/root setup and exit are noGC/noReentry intervals.
Do not conflate this chain with the platform frame-pointer chain.

Initially use a static plan per frame with clearing of dead root slots at safepoints.
Direct slots clear to zero; general/sum/completion slots use a defined non-reference
or Empty state. The verifier requires live references to remain represented while
clearing/reusing storage. No register-only root is presumed visible to the collector.
This permits later per-safepoint plans without changing logical ownership.

Caller-owned result areas use Select on Empty/Normal/Throw state, with the normal
signature plan and general thrown-value plan. Their size and offset come from call
lowering. The [macOS result layout](macos-arm64-target.md) is the first concrete
mapping, not a portable requirement. Pending finally results have distinct storage.

Variable general arguments use a bounded Repeat root region with initialized count.
A dynamically sized region may have a separate linked root record; the callee can
borrow argv only within its lifetime. Caller roots remain live while the callee
establishes its own roots. Incoming register arguments must be materialized before
an allocating prologue/helper.

Module/global/foreign-handle roots use registered root regions with the same plans.
Ownership controls registration/removal; slots cannot outlive their region or instance.
Active code-version metadata exposes its managed constants through registered roots,
not conservative scanning of instruction bytes.

## Collector traversal

Validate descriptors before publication. At collection, enumerate registered roots,
mark reachable allocations and iteratively execute their trace plans. Use allocator
metadata to track extents and raw worklist storage. Sweep only after a complete mark;
reset/recycle mark state consistently for the next collection. Reclaim unreachable
cycles normally. Initial implementation favors correctness over compressed headers,
bitmap tricks or specialized trace machine code.

Tests must cover recursive graphs, unions changing variants, absent fields, live
backing replacement, partially initialized arrays, result/throw/finally roots,
variable arguments, descriptor bounds and malformed metadata. Force collection
at every eligible allocation in stress mode; verify reclamation/accounting as well
as survival. Test alternate target layout parameters in the compiler without claiming
native support on an unimplemented platform.

## Remaining implementation choices

Numeric tag values, descriptor binary opcode encoding, allocator size classes,
thresholds, metadata limits and debug-check configuration remain implementation work.
Freeze them in fixtures as implemented. The object/header, trace-plan and root-record
schemas above are the first concrete proposal; future changes migrate private callers
and descriptors together rather than creating a permanent external ABI.

## Current implementation boundary

The implemented trace catalog stores logical records, copies input metadata, rejects
inline dependency cycles and scans bounded memory views iteratively. Select case
plans share the enclosing base; Inline locates variant payloads. General Value slots
are expressed through Select, with explicit tag policy supplied by the caller.
Repeat includes count/capacity sources and distinguishes fixed in-region storage
from one trailing region. Variable extents cannot be nested inline in this first slice.

GC tracing returns a complete live/dead/accounting plan, never a partially completed
sweep list. The root stack enforces token identity and LIFO removal. It does not yet
write native root-chain records. Production native integration must supply aligned
memory views, canonical pointer identities and noncollecting worklist/metadata storage;
Node-hosted arrays/maps are contract evidence, not a noGC runtime allocator.

The catalog now also supports bounded reference-offset walking with caller-provided
six-word frames. It shares validation and descriptor ownership with the reference
scanner, visits only active/initialized fields, and creates no traversal objects.
Partial visits on any failure must invalidate the whole collection. Host-side tests
compose this walker with bounded indexed marking and block reclamation. Native
metadata lowering, OS region acquisition and compiler roots remain unimplemented.
