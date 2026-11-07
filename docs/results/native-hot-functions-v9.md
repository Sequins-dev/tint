# Native language-operation attribution after restored execution

This report extends [v8](native-hot-functions-v8.md) with native execution after
host authorization was restored. All percentages are exclusive main-thread
samples from selected windows. Different workloads/phases are not added or used
as a matched before/after share comparison. Full raw windows and image identities
are retained in [the capture evidence](native-capture-throughput-v1.json).

| Function | Sample % | Workload | Expected-heavy vs overhead | Suspected emitted-code inefficiency / next step |
| --- | ---: | --- | --- | --- |
| Dense `__tint_reference_list_read` | 30.65 | Native stage-2 compiler, emission window, 871 samples | Array access is expected; repeated pointer spills are extra language-operation work. | Existing no-safepoint proof permits nonmoving pointers, but only numeric locals receive callee-saved homes. Spare reference registers are the next isolated candidate. |
| `nativeCompile` closure / `compileArm64Program` | 19.29 / 15.38 | Same compiler emission window | Expected-heavy emission and buffer construction. | Heat alone is not a finding; inspect the leaf operations rather than changing compiler algorithms. |
| `string-equal` | 5.74 | Same compiler emission window | String comparisons are expected. | No allocation or redundant conversion defect established; below pointer traffic in priority. |
| `findEntry` | 15.29 | Restored A1 diagnostic, eight usable windows, 6,277 samples | Tree search is expected for its representation; using it for array indexing adds overhead. | Managed-host layout proof safely declines due to raw-memory capability. Investigate a sound narrower proof, not a blanket assertion. |
| `resolveReference` | 14.50 | Same A1 | Expected-heavy live-object tracing. | Root/allocation churn may increase frequency; the sample alone does not justify collector changes. |
| `copying.read` closure | 12.12 | Same A1 | Permission checks are required; eager capture-cell loads add overhead. | Stable numeric parameter captures now reduce the body 852→557 instructions; operation CPU median improves 1.203×. This is not a matched whole-A1 sample-share reduction. |
| `nativeObjectExtent` / `scanFields` | 5.69 / 3.70 | Same A1 | Expected-heavy checked tracing. | No independent emitted-code defect established. |
| `generational.read` | 9.57 | Native stage-2 compiler, GC window, 784 samples | Required address checks plus reference traffic. | Current parameter-only capture proof leaves its 850-instruction body unchanged. Inspect stack/root traffic next. |
| `substituteInstructionValues` / `pruneClosedModule` | 5.99 / 4.46 | Same compiler GC/optimization window | Expected-heavy tree/IR traversal. | No compiler-specific algorithm optimization proposed. |
| `findEntry` | 55.56 / 63.61 | Historical B division sloppy/strict, v2 | Shared JIT preparation is expected; tree-backed array access adds per-operation overhead. | Same managed-host array-layout limitation, not division arithmetic. |
| `findEntry` / `copying.read` / `resolveReference` | 17.11 / 12.73 / 11.68 | Historical D catch-eval, v2, 15,794 samples | Expected preparation and tracing with avoidable indexing/capture traffic. | Same two language-operation patterns; no separate catch semantic conclusion. |
| Unavailable | — | D's eight indirect-eval timeouts, v3 | Low CPU share makes timeouts inconclusive. | No symbolized profile; do not substitute catch-eval shares. |

The compiler before and after windows are at approximately 210 seconds in
different phases. The earlier v1 sampler compared unrelated monotonic clock
origins, so its nominal offsets are invalid; its samples are retained but are not
used for timing attribution here. The v2 sampler uses the initial-stop file's
wall-clock timestamp. A1's ninth window has no stacks after process exit and is
excluded from the 6,277-sample denominator, with the empty raw file retained.

Ranking is by demonstrated language-operation overhead across these workloads:
(1) array representation/tree indexing, large but constrained by a real managed
host soundness boundary; (2) pointer stack/root traffic, including no-GC reference
locals; (3) repeated capture-cell unpacking, now natively validated; (4) remaining
string operation and conversion costs, not yet independently demonstrated.
Expected type-checking, hashing and traversal work is not itself a defect.

B's 327.530-CPU-second tiny compile and unfinished 45m41.60-CPU-minute left-shift
compile ran in **Node**, before inferior entry. They are separate throughput
costs, not evidence about Tint-generated instructions. The left-shift sample
attributes 37.82% to V8 descriptor search and 20.46% to property lookup. C2's
flow-fact change is included in these native freezes. The alleged linked-syntax
hash regression did not reproduce in [v4's identical-source control](native-hot-functions-v4.md):
the fixed host had 1.30× lower median CPU. No hash rollback is justified.

[Capture native evidence](native-capture-throughput-v1.md) records all four
successful native compiler stage-image comparisons, 6/6 identical canonical
subset outcomes per side, repeated semantic/CPU/counter checks, mixed full-compiler
CPU directions, and both original A1 canonical timeouts. A separate A1 diagnostic
exits 42 after 234.705 CPU seconds. It does not overwrite canonical results.
The next reference-register candidate has approximately 5% lower operation CPU
and instruction counts on byte-identical production/prototype benchmark images;
its integrated compiler stage comparison remains pending. No whole-suite hours
are inferred from operation loops or sampled-window shares.
