# Compiler lowering memory after local realm allocation

The branch merged `c92671c0d` as `80a808e41`. The integration changed the
checker, runtime, and two files in the lowering memory change, so the
object-suite measurements were repeated. The [previous report](compiler-lowering-memory-realm-source-2026-11-20.md)
records the source discovery measurements and links to earlier runs.

Node 24.12.0 on macOS arm64 built `language/expressions/object` with
`TZ=UTC`, modules, suite linking and AOT native services. Both Node
compilers used pinned Test262 `91c70759363c46557b694792bf34a2551a7af5ba`
and the same 776-file baseline source snapshot with SHA-256
`ed43bcfef9ff50f4e5b8ea9d5a7fd27502afb1482a677fcb671aac48df785a91`.
The frozen compilers retained their own dist JavaScript. The measurement
copies' toolchain manifests had SHA-256
`135573413a7f73fa9b7638748651017b010220266e43e92491664f48d59d2079`
and `4dd2bc9568e964d926860f0ef6aef637c113bd814dc449dc502e52fc879bb44b`,
respectively. Each build stopped after writing the image and recording its
compiled variant count.

## Live heap and build time

The matched 4,096 MiB builds forced GC at each seam.

| Seam, live MiB              |  Main | Candidate |
| --------------------------- | ----: | --------: |
| Link returned               |   567 |       566 |
| Second application instance | 1,865 |     1,992 |
| Check returned              | 1,115 |     1,115 |
| Before function bodies      | 1,234 |     1,234 |
| After 24,576 bodies         | 1,866 |     1,746 |
| After 32,768 bodies         | 2,567 |     2,309 |
| After 36,864 bodies         | 2,806 |     2,506 |
| After all function bodies   | 2,916 |     2,595 |
| Before IR verification      | 2,916 |     2,594 |
| Closure lowering returned   | 2,731 |     2,539 |
| Typed lowering returned     | 1,805 |     1,613 |
| After pruning               | 1,746 |     1,580 |
| After optimization          | 1,610 |     1,610 |

The highest sampled live heap during lowering fell by 321 MiB (11.0%).
The last function-body probe sampled 2,965 MiB and 3,031 MiB before GC.

| Matched 4,096 MiB builds         |     Main | Candidate |
| -------------------------------- | -------: | --------: |
| Whole build wall time, s         | 1,182.25 |  1,210.26 |
| Whole build user + system CPU, s | 1,138.57 |  1,221.24 |
| Maximum RSS, MiB                 |    5,875 |     5,403 |

Wall time rose 2.4%, CPU time rose 7.3%, and process RSS fell by 472 MiB
in this instrumented pair under concurrent host load.

## Heap caps and byte identity

The cap runs sampled without forced GC.

| Run                 | Cap, MiB | Result                             | Max RSS, MiB |  Wall, s |
| ------------------- | -------: | ---------------------------------- | -----------: | -------: |
| `c2-base-2976`      |    2,976 | OOM verifying lowered IR, exit 134 |        3,580 |   443.07 |
| `c2-base-3008`      |    3,008 | Compiled 2,252 of 2,252, exit 0    |        4,249 | 1,293.34 |
| `c2-base-3040`      |    3,040 | OOM verifying lowered IR, exit 134 |        3,443 |   564.91 |
| `c2-base-3072`      |    3,072 | Compiled 2,252 of 2,252, exit 0    |        4,375 |   919.49 |
| `c2-candidate-2880` |    2,880 | OOM during checking, exit 134      |        3,171 |   410.34 |
| `c2-candidate-2912` |    2,912 | Compiled 2,252 of 2,252, exit 0    |        4,056 | 1,241.57 |

The smallest successful tested cap fell from 3,008 to 2,912 MiB, a
96 MiB reduction. The candidate bracket is `(2,880, 2,912] MiB`. Its
2,880 MiB run reached the second application instance and exhausted heap
before checking returned. The baseline passed at 3,008 MiB between
failures at 2,976 MiB and 3,040 MiB, so the cap results record observed trials.

Both 4,096 MiB builds and all three successful cap builds produced
byte-identical 176,877,791-byte images with SHA-256
`57e9d1eaafada4b380c71e94149f455e24b7f26c529c96a0fa5d009af9257fbf`.
Raw probes, reports, timings, errors and images are in
`.tint-bootstrap/lowering-evidence/` in the measurement worktree.
