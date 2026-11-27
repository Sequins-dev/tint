# Native hot-pass profile and Object suite cap experiments

November 21, 2026. Compiler baseline `206530edd`. Inputs, target and
environment are the same as the [merged-main screening](parallel-bounded-compile-screening-v1.md).
This report captures the pass profile, the first matched LICM observation,
and completed memory prototypes.

## Native work distribution

The clean stage-1 compiler rebuilt its frozen 821-file input with
`--pass-stats` under LLDB. The inferior stopped at entry and exited zero.
Its signed image matched the clean Node bootstrap by `cmp`, SHA-256
`334b71602e62113f13c967a902a728df52e5445eacbe4eec1886bbf27eda9613`.
Pass timings read the compiler's monotonic clock.

| Pass                  | Wall (s) |    Work units |
| --------------------- | -------: | ------------: |
| SSA constants         |   30.990 |   430,125,708 |
| Hoist loop invariants |   81.646 |    14,682,564 |
| Emit native code      |   84.911 |         7,111 |
| Total recorded passes |  246.833 | 2,521,672,690 |

LICM's work count omits a scan of the original function for every selected
loop. The scan identifies unchecked record operations and blocks entered
through a failed layout check. Each round reads one immutable function,
including when another loop schedules replacement blocks. The candidate
reuses one summary for the round and discards it after rewrites. A test
with one and two loops found 10 and 12 reads of a preheader instruction's
kind in the baseline. Both now have the same read count.

| Native compiler        | Wall (s) | CPU (s) | Cycles (billions) | Peak sampled RSS (MiB) |
| ---------------------- | -------: | ------: | ----------------: | ---------------------: |
| Merged main            |  263.916 | 264.059 |     783.85–783.90 |                2,090.0 |
| LICM summary per round |  206.726 | 194.758 |     592.79–592.82 |                2,050.3 |

The candidate ran from its own frozen stage-1 image and compiled the same
unmodified main input as the baseline. Both measured runs held the timing
and native gate locks. The candidate stopped at entry, exited zero and
produced the same signed image by `cmp`. This is the initial order only.
It establishes the observed gain for this pair.

On the same captured SSA input as the worker screen, Node's sampling
profiler attributed 5,178 exclusive samples to the transfer callback,
including predecessor reads. Once a block parameter becomes unknown,
further joins keep it unknown. A disposable serial kernel skipped the
settled reads while charging the original work. It took 4.796 s wall and
6.478 s CPU with the same IR digest as the screen. That single diagnostic
is a reason to measure the cheaper serial kernel before selecting a pool
for SSA.

## Object suite attempts

All attempts used the same captured Object suite input as the screen.
Each set the Node old-space limit to 2,867 MiB. The following runs produced
no suite image and executed zero cases.

| Prototype                                                                                            | Wall (s) | Process peak RSS (MiB) | Observation                                               |
| ---------------------------------------------------------------------------------------------------- | -------: | ---------------------: | --------------------------------------------------------- |
| Sparse template index plus one final syntax hash traversal                                           |   587.35 |                3,732.7 | Ineffective mark-compacts, SIGABRT                        |
| Release the checked graph before specialization when the instance transform needs no binding context |   159.17 |                3,536.1 | Ineffective mark-compacts, SIGABRT                        |
| Sparse template index plus one hash traversal, with stage markers                                    |   303.32 |                3,743.8 | Reached lowering, then ineffective mark-compacts, SIGABRT |

The instrumented repetition passed through retry helper specialization
and the finalized retry check. It entered lowering with 1,801.1 MiB
reported heap use and 3,696.7 MiB RSS. This relocates the observed blocker
for that prototype to the lowering interval. The two Node runs used
different measurement setups and host occupancy, so the spread is not a
timing estimate for removing a hash traversal. The context-free transform
does not shorten the managed-surface path's lifetime because that path
reads the observed bindings.

An earlier native timing invocation omitted the input root. The compiler
diagnosed a source open failure and exited 1. The LLDB wrapper exited
zero, and the harness rejected the run based on the verified inferior
status. It is excluded from the timing table.

## Typed Worker feasibility

The existing hosted worker image runs its designated worker module through
general evaluation. A fixture asked the worker to run the same typed
compiler parser function as the coordinator. The original image ran the
general worker stub, returned 0 and failed the parent assertion with
inferior exit 1. A disposable generated-host patch initialized the typed
worker facade in each isolate and called the same typed entry there. The
parser ran in the worker and the inferior exited 42 under LLDB. This
exercises the native worker lifecycle and message delivery. It does not
time a worker in the production compiler.

The pass-stat output, process samples, source snapshots, probe patches and
fixtures are retained under `.tint-bootstrap/parallel-experiment.DQ4p4zZ9/`
in the assigned worktree.
