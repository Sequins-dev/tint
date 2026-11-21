# Native optimizer rotation and further streaming probes

November 21, 2026. This report continues the
[matched 821-file experiment](parallel-bounded-compile-streaming-probes-v1.md)
with the same snapshot and host measurement definitions.

## Rotated native self-compile

The control runs bracketed the candidate measurements. The execution order
was main A, LICM A, SSA A, SSA B, combined A, LICM B, combined B, main B.
Native compilers rebuilt the same
821-file control under LLDB with the native and timing locks. Every inferior
stopped at entry and exited zero. All eight images matched the control by
`cmp`, SHA-256
`334b71602e62113f13c967a902a728df52e5445eacbe4eec1886bbf27eda9613`.

| Compiler     | Run | Wall (s) | CPU (s) | Cycles (billions) | Peak sampled RSS (MiB) |
| ------------ | --- | -------: | ------: | ----------------: | ---------------------: |
| Merged main  | A   |  263.916 | 264.059 |            783.88 |                 2090.0 |
| Merged main  | B   |  291.669 | 289.293 |            808.73 |                 2090.0 |
| LICM only    | A   |  206.726 | 194.758 |            592.81 |                 2050.3 |
| LICM only    | B   |  123.463 | 136.549 |            526.19 |                 2052.3 |
| SSA only     | A   |  191.648 | 208.924 |            669.17 |                 2090.0 |
| SSA only     | B   |  184.212 | 202.845 |            658.50 |                 2090.5 |
| LICM and SSA | A   |  137.793 | 157.887 |            509.40 |                 2051.5 |
| LICM and SSA | B   |   91.523 | 109.593 |            453.71 |                 2051.8 |

The control ran for 263.9 and 291.7 s. The combined compiler ran for 137.8 and 91.5 s.
Across these two runs per compiler, median wall time fell 58.7%,
CPU time fell 51.7%, and sampled hardware cycles fell 39.5%.
Other validation workloads occupied the machine during both orders. The
clock and peak RSS describe those observed runs. Cycles are the midpoint of
the samples bracketing inferior exit.

## Packed devirtualization and inlining

The last scratch variant kept functions packed for reachability, pruning,
early local optimizer passes, closure devirtualization, inlining and local
cleanup. Passes published function-ID-ordered generations and kept explicit
rewrite flags. The remaining module-wide passes consumed decoded bodies. The
prototype used a Node array adapter to test lifetime changes before changing
the compiler's portable optimizer interface.

A typed fixture with a captured closure, direct inlining, host bindings and
debug data produced the same code, symbols and lines with memory, a 1 KiB
budget and forced spill. Its native code SHA-256 was
`b2b7f3adbabfe0382d5b4daf57d14345c12ed17877a3a1930b4828f4a7211d02`.
The first scratch setup failed to apply a code replacement and was corrected
before this fixture run.

The full Object image run used the unchanged 2,252-variant selection, an
8 MiB store budget, 2,400 MiB of V8 old space and 4 MiB young-generation
semi-spaces. It entered optimization with 36,401 functions and 364.4 MiB
reported heap use. Before the next global pass it held 37,475 packed
functions and 462.2 MiB of heap. Hydrating that pass exceeded the heap
limit and produced no suite image. The run took 622.80 s wall and 1,199.10 s
CPU, using 4,097.18 billion cycles and 3,364.8 MiB peak RSS.

Keeping bodies packed across these passes removed the decoded IR from their
steady-state live heap. The actual Object peak still exceeded 2.8 GiB, and
the cost of decoding and re-encoding whole generations remained substantial.
The optimizer changes retained on the branch are the serial LICM summary
reuse and settled SSA joins, which leave the AOT work budget unbounded.

## Local macOS gate attempt

The gate at `e730ca0fc` completed the build, catalog comparison, native
subset test, 6,018 concurrent tests and 238 memory tests. It hit the
3,600 s overall budget while the native test workers were queuing for the
shared launch lock. The wrapper exited 124. The native test journal, partial
output and budget record are preserved in
`.tint-bootstrap/gate.3ivxLK84/`.

Raw logs, images and prototypes remain in
`.tint-bootstrap/parallel-experiment.DQ4p4zZ9/` in the assigned worktree.
