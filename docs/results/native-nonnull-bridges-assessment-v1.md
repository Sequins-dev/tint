# Hold the read-only nonnull bridge proof

> Status 2026-11-17: rejected, not merged. The candidate branch
> `perf/test262-proven-nonnull-bridges` (implementation f27254f13) was
> deleted; only this evidence is kept, without its compressed raw artifacts.
> "This feature branch" below refers to it.

This feature branch retains its implementation and evidence together. It is
**not READY**, and these canonical outcomes must not be credited to main.
The bounded proof uses actual null comparisons, checked SSA identities and unique
predecessors. It rejects allocation, heap writes, opaque calls and unknown host
effects; joins, exception entries, reassignment and exhaustion keep guards.
No TypeScript assertion establishes a nonnull fact. It only runs in existing
closed, proven nonallocating leaf functions. No descriptor checks are removed.

| Matched workload | Before | After | Assessment |
| --- | ---: | ---: | --- |
| 16M list reads, four-pair CPU median | 376.127 ms | 372.454 ms | Near flat, ranges overlap |
| Same list, instruction median | 7,688,129,630 | 7,496,353,691 | 2.49% fewer |
| Same list, cycle median | 1,293,317,489 | 1,215,633,028 | 6.01% fewer |
| Native compiler CPU median, two orders | 298.671 s | 288.250 s | Pair directions differ |
| Native compiler instruction median | 3,194,133,743,667 | 3,182,868,016,309 | 0.353% fewer |
| Native compiler cycle median | 904,845,668,289 | 909,039,623,516 | +0.463%; no cycle win |
| Full `findEntry` bodies, four specializations | 110 instructions | 98 | Six redundant null guards disappear |
| Same-source nine-case canonical selection | 9/9 pass | 9/9 pass | Fresh process, unchanged harness/limits/resources |

CPU ranges, per-repetition load and final missing-CPU bounds are retained in
[the evidence](native-nonnull-bridges-assessment-v1.json). The first full pair
regresses CPU and cycles; the reverse pair does not establish a consistent CPU
gain. A 0.35% instruction reduction does not justify treating this larger analysis
as a demonstrated real-workload speedup. No full gate is queued for this hold.

Six focused proof tests and all 317 focused codegen tests pass. Eight original
reference/GC fixture runs, eight expanded empty/optional-string fixture runs and
eight operation runs exit 42. All four compiler executions exit 0 and produce
identical stage-2 images equal to the after stage-1 image: 53,696,658 bytes,
SHA-256 `4ce3352625fed66ffd9feae2ce97deafead924945f781e872c74f48b72c678c4`.
Signature/DWARF checks pass. Both current cohorts share the exact same portable
600-file snapshot; the expanded string fixture changes tools only. Its frozen
manifest is distinct. No frozen input was edited.

The conservative control adapter is covered by its own frozen manifest and
exact-emitter hash. It disables only nonnull guard elision, preserves source
identity checks and reproduces both the original baseline47 benchmark and full
compiler image byte for byte. The [before](test262-perf-nonnull-bridges-before-v1.json)
and [after](test262-perf-nonnull-bridges-after-v1.json) reports use that same source
and batch. Preparation failures from repeated mutable field narrowing and an
inferred non-optional box type remain in the raw logs; they occurred before any
native entry and were corrected using explicit snapshots/types. Self-builds use
`selfbuild-perf 1`; the single shared runner executes the canonical cohorts
sequentially. Nothing is projected into a whole-suite elapsed-time claim.

The next independent experiment replaces literal absent-pointer comparisons
with direct zero-test emission, avoiding this flow analysis. It is measured on
its own branch and must earn its own semantic, native and performance evidence.
