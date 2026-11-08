# Direct branches for logical conditions

Condition-only `!`, `&&` and `||` now branch directly. The old lowering materialized Boolean intermediate values and join slots before branching again. Value-producing logical expressions, nullish coalescing, evaluation order and abrupt completion retain their existing behavior.

| Native workload | Before CPU median (range), ms | After CPU median (range), ms | Instructions change | Cycles change |
| --- | ---: | ---: | ---: | ---: |
| String membership, first cohort, four alternating pairs | 171.301 (160.158–173.550) | 164.903 (163.955–167.050) | -6.55% | -0.64% |
| Boolean loop, first cohort, four alternating pairs | 78.116 (74.504–81.243) | 70.333 (66.787–78.207) | -5.33% | -6.62% |
| Reference membership, first cohort, four alternating pairs | 139.378 (124.635–151.583) | 145.060 (141.780–152.115) | -15.75% | -0.09% |
| Number/NaN membership, first cohort, four alternating pairs | 107.591 (103.460–110.973) | 100.269 (94.156–105.442) | -15.88% | -4.63% |
| String membership, current cohort, four alternating pairs | 192.327 (177.930–198.223) | 197.856 (183.807–201.047) | -6.39% | -0.09% |
| Boolean loop, current cohort, four alternating pairs | 101.826 (98.328–105.604) | 95.478 (88.176–96.307) | -5.36% | -5.98% |

**CPU results are mixed:** reference membership regresses, and the current string case has nearly flat cycles despite fewer instructions. All 64 operation/semantic inferiors stop initially and exit 42. Every repetition retains load, wall time and the final missing-CPU bound.

| Full native compiler | Before CPU seconds | After CPU seconds | Instructions change | Cycles change |
| --- | ---: | ---: | ---: | ---: |
| First cohort, two execution orders (medians) | 257.236 | 238.097 | -3.96% | -6.46% |
| Current cohort including A1 Script hashes, one pair | 276.661 | 239.724 | -3.87% | -8.05% |

The first-cohort individual CPU pairs are 237.997→238.084 s and 276.474→238.110 s: the first is flat and baseline spread is wide. The current pair is a separate source graph; no cross-source performance ratio is used. CPU is inferior user+system, not debugger or Node time. Static matched `hasSet` bodies shrink 159→153, 141→126 and 146→131 instructions; the latter two also remove six pointer/float carrier moves. Calls and field loads are unchanged.

All six native compiler executions exit 0 and reproduce their candidate stage-1 image byte for byte. The four first-cohort outputs are 52,457,634 bytes, SHA-256 `e3c2451b35d858d02eb41bcb625ef013be58da0e2ad337efe02c7573be41171a`; both current outputs have the same size and SHA-256 `ee589fd28dacf68f5fdf87d755cc590dd4ce3d2feaca900356a5555f3e76b5c2`. Signing and DWARF checks pass. Selfbuilds use `selfbuild-perf 1`, suites use one shared runner, and short fixtures use LLDB directly.

Both source cohorts pass the identical **9/9 before and 9/9 after** pinned Test262 selection. Sources, harness hashes, strictness/goals, resources, fresh process isolation, 300 s containment and terminal complete journals are preserved. The fresh rebased workspace gate passes **4,908 tests**, types, dependency boundaries and formatting. These overlapping performance selections add no coverage denominator.

After main added IR initialization-proof pruning, a separate final correctness-only selfbuild uses source `a994f87b1a739e4d72d7a1c334a49af4273426f96ab1601d1084b95fdc0a5343` on main `4a5c2bf7dc86ea033eaa948f6408733991693af2`. Its native compiler exits 0 and reproduces stage 1, SHA-256 `3e9249ac69a8eb65a4c22e90125391122b2ed2b3a1558ac5dd104f520de2f84f`. Signing and DWARF checks pass. Earlier timings and Test262 outcomes retain their own source identities; no cross-source ratio or later-graph conformance count is invented.

The retained setup failures are pre-entry observations: an existing output filename, a missing input filename and a baseline-unsupported mixed-carrier fixture assertion. The corrected native fixture checks ordering, skipped operands, exceptions/finally, loop control, nullish values, NaN, negative zero and truthiness on both generated representations. Six red-first lowering tests compare condition contexts with equivalent nested branches; value-returning logical expressions retain their carriers.

[Raw evidence](native-branch-context-throughput-v1.json) includes every load/counter observation, current-source equivalence, frozen manifests/source snapshots, control adapters, stage-image checks, setup failures and hash-indexed assets. The [native hot-function table](native-hot-functions-v16.md) separates expected graph work from per-operation overhead. No whole-suite hours reduction is projected from these samples; Node-hosted batch compilation is a separate path.

| Current-cohort native variant | Before CPU seconds | After CPU seconds | Instructions change | Cycles change |
| --- | ---: | ---: | ---: | ---: |
| Addition A1 sloppy, one matched pair | 214.458 | 202.727 | -5.00% | -7.45% |
| Addition A1 strict, one matched pair | 197.648 | 208.157 | -5.16% | -4.79% |
| Call A1 sloppy, one matched pair | 176.371 | 198.736 | -5.15% | -1.47% |

These single canonical CPU pairs are not medians. Their load averages, lifetime counters and final missing-CPU bounds are retained per variant. Instructions/cycles and CPU are reported independently; a CPU regression is not hidden by an instruction reduction.
