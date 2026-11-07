# Bounded reference-helper inlining

The slice removes language call/result-frame traffic and retains the existing
20-million global work bound. **The single matched eval-heavy canonical pairs
have higher CPU/cycles after; this report claims compiler/list gains, not an
end-to-end eval-preparation CPU improvement.** All nine outcomes remain identical.

| Matched workload | Before median | After median | Evidence |
| --- | ---: | ---: | --- |
| 16M production sparse-list reads, four alternating pairs | 505.700 ms CPU | 396.984 ms | 1.274x |
| Same loop retired instructions | 7,689,484,962 | 7,016,443,851 | 8.75% fewer |
| Same loop cycles | 1,505,676,614 | 1,195,820,398 | 20.58% fewer |
| Native compiler, two orders | 289.359 s CPU | 276.702 s | 1.046x; both pairs improve |
| Same compiler cycles | 923,510,511,860 | 908,454,315,184 | 1.63% fewer |
| Same compiler instructions | 3,215,355,772,860 | 3,216,252,837,337 | +0.028%; effectively flat |
| Canonical nine-case selection | 9/9 pass | 9/9 pass | Unchanged JS, harness, strictness, resources and 300 s limit |

[Raw evidence](native-reference-inlining-throughput-v1.json) retains every
repetition, spread, inferior wall time, load and last-unobserved-CPU bound. CPU
is inferior user+system, excluding debugger launch. Retired counters use Darwin
`proc_pid_rusage` V4. Both compiler orders use identical signed stage-1 images
and the same sealed 600-file source. All four executions exit 0 and produce
53,728,850-byte stage-2 images equal to candidate stage 1, SHA-256
`2baf61bbf074522b5d5f0f0b3f7720f51bc4eeaff0709b0929681f2dc7696d92`.
Signature/DWARF checks pass. Native reference/GC, optimizer-budget and lookup
fixtures each have eight stopped/exit-42 LLDB observations. The full gate passes
4,843 tests, types, dependency boundaries and formatting; 254 focused IR tests pass.

| Same-source canonical variant | Before / after CPU s | Instructions | Cycles | Start load before / after |
| --- | ---: | ---: | ---: | ---: |
| addition sloppy | 210.192 / 220.782 | -0.481% | +1.135% | 11.47 / 13.94 |
| addition strict | 186.323 / 210.873 | -0.579% | +2.438% | 17.17 / 16.68 |
| call sloppy | 194.505 / 197.042 | -0.562% | +1.122% | 11.43 / 13.99 |

These are single canonical observations, not repeated CPU medians. Missing CPU
for short-lived inferiors stays null. The batch compile wall times are
106.724 s before and
118.945 s after, or
11.858 and
13.216 s per selected
variant. This is Node-hosted work and has no matched compiler-CPU measurement;
no host-compilation gain is claimed. Journal `elapsedMs` is not execution time.
The earlier all-journal context projects 143.478 compilation-only hours at its
observed occupancy for 103,264 variants; it is not updated by this small selection.

The original inliner rejected reference results and all parameter writes. CFG
expansions already use private parameter slots, so assignments there are safe;
straight-line aliases retain their conservative fallback. Results use traced
slots. Reference wraps, checked value extraction and proven record-read operands
are remapped with original exception edges. Existing scalar policy is retained.
New cases require nonallocating callers and at most 128 expansion units per caller.
No bound was raised.

A1's 4,258,396 instructions, 1,332,348 slots and 1,080,097 blocks trigger the
large-image cleanup path. Raw `findEntry` has 55 instructions/18 blocks and fails
the 64-unit expansion test. Copy cleanup reduces it to 31 instructions/18 blocks,
52 units including parameter/result work. Cleanup now precedes checkpointed
inlining; unused reserve funds incomplete functions and new expansions. Partial
callers roll back as a whole, and completed callers survive later exhaustion.
The same total work limit applies. A1 completes 3,284 inlines using 1,094,080
inliner visits. Representative real-image `readList` bodies change from two
indirect calls, 45 loads and 34 stores to zero calls, 26 loads and 18 stores.
They grow from 187 to 274 instructions because they contain the helper work.
Standalone helper symbols remain in the managed callable surface and do not
establish that calls remain.

Prototype records are retained, compressed and excluded from coverage credit.
Broad reference inlining grew allocating callers (for example
`prepareNumericModule` 193,695 to 214,007 instructions), and its reverse compiler
pair regressed instructions 0.236% and cycles 1.593%. A first size policy also
excluded old scalar candidates. The corrected policy avoids those cases. The
first large-image attempt ran before copy cleanup and left every target call;
its 145 inlines are not presented as an A1 gain. A cancelled queued repetition
and queued control runner never entered native code. Early fixture/control setup
failures and missing short-inferior CPU records remain in the assets.

The conservative before host is a separately sealed copy with both original
optimizer JS modules and an exact-hash load adapter included in its manifest.
It reproduces the original baseline compiler image byte for byte; frozen source
and journal validation remain active. [Before](test262-perf-reference-inlining-before-v1.json)
and [after](test262-perf-reference-inlining-after-v1.json) share the exact source,
selection and resources. Self-builds use `selfbuild-perf 1`; canonical runners use
one shared `runner` slot sequentially. No merge or push is performed.
