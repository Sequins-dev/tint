# Bounded scalar cleanup: native evidence and remaining validation

This experiment changes generated scalar code for large graphs. It retains
completed function-local load forwarding, unread-store removal, dead-value
removal and slot compaction within the existing charged 20-million work bound.
It changes neither checker algorithms nor the specialization limit. The
implementation is committed but **not merge-ready**.

On the same frozen A1 source and harness snapshot as v5, the prototype completes
556,423 load forwards, removes 450,669 unread stores and compacts 436,281 slots.
The shared image shrinks from 209,152,239 to 195,827,055 bytes, including DWARF.
The sampled `findEntry` implementations contain 158 versus 130 instructions,
23 versus 9 loads, and 22 versus 7 stores. Their specialization identities were
not matched, and these static totals include cold paths. They motivate a matched
operation benchmark; they do not establish its runtime speedup.

The unchanged sloppy A1 variant still times out at 300 seconds. It receives
194.311 CPU seconds, with at most 0.106 seconds unobserved. The baseline v5
timeout receives 229.034 CPU seconds. Ratios between these unfinished runs are
not performance measurements. No new conformance pass or whole-suite projection
is claimed.

| Function                |          Sample % | Workload                                   | Expected-heavy vs overhead                                                                   | Emitted-code finding                                                                       |
| ----------------------- | ----------------: | ------------------------------------------ | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `sparse-list.findEntry` | 17.18 (1369/7969) | A1 cleanup prototype, ten selected windows | Tree walking is expected; a tree search per source-array index adds representation overhead. | Selected helper has fewer loads/stores; managed private-array proof still declines safely. |
| `copying.read`          | 13.74 (1095/7969) | Same native run                            | Permission checks are necessary; extra roots increase their frequency.                       | Its selected emitted body is unchanged by this prototype.                                  |
| `resolveReference`      |  12.11 (965/7969) | Same native run                            | Tracing is expected; avoidable allocations and roots add work.                               | Selected emitted body is unchanged; no independent per-operation gain established.         |
| `nativeObjectExtent`    |   4.96 (395/7969) | Same native run                            | Required extent/descriptor validation.                                                       | Heat alone does not establish an emission defect.                                          |

These are exclusive main-thread counts in selected windows, not whole-run CPU
shares. [The JSON](native-hot-functions-v6.json) retains all raw samples,
disassembly, identities, resources and loads. Earlier self-build, B division,
D catch and Node-hosted compile attribution remains in v2–v5.

The production implementation passes focused IR tests, including immutability,
budget accounting, effects, ABI parameters, guarded transfers and exception
storage. A dedicated fixture executes the new algorithm in native code and
returns 42 twice in fresh LLDB processes. It covers multiple budgets and a
25,000-instruction function preceding a small candidate.

Both Node hosts also build **byte-identical 60,095,682-byte compiler images**
from the same candidate sources, SHA-256
`a4e2b83b9bea7f8c0420f42227e13c8fb238ddad862c348cee4533515d302cb1`.
The ordinary closed-compiler graph therefore gets no emitted-code change from
this slice. Native stage-2 comparison and the fixed-work operation benchmark
remain incomplete: macOS blocked their debugservers in `task_for_pid` before
entry. The coordinator confirmed disabled Developer Tools authorization and a
SecurityAgent prompt. Their watchdog failures are pre-entry infrastructure,
with zero observed inferior CPU, not semantic observations.

Retained earlier failures include a bootstrap rejection of property-`in`
(rewritten with explicit branches), and a fixture expectation that incorrectly
allowed only 100 work units for a 150-instruction input. The corrected fixture
uses 200, 500 and 750 units; a separate test preserves the smaller-budget
all-or-nothing behavior. None of these observations is discarded or counted as
a native pass.
