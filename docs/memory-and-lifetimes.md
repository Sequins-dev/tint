# Shared memory and lifetime contract

Status: accepted baseline direction for strict/AOT and live/runtime compilation.
Native programs now execute precise root tracing and pressure-triggered mark/sweep.
The self-hosted compiler uses that collector. Fragmentation observed in complete
build attempts motivates the [relocation plan](gc-relocation.md); compaction is not
yet enabled.

## One runtime contract

Use one precise, initially single-threaded, non-moving mark-and-sweep collector
per runtime instance. Strict and live modules within that instance share objects,
roots, descriptors, and allocation APIs. There is no mode boundary for GC and no
boxing requirement merely to keep a strict object alive.

Separate instances have explicit ownership; references cannot cross heaps as raw
managed pointers. Sharing requires a defined handle or copying protocol. The Node
bootstrap host uses Node's memory management for its own compiler execution; the
collector described here runs inside generated Tint programs.

ECMAScript sets the observable identity/liveness requirements but does not prescribe
this collector. Future weak-reference and finalization support must respect its
specific semantics and must not promise deterministic collection. See the pinned
[memory-management reference](https://tc39.es/ecma262/2025/multipage/managing-memory.html).

## Single mutator, collection on request

Each heap has exactly one mutator, and a collection starts only when that
mutator requests one (an allocation that does not fit, or an explicit forced
collection). The collector never runs while the mutator executes: there is
no concurrent or incremental marking, sweeping or evacuation. Parallel
workers are allowed inside a stop-the-world collection, which the requesting
mutator joins and waits for.

C "leaf" FFI calls rely on this: while managed code is inside a call that
cannot allocate or reach a safepoint, no object it holds can move or be
reclaimed. GC work that would break the invariant (concurrent or incremental
marking, background compaction, a second mutator on one heap) must be
flagged and must come with a replacement contract for leaf calls (pinning or
handles).

## Layout-independent tracing

The [heap and root descriptor proposal](heap-descriptors.md) defines concrete header,
trace-plan, initialization and shadow-record schemas beneath this lifetime contract.
The [IR verifier](ir-contract.md) checks their use through lowering.

All managed allocations carry or otherwise resolve to a tracing descriptor. The
descriptor describes physical references, not the declared TypeScript type:

- Fixed strict records: offsets of managed reference fields.
- Finite unions: current variant plus the reference locations in that payload.
- Dynamic values: actual representation/category identifies references.
- Dynamic objects: shape, prototype, and current backing storage.
- Arrays/collections: initialized elements/entries and associated metadata.
- Closures/cells/modules: environments, binding values, and relevant code metadata.

Scalar fields require no tracing. A declared `number` does not authorize ignoring a
reference after live-mode generalization; the descriptor must track actual storage.
Runtime shape/layout descriptors must themselves remain alive while referenced.
Static descriptors can have image lifetime; dynamically created ones need managed
lifetime or explicitly owned metadata regions.

Begin with typed slot/array/tagged-payload descriptions rather than arbitrary
user-code tracing callbacks. Collector tracing never invokes getters, proxies,
user finalizers, or allocation-producing application code.

## Collection points and triggers

Distinguish permission to collect from a request to collect:

- A safepoint is a compiler-established state with complete roots and consistent
  object layouts.
- Allocation pressure requests collection; it does not permit scanning an arbitrary
  interrupted instruction.

Initially collect synchronously on managed allocation's slow path, before returning
new storage. Track both managed payloads and owned external backing bytes, plus
code/metadata pressure. Do not collect on every allocation in normal operation.
After collection, derive the next threshold from surviving size plus growth headroom
and a floor; the constants are tuning choices, not ABI or language behavior.

On a failed allocation, try collection and reclaimable-cache trimming before retrying.
Enforce an instance limit if configured. Terminal OOM behavior is an explicit host
policy: the [intrinsic proposal](trusted-intrinsics.md) selects non-allocating fatal
termination for the first standalone compiler and leaves embedding policy separate.

Requested embedder/diagnostic collection runs only at an established boundary, or
is deferred to the next one. Allocation-free loops need not poll GC initially.
Later interruptibility, code invalidation, or incremental collection can introduce
additional poll sites without changing source semantics. Once weak APIs are added,
job-scoped keep-alive obligations also constrain collection and observation.

All potentially allocating or reentrant calls are safepoints. Unknown calls are
conservatively treated this way. The IR effect annotation must cover allocation
hidden in error construction, property accessors, host callbacks, and runtime helpers.

## Weak cells

A weak cell (marker 7, 40 bytes: a header whose flags say weak or ephemeron,
then key and value tag/payload pairs) holds its key weakly; an ephemeron also
holds its value exactly as long as its key. Every moving collector implements the
same rule: weak slots are not traced in the strong closure; afterwards an ephemeron
whose key survived traces its value, to a fixpoint; then a dead key clears both
pairs and a weak cell drops its value pair. Per collector:

- **Copying** (Cheney): weak slots defer as they are copied; the fixpoint and
  clearing run over the copied slots.
- **Generational, minor**: serial minors (under 4 MiB of nursery, one CPU,
  or no room for the pool's buffer waste) follow the Cheney rules above for
  slots copied out of the nursery; parallel minors link each copied slot
  into its copier's lists and run the fixpoint as rounds on the collector
  pool
  ([parallel weak slots](parallel-gc.md#weak-slots)). Keys never change after
  creation and every survivor of a minor is promoted, so a promoted cell's
  key is old and alive for a minor; a promoted ephemeron whose value is
  stored later is remembered by the ordinary write barrier (emitted on
  `weak-slot-set-value`) and scanned strongly.
- **Generational, major** (mark-compact): weak slots mark as objects without
  their key and value; the ephemeron fixpoint marks values of live keys until
  nothing new is marked, dead keys clear, and the forwarding phase rewrites
  surviving pairs. A parallel mark records each marked slot per worker and
  runs the fixpoint as pool rounds; a full list or mark stack falls back to
  the serial fixpoint over every live slot.
- **Region** (`initializeRuntime`, non-moving mark and sweep): no weak
  processing yet. Weak slots are traced strongly, so a weak cell's key (and an
  ephemeron's value) lives as long as the cell and never clears.

Weak cells do not change which generational collector paths a program takes.
External storage (`tint:ffi`'s `external`) registers views through weak cells,
so it works under every collector. Native tests: `tools/native-weak.test.ts`
(young targets dying young, promoted targets surviving and dying in majors,
ephemeron values reachable only through the cell, values stored into promoted
cells, ephemeron chains, explicit clears) under the generational and copying
runtimes, including a 128 MiB heap whose minors and majors run on the pool
with tens of thousands of cells, ephemeron chains and cycles spread over the
workers (a debug build of it asserts, through LLDB breakpoint hit counts,
that the parallel ephemeron rounds and clearing ran), and
`native-tracing-compact.test.ts` for the compactor's rules.

## Roots and function handoff

Stack roots use precise per-safepoint stack maps ([GC stack maps](gc-stack-maps.md)):
each call that may collect lists the frame words holding live references and
tagged values, and collectors walk the frame-pointer chain to find them. The
compiler stores register-homed references to their frame words before each
potentially collecting operation; stale register values are not independently
scanned. Dead words are never listed, so dead temporaries do not retain graphs.

Roots also include module state, globals, active jobs when supported, host-owned
handles, pending completions, active compilation jobs, and active code-version
metadata. Compiler AST/IR graphs in a live compiler use the same heap as user data.

Accepted logical handoff protocol (see [Call contract](call-contract.md)):

1. The caller roots the callee/environment/receiver and all reference arguments,
   including already-evaluated arguments before evaluating subsequent ones.
2. The callee establishes its frame before its first allocating operation.
3. Reference-bearing return/throw values use caller-owned, pre-registered result
   storage initially. The callee publishes there before removing its own roots.
4. The caller reads that result and moves it into normal local roots before the
   next safepoint. Normal and exceptional paths obey the same rule.

No global singleton return slot: recursion and reentrant calls need distinct result
storage. Exact registers/stack fields remain target-ABI work. Proven leaf calls
can later omit unnecessary machinery without changing this logical contract.

Finally/iterator cleanup can allocate, so pending return/throw values remain rooted
during cleanup. If cleanup replaces the completion, update roots accordingly. A
failed argument evaluation must unwind the partially populated caller roots safely.

During initialization, make header/reference fields traceable before any safepoint.
Root partially constructed objects before invoking allocating initialization helpers.
Do not let collection see an uninitialized tag paired with arbitrary payload bits.

## Collector kernel and raw storage

The trusted kernel obtains raw regions through the native host adapter. Proposed
initial organization: reusable blocks for small objects, separately tracked large
allocations, and region accounting independent of the managed heap graph. Exact
size classes are deferred.

Mark worklists, free-block metadata, and emergency failure state use raw storage
whose growth cannot call the managed allocator. Trace iteratively to avoid consuming
the native call stack on deep compiler graphs. If worklist space cannot be extended,
do not sweep from an incomplete mark; fail safely or use a defined non-allocating
completion strategy.

All mutator execution in the instance is paused during tracing/sweep. No user code
runs in that interval. Initial mark/sweep therefore needs no incremental/generational
write barrier. Still express managed stores explicitly in IR so future barriers can
be inserted centrally. Type/layout invalidation guards are distinct from GC barriers.

Sweep unreachable storage into reusable blocks and return empty regions when useful.
Non-moving collection preserves addresses but can fragment memory; measure both
live bytes and committed/resident size. Do not claim minimum RSS immediately after
objects die. Stop-the-world relocation is now the next memory-management direction
following measured fragmentation failures; see [the relocation gates](gc-relocation.md).
Generational collection and separate arena APIs remain deferred.

## Live layout generalization

Use the same collector when a warned type mismatch widens an object's representation.
A candidate initial strategy is stable live-object identity plus replaceable backing
storage. Strict objects can retain direct fixed fields. This indirection choice is
proposed, not yet a frozen object layout.

A generalization transition roots the identity object, new value, and old/new backing
stores while constructing replacement storage. It coordinates code invalidation,
state recovery, and the publication of the new shape/backing reference. No collecting
or reentrant operation may observe inconsistent tracing metadata.

Backing-pointer publication is a short non-collecting operation after allocations
and preparation. Old backing storage is reclaimed only when no managed/active-state
reference needs it. Keeping old storage alive does not make stale reads or writes
semantically valid: affected optimized frames must deoptimize or use guards before
accessing the logical object again.

Avoid retaining untracked interior pointers across safepoints/calls that can change
layouts. Retain an owner reference and offset, then rederive the address. A non-moving
collector does not prevent dynamic backing stores from being replaced or resized.

## Native code and compiler metadata lifetime

Code pages require an executable-memory allocator, but use the same reachability
principles and explicit ownership. Do not scan machine instructions for pointers.
Code-version records enumerate embedded managed constants, dependencies, root maps,
deoptimization data, and owned executable regions.

Root a version while it has active frames, a selected function entry, direct-call
dependencies, or exported callbacks/foreign entry handles. Replacing the entry
redirects future calls; it does not permit freeing old active frames' instructions
or metadata. Deoptimization must retain both source and destination state until
handoff finishes.

Treat the code registry as an allocation inventory rather than a permanent strong
root for every version. Otherwise no old code can die. Once a retired version has
no incoming execution/dependency ownership, reclaim its metadata/constants and
release its code region when no other live version shares the page. Cyclic metadata
dependencies must not be made permanently live by a naive reference-count-only rule.

Initial AOT code can simply have executable-image lifetime. Detailed dynamic code
reclamation follows self-hosting; there is no need to unload the first compiler's
static functions. Compilation caches should be bounded/explicitly evictable, not
accidental eternal roots.

## Foreign calls and external resources

Foreign handles root managed objects until explicitly released and identify their
owning instance. Borrowed references remain rooted for the call; host-retained
references need durable handles. Foreign calls that can callback require a rooted
entry scope before leaving Tint. Initially allow callbacks only on the instance's
owning thread, with proper nested root frames.

Non-moving storage alone does not make borrowed buffer pointers safe: resize,
detach, or replacement can invalidate them. A borrowing API must prevent those
operations for its documented lifetime, copy, or reject incompatible usage.

Separate memory reachability from deterministic resource ownership. File handles,
locks, and other scarce host resources should use explicit close/release plus
try/finally initially. The file-read/write host helpers should close their internal
handles on every path, so compiler source normally receives bytes rather than a
long-lived descriptor.

When disposal syntax/protocols are supported, follow the selected specification's
cleanup ordering and failure semantics rather than inventing destructor behavior.
See [DisposeResources](https://tc39.es/ecma262/multipage/abstract-operations.html#sec-disposeresources)
as a living-spec reference, not an implicit bootstrap feature requirement.
Finalization callbacks are not a correctness mechanism for closing required resources.
Never invoke user disposal code as an ordinary sweep callback.

Explicit instance shutdown first prevents new work and requires no active frames,
callbacks, or foreign handles under the initial contract. Close owned host resources
through defined teardown, then release heap/code regions. Unloading cannot silently
invalidate pointers still retained by a host. More permissive shutdown is later work.

## Validation and implementation order

1. Build raw regions, descriptors, shadow roots, and stop-the-world tracing for the
   strict self-hosted compiler. Test cyclic graphs and forced GC at allocations.
2. Exercise argument evaluation, nested returns/throws, cleanup, callbacks, and
   allocation during object initialization. Verify liveness and root-chain restoration.
3. Add live generalization and versioned code metadata after self-hosting, reusing
   the same roots/tracing. Test GC during preparation and code-version handoffs.
4. Add foreign handle tests and explicit resource-close tests; measure repeated
   compilations to expose roots/caches that unintentionally retain old graphs.

Collecting at every eligible allocation is a test mode, not the production schedule.
Check reclamation/accounting directly, not just absence of crashes. Separate spec
conformance from implementation stress tests. Host-side layout, marking, root, and block-reclamation tests now cover part of this
contract. Forced native GC and compiler handoff tests remain unimplemented.

The [target contract](macos-arm64-target.md) proposes host imports and result slots;
the [intrinsic contract](trusted-intrinsics.md) proposes region operations and a
non-allocating fatal OOM path for the standalone compiler. Remaining details include
descriptor encoding, thresholds/limits and live backing-store transition layout,
plus implementation validation of those proposals.
The proposal deliberately shares the lifetime contract without requiring identical
value encodings or identical code-page allocation in both modes.

## Bounded storage implementation

`@tint/native-runtime/allocators/region` now manages aligned reusable blocks with externally supplied
uint32 metadata. `markIndexedGraph` in native-runtime/graph consumes caller-supplied mark bits
and a bounded worklist, with no per-traversal object construction. The existing
descriptor planner remains an allocating reference implementation. Native wiring
still requires raw OS regions, noncollecting descriptor readers and inventory,
control-state lowering, and compiler roots; these modules do not yet execute as a
native collector. Tests compose completed plans with actual block reuse under Node.
