# Bounded scalar cleanup: validated native throughput slice

Large graphs now retain completed function-local scalar cleanup within the
existing work bound. An oversized function keeps its completed checkpoint and
cannot prevent later small functions from being cleaned. Single-function and
initial-scan exhaustion retain the previous all-or-nothing behavior. No checker
algorithm, specialization limit, resource limit or conformance policy changes.

| Matched operation measurement      |             Before |              After |
| ---------------------------------- | -----------------: | -----------------: |
| CPU median, four alternating pairs |         147.758 ms |         140.825 ms |
| CPU range                          | 146.219–150.515 ms | 131.267–142.487 ms |
| Function bytes                     |                360 |                344 |
| Frame bytes                        |                160 |                128 |

All eight fresh LLDB processes stop at entry and exit 42. Both images execute the
same 50-million-iteration IR workload, with 100 cold functions consuming the same
1,000-unit optimization budget. Their before/after optimizer hosts are frozen;
the common frozen v12 emitter reproduces both measured images byte for byte.
The median CPU improvement is **1.049×**. The maximum unobserved final CPU interval
is 1.313 ms; loads and individual observations are retained in the JSON.

A longer control uses the same workload at 500 million iterations and holds the
later numeric-operand emitter constant. Four further alternating pairs retire
15.552 versus 13.547 billion median instructions (**12.9% fewer**) and use 4.670
versus 4.591 billion cycles (**1.7% fewer**). Its CPU ranges overlap and its median
CPU is effectively unchanged, 1,411.795 versus 1,418.689 ms. These complementary
controls do not justify extrapolating a loop ratio to a full-suite speedup.

The optimizer itself also executes natively in the earlier frozen portable
fixture: two fresh LLDB processes exit 42, checking several budgets, immutable
inputs and a 25,000-instruction function preceding a small candidate. Unit tests
add effects, guarded transfers, ABI/exception storage and budget accounting.

The before/after Node hosts emit the **same 60,095,682-byte compiler image** from
the same 568-file implementation snapshot `b51e0f94…4c6e`. Its native self-build
exits 0 and reproduces that image exactly, SHA-256
`a4e2b83b9bea7f8c0420f42227e13c8fb238ddad862c348cee4533515d302cb1`.
Signature and DWARF verification pass. Because the two compiler images are
identical, this slice claims no closed-compiler execution speedup.

The complete canonical before/after selection reports each pass **6/6**, with
identical outcomes, pinned sources and harness hashes: boolean/wrapper addition,
signed-infinity division and strict-equality ReferenceError handling, each in
sloppy and strict mode. Both use direct debugserver launch, fresh processes and
unchanged 300-second containment/resources. The baseline composes frozen v10
compiler packages with v12's explicit-subset runner instrumentation under a new
content-addressed toolchain identity; it does not mutate the old freeze or weaken
its identity guard. Native builder, debugger adapter and identity-guard source
hashes are identical across those toolsets.

The cleanup-only workspace gate passes **4,629/4,629**, types, boundaries and
formatting. [The JSON](native-scalar-budget-throughput-v1.json) includes complete
canonical reports/journals, exact frozen identities, native stage comparison,
CPU/counter observations, reproducible builders and gate logs. Earlier failed
bootstrap/fixture attempts and pre-entry authorization stalls remain in
[native-hot-functions-v6](native-hot-functions-v6.md). Whole-suite hours remain
unprojected: the loop is not a representative execution mix, and Node-hosted
fixed compilation is a separate dominant cost.
