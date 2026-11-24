# One-byte strings: sliced-string retention (v1)

Recorded 2026-11-23 on macOS arm64 (Apple M5 Max). A sliced string keeps
its whole flat parent alive, as V8's sliced strings do
([design](../design-one-byte-strings.md#sliced-strings)). This report
measures whether that raises peak memory, as the orchestrator's condition
3 requires.

## Method

Peak resident set size (`/usr/bin/time -l`, maximum RSS) of images run
directly and interleaved, as `tools/frozen-workload.ts run` measures it:

- **String kernels:** the typed `tools/string-bench` images of
  [s6, s8 and s8b](string-s8-ab-v1.md), which their A/B runs validated
  under LLDB (every kernel, cold and five warm iterations each), five runs
  each.
- **Frozen v7:** the frozen self-compile, built with `--runtime-tree`
  from s6 (`2c162bd76`) and from `089813bc3`.

## Results

### String kernels

| Image | Median peak RSS | Range        |
| ----- | --------------: | ------------ |
| s6    |         63.8 MB | 63.6–67.5 MB |
| s8    |         54.7 MB | 54.5–54.8 MB |
| s8b   |         54.8 MB | 54.6–55.1 MB |

Slices lower peak RSS by 14%: `substring` results of 1–2 KiB no longer
copy, and every slice parent in the kernels is live anyway.

### Frozen v7

Five interleaved runs ([log](string-slice-retention-v1-frozen.log)) of
the frozen self-compile built from s6 (`2c162bd76`) and from `089813bc3`
(s8 with the string helpers' aligned layout). One-minute load was 3.2 at
the start and reached 9.2 as other sessions ran; the runner always runs
s6 first in a round. Paired against s6:

| Measure      | Per round (%)                     | Median |
| ------------ | --------------------------------- | -----: |
| peak RSS     | +0.39, +0.34, +0.39, +0.40, +0.39 | +0.39% |
| instructions | +0.28, +0.28, +0.29, +0.25, +0.32 | +0.28% |
| cycles       | +0.95, −0.33, +3.45, +2.79, −0.18 | +0.95% |
| wall time    | +1.41, +1.51, +15.0, +15.5, +0.98 | +1.51% |

Rounds 3 and 4 ran under the heaviest load (wall time +15% in both). The
three quieter rounds are within ±1% in cycles.

## Reading

- **No retention problem.** Slices lower the string kernels' peak RSS by
  14%. The self-compile's peak RSS rises by 0.39% (8 MB of 2.09 GB) in
  every round. Its cause is not attributed here; it is too small to need
  a fix.
- **The cheap fix is not built.** A collector could treat a slice's
  parent edge as weak during tracing (slices on a side list, like
  ephemerons). After the drain, a slice whose parent nothing else reached,
  and which is much shorter than its parent, would get a fresh exact-size
  flat parent holding its units; otherwise the parent is traced. That
  needs a slice list and a post-drain pass in every collector (Cheney,
  parallel, compactor and nursery), so it is not cheap, and nothing above
  calls for it.
- **Frozen v7 is neutral** within this run's noise; the 0.28% more
  instructions are the compiler's own slice handling. A reverse-order rerun
  at lower load will confirm the cycles.
