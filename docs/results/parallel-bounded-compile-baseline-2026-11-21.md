# Parallel and bounded-memory compiler baseline, 2026-11-21

## Frozen workload and method

- Tint `f3540ae628bcee2d68fe2d3c86e60f6270aa83eb` on macOS 26.6.2
  (25G83), arm64, Mac17,7, 128 GiB RAM, 6 performance and 12 efficiency
  cores. Node 24.12.0. `TZ=UTC`, release images, default storage
  selection, default native managed extent (4,294,966,272 bytes).
  The observed Node run used its default V8 heap limit, 4,496,293,888 bytes.
- The clean Node bootstrap captured 796 catalog files. Both measured
  compilers built that same tree. Its manifest, made with
  `find . -type f | LC_ALL=C sort | xargs shasum -a 256` from the snapshot
  root, has SHA-256
  `ab4de32973bf338983c38071c18ed561872c27d9aca25077b77bd00d5c71053f`.
- The clean control used
  `TZ=UTC /usr/bin/time -l node tools/bootstrap-compiler.ts stage1 --snapshot source`.
  The measurement copy added a stage-report callback to the AArch64
  application request in `build.ts` and passed it through
  `native/index.ts` into `prepareObservedCollectionRuntimes`. Probe
  locations are identified in the table. The callback observed completed
  intervals and retained no graph or IR snapshots. Node rebuilt the
  measurement copy with `pnpm build`. The Node-hosted measurement used
  `tools/bootstrap-compiler.ts node-probe.bin --source-root <frozen source>`
  from that copy. The native probe seed was built from the same measurement
  copy under Node with an 8,192 MiB old-space limit for preparation only.
  The native measurement used that seed under LLDB on the pristine frozen
  input. Both measured runs held the timing lock. Native also held the
  exclusive gate lock. The host was shared with other validation work,
  including the preparation build during part of the Node measurement.
- Node used `hrtime` and `process.cpuUsage()` at its report callbacks.
  Native stderr markers were read through a file polled at 5 ms intervals.
  The native inferior stopped at entry, then ran with ASLR enabled under
  LLDB to a one-shot breakpoint at the dyld `exit` shim. The controller verified
  exit status zero after resuming. The process sampler polled both hosts
  using `proc_pid_rusage` (V0 for Node, V4 for native) with a
  10 ms sleep, timestamped in the `CLOCK_MONOTONIC_RAW` timebase. Native CPU is interpolated between
  adjacent user + system samples, converted from Mach ticks (125/3 ns on
  this machine). CPU includes collector and other process threads.
- Wall and CPU are interval durations. RSS is maximum sampled
  instantaneous resident size in that interval and includes resident
  runtime and garbage-collector pages from earlier stages. Node also
  recorded RSS at the stage boundaries. The shortest native intervals
  have relatively high timing uncertainty. Per-stage sampled RSS is a
  lower bound, and it differs from V8 live heap, old space and Darwin
  physical footprint. The Node runs also provide the kernel's
  whole-process maximum RSS and hardware cycle count. This is one matched
  pair with probes, so the comparison gives a baseline for sizing and
  prioritization. Measure timing variance with repeated interleaved runs on
  an otherwise idle host.

## Stage measurements

| Stage                                              | Node wall (s) | Node CPU (s) | Node peak RSS (MiB) | Native wall (s) | Native CPU (s) | Native peak RSS (MiB) |
| -------------------------------------------------- | ------------: | -----------: | ------------------: | --------------: | -------------: | --------------------: |
| Source read                                        |         0.105 |        0.053 |               153.7 |           0.126 |          0.071 |                 100.5 |
| Input decode, graph discovery and scan             |         0.792 |        1.573 |               342.4 |           1.111 |          1.125 |                 380.8 |
| Build allocator                                    |         0.265 |        0.595 |               402.3 |           0.078 |          0.075 |                 392.3 |
| Build runtime                                      |         1.579 |        4.260 |               872.9 |           0.712 |          0.769 |                 430.3 |
| Application dispatch and module reload/parse       |         0.636 |        1.337 |               917.3 |           0.666 |          0.754 |                 471.0 |
| Source link and local bind (before merged bind)    |         0.341 |        0.836 |               965.5 |           0.250 |          0.376 |                 522.0 |
| Merged bind and global normalization               |         0.196 |        0.507 |              1028.0 |           0.093 |          0.090 |                 522.0 |
| Initial bind and specialize                        |         0.787 |        1.463 |              1086.8 |           0.522 |          0.872 |                 688.8 |
| Initial check and realm demand                     |         3.836 |        5.403 |              1278.3 |           4.099 |          4.254 |                 839.0 |
| Collection demand and reification                  |         0.103 |        0.207 |              1283.8 |           0.074 |          0.073 |                 839.0 |
| Helper specialization                              |         0.994 |        1.749 |              1346.8 |           0.523 |          0.748 |                 972.4 |
| Instance transform and syntax hashing              |         0.470 |        0.716 |              1482.7 |           0.330 |          0.594 |                1109.2 |
| Instance check and demand validation               |         4.237 |        5.280 |              1732.5 |           4.095 |          4.367 |                1333.7 |
| Lower closure and scalar IR                        |        12.635 |       19.332 |              2284.0 |           8.586 |          9.019 |                1748.2 |
| Optimize, including pruning                        |       205.313 |      195.152 |              3323.0 |         107.896 |        114.919 |                1955.8 |
| Codegen, including module facts and patch planning |        73.618 |       92.496 |              4001.2 |          51.970 |         58.956 |                2081.1 |
| Native link and startup layout                     |         0.002 |        0.003 |             3906.4* |              ~0 |             ~0 |               1928.0* |
| Image writer, signing and publication              |         0.518 |        0.546 |              3919.4 |           0.164 |          0.159 |                1928.2 |
| **Total, sources to published image**              |   **306.427** |  **331.508** |         **4,001.2** |     **181.297** |    **197.220** |           **2,081.1** |

\* No periodic sample landed inside the stage. The RSS shown is a nearby
boundary reading. Native interpolation and marker polling limit precision
for short phases. Allocator and runtime rows each include front end through
emitter. The application rows use the finer probes. Both builds made one
collection preparation pass. No retry appeared in this self-build.

Native took 59% of the Node wall time and used 52% of its sampled peak RSS
in this pair. Optimization and codegen took 91% of Node wall time and 88%
of native wall time. Codegen had the highest sampled RSS on both hosts.
Maximum gaps between RSS samples were 27 ms on Node and 19 ms on native.

## Memory attribution

The table locates resident peaks. The structures below are the principal
contributors indicated by the active stage and the compiler's known
lifetimes. This run sampled process memory without heap snapshots.
Object-level evidence comes from the previously captured Node heap probes.
Native residency can include committed heap and collector pages after a
graph becomes unreachable. These observations cannot assign the full RSS
to the live objects at a stage boundary.
[Compiler memory](../compiler-memory.md) · [Node compilation lifetime probes](node-compiler-memory-v1.md)

| Stage                            | Main live or newly allocated structures                                                                                                                                                                                                                                                                                                                   |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read, graph discovery and parse  | Catalog input bytes, decoded UTF-16/source position tables, dependency records and temporary ASTs. The application link reloads parsed modules. Allocator and runtime build their own syntax, checker graphs, IR and emitted output before the application build.                                                                                         |
| Source link and bind             | Reachable input ASTs overlap with renamed/linked syntax. Per-module scopes, bindings, export/re-export tables, names and the merged binder indexes add to the working set.                                                                                                                                                                                |
| Check and collection preparation | Linked and specialized syntax overlaps with identity-keyed scope, type, relation and expression facts. Helper specialization adds reified type arguments, bound declarations, generated bodies and the transformed instance while still consulting parts of the previous observation. The finalized tree and its new indexes dominate the instance check. |
| Lowering                         | Checked syntax, types and expression facts overlap with closure and layout plans and growing scalar IR bodies. The old checked front end is releasable when the lowering frame returns.                                                                                                                                                                   |
| Optimization                     | Decoded function bodies, current and rewritten versions during a pass, pruning/remap indexes, call/record/effect facts, inlining candidates and analysis scratch. The store is currently an emission handoff, so it cannot eliminate this peak.                                                                                                           |
| Codegen                          | Optimized bodies and whole-module ABI/dataflow facts overlap with emitter scratch, emitted words, stack maps and fixup tables. AArch64 can read from the store for selected storage policies.                                                                                                                                                             |
| Native link and image output     | Retained module emission buffers and global placement/relocation records coexist with the final image byte array, unwind and signing records, and page/hash scratch. The single-copy link avoids the intermediate concatenated images.                                                                                                                    |

The earlier 2,252-variant Object Test262 study deliberately triggered a
collection retry. It measured the retry instance at 2,063 MiB live after
forced GC on its candidate and recorded helper specialization OOM at a
2,848 MiB V8 old-space cap. It reached emission at 2,880 MiB and the
lowest completed tested cap was 4,096 MiB. Use that workload alongside
self-compile to assess the first slice.
[Object suite retry evidence](compiler-check-memory-instances-2026-11-20.md)

## Evidence and outcome

The clean Node control completed in 381.67 s wall and 425.71 s CPU, with
3,990.7 MiB maximum RSS and 1,282.62 billion cycles. The probed Node process
completed in 306.82 s wall and 331.99 s CPU, with 4,001.2 MiB maximum RSS
and 1,041.86 billion cycles. Those process totals include Node startup and
exit. The spread between the two Node observations includes differences in
host load and measurement setup. The native interval from sources
to publication covered 696.24–696.30 billion cycles by counter sample
bracketing. The native total in the table excludes debugger work.

Both measured builds exited zero. The clean Node seed and the outputs from
both measured compilers are byte-identical by `cmp`, each 48,958,602 bytes,
SHA-256
`f20133194ffd2cdfc964852a01a3f92d71ce15b2c2d9b1be20b79b06a1fba6b7`.
The native output passed `codesign --verify --strict`. The native compiler
used for measurement was the separately built 48,975,114-byte probe seed,
SHA-256
`5a66144dd3da63023166783f90bb5865477e31e06dc4a59dcc6afe8aa610114e`.
Its instrumented source manifest SHA-256 was
`4d0d2473d644964d394cee6dd13ffa6ab0342af56ea0b695e450017d816ebb87`.

The initial clean attempt exited 1 before launching the compiler because
the gate memory directory was unset. A sampler calibration fixture's first
LLDB lock acquisition returned 75 before launch. The subsequent calibration
verified the stop, marker and exit handling. Both setup observations are
retained outside the timed runs.

Raw boundary logs, sampler streams, probe edits, source manifests, seed,
images and the LLDB transcript are retained under
`.tint-bootstrap/parallel-baseline.WBuseI3t/` in the measurement worktree.
