# Native language-operation attribution after the Set experiment

The table ranks concrete generated-operation costs, preserving each workload's
own denominator. The compiler samples cover the same frozen 595-file input and
identical emitted image; selected windows are not duration-weighted whole-run
profiles. A2 and historical B/D profiles remain separate workloads.

| Function | Samples % | Workload | Expected-heavy vs overhead | Suspected emitted-code inefficiency / disposition |
| --- | ---: | --- | --- | --- |
| `types.relates` | 13.05 | Native compiler before, 3,915 samples | Type relations are expected compiler work. | No algorithm change proposed; heat alone is insufficient. |
| `linked-set.hasSet` | 12.95 | Same compiler | Membership is expected; linear large-set lookup adds avoidable per-query work. | Nine-entry hash promotion improves large lookup but loses leaf/register planning and adds GC pressure; held. |
| `compressWords` / `readSha256Word` | 12.23 / 5.85 | Same compiler | Hashing the frozen sources is expected. | Optional array-element absence tests compare unused payloads; isolated presence-tag emission is under native equivalence validation. |
| `key-index.position` | 9.77 | Indexed compiler, 3,921 samples | Probing is expected after changing representation. | Opaque hash/equality calls, tree-backed entry arrays and extra capture cells add per-operation costs. |
| `resolveReference` / generational `read` | 10.00 / 6.86 | Same indexed compiler | Tracing additional live objects is expected. | Eager indexes and redundant immutable-parameter cells increase allocation/root traffic. General word captures are being measured independently. |
| `sparse-list.findEntry` | 15.66 | A2 call, 7,897 samples | A tree search is expected for sparse storage; ordinary indexing pays extra. | Managed dense layout still requires a sound capability/ownership proof; all 17 unsafe layout operations are reachable. |
| `resolveReference` / `copying.read` | 13.46 / 10.28 | Same A2 | Tracing and permission checks are required. | Capture-cell/root/stack traffic are overhead candidates. Broad scalar callee-save promotion remains unready after a retained A1 timeout. |
| `nativeObjectExtent` / `scanFields` | 5.72 / 4.12 | Same A2 | Extent checks and tracing are expected. | No independent algorithm defect established; preserve checks. |
| `findEntry` | 55.56 / 63.61 | Historical B division sloppy/strict | Shared native JIT preparation is expected; tree-backed array reads are extra per-operation work. | Same managed-layout boundary; no operator-specific shortcut. |
| `findEntry` / `copying.read` / `resolveReference` | 17.11 / 12.73 / 11.68 | P's symbolized D catch-eval diagnostic, 15,794 samples | Preparation and tracing are expected. | Same indexing/capture patterns; original D raw-address evidence and low-CPU retries remain distinct. |
| Unavailable | unavailable | D's eight low-CPU indirect-eval timeouts | CPU starvation makes the original timings inconclusive. | No function-share attribution invented; originals retained. |

The [matched Set assessment](native-indexed-set-assessment-v1.md) proves both
17/17 canonical outcomes and byte-identical native self-build images, but rejects
the performance policy. Numeric `hasSet` grows from 144 instructions / 3 stores /
no calls to 349 instructions / 100 stores / one call. Even an unpromoted numeric
Set of eight members becomes 2.30x more expensive in CPU. The added callable
branch disables the whole-function nonallocating/leaf plan, making root and stack
costs affect the linear branch. Raising the threshold alone cannot solve this.
The 112-execution crossover matrix and Set-size histogram give an explicit
reference for expected operation cost rather than treating a hot checker as a bug.

The [scalar assessment](native-runtime-scalar-assessment-v1.md) retains all three
original contention timeouts and all three reserved single-variant rechecks.
Addition sloppy remains a timeout at 252.859 CPU seconds; addition strict and call
pass at 219.341 and 184.794 CPU seconds. Broad reusable-module scalar promotion is
not merge-ready. Its copying-GC benchmark gain does not override the full native
compiler counter tradeoffs or missing outcome equivalence.

A separate binding proof now permits immutable, initialized strict single-word
parameters to live directly in traced closure environment fields. Red tests show
five parameter cells disappear from a five-word capture factory. Objects, strings,
typed arrays, function references and boolean payloads retain their ordinary GC
field kinds. Mutation, defaults, aliases, sloppy arguments/eval and wider carriers
retain cells. The native moving-GC fixture passes eight checks; the five-million
factory benchmark gives CPU median 561.550 -> 304.184 ms, retired instructions
-46.5% and cycles -49.5%. This is preliminary bespoke evidence: full native
self-build and canonical outcomes remain required before merge readiness.

B's 327.530-CPU-second tiny batch and unfinished 45m41.60-CPU-minute left-shift
batch are **Node-hosted before native entry**. Their V8 descriptor/property-lookup
stacks are documented in [v9](native-hot-functions-v9.md). The one-pair hash-fix
increase was not a causal regression: the later fixed-host control in v4 measured
lower median CPU. J's Node OOM on 64 RegExp variants remains compile-side context
and is not pursued here. Current canonical runs still use the Node-hosted build
path, so generated compiler speedups cannot be scaled into batch compile hours.

[The A1/compiler report](native-hot-functions-v10.md), [symbolized A2 report](native-hot-functions-v11.md)
and [new machine-readable attribution](native-hot-functions-v12.json) preserve
source/image identities and exclusive sample denominators. No percentages are
summed across workloads, no timing is inferred from cumulative `elapsedMs`, and
no whole-suite speedup is projected from operation loops.
