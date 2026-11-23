# Nursery first-touch cost: rejected early-collection policies

23 November 2026. This experiment tried to remove the cold-heap cost of a
1 MiB string clone run alone in a fresh process (see the
[transport results](worker-runtime-transport-v1.md)). Every policy that
removed it also regressed the frozen compiler workload, so none landed.
The collector is unchanged.

## The cost

- Each 2 MiB UTF-16 string bump-allocates into the 32 MiB nursery.
- Until the nursery first fills, every such allocation first-touches about
  128 fresh 16 KiB pages, two per round trip on the critical path.
- An isolated run took about 5,500 page faults and one collection per
  isolate.
- Fresh `mmap` calls, large-packet cache misses and frequent collections
  were ruled out.

The cost is paid once per isolate, until its nursery has been used once. A
run that exchanges large messages for longer reuses warm pages; in the full
transport suite the 1 MiB clone was 0.89× Node on macOS. An isolated run is
short enough that most of its samples fall inside this warm-up.

## Policies tried

Each was built into the frozen v7 workload with `--runtime-tree`, from the
same tree at `550fa5d3a`. Runs were paired with the unchanged collector
(`wr-base`) under the timing lock. Every output matched Node's byte for
byte.

| Policy                                                                                                                                            | Rounds | Cycles | Instructions | Peak RSS |  Wall |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | -----: | -----: | -----------: | -------: | ----: |
| Soft limit: inline allocation stops at a lower limit (8 MiB, growing with survival), so all allocation collects earlier                           |      4 | +2.63% |       +2.26% |    −2.6% | +1.5% |
| High water: only a ≥256 KiB request that would touch fresh pages collects first, once 8 MiB are warm; off after a collection that keeps over half |      4 | +2.13% |       +2.14% |    +1.1% | +0.9% |
| The same, never re-enabled after a major collection releases pages                                                                                |      3 | +1.34% |       +2.14% |    +1.0% | +0.1% |
| The moving limit alone, with early collections disabled                                                                                           |      3 | +0.33% |       −0.01% |     0.0% | +0.4% |

Cycles and wall are noisy at this size (one limit-only round ran 1.3%
slow). Instructions are stable to 0.02% across rounds and decide.

- The soft limit also failed the weak-slot parallel GC test (exit 13). A dead
  weak key stayed reachable in the old generation because small objects were
  promoted earlier. No live data was lost.
- The moving limit itself costs nothing. The 34.7 billion extra
  instructions come from the early collections: the compiler makes frequent
  ≥256 KiB requests, so the high-water policy holds its nursery near the
  warm size for the whole run. That means more minor collections and more
  promotion. Survival in those collections stays under an eighth, so neither
  the growth rule nor the off switch engages.
- Re-enabling after majors made no difference, so the cost is not the refill
  after a major collection releases nursery pages.

**Isolated 1 MiB clone.**

- Seven rounds, rotated among the unchanged collector, the last high-water
  variant and Node 26.13.1.
- Three samples of five round trips each per run.
- Native runs were under LLDB; all 42 native runs stopped at entry and
  exited 42.

| Image                | Median µs per round trip | Ratio to Node |
| -------------------- | -----------------------: | ------------: |
| Node                 |                    147.3 |         1.00× |
| Unchanged collector  |                    447.8 |         3.04× |
| High water, no reset |                    299.3 |         2.03× |

## Why it was not pursued further

- Collecting early trades a one-time fault cost per isolate for more
  frequent minor collections for the rest of the run. On the compiler that
  costs about 2% of instructions, against a few milliseconds of faults saved.
- State word 1 (the young limit) is also the heap-debug sampler's contract.
  It saves the limit the runtime published as the nursery capacity
  (`packages/abi/src/heap-debug.ts`). A limit the runtime keeps moving would
  need that contract changed.
- A policy limited to an isolate's first few nursery fills would avoid the
  long-run cost. It would only help short-lived isolates, and needs the
  sampler change above.

The remaining isolated gap is warm-up plus the per-hop copy volume set by the
UTF-16 string representation. The transport results record it.
