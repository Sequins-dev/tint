# Node compilation and D's indirect-eval checkpoint

The [native hot-function table](native-hot-functions-v2.md) remains the generated
code attribution. This addendum incorporates B's newly merged matched compilation
and pathological 64-variant run, plus D's paused indirect-eval checkpoint. **Node
samples below are not Tint-emitted execution.** Their percentages must not be
combined with the native sample shares.

| Function | Sample % / method | Workload / host | Expected-heavy vs overhead | Suspected emitted-code inefficiency |
|---|---:|---|---|---|
| `stableFacts` | 14.93 / 13.64; weighted elapsed samples | Tiny compile, main / hash candidate, Node | Scanning facts is algorithmic work; repeated full-set scans can scale poorly. | Not Tint output. C2 owns the checker fix; native counterparts also expose the array encoding described in v2. |
| `forgetNarrowed` | 13.52 / 12.24; weighted elapsed samples | Same Node pair | Same algorithmic distinction. | Not Tint output; do not turn a hot checker into a P codegen finding. |
| `key-index.set` / `get` | 9.68 / 7.44 (main); 8.50 / 5.49 (candidate) | Same Node pair | Indexing is expected compiler work; representation/probing cost needs separate evidence. | V8 executes these functions here. Native equivalent backing-array reads remain a P target. |
| `DescriptorArray::BinarySearch` | 37.82 (1399/3699), exclusive main-thread samples | 64-variant left-shift compile, Node/V8 | Named-property lookup is expected for named keys; accidental negative array probes may add avoidable cost. | Not Tint output. `stableFacts` probes `narrowed[token - bindings.length]`; ordinary tokens produce negative property keys. This is a lead, not a captured property-name trace. |
| `LookupIterator::LookupInRegularHolder` | 20.46 (757/3699), same window | Same Node/V8 run | Confirms property-lookup work, not an arithmetic loop. | Same host-runtime lead. A separate JS stack locates `stableFacts`, but does not supply a JS function sample percentage. |
| `stableFacts` | No percentage: one JS stack | Same 64-variant Node run | Repeated full-set scans are a plausible superlinear mechanism. | C2 scope. The retained observations do not establish a scaling exponent. |
| Not symbolized | No function share available | D's eight indirect-eval timeouts, native | All eight have low CPU-share classifications; timeout alone does not locate the cost. | Shared JIT preparation is a hypothesis. Do not substitute the catch workload's named percentages for these cases. |

B's tiny compile is **327.530 CPU s / 341.557 wall s** on its main snapshot versus
**365.818 CPU s / 376.630 wall s** on the hash candidate: +11.69% CPU in one cold
pair. Both ran entirely in Node, before any inferior. Checking sampled elapsed is
nearly unchanged, 205.365 versus 206.317 s; the increase lies mainly in
codegen/IR/image/GC samples. The candidate image is also **2.40% larger**
(154,371,839 versus 158,070,527 bytes).

The original pair changes the Node linker implementation **and the linker source
compiled into the shared native host**. It therefore does not isolate host hash
lookup from the cost of compiling the changed embedded compiler. A cross pair
using one identical native source snapshot for both frozen Node hosts is running;
its structural counters record checker graph and emitted-module sizes. No hash
rollback or causal regression claim is justified yet.

The large run ended with **45m41.60 CPU / 77m33 wall**, zero variant observations,
and no native variant entered. Its stack and sample implicate checking and V8
property access. Comparing this interrupted 64-variant batch with a completed
2-variant batch cannot establish superlinear scaling: source sizes differ, the
fixed shared graph is large, and completion time is unknown. C2 owns the
`stableFacts`/`forgetNarrowed` hotspot; P retains the operational attribution.

D is paused: **76 passes, 8 timeouts, 34 unobserved out of 118**, an incomplete
84-observation prefix. Every timeout is classified load-sensitive/inconclusive.
Exact paths and CPU audits are copied in
[native-hot-functions-v3-d-paused-checkpoint.json](native-hot-functions-v3-d-paused-checkpoint.json).
For the distinct catch-eval case, D's earlier near-full-core observation was
260.07 CPU s / 266 elapsed s; the later recheck received only 203.91 / 296.
P's symbolized catch profile in v2 establishes collection/GC preparation work for
that image, without converting any timeout into a pass or resuming D.

The native compiler core is portable and self-hosted, but today's CLI builds the
fixed compiler catalog and compiler entrypoint. It cannot simply replace the
Test262 batch builder. A native batch bridge must carry the exact generated host
modules, managed-surface contracts, bindings and resource settings, then prove
image/outcome equivalence. Native self-hosting alone does not demonstrate that
this would outperform Node.

At 327.530 CPU s per batch, 64-variant occupancy would imply an optimistic
**146.84 compilation CPU hours** for 103,264 variants; the observed 2-variant
occupancy implies **4697.50 hours**. These are conditional scenarios, not suite
predictions, and exclude inferior execution. The unfinished large batch already
invalidates assuming a constant tiny-batch cost across all 64-variant groups.

Exact measurements and provenance are in
[native-hot-functions-v3.json](native-hot-functions-v3.json). Primary B evidence:
[matched investigation](operator-matched-compile-investigation-v1.json),
[live JS stack](operator-left-shift-node-checker-stack-v1.txt), and
[five-second sample](operator-left-shift-compile-sample-v8-5s.txt).
