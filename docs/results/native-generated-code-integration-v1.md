# Current-main generated-code integration

This report validates **both** stacked performance slices on current portable
main code: [bounded reference-helper inlining](native-reference-inlining-throughput-v1.md)
and [four-unit UTF-16 kernels](native-string-word-kernels-throughput-v1.md).
Their isolated repeated measurements remain separate. The first combined native
compiler CPU pair regresses; a reverse-order pair remains pending, so this
stack is not yet marked READY. Both canonical selections
pass **9/9 with identical outcomes**, unchanged pinned sources/harnesses,
strictness/goals, fresh processes, resources, 300 s containment and journal schema.

| Same-source canonical case, one observation per side | Before / after inferior CPU s | Instructions change | Cycles change | Start load before / after |
| --- | ---: | ---: | ---: | ---: |
| addition sloppy | 218.207 / 218.524 | -0.753% | +0.321% | 19.46 / 13.89 |
| addition strict | 195.484 / 230.291 | -0.905% | +3.751% | 17.99 / 18.39 |
| call sloppy | 220.461 / 206.156 | -0.744% | -0.582% | 13.58 / 20.09 |

These are individual canonical observations, not repeated medians. CPU is
inferior user+system lifetime usage via Darwin V4 counters; the raw report retains
last-unobserved wall bounds, load and missing fast-process observations as null.
`observation.elapsedMs` includes shared preparation/queueing and is not execution
wall time. Full canonical JSON and terminal journals are separate immutable files.
The Node-hosted nine-variant compile wall times are
134.243 /
116.423 s per batch,
or 14.916 /
12.936 s per variant.
No matched Node compiler CPU or whole-suite hour improvement is claimed.

The fresh native compiler comparison uses exactly the same sealed 601-file
candidate source. Before / after inferior CPU are
284.579 / 296.135 s;
wall 301.883 / 318.733 s. Both exit 0
and reproduce the candidate stage-1 image byte for byte:
53,762,178 bytes, SHA-256 `60df7c66ba75cf62e2c18df308c8ab0811b8fd34002c0fbfd46c4061278f6c3e`.
Signature and DWARF verification pass. One pair verifies current-main integration;
isolated reports provide the two-order compiler repetitions for each slice.
The strengthened string fixture passes eight LLDB initial-stop/exit-42 checks,
including original-unit verification and allocation churn. The full worktree
`tint-check` passes **4,880 tests**, types, dependency boundaries and formatting.
Main changes after its code base are docs-only; the gate covers the merged code.

The first integration attempt caught stale built `dist` files in the main
checkout before native execution. A fresh offline install/build from archived
main `94a204b99ea50bb0913493d46becab3d685f80e3` in local staging repaired the baseline without
writing main. Its built JavaScript equals the sealed control's three replacements
apart from one unreferenced obsolete candidate-only file. More decisively, the
complete freshly rebuilt main compiler image equals the same-source control
image byte for byte. Baseline70 is retained as a failed preparation observation;
it supplies no performance/equivalence result. A second missing-manifest
preflight attempt also failed before native entry. The corrected v3 is explicit.

[Raw evidence](native-generated-code-integration-v1.json) includes frozen identities, all counters, logs,
source manifests, control adapters, exact-image proof, native compiler samples
and the failed pre-entry observations as hash-indexed compressed assets.
Release canonical samples lacked function names and are retained as unresolved,
not assigned invented percentages. New symbolized compiler windows are reported
in [native hot functions v15](native-hot-functions-v15.md); their phase-dependent
shares are not per-function speedup ratios. No whole-suite forecast is extrapolated
from a nine-case selection or operation microbenchmarks.
