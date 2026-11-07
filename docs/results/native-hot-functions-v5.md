# Fresh A1 profiles and shared-image optimization quality

These fresh symbolized A1 diagnostics use source snapshot `21a5c50d…c46f3b`,
including C2, the linked-syntax hash fix and inline primitive unions. Both execute
the unchanged sloppy `S11.6.1_A1.js` and unchanged harnesses under LLDB. The second
image applies only an AOT frame-planning prototype; both embed the same v9 compiler
source. Each receives 300 seconds after the confirmed initial stopped state.
Both time out: the baseline receives **229.034 CPU seconds**, and the AOT-frame
prototype **212.873**. These are retained diagnostics, not conformance totals or
completed-work speedup evidence.

The counts below are exclusive main-thread samples across ten selected windows
per diagnostic, not duration-weighted whole-run CPU percentages.

| Function                            |          Sample % | Workload                               | Expected-heavy vs overhead                                                                          | Emitted-code issue or limit                                                                                              |
| ----------------------------------- | ----------------: | -------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `sparse-list.findEntry`             | 15.25 (1228/8051) | A1 baseline, eval preparation          | Compiler tree walking is expected; a search for each source-array index is representation overhead. | Dense private arrays fix this for the closed compiler; raw-memory capabilities prevent applying that proof to this host. |
| `copying.read` (`closure@2762`)     | 14.43 (1162/8051) | A1 baseline, GC                        | Permission checks are required; unnecessary caller roots increase how often they run.               | The frame slice removes unused declarations. Static cold-path size alone does not prove a bad hot read path.             |
| `nursery.resolveReference`          |  11.29 (909/8051) | A1 baseline, GC                        | Tracing live objects is expected; redundant native roots and allocations add work.                  | Separate source-required objects from avoidable storage before changing codegen.                                         |
| `nativeObjectExtent`                |   5.12 (412/8051) | A1 baseline, GC                        | Descriptor/extent validation is expected safety work.                                               | No independent per-operation defect established.                                                                         |
| `sparse-list.findEntry`             | 23.26 (1852/7962) | A1 AOT-frame prototype                 | Same array-representation overhead; different phase occupancy cannot establish a regression.        | The compiler source embedded in this image is unchanged.                                                                 |
| `copying.read` / `resolveReference` |       9.53 / 9.16 | Same prototype                         | Same expected tracing and permission work.                                                          | The percentage changes are not completed-work speed measurements.                                                        |
| `types.relates`                     |    22.05 (58/263) | Dense native compiler, checking window | Expected-heavy type relation work.                                                                  | A hot checker function is not itself a P finding.                                                                        |
| `key-index.position`                |    10.65 (28/263) | Same native compiler window            | Hash/probe work is expected.                                                                        | Instruction cost needs its own operation benchmark before changing emission.                                             |
| `linked-set.hasSet`                 |     9.13 (24/263) | Same native compiler window            | Membership work in the chosen data structure is expected.                                           | No compiler-specific algorithm change proposed.                                                                          |

The [JSON](native-hot-functions-v5.json) preserves image/build identities, loads,
CPU bounds and all twenty compressed raw A1 samples. Earlier division, D catch
and D indirect-eval evidence remains separately identified in
[v2](native-hot-functions-v2.md) and [v3](native-hot-functions-v3.md); the catch
percentages are not substituted for the eight unsymbolized indirect-eval cases.

A compile-only audit explains why the large shared image gets poor scalar
cleanup. Its **21,357 functions / 4,076,544 instructions** consume the fixed
20-million work bound during local-load forwarding. That unfinished phase
publishes **zero rewrites**. After the small SSA changes, 4,086,044 instructions
remain, and unread-store, dead-scalar and final slot cleanup never run. Only
2,772 managed declarations are unused, explaining the limited effect of the
AOT-only frame prototype on this graph. This is a generated-code quality issue;
speeding the checker is not the proposed remedy.

The same read-only audit attempts the private-array proof on the managed graph,
discards any transformed result, and stops before native emission. The proof
rejects `stableRecordLayouts` because raw-memory capabilities can change object
descriptors. That is a real safety boundary, not an arbitrary count cap. Its
captured diagnostic stop exits 1 intentionally; it is not a native test failure.

Two inspected leads need no broad change: literal string-array `.includes`
already lowers without temporary array allocation, and `memory-read-word` returns
a checked safe integer up to `2^53-1` (or `-1`), rather than a uint32. Narrowing
that result would change semantics. The next prototype instead retains completed
function-local scalar cleanup under the same total work bound.
