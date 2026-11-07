# Native operation attribution after reference-temporary registers

The latest symbolized addition A1 diagnostic exits 42 after **213.689 inferior
CPU seconds** (220.842 seconds including debugger startup/handling). Its eight
usable windows contain **6,931 exclusive main-thread samples**. It uses frozen
H23, source `b38478cf07be381cf4fe35bb792232c255315e17f68ac582953c81cda79591e9`,
image `8b552710b1c62f02f17af4518fcba1462adf8adad6140d737dd0732671a68f1c`.
The unchanged sources/harnesses, resource settings, image manifest, raw windows,
CPU/cycle/instruction counters and load averages are in [the evidence](native-hot-functions-v10.json).
This diagnostic is separate from the canonical outcomes; its CPU time is not a
matched speedup ratio. The [accepted temporary-register slice](native-reference-temporaries-throughput-v1.md)
retains its original canonical 8/8 result and all intermediate failures.

| Function                                          |              Sample % | Workload                                                       | Expected-heavy vs overhead                                                                                                    | Emitted-code inefficiency / next step                                                                                 |
| ------------------------------------------------- | --------------------: | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `nursery.resolveReference`                        |                 16.14 | A1, 6,931 samples                                              | Tracing reachable objects is expected; frequency alone does not prove a codegen defect.                                       | Inspect pointer/root transfers in the generated body before changing collection policy.                               |
| `sparse-list.findEntry`                           |                 13.50 | Same A1                                                        | Balanced-tree search is expected for this representation; using it for array indexing adds per-operation work.                | Managed graph still fails the private dense-layout proof for reachable dynamic capabilities. Do not bypass the proof. |
| `copying.read` closure                            |                 10.72 | Same A1                                                        | Bounds/permission checks are required; boxing/capture transfers are extra work.                                               | Prior capture optimization is included. Remaining pointer storage and tag traffic need machine-code attribution.      |
| `nativeObjectExtent` / `scanFields`               |           6.49 / 4.72 | Same A1                                                        | Checked extent calculation and tracing are expected.                                                                          | No independent emitter defect established.                                                                            |
| `scanObject` / `preparePlan`                      |           3.74 / 3.72 | Same A1                                                        | Expected object traversal and collection planning.                                                                            | Avoid treating algorithmic heat as a language-operation finding.                                                      |
| `linked-set.hasSet`                               |                 66.59 | H23 native compiler, after 150-second window, 865 samples      | Linear search is expected; pointer moves through FP registers on each node are overhead.                                      | Leaf functions still use the generic FP storage bank for pointers; integer homes are the next isolated slice.         |
| Dense reference-list read                         |                 15.47 | Matched source compiler, before 150-second window, 866 samples | Array reads are expected; spills/transfers are overhead.                                                                      | Earlier safepoint-bounded temporary homes reduce pointer stack traffic. Different phase from the `hasSet` window.     |
| `nativeCompile` closure / `types.relates`         |          10.05 / 6.93 | Same before compiler window                                    | Expected compile orchestration and type relations.                                                                            | Heat alone is not evidence; no compiler-specific algorithm change proposed.                                           |
| Unresolved native addresses                       |           unavailable | A2 call `S11.2.3_A1.js`, sloppy                                | Passes near budget: 263 CPU seconds at last sample. Shared eval preparation is an inference from source and related profiles. | A2's sample lacks symbols; do not replace it with A1 shares. Added to P's next canonical selection.                   |
| `findEntry`                                       |         55.56 / 63.61 | Historical B division sloppy/strict, v2                        | JIT preparation is expected; tree-backed indexing adds work.                                                                  | Same managed-array representation boundary.                                                                           |
| `findEntry` / `copying.read` / `resolveReference` | 17.11 / 12.73 / 11.68 | Historical D catch-eval, v2, 15,794 samples                    | Expected preparation/tracing with indexing and capture overhead.                                                              | Same language-operation patterns; no catch semantic bug inferred.                                                     |
| Unavailable                                       |           unavailable | D's eight indirect-eval timeouts, v3                           | Low inferior CPU share makes the timeouts inconclusive.                                                                       | No symbolized profile; retain original observations.                                                                  |

Ranked leads remain array representation, pointer storage/transfers, capture/tag
traffic, then string operations for which no independent defect is yet shown.
Percentages across workloads are not added. The current leaf-register candidate
is not claimed merge-ready by this report.

A static diagnostic traced the exact managed graph to completion: 12,277 of
21,689 functions are reachable, using 3,517,375 graph-work units. **All 17 unsafe
layout operations are reachable**, including executable managed calls, map/write/
unmap, external-memory registration, descriptor/signature access and shared-memory
writes. Merely moving the existing layout-effect guard after reachability does
not unlock this workload. It needs a sound ownership/effect proof across dynamic
publication; no assertion or whitelist was added. This audit deliberately stops
before emission and is not a native result.

B's 327.530-CPU-second tiny compile and unfinished 45m41.60-CPU-minute left-shift
compile are **Node-hosted before native entry**. Their V8-heavy stacks are kept
in [v9](native-hot-functions-v9.md). The alleged linked-hash regression did not
reproduce in v4's matched control (fixed host 1.30× lower median CPU). C2's checker
fix is included in these native freezes. J's reported Node OOM (exit 134) on
64-variant RegExp property-escape batches, now reduced to eight, is compile-side
context and is not being pursued in this generated-code slice.

No whole-suite time is projected from diagnostic windows or operation loops;
[the journal analysis](native-journal-throughput-v3.md) separates compile records from
cumulative observation elapsed times. A2's [original handoff](cluster-a2-call-eval-near-budget-v1.json)
remains immutable, including its unresolved sample and load-sensitive wall time.
