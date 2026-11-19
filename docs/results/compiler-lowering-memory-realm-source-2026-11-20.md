# Compiler lowering memory after on-demand realm source discovery

The branch merged `8166313f8` as `21e5f007c`. That change adjusts source
discovery in the compiler driver and TypeScript module loader, so the
object-suite measurements were repeated. The [previous report](compiler-lowering-memory-mixed-error-2026-11-19.md)
records the mixed native Error views measurements and links to earlier runs.

Node 24.12.0 on macOS arm64 built `language/expressions/object` with
`TZ=UTC`, modules, suite linking and AOT native services. Both Node
compilers used pinned Test262 `91c70759363c46557b694792bf34a2551a7af5ba`
and the same 775-file baseline source snapshot with SHA-256
`f776b2c06071099aa5e199bb5dc3452d46a6011af095542e30cbe4fb9e5e6c38`.
The frozen compilers retained their own dist JavaScript. The measurement
copies' toolchain manifests had SHA-256
`dca9763018ec271c796b381d31ce9e28cc1c3e0e6da5b7817f25f4bcdceb4a08`
and `b132343ea8d47ec685267f72b489ebaff2779470ef3747cfc392b9232150522d`,
respectively. Each build stopped after writing the image and recording its
compiled variant count.

## Live heap and build time

The matched 4,096 MiB builds forced GC at each seam.

| Seam, live MiB              |  Main | Candidate |
| --------------------------- | ----: | --------: |
| Link returned               |   567 |       571 |
| Second application instance | 1,861 |     1,989 |
| Check returned              | 1,113 |     1,113 |
| Before function bodies      | 1,232 |     1,232 |
| After 24,576 bodies         | 1,864 |     1,744 |
| After 32,768 bodies         | 2,566 |     2,308 |
| After 36,864 bodies         | 2,804 |     2,505 |
| After all function bodies   | 2,910 |     2,590 |
| Before IR verification      | 2,910 |     2,589 |
| Closure lowering returned   | 2,725 |     2,534 |
| Typed lowering returned     | 1,801 |     1,610 |
| After pruning               | 1,742 |     1,577 |
| After optimization          | 1,606 |     1,606 |

The highest sampled live heap during lowering fell by 320 MiB (11.0%).
The last function-body probe sampled 3,120 MiB and 2,882 MiB before GC.

| Matched 4,096 MiB builds         |     Main | Candidate |
| -------------------------------- | -------: | --------: |
| Whole build wall time, s         | 1,435.02 |  1,420.58 |
| Whole build user + system CPU, s | 1,209.34 |  1,178.38 |
| Maximum RSS, MiB                 |    5,875 |     5,599 |

Wall time fell 1.0%, CPU time fell 2.6%, and process RSS fell by 276 MiB
in the instrumented pair under concurrent host load.

## Heap caps and byte identity

The cap runs sampled without forced GC.

| Run                         | Cap, MiB | Result                          | Max RSS, MiB |  Wall, s |
| --------------------------- | -------: | ------------------------------- | -----------: | -------: |
| `realm-root-base-3008`      |    3,008 | OOM late in lowering, exit 134  |        3,262 |   818.07 |
| `realm-root-base-3040`      |    3,040 | Compiled 2,252 of 2,252, exit 0 |        4,378 | 1,430.41 |
| `realm-root-candidate-2880` |    2,880 | OOM during checking, exit 134   |        3,198 |   611.31 |
| `realm-root-candidate-2912` |    2,912 | Compiled 2,252 of 2,252, exit 0 |        4,259 | 1,487.11 |

The baseline bracket is `(3,008, 3,040] MiB`. The candidate bracket is
`(2,880, 2,912] MiB`, a 128 MiB drop in the smallest successful tested cap.
At 2,880 MiB the candidate reached the second application instance and
exhausted heap before checking returned.

Both 4,096 MiB builds and both successful cap builds produced
byte-identical 176,630,111-byte images with SHA-256
`9d9249f7c525b9826cb6e073181cc529211ce95d2f52f8761836ef391ae9a217`.
Raw probes, reports, timings, errors and images are in
`.tint-bootstrap/lowering-evidence/` in the measurement worktree.
