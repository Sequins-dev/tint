# Compiler lowering memory after the self-compile fixes

The branch merged `8b9d46ca4`, including the number-index hashing and
quoted-text lexer fixes, as `4adc966108`. The fixes changed compiler
dependencies, so the lowering measurements were repeated on this base.
The [slice 4a measurements](compiler-lowering-memory-integrated-2026-11-19.md)
describe the previous base and link to the implementation trials.

Node 24.12.0 on macOS arm64 built `language/expressions/object` with
`TZ=UTC`, modules, suite linking and AOT native services. The baseline and
candidate used Test262 `91c70759363c46557b694792bf34a2551a7af5ba` and the
same 775-file baseline source snapshot with SHA-256
`869956e30755148658b694658820d870f2e8b63df2ce01f0df759909fa138a12`.
The two frozen Node compilers retained their own dist JavaScript. The
measurement copies' toolchain manifests had SHA-256
`10a0bdffe712ab16a29cb24374b8459808c24ea040c0606ef368692422cfefb1`
and `bfcc16cbb64be89257a5a8ae67524fd9e760107b5396e06d7206403e0f3219c3`,
respectively. The probes stop after writing the image and recording its
compiled variant count.

## Live heap and build time

The matched 4,096 MiB builds forced GC at each seam.

| Seam, live MiB              |  Main | Candidate |
| --------------------------- | ----: | --------: |
| Link returned               |   566 |       566 |
| Second application instance | 1,988 |     1,860 |
| Check returned              | 1,113 |     1,113 |
| Before function bodies      | 1,231 |     1,231 |
| After 24,576 bodies         | 1,863 |     1,743 |
| After 32,768 bodies         | 2,565 |     2,307 |
| After 36,864 bodies         | 2,802 |     2,504 |
| After all function bodies   | 2,908 |     2,588 |
| Before IR verification      | 2,907 |     2,588 |
| Closure lowering returned   | 2,723 |     2,532 |
| Typed lowering returned     | 1,799 |     1,608 |
| After pruning               | 1,741 |     1,576 |
| After optimization          | 1,604 |     1,604 |

The highest sampled live heap during lowering fell by 320 MiB (11.0%).
The last function-body probe sampled 3,121 MiB and 2,630 MiB before GC.

| Matched 4,096 MiB builds         |     Main | Candidate |
| -------------------------------- | -------: | --------: |
| Whole build wall time, s         | 1,596.18 |  1,581.57 |
| Whole build user + system CPU, s | 1,210.91 |  1,150.63 |
| Maximum RSS, MiB                 |    5,432 |     5,758 |

Wall time fell 0.9% and CPU time fell 5.0% in the instrumented pair under
concurrent host load. Whole-process RSS rose by 326 MiB and includes
memory outside V8's old-space cap.

## Heap caps and byte identity

The cap runs sampled without forced GC.

| Run                         | Cap, MiB | Result                          | Max RSS, MiB |  Wall, s |
| --------------------------- | -------: | ------------------------------- | -----------: | -------: |
| `number-fix-base-3008`      |    3,008 | OOM late in lowering, exit 134  |        3,972 |   307.53 |
| `number-fix-base-3040`      |    3,040 | OOM late in lowering, exit 134  |        4,017 |   324.21 |
| `number-fix-base-3072`      |    3,072 | Compiled 2,252 of 2,252, exit 0 |        4,287 | 1,599.90 |
| `number-fix-base-3136`      |    3,136 | Compiled 2,252 of 2,252, exit 0 |        4,752 | 1,639.51 |
| `number-fix-candidate-2880` |    2,880 | OOM during checking, exit 134   |        3,602 |   683.63 |
| `number-fix-candidate-2912` |    2,912 | Compiled 2,252 of 2,252, exit 0 |        4,505 | 1,636.89 |

The baseline bracket is `(3,040, 3,072] MiB`. The candidate bracket is
`(2,880, 2,912] MiB`, a 160 MiB drop in the smallest successful tested cap.
At 2,880 MiB the candidate reached the second application instance and
exhausted heap before checking returned. The two lower baseline caps ran
later under different host load.

Both 4,096 MiB builds and the three successful cap builds produced
byte-identical 176,514,527-byte images with SHA-256
`71b7bf3c4fe36b03141445e43004d693f005f1b9a886632d2068b348a9d66915`.
Raw probes, reports, timings, errors and images are in
`.tint-bootstrap/lowering-evidence/` in the measurement worktree.
