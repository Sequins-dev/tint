# Branch directly on comparison flags

A final comparison whose only consumer is the block terminator now branches on
its existing AArch64 flags. Verified SSA values cannot escape their block, so no
whole-program use analysis or source-type assumption is needed. Other uses and
optional multiword comparisons keep their boolean carrier. Both fallthrough
layouts preserve the existing floating-point conditions, including NaN, signed
zero and infinity. Conditional branch relocation retains its existing long reach.

| Matched workload | Before | After | Evidence |
| --- | ---: | ---: | --- |
| 16M production sparse-list reads, CPU median, four alternating pairs | 564.358 ms | 515.484 ms | 1.095x; instructions -7.88%, cycles -9.00% |
| Same lookup CPU range | 553.720–576.614 ms | 502.041–520.193 ms | All eight exits 42; each load retained |
| Full native compiler, CPU median of forward/reverse runs | 293.518 s | 271.409 s | 1.081x, same source |
| Same compiler, instruction median | 3,232,661,344,956 | 3,194,133,949,686 | 1.192% fewer |
| Same compiler, cycle median | 895,714,552,220 | 869,671,055,660 | 2.908% fewer |
| Four compiler `findEntry` specializations, full bodies | 119 instructions / 18 pointer-FP moves | 110 / 12 | Three CSETs and six moves disappear in every specialization |
| Canonical same-source, same-batch selection | 9/9 pass | 9/9 pass | Same sources, harness hashes, limits, resources and isolation |

| Native variant | Before CPU | After CPU | Other counters |
| --- | ---: | ---: | --- |
| addition sloppy | 218.549 s | 193.151 s | cycles -8.23%, instructions -2.00% |
| addition strict | 191.211 s | 201.305 s | cycles -3.30%, instructions -2.01% |
| call sloppy | 204.417 s | 205.326 s | cycles -1.18%, instructions -1.79% |

Compiler CPU ranges are 279.547–307.490 s and
267.088–275.731 s. Load, inferior wall time,
user+system CPU, retired instructions, cycles and final missing-CPU intervals are
in [the machine-readable evidence](native-comparison-branches-throughput-v1.json).
The six short variants may finish between CPU observer polls; no timing is
invented for them. Cumulative `elapsedMs` is not inferior execution time.

All four native compiler executions exit 0. Their stage-2 images equal the
candidate stage-1 image: **53,563,762 bytes**, SHA-256
`2b04ce2ad6d952aeae2c6a124976683d5125cd0c12fbf617d072825616ffd4da`.
Signature/DWARF verification passes in both orders. The exact 595-file source
snapshot is `1fc4d02690957a99ffeb1a6ffc97e5b8cfb895534fe61e4bddce9c5f597afb34`.
The current changed emitter matches that frozen source byte for byte; the later
Collator integration is covered by the refreshed current-main workspace gate,
not retroactively attributed to these older images. Eight native semantic runs
cover every comparison, NaN/zero/infinity, identity, saved results and moving GC.

The [before](test262-perf-comparison-branches-before-v1.json) and
[after](test262-perf-comparison-branches-after-v1.json) canonical reports use the
same candidate sources and nine-case batch. A manifest-covered conservative
emission adapter supplies the before control. It only suppresses the final
comparison flag path and verifies the emitter's exact hash before loading. Its
entire frozen file set and adapter are covered by its distinct toolchain key.
It reproduces both the original baseline42 lookup image and the full original
baseline42 stage-1 compiler byte for byte. That identical compiler already ran
twice under LLDB. This avoids weakening the runner's frozen identity checks or
misrepresenting older-source variant CPU as a matched causal ratio. The first
attempt to pair an old host directly with a different source snapshot was
correctly rejected before compilation; its empty output and error log remain.
The earlier unsupported `object` fixture spelling and source-checker narrowing
failure are likewise retained as preparation failures, before native entry.

[Native attribution v13](native-hot-functions-v13.md) separates expected compiler
work from emitted-operation overhead. Matched selected compiler windows contain
3,456 before and 3,133 after exclusive main-thread samples. Different phase
positions make their shares contextual, not per-function causal speedups.
The complete hot-function table retains A2 and B/D eval preparation profiles.

The refreshed analysis covers 702 result journals, with input hashes. Managed
v19 has 3,787 recorded batches and a 194.643-second median; shared-image v4 has
2,358 batches and a 14.587-second median. At observed occupancy v19's weighted
compilation-only extrapolation is 143.478 hours for 103,264 variants, compared
with v4's 21.433 hours. These include overlapping/interrupted workloads and host
contention; execution wall time is unavailable in historical journals. Execution
batch compilation accounts for 272.165 of 274.053 recorded v19 compile hours.
No whole-suite elapsed-time forecast follows from this operation benchmark or
the native compiler speedup: canonical batch compilation still executes in Node.

The final `tint-check` passes 4,829/4,829 tests, types, boundaries and formatting.
Native self-builds use `selfbuild-perf 1`, short fixtures run directly under LLDB,
and canonical selections use shared `runner 8` sequentially. Every launch asserts
initial stop and the actual final state. Limits and the journal schema are
unchanged. All failed/pre-entry observations, heartbeats, STALL lines, immutable
inputs and measurements are retained. This overlapping nine-case selection adds
no unique coverage denominator.
