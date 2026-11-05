# GC relocation and fragmentation

Status: relocation primitives and opt-in region compaction pass native tests.
The compiler project selects a two-space copying runtime; a complete self-build
passed stage comparison and stage2 smoke validation with a 489.04-second profile. Generational collection is not yet enabled. Strict and live code share
the relocation protocol and tracing descriptors.

## Evidence and scope

The `high-placement` full self-build attempt failed at the final code buffer:
28,441,328 bytes requested including its header, 562,737,952 bytes live in a
3,221,225,472-byte region, and a largest free extent of 8,143,040 bytes. A descriptor
dump showed small live objects in every 256 MiB band. High-end placement clustered
large objects but did not stop small objects occupying the entire heap. Its full
failed-run profile attributes 59.56% of samples to the allocation path, including
34.58% in collection. These are cumulative samples, not allocation counts, and the
profile does not establish a successful build time.

Reserve space against small-object placement as an interim safeguard. This cannot
solve arbitrary fragmentation. Prefer a stop-the-world compaction slow path after
a complete mark when free bytes suffice but suitable contiguous space does not.
Do not introduce generations, concurrent tracing, or promotion as prerequisites.
Measure complete successful builds to decide whether later proactive compaction is
worth the extra work. Copying live bytes and rewriting references have real costs.

## Required contracts

- Root/object scanning reports both each reference value and its exact containing
  word. General slots report the payload word only when the tag denotes a reference.
  A visitor receiving locations does not itself authorize mutation.
- Build a forwarding map from sorted live allocation starts to aligned destinations.
  Preserve logical identity and aliases; never treat numeric payloads as pointers.
  Pinned extents constrain the plan. An unsupported layout must be pinned or reject
  compaction before any mutation.
- Validate the complete plan, source extents, writable roots, and all fixups before
  starting an irreversible update. An incomplete mark or bounded-work failure must
  leave the original heap usable. Mutation leaves are trusted, non-allocating,
  non-reentrant operations over already validated memory windows; unexpected failure
  after commit begins is fatal, not a recoverable partial collection.
- Rewrite heap edges, shadow roots, completion payloads, and any registered host
  handles. Audit all emitter safepoints for reloading moved references. Existing
  allocation sites reload rooted operands, but this is not a complete moving-GC audit.
- Owned typed arrays contain a derived data pointer as well as their object header.
  Views contain an owning reference and a derived pointer into backing storage.
  Updating only the owning reference is insufficient. Preserve owner-relative offsets
  and resolve the backing move before publishing either pointer. Borrowed external
  backing remains outside the moving region under its lifetime grant.
- Copy raw bytes with overlap-safe movement; the numeric word reader cannot copy
  arbitrary IEEE-754 payload bits. A left-compacting plan can copy objects in original
  address order, provided each individual overlapping move is also safe.
- Rebuild allocator descriptors and the search index from the new inventory only
  after references and bytes are coherent. The existing retain operation preserves
  addresses; it must not be reused as if it already supports relocation.
- Keep image descriptors, runtime control state, scratch workspaces and code pointers
  external. Future raw FFI borrows need explicit pinning or stable handles; non-moving
  collection was never a sufficient lifetime guarantee for resized backing stores.

## Verifiable implementation slices

1. Reference-slot enumeration shared with existing marking, including tagged values,
   linked root frames and array-view owner references.
2. A host-independent bounded relocation planner with overlap/pin validation and
   deterministic forwarding lookup. Test fragmented graphs, cycles and aliases.
3. Validated fixup enumeration including derived buffer/view pointers, followed by
   byte-preserving movement and inventory publication against simulated memory.
4. Native leaf bindings and forced-move tests at allocation safepoints: records,
   strings, arrays, nested views, closures, exceptions, and return handoff.
5. Integrate only after those gates; run the complete self-build under pprofessor,
   verify byte-identical stage2 output and smoke execution, then compare total time.

The first two slices are implemented independently: native tracing visitors receive
reference slots, and `@tint/native-runtime/relocation` produces bounded order-preserving plans
with pinned extents. Tests simulate overlapping moves and verify bytes and free gaps.
Native tracing also computes derived-data fixups through nested array owners,
including borrowed backing and exact offsets near the numeric address ceiling.
No collector writes or object moves occur in native execution yet. General stack-object allocation and
moving nurseries remain separate work, using these relocation contracts when ready.

Commit preparation must also account for duplicate or overlapping fixup locations.
Do not rewrite a slot, rescan it as though it still contained an old address, and
forward it a second time: old and new address ranges can overlap. Either validate
unique physical fixup locations from the descriptor contract or retain immutable
slot/new-value fixups before applying them. A partial fixup list is never a commit
plan. Derived pointers must be resolved against the original owner headers before
any owning-reference or data-pointer writes change that graph.

The raw move, fixup preparation, ordered commit and inventory publication
primitives are integrated into opt-in collecting-region compaction. Native tests
cover rooted cycles, failure atomicity, raw byte movement, and generated roots
across allocation safepoints. `moveMemory` also has an independent 93-case native
suite covering overlap, raw NaN bits, tails and rejected bounds.

The compiler's copying runtime uses a separate survivor-driven traversal over
object-start bits and forwarding entries, avoiding the region allocator's full
inventory and sort. This integration preserves explicit preflight/commit failure
boundaries and original-header derived pointer resolution. Native fixtures cover
cyclic records, remembered edges, closures, strings and nested views. It remains
a whole-heap two-space collector, not yet a generational nursery. A complete
profile and stage comparison are required before claiming improved build time.

The throughput direction is now described in [Allocation throughput](allocation-throughput.md).
Whole-heap compaction is a prerequisite/correctness path, not the proposed minor
collector: a nursery must avoid per-object extent allocation and full inventory
sorting. `verify-compaction.ts` exercises mapped-memory movement and failure
atomicity; `verify-moving-runtime.ts` enables moving collection in a small test
runtime to exercise generated roots, cycles, closures, strings and nested views.
The compiler project now selects a two-space whole-heap copying runtime;
the generic collecting-region adapter remains nonmoving unless compaction is
explicitly provisioned. Generational barriers and inline allocation remain pending.
