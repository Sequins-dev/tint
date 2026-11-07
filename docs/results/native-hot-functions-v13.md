# Native language operations after direct comparison branches

New compiler samples come from four matched selected wall windows in each native
stage-2 compilation of the same frozen 595-file source. The exact exclusive
main-thread denominators are 3,456 before and 3,133 after. The programs progress
through different compiler phases at those offsets, so changing sample shares
are context rather than causal per-function CPU ratios. Historical workloads
keep their own denominators. No checker algorithm is optimized because it is hot.

| Function | Sample % | Workload | Expected-heavy vs overhead | Emitted-operation finding / next step |
| --- | ---: | --- | --- | --- |
| `types.relates` | 14.61 / 6.06 | Native compiler before/after; 3,456 / 3,133 | Type relations are expected compiler work; phase position changes the share. | No checker algorithm change proposed. |
| `resolveReference` | 10.91 / 12.42 | Same compiler | Tracing and forwarding live objects are expected. | Remaining pointer/guard/root/call costs need per-operation evidence; heat alone is insufficient. |
| Generational `read` | 7.67 / 10.21 | Same compiler | Required memory authority checks are expected. | Capture lowering already improved; raw-memory callbacks retain conservative boundaries. |
| `linked-set.hasSet` | 8.56 / 2.94 | Same compiler | Membership is expected; linear large sets add query work. | Broad index promotion remains rejected because it harms small sets and native compiler execution. |
| `key-index.position` | 3.07 / 1.47 | Same compiler | Probing and equality are expected. | Calls, carrier moves and repeated pointer checks are language-operation candidates. |
| `__tint_reference_list_read` | 2.95 / 2.65 | Same compiler | Checking array/index representations is expected. | Representation specialization still requires sound capability/ownership proof. |
| `sparse-list.findEntry` | 0.23 / 0.16 | Same compiler | A tree walk is expected. | All four specializations shrink 119 to 110 instructions; three CSETs and six carrier moves disappear. Shares alone do not establish the gain. |
| `sparse-list.findEntry` | 15.66 | A2 call; 7,897 | Sparse tree traversal is expected; ordinary indexing incurs extra traversal. | The same boolean-carrier pattern is fixed structurally. Next: repeated null checks after dynamic proof, retaining opaque/raw effects. |
| `copying.read` / `resolveReference` | 10.28 / 13.46 | Same A2 | Permission checks and tracing are expected. | Cells, register moves and root traffic are overhead; assertions do not authorize removing checks. |
| `nativeObjectExtent` / `scanFields` | 5.72 / 4.12 | Same A2 | Extent validation and tracing are expected. | No independent algorithm defect established. |
| `compressWords` / `readSha256Word` | 12.23 / 5.85 | Earlier native compiler, 3,915 | Hashing the frozen sources is expected; new windows omit its early phase. | Optional absence-test payload work is isolated but its CPU/cycle gains remain mixed. |
| `findEntry` | 55.56 / 63.61 | Historical B division sloppy/strict | Shared JIT preparation is expected; tree-backed element reads are extra per operation. | Same emitted-operation patterns; no operator-specific shortcut. |
| `findEntry` / `copying.read` / `resolveReference` | 17.11 / 12.73 / 11.68 | Symbolized D catch-eval, 15,794 | Shared preparation and tracing are expected. | Same indexing, capture and guard work; original D samples stay distinct. |
| unavailable | unavailable | D's eight low-CPU indirect-eval timeouts | Starvation makes original wall timings inconclusive. | No function-share attribution invented. |
| V8 descriptor/property lookup stacks | Native sample share not applicable | B tiny 327.530 CPU s and unfinished left-shift batch | These run in Node before native entry. | Context only: generated native code does not execute this batch-compile path. |

The [comparison-branch report](native-comparison-branches-throughput-v1.md) ties
machine-code counts to the actual production list operation, CPU medians/spread,
retired instructions/cycles, unchanged canonical outcomes and identical native
self-build stage images. A TypeScript annotation does not prove the optimization:
verified block-local SSA and the final comparison's immediate branch consumer do.
Saved results and optional multiword comparisons retain their existing carriers.

The next null-bridge experiment only uses dynamic checks and immutable local
identities in heap-read-only, call-free closed leaf functions. Joins, reassignment,
exceptions, unknown effects and budget exhaustion remain conservative. It is
unmerged and has no claimed native improvement yet. No managed dense-array
whitelist is added: all 17 unsafe layout operations remain reachable in the
eval-preparation graph. [v12](native-hot-functions-v12.md) retains the indexed-Set
and scalar-register rejection evidence. Immutable word captures and bounded root
cleanup are now on main, with their completed reports linked from the runner docs.

[Raw attribution](native-hot-functions-v13.json) preserves every new selected
window and the complete exclusive groups. The [comparison evidence](native-comparison-branches-throughput-v1.json)
includes frozen toolchain/source identities and compressed samples. Canonical
compilation remains Node-hosted; operation-loop and native-compiler gains cannot
be extrapolated into a whole-suite wall-time forecast.
