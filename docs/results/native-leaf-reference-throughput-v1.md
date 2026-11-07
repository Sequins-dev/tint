# Leaf pointer register throughput

Verified no-safepoint leaf functions now keep frequently used single-word
references in **x4–x8**, using the existing register-aware emitter. This removes
integer/FP bank transfers in pointer walks. Numeric FP selection still runs first;
the unchanged work limit falls back to its complete prior plan. Incoming pointer
parameters retain their own argument registers, including permuted parameter
slots and stack overflow arguments. SSA reference homes apply only within their
block because another block may reuse the same frame word for a number.

Ordinary calls, host calls and allocating paths retain their existing storage.
Private string helpers preserve this bank; array-copy kernels that clobber it
retain the prior plan. This changes neither root elision nor the native ABI,
resource limits, sources, harnesses, outcome classification or journal semantics.

| Matched workload, four alternating pairs                        |   Before CPU median (range), ms | After CPU median (range), ms | CPU speedup |  Retired cycles, median | Inferior wall median, ms |
| --------------------------------------------------------------- | ------------------------------: | ---------------------------: | ----------: | ----------------------: | -----------------------: |
| 50 million dependent leaf pointer steps                         |       427.532 (403.904–444.802) |    214.730 (198.607–232.160) |      1.991× | 1.470B → 0.756B, −48.6% |        472.861 → 259.695 |
| Frozen `hasSet` / `readList` implementation, 12 million lookups | 1,111.407 (1,094.455–1,114.114) |    726.273 (712.208–733.123) |      1.530× | 3.158B → 2.046B, −35.2% |      1,218.593 → 820.286 |

Retired instruction medians are nearly flat: 2.166B→2.163B and 9.589B→9.550B.
These are chiefly transfer-latency wins, not large reductions in operation count.
Every measured process stops at entry and exits 42. CPU is user+system converted
through the Mach timebase; each final unobserved interval is retained as a missing
CPU bound. Load averages are recorded per repetition. Node/V8 runs the same
production collection workload at a 113.829-ms CPU median over five repetitions;
the remaining gap is a lead for emitted-code inspection, not a semantics oracle.

The complete matched compiler bodies show `hasSet`'s integer/FP bit moves fall
43→26 (164→162 instructions), and four `findEntry` specializations fall 37→18
(120→119 instructions). Their loads, stores and call counts stay unchanged.
The count includes every x/d `fmov`; it is not asserted that each transfers a
pointer. Full contiguous machine-code bodies are retained.

| Frozen native compiler run | Before CPU / wall, seconds | After CPU / wall, seconds |       Before → after cycles |
| -------------------------- | -------------------------: | ------------------------: | --------------------------: |
| Forward, before then after |          278.337 / 297.397 |         286.306 / 300.566 | 878.801B → 837.275B (−4.7%) |
| Reverse, after then before |          362.298 / 387.237 |         334.281 / 361.892 | 921.212B → 852.349B (−7.5%) |

Two-execution CPU medians are 320.317→310.294 seconds, with wide overlapping
ranges and opposite pair directions. **No stable whole-compiler CPU speedup is
claimed.** Instructions differ by +0.124% in the forward pair and −0.206% in the
reverse pair. The operation medians and both lower cycle counts are the positive
performance evidence. Selected compiler windows move between phases, so their
sample shares are not treated as a matched whole-run change.

All four native compiler executions compile the same 591-file frozen source
identity `42ecbaecaef8cb1c9d0e53018ca9312db30536eee8fc146def448f6984286843`.
They emit identical **54,334,770-byte** stage images, equal to the candidate's
Node-built stage 1, SHA-256
`2f2012477820a6113eab60acb906e269770d0a0e706db8c098a736f7b8865198`.
Both comparisons pass signature and DWARF verification. Runs use
`slot selfbuild-perf 1`; no P self-builds overlap.

The frozen baseline content key is
`59a2a3856a9d0001a4e56c3b222915605e3d8542a854b9eb47f6e4f591eeb159`;
the candidate key is
`d1c3585d0652c9e47a4f0f504cdfad4dec9f2f988659368f315101f7ba5e4ebc`.
Every sealed file is rehashed before reporting. The candidate journal's separate
manifest-file identity is
`98a97749d7e174733acc4424d522abac39ad1f636e60026fff900a258e8b9aab`.
The pointer/ABI fixtures used the earlier v25 snapshot; v26/v27 only add explicit
TypeScript narrowing/type declarations required by the bootstrap checker. Their
exact identities are retained rather than attributed to a later mutable tree.

[Canonical selection](test262-perf-leaf-reference-v1.json): **9/9 pass**, zero
failures, unsupported or infrastructure outcomes. It includes both addition A1
variants, addition/division/strict-equality controls and A2's call A1 sloppy.
Source hashes, variants, metadata, harness hashes, suspend policy, outcomes and
statuses match the retained eight-case baseline plus A2's original observation.
Historical hosts have different source snapshots, so native times are context:
A1 sloppy/strict use 223.286/256.186 CPU seconds; A2 call uses 264.855 seconds.
These near-budget cases still need margin. The source subset and copying heap,
300-second containment, strictness/goals and fresh processes remain unchanged.

Sixteen additional native semantic checks pass: moving-GC/ABI fixtures and a
verified-IR function with parameter slots `[2,0]`, distinct descriptor-tagged
records and an expected value of 42. Eight operation benchmark executions per
workload also pass. Focused codegen checks and the workspace gate pass; the latter
has **4,746/4,746 tests**, types, boundaries and formatting, exit 0.

All [raw evidence, manifests, drivers, failures and load observations](native-leaf-reference-throughput-v1.json)
are immutable. The initial Node-stage preparations rejected an inferred fallback
record type and an optional signature narrowed across loops; explicit source
annotations fix them. A short Node preflight was cancelled before native entry
to keep self-build work under its reserved wrapper. Collection fixture preparation
failures (missing module dependencies, reused output filename, implicit generic
arguments) are retained. Heartbeat stalls were investigated with live CPU
progress; none was an authorization stall or silently retried native failure.

No whole-suite hours or suite speedup can be inferred from these loops or nine
variants. The Node-hosted fixed batch cost remains separate. The
[updated attribution](native-hot-functions-v10.md) records the next large leads:
managed graph indexing and GC pointer/scalar traffic. Reusable runtime modules
still skip scalar callee-saved allocation; investigating that boundary is the
next slice. The runner's behavior is unchanged.
