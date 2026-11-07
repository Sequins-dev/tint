# Native hot functions and per-operation overhead

The new native stage-2 compiler windows have 3,950 before / 3,944 after exclusive
main-thread samples. Different phase positions prevent treating their changing
shares as per-function speedup ratios. The new addition A1 diagnostic has 7,062
samples, uses unchanged Test262 source/harness and exits 42 under the unchanged
300-second containment. Its full cohort source, debug adapter, images, samples
and counters are retained in the [inlining evidence](native-reference-inlining-throughput-v1.json).

| Function | Sample % | Workload | Expected-heavy vs overhead | Emitted-code finding |
| --- | ---: | --- | --- | --- |
| `linked-set.hasSet` | 19.52 / 10.37 | Native compiler before/after | Membership and equality are expected; phase mix changes the share. | Small-set register/root overhead blocked the earlier broad indexing experiment; no blanket index promotion. |
| `resolveReference` | 5.82 / 7.05 | Same compiler | Forwarding and tracing live objects are expected. | Extra roots/capture cells amplify work; no collector validation is removed. |
| Generational `read` | 5.14 / 7.15 | Same compiler | Address authority checks are expected. | Remaining callback, tag and frame costs need direct operation evidence. |
| `types.relates` | 0.05 / 7.58 | Same compiler | Expected algorithmic type relations, sampled in different phases. | A hot checker pass is not itself a code-generation finding. |
| `key-index.position` | 2.08 / 5.25 | Same compiler | Probing and equality are expected. | Calls/carriers and repeated field validation remain candidates, not demonstrated new defects. |
| `sparse-list.readList` | 14.53 | Fresh A1, 7,062 samples | Tree search remains expected representation work. | Two indirect calls become zero; 45 loads/34 stores become 26/18. Inlined traversal is now attributed to this caller. |
| `resolveReference` | 13.98 | Same A1 | Expected live-object tracing. | No independent algorithm defect established. |
| `copying.read` | 11.40 | Same A1 | Memory permission checks are required. | Earlier capture slices removed eager cell traffic; remaining heat does not authorize weakening checks. |
| `nativeObjectExtent` / `scanFields` | 6.56 / 4.28 | Same A1 | Extent validation and reference tracing are expected. | No additional measured generated-code defect isolated here. |
| `string-equal` / `string-concat-copy` | 1.77 / 0.48 | Same A1 | Comparing/copying UTF-16 content is expected. | Current loops process one code unit per iteration; four-unit kernels are the next independent measured candidate. |
| `findEntry` / `copying.read` / `resolveReference` | 15.29 / 12.12 / 14.50 | Earlier restored A1, 6,277 samples | Search, permissions and tracing are expected. | Same call, representation and capture patterns; old source/cohort is kept distinct. |
| `findEntry` / `copying.read` / `resolveReference` | 15.66 / 10.28 / 13.46 | Earlier A2 call, 7,897 | Same expected work with extra call/capture traffic. | Shared preparation, not a call-operator semantic bug. |
| `findEntry` / `copying.read` / `resolveReference` | 17.11 / 12.73 / 11.68 | D catch-eval, 15,794 | Same expected preparation and tracing. | Same emitted patterns; no separate catch algorithm change. |
| `findEntry` | 55.56 / 63.61 | Historical B division sloppy/strict | Shared preparation dominates; array-backed tree traversal is additional representation work. | Not division arithmetic. |
| unavailable | unavailable | D's eight low-CPU indirect-eval timeouts | Starvation made wall time inconclusive. | No function shares invented. |
| V8 descriptor/property stacks | Native share not applicable | B tiny 327.530 CPU s and unfinished 45m41.60 CPU left-shift batch | Both run in Node before native entry. | Context only; generated-code changes do not execute this host path. The single 365.8 s hash-fix comparison does not establish a causal 12% regression. |

[Raw attribution](native-hot-functions-v14.json) keeps workload denominators and
historical evidence separate. [v13](native-hot-functions-v13.md) retains the
comparison-branch and indexed-Set context; [v9](native-hot-functions-v9.md) retains
the restored A1 baseline; [v2](native-hot-functions-v2.md) contains B/D diagnostics.
The current inlining result improves repeated list CPU and native compiler CPU
across two orders, but its single canonical eval-heavy CPU/cycle pairs are slower.
That limitation is explicit rather than inferred away from instruction counts.
No whole-suite speedup is projected from these selected workloads.
