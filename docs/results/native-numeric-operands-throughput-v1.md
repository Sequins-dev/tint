# Resident numeric operands: validated native throughput slice

Numeric arithmetic and comparisons now consume existing FP register homes
directly. Stack-backed operands retain scratch loads. The verified IR type
selects the path; source assertions remove no guard or conversion. Remainder
helper ABI, optional-value checks, result placement and rounding behavior remain
unchanged.

| Matched 500-million-iteration operation benchmark |                 Before |                  After |
| ------------------------------------------------- | ---------------------: | ---------------------: |
| CPU median, four alternating pairs                |           1,469.952 ms |           1,212.413 ms |
| CPU range                                         | 1,411.174–1,496.860 ms | 1,193.671–1,262.947 ms |
| Function bytes                                    |                    344 |                    296 |
| Frame bytes                                       |                    128 |                    128 |

All eight fresh LLDB processes stop at entry and exit 42. The source IR and frozen
v12 optimizer output are identical; only the frozen v12/v13 emitters differ.
Median CPU improves **1.212×**. A second four-pair control measures 18.542 versus
13.538 billion median instructions (**27.0% fewer**) and 5.584 versus 4.589 billion
cycles (**17.8% fewer**). Its CPU medians are 1,825.436 versus 1,457.747 ms. Both
sets retain every observation, load average and final missing-CPU bound.

The real native compiler workload uses the exact same 569-file source snapshot
`cf1e4c35…16b8` for both representations. Both compiler executions exit 0 and emit
identical bytes; the after compiler also reproduces its own stage image.

| Full native compiler execution, one matched pair |          Before |           After |
| ------------------------------------------------ | --------------: | --------------: |
| Inferior CPU                                     |       279.858 s |       273.372 s |
| Inferior wall                                    |       288.462 s |       279.503 s |
| Retired instructions                             |  2.896 trillion |  2.837 trillion |
| Cycles                                           | 903.653 billion | 878.724 billion |

That pair gives **2.3% lower CPU**, **2.0% fewer instructions** and **2.8% fewer
cycles**. It is one full-workload pair, not a repeated compiler CPU median. All
outputs are 59,914,162 bytes with SHA-256
`00ceb07857e4780b4fc999e65b76dd6f5485961b7a55f4be97d776b18a31aa43`;
signature and DWARF checks pass.

Three encoding tests cover all four arithmetic operations, numeric comparisons
and register pressure with stack fallbacks. The candidate numeric emitter also
runs 634 source-to-native scalar fixtures twice under LLDB, asserting entry and
final states and exact JavaScript-reference results, including signed zero, NaN,
subnormals, ordering and ABI cases. The adjacent canonical Test262 toolchains
both pass **6/6** across addition, division and strict equality, in sloppy/strict
modes, with identical outcomes and unchanged sources, harnesses and resources.

The numeric-only workspace gate passes **4,632/4,632**, types, boundaries and
formatting. [The JSON](native-numeric-operands-throughput-v1.json) retains exact
identities, complete canonical reports/journals, CPU/counter ranges, native stage
images and validation logs. Static same-IR function-range counts in
[native-hot-functions-v7](native-hot-functions-v7.md) independently show 55,733
removed FP moves. No whole-suite hours are inferred from these workloads.
