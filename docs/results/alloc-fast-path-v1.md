# Generational allocation fast path

24 November 2026, macOS arm64 (M5 Max). Stacked on
[collection costs off empty capacity](collect-capacity-v1.md) (`ceead4773`).
Two changes:

- **No nursery start bits** (`4b9ecaca8`). The fast path no longer sets them.
- **Precomputed nursery address** (`612a13cc0`). The fast path forms the
  object's address with one load and one add.

## What read the nursery's start bits

Every inline allocation set its object's start bit, and every minor
collection cleared the nursery's bits again. Only two things read those bits:

- a major collection that compacts a non-empty nursery, when its survivors
  cannot fit the old prefix;
- the heap tools (`tint_heap.py`, the heap snapshot graph).

The nursery is bump-allocated without gaps, so both now walk it by object
extents:

- **Compaction.** It first records the nursery's starts with
  `recordObjectStarts`, which throws if the extents do not end exactly at
  the young top. Compaction clears every start bit it passes, so the bits
  are zero again afterwards.
- **Heap tools.** Descriptor version 3 walks the old prefix through its
  start bits and the nursery by extents. `verify-heap-tools` checks that the
  nursery's extents chain from its base exactly to its top.
- **Copying runtime.** It keeps its bits: its semispace is compacted through
  them.
- **Old space.** Its bits are unchanged (evacuation, direct-old allocation,
  compaction).

`tools/native-gc-nursery-fallback.test.ts` forces the compaction through the
nursery walk with serial marking (4 MiB heap) and with pool marking (32 MiB).
LLDB counted 5 such compactions in each, and both checksums match Node.

Minor collections also stop clearing nursery bits. At a 256 MiB nursery that
clear took about 1.3 ms per minor collection; it took 155 µs at 32 MiB
([phase records](worker-runtime-collection-costs-v1-phases.txt)).

## The fast path, instruction by instruction

The generational inline allocation, from loading the context to the object's
address in a register. Counts are read from the disassembled records kernel
on arm64 and from the emitter on x86-64.

| Step                        | arm64: main | no start bits | + address | x86-64: main | no start bits | + address |
| --------------------------- | ----------- | ------------- | --------- | ------------ | ------------- | --------- |
| Context, state, null check  | 3           | 3             | 3         | 2            | 2             | 2         |
| Large-object threshold      | —           | —             | —         | 8            | 8             | 8         |
| Limit check, bump, store    | 7           | 7             | 7         | 5            | 5             | 5         |
| Start-bit read-modify-write | 9           | —             | —         | 9            | —             | —         |
| Form the address            | 4           | 4             | 2         | 3            | 3             | 2         |
| **Instructions**            | **23**      | **14**        | **12**    | **27**       | **18**        | **17**    |
| Loads / stores              | 8 / 2       | 6 / 1         | 5 / 1     | 8 / 2        | 6 / 1         | 5 / 1     |

x86-64 loads the state without a null check. Its threshold row includes the
limit load that its limit check reuses. Both backends load the context from
the frame first.

## Results

**Frozen v7** (`--runtime-tree` images of the capacity fix and of this
stack, 15 paired rounds with the order alternating; load median 6.9, max
11.4; runs in [alloc-fast-path-v1-v7.txt](alloc-fast-path-v1-v7.txt)):
neutral. Instructions fall 0.5% in every round, but cycles stay within the
noise.

| Metric       | Capacity median | Stack median | Paired stack/capacity: median (quartiles) | Stack lower in |
| ------------ | --------------- | ------------ | ----------------------------------------- | -------------- |
| Cycles       | 340.5 G         | 341.5 G      | 1.0015 (0.9867–1.0257)                    | 6/15           |
| Wall         | 81.20 s         | 77.94 s      | 1.0030 (0.9559–1.0683)                    | 7/15           |
| Instructions | 1617 G          | 1609 G       | 0.9950 (0.9946–0.9951)                    | 15/15          |
| Peak RSS     | 2.227 GB        | 2.226 GB     | 0.9998                                    | 11/15          |

**Allocating feature kernels** (native images: the capacity fix, the stack
without the precomputed address, and the stack, 15 rounds with the order
rotating; load median 4.4, max 6.5; results in
[alloc-fast-path-v1-kernels.txt](alloc-fast-path-v1-kernels.txt)).
Cycle ratios against the capacity fix per round: median (quartiles).

| Kernel        | Capacity cycles | No start bits          | + nursery address      | Instructions (stack) |
| ------------- | --------------- | ---------------------- | ---------------------- | -------------------- |
| records       | 7.27 G          | 0.9930 (0.9831–1.0202) | 0.9970 (0.9773–1.0185) | 0.9999               |
| collections   | 9.04 G          | 0.9705 (0.9672–0.9788) | 0.9684 (0.9626–0.9792) | 0.9944               |
| strings       | 3.53 G          | 0.9897 (0.9744–1.0060) | 0.9829 (0.9692–0.9930) | 0.9732               |
| serialization | 4.59 G          | 0.9735 (0.9652–0.9852) | 0.9647 (0.9588–0.9771) | 0.9558               |
| pipelines     | 4.71 G          | 1.0185 (1.0110–1.0311) | 1.0047 (0.9929–1.0162) | 0.9994               |
| closures      | 1.04 G          | 0.9839 (0.9736–0.9892) | 0.9891 (0.9701–1.0058) | 0.9569               |

Peak RSS falls 1.0–1.7% in every kernel, because the nursery's start-bit
pages are no longer touched. Removing the start bits takes 1–3% of cycles
off the kernels that allocate most.

The precomputed address takes a further 0.2–0.9% off collections, strings
and serialization. Records and closures move 0.4–0.5% the other way, within
their quartiles. Pipelines measured +1.9% without the address, with
instructions unchanged. The full stack brings it to +0.5%, inside its
quartiles.

**Checks** (tree `85f028929`, the same as the head):

- Codegen, native-runtime and build-capability unit tests: 691/691.
- Collector native fixtures, 18/18 under LLDB: the nursery-walk fallback
  (serial and pool marking), plus the capacity PR's 16 on the copying
  collector, the generational collector and its parallel paths.
- `verify-heap-tools`: descriptor version 3; the old start-bit walk and the
  young extent walk match the collector.
- Native compiler subset check; Node-built stage 1, then native stages 2
  and 3: stage2 == stage3.
- The copying runtime's emitted bytes are unchanged (the emission-options
  image digest).
- x86-64 runs in CI only (Linux x86-64 job).

## Going further: absolute cursor and limit

The precomputed address is the smallest version of this idea. Two larger
versions would remove more of the fast path:

| Option                                              | arm64 | x86-64 | Removes                                      |
| --------------------------------------------------- | ----- | ------ | -------------------------------------------- |
| Precomputed nursery address (built)                 | 12    | 17     | the managed base load and one add            |
| B: absolute u64 cursor and limit in the state block | 9     | 15     | the address load and add; `sub` → `add`      |
| C: absolute cursor and limit in the hosted context  | 7     | 14     | also the state pointer load (and null check) |

**B** makes the fast path: load cursor, load limit, add, compare, branch,
store; the object is the old cursor. Its costs:

- **Runtime.** Six sites in `generational.ts` read or write the young top
  as an offset. They would convert through the nursery address. The
  exhaustion flag (top set to capacity) becomes cursor equal to limit.
- **Publication.** It would check cursor equal to the nursery address and
  the limit equal to it plus the nursery capacity, on both backends.
- **x86-64 threshold.** It derives the large-object threshold from the
  limit word, so it would need the capacity, or better a precomputed
  threshold, in another word.
- **Diagnostics.** The arm64 allocation-sampling thunk lowers and restores
  the limit relative to the young top, and the forced-collection probe reads
  the young top. Both would change to absolute values.
- **Heap tools.** Descriptor version 4: `tint_heap.py` derives the young top
  (cursor minus base) and arms sampling with an absolute limit. The snapshot
  graph and DevTools plugin read the derived top, so they only check the
  version.

**C** also removes the state pointer load: an unpublished context would hold
cursor = limit = 0, so every request takes the slow path. But the runtime
would have to write the context, which only a new memory intrinsic could do.
Every context producer (main, Worker, test harness) on both backends would
change, and heap tools would read the cursor and the rest of the state from
two places. Not recommended.

**Recommendation: do not build B or C now.** Removing nine instructions
with a dependent read-modify-write moved the allocating kernels by 1–3%.
The precomputed address removed two instructions and one independent load,
and moved them by under 1%, mostly within the noise. B would remove three
more instructions and one load off the cursor's dependency chain, so its
effect would be smaller than the address's, below what these runs resolve.
Its cost touches the runtime, both backends' publication, the arm64
diagnostics and the heap-tools format. It is worth revisiting only after
other fast-path work (header initialization, the x86-64 threshold) makes
allocation sites hotter.

**x86-64 parity.** x86-64 computes the large-object threshold,
max(128, young capacity / 4), on every allocation: 8 instructions. arm64
has no threshold, so its fast path also bump-allocates large objects that
fit the nursery. A minor collection evacuates them correctly, at the cost of
copying them once. A precomputed threshold in reserved word 15 would cut
x86-64 to about 12 instructions. Adding the same check to arm64 would cost
3 (load, compare, branch). Whether arm64 should route large objects to old
space is a measurement question, kept apart from this change.
