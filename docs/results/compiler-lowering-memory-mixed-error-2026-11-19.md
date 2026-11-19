# Compiler lowering memory after mixed native Error views

The branch merged `4b30c44eb` as `4d5a4f0ce`. Mixed native Error views
changed the compiler driver, runtime, and two files in the lowering memory
change, so the heap measurements were repeated. The [previous report](compiler-lowering-memory-number-index-2026-11-19.md)
records the measurements after the self-compile fixes and links to the
earlier trials.

Node 24.12.0 on macOS arm64 built `language/expressions/object` with
`TZ=UTC`, modules, suite linking and AOT native services. Both Node
compilers used pinned Test262 `91c70759363c46557b694792bf34a2551a7af5ba`
and the same 775-file baseline source snapshot with SHA-256
`369d09d39545ffd9dae0b82e75589da3b878352128a68cdb80f9a2b5b0757245`.
The frozen compilers retained their own dist JavaScript. The measurement
copies' toolchain manifests had SHA-256
`536d16c77010f247c6026580952f5fa6b920f2717c1d66c0d1aad0dd3997541c`
and `16b3a30474a13c98f24a9108ac796378925f1d42b20906c9d61525effbd5209b`,
respectively. Each build stopped after writing the image and recording its
compiled variant count.

## Live heap and build time

The matched 4,096 MiB builds forced GC at each seam.

| Seam, live MiB              |  Main | Candidate |
| --------------------------- | ----: | --------: |
| Link returned               |   566 |       566 |
| Second application instance | 1,861 |     1,988 |
| Check returned              | 1,113 |     1,113 |
| Before function bodies      | 1,232 |     1,232 |
| After 24,576 bodies         | 1,864 |     1,744 |
| After 32,768 bodies         | 2,566 |     2,308 |
| After 36,864 bodies         | 2,803 |     2,505 |
| After all function bodies   | 2,910 |     2,590 |
| Before IR verification      | 2,909 |     2,589 |
| Closure lowering returned   | 2,725 |     2,534 |
| Typed lowering returned     | 1,801 |     1,609 |
| After pruning               | 1,742 |     1,577 |
| After optimization          | 1,606 |     1,606 |

The highest sampled live heap during lowering fell by 320 MiB (11.0%).
The last function-body probe sampled 3,103 MiB and 2,938 MiB before GC.

| Matched 4,096 MiB builds         |     Main | Candidate |
| -------------------------------- | -------: | --------: |
| Whole build wall time, s         | 2,447.46 |  2,409.26 |
| Whole build user + system CPU, s | 1,249.41 |  1,230.91 |
| Maximum RSS, MiB                 |    4,844 |     4,567 |

Wall time fell 1.6%, CPU time fell 1.5%, and process RSS fell by 277 MiB
in the instrumented pair under concurrent host load.

## Heap caps and byte identity

The cap runs sampled without forced GC.

| Run                          | Cap, MiB | Result                          | Max RSS, MiB |  Wall, s |
| ---------------------------- | -------: | ------------------------------- | -----------: | -------: |
| `mixed-error-base-2976`      |    2,976 | OOM late in lowering, exit 134  |        3,375 |   643.73 |
| `mixed-error-base-3008`      |    3,008 | OOM late in lowering, exit 134  |        3,386 |   671.68 |
| `mixed-error-base-3040`      |    3,040 | Compiled 2,252 of 2,252, exit 0 |        3,970 | 2,513.30 |
| `mixed-error-base-3072`      |    3,072 | Compiled 2,252 of 2,252, exit 0 |        4,061 | 2,477.16 |
| `mixed-error-candidate-2880` |    2,880 | OOM during checking, exit 134   |        3,116 |   915.08 |
| `mixed-error-candidate-2912` |    2,912 | Compiled 2,252 of 2,252, exit 0 |        3,786 | 2,651.11 |

The baseline bracket is `(3,008, 3,040] MiB`. The candidate bracket is
`(2,880, 2,912] MiB`, a 128 MiB drop in the smallest successful tested cap.
At 2,880 MiB the candidate reached the second application instance and
exhausted heap before checking returned. The two lower baseline caps ran
later under a lighter host load.

Both 4,096 MiB builds and the three successful cap builds produced
byte-identical 176,613,599-byte images with SHA-256
`bc4e40fc1e151c7f88800c63bdcbd501cc98d027951991a030c138f55c1d3fb6`.
Raw probes, reports, timings, errors and images are in
`.tint-bootstrap/lowering-evidence/` in the measurement worktree.
