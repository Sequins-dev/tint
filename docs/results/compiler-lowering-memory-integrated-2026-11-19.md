# Compiler lowering memory after slice 4a integration

The slice 4a integration touched all three files changed by the lowering
memory reduction, plus the compiler driver, checker, IR and code generator.
The branch merged integrated main `3920ddfb2` as `cb3c6cd27` without
conflicts. The overlap required fresh measurements and full gates. The
[earlier report](compiler-lowering-memory-2026-11-19.md) covers the
original trials and the measurements before this integration.

Node 24.12.0 on macOS arm64 built `language/expressions/object` with
`TZ=UTC`, modules, suite linking and AOT native services. Both compilers
used pinned Test262 `91c70759363c46557b694792bf34a2551a7af5ba` and the same
775-file source snapshot with SHA-256
`9afb0dc531593a92c861a08206ace93fc446c6845e8bbe5ef95ac32ad6949cf0`.
The baseline and candidate Node toolchain manifests had SHA-256
`21f04fc4f9d17f0fdf0cc3c7e4b1e2433a6452caed50833f575dd93993ce7989`
and `a9fd57f8bddace3d0df98af19c02cfa9355b56b0e31bd12c2f725c620c596cfa`,
respectively. Probes were applied to frozen dist JavaScript. Each build
stopped after writing the image and recording its compiled variant count.

## Live heap and build time

The matched 4,096 MiB builds forced GC at each seam.

| Seam, live MiB              |  Main | Candidate |
| --------------------------- | ----: | --------: |
| Link returned               |   563 |       563 |
| Second application instance | 1,985 |     1,858 |
| Check returned              | 1,110 |     1,111 |
| Before function bodies      | 1,229 |     1,229 |
| After 24,576 bodies         | 1,861 |     1,741 |
| After 32,768 bodies         | 2,563 |     2,306 |
| After 36,864 bodies         | 2,800 |     2,502 |
| After all function bodies   | 2,906 |     2,586 |
| Before IR verification      | 2,905 |     2,586 |
| Closure lowering returned   | 2,721 |     2,530 |
| Typed lowering returned     | 1,797 |     1,606 |
| After pruning               | 1,738 |     1,573 |
| After optimization          | 1,601 |     1,602 |

The highest sampled live heap during lowering fell by 320 MiB (11.0%).
At the last body probe, the pre-GC samples were 2,952 and 2,921 MiB.

| Matched 4,096 MiB builds         |     Main | Candidate |
| -------------------------------- | -------: | --------: |
| Whole build wall time, s         | 1,814.64 |  1,802.68 |
| Whole build user + system CPU, s | 1,204.74 |  1,217.93 |
| Maximum RSS, MiB                 |    5,616 |     5,765 |

Wall time fell 0.7% and CPU time rose 1.1% in this instrumented pair under
concurrent host load. Whole-process RSS includes memory outside V8's
old-space cap.

## Heap caps and byte identity

The cap runs sampled without forced GC.

| Run                     | Cap, MiB | Result                          | Max RSS, MiB |  Wall, s |
| ----------------------- | -------: | ------------------------------- | -----------: | -------: |
| `recheck-base-cap-3072` |    3,072 | OOM late in lowering, exit 134  |        3,992 |   956.90 |
| `recheck-base-cap-3136` |    3,136 | Compiled 2,252 of 2,252, exit 0 |        4,438 | 1,867.70 |
| `recheck-cap-2880`      |    2,880 | OOM during checking, exit 134   |        3,901 |   416.01 |
| `recheck-cap-2912`      |    2,912 | Compiled 2,252 of 2,252, exit 0 |        4,483 | 1,898.43 |
| `recheck-cap-2944`      |    2,944 | Compiled 2,252 of 2,252, exit 0 |        4,539 | 1,931.54 |

The smallest successful tested cap fell from 3,136 to 2,912 MiB. The
candidate's 2,880 MiB run reached the second application instance and
exhausted heap before checking returned.

Both 4,096 MiB builds and all three successful cap builds produced
byte-identical 176,531,039-byte images with SHA-256
`0656c603422e8e4e5884b26c24d412e3b8833b0b27718c4642172b669bdff5e1`.

Raw probes, reports, timings, errors, and images are in
`.tint-bootstrap/lowering-evidence/` in the measurement worktree.

`pnpm check` exited 0 on `cb3c6cd27` with 6,277 passing tests and seven
skips. The native-subset test passed, and catalog regeneration made no
changes.
