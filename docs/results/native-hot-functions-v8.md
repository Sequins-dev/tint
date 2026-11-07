# Stable numeric captures: generated-code evidence

This candidate removes reference cells for captured numeric parameters only when
binding analysis proves initialization and no reassignment. A strict function
with simple parameters qualifies. Writes in descendants, declaration aliases,
defaults, destructuring/rest, parameter copies, sloppy or unknown strictness,
`eval` and `arguments` access retain the existing cell representation. Source
type assertions do not remove dynamic conversions or validation.

The full workspace gate passes **4,634/4,634 tests**, types, boundaries and
formatting on `55ea8a4`. Five new lowering tests cover numeric payloads, owner and
descendant writes, update expressions, `var` redeclaration, default parameters,
local TDZ fallback, forwarded captures and sloppy functions inside linked
modules. A native semantic fixture is built from the same frozen inputs with
both hosts. It exercises signed zero, NaN, forwarding, mutation and collection
across returned closures. **It has not executed.**

The slice is **not merge-ready**. Developer Tools authorization remains disabled.
There are no new native CPU measurements, outcome equivalence results or
stage-image comparisons. Previously blocked launches remain pre-entry
infrastructure observations. No runtime speedup or whole-suite projection follows
from the static results below.

| Function / same-source workload    | Instructions before → after | Loads before → after | Stores before → after | Calls before → after |
| ---------------------------------- | --------------------------: | -------------------: | --------------------: | -------------------: |
| A1 shared image, `copying.read`    |                   852 → 557 |            190 → 138 |             294 → 166 |                1 → 1 |
| Same A1 image, `generational.read` |                   850 → 850 |            184 → 184 |             254 → 254 |                1 → 1 |
| Fixed-work region closure          |                     95 → 55 |               11 → 5 |                 6 → 6 |                0 → 0 |

The first comparison emits the exact same two A1 variants, unchanged sources and
harnesses, with a 300-second containment budget and identical resource settings.
The source snapshot is `3537e882…7926b`. The latest local-indexed capture marker
implementation emits **byte-identical** A1 output to the earlier guarded lookup:
195,923,455 bytes, SHA-256
`242be5ad018bc756457d6e4b77f9fbc0912391892b02ab481d31688e39419f0c`.
The baseline image is 196,105,087 bytes. These image sizes include DWARF.

The fixed-work region benchmark uses the latest `0acbb505…75aa` source snapshot
for both hosts, three million varying addresses and an unchanged expected count
of 2,999,685. Node reference execution returns 42. Its source closure performs
range comparisons; eliminating three repeated cell-state/payload reads explains
the reduced body. Static counts cover all paths, including cold traps. They are
not hardware instruction counts. The disassembly parser now asserts contiguous
four-byte addresses; an earlier whitespace regex incorrectly skipped an
instruction after `ret`. The table above corrects the earlier commentary totals.

The generational callback is deliberately retained as a negative control. Its
bounds already live in a captured local record, which this narrow parameter-only
proof does not change. Its profile share cannot be counted as a gain from this
candidate.

Both hosts also prepare fresh compiler stage-1 images from the **same latest
570-file frozen source snapshot** `0acbb505…75aa`: 59,963,922 bytes before and
59,815,314 after. Both signatures and DWARF verify successfully; the abbrev,
info and line sections are nonempty. Building these images under Node proves
preparation only. Neither has been launched, and stage 2 remains pending.
Parent CPU in the preparation record excludes child CPU and is not a compiler
performance measurement.

Node-hosted compile controls retain a separate cost warning. The original pair
used 285.71 versus 349.54 CPU seconds. A subsequent quiet-window pair reproduces
the respective image bytes in 112.90 versus 113.77 CPU seconds, so the earlier
22% increase does not reproduce in that pair. The latest local-indexed lookup
uses 144.06 CPU seconds in one run and emits the same after-image bytes. These
are single runs without randomized ordering; neither a causal compile-cost
improvement nor a native speedup is established. The JSON retains wall time,
CPU, load and exact toolchain identities for every observation.

## Native hot-function attribution across real workloads

These are exclusive main-thread counts in selected historical windows, not
whole-run CPU shares. Versions matter: earlier rows precede subsequently merged
array, union and frame improvements. Shares from different runs are not added.
The prior reports retain exact source/image identities, resources, loads and raw
samples.

| Function                                                     |                        Sample % | Workload / evidence                                                                  | Expected-heavy vs overhead                                                                                    | Emitted-code finding or remaining limit                                                                                                                                                                               |
| ------------------------------------------------------------ | ------------------------------: | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sparse-list.findEntry`                                      | 66.41 checking / 91.32 lowering | Native stage-2 compiler, [v2](native-hot-functions-v2.md)                            | Compiler traversal is expected; an AVL search for each array index is representation overhead.                | Dense private arrays subsequently delivered 3.96× matched native compiler CPU improvement. Managed shared hosts still reject the opacity proof because raw-memory capabilities can mutate layouts.                    |
| `types.relates` / `key-index.position` / `linked-set.hasSet` |            22.05 / 10.65 / 9.13 | Dense native compiler checking window, [v5](native-hot-functions-v5.md), 263 samples | Expected-heavy relation and membership work.                                                                  | No independent emission defect follows from these hot functions; no checker algorithm change proposed.                                                                                                                |
| `generational.read`                                          |                           24.55 | Native stage-2 compiler GC window, [v2](native-hot-functions-v2.md)                  | Permission and address validation are required; repeated cell unpacking is additional per-read work.          | Latest matched static body is unchanged by the parameter-only candidate; do not claim its sample share as removable.                                                                                                  |
| `sparse-list.findEntry`                                      |     55.56 sloppy / 63.61 strict | B division inferiors, [v2](native-hot-functions-v2.md)                               | Shared eval/JIT preparation traverses compiler data; backing-array tree searches add language-operation cost. | Same representation pattern as the self-build, not division arithmetic. Safe managed-host isolation remains unresolved.                                                                                               |
| `sparse-list.findEntry`                                      |                           15.25 | Fresh A1 baseline, [v5](native-hot-functions-v5.md), 8,051 samples                   | Tree traversal is expected; array representation adds dependent pointer reads.                                | Managed-host dense-array proof declines safely. The bounded cleanup candidate improves emitted scalar code without removing that boundary.                                                                            |
| `copying.read`                                               |                           14.43 | Same A1 baseline                                                                     | Raw-read permission checks are required; eager capture cells add repeated validation and loads.               | At least 41.22% of callback samples are in its entry range, including necessary ABI/root setup. The current candidate reduces the matched full body from 852 to 557 instructions; execution share remains unmeasured. |
| `nursery.resolveReference`                                   |                           11.29 | Same A1 baseline                                                                     | Tracing live objects is expected; unnecessary allocations and roots increase its frequency.                   | Existing union and frame slices address some callers. Heat alone does not justify weakening collector validation.                                                                                                     |
| `findEntry` / `copying.read` / `resolveReference`            |           17.11 / 12.73 / 11.68 | D catch-eval inferior, [v2](native-hot-functions-v2.md), 15,794 samples              | Same representation/capture overhead during shared preparation, alongside expected tracing.                   | Same emitted-language patterns; no new catch-semantics result.                                                                                                                                                        |
| Not symbolized                                               |                     Unavailable | D's eight indirect-eval timeouts, [v3](native-hot-functions-v3.md)                   | Low observed CPU makes their timeouts inconclusive.                                                           | No function attribution is available; catch-eval percentages are not substituted for these cases.                                                                                                                     |

B's 327.530-CPU-second tiny compile and the unfinished 45m41.60-CPU-minute
left-shift compile both ran **in Node**, before an inferior entered. Their
profiles are not Tint-generated execution. The latter sample attributes 37.82%
to V8 descriptor search and 20.46% to property lookup. C2 owned the implicated
flow-fact algorithm and its fix is included in these freezes. The earlier
claimed hash-fix slowdown did not reproduce causally: [v4's identical-source
cross-pair](native-hot-functions-v4.md) gave a 1.30× lower median CPU cost for the
fixed host. No hash rollback or lost-sharing conclusion is supported.

[The JSON](native-hot-functions-v8.json) retains current compile controls,
exact frozen identities, preparation manifests, corrected disassembly counts,
complete gate logs and failed attempts. Native validation resumes only after
`HOST AUTHORIZATION RESTORED` is recorded: semantic fixtures, alternating
fixed-work CPU pairs, one reserved `selfbuild-perf 1` stage comparison and then a
slotted canonical A1 explicit-variant recheck. No READY entry is written for
these unvalidated candidates.
