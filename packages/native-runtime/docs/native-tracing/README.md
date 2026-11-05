# Native tracing

Scans Tint's emitted compact descriptors and published root frames without
allocating during a scan. Record fields, tagged general values, and typed-array
view parents contribute managed edges. Flat strings and owned/borrowed numeric
array buffers contain no managed references. Code and descriptor pointers are
external metadata, not managed edges.

The caller supplies an authorized unsigned-word reader. It must reject unmapped
addresses and words outside the exact JavaScript integer domain; pointers are
never rounded. This initial address representation supports the current macOS
address space, not arbitrary 64-bit address values. Metadata is immutable and
collection is stop-the-world. External references require an explicit identity
and lifetime grant; an unknown or interior pointer is an error.

`createNativeCollector` connects those scans to `@tint/native-runtime/graph`. Its sorted
allocation starts, sizes, root scratch space, marks, pending stack, closures, and
control objects must live outside the managed heap. All buffers are exclusively
owned and must not overlap. Each mark validates the inventory and clears previous
marks. Only `complete` authorizes sweep; reachable entries have mark 2. No storage
is released by this package. The host must preserve the inventory until sweep is
complete and must never sweep after any scan/mark failure.

The collector uses a reusable streaming marker. Each reachable allocation is
scanned once and references are resolved/enqueued as they are encountered, without
an intermediate edge list. Control closures are created during collector setup;
marking allocates no managed storage. A 128-reference regression bounds reader
work linearly, replacing the previous whole-object rescan for every indexed edge.

Native memory acquisition, word-reader capabilities, allocator inventory export,
and production sweep/startup integration remain host responsibilities.

Exact-reference lookup first rejects addresses outside the validated inventory
range unless the external-reference capability grants them. When unused `starts`
capacity is available, marking borrows that tail for lower bounds at 4 KiB address
intervals. Binary search then spans at most 256 aligned allocation starts. The
allocation prefix remains unchanged; no workspace is allocated during collection.
Insufficient tail capacity uses the full-range binary search. Boundary, gap,
interior-pointer and repeated-collection tests cover both lookup paths.

Reference visitors receive `(value, slot)`, where slot is the exact containing
word. Scanning still performs no writes. `relocateNativeArrayData` separately
calculates a future derived-data fixup through nested array-view owners using an
exact-start forwarding callback. Owned backing follows its allocation; borrowed
external backing stays fixed. Owner chains are bounded, child spans are checked,
and empty one-past views are allowed. Use only after a complete inventory/layout
validation and before mutating any original headers. These primitives do not
authorize movement or provide a transactional compaction operation by themselves.

`createNativeFixupPlanner` creates a reusable preflight scanner outside the managed
heap. `prepare` accepts a fully marked inventory (marks 0 or 2), checks its extents,
and stages `(slot, newValue)` pairs for roots, managed edges and derived array data.
It reads original headers throughout and never writes scanned memory. Scratch must
be disjoint from all inputs and scanned memory, with exclusive ownership. Capacity,
invalid forwarding, traversal or writable-slot failures return undefined; partial
scratch must then be discarded. Only a successful call's returned prefix may be
committed. The callbacks must be nonallocating and must not mutate scanned memory.
This preflight does not move bytes or publish allocator state.

`nativeObjectExtent` decodes a 16-byte-aligned allocation size from an original
object header and the existing immutable layout descriptor. It covers managed
strings, records, owned numeric arrays, borrowed array headers and view headers.
It checks the exclusive containing limit and numeric overflow without consulting
or sorting an allocation inventory. The caller must already prove an exact object
start and initialized immutable header; this helper does not prove liveness,
validate graph edges, or authorize a copy. Borrowed strings are outside this
managed allocation domain. This is groundwork for nursery evacuation, not an
already-enabled nursery collector.

`createNurseryEvacuator` preflights copying between two disjoint windows using an
object-start bitmap and a dense forwarding table. It discovers only reachable
objects, queues each survivor once, and stages fixes into future copied objects
and external root/remembered slots. No source bytes change during preparation;
unreachable headers are never scanned. A second pass resolves typed-array backing
addresses after owners are discovered. Commit copies survivors, applies fixes and
publishes last. Callback failure during commit is fatal and permanently prevents
reuse of that collector. The caller supplies exclusive nonaliasing control buffers.

`prepare(usedBytes, rootHead, reverse)` can exchange source/target roles while
reusing the same scratch. The start bitmap must describe the selected source.
Forwarding entries are cleared using only the previously discovered queue, not by
walking the entire nursery. Remembered enumeration must visit current tagged or
reference slots from old objects, not stale raw slots whose field types may have
changed. Capacity and validation failures before commit are nonmutating to the
heap; partial scratch is discarded on retry. This provides copying machinery,
not a write barrier implementation or an old-generation allocation policy.

`scanNativeObjectWithVerifiedDescriptor` and
`scanNativeRootsWithVerifiedDescriptors` consume an explicit embedding proof:
all reachable headers and immutable descriptors were published by the verified
compiler/emitter, and the mutator cannot forge headers or alter descriptor memory.
They omit repeated checks of descriptor counts, field offsets/alignment and static
extent validity. They retain authorized reads, dynamic general tags and reference
values, traversal/visitor limits, and object extent containment.
`NurseryOptions.verifiedDescriptors` selects this contract; the default remains
fully checked. The native generational runtime uses it only with the emitter's
tracked-managed-write gate, which rejects raw-memory mutators and borrowed
reference environments. Arbitrary FFI graphs and unverified images cannot claim
this capability. The copying/runtime-independent scanners retain their checks.

Nursery preparation reuses the classification produced by validated extent decoding.
Four low alignment bits of the exclusive size scratch queue temporarily hold a
header kind. All sizes are restored before successful preparation is published;
commit receives exact aligned extents. Failure may leave private scratch encoded,
but cannot authorize commit. Pointer-free objects skip redundant edge scans, while
views, vectors and records retain normal tracing and backing-address validation.
