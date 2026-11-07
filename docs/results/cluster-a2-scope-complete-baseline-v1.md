# A2 complete coverage baseline

All 4,973 variants across the 18 A2-owned expression families have complete native evidence: 4,965 pass and eight retained timeouts. No semantic failures, unsupported cases, harness errors or crashes. This is a deduplicated aggregate of separate complete reports on varying frozen toolchains; it is not a single current-compiler or whole-suite measurement. The three original object authorization timeouts have separate passing rechecks.

| Selection | Pass / total | Timeouts |
| --- | ---: | ---: |
| language/expressions/object | 2252 / 2252 | 0 |
| language/expressions/assignmenttargettype | 627 / 627 | 0 |
| language/expressions/arrow-function | 643 / 643 | 0 |
| language/expressions/function | 484 / 484 | 0 |
| language/expressions/super | 184 / 184 | 0 |
| language/expressions/array | 104 / 104 | 0 |
| language/expressions/call | 171 / 171 | 0 |
| language/expressions/new | 114 / 118 | 4 |
| language/expressions/template-literal | 114 / 114 | 0 |
| language/expressions/optional-chaining | 75 / 76 | 1 |
| language/expressions/tagged-template | 48 / 48 | 0 |
| language/expressions/conditional | 41 / 42 | 1 |
| language/expressions/property-accessors | 41 / 42 | 1 |
| language/expressions/new.target | 28 / 28 | 0 |
| language/expressions/grouping | 15 / 16 | 1 |
| language/expressions/comma | 11 / 11 | 0 |
| language/expressions/this | 11 / 11 | 0 |
| language/expressions/member-expression | 2 / 2 | 0 |

The official coverage-ledger aggregate accepted all 20 artifacts with no rejections. The JSON audit records every pinned source/harness identity, selected report, frozen toolchain provenance, evidence hash and canonical ledger hash. Static aggregation added zero native executions.

Eight original timeouts remain scheduled for one-variant, direct-launch rechecks at the same 300-second budget on freshly frozen current main. Conditional and grouping strict reached over 250 CPU-seconds; the four new-expression cases, optional indirect eval and property-accessor sloppy had reduced recorded CPU share and remain inconclusive under load. Original reports are immutable.

The complete object/dstr 1,122/1,122 report remains byte-identical: SHA-256 `15e58c9488d40ba977a8ae971e3d60cd1a7cea049bc43dbb3091efc307c315b0`.

Audit: [cluster-a2-scope-complete-baseline-v1.json](cluster-a2-scope-complete-baseline-v1.json). Recheck inputs: [eight exact variants](cluster-a2-remaining-expressions-recheck-variants-v6.json).
