# Immutable word parameter captures

Strict simple parameters that are initialized and never reassigned now enter
closure environments as direct single-word payloads. Boolean, string, object,
function and typed-array values retain their ordinary GC field types. The proof
comes from bindings and writes, including descendants; readonly assertions do not
establish it. Defaults, aliases, sloppy arguments/eval exposure and wider carriers
retain shared cells. Forwarded closures preserve the payload representation.

| Matched workload | Before | After | Result |
| --- | ---: | ---: | --- |
| Five-million five-word capture factories, CPU median | 560.564 ms | 303.250 ms | 1.849x faster, four alternating pairs |
| Same factories, retired instructions | 7,337,078,592 | 3,930,436,542 | 46.4% fewer |
| Same factories, cycles | 1,901,935,540 | 995,010,074 | 47.7% fewer |
| Native compiler on current-main-based frozen source, CPU | 252.193 s | 278.371 s | CPU direction varies with cohort; no compiler CPU win claimed |
| Same native compiler, instructions / cycles | baseline | -3.59% / +0.92% | Identical generated image |
| Earlier separate frozen compiler cohort, CPU | 307.377 s | 289.557 s | Instructions -3.59%, cycles -6.10%; same image within cohort |
| Unchanged canonical selection | 9/9 pass | 9/9 pass | Same paths, strictness, harness and source hashes |

CPU factory ranges are 538.583–582.073 ms and
295.991–307.749 ms. Full per-repetition wall,
load, CPU, instruction and cycle measurements are in [the evidence](native-word-captures-throughput-v1.json).
Each factory removes five cell allocations while preserving the environment's
traced fields. At five million factories this avoids 25 million cells. Eight
executions of the semantic fixture and eight factory benchmarks per sealed cohort exit 42 under
LLDB, including moving GC, alias mutation, strings, typed arrays, callbacks,
forwarding and mutable-binding controls. Bespoke checks are not Test262 coverage.

Both current native compilers compile the exact same 595-file source snapshot
`0316b669c4ec0fe7dff90f1e87d2cc412555cf164f9c46a7f1b048ef6f15bbb0`.
Both stage-2 outputs equal the candidate stage-1 image: 53,893,762 bytes, SHA-256
`5225920db8724e14ac2e6ae53f08b5aa6a0aff9af44fe1be2ab541fa13c8daed`.
Signature/DWARF verification and initial-stop/final-exit checks pass. The earlier
cohort separately reproduces SHA-256 `9d55b630029de9daea95047b73ee1801ea68e24cc4d39416ca59bb7203a33fbe`.
Those distinct source cohorts are not pooled into CPU medians. The first frozen
preparation's missing explicit carrier annotation is retained; it stopped during
checking before any native compiler execution. The corrected annotation is part
of this slice, and all subsequent inputs were re-frozen.

The [canonical nine-case report](test262-perf-word-captures-v1.json) preserves the
300-second limits, original resources, debugger protocol and a fresh process per
variant. CPU records include load at native observation and the final unobserved
CPU interval. Older nine/17-case baselines predate main's imported-function fix,
so their variant CPU figures are context rather than a causal ratio for this
lowering change. No batch compile or whole-suite hours saving is extrapolated.

Frozen native self-builds use `selfbuild-perf 1`; canonical Test262 uses the shared
runner class. The temporary three-recheck `runner-perf` reservation is finished.
The final workspace gate uses `tint-check`. All raw preparation failures,
profiler windows, manifests, immutable source snapshots and recorder statuses are
retained. The generic root-clearing experiment is a separate slice and is not
included in these performance claims.

Final `tint-check`: **4,792/4,792 tests**, types, boundaries and formatting pass
(exit 0). The gate source head and base are recorded in the evidence.
