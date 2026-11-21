# Object suite streaming probes and native self-build identity

November 21, 2026. The Object suite uses the frozen source snapshot and the
full 2,252-variant selection in the
[merged-main screen](parallel-bounded-compile-screening-v1.md). The prototype
changes were applied to scratch copies of that toolchain. All rows below used
Node 24.12.0, macOS arm64, suite linking, modules, monolithic services, and a
2,867 MiB V8 old-space setting. Peak RSS measures the entire runner process.

| Prototype                                                                                               | Wall (s) | CPU (s) | Cycles (billions) | Peak RSS (MiB) | Outcome                                                            |
| ------------------------------------------------------------------------------------------------------- | -------: | ------: | ----------------: | -------------: | ------------------------------------------------------------------ |
| Specialize syntax one top-level statement at a time with the previous sparse reference and hash changes |   743.91 |  897.60 |          2,643.63 |        3,793.8 | Entered optimization. V8 out of memory.                            |
| Pack lowering bodies, release decoded bodies, and rehydrate after lowering                              |   439.81 |  544.01 |          1,671.76 |        3,837.4 | Managed surface witness missing. Stopped its diagnostic bisection. |
| Pack lowering bodies, with the managed surface witness loaded from the store                            |   425.58 |  506.09 |          1,476.71 |        3,542.1 | Entered optimization. V8 out of memory.                            |
| Capture managed surface helper choices as root ordinals before specialization                           |   728.78 |  924.09 |          2,812.95 |        3,909.5 | Entered optimization. V8 out of memory.                            |

The first packed lowering attempt reached a real record-witness regression. The
AOT surface verifier scanned the function header for the descriptor-address
instruction. Its first full-suite build reported `missing AOT layout: $T0` at
340.61 s. The runner began a smaller diagnostic build, then received SIGTERM.
The total process measurements include that partial diagnostic build. An
existing managed-surface test reproduced the failure under a small storage
budget. Loading the witness body from the store restored equality of native
code and service identities in the focused test.

A separate typed host-binding and debug fixture produced identical native
code, symbols and source lines under memory, a 1 KiB budget and forced spill.
The code digest was
`e41df2009a7aef832ab8f3700772b7393fab2ea6e5d84480bd0c21e4cb899c96`.
Each spill invocation left its temporary directory empty.

In the corrected full-suite probe, measured heap use was 1,813.7 MiB at
lowering entry and 2,774.4 MiB at optimizer entry. The initial optimizer input
was fully decoded. Rehydrating after the checked front end had returned was
insufficient to finish the suite. The measured full-suite runs used shared
host resources and provide memory and phase evidence. Their wall and CPU
measurements do not isolate the cost of individual prototype changes. None
of these runs emitted a complete suite image or executed any variants.

The helper-choice prototype determines each managed surface collection
operation against the observed checker, records root ordinals and releases the
checker before materializing specialized helper bodies. The transform resolves
those ordinals to the actual specialized names. Forty-five managed surface and
collection runtime tests passed. This move did not bring the full suite under
the cap. Optimization still entered with 2,686.0 MiB of reported heap use and
3,700.7 MiB RSS before the run failed.

Two further probes used an 8 MiB packing budget and a 4 MiB young-generation
semi-space. Both also included the helper-choice and statement traversal
changes.

| Prototype                                                                    | Wall (s) | CPU (s) | Cycles (billions) | Peak RSS (MiB) | Outcome                                                       |
| ---------------------------------------------------------------------------- | -------: | ------: | ----------------: | -------------: | ------------------------------------------------------------- |
| Release reconstructed nodes immediately during read-only instance name scans |   394.93 |  551.67 |          1,835.03 |        3,782.0 | V8 out of memory during final instance preparation.           |
| Read packed input through the initial closed-program prune                   |   411.75 |  613.41 |          2,035.59 |        3,872.3 | Pruned to 36,401 functions. V8 out of memory in optimization. |

The initial-prune probe used a Node-only array adapter to provide one body
at a time. Its reported heap grew from 1,427.5 MiB before pruning to
2,681.6 MiB when the retained bodies had been decoded and published.
Keeping the pruned generation packed between passes is a distinct
memory constraint.

A further Node-only probe kept the pruned generation packed through the first
function-local optimizer passes. Its reported heap was 365.8 MiB at optimizer
entry and 416.6 MiB before the first module-wide pass. Hydrating that pass
raised the reported heap to 2,213.1 MiB. The run exhausted V8 old space
after 519.26 s wall, 762.14 s CPU and 2,465.22 billion cycles. Process peak
RSS was 3,866.6 MiB. The first fixture build accidentally adopted the empty
host array rather than the packed generation. The corrected fixture matched
native code, symbols and lines in memory, budget and forced-spill modes.

At a 2,400 MiB old-space setting, the same managed and packed local passes
configuration reached the same global hydration boundary and then ran out
of heap. It took 515.49 s wall, 784.46 s CPU and 2,499.05 billion cycles.
Process peak RSS was 3,392.4 MiB. No full suite image was produced.

## Matched Object image compilation

With a 4,096 MiB old-space setting, both merged main and the LICM plus SSA
candidate compiled the full selection. The diagnostic runner exited after
publishing the signed image, before variant execution. The base ran first.
Both 189,938,783-byte images matched by `cmp`, SHA-256
`101fb0f4674648a163500a09793b756aec7d1e0baefc4e6ee721f50fd1485290`.

| Compiler     | Wall (s) |  CPU (s) | Cycles (billions) | Peak RSS (MiB) |
| ------------ | -------: | -------: | ----------------: | -------------: |
| Merged main  |   899.40 | 1,057.73 |          3,202.31 |        4,760.7 |
| LICM and SSA |   524.22 |   663.41 |          2,191.32 |        5,195.6 |

The candidate finished image compilation 375.18 s sooner, using 394.32 s
less CPU. Its observed process peak was 434.9 MiB higher. Both runs shared
the machine with other validation work. This pair gives image identity
and a measured compile memory point for each compiler.

## Rotated Node worker transport screen

The three orders were serial / spill / clone, spill / clone / serial, and
clone / serial / spill. These runs used the baseline kernel, four workers for
both transports, and the 100,000-work input batches from the initial screen.
Each run produced the same ordered IR digest and the same work and rewrite
statistics. Pass times include worker setup and merge. RSS and hardware
cycles cover the entire diagnostic process.

| Round | Mode   | Pass wall (s) | Pass CPU (s) | Peak RSS (MiB) | Process cycles (billions) |
| ----- | ------ | ------------: | -----------: | -------------: | ------------------------: |
| 1     | serial |        11.818 |       12.422 |        1,659.6 |                     54.74 |
| 1     | clone  |         6.657 |       27.842 |        3,372.5 |                     96.64 |
| 1     | spill  |         5.126 |       25.662 |        3,057.5 |                     85.92 |
| 2     | serial |        10.298 |       11.830 |        1,656.8 |                     52.96 |
| 2     | clone  |         7.435 |       29.713 |        3,615.0 |                     99.51 |
| 2     | spill  |         6.116 |       26.974 |        3,064.8 |                     85.16 |
| 3     | serial |        11.389 |       12.989 |        1,654.0 |                     54.85 |
| 3     | clone  |         7.744 |       30.602 |        3,443.7 |                     97.30 |
| 3     | spill  |         5.179 |       26.246 |        3,120.8 |                     85.59 |

Median pass wall time was 11.389 s serial, 7.435 s with clone and 5.179 s with
spill. The spill configuration accelerated this isolated Node pass and added
CPU cycles and process RSS. Native feasibility was also established for a
typed worker executing the real SSA constant folder on a small IR join. The
first fixture build rejected a union-valued property read. A local variable
carried the type refinement in the replacement fixture, and its LLDB inferior
exited 42. Neither fixture measured a worker pool in a native self-compile.

### Pool width and batching

This sweep used the original kernel. The first order ran serial, 2 workers,
4 workers in 25,000-work batches, 4 workers in 100,000-work batches, and 8
workers. The second reversed the order. Checksummed packed functions in
ID order gave one digest independent of the batch boundaries,
`50a4fe37e5ead73edab7bd661c4f3e5014ebd76284faea5f5972cd2c50ae5035`.

| Round |    Workers | Batch work | Pass wall (s) | Pass CPU (s) | Peak RSS (MiB) | Process cycles (billions) |
| ----- | ---------: | ---------: | ------------: | -----------: | -------------: | ------------------------: |
| 1     | 1 (serial) |    100,000 |         9.213 |       10.715 |        1,662.0 |                     50.49 |
| 1     |          2 |    100,000 |         7.185 |       19.540 |        2,632.6 |                     76.93 |
| 1     |          4 |     25,000 |         4.461 |       21.399 |        3,093.8 |                     81.29 |
| 1     |          4 |    100,000 |         4.612 |       22.935 |        3,236.6 |                     84.72 |
| 1     |          8 |    100,000 |         4.399 |       28.988 |        3,704.6 |                     95.83 |
| 2     | 1 (serial) |    100,000 |         8.723 |       10.257 |        1,775.4 |                     49.17 |
| 2     |          2 |    100,000 |         6.565 |       18.139 |        2,653.1 |                     74.42 |
| 2     |          4 |     25,000 |         4.952 |       23.455 |        3,004.1 |                     83.55 |
| 2     |          4 |    100,000 |         3.854 |       20.224 |        3,130.6 |                     80.42 |
| 2     |          8 |    100,000 |         3.872 |       26.191 |        3,741.2 |                     90.00 |

Four workers captured most of the wall-time benefit in this profile.
Eight workers used more CPU and memory in both orders. The batch-size
ranking changed with order.

### Settled-join kernel

The settled-join comparison used serial / spill / clone and the reverse order.
The two worker modes still used four workers. Every run reported 85,469,637
visits, 135,019 rewrites and the original ordered IR digest
`fd9b75b514b35a7f4b054873a0a3386dae23c9803faff5869ab55f966ace491a`.

| Round | Mode   | Pass wall (s) | Pass CPU (s) | Peak RSS (MiB) | Process cycles (billions) |
| ----- | ------ | ------------: | -----------: | -------------: | ------------------------: |
| 1     | serial |         4.033 |        5.594 |        1,696.8 |                     35.74 |
| 1     | spill  |         2.819 |       16.038 |        3,094.2 |                     67.08 |
| 1     | clone  |         5.319 |       19.933 |        3,764.5 |                     78.29 |
| 2     | serial |         4.195 |        5.900 |        1,833.2 |                     35.77 |
| 2     | spill  |         2.939 |       16.738 |        3,065.0 |                     65.87 |
| 2     | clone  |         5.092 |       19.787 |        3,848.6 |                     79.51 |

The simpler serial kernel outperformed the baseline's four-worker spill in
every recorded comparison. Four-worker spill with the cheaper kernel kept a
1.21–1.26 s wall advantage on this isolated Node pass, with roughly three
times its pass CPU and 1.20–1.36 GiB additional whole-process peak RSS.
Structured clone lost on wall time in both orders.

## Matched native compiler input

Each row compiled the frozen 821-file merged-main source under LLDB with
both host locks held. Each inferior stopped at entry, exited zero and
produced the same signed image,
`334b71602e62113f13c967a902a728df52e5445eacbe4eec1886bbf27eda9613`.
These observations include the first combined build and two SSA-only
runs. The reverse-order baseline and further LICM and combined runs
belong to the next measurement record.

| Compiler            | Wall (s) | CPU (s) | Cycles (billions) | Peak sampled RSS (MiB) |
| ------------------- | -------: | ------: | ----------------: | ---------------------: |
| Merged main         |  263.916 | 264.059 |     783.85–783.90 |                2,090.0 |
| LICM only           |  206.726 | 194.758 |     592.79–592.82 |                2,050.3 |
| SSA only, first     |  191.648 | 208.924 |     669.15–669.18 |                2,090.0 |
| SSA only, second    |  184.212 | 202.845 |     658.48–658.52 |                2,090.5 |
| LICM and SSA, first |  137.793 | 157.887 |     509.38–509.42 |                2,051.5 |

The combined run was 47.8% faster in this first matched comparison. The
machine also hosted other gates, so the reported CPU and cycle counts
provide an additional view of the gain.

## Optimizer candidate self-build

The candidate is the two optimizer source edits in `e730ca0fc`. Its frozen
821-file macOS source snapshot has a path-sorted source manifest SHA-256 of
`3a75057c7b573edc7f52bb701e6f0a06225cb000dc09f6ef3609d65d61d267fc`.
It was built by Node and then by stage 1 and stage 2 with
the gate lock held for each native invocation. Both LLDB inferiors stopped at
entry and exited zero. The three 50,197,002-byte signed images matched by
`cmp`, SHA-256
`c41a51b1da4aaf045a5766ea221e2032a6edaaa64e7a7526afae555b4e6f233e`.

On the shared Linux arm64 `dev` machine, `tools/gate/linux-gate.sh` at
`e730ca0fc46053870fb3f5baf3e6fa81a808c685` exited zero in 661 s. The seven
storage tests passed. The two native stages exited zero under LLDB, and the
three images matched, SHA-256
`c8d55bccbff2be25263907388d8be0b7bb0958ca7a569aec96896b618874c585`.
The self-build comparisons use the candidate's own sources for identity.
The paired performance comparisons use the common 821-file control input.

GitHub also passed the authoritative Linux x86-64 fixed-point gate for
`e730ca0fc`.
[Linux x86-64 job](https://github.com/Sequins-dev/tint/actions/runs/44883518203/job/136783887180)

Raw samples, source snapshots, probe trees, failed attempts and gate logs
are in `.tint-bootstrap/parallel-experiment.DQ4p4zZ9/` in the assigned worktree.
