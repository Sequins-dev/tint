# Symbolized A2 call preparation

A2's near-budget `language/expressions/call/S11.2.3_A1.js` sloppy now has a
symbolized native diagnostic: **265.618 CPU seconds**, final native exit 42,
10 usable windows and **7,897 exclusive main-thread samples**. The independent
canonical [nine-case selection](test262-perf-leaf-reference-v1.json) passes 9/9;
its call case uses 264.855 CPU seconds. These are separate observations, not an
extra coverage denominator or a causal before/after comparison.

| Function                            |   Samples % | Workload               | Expected-heavy vs overhead                                                 | Emitted-code inefficiency / next step                                                                                   |
| ----------------------------------- | ----------: | ---------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `sparse-list.findEntry`             |       15.66 | A2 call, 7,897 samples | Tree lookup is expected; tree-backed array access adds per-operation work. | Private dense layout still requires a sound proof across dynamic capabilities. No whitelist added.                      |
| `nursery.resolveReference`          |       13.46 | Same A2                | Survivor discovery is expected.                                            | Numeric locals spill throughout the reusable runtime module; inspect the existing scalar-only preserved-register plan.  |
| `copying.read` closure              |       10.28 | Same A2                | Permission/extent checks are required.                                     | Reusable module emission skips scalar register homes, leaving avoidable numeric stack traffic.                          |
| `nativeObjectExtent` / `scanFields` | 5.72 / 4.12 | Same A2                | Checked object extents and tracing are expected.                           | Same storage-policy lead; heat alone does not justify removing checks.                                                  |
| `linked-set.hasSet`                 |        4.01 | Same A2                | Its linear algorithm is expected.                                          | Pointer-bank transfers remain in reusable functions; the closed-executable leaf slice does not establish an A2 speedup. |
| `scanObject` / `preparePlan`        | 2.99 / 2.90 | Same A2                | Expected tracing and scratch planning.                                     | No independent algorithmic defect inferred.                                                                             |
| `string-equal`                      |        2.52 | Same A2                | String comparisons are expected.                                           | No allocation/conversion defect demonstrated.                                                                           |

The earlier [A1 and compiler table](native-hot-functions-v10.md) remains valid
for its own workloads. It includes B/D's historical evidence and distinguishes
Node-hosted compilation from Tint-native execution. A2's original unresolved
profile is retained; the new shares are measured here, not borrowed from A1.

Static disassembly of the H23 A1 runtime finds `copying.read` at 533 instructions,
127 loads, 143 stores and one call; `resolveReference` is 4,843 instructions,
1,084 loads, 2,206 stores and 12 calls. These are complete contiguous bodies,
not dynamic operation counts or A2 sample shares. The reusable-module path
currently disables `calleeSavedSlots` even though that planner accepts only
unboxed numbers/booleans, excludes address-exposed slots and already emits ABI
save/restore pairs. A red reusable-module regression test confirms the missing
parameter register home. Applying this existing scalar proof across the module
boundary is the next candidate. Roots, reference homes and safeguards remain
separate; no candidate speedup is claimed by this attribution report.

[Evidence](native-hot-functions-v11.json) retains the image manifest, source and
harness hashes, sampler windows, CPU/cycle/instruction counters, load averages
and initial-stop/final-exit assertions. Image SHA-256 is
`654f476fbc0ab8cd326a84086a53ceecc7c81a59e73bfc899d0279f296b6329d`,
frozen leaf27 source
`42ecbaecaef8cb1c9d0e53018ca9312db30536eee8fc146def448f6984286843`.
The diagnostic contains the builder's default 60-second timeout metadata; that
field is not emitted into native code. The diagnostic's independently recorded
post-entry watchdog is 300 seconds, and the canonical runner uses 300 seconds.
No watchdog or resource setting was increased to obtain a canonical pass.
