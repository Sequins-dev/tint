# @tint/native-runtime/allocators/region

Bounded first-fit allocation within one caller-owned region. No dependencies, OS
calls, native pointers, implicit collection, or allocation during operations.

`createRegionAllocator(byteLength, alignment, metadata)` returns an allocator or
`undefined`. Length is a positive uint32 multiple of alignment; alignment is a
power of two up to 2^30. Metadata is an exclusively borrowed Uint32Array with
three words per descriptor followed by 96 words of private search hints. Allocate
`3 * descriptorCapacity + 96` words. Descriptor capacity bounds free and allocated
extents together; the fixed hint storage does not consume descriptor slots.
Construction clears metadata only after validating its arguments.

- `allocate(bytes)` returns a region-relative offset or `undefined`; zero is valid.
  It rounds up to alignment and searches only free extents in address order.
  A bounded table remembers first-fit search progress for aligned request sizes.
  Each hint skips only a prefix already searched for that exact size. A second candidate retains progress for common colliding sizes; eviction
  only discards a hint; exact fits repair affected links, and releases invalidate all hints.
  Placement remains first-fit across interleaved sizes. Splitting consumes a recycled or unused descriptor without
  shifting live slots.
  Metadata exhaustion skips splits but still permits exact fits. Failure does not
  mutate state.
- `allocateFromEnd(bytes)` chooses the highest-address free extent that fits and
  splits from its high end. Alignment, descriptor limits, failure preservation,
  and release semantics match `allocate`. With the search index it descends
  right-first; without it, it scans the ordered free list. Both directions share
  metadata and coalescing; high-end requests do not change first-fit placement
  for subsequent ordinary requests.
- `release(offset)` accepts an exact allocated start, inserts it into the free list,
  and coalesces adjacent holes. Invalid, interior, and double releases do nothing.
- `releaseAll(offsets, length)` validates a strictly increasing prefix of allocated
  starts before mutation. It merges adjacent dead runs before sorting/compacting
  the remaining extents, then coalesces free neighbors in address order. Worst-case
  work is O(n log n), with no scratch allocation. Invalid starts, duplicates,
  unsorted input, or overlap with metadata fail without mutation. Input is unchanged.
- `allocationSize(offset)` returns rounded storage size at an allocated start.
- `usedBytes()` returns allocated bytes, excluding external metadata.

Allocation scans free extents; single release and size lookup scan descriptor slots.
Repeated allocation from a free tail is constant work, and fragmentation does not
cause scans over allocated prefixes or shifts during splitting. This is a bounded
free-list allocator, not a segregated constant-time allocator.

Each descriptor stores start, size, and state/link. Allocated state is `0xffffffff`;
free state is the next free descriptor index plus one, or zero at list end. Size
zero denotes a recycled/unused slot. Descriptor positions remain stable until a
bulk release. Treat this encoding as allocator-owned; callers use snapshots.
The trailing table has 32 entries with two candidate slots per request size, storing
the request size in alignment units,
next descriptor plus one, and previous descriptor plus one. A zero size means no
hint. Snapshots inspect only the descriptor prefix. Hints allocate no objects and
are never modified by a failed allocation. On an exact-size cache miss, allocation
can reuse the furthest prefix proven too small for any smaller request. Releases
invalidate these proofs and exact fits repair their boundaries. Distinct increasing
request sizes therefore share search progress instead of rescanning the same holes.

`snapshotRegionAllocations(metadata, byteLength, offsets, sizes)` writes a sorted
inventory of live allocations into borrowed Uint32Arrays, then verifies that the
allocated inventory and free chain tile the region exactly. It returns the valid
prefix count or `undefined`. Invalid capacity/alias requests write nothing; other
malformed inventories may leave scratch output which must be ignored. Ordering
skips sorting when allocated descriptors are already in address order. Otherwise
it uses in-place heapsort, with O(n log n) work and no allocation. The metadata
itself is unchanged. Call only while allocator mutation is paused.

Borrow metadata exclusively for the allocator's lifetime. Do not mutate, detach,
resize, overlap it with payload/snapshot workspaces, or share it concurrently.
The allocator does not obtain, initialize, poison, or release backing memory. The
host must keep the region alive and apply offsets within it. Reallocated addresses
can repeat; offsets are not durable identities. Native setup places control
objects, closures, and metadata outside the managed heap.

Tests cover deterministic churn against an independent occupancy model, sorted
inventory snapshots, descriptor stability, bulk reclamation, fragmentation,
coalescing, exact fits, metadata exhaustion, and uint32 limits. Native fixtures
exercise the compiled allocator, pressure-triggered tracing, and reclamation.

`snapshotRegionAllocations` optionally accepts a Uint32Array scratch buffer and a
Float64Array with at least 256 bucket slots. The scratch buffer must cover the live
allocation count. All buffers must be disjoint from metadata and each other;
capacity/alias rejection occurs before writes. Unordered inventories use two stable 16-bit radix passes when both the inventory
and bucket workspace have at least 65,536 entries, and four byte passes otherwise.
The passes sort descriptor indices, preserving full unsigned 32-bit
offsets and exact sizes. No allocation occurs. Without both supplied workspaces,
the original in-place heap sort remains available. On success, the scratch prefix also contains descriptor IDs corresponding to the
sorted allocations. Only a returned count authorizes use of these IDs or output
inventory; treat the IDs as valid only while the allocator is quiescent.

`releaseDescriptors(ids, count)` accepts those IDs strictly ordered by allocation
offset, validates the entire request before mutation, and merges dead extents into
the existing ordered free list. It neither searches for each address nor re-sorts
live descriptors. Coalesced slots return to the recycled-descriptor list; live
allocations keep their descriptors and addresses. Duplicate, free, out-of-range,
out-of-order, and aliased input IDs fail without changing allocation state.

`retainDescriptors(ids, count, offsets, sizes)` instead rebuilds the inventory
from an ordered subset of live descriptor IDs. It preserves allocation addresses
but invalidates every old descriptor ID. The two output arrays are scratch and
must be disjoint from the input and metadata and from one another. Validation
failure preserves allocator state, but may modify scratch. Capacity must cover
survivors and intervening free gaps. Rebuilding coalesces those gaps and bulk-clears
the unused descriptor tail; it avoids processing each dead extent individually.

`enableSearchIndex(descriptors, maxima)` optionally borrows two disjoint external
Uint32Arrays for an ordered free-extent index. It preserves first-fit placement.
Leaves name free descriptors in address order; internal nodes hold maximum free
sizes, so selection and updates take O(log n) work instead of scanning undersized
holes. Exact-fit removal finds the preceding live leaf in the same tree. The
maxima buffer needs twice the next power of two of the free-extent count; the
descriptor buffer needs one word per free extent. Insufficient or overlapping
scratch disables the index and returns false, retaining ordinary allocation.
Descriptor exhaustion also falls back to the existing exact-fit search.

`disableSearchIndex()` relinquishes the buffers. Reclamation invalidates the
index before changing descriptors; callers may then reuse or rebuild scratch.
The native collecting heap borrows its pending and offset buffers after collection
and disables the index before the next snapshot/mark. Index construction and
allocation perform no managed allocations. This avoids additional runtime memory
reservations, and uses the existing fallback when workspace is insufficient.

Indexed allocation caches a selected leaf for repeated request sizes while it
still fits. Earlier leaves only shrink, so this preserves first-fit selection.
Predecessor lookup is required only for exact-fit removal, and ancestor updates
read only the sibling and stop when the maximum is unchanged. Index mode changes
invalidate the cache because its entries have a different private encoding.

`descriptorCount()` returns the initialized descriptor prefix, including recycled
slots. A caller holding exclusive ownership can pass this as the optional final
`activeDescriptors` argument to `snapshotRegionAllocations`; only that prefix is
validated and scanned. The caller guarantees the omitted tail is unused. Omitting
the argument retains full-capacity validation. Snapshot validation still checks
that live and free extents cover the entire region. The collecting heap uses the
allocator-owned count, avoiding repeated scans of unused reserved capacity.

`allocateBelow(bytes, limit)` selects the first fit wholly below an exclusive
region-relative limit. `allocateAbove(bytes, limit)` selects the highest fit at
or above an inclusive limit. Limits are integer offsets within the region; they
need not be aligned. These operations use the same free inventory and index.
Cross-boundary free extents may be split from the selected end, but a request
that would cross its limit fails before changing state. Callers may vary limits
between requests; no space is permanently assigned to a placement class.

`replaceAllocations(offsets, sizes, count)` validates and publishes a complete new
allocated inventory. Extents must be sorted, aligned, positive, nonoverlapping,
within the region, and representable by descriptor capacity. Inputs must be
disjoint from metadata and one another. Invalid requests preserve allocator state;
success invalidates old descriptor IDs and the search index. This is a trusted
publication primitive, not a relocation transaction: the caller must establish
that object bytes and references already agree with the new inventory before
resuming allocation or mutator execution. It performs no copying or pointer updates.
