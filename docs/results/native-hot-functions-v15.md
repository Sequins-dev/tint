# Native hot functions after the string kernels

The fresh current-main native compiler windows have
3,917 before / 3,914 after exclusive main-thread samples.
Only common wall offsets are compared; different compiler phase positions
still prevent converting sample-share changes into per-function speedup ratios.
Both native compilers compile the identical sealed source and reproduce the
candidate stage image. The [integration report](native-generated-code-integration-v1.json)
retains raw samples, counters, source/toolchain identities and full-image proof.

| Function | Sample % before / after | Workload | Expected-heavy vs overhead | Emitted-code finding |
| --- | ---: | --- | --- | --- |
| `linked-set.hasSet` | 6.79 / 17.32 | Native compiler before/after | Expected membership/equality work; repeated string-field/carrier traffic is avoidable. | Diagnostic final IR retains two repeated fixed-field reads and three comparison calls; ceiling experiment is separate, no new forwarding fix credited. |
| `resolveReference` | 8.35 / 8.61 | Native compiler before/after | Expected forwarding and tracing; no collector algorithm defect established. | Root, capture and carrier overhead can amplify work; do not remove authority checks. |
| `Generational read` | 6.43 / 7.95 | Native compiler before/after | Expected allocation/permission checks. | Remaining closure and call overhead requires matched per-operation evidence. |
| `key-index.position` | 5.16 / 2.89 | Native compiler before/after | Expected hashing/probing/equality. | Repeated field/carrier work remains a candidate, not justification for broad map changes. |
| `string-equal` | 2.25 / 1.12 | Native compiler before/after | Comparing code units is expected; one-unit loop overhead was excessive. | Four-unit kernel: nine steady instructions per four units instead of 32, retaining guarded scalar tail. |
| `string-copy` | 0.03 / 0.00 | Native compiler before/after | Copying content is expected; one-unit loop overhead was excessive. | Four-unit copy: seven steady instructions per four units instead of 24, zero new calls. |
| `types.relates` | 7.12 / 4.98 | Native compiler before/after | Expected algorithmic type relations; phase mix changes its share. | A hot checker function alone is not a code-generation finding. |
| `sparse-list.readList` | 14.53 | Earlier symbolized addition A1, 7,062 samples | Search is expected; two indirect calls were avoidable. | Inlined real-image caller has zero calls, 26 loads/18 stores instead of 45/34. The isolated eval CPU pairs did not improve. |
| `copying.read` / `resolveReference` | 11.40 / 13.98 | Same A1 | Permission checking and tracing are expected. | Earlier capture/root fixes are measured separately; no new collector shortcut credited. |
| `findEntry` / `copying.read` / `resolveReference` | 15.66 / 10.28 / 13.46 | Historical A2 call, 7,897 samples | Shared eval/Function preparation, not a call operator bug. | Same representation/call/capture patterns. |
| `findEntry` / `copying.read` / `resolveReference` | 17.11 / 12.73 / 11.68 | D catch-eval, 15,794 samples | Same expected preparation and tracing. | Same emitted patterns, not a catch algorithm change. |
| `findEntry` | 55.56 / 63.61 | Historical B division sloppy/strict | Shared preparation dominates. | Not division arithmetic. |
| unavailable | unavailable | D eight low-CPU indirect-eval timeouts | Host starvation made wall time inconclusive. | No invented function shares. |
| V8 descriptor/property stacks | Native share not applicable | B tiny 327.530 CPU s and unfinished 45m41.60 CPU left-shift batch | Both are Node-hosted before native entry. | Generated-code changes do not execute that path; the single 365.8 s hash-fix pair does not establish a causal regression. |

The [v14 table](native-hot-functions-v14.md) retains the earlier native workloads
and expected-cost interpretation. Canonical release-image samples in the new
cohort lacked function names; they are retained as unresolved diagnostics and
supply no named-function percentages. No whole-suite speedup is projected.
