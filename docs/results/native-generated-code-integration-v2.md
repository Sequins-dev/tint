# Two-order generated-code integration

The reverse-order compiler pair resolves the pending first-pair assessment in
[v1](native-generated-code-integration-v1.md). **The first pair regresses; the
second improves.** Across the two execution orders:

| Same-source native compiler | Before median (range) | After median (range) |
| --- | ---: | ---: |
| Inferior CPU seconds | 284.823 (284.579–285.068) | 276.309 (256.483–296.135) |
| Inferior wall seconds | 312.218 | 296.812 |
| Retired instructions | 3,047,994,705,060 | 3,045,374,189,046 |
| Cycles | 881,296,470,292 | 870,784,905,711 |

CPU median ratio is 1.031x; cycles fall
1.193% and instructions fall
0.086%.
There are only two compiler executions per representation, and candidate CPU
spread is wide. Four-pair [list](native-reference-inlining-throughput-v1.md)
and [UTF-16 operation](native-string-word-kernels-throughput-v1.md) benchmarks
provide independent instruction/cycle evidence. No broad eval-preparation or
whole-suite speedup is claimed: the canonical CPU pairs remain mixed.

Both canonical source-pinned selections pass **9/9**, with zero failures,
unsupported cases, timeouts, crashes or harness errors. Unchanged sources,
harnesses, strictness/goals, fresh processes, resources, 300 s containment and
journals are retained in [v1](native-generated-code-integration-v1.json), including
all three heavy-variant CPU/load observations. Their portable snapshot is pinned
to the performance cohort; it is not relabeled as the later RegExp source.
All four native compiler executions produce the identical 53,762,178-byte image,
SHA-256 `60df7c66ba75cf62e2c18df308c8ab0811b8fd34002c0fbfd46c4061278f6c3e`,
equal to candidate stage 1. Signature/DWARF checks pass.

After main's RegExp and Temporal changes, a new rebuilt frozen **correctness-only** cohort uses
main `3226d231f22a0a6bf49e46cb32cbb66d665936c2` plus this stack, source `af810e071c3189cf1c9b0d8e6f0abeba75f2be79f2c44298ade933a0721552e5`.
Its native compiler exits 0 and reproduces stage 1, 53,762,178 bytes,
SHA-256 `c4a7e261a0c906d7a6bcf9a37bd429e101098042335545edc46e2f0a0d48aece`. Eight new boundary/surrogate/copy/GC fixture
inferiors stop initially and exit 42. No cross-source timing comparison is made.
The fresh `tint-check` passes **4,883 tests**, types, boundaries and formatting.

[Raw evidence](native-generated-code-integration-v2.json) retains every repetition, load, missing-CPU bound,
control identity, current-source selfbuild, fixture, gate and hash-indexed assets.
The initial stale-built-baseline failure and missing-manifest preflight remain
in v1, with no native execution credited. The [native hot-function table](native-hot-functions-v15.md)
separates expected algorithmic work from emitted per-operation overhead.
Node-hosted batch compiles are a separate path; selected native gains do not
justify revising the earlier whole-suite compilation-only hour projection.
