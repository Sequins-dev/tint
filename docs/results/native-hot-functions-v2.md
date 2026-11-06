# Native execution attribution: self-build, addition, division and eval

This report supersedes the attribution gaps in v1. Counts are **exclusive native
main-thread samples**, combined across specializations of each source function.
The new parser subtracts child counts from the complete call tree; unlike the
printed leaf summary, it retains groups below five samples. This slightly raises
some v1 counts. These are selected windows, **not duration-weighted whole-run
shares**, and shares from different workloads must not be added.

| Function | Sample % | Workload | Expected-heavy vs overhead | Suspected emitted-code inefficiency |
|---|---:|---|---|---|
| `sparse-list.findEntry` | 66.41% (5187/7810) | Native stage-2 compiler, checking | Traversing the compiler's own trees is expected; an array index requiring an AVL search is representation overhead. | Dependent pointer reads for each source-array access. Existing dense-list lowering declines some live helper paths; direct `popList` header mutation is one known barrier. |
| `sparse-list.findEntry` | 91.32% (1473/1613) | Native stage-2 compiler, lowering | Same distinction; a hot lowering pass alone would not identify a codegen defect. | Same tree-backed array operations, even after the accepted register-copy improvement. |
| `nursery.resolveReference` | 27.01% (451/1670) | Native stage-2 compiler, GC during emission | Tracing live objects is expected; primitive wrapper objects increase the work unnecessarily. | Heterogeneous primitive fields still allocate boxes. The inline-union draft targets this but remains blocked on native equivalence. |
| `generational.read` | 24.55% (410/1670) | Native stage-2 compiler, same GC window | Memory range and address validation are necessary; repeated capture unpacking and stack traffic warrant inspection. | Retained body: 935 static instructions, 240 stack stores, 135 branch lines over all paths. These are not executed instructions per read. |
| `sparse-list.findEntry` | 55.56% (325/585) | B division sloppy, eval/JIT preparation | Hash/symbol lookup is expected; tree searches for the backing array are extra language-operation cost. | Same array representation and dependent record reads as self-build, rather than division arithmetic. |
| `sparse-list.findEntry` | 63.61% (458/720) | B division strict, eval/JIT preparation | Same expected algorithm / representation distinction. | Same generated-language pattern in a separate inferior. |
| `closures.stableFacts` | 5.98% (35/585) | B division sloppy | Expected-heavy compiler algorithm; heat alone is not a P finding. | C2 owns its flow-fact fix. P does not propose a checker algorithm change. |
| `sparse-list.findEntry` | 17.50% (2813/16073) | Addition A1 sloppy, ten windows during 300 s diagnostic | Array access representation overhead; the call stacks are in shared eval/runtime-provider preparation. | Tree-backed arrays, dependent pointer loads and generic record operations. |
| `copying.read` (`closure@2762`) | 12.55% (2017/16073) | Addition A1, same windows | Checking permission before a raw read is required; repeatedly unpacking captured scalar cells is per-operation overhead. | Retained body: 1027 static instructions, 280 stack stores and 148 branch instructions across all paths; inspect capture/cell reuse and word checks. |
| `nursery.resolveReference` | 10.66% (1713/16073) | Addition A1, same windows | Collection is expected; source-node and primitive-wrapper allocation increase tracing frequency. | Separate avoidable boxing/root traffic from required object traversal before changing emission. |
| `sparse-list.findEntry` | 17.11% (2703/15794) | D direct eval/catch, ten windows during 300 s diagnostic | Array encoding overhead while compiling the eval body, not evidence of a catch-semantics defect. | Same tree-backed array reads as A1 and self-build. |
| `copying.read` (`closure@2762`) | 12.73% (2010/15794) | D direct eval/catch, same windows | Required range checks plus suspected repeated capture/cell overhead. | Same large emitted read callback as A1. |
| `nursery.resolveReference` | 11.68% (1845/15794) | D direct eval/catch, same windows | Expected tracing with potentially avoidable allocations. | Same allocation and descriptor/root traffic pattern as A1. |

## Provenance and limits

Exact counts, image hashes, source identities, load averages for every sampling
window, CPU observations, and compressed raw samples are in
[native-hot-functions-v2.json](native-hot-functions-v2.json). The two new runs
began stopped at entry under LLDB and were contained at 300 s. A1 received
171.937 CPU seconds; D received 213.142. Both are retained timeouts, **not new
conformance passes or completed-result equivalence**. Load rose above 500 during
A1; D overlapped the recorded memory-emergency window. Wall time cannot establish
a speedup, nor can these load-induced timeouts establish an execution regression.

A1 uses B's preserved debug image `be640f90…c3fc`, case 0. D uses the exact unchanged
`annexB/language/eval-code/direct/var-env-lower-lex-catch-non-strict.js` sloppy
selection (source SHA `6fd82b98…de57`) and D's frozen 568-file snapshot
`ff22a2a0…5bca`. The D build adds a debug directory to its existing debug-symbol
option; it does not edit test or harness sources. Its image is `e2d14b46…4a8d4`.
The build took 564.974 s wall / 374.193 s Node CPU; that compilation is excluded
from native sample attribution. B's original division profiles and self-build
windows remain separately identified in the JSON.

The read-callback disassembly is retained in
[native-hot-functions-v2-addition-copying-read-disassembly.txt](native-hot-functions-v2-addition-copying-read-disassembly.txt).
Its static totals cover cold error/validation paths as well as normal reads;
profiling PCs and a same-operation benchmark are needed before assigning an
executed instruction cost. The initial register-copy slice already measured a
2.03x native CPU improvement on dependent record traversal with equal results;
that does not imply a 2.03x whole-compiler or suite improvement.

## Ranked investigation

1. **Source-array encoding.** The largest self-build shares and common to all
   three eval/JIT workloads. Diagnose why the existing closed-program dense-list
   transform declines; preserve header opacity, holes, undefined values, aliasing
   and managed-provider ABI boundaries.
2. **Primitive allocation and tracing.** The union draft removes boxes and shows
   a focused native gain, but cannot land until self-hosted output is identical.
3. **Capture and guard reuse.** Read callbacks occur in all sampled collectors;
   prove which repeated reads are immutable and dominated, without hoisting TDZ
   checks or crossing effects that invalidate a proof.
4. **Control transfers and boolean normalization.** Static reductions are known;
   no reliable CPU gain has yet been measured for that draft under saturation.

The native union/control-flow blocker is now narrowed: at the failure, both the
instance count and bound are exactly 16384; the current identity is
`665:n21:__tint_contract_25261[]`. A Node observation hook on the same frozen input
finishes that runtime-specialization pass with 8607 instances. The limit is a
finite work budget, and the native/reference divergence must be fixed without
raising it. Small native literal-key/dedup and actual-specializer fixtures each
pass three fresh processes, so they do not reproduce the full failure.
