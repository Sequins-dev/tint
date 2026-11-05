# IR analysis and lowering contracts

The JSIR review motivated shared analysis infrastructure, explicit semantic
operations, and a separate SSA optimization boundary. Tint remains implemented
in TypeScript and emits machine code directly. There is no MLIR, C, LLVM, or Wasm
intermediary dependency.

## Implemented pipeline

Source checking and specialization feed scalar lowering. The frontend uses
`@tint/semantic-ir` contracts for evaluated indexed references, lazy logical
operands, and value calls. This is a focused semantic layer, not a second complete
AST or a full dynamic JavaScript frontend.

The scalar optimizer promotes eligible local slots into a whole-function SSA
view with typed block parameters and incoming edge arguments. It performs
conditional fixed-point constant propagation, then lowers the SSA view into the
backend's block-local value contract. Only changed functions are published. Promotion tracks slots that actually cross
block boundaries and reuses scratch buffers, avoiding a slots-times-blocks
allocation pattern. SSA has a 100,000-work per-function cap and a 1,000,000-work
phase cap; completed functions are retained, capped candidates remain unchanged,
and `PassStatistics.skipped` reports those candidates. These local limits preserve
budget for subsequent scalar and inlining passes. Global budget exhaustion still
discards the unfinished phase. The expanded basic pipeline defaults to 20,000,000
work units so its post-inline cleanup and final access/CFG passes have headroom.
Parameters, checked-transfer slots, exception-observable locals, and locals in
functions with opaque host operations remain explicit storage. This preserves
handler visibility and prevents speculative promotion of externally observable
storage.

Parallel edge copies share private slots for the same original variable only when
every outgoing copy from a predecessor agrees; conflicting copies keep distinct
slots. All incoming values are captured before transfers, including loop-carried swaps. Lowering
checks edge arity and agreement with terminator targets. The ordinary scalar
verifier validates the resulting definitions, types, graph and initialization.
This boundary lets the existing backend and GC root planner remain consumers of
one verified representation while higher-level optimization uses SSA.

The shared `@tint/dataflow` solver uses bounded, deduplicated work queues.
Transitive effect summaries and conditional SSA propagation both consume it.
Constant facts distinguish unvisited values, one exact constant, and unknown
values. Joins preserve NaN semantics and distinguish signed zero. Only executable
incoming edges contribute; loops run to convergence before rewrites are published.
No partial analysis is a proof, and IR mutations require fresh analysis.

## Effects and checked access

Instruction effects distinguish throwing, allocation/GC entry, reads and writes
of heap or local storage, invoking unknown code, and retaining references.
Function summaries propagate effects through recursive direct-call components.
Callee-private local effects do not become writes to the caller's slots. Opaque
host and indirect calls retain conservative effects. Unknown operations default
to all effects until audited.

Safepoint analysis consumes the allocation component of these summaries. Local
load forwarding can retain facts across allocation and proven direct calls while
preserving barriers for opaque invocation. This does not authorize arbitrary heap
load motion: the current summaries are coarse memory classes, not field-sensitive
alias analysis.

`record-read` is a value-producing instruction with a required layout proof.
The verifier independently establishes that proof from constructors or successful
checks along valid predecessor paths; a reference annotation does not suffice.
Already verified direct reads refresh layout knowledge along long predecessor
chains. Unresolved reads are revisited after new proofs, so block numbering does
not determine acceptance. A read cannot certify itself, an ungrounded cycle, or
an overwritten receiver slot; opaque effects still invalidate layout knowledge.
Cell initialization remains checked. Ordinary field reads lower directly to
machine loads, including wide payloads and large offsets. Record reachability,
operand substitution, effect analysis and native value layout know this operation.

After scalar replacement and inlining, proven checked reads become direct reads
and stores to their transfer slots. Constant-branch cleanup removes impossible
failure paths and compacts labels, retaining exceptional successors. The existing
checked record/cell operations remain the fallback when no proof is available.

## Type knowledge and representation

`@tint/semantic-ir` distinguishes declared semantic types, established variants,
and the selected storage policy. An annotation is a hint; completed analysis can
justify fixed or tagged-union storage. A speculative fact requires an active,
dominating guard whose assumptions remain valid. Empty facts never authorize
specialization. The proven-record lowering uses this selection policy with
analysis-derived layout knowledge.

Numeric facts continue to come from actual operations, ranges, and call/loop
proofs rather than trusting TypeScript's `number` annotation. This upgrade does
not make `number` an integer or allow signed-zero/NaN behavior to change.

## Boundaries and remaining extensions

AOT and future live compilation can share these modules and transformations.
The live runtime still needs guard placement, assumption invalidation, recovery
state, and generalized native continuations before speculative code can execute.
The semantic call/coercion contracts do not claim that full proxies, accessors,
`this`, or dynamic coercions are implemented by today's strict compiler.

Field-sensitive alias summaries, full cross-block register allocation, general
loop-invariant motion, richer range lattices and expanded interprocedural escape
analysis can build on these contracts. They are separate optimizations, not
implicit consequences of adopting SSA. Measure full self-builds before claiming
speedups; additional analysis also consumes compiler time.

## Self-build validation and performance findings

The `source-ir-upgrade-v6` snapshot completed a native self-build with debug
symbols and byte-identical stage1/stage2 output (35,880,762 bytes). Its generated
stage2 reproduced the frozen Node smoke image (2,045,466 bytes), which exited 42
under LLDB. The full profile, `profiles/ir-upgrade-v6-full-run.pb.gz`, captured
703.23 seconds and 53,653 samples. Artifact hashes and validation results are in
`.tint-bootstrap/ir-upgrade-v6-verification.json`. This is a regression, far above
the 60-second acceptance target; brief concurrent validation also means it is
not a quiet acceptance timing.

The complete profile attributes 26.13% cumulative samples to repeated
`stableRecordLayouts` scans and 27.54% to hash-index probing through sparse-list
storage. The verifier now computes module layout effects once per verification,
with a scaling regression test. Dense-list lowering had also exhausted its work
budget while remapping: alias proofs compared every module layout for each pair.
Reachability now exposes unique referenced layout IDs so exact set comparison
visits only those layouts, retaining all ownership and alias checks. These fixes
require fresh full native measurements; the v6 result does not validate their
performance.

The follow-up v7 capture completed in 517.59 seconds after removing repeated
layout scans. After the sparse layout-set comparison restored dense-list
lowering (4,110,162 work units; 1,934 rewrites), v8 captured 113.78 seconds and
9,152 samples. Its 31,066,762-byte stage2 was byte-identical to stage1, reproduced
the frozen smoke image, and that image exited 42. See
`.tint-bootstrap/ir-upgrade-v8-verification.json`. The v7/v8 diagnostic runs
overlapped, so these are not isolated acceptance timings. The v8 full profile
attributes 31.92% cumulative samples to collection; the 60-second goal remains
unmet.

A 128 MiB nursery cap (still limited to one eighth of a semispace for smaller
heaps) completed a 100.60-second full profile with 7,136 samples. The compiler
self-build and generated smoke output both matched Node byte-for-byte; the smoke
exited 42. Evidence is in `.tint-bootstrap/nursery128-v1-verification.json`.
Collection accounted for 24.01% of samples, so heap tuning alone does not close
the remaining gap. A shared nursery reference resolver removes duplicate
start-bitmap validation for newly discovered survivors while retaining checked
lookup for relocation. Its full self-build capture was 99.24 seconds; this small
difference is not an established speedup without repetition.

A key-index experiment returned the matching entry directly and retained the
insertion slot in scalar scratch. Its full capture was 100.09 seconds and probing
took a larger sample share. That implementation was reverted; reentrant-hash
regression coverage was retained.

The next candidate adds final slot compaction after control-flow cleanup. It
retains every parameter in ABI argument order and all explicit load/store,
guarded-transfer, and exception destinations, then densely renumbers only local
slots. Environment cells and value IDs are separate namespaces. The bootstrap
removed 101,663 unused program slots and 9,701 runtime slots without exhausting
the optimizer budget. The complete native self-build matched stage1 and captured
102.45 seconds (7,233 samples). A separate unprofiled run, without a competing
compiler or profiler, took 99.85 seconds elapsed under LLDB (99.19 user, 0.50
system), again byte-identical. Stage2 reproduced the frozen Node smoke image,
which exited 42. This does not establish a throughput benefit for slot compaction;
it reduces retained frame/analysis storage. The 634-fixture native suite is a
separate validation gate. Evidence is in
`.tint-bootstrap/compact-slots-v1-verification.json`.

To reproduce this retained timing:

```sh
/usr/bin/time -l /usr/bin/lldb --batch \
  -o "run $PWD/.tint-bootstrap/source-compact-slots-v1 $PWD/.tint-bootstrap/repeat-compact-slots --debug-symbols" \
  .tint-bootstrap/stage1-compact-slots-v1
cmp .tint-bootstrap/stage1-compact-slots-v1 .tint-bootstrap/repeat-compact-slots
```

The program backend's record-flow, word-argument, and safepoint analyses completed
for this snapshot (1,903 functions; 625 proved without safepoints). A wholesale
analysis-budget fallback is therefore not the remaining cause. Full profiles
continue to identify collection, key-index/list access, checking and lowering as
the major costs. The 60-second goal remains open.

Immutable syntax hash hints separate hash distribution from source coordinates.
Specialized copies retain their original source spans and object-identity equality,
but receive per-traversal hashes before downstream checking/lowering. Coordinate-only
IR conversion and source-location APIs retain coordinate-only parameter contracts.
The worst checker index dropped from 347,102,118 probes over 836,520 calls to
2,257,354 probes over 836,141 calls in complete instrumented Node bootstraps.

The syntax-hash-v1 complete native profile captured 83.04 seconds and 6,706 samples
(including initial stop-at-entry samples). A separate quiet unprofiled self-build
took **78.39 seconds elapsed**, 77.79 user, 0.49 system, with no swaps. Both builds
were byte-identical to the 30,535,290-byte bootstrap compiler. Stage2 reproduced
the frozen Node smoke image, which exited 42. All 1,231 workspace tests, typechecks,
formatting, and package-boundary checks passed. The full native fixture suite is
a separate gate. Evidence: `.tint-bootstrap/syntax-hash-v1-verification.json`.
Repeat the timing command above using `source-syntax-hash-v1` and
`stage1-syntax-hash-v1` with a fresh output path. The 60-second goal remains unmet.

The full profile now attributes 29.81% cumulative samples to collection, 11.60%
to IR verification, and 9.39% to type relations. Typed-array `set` lowering still
allocates a snapshot array and copies twice even for matching element types;
a bounds-checked, overlap-safe bulk copy is the next allocation opportunity.

The next candidate adds `array-copy`, a nonallocating same-encoding typed-array
transfer with a boolean range-check result. Bounds are checked before any data
access. Matching encodings share the existing forward/backward raw-byte mover;
this preserves overlapping views and floating-point bit patterns. Cross-encoding
`set` retains numeric conversion through the existing snapshot path. The current
strict frontend traps when a copy rejects its range, as before. The operation is
a heap read/write, has no allocation/safepoint, and participates in operand
visitation, substitution, type verification and native emission.

`tools/verify-typed-array-copy.ts` compares Node behavior and two native runs for
all four widths, overlaps, self/empty copies, conversions, offset normalization,
negative zero and NaN. It checks strict range traps separately under LLDB. The
shared raw mover passes 93 cases twice. All 1,233 workspace tests and checks pass.
The older construction harness currently fails before its selected copy tests;
the focused harness supplies a complete generated runtime instead.

The array-copy-v1 complete self-build capture was 84.03 seconds (6,751 samples),
and the separate elapsed run took 87.13 seconds (82.35 user, 1.42 system), with
212,868 involuntary context switches. Both builds match the 30,584,874-byte
bootstrap, and stage2 reproduced the frozen smoke binary, which exited 42.
Evidence: `.tint-bootstrap/array-copy-v1-verification.json`. **These measurements
do not establish an overall build-time benefit.** The operation removes a real
temporary allocation and supplies reusable bulk-copy infrastructure, but the
remaining collection, type-relation and verifier costs still prevent 60 seconds.

A 256 MiB nursery cap with a one-quarter semispace limit captured 79.56 seconds
(5,758 samples), then took 80.32 seconds elapsed in a separate unprofiled build
(77.34 user, 0.38 system, 1,446,658,048 bytes peak RSS, zero swaps). The fixture
runner was suspended during these measurements. Both self-build outputs match
the bootstrap. This intermediate candidate has no separate stage2 smoke result;
see `.tint-bootstrap/nursery256-v2-measurement.json`. It does not establish a
better result than the 78.39-second syntax-hash measurement.

A full Node bootstrap also found 12,725 exact repeated descriptions among 29,505
types in the large prepared graph. The next experiment shares immutable exact
descriptions and uses their representative IDs for internal relation queries,
without changing public type IDs or inferring recursive equivalence from hashes.
Hash collisions require full comparison; readonly/optional properties, child IDs,
member order and function arity remain part of the identity contract. Performance
for this experiment is not yet established.

Type-identities-v1 completed its full profile in 76.35 seconds (5,455 samples).
The separate unprofiled build took **72.82 seconds elapsed**, 72.37 user, 0.31
system, with 1,430,618,112 bytes peak RSS and no swaps. Both outputs match the
30,651,306-byte bootstrap compiler. Stage2 reproduced the frozen Node smoke
image, which exited 42. Native nursery evacuation and remembered-barrier fixtures
passed twice; all 1,236 workspace tests/checks passed. Evidence is in
`.tint-bootstrap/type-identities-v1-verification.json`.

The full 634-fixture native suite remains incomplete because LLDB intermittently
stalls before process launch, including on unchanged tiny numeric fixtures. A
saved negative-zero fixture exited correctly after a 32.32-second debugger launch
and in 0.36 seconds on a diagnostic repeat. Twenty negative-zero fixtures passed
twice with explicit standard streams. The harness now selects `/usr/bin/lldb`,
sets child streams explicitly, permits 90 seconds for debugger launch, and reports
process errors before inspecting captured output. This does not count as a full
native-suite pass and no compiler correctness claim is inferred from a timeout.

The 512 MiB nursery experiment with a one-third semispace limit captured
86.90 seconds (6,232 samples), with collection planning at 34.26% cumulative.
Its output matched the bootstrap, but it regressed throughput and was reverted
to the 256 MiB policy. The subsequent memory-mask instruction simplification
captured 78.76 seconds with identical self-build output; it does not establish
a throughput improvement.

The next candidate clears temporary GC roots immediately after their last
instruction use, preserving roots through all safepoints in that instruction.
Terminator operands remain rooted through the edge, and block-entry clearing
still handles exceptional transfers. Optional trimming-budget exhaustion keeps
the existing storage reuse plan. Twenty native root-chain fixtures and the
moving-runtime fixture pass twice; the complete self-build measurement is pending.

Early-roots-v2 completed a full 80.81-second capture (5,816 samples) and a
76.32-second unprofiled build (75.89 user, 0.33 system, 1,546,944,512 bytes peak
RSS, no swaps). Both native outputs match the 31,245,738-byte bootstrap. Stage2
reproduced the frozen Node smoke binary, which exited 42. The implementation
was reverted: the extra stores and compiler work did not establish an improvement
against the 72.82-second best run and increased peak RSS. Evidence is in
`.tint-bootstrap/early-roots-v2-verification.json`; its immutable snapshot retains
the experiment for reproduction.

The next verifier candidate skips initialization dataflow when all reads already
have local/parameter proofs. For remaining functions, its first predecessor is
copied into the incoming vector instead of intersecting an all-ones vector.
Entry blocks retain the parameter-only boundary, even with backedges; subsequent
and combined normal/exceptional edges still intersect. The reusable bit-vector
copy primitive validates bounds before mutation and preserves edge-specific bits.

Verifier-copy-v1 captured 77.60 seconds (5,563 samples), then took 73.13 seconds
unprofiled (72.63 user, 0.34 system, 1,431,207,936 bytes peak RSS, no swaps).
Both outputs match the 30,684,506-byte bootstrap; stage2 reproduced the frozen
Node smoke image, which exited 42. All 1,238 workspace tests/checks passed.
This does not establish a throughput gain over the 72.82-second best run.
Evidence: `.tint-bootstrap/verifier-copy-v1-verification.json`.

The following experiment returns whether any facts survive each range merge,
allowing the verifier to stop scanning predecessors once its must-fact set is
empty. Intersecting further incoming edge facts cannot restore a missing fact.
Tests cover preserved edge bits, high-bit words, empty vectors, and the existing
cyclic-graph fixed-point comparison. Complete native timing is pending.

Empty-meet-v1 captured 76.53 seconds (5,493 samples) and took 73.44 seconds
unprofiled (72.98 user, 0.35 system, 1,431,502,848 bytes peak RSS, no swaps).
Both outputs match the 30,684,506-byte bootstrap; stage2 reproduced the frozen
Node smoke image and exited 42. All 1,239 workspace tests/checks passed.
Evidence: `.tint-bootstrap/empty-meet-v1-verification.json`.

A subsequent complete Node bootstrap instrumented range intersections by function.
`emitModule` alone performed 1,818,689 intersections covering 368,403,203 words;
none reached an empty or singleton result. This explains why empty-set short
circuiting did not help that workload. The instrumentation was removed from
all generated modules after the run (`/tmp/tint-meet-probe.log`).

The next candidate caches incoming initialization facts in a third matrix. Each
changed normal/exceptional output intersects only its own contribution into its
successors; a successor is queued only if incoming facts actually shrink. Initial
facts remain top except the entry boundary, and normal/exceptional contributions
to the same target are still separate meets. Monotonic shrinking makes old meets
redundant, avoiding repeated high-indegree predecessor scans. The existing cyclic
fixed-point oracle and all 53 focused bit-vector/verifier tests pass.

Incremental-meet-v1 completed its full capture in 68.38 seconds (4,898 samples),
then took **67.29 seconds elapsed**, 66.88 user, 0.31 system, with 1,419,657,216
bytes peak RSS and no swaps. Both outputs match the 30,618,554-byte bootstrap.
Stage2 reproduced the frozen Node smoke image, which exited 42. All 1,240
workspace tests/checks passed. Verifier cumulative samples fell from 12.51% to
6.78%, and bit-vector intersection disappeared from the leading hotspots.
Evidence: `.tint-bootstrap/incremental-meet-v1-verification.json`.
The 60-second target and complete native-suite validation remain unmet.

A packed signed-word type-relation cache was tested next. Its complete capture
was 72.00 seconds (5,155 samples), and the unprofiled build took 69.77 seconds
(69.11 user, 0.50 system, 1,419,575,296 bytes peak RSS, no swaps). Both native
outputs matched the 30,618,666-byte bootstrap. This experiment was reverted
because it regressed the 67.29-second result. No separate stage2 smoke was run
for this rejected candidate. The snapshot and full profile are retained as
`source-packed-cache-v2` and `profiles/packed-cache-v2-full-run.pb.gz`.

The scalar-native harness now composes its independent wrappers into one signed
executable and checks each eight-byte result individually. Every wrapper retains
its own stack and FP-state restoration. Two debugger launches replace 1,268
launches without reducing fixture coverage. All 634 fixtures passed twice with
basic optimization and twice without it; the corpus includes 9,800 numeric
input/operator cases. Twenty root-chain fixtures also passed twice. This resolves
the prior incomplete native-suite gate for incremental-meet-v1.

The next liveness experiment uses a bounded predecessor work queue instead of
repeated whole-function sweeps. Heads, ring queue and predecessor links share one
numeric allocation; normal and exceptional dependencies are both included. A
reverse chain now converges within a linear test budget. No partial result is
published on exhaustion. Full native measurement is pending.

Queued-liveness-v1 captured 72.73 seconds (5,207 samples); v2, which also skips
dead-root work for live-only queries, captured 73.66 seconds (5,257 samples).
Both produced byte-identical self-build output; no unprofiled elapsed result or
separate stage2 smoke is claimed for these intermediate candidates. The liveness
pass became cheaper locally, but complete compilation did not improve. Comparing
symbols found expanded generated storage/code in a few large functions.

The following SSA lowering candidate coalesces private block-parameter slots by
original variable when all copies from each predecessor agree. Conflicting
conditional copies retain separate slots. Inputs are loaded before writes, so
parallel swaps remain valid. The coalescing candidate reduced its bootstrap image
from 30,981,914 to 30,767,258 bytes and passed all 1,243 workspace tests/checks,
including agreeing/conflicting edges and loop swaps. Full native timing is pending.

SSA-coalesce-v1 captured 69.04 seconds (4,962 samples), with byte-identical
self-build output. V2 additionally removes duplicate agreeing edge stores; it
captured 86.24 seconds (6,564 samples) and took 70.94 seconds unprofiled (69.09
user, 1.55 system, 1,469,677,568 bytes peak RSS, no swaps). A contemporaneous run
of the saved incremental-meet-v1 binary took 71.04 seconds, also byte-identical,
versus its earlier 67.29 seconds. `syspolicyd` was consuming substantial CPU
around these measurements; the evidence does not establish a clear v2 latency
improvement or regression against that control.

Both SSA-coalesce-v2 outputs match its 30,734,234-byte bootstrap. Stage2 reproduced
the frozen smoke image, which exited 42. All 634 optimized native fixtures passed
twice after the harness began stopping at entry before continuing. Earlier retries
failed with an LLDB attach error before execution; these are not counted as passes.
All 1,243 workspace tests/checks passed (the README formatting warning was fixed
and formatting rechecked). Evidence: `.tint-bootstrap/ssa-coalesce-v2-verification.json`.

The next GC candidate retains the classification already decoded while checking
an object's extent. Pointer-free strings and owned/borrowed numeric arrays need
no second edge scan; array fixup selection reuses the classification rather than
reading every survivor header again. Views, vectors, and records still scan their
edges, and array backing relocation remains checked. Four alignment bits in the
existing size queue hold temporary kinds; successful preparation restores exact
aligned sizes before publication/commit. This avoids a separate queue allocation,
which the native nursery probe showed would exceed the 64 KiB startup control
allocator. Header decoding tests, native survivor/vector evacuation and moving
collection probes pass; complete build timing is pending.

Header-kinds-v2 completed its full profile in a 70.44-second capture (5,054
samples). The separate unprofiled self-build took 71.12 seconds (67.76 user,
1.05 system, 1,485,946,880 bytes peak RSS, no swaps). Both outputs match the
30,750,746-byte bootstrap. Stage2 reproduced the frozen smoke image, which
exited 42. All 1,245 workspace tests/checks and native nursery/moving collection
probes passed. This reduces repeated header reads, but the measurements do not
establish an overall latency improvement. GC remains 31.56% of full-run samples.
Evidence: `.tint-bootstrap/header-kinds-v2-verification.json`.

The same profile attributes numeric-set lookup work to checker fact propagation.
Inspection found `refine` eagerly cloning its input before delegating to negation,
short-circuit, effect, and specialized narrowing paths that discard that clone.
The next candidate defers the copy to the fallback that actually uses it. A
regression test compares equivalent conditions with eight extra negations: it
previously made 21 set copies versus 5; after deferral the counts agree. All 158
checker tests pass. Full self-build measurement is pending.

Deferred-facts-v1 captured 69.95 seconds (5,040 samples); its quiet run took
70.15 seconds (66.97 user, 0.99 system, 1,395,359,744 bytes peak RSS, no swaps).
Both self-builds match the 30,750,746-byte bootstrap. Stage2 reproduced the frozen
smoke image; that image is also byte-identical to the already executed
header-kinds-v2 smoke (exit 42). Launching the deferred smoke pathname failed
before execution with the intermittent LLDB attach error, so no independent
execution at that path is claimed. Evidence:
`.tint-bootstrap/deferred-facts-v1-verification.json`.

Set construction from another Set still performed duplicate membership searches
for every inserted member, making copies quadratic with the linked runtime.
The next candidate adds a linear `cloneSet` operation and a validated optional
clone binding through runtime preparation and lowering. Only identical checked
element contracts select it; other constructor inputs retain element traversal
and conversion. The shared append primitive preserves independent links and order
without membership probes. Tests cover linear source visits, identity, special
numeric values, deleted/reinserted order, independent mutation and helper ABI
validation. All 1,249 workspace tests/checks pass; native timing is pending.

Set-clone-v1 completed a full 68.91-second profile capture (4,928 samples), with
byte-identical self-build output. The separate quiet run took 71.64 seconds
(68.49 user, 0.98 system, 1,447,952,384 bytes peak RSS, no swaps), again matching
the 30,735,002-byte bootstrap. Numeric `hasSet` fell from 2.76% to 2.27% of samples,
but elapsed time does not establish an overall speedup. The native hosted probe
passed twice, including 32,768 copies under the 4 MiB active-heap budget, order,
NaN, canonical zero, object identity, readonly views, one-time argument evaluation,
and independent mutation. Full workspace checks pass (1,249 tests).

A subsequent experiment groups the GC reader's eight captured bounds into one
immutable record. Short-circuit range selection then loads only the needed fields;
the authorized windows and raw word validation are unchanged. The full-run profile
attributes 8.30% of samples to the reader, including capture unpacking. Bootstrap
and workspace checks pass; native validation and timing are pending.

Set-clone-v1 stage2 also reproduces the frozen smoke binary, byte-identical to
the already executed header-kinds-v2 smoke. Per-candidate hashes and results are
recorded in `.tint-bootstrap/set-clone-v1-verification.json`.

Lazy-ranges-v1 captured 68.84 seconds (4,939 samples). The GC reader's flat sample
share fell from 8.30% to 5.89%, and its machine body shrank from 3,360 to 3,004
bytes. The quiet self-build took 67.88 seconds (64.76 user, 0.89 system,
1,447,985,152 bytes peak RSS, no swaps), producing byte-identical 30,735,002-byte
outputs. The generational moving-runtime probe passed twice after retrying an
LLDB launch failure before execution. All 1,249 workspace tests/checks pass.

The next candidate replaces scalar growth-copy loops with same-encoding typed-array
`.set` in numeric-list backing and reusable relation scratch. List presence flags
remain authoritative, so copying unused numeric payloads cannot resurrect holes,
deleted members or popped values. Both new list buffers are published only after
allocation/copy completion. Existing portable mutation/edge-case tests pass;
complete native measurement is pending.

Lazy-ranges-v1 stage2 reproduced the frozen smoke binary, which exited 42 under
LLDB. Hashes, native-probe details and timing are recorded in
`.tint-bootstrap/lazy-ranges-v1-verification.json`.

Bulk-growth-v1 captured 69.12 seconds (4,978 samples). Numeric-list reserve's flat
samples fell to 7 (35 inclusive), but the quiet build took 72.69 seconds
(66.18 user, 1.08 system, 1,448,968,192 bytes peak RSS, no swaps); this is not an
overall speedup claim. Both self-build outputs match the 30,735,002-byte bootstrap.
All 1,249 workspace tests/checks, the 65 numeric-list/value-type tests, and the
hosted native collection probe (twice) pass. The latter exercises collection
pressure and numeric relation storage alongside ordinary collection operations.

The next experiment applies the GC reader's reduced-capture organization to the
nursery's mutable window bounds: one shared record holds base, length, target,
target length and bitmap start unit. Range transitions and validation are retained.
All 39 portable tracing tests pass; native validation and full timing are pending.

Window-record-v1 captured 67.02 seconds (4,801 samples), producing byte-identical
self-build output. The quiet run took 69.97 seconds (64.32 user, 1.05 system,
1,448,984,576 bytes peak RSS, no swaps). Its resolver body shrank from 16,752 to
10,040 bytes, but the resolver's sample share remained similar. All 1,249 workspace
checks/tests and the native nursery probe (twice) pass. The next experiment moves
the remaining nursery counters/phase flags into that shared plan record, avoiding
separate captured-cell accesses while retaining busy/prepared transaction guards.
Its 39 tracing tests, workspace checks, and bootstrap pass; native timing is pending.

Performance work was paused for the language-coverage review. The plan-record-v1
native target was terminated while stopped at process entry, before compiler
execution. It has no native timing or completed self-build result; window-record-v1
remains the last verified result described above.
