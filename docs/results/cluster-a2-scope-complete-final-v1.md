# A2 native expressions completion

All **4,973 / 4,973** variants across the 18 owned expression families have passing native evidence: **3,753 runtime variants** and **1,220 native syntax/early-error variants**. The official coverage-ledger aggregate accepts all 28 artifacts with no rejections or unmeasured variants. Latest failures, unsupported cases, harness errors, crashes and timeouts are all zero.

These totals deduplicate complete selections and explicit-variant rechecks from separate frozen toolchains. They describe A2 scope evidence across those runs. Original full reports remain unchanged: object retains its three authorization timeouts, and the 783-variant expression report retains its eight timeouts. Separate focused reports supply the later passing observations.

| Selection | Latest pass / total | Complete report | Separate rechecks |
| --- | ---: | --- | --- |
| language/expressions/object | 2252 / 2252 | [Report](test262-language-object-direct-a2-native-v1.json) | [Rechecks](test262-object-authorization-recheck-a2-native-v1.json) |
| language/expressions/assignmenttargettype | 627 / 627 | [Report](test262-assignmenttargettype-a2-native-v1.json) | — |
| language/expressions/arrow-function | 643 / 643 | [Report](test262-arrow-function-a2-native-v1.json) | — |
| language/expressions/function | 484 / 484 | [Report](test262-function-a2-native-v1.json) | — |
| language/expressions/super | 184 / 184 | [Report](test262-reference-keys-super-v4.json) | — |
| language/expressions/array | 104 / 104 | [Report](test262-expressions-array-a2-native-v1.json) | — |
| language/expressions/call | 171 / 171 | [Report](test262-expressions-call-a2-native-v1.json) | — |
| language/expressions/new | 118 / 118 | [Report](test262-expressions-new-a2-native-v1.json) | [Rechecks](cluster-a2-new-isolated-rechecks-summary-v1.json) |
| language/expressions/template-literal | 114 / 114 | [Report](test262-expressions-template-literal-a2-native-v1.json) | — |
| language/expressions/optional-chaining | 76 / 76 | [Report](test262-expressions-optional-chaining-a2-native-v1.json) | [Rechecks](test262-optional-eval-sloppy-isolated-recheck-a2-native-v1.json) |
| language/expressions/tagged-template | 48 / 48 | [Report](test262-expressions-tagged-template-a2-native-v1.json) | — |
| language/expressions/conditional | 42 / 42 | [Report](test262-expressions-conditional-a2-native-v1.json) | [Rechecks](test262-conditional-strict-isolated-recheck-a2-native-v1.json) |
| language/expressions/property-accessors | 42 / 42 | [Report](test262-expressions-property-accessors-a2-native-v1.json) | [Rechecks](test262-property-eval-sloppy-isolated-recheck-a2-native-v1.json) |
| language/expressions/new.target | 28 / 28 | [Report](test262-expressions-new.target-a2-native-v1.json) | — |
| language/expressions/grouping | 16 / 16 | [Report](test262-expressions-grouping-a2-native-v1.json) | [Rechecks](test262-grouping-strict-isolated-recheck-a2-native-v1.json) |
| language/expressions/comma | 11 / 11 | [Report](test262-expressions-comma-a2-native-v1.json) | — |
| language/expressions/this | 11 / 11 | [Report](test262-expressions-this-a2-native-v1.json) | — |
| language/expressions/member-expression | 2 / 2 | [Report](test262-expressions-member-expression-a2-native-v1.json) | — |

All eight retained expression timeouts were rechecked individually through the official runner, with a fresh current-main freeze for each run, direct launch, the unchanged 300-second native budget and stderr heartbeat/CPU evidence. Each run, wrapper and CPU observer exited 0. No remaining A2 blocker or active A2 process remains.

Validation: `pnpm build` exited 0 for the frozen launches; per-selection and per-subset ledger validation exited 0; the final scope audit exited 0. A2’s own workspace gate passed 4,779/4,779 tests, types, boundaries and formatting. After rebasing over H’s witness correction, this docs-only completion slice reuses the recorded main gate at `631d2c01` (4,780/4,780), with no code delta since that gate. Portable compiler/runtime code was unchanged by this completion slice.

The historical object slot wrapper returned 1 after writing its complete report because the shared wrapper script was edited while running; its retained completion proof records that artifact. Native observations and denominators were preserved.

The object/dstr 1,122/1,122 report remains byte-identical, SHA-256 `15e58c9488d40ba977a8ae971e3d60cd1a7cea049bc43dbb3091efc307c315b0`. All 20 original complete baseline artifacts are also hash-identical.

Machine-readable audit: [complete final scope](cluster-a2-scope-complete-final-v1.json). Exact original-timeout resolution set: [eight isolated rechecks](cluster-a2-isolated-timeout-rechecks-summary-v1.json).
