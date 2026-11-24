# Collection costs off empty capacity

24 November 2026, macOS arm64 (M5 Max). The fix is `7fb69dd25` on main
`183ec7044`, with `ceead4773` adapting `verify-heap-tools` to it. The
investigation looked for the fixed cost of a generational collection: work
that scales with heap capacity rather than with live data.

## Breakdown

A scratch timing patch
([worker-runtime-collection-costs-v1-timing.patch](worker-runtime-collection-costs-v1-timing.patch))
timed each collection phase with the host clock. It is not part of any image.
The program churned 4, 32 and 256 MiB nurseries with serial and parallel
marking, holding 256 small arrays live, then forced a major collection with
the nursery half full and another with it empty. The records are in
[worker-runtime-collection-costs-v1-phases.txt](worker-runtime-collection-costs-v1-phases.txt).
They were measured on the Worker stream's branch (`5e489f8f0`), whose
collector code is the same as main's.

Two costs scaled with capacity:

- **Forced major, nursery not empty.** The compactor covered the whole span
  up to old capacity plus the young top, including the untouched gap above
  the old fill. Its live-bit clear, offset pass, forwarding and packing ran
  over every bitmap word: 4.0 M words at 256 MiB, against 129 words for the
  same live data with the nursery empty. With 32 KB live, it took 43 ms at
  256 MiB (parallel marking) and 4.9 ms at 32 MiB.
- **Bitmap clears.** The nursery's start bits (every minor collection), the
  compactor's live bits and the dirty table were cleared with `fill`, which
  stores element by element. The nursery clear took about 20 µs per minor
  collection at 4 MiB, 155 µs at 32 MiB and 1.3 ms at 256 MiB.

Everything else per collection was small and did not scale with capacity.
Holding and releasing the collector and clearing the remembered set took at
most a few microseconds each, after a one-time hold of about 0.1 ms at the
first collection.

## Fix

- A major collection while the nursery holds objects first evacuates the
  nursery (an ordinary minor collection), then compacts only the packed old
  prefix. A nursery whose survivors cannot fit the old prefix still compacts
  in place. The pages released afterwards are the same.
- Bitmap clears use `set` from a permanent zero block, one copy per 2 KiB.
  Typed `fill` codegen is a separate item for the codegen stream.

## Results

**Forced majors** (scratch probe, 15 repetitions: 3 runs of 5; records in
[worker-runtime-collection-costs-v1-e2e.txt](worker-runtime-collection-costs-v1-e2e.txt)),
median ms:

| Nursery | Major, nursery half full | Major, nursery empty | 12 nurseries of minor churn |
| ------- | ------------------------ | -------------------- | --------------------------- |
| 4 MiB   | 0.63 → 0.16 (−75%)       | 0.069 → 0.061        | 16.6 → 16.7 (+0.3%)         |
| 32 MiB  | 4.05 → 0.50 (−88%)       | 0.072 → 0.063        | 131.2 → 126.8 (−3.3%)       |
| 256 MiB | 31.5 → 2.35 (−93%)       | 0.075 → 0.067        | 1062 → 1037 (−2.4%)         |

**Frozen v7** (`--runtime-tree` images of main `183ec7044` and of the fix,
15 paired rounds, base first in each; load median 4.6, max 13.6; runs in
[collect-capacity-v1-v7.txt](collect-capacity-v1-v7.txt)): neutral to
slightly better.

| Metric       | Base median | Fix median | Paired fix/base: median (quartiles) | Fix lower in |
| ------------ | ----------- | ---------- | ----------------------------------- | ------------ |
| Cycles       | 325.2 G     | 324.2 G    | 0.9908 (0.9841–1.0092)              | 10/15        |
| Wall         | 70.33 s     | 68.58 s    | 0.9861 (0.9577–1.0199)              | 11/15        |
| Instructions | 1622.0 G    | 1616.0 G   | 0.9960 (0.9960–0.9961)              | 15/15        |
| Peak RSS     | 2.227 GB    | 2.227 GB   | 0.9999                              | 11/15        |

**Allocating feature kernels** (native images of main `183ec7044` and of
the fix, 15 rounds with the order rotating; load median 3.6, max 4.3; via
`/usr/bin/time -l`; results in
[collect-capacity-v1-kernels.txt](collect-capacity-v1-kernels.txt)).
Ratios are fix/base per round: median (quartiles).

| Kernel        | Base cycles | Cycles                 | Wall                   | Instructions |
| ------------- | ----------- | ---------------------- | ---------------------- | ------------ |
| records       | 7.20 G      | 1.0066 (0.9891–1.0193) | 1.0072 (0.9869–1.0165) | 1.0000       |
| collections   | 8.80 G      | 1.0226 (1.0214–1.0276) | 1.0232 (1.0173–1.0367) | 0.9962       |
| strings       | 3.54 G      | 0.9961 (0.9873–1.0211) | 0.9973 (0.9911–1.0209) | 0.9940       |
| serialization | 4.65 G      | 0.9807 (0.9703–0.9953) | 0.9837 (0.9630–1.0011) | 0.9879       |
| pipelines     | 4.74 G      | 0.9924 (0.9828–1.0015) | 0.9920 (0.9789–1.0118) | 0.9955       |
| closures      | 1.05 G      | 0.9839 (0.9793–1.0032) | 0.9894 (0.9814–1.0169) | 0.9907       |

**Collections: +2.3% cycles, not in the collector.** The kernel keeps
almost nothing live in a 32 MiB nursery, so it runs only minor collections.
The only fix it reaches is the faster nursery clear, and it retires 0.4%
fewer instructions. pprofessor profiles of debug-symbol builds (5 runs each,
999 Hz, all threads) put the allocator and collector at a median 15 ms per
run on main and 8 ms with the fix, about 1% of the 1.5 s main thread. The
extra cycles are in mutator code (map and set operations) that the fix does
not change. The measured image's text is exactly one page (4096 bytes)
larger, and in the debug-symbol builds the program's functions moved by
exactly 4096 bytes: each keeps its in-page alignment but not its page. The regression is consistent with a page-level placement
effect (instruction cache or branch predictor aliasing), not proven. The
stacked start-bitmap PR measures collections at 0.968 of this fix, about
1% below main.

**Gates on main** (fix `7fb69dd25`, tools `ceead4773`):

- Collector native fixtures, 16/16, under LLDB: compaction (small and large
  heaps), granules, released semispaces, stack maps, weak cells on the
  copying collector, the generational collector and its parallel paths,
  safe-for-space and block forwarding.
- `verify-heap-tools`: passes after `ceead4773`. The collector has no
  `if (minor)` line any more, and inside `collect` the young and old tops die
  at the evacuation call, so LLDB cannot read them there. The tool now breaks
  in `evacuateNursery` after its first call, where both are homed and nothing
  has moved yet.
- Native compiler subset check; Node-built stage 1, then native stages 2
  and 3: stage2 == stage3.
