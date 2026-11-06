# Native hot-function attribution, initial evidence

Only native main-thread samples are counted. These are selected windows, not
whole-run or duration-weighted shares. Leaf samples are combined across generic
instantiations of the same source function. Raw data and exact counts are in
[native-hot-functions-v1.json](native-hot-functions-v1.json).

| Function | Sample % | Workload | Expected-heavy vs overhead | Suspected emitted-code inefficiency |
|---|---:|---|---|---|
| `sparse-list.findEntry` | 66.31% (5179/7810) | Native stage-2 compiler, checking | Tree traversal is expected for this encoding; a source array access should normally have an indexed path. | Tree-backed array encoding plus dependent pointer reads and storage copies. The first slice removed FP/integer-bank round trips, but the tree path remains. |
| `sparse-list.findEntry` | 91.32% (1473/1613) | Native stage-2 compiler, lowering | Same distinction: compiler tree walking is legitimate; tree search for each language array index is representation overhead. | Inspect why existing dense reference-list lowering declines the compiler, including direct header access in `popList`. |
| `nursery.resolveReference` | 27.01% (451/1670) | Native stage-2 compiler, GC during emission | Discovering/copying reachable objects is expected; primitive wrapper objects add avoidable work. | Mixed primitive fields allocate number boxes; root and descriptor traffic must be measured separately from necessary tracing. |
| `generational.read` | 24.55% (410/1670) | Native stage-2 compiler, same GC window | Range validation is required; repeated captured-record/cell unpacking and frame traffic may be excessive. | The retained body has 935 static instructions, 240 stack stores and 135 branch lines across all paths. These totals are not instructions executed per read. |
| `sparse-list.findEntry` | 54.53% (319/585) | B division sloppy, native eval/JIT preparation | Symbol lookup is expected; each backing-array access using tree search is additional language-operation cost. | Same array encoding and dependent record accesses as self-build; not division arithmetic. |
| `sparse-list.findEntry` | 62.64% (451/720) | B division strict, native eval/JIT preparation | Same expected algorithm / representation-overhead distinction. | Same pattern across separate inferior and checker phase. |
| `closures.stableFacts` | 5.98% (35/585) | B division sloppy, same window | Expected-heavy compiler algorithm; a hot checker function alone is not a P finding. | C2 owns its flow-fact fix. No compiler-specific algorithm change proposed by P. |
| Unresolved native PCs | Not yet attributed (804 samples) | P addition A1, original 300 s inferior | Insufficient symbol information to separate expected work from overhead. | Raw sample retained; fresh symbolized attribution required before claiming a named hotspot. |
| Unresolved native PCs | Not yet attributed (789 samples) | D eval/catch timeout | Insufficient symbol information; this is a native sample, not D's separate Node compile sample. | Raw sample retained; exact image/symbol-map reconstruction or fresh symbolized attribution required. |

The B handoff reports addition and Function diagnostics eventually exiting 42
outside the original containment interval. Its phase trace places work in shared
runtime-provider preparation, checking, lowering and linking, not arithmetic.
That trace is not a CPU sample percentage and is not substituted for one.

Initial rank: (1) source-array encoding and dependent copies; (2) unnecessary
primitive allocations and GC traffic; (3) repeated capture/guard/frame operations;
(4) boolean normalization and redundant control transfers. The latter has static
code-size evidence but no reliable CPU-speed claim from the saturated run.

The union/control-flow draft is excluded from accepted performance results:
its native compiler exits 1 with `runtime: generic specialization limit exceeded`
while the Node-hosted compiler succeeds on the same frozen sources. This is a
native/reference divergence to reduce, not evidence that the configured 16384
specialization bound needs increasing.
