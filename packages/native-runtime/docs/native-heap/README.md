# Native managed region

`createCollectingRegion` combines the region allocator, a stable allocation
inventory, and native descriptor tracing. Allocation first tries existing free
space. On pressure it snapshots live blocks, marks from the current root chain,
releases only unmarked blocks after a complete scan, then retries once. Failed
scans preserve all allocations. Invalid allocation requests do not trigger GC.

The caller maps the region and supplies its base/length, word reader, root-head
provider, external-reference policy, and all collector workspaces. Control objects,
closures, metadata and workspaces must be outside this managed region and remain
alive. Buffers are exclusively borrowed and nonoverlapping; allocation and
collection are single-threaded. Reentrant collection/allocation is rejected.
Newly allocated payload must be initialized before publication or a safepoint.
The allocator metadata contains `3 * descriptorCapacity + 96` words: three words
per extent and a fixed search-hint area. Inventory workspaces need only the
descriptor capacity. The native startup adapter provisions both areas explicitly.

This initial policy owns one region, with uint32 offsets. Cross-region managed
references require a future global inventory/collector; treating another movable
or reclaimable heap as immortal is not supported. Workspace and step budgets are
caller-supplied policy, not language limits. Exhaustion returns undefined; process
startup owns diagnostics and failure handling.

The package does not map memory, emit code, own process startup, or choose host
bindings. Node tests cover pressure, cycles, failure preservation and reuse. The
native fixture composes the policy with actual mapped memory and the same emitted
host-call operations used by the future compiler host.

After successful marking, dead offsets are compacted into the borrowed snapshot.
The allocator validates that sorted batch, orders its stable descriptor slots,
and coalesces dead extents in one pass. This takes O(n log n) work without
repeated shifts of the allocation inventory during sweeping.

Before marking, collection lends its pending-index buffer and the first 256 slots
of its address workspace to inventory radix sorting when capacities permit. These
workspaces are inactive during snapshotting; address conversion and marking rebuild
them afterward. Small or narrow-worklist configurations retain the in-place snapshot
path. This avoids a new mapping or managed allocation for sorting large inventories.

After a radix snapshot, the collector preserves its descriptor IDs in the borrowed
offset buffer before marking reuses the pending buffer. Sweep compacts dead IDs and
passes them to the allocator's validated ordered-descriptor release operation. The
allocator remains quiescent from snapshot through sweep. The fallback snapshot path
continues to use address-based release.

When fewer than half the indexed allocations survive and descriptor capacity can
represent the survivors plus gaps, sweep uses `retainDescriptors` instead.
Marking has finished, so the pending buffer can hold survivor IDs while the offset
and size arrays serve as rebuild scratch. Only complete marking authorizes this
operation. Live addresses remain stable; the next collection obtains fresh IDs.

Requests of at least 65,536 bytes use high-end placement; smaller requests use
low-end first-fit placement. The same policy applies to the retry after collection.
This clusters large buffers away from small objects to reduce fragmentation,
without reserving another heap, moving live objects, or changing tracing. It is
a placement heuristic, not a guarantee that every request fitting the total free
space has a contiguous extent available.

For regions of at least 256 KiB, the top aligned quarter is reserved against small
requests. Small allocations must fit entirely below that boundary; larger requests
may use the whole region from the high end, borrowing unused low space. This is
an asymmetric reservation, not a separate collector or a hard large-object cap.
Smaller regions retain unrestricted placement. The reservation can cause small
allocation failure despite unused reserved bytes; it does not promise freedom
from fragmentation. Moving collection is planned in `docs/gc-relocation.md`.

An optional `compaction` workspace enables stop-the-world relocation after a complete
mark. Its buffers and callbacks must be permanently available, exclusively owned,
and disjoint from collector scratch, managed storage and roots. The heap converts
mark results into a forwarding plan, prepares all fixups, commits pointer writes
and ordered moves, then replaces the inventory. The search index is rebuilt after
publication. Preflight rejection returns `relocation` without changing heap bytes
or allocated extents. Unexpected failures after mutation begins are fatal and must
not be caught by a host that resumes the mutator. Pinned flags refer to the current
sorted allocation inventory. The standalone compiler does not yet provision this
workspace or enable relocation; its safepoint validation remains a separate gate.
