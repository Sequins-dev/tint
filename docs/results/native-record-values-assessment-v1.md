# Hold early record-value forwarding

> Status 2026-11-17: rejected, not merged. The candidate branch
> `perf/test262-field-values` (pass in 55e18e46e, scheduling fixes 62e4abba7,
> 5435a8c28, edde6bebb) was deleted; only this evidence is kept. These
> measurements ran under the old 20M optimization work bound, which starved
> late passes (see [the experiments table](../native-performance-analysis.md)),
> so the idea is unproven rather than disproven; a retry would be a fresh
> implementation on the current IR. Compressed raw artifacts were not carried
> over.

The repeated-string-field operation benchmark improves, but **all three measured native compiler candidates regress in instructions and cycles**. These candidates are held. No READY entry or main performance claim accompanies this report. The source-pinned comparisons below are separate cohorts.

| Native compiler cohort | Before CPU s | After CPU s | Instructions change | Cycles change | Candidate stage bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| Early field phase | 248.741 | 273.973 | +16.40% | +17.44% | 57,466,306 |
| Local branch cleanup only | 255.139 | 259.531 | +16.39% | +16.06% | 57,499,346 |
| Local cleanup priority only | 206.802 | 256.303 | +16.37% | +21.15% | 57,499,442 |

All six native compilers stop initially, exit 0, and produce their own cohort’s identical candidate stage-1 bytes. Signing/DWARF checks pass. CPU is inferior user+system, with final missing-CPU bounds, wall time and load retained. There is only one execution per representation in each cohort; these are not repeated CPU medians.

The initial four-pair string-membership benchmark is 217.408→157.653 ms median CPU (1.379x), instructions −16.1%, cycles −29.2%. A repeated final-source preparation is 174.961→127.767 ms. Native reference-membership CPU is mixed. All 96 operation/semantic inferiors across four source cohorts exit 42; their source identities, ranges and counter medians are retained independently. These results do not override the whole-compiler regression.

Matched compiler disassembly explains the failure: the string `hasSet` specialization grows 153→167 instructions, 3→17 stores and 24→38 pointer/float moves while losing one comparison call and one field load. An optional analysis phase displaced established copy/store cleanup under the fixed work bound. Large generated bodies also grow: `prepareNumericModule` by 94,358 instructions, checker `expression` by 78,579 and codegen `emitModule` by 64,233. Their algorithmic work is expected; the extra generated storage traffic is the finding.

Red/green regressions reproduce 2,500 retained stores versus zero at the same work bound. Both the full-module and large-graph cleanup routes are covered. The latest unmeasured correction places optional field work after established cleanup and limits it to bounded remaining work; its prepared image must be inspected independently. Earlier native results do not validate that correction.

Both original-scheduling canonical reports pass **9/9**, including addition A1 sloppy/strict and call A1 sloppy. Their Test262 source/harness hashes, strictness/goals, resources, fresh-process isolation, 300 s containment, sealed source graph, complete journals and CPU/load ledgers match. They are overlapping performance selections, not additional coverage. The policy candidates remain unmerged and these counts are not attributed to main.

The baseline-control mismatch was specifically DWARF compilation-directory metadata: `--snapshot` embeds the capture directory. Text/data/debug-line hashes matched; the original observations are retained. A fresh baseline built against the same sealed root then matched the control byte for byte. No binary normalization was used. Other source-preparation failures and the failed test-type gate remain pre-entry/setup evidence.

[Raw evidence](native-record-values-assessment-v1.json) retains source/toolchain identities, manifests, every native counter observation, whole-stage hashes, complete canonical reports and hash-indexed compressed artifacts. The [updated attribution](native-hot-functions-v17.md) separates expected graph/tracing work from emitted-operation overhead. No whole-suite speedup is projected.
