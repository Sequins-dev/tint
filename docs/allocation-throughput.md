# Allocation throughput toward a one-minute self-build

Status: a two-space copying runtime and inline allocation fast path are integrated;
the generational runtime now passes complete self-build validation. The latest verified
complete retained native self-build profile captured 311.32 seconds, still far from the <=60 second
acceptance target. Native mapped-memory evacuation, compaction and generated-code relocation
fixtures pass. A full copying-runtime self-build passed byte comparison and stage2 smoke
validation; details are in [benchmarking](benchmarking.md).

## Evidence and cost model

The full `relocation-primitives-full-run.pb.gz` profile attributes 60.03% cumulative
samples to allocation, including 35.87% to collection. `place` accounts for 19.73%
cumulative; inventory snapshotting 16.79%, including radix sorting at 10.59% flat.
These categories overlap and must not be added. Sampling percentages are not
independent elapsed-time measurements. Even eliminating the entire sampled
allocation subtree would leave roughly 282 seconds under a simple fixed-work
model. We need both a different allocation architecture and subsequent compiler
optimization; GC alone cannot credibly promise the one-minute target.

In the earlier relocation-primitives baseline, every ordinary allocation called a generated callback, validated a numeric
result, searched general free extents, updated per-object descriptors and possibly
search indexes, and returned through a general result ABI. Collection inventoried
allocations, sorted them and located references in that inventory. Compaction helped
fragmentation but retaining this whole mechanism for nursery objects would retain
much of the measured cost. Adding more full-capacity arrays to the existing 96M
allocation-capacity policy would also increase control-memory pressure substantially.

## Lessons from other runtimes

V8's `MainAllocator` fast path checks available linear allocation space and advances
the allocation top. Its compiler folds compatible allocations into one reservation.
This amortizes checks and enables removal of some initialization barriers. The
important boundary is a cheap fast path versus an out-of-line refill/GC path.

V8's documented default young collector copies reachable survivors; its alternative
MinorMS policy shows that moving collection is not the only way to combine young
collection with linear allocation. SpiderMonkey also separates a nursery from its
tenured heap and uses allocation-site survival observations to avoid repeatedly
promoting predictably long-lived objects. These policies do not infer longevity
from a type annotation or from a single function return.

WebKit's published JSC design instead describes size-class blocks, with local free
cells and shared block metadata. It is a useful alternative for old or pinned
objects: a cheap small-object allocator does not require moving every object.
The architectural lesson is amortized page/block management, not an obligation to
copy the same collector or its historical tuning constants.

Sources checked for this design:

- [V8 allocator source](https://github.com/v8/v8/blob/main/src/heap/main-allocator-inl.h)
- [V8 allocation folding](https://github.com/v8/v8/blob/main/src/compiler/turboshaft/memory-optimization-reducer.h)
- [V8 collector policies](https://github.com/v8/v8/blob/main/docs/heap/garbage-collection.md)
- [V8 barrier requirements and elimination](https://github.com/v8/v8/blob/main/src/heap/WRITE_BARRIER.md)
- [SpiderMonkey GC](https://firefox-source-docs.mozilla.org/js/gc.html)
- [SpiderMonkey pretenuring](https://firefox-source-docs.mozilla.org/js/how-we-optimize.html#pretenuring)
- [JSC allocation and GC design, 2022](https://webkit.org/blog/12967/understanding-gc-in-jsc-from-scratch/)

## Proposed Tint policy

1. **Remove allocations where proved unnecessary.** Scalar replacement first;
   bounded stack/caller-owned storage where alias and lifetime proofs permit.
   The nursery handles remaining uncertain lifetimes without requiring proofs.
   Returning a reference does not itself establish a bounded lifetime.
2. **Allocate small managed objects from a nursery with an inline fast path.**
   Check `size <= limit - top`, reserve aligned bytes, initialize the object, and
   publish its root before any safepoint. No generic callback, extent search,
   sorting, or per-object general-allocator descriptor on this path. Failed
   reservation invokes an out-of-line slow path and reloads roots afterward.
3. **Collect young objects independently.** Trace stack/global roots and remembered
   old-to-young edges; evacuate survivors using forwarding information and discard
   the dead nursery in bulk. Cost includes roots and remembered edges as well as
   survivors; a large root set is not free. Start stop-the-world and single-threaded
   to target total build throughput before concurrency and pause-time engineering.
4. **Keep a separate old/large-object policy.** Use the existing region allocator
   for backing pages/large buffers, not each small nursery object. Initially promote
   survivors conservatively, then measure survival and copying cost before choosing
   one or multiple nursery ages. Consider size-class old pages if profiling warrants
   them. Large typed-array backing stores should bypass routine nursery copying;
   their headers and views still need ownership, tracing and relocation rules.
5. **Tune from observed allocation sites.** Count allocated bytes/objects, survivors,
   promoted bytes, refill calls, collection time, root/remembered-edge work, and peak
   resident/control memory across the complete build. Pretenure consistently surviving
   sites only after representative measurements. AST and IR lifetimes cross compiler
   phases; type names alone do not justify putting them directly in old space.

The allocator contract belongs in shared IR/runtime semantics. AOT and dynamic
native compilation select the same allocation and barrier operations. A backend
may emit the proven fast sequence directly; it does not introduce a second compiler
or a C intermediary. Unsupported/unproved allocations keep a correct slow path.

## Correctness and representation gates

- Nursery address-range membership is not sufficient proof of an object start.
  Use compact object-start metadata or a representation that proves exact starts.
  Existing object headers/descriptors provide layout information; checked object
  extent decoding should be shared by scanning, evacuation and diagnostics.
  Avoid reconstructing and sorting an allocation inventory for minor GC.
- Establish separate page and object contracts. The general region allocator owns
  pages; the nursery owns objects within them. The old collector must not interpret
  a nursery page as one ordinary object or independently sweep its objects.
- Every reference-bearing mutation must participate in the generational barrier:
  record fields, tagged payload stores, closure cells/environments, list/map backing
  storage, runtime helpers and bulk copies. Numeric typed-array stores need no
  reference barrier. Strict-profile pointer maps allow static barrier elision;
  live-profile tagged values need a tag test or conservative recording.
- Start with a bounded remembered structure and explicit overflow handling.
  A dirty-card table is attractive because stores can mark without allocating, but
  scanning cards requires object-start metadata for objects spanning card boundaries.
  Never silently drop edges; a full minor collection cannot compensate by ignoring
  old objects. Promotion must establish any new old-to-young edges too.
- A fresh-object initialization barrier may be omitted only while the object is
  known young and no intervening safepoint can promote it. Allocation folding must
  not expose uninitialized headers to a collector, change exceptions, or cross
  unproved calls/safepoints.
- Update aliases, stack roots and derived typed-array pointers consistently.
  Maintain raw payload bits during copies. External/FFI pointers require pinned
  storage or handles; they cannot silently follow managed relocation.
- Reserve evacuation capacity before mutation and define promotion failure/OOM.
  A failed preflight leaves the heap intact. A failure after relocation starts must
  not return to the mutator with a partially updated graph.
- Keep collector control state outside the moved heap. Size workspace by nursery
  pages and measured live/reference needs, not the historical total allocation cap.
  The whole-heap transactional fixup plan remains useful for validation/major
  compaction; it should not force scratch proportional to all historical objects
  into every nursery collection.

## Verifiable implementation order

First establish object extent/start metadata and a reusable bounded linear
reservation primitive, with overflow/exhaustion and randomized invariants. Then
validate evacuation of small graphs, cycles, tagged references and nested views,
including promotion failure. Add remembered-edge/barrier coverage before enabling
minor-only tracing in real programs. Integrate the generated allocation fast path
and run stress fixtures that collect at every eligible slow path. Add allocation
folding and broader escape/caller-storage optimization as separate IR passes.

Keep the existing mapped-memory and generated-root compaction tests. They now test
real native memory moves, cycles, closures, strings and nested typed-array views.
They do not prove completeness of the future write barrier or nursery collector.

After each meaningful enabled change: a serial Node/native subsystem comparison,
then a complete profiled self-build, byte-identical stage comparison and generated
compiler smoke execution. Report failed runs separately. Keep the <=60 second goal
active until a complete correct native build actually meets it; do not extrapolate
a microbenchmark improvement into an unmeasured build time.

The first prerequisites are now implemented: `@tint/native-runtime/allocators/linear` provides
checked, allocation-free range reservation with failure preservation, and
`nativeObjectExtent` decodes managed object sizes from existing headers without
an inventory. Focused tests include uint32 boundaries and randomized disjoint
reservations. The hosted collections fixture compiles both helpers to native code.
The compiler project now selects `initializeCopyingRuntime`. It uses the linear
allocation policy and survivor-only evacuation, with the original callback ABI
still in place. This transitional collector exchanges two whole-heap spaces;
it does not yet have an old generation, remembered-set maintenance, pretenuring,
or inline allocation. Large arrays are still copied. It is a measurable step
away from per-object general allocation and inventory sorting, not the final
nursery policy. The 3 GiB compiler mapping is unchanged, so each active space is
1.5 GiB. Workspace views reuse existing startup storage rather than adding another
set of maximum-capacity arrays.

The broad collections fixture needs just over 2 MiB of simultaneous inventory
arrays. Its initial 4 MiB mapping failed after being split: debugger diagnostics
showed 1,575,984 surviving bytes followed by a 524,320-byte request, exceeding the
2 MiB active space. Its test mapping is now 8 MiB to preserve the original 4 MiB
active budget. That fixture passes under the copying runtime. This adjustment is
not a compiler heap increase or evidence of a performance gain.

## Inline allocation contract

The copying runtime now shares an eight-word Uint32Array with optional inline
allocation code. Words 0/1/2 are the semispace-relative cursor, capacity and active
semispace base offset. Word 3 is reserved. Bytes 16..23 hold a native pointer to the
start bitmap, written only by the trusted publication operation; remaining words
are reserved. Both arrays live in permanent control storage. The context extension
at byte 56 is initially null and points at this state only after validation.

Allocation producers already establish positive, aligned uint32 extents. The fast
sequence compares size with capacity minus cursor, advances the cursor, sets the
object-start bit, and forms the managed pointer. It neither calls the allocator
nor crosses a safepoint. Object initialization and root publication still precede
any subsequent safepoint. Absence of published state or exhaustion branches to the
existing checked allocation callback. Collection reads the same cursor and
publishes live bytes and the toggled semispace base before resuming allocation.
The runtime factory and collector are compiled without this fast path.

`BuildRequest.inlineAllocation` can disable the optimization. The default enables
it for the copying runtime; other runtimes retain the ordinary path. The emitted
module advertises its context requirement. Native controls prove that ordinary
allocations can succeed with a throwing slow callback, that disabling the fast
path invokes that callback, and that repeated collection still relocates live
objects correctly. The complete `inline-allocation-v1` self-build and stage2 smoke
passed; its profile spans 420.03 seconds. See benchmarking for evidence and limits.

## Generational implementation contract (in progress)

The next policy retains the existing two mapped semispaces. Within the active
half, old objects occupy a prefix and a bounded nursery occupies a fixed suffix.
A minor collection promotes reachable nursery objects into free old space. A
major collection evacuates the complete active half, including both generations,
into the opposite half and packs survivors into its old prefix. This avoids a
second allocator, a second tracing implementation, and an increase in mapped heap
capacity. The nursery is bitmap-aligned and reduced for small test heaps. The initial
32 MiB proposal has been tuned to a 256 MiB cap and a one-quarter semispace limit;
full-run measurements are recorded in `ir-evolution.md`. Large requests go directly to old
space. A major collection is required when promotion's worst-case reservation
does not fit. Survivors must leave room for the next nursery; failure is explicit.

`createNurseryEvacuator.prepareRange` is the first implemented prerequisite. It
accepts disjoint subwindows of the configured mappings, indexes start bits relative
to the enclosing mapping, and reuses the same forwarding/fixup workspace as whole
collections. Tests promote a nursery within one mapping, then perform a whole-window
collection with the same evacuator. Invalid ranges fail before reading memory.
This primitive alone does not enable generational collection.

Before enabling the policy, generated managed-field writes must record old
objects that may acquire young references. This includes record writes, managed
cell writes/initialization, tagged general fields, and initialization of objects
allocated directly in old space. Numeric-only fields need no barrier. Root slots
remain covered by the root-chain scan. Mutator raw-memory capabilities cannot be
silently treated as barrier-safe. Dirty objects must be scanned using their current
tags and descriptors, not stale reference slots.

Use the existing unused `marks` workspace for a dirty-object bitmap and `roots`
workspace for a bounded queue of dirty object offsets. A newly dirty object is
queued only once. Queue exhaustion must set an overflow flag and fall back to
scanning the complete dirty bitmap; it must never discard an edge. No allocation
is allowed in the barrier or collection callbacks. Minor collection promotes all
survivors initially, so successful repair leaves no old-to-young edges and permits
clearing the remembered set. More nuanced aging can follow measurement.

The implemented generational publication extends the allocation state to sixteen
uint32 words, retaining the existing context pointer and young allocation fields:
young top/limit/base at words 0/1/2, old top at 3, native young-start pointer at 4/5,
generation flag and old-prefix capacity at 6/7, native dirty-bitmap pointer at 8/9,
native dirty-queue pointer at 10/11, queue count/capacity at 12/13, and overflow at 14. Word 15 is reserved. Publication must validate buffer sizes and initial state
before enabling either the fast allocator or write barrier. The existing copying
runtime remains available and must keep generation flags disabled. The ABI, emitted leaf barrier and opt-in
`initializeGenerationalRuntime` now pass native fixtures. Minor collections promote
all nursery survivors; major collections pack the complete graph into the other
semispace. The nursery is capped at 256 MiB and one quarter of a semispace.
Large slow-path allocations go directly
into old space and are remembered before initialization. The initial policy requires
major survivors to fit the old prefix and reports exhaustion rather than silently
shrinking the reserved nursery.

The native fixtures exercise both collection paths, old-to-young record and captured
cell mutations, nested typed-array views, and a remembered queue limited to one entry.
Controls throw when minor or major collection is reached; disabling generated barriers
makes the mutation fixture trap under LLDB. The standalone leaf harness checks status
register preservation, deduplication, overflow, and active-semispaces independently.
The mutator compiler rejects raw-memory mutation capabilities and borrowed reference
environments that lack a barrier contract. Runtime internals compile separately.
The `generational-v1` full self-build passes byte comparison and stage2 smoke;
its complete profile capture is 318.26 seconds. The compiler now selects this runtime
by default. Copying remains available for comparisons and smaller integrations.
The one-minute goal remains unmet.
