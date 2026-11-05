# @tint/native-runtime/relocation

Host-independent, bounded planning for leftward region compaction. No dependencies,
heap traversal, native pointers, writes to managed memory, or allocation during planning.

`planCompaction(input, destinations, summary)` accepts a sorted nonoverlapping allocation
inventory, byte-valued live/pinned flags, a region length and power-of-two alignment.
Offsets and lengths are uint32 region-relative quantities; every allocation has a
positive aligned size. A pinned allocation must be live. Count selects the initialized
input prefix. The caller owns the input and output views exclusively during planning.

On success (`true`), the destination prefix maps each live inventory entry to its new aligned
offset. Dead entries contain `0xffffffff`. Entries beyond count are unchanged. Survivors
retain their original order and move only left, while pinned survivors retain their
addresses. The first four words of the caller-owned Uint32Array summary report live count,
live bytes, bytes requiring movement and the largest resulting free extent. Pins can leave holes that this order-preserving policy
does not fill; this is not a globally optimal packing algorithm.

Invalid ranges, flags, capacities or output/input aliasing return `false` without
writing destinations or summary. Summary requires at least four words and must be
disjoint from every input and destination view; its remaining words are unchanged. Read-only inputs may alias one another. Validation precedes all
output writes. Time is linear in count, with constant auxiliary space beyond the
caller-provided destination and summary buffers. No allocation occurs.

The plan is not permission to move memory yet. The caller must validate and prepare
all reference/derived-pointer fixups, pinning obligations, overlap-safe copy operations
and allocator publication. Preserve old inventory and the forwarding map until those
steps finish. Never resume execution with a partially committed relocation.

Tests cover fragmentation, fixed pins, exact uint32 offsets, malformed input,
partial aliases, unchanged inputs/tails, and 300 randomized byte-preserving move
simulations checked for overlap and largest-gap accuracy.

`forwardOffset(offsets, destinations, count, oldOffset)` resolves exact starts in
a previously validated plan with logarithmic search and no allocation. Dead,
missing and interior references return undefined. Keep the original inventory
and map immutable until rewriting finishes; do not forward an updated pointer
a second time. Aliases resolve to the same destination.

`commitRelocation(request)` composes a successful forwarding/fixup plan with trusted
write, move and publication callbacks. It checks the inventory's order/alignment,
leftward nonoverlapping destinations, publication capacity, scratch separation and
writable fixup slots before mutating live memory. Publication scratch may change
on rejection. It then writes staged pointer values, moves surviving objects in old
address order and publishes the compact survivor inventory last. No allocation
occurs in this routine. Inputs and scratch must be exclusively owned and outside
moved memory and writable roots. Every staged fixup must come from successful
preflight against the unchanged original heap.

False means rejection before any callback mutation. An unexpected mutation callback
failure throws `RELOCATION_COMMIT_FAILED`; the runtime integration must terminate
rather than catch it and resume. This primitive is not yet enabled in the collector.
