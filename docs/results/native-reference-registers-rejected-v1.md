# Reference locals across calls: measured and rejected

Do not merge the global reference-local promotion candidate. Its operation loop
improves, but a full native compiler workload does not validate that gain. The
production candidate was commit 11826e118 on `perf/test262-reference-registers`,
deleted on 2026-11-17; this evidence branch contains only reports.

The candidate uses spare callee-saved FP registers for single-word references
only under the existing closed-module no-safepoint proof. It preserves numeric
allocation, address-exposed storage, GC roots in allocating functions and bounded
fallback. Five focused tests and the integrated workspace gate pass. The first
gate's strict fixture type errors, their correction and the passing gate remain
recorded. All six canonical subset variants pass with identical pinned
sources/harnesses and outcomes to the numeric baseline.

| Measurement | Before | Candidate |
| --- | ---: | ---: |
| Operation CPU median, four alternating pairs | 233.026 ms | 221.182 ms |
| Operation CPU range | 231.068–234.158 ms | 220.734–221.560 ms |
| Operation retired instructions, median | 4.075 billion | 3.873 billion |
| Operation cycles, median | 610.776 million | 580.633 million |
| Full native compiler CPU, one pair | 315.922 s | 335.817 s |
| Full compiler wall, inferior stop to exit | 332.601 s | 352.340 s |
| Full compiler retired instructions | 3,023,331,343,360 | 3,021,558,069,591 |
| Full compiler cycles | 949,658,576,348 | 968,422,653,611 |

The fixed-work loop gains **5.1% CPU** and **5.0% retired instructions**, with all
eight native processes stopping at entry and exiting 42. Frozen production v18
emission reproduces those exact measured image bytes. The loop amortizes added
callee-save work over 50 million iterations. Its wall medians move in the wrong
direction under scheduling/debugger variation; CPU/counters are the relevant
measurements.

The full native compiler instead uses **6.3% more CPU** and **2.0% more cycles**
while retiring only **0.059% fewer instructions**. One pair does not establish a
stable causal regression, but it does not establish a useful real-workload win.
The sampled dense-array reader grows **143→150 static instructions**, with stack
loads **36→41** and unchanged one call. Extra save/restores on its exits offset
fewer local copies. The larger loop win cannot be projected onto this helper or
the whole suite. A better lifetime-scoped strategy should avoid callee-save costs
and retain references in volatile registers only until their last pre-safepoint
use.

Both native compilers execute the exact same sealed 587-file implementation
snapshot `69f3ae64…0378a2` and exit 0, emitting the **same 59,947,186-byte image**,
SHA-256 `9d394ffda656bc711597eb22be33e155db9f4a454084835ee6aff9922ee5145b`.
The candidate reaches its own stage-image fixed point; signature and DWARF checks
pass. The later integrated workspace gate also includes main's numeric-capture
slice; the earlier sealed native comparison does not retroactively acquire that
source. Exact provenance is retained for each observation.

[The JSON](native-reference-registers-rejected-v1.json) includes both full native
executions, hardware counters and loads, complete canonical reports/journals,
benchmark repetitions, exact production-image equivalence, disassembly with
contiguous ARM64 checks, sampled native windows and gate failures/successes.
No throughput or whole-suite improvement is claimed from this rejected change.
