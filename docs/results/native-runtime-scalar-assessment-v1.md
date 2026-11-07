# Reusable-module scalar registers: hold the candidate

The broad scalar-register promotion is **not merge-ready**. It improves a real
copying-GC tracing workload by 13%, but addition A1 sloppy still times out under
the unchanged canonical budget after the lower-load recheck. No production code
is included in this report branch.

| Sequential reserved recheck | Load at native entry | Inferior CPU seconds | Outcome |
| --- | ---: | ---: | --- |
| Addition A1 sloppy | 14.89 | 252.859 | Timeout |
| Addition A1 strict | 13.84 | 219.341 | Pass |
| Call A1 sloppy | 15.17 | 184.794 | Pass |

The queued shared-runner command was cancelled before launching any runner or
inferior. These three new immutable, single-variant reports used the explicitly
reserved `runner-perf 1` slot sequentially. Each began with one-minute load below
20 and retained the original 300-second timeout and resource settings. The final
unobserved CPU interval is at most 0.111 seconds per process. All three previous
contention timeouts remain in the original complete 6/9 report; the rechecks do
not rewrite it. There are no semantic failures, unsupported cases or crashes.
The coordinator may restore the shared cap to eight after this completed window.

The candidate enables the existing numeric/boolean callee-saved-slot proof for
reusable modules. It does not move references or remove GC roots. Four alternating
tracing pairs give CPU median **503.412 -> 445.371 ms** (1.130x), with ranges
500.798–506.188 and 442.477–450.264 ms. Cycles fall 11.7%; retired instructions
increase 1.63%. Eight moving-GC/scalar semantic checks and eight tracing benchmark
checks exit 42 under LLDB. These are bespoke fixtures, not Test262 coverage.

Both full native compilers compile the same sealed 591-file candidate snapshot.
The two outputs and the candidate's stage-1 image are identical: 54,351,282 bytes,
SHA-256 `4e879fed2b0525b1d218fede6b6a8f88b93bcfc7a627e8c4518530ac496a8dc5`.
Signature and DWARF validation pass. CPU is 406.033 -> 702.534 seconds and wall
623.685 -> 1779.132 seconds across very different host-contention windows; these
numbers do not establish a causal CPU regression or gain. Retired instructions
increase 0.856% and cycles increase 6.45%, so the full workload does not validate
the operation benchmark's benefit. No whole-suite speedup is claimed.

Complete-body static counts expose a tradeoff: `resolveReference` grows from
4,843 to 4,925 instructions while loads fall 1,084 -> 958 and stores 2,206 -> 2,002;
its 12 calls remain. The small `copying.read` closure instead grows 533 -> 562
instructions and 127 -> 136 loads (stores 143 -> 138, one call). Broadly enabling
callee saves can therefore add cost to short paths. Any follow-up needs a narrower
measured cost model rather than assuming every scalar register home is a win.

[Machine-readable evidence](native-runtime-scalar-assessment-v1.json) records
frozen toolchains, source snapshots, manifests, exact loads, counters, static
counts, all complete journals, queue cancellation and driver exit records.
Focused codegen tests (303) and types pass. A full candidate gate was deliberately
not queued because native outcome equivalence remains incomplete.
