# Node and native performance comparisons

Performance acceptance uses typed compiler/tooling workloads and subsystem
benchmarks. Test262 is a compatibility suite, not a performance benchmark: its
untyped JavaScript may require generalized representations and additional runtime
checks. A slower Test262 run does not establish a performance regression in typed
code. Keep compatibility results separate from performance comparisons, and retain
correct JavaScript behavior regardless of whether specialization is available.

Run `pnpm benchmark` to build the native benchmark binary, run Node's real
experimental `node:bench`, then execute the binary under LLDB. The workloads in
`benchmarks/runtime.bench.ts` import `node:bench`; Tint maps that specifier to its
synchronous subset. Node 26.9+ is needed for the actual built-in runner. The tool
uses `TINT_BENCH_NODE` when supplied, otherwise tries the current Node and installed
nvm versions. It does not change the workspace's pinned Node version.

Each workload declares its warmups and measured samples; the raw results retain
those counts. Setup and checksums
are outside `start()`/`end(operations)`. The native timer runs inside the output
binary; process startup, debugger launch, compilation and reporting are excluded.
Node runs with `yieldBetweenSamples:false` to match synchronous native execution.
The Node clock uses integer nanoseconds; the native clock converts Darwin monotonic
time to floating-point milliseconds and rounds differences to nanoseconds.
Batch operations so that timer overhead and rounding do not dominate.

The driver saves raw Node events, native output, compiler output, input/binary
hashes, environment information and `results.json` under `.tint-bench/runs`.
`--output DIRECTORY` selects a new output directory. `--baseline PATH/results.json`
compares native measurements with a prior run, rejecting incompatible workloads,
protocols, Node versions, CPUs or architectures. Node and native execution are
serial, with no competing build launched by the driver.

The primary Native/Node ratio compares mean nanoseconds per operation, including
sampled GC pauses. One is parity; higher is slower. Median, extrema, variability
and every raw sample are retained. More than 5% coefficient of variation is flagged
as noisy. Ratios alone are not statistical proof of a regression; inspect trends,
GC pauses, warmup and machine load, then repeat promising changes. The current
native benchmark heap is 32 MiB; Node uses its defaults. These different heap
policies are recorded and matter particularly for allocation-heavy cases.

Initial workloads cover fragmented first-fit allocation, indexed allocation,
full-capacity versus active-prefix inventory snapshots, and transient records.
Checksums make results observable. Native exits, missing samples, duplicate sample
indices, mismatched operation counts and failed Node runs invalidate comparison.

Microbenchmarks guide changes but do not replace full self-build measurements.
The verified `extent-index` native build took 770.28 seconds including profiling
and symbolication, and produced a byte-identical copy of its bootstrap compiler.
Its generated compiler also passed an independent smoke build. The subsequent
`bounded-snapshot` full run took 731.67 seconds including profiling/symbolication
(730.15 seconds of profile coverage), a roughly 5% improvement, and again produced
a byte-identical stage2. Its Node 24 bootstrap took approximately 11.9 seconds
from source loading to writing the image. The native/profiled to Node/unprofiled
ratio is therefore about 61x; this is not an overhead-matched benchmark. The
frozen run excludes the subsequent cell-copy and bitwise-word optimizations. The current
goal is parity with Node on the same source snapshot, debug settings and output;
record the Node version rather than mixing Node 24 build timing with Node 26
subsystem measurements.

Reference API: https://github.com/nodejs/node/blob/main/doc/api/bench.md.

## Frozen workloads

`tools/frozen-workload.ts` measures generated code on a fixed workload: the
compiler source frozen at one commit, compiled by the current toolchain,
compiling that same frozen source. `freeze <name>` writes
`.tint-bootstrap/workload-<name>`, `build <name> <label>` builds
`native-<label>`, and `run <name> <label>... --rounds N` and `node <name>` time
interleaved runs. Each run's output must match the Node reference `out-node`
byte for byte; compare SHA-256s before reading the timings. The output depends
on the workload's absolute path, so rerun `node <name>` for a reference after
copying a workload elsewhere.

`v7` (frozen at `7e83194c1`) is the supported workload. Build it with
`--runtime-tree` on both sides of an A/B: its own collector rejects the
stack-map tables current code generation emits. `v1`–`v6` are retired. `v1`–`v5`
cannot take `--runtime-tree` because the current collector imports runtime
modules those snapshots lack.

`--runtime-tree` links the tree's native runtime
(`packages/native-runtime/src`) into the frozen program instead of the
snapshot's, so runtime and collector changes are measured. The runtime shares
the host-ABI contract with the code generator that compiles it: object headers,
startup and worker records, stack-map formats, weak slots, shared blocks and C
descriptors. Those `@tint/abi` sources therefore come from the tree too. The set
is derived from imports (`tools/frozen-runtime-tree.ts`): every `@tint/abi`
module the substituted runtime files import, through package exports, plus
those modules' relative imports. The runtime's other dependencies
(`@tint/foundation`, `@tint/js-runtime`) are libraries the frozen compiler also
uses, so they stay frozen; name them with `--tree <path>` when a measurement
needs them.

Only files the snapshot already has are replaced. The snapshot's catalog is
compiled into the program and selects its input files, so it must not change.
The build prints the contract files it substitutes and every imported tree file
the snapshot lacks. A runtime module the frozen program never loads may list
some; a build that fails to resolve one needs a fresh freeze. The program's
input stays the frozen snapshot. Contract files are also part of the frozen
compiler, however, so check its output against `out-node` before comparing
timings.

## Initial comparative measurements

The repeat run in `.tint-bench/runs/2026-10-29T17-38-05.153Z/results.json`
used Node 26.10.0 and the same workload compiled to native AArch64:

| Workload                        | Node ns/op | Native ns/op | Native / Node |
| ------------------------------- | ---------: | -----------: | ------------: |
| Fragmented first-fit allocation |     2573.7 |      68757.0 |         26.72 |
| Indexed allocation              |       40.6 |       1190.1 |         29.34 |
| Full-capacity snapshot          |   162691.7 |    4795349.9 |         29.48 |
| Active-prefix snapshot          |     3430.5 |      87515.2 |         25.51 |
| Transient records               |        4.7 |       2793.2 |        600.60 |

All cases were flagged noisy. Relative to the immediately preceding identical
workload run, native means varied from 0.94x to 1.03x. These are diagnostic
baselines, not stable regression thresholds or evidence of parity. The record
case permits allocation elimination when the optimizer can prove it safe; that
is part of the optimization opportunity, not a reason to disable Node's optimizer.

Replacing modulo conversion in checked typed-array indices with hardware
conversion passed 21 native fixtures, each executed twice against JavaScript
results, including fractional, non-finite, negative and very large indices.
The first measurements did not demonstrate an overall benchmark speedup from
that local instruction change. Larger code-generation and allocation costs remain.

On the shared Mac, use `tools/gate/with-lock.sh both` for native measurements
that need timing isolation and the native launch lock. See the
[shared lock recipe](validation-gate.md#timing-and-profiling-on-the-shared-mac).

## Full self-build profiles

Choose the next performance change from a complete self-build profile. Preserve a
unique source snapshot and matching bootstrap binary for each candidate. Run one
heavy workload at a time; do not run Node/native comparisons concurrently with
profiling. Use the same debug settings and source inputs for the comparison.

Verify the native compiler under LLDB, then capture the whole self-build
with pprofessor as the sole tracer using the
[profiling recipe](profiling.md#profiling-a-verified-compiler). Record elapsed
execution time separately from profile symbolication.

Success requires all of: native exit status zero, the final output-written message,
an output binary, and byte equality with the bootstrap binary. A successful profiler
exit alone is insufficient: a previous `pprofessor run` returned zero when its child
failed. Retain raw logs, profile, source snapshot and binaries. Verify the generated
compiler with an independent smoke build before declaring the candidate usable.
Use `go tool pprof -symbolize=none` to inspect the already symbolicated profile.
Distinguish cumulative CPU samples charged to an allocation call from allocation
counts or retained-byte measurements.

The `large-reserve` candidate completed its full profiled self-build with 717.62
seconds of capture (55,464 samples), producing a byte-identical 41,470,954-byte
stage2. Stage2 also produced a smoke binary identical to Node. This is approximately
11m58s, still near the previous twelve-minute baseline; capture duration includes
attach/start overhead and is not the same measurement as an unprofiled wall time.
Its Node bootstrap took 13.1 seconds. The complete profile attributes 60.58% of
samples to allocation, including 36.34% in collection and 19.78% in allocator
placement. Memory-management work remains the priority. The frozen snapshot
precedes the reference-slot and relocation-planning additions.

## Two-space copying integration

The `source-copying-v1` snapshot contains 116 source files. Its Node bootstrap took
12.4 seconds and produced a 42,085,930-byte compiler. A complete profiled native
self-build exited zero and produced byte-identical stage2. Stage2 then compiled
the smoke project to a 1,987,306-byte executable matching Node's output, which
executed with status 42 under LLDB. Evidence and hashes are in
`.tint-bootstrap/copying-v1-verification.json`.

`.tint-bootstrap/profiles/copying-v1-full-run.pb.gz` contains 36,527 samples across
489.04 seconds of capture (approximately 8m09s). Capture began while stopped at
entry and includes the short pre-continue interval; this is not an unprofiled wall
measurement. The previous successful capture was 705.87 seconds. The <=60 second
acceptance goal remains unmet.

General extent placement and inventory sorting disappear from the dominant
hotspots. The allocation callback accounts for 37.27% cumulative samples, evacuation
preparation 30.84%, object scanning 28.18%, field scanning 23.07%, IR verification
10.25%, and SHA-256 about 11.1%. These nested cumulative percentages overlap and
must not be added. One sparse-list specialization alone has 5.54% flat samples.

The profile motivated a fixed-size Uint32Array schedule and state for SHA-256.
A same-source Node/native code-page benchmark (4 KiB input, 16 hashes per sample)
records raw data in `.tint-bench/runs/copying-sha-baseline` and
`.tint-bench/runs/copying-sha-words`. Native median per-page time changed from about
2.637 ms to 1.815 ms; Node medians were about 42.3 and 39.3 microseconds. Both hash
runs are flagged noisy, and this does not establish a whole-build improvement.
All digest bytes are checked against independent vectors in native construction
fixtures, alongside Node crypto comparisons. The subsequent `inline-v4` full profile below includes the typed-word change.

## Inlining and integer propagation

The complete `inline-v4` profile captured 444.52 seconds and 35,007 samples.
Stage1 and stage2 were byte-identical at 42,482,970 bytes; stage2 built a matching
2,003,818-byte smoke executable, which exited 42 under LLDB. Reproducibility hashes
are in `.tint-bootstrap/inline-v4-verification.json`. Capture includes the short
initial debugger pause and is not an unprofiled wall-time measurement. The profile
still attributes 40.52% cumulatively to allocation, including 33.51% collection;
SHA-256 accounts for 4.31%. Later block-local word propagation and paged arrays are
not included in this snapshot.

The `paged-list-before` and `paged-list-after-v2` benchmark artifacts use the same
workload including dense object-array reads. Their native mean read costs were
229.7 and 108.1 ns per element; the latter was flagged noisy. These observations
justify full-run evaluation, not a claim that the self-build target is reached.
The page implementation stores eight values per AVL node with a presence bitmap
and a traced one-page cache. Its complete profile captured 510.53 seconds and
35,689 samples. Stage1/stage2 were byte-identical at 48,952,426 bytes and stage2
compiled a matching 2,037,114-byte smoke binary that exited 42. Type assignability
rose to 26.67% cumulative samples, with relation solving at 19.52%; these overlap.
The added generic layout complexity outweighed the storage improvement. The
workspace therefore restores per-element AVL storage. The experiment remains in
its frozen snapshot and `.tint-bootstrap/paged-v1-verification.json`.

The verified `record-facts-v1` and `constant-facts-v1` full captures were 448.32 and
443.71 seconds respectively. Both produced byte-identical stages and runnable,
matching stage2 smoke outputs; per-candidate verification JSON contains hashes.
These runs do not establish a substantial whole-build speedup. The latter profile
still charges 38.59% cumulatively to allocation, including 31.38% collection, and
7.92% flat to the authorized-memory reader. Subsequent inline allocation changes
are outside those frozen source snapshots and require their own full profile.

## Inline allocation

The complete `inline-allocation-v1` capture spans 420.03 seconds and 29,579
samples. Stage1 and stage2 are byte-identical at 43,179,146 bytes. Stage2 compiled
the independent smoke project to the same 1,987,402-byte image as Node and stage1;
it exited 42 under LLDB. Hashes and results are recorded in
`.tint-bootstrap/inline-allocation-v1-verification.json`. The Node bootstrap took
12.0 seconds. Profile duration includes the short initial debugger pause; it is
not a clean unprofiled wall-time measurement. Small development checks also ran
during capture; no other native build or benchmark ran concurrently.

The slow allocation callback no longer dominates ordinary allocation. Collection
preparation remains 34.29% cumulative, object scanning 31.52%, and field scanning
25.75%; these overlap. The authorized reader is 9.06% flat. IR verification is
7.00% cumulative and SHA-256 6.19%. One sparse-list lookup specialization alone
accounts for 6.26% flat. The one-minute goal remains unmet. Subsequent closed-module
layout-effect proofs and record-verifier scratch reuse are not in this snapshot.

The subsequent `stable-layouts-v1` capture spans 406.39 seconds with 28,226
samples. Its 43,014,218-byte stage2 matches stage1 byte-for-byte and independently
produces the matching 1,987,402-byte smoke image, which exits 42. The verification
JSON records hashes. The next `inline-cells-v1` experiment also self-hosted and
passed stage2 smoke, but its capture was 418.73 seconds with 29,507 samples. Its
43,063,034-byte stages and 2,003,306-byte smoke images match within that candidate.
Inline cell reads were reverted because the complete run did not establish an
improvement. These captures include debugger startup and brief development checks.

The next candidate changes initialization analysis to an affected-block queue and
liveness storage to flat numeric matrices. A reverse-chain regression rejects
the previous quadratic sweep behavior; cyclic-graph oracle tests and a 600-graph
full/projected liveness differential check pass. The first `dataflow-v1` capture
spans 417.92 seconds. Its queue unnecessarily rescheduled shared exception handlers
when only normal output changed. The corrected `dataflow-v2` separates those edge
states, hoists edge masks, and correctly intersects normal and exceptional states
when both reach the same successor. Its complete capture spans 395.65 seconds with
27,822 samples. The 43,012,682-byte stages match byte-for-byte; stage2 independently
produces the matching 2,004,202-byte smoke executable, which exits 42. Hashes are in
`.tint-bootstrap/dataflow-v2-verification.json`. Collection still accounts for
34.35% cumulative samples. This remains far above the one-minute target.

The `generational-v1` complete profile captured 318.26 seconds and 22,165 samples.
Its 43,427,674-byte stages match byte-for-byte; stage2 independently compiles the
expected 2,171,018-byte smoke binary, which exits 42. The verification JSON records
hashes. Minor preparation accounts for 4,101 cumulative samples, major preparation
356, and commit 429; collection overall accounts for 22.04%. Sparse-list lookup,
IR verification and type relations remain substantial. Native fixtures also validate
old-to-young record and captured-cell mutations, queue overflow, and failure controls
for both collection paths and missing barriers. The generational runtime is retained
as the project default; the one-minute goal is still unmet.

The `list-cache-v1` experiment captured 370.14 seconds and 26,863 samples. Its
44,071,642-byte stages match; stage2 produces the expected 2,171,018-byte smoke image,
which exits 42. The one-entry sparse-list cache was reverted: the whole run does not
justify its added layout, mutation and tracing costs. Proven-word integer-predicate
folding remains; native Number predicate fixtures pass for finite, nonfinite,
fractional and word-converted inputs.

The next `proof-loops-v1` candidate adds range bit-vector intersection with edge facts
outside the word loop and relation-cache growth as the type table expands. The latter
has a regression demonstrating completed queries no longer reread type definitions
after substantial append growth. The `proof-loops-v1` full capture spans 325.01 seconds and 22,881 samples;
43,444,378-byte stages match, and stage2 produces a matching 2,171,018-byte smoke
executable exiting 42. This does not establish an overall speed improvement.

`record-flow-v2` adds closed-program record layout inference and private validated
relation queries. Its complete capture spans 380.81 seconds with 27,184 samples;
43,081,834-byte stages match, and stage2 produces the matching 2,171,018-byte smoke
executable exiting 42. The new inference pass itself accounts for 8.52% cumulative
samples, largely global numeric-key lookup. The next candidate uses direct indexing
for compact per-function value IDs, retaining a sparse fallback, and removes null
guards after already checked reference unwraps. The bounded solver and sparse-ID
regressions pass. The `record-flow-dense-v1` full capture spans 328.19 seconds and
22,891 samples; its 43,081,834-byte stages match, and stage2 produces the matching
2,171,018-byte smoke executable exiting 42. The best successful full capture
at that point remained generational-v1 at 318.26 seconds.

A temporary Node-only counter run of the full compiler workload recorded 37,882,905
relation calls, 22,653,207 direct-cache hits, and 16,534,937 replacement collisions
across 12 type systems. The three busiest systems reach the 65,536-entry cap.
These counters describe the complete workload, not native CPU timing; their capture
is `.tint-bootstrap/relation-cache-statistics.json`. Instrumentation was confined to
temporary built JavaScript and restored after the run; source snapshots exclude it.

The `relation-capacity-v1` experiment increases the per-type cache ratio and cap.
Its full capture spans 336.35 seconds and 23,779 samples; 43,081,834-byte stages
match, and stage2 produces the matching 2,171,018-byte smoke executable exiting 42.
No overall improvement is established, so the capacity increase was reverted.
The next candidate reuses completed scalar field relations within the bounded
field prover and preserves integer-array payload facts in native code generation.

The `field-word-proofs-v1` full capture spans 311.32 seconds and 21,794 samples.
Its 43,131,466-byte stages match, and stage2 produces the matching 2,171,018-byte
smoke executable exiting 42. This is the best successful complete capture so far,
but remains above the one-minute target. It includes completed scalar field proof
memoization and local integer-array payload facts. The next candidate extends
numeric proofs across slots and block boundaries with a bounded fixed-point pass.

`word-flow-v3` adds the cross-block numeric possibility solver. Its complete
capture spans 325.62 seconds and 22,746 samples; 43,280,522-byte stages match,
and stage2 produces the matching 2,171,018-byte smoke executable exiting 42.
The complete run does not establish an overall improvement over field-word-proofs-v1.
The next candidate adds direct-call return facts and dormant marker-6 vector tracing.

`word-returns-v2` adds direct-call numeric return facts and dormant marker-6
tracing support. Its complete capture spans 332.13 seconds and 23,379 samples;
43,346,570-byte stages match, and stage2 produces the matching 2,187,530-byte smoke
executable exiting 42. No overall speed improvement is established. The retained
best complete capture remains field-word-proofs-v1 at 311.32 seconds.

Reference-vector IR allocation/read/write/length and GC integration now have
independent native gates. They are not yet used by source arrays and have no
claimed self-build speed benefit. Dense reference-list lowering is the next larger
representation experiment, with the sparse tree retained for high sparse indices.

`reachability-v2` adds closed-world function and descriptor pruning after scalar
optimization. Its full capture spans 351.93 seconds and 25,382 samples. The
38,361,994-byte stage1 and stage2 match; stage2 builds the matching 1,814,426-byte
smoke executable exiting 42. A smaller output did not establish a time improvement.
The profile still contains substantial sparse-list lookup and generational scanning.
The next candidate prunes before scalar optimization, shares unchanged IR blocks
during remapping, and permits typed-array local aliases in bounded inlining.

`early-prune-v1` completed with a 319.05-second capture and 22,253 samples, but
the bootstrap command accidentally omitted debug symbols. Its 27,674,506-byte
launcher therefore differs from the debug-enabled rebuild. Rebuilding the exact
frozen compiler under Node with debug symbols produces the identical
38,394,938-byte stage2, and its 1,814,426-byte smoke matches and exits 42.
Local re-symbolization using the matching debug binary is incomplete, so this
capture is not an equivalent replacement for the fully symbolized reference runs.
The next candidate restores debug symbols and retains completed optimization
phases when a later phase exhausts its analysis budget.

`phase-checkpoints-v1` restores a fully symbolized bootstrap and retains completed
optimizer phases at budget exhaustion. Its complete capture spans 330.74 seconds
and 23,395 samples. The 38,395,034-byte stages match; stage2 builds the matching
1,814,426-byte smoke exiting 42. No overall speed improvement is established.
The next candidate removes repeated static descriptor validation under the
compiler-verified managed-mutator contract, retaining dynamic reference checks.

`verified-descriptors-v1` removes static descriptor validation under the verified
managed-mutator contract. Its complete capture spans 310.51 seconds and 21,606
samples; the 38,411,962-byte stages match, and stage2 builds the matching
1,831,338-byte smoke exiting 42. This is the lowest successful capture
recorded so far, but the small difference from field-word-proofs-v1 does not
establish a robust speed improvement. Sparse-list lookup and GC remain substantial;
the one-minute target is unmet. Independent moving-GC and remembered-queue-overflow
fixtures also pass twice under LLDB with the descriptor capability enabled.
