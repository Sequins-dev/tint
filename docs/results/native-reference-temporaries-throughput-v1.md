# Volatile pointer temporaries between safepoints

Verified block-local reference values now use **x4–x8** until their last use before
any safepoint or opaque operation. Incoming arguments have already reached their
homes, and the audited transparent kernels preserve this bank. Values spanning
allocation, call arguments, opaque results and address-exposed locals retain
ordinary traced storage. Numeric allocation keeps its original plan; exhaustion
of the additional reference analysis falls back to that complete plan. No
resource limit, specialization cap or language guard changes.

| Same-source dependent pointer loop, four alternating pairs | Before | After |
| --- | ---: | ---: |
| CPU median | 520.952 ms | 240.079 ms |
| CPU range | 500.849–534.056 ms | 232.628–246.466 ms |
| Inferior-wall median | 575.952 ms | 295.681 ms |
| Retired instructions, median | 2.868 billion | 2.516 billion |
| Cycles, median | 1.550 billion | 0.708 billion |

This is **2.17× lower CPU**, **12.3% fewer instructions** and **54.3% fewer cycles**.
The loop follows a two-node cycle through 50 million unchanged checked reference
reads. Removing temporary-root stores/reloads shortens its dependent pointer
chain. Each of eight fresh LLDB processes stops at entry and exits 42. Inputs,
image/source hashes, loads, rusage intervals and counter uncertainty are retained.

A separate 100-million-read numeric-value loop is a negative performance control:
CPU medians **716.082→721.375 ms**, with overlapping ranges; cycles are effectively
flat while instructions fall **28.5%**. It does not establish a CPU improvement.
The intermediate FP-bank design worsens that loop's median CPU by 6.8%. Those
results are retained, not substituted with the stronger pointer result.

The full native compiler compiles the exact same **587-file frozen source
snapshot** `b38478cf…591e9` under both emitters. Both executions exit 0 and emit the
identical **54,168,482-byte candidate stage image**, SHA-256
`8a45b43140bc6f17725932b249a8928956a2ca9ce139be40c7533efb365e006a`.
The candidate reaches its own fixed point; signature and DWARF checks pass.

| Matched native compiler, one pair | Before | After |
| --- | ---: | ---: |
| Inferior CPU | 307.033 s | 312.309 s |
| Inferior wall, stop to exit | 316.403 s | 336.219 s |
| Retired instructions | 2,968,854,691,489 | 2,839,570,517,038 |
| Cycles | 915,644,388,173 | 848,526,901,161 |

The compiler retires **4.35% fewer instructions** and uses **7.33% fewer cycles**,
but this pair does not establish a compiler CPU/wall improvement. No stable
compiler CPU speedup or full-suite ratio is claimed. The sampled generational
reader, unchanged by numeric parameter captures, falls **850→820 static
instructions**, **184→174 loads**, **254→224 stores**, retaining its one call.
Counts cover all paths and contiguous ARM64 addresses, not hardware retirement.

The complete canonical selection passes **8/8**: A1 addition, boolean/wrapper
addition, signed-infinity division and strict-equality ReferenceError handling,
each sloppy and strict. Test/harness hashes, outcomes, strictness goals, fresh
processes, resources and 300-second containment match the two disjoint retained
baseline reports. A1 receives **240.395/263.597 CPU seconds** in this candidate
configuration. The embedded compiler snapshots and batch compositions differ
between historical canonical reports, so their timings are context rather than a
causal codegen speed comparison. No overlapping coverage totals are added.

Eight additional LLDB semantic processes exit 42 with moving copying collection,
references evaluated before allocating arguments, locals and typed-array handles
spanning churn, and pointer values live while private remainder/uint32 kernels
compute indices. Unit tests cover integer-bank capacity, numeric priority,
address/opaque boundaries, retained exception roots and analysis exhaustion.
The existing block-exit cleanup already clears cached homes; a new control guards
against mappings leaking into later opaque temporaries.

The intermediate FP design's complete report remains **6/8**, retaining both A1
post-entry timeouts (including 271.1 CPU seconds for sloppy). Its native stage
images also compare identically. Earlier unsupported fixture syntax, explicit
bootstrap traversal guards and a pre-compilation manifest race are retained as
pre-entry preparation failures. None is a native semantic pass or authorization
stall. The first integrated gate's failure is retained too: reduced code now
fits an async-template fixture under the unchanged **262,144-byte** budget. The
updated test asserts that success and preserves rejection-before-publication
with a deliberately smaller allowance and the existing exact-boundary control.

The final integrated gate passes **4,725/4,725**, types, boundaries and formatting.
[The JSON](native-reference-temporaries-throughput-v1.json) retains full native
observations, canonical journals, all controls/failures, exact frozen identities,
raw profiles, reproducible builders and gate logs. No new runner mode or schema
is introduced. Whole-suite hours are not projected from the pointer loop: the
suite's execution mix is unknown and fixed Node-hosted batch compilation remains
a separate dominant cost.
