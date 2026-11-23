# A young large-object space: built, correct, parked

23 November 2026, macOS arm64 (M5 Max). The code is preserved on the branch
`perf/large-objects-wip` (`ed12de564`), not on #15.

## What was built

Strings and owned numeric typed arrays (markers 1–5, objects without
references) of at least a threshold went to a non-moving space in the
managed region's second half, right after the nursery.

- **Allocation.**
  - Data allocation sites check a threshold word in the allocation state
    block, and their slow path passes the request plus 2^32. Every
    allocator understands the flag; the startup, copying and collecting
    allocators strip it.
  - The space allocates whole granules of 16 KiB, or the page size where
    that is larger, and keeps one object per chunk.
- **Collections.**
  - A reference into the space marks the chunk's granule, a byte store that
    is safe from parallel workers. The cheney evacuator, the parallel
    evacuator and the compactor (serial and parallel marking) all do this.
  - Minor collections free dead young chunks and make the live ones old.
  - Major collections free every unmarked chunk.
  - Weak keys on large objects, view owners and the ephemeron fixpoint (a
    separate count of large marks) are handled.
- **Pool.** Dead chunks join a bounded warm pool, and majors release it.
- **Metadata.** The tables live in workspaces the generational runtime does
  not otherwise use, because the compiler image has only 64 KiB of setup
  storage.
- **Heap tools.** Heap-debug descriptor version 3 adds the chunk table. The
  debugger tools, heap-snapshot reader and `verify-heap-tools` were updated.

**Correctness.**
- `tools/native-gc-large.test.ts` exits 42 for serial, parallel, copying and
  unaligned (non-power-of-two) heaps.
- The collector unit tests, the native weak and compaction tests, and every
  `verify-heap-tools` section pass.
- Frozen v7 output is byte-identical to the base.

Two bugs were found on the way:
- The generational state publication clears words 12–15, so the threshold
  must be written after it.
- Heaps whose size is not a power of two put the space at an unaligned
  address, where page releases fail.

## Measurements

Base `a60cd3ce7`. Each run was rotated under the timing lock.

**Frozen v7, 3 rounds.** The young budget is the dead young chunk bytes
allowed before a minor collection.

| Space configuration | Instructions | Cycles | Wall | Peak RSS |
| --- | ---: | ---: | ---: | ---: |
| 256 KiB threshold, 64 KiB granules, young budget and pool half the nursery (128 MiB each) | +0.05% | −1.4% | −2.1% | +3.0% |
| 256 KiB threshold, 16 KiB granules, budget and pool 16 MiB | +2.4% | +2.3% | +1.2% | +0.1% |
| 512 KiB threshold, otherwise as above | +2.3% | +2.7% | +1.3% | +4.1% |
| 1 MiB threshold, otherwise as above | +1.9% | +1.5% | +0.7% | −3.1% |

Evidence: [sweep](worker-runtime-large-objects-v1-v7-sweep.txt). The
first row's run, at load 6–7, is in this report only.

- A small young budget makes the compiler, with its 256 MiB nursery,
  collect more often. That accounts for the extra instructions.
- A large one holds up to 256 MiB of dead or pooled chunks beside the
  nursery.
- Peak RSS also moves with where majors fall.

**Isolated 1 MiB string clone** (µs per round trip, single runs, 20 samples):

| Image | Samples 1–3 | Samples 4–20 |
| --- | --- | --- |
| Base | 503, 1123, 627 | 151–287, median about 270 |
| Space | 1446, 883, 247 | 234–318, median about 270 |

- The slow sample is the first minor collection: it promotes the startup
  heap and starts the collector pool's threads. The space only makes it
  come earlier.
- The steady state does not change. The remaining gap to Node (about
  147 µs) is the copy volume of a 2 MiB UTF-16 string per hop.

**Transport suite**, 15 rounds, load 7.4 (noisy):

| Operation | Space / base |
| --- | --- |
| 1 MiB string clone | 1.07× (interquartile range 1.02–1.17) |
| Every other operation | 0.97–1.05× |

Evidence: [transport](worker-runtime-large-objects-v1-transport.json).

## Decision

The space is parked until one-byte strings land, because it fails the gate:
- frozen v7 neutral on instructions, cycles and peak RSS;
- an improved 1 MiB clone, isolated and in the suite.

Two items replace it:
- an experiment on the first minor collection's one-time cost;
- an assessment of zero-copy transfer for large immutable strings.

The large reference-holding object benchmark condition returns if the space
does.
