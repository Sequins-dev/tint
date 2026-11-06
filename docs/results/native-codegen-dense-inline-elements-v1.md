# Private dense arrays with inline general and boolean cells

The closed-executable private-array transform now admits `general` and
`optional-boolean` element cells. They fit the existing 32-byte cell layout.
Missing reads use their existing `general-none` and `boolean-none` encodings;
a missing vector entry remains distinct from a present cell storing undefined.
The layout, opacity/alias proof, sparse fallback and 10-million-work bound remain
unchanged. On the captured real compiler graph, admission rewrites 4,512 functions
using 8,675,732 work units. No alias-rule relaxation is needed for that graph.

The [matched operation benchmark](native-codegen-dense-inline-elements-v1.json)
uses one frozen production host and source snapshot. The baseline declines the
dense pass, matching the previous rejection on this mixed-element program; the
after image uses the unmodified production host. Both execute the same fixture:
1,025 number/string elements, a pop, and three million indexed-read iterations.

| Measurement                       |    Sparse baseline | Production dense |
| --------------------------------- | -----------------: | ---------------: |
| Median inferior user + system CPU |         605.922 ms |        63.215 ms |
| CPU range, four alternating pairs | 600.836–618.202 ms | 57.246–65.758 ms |
| Maximum unobserved CPU bound      |           4.709 ms |         1.677 ms |
| Median inferior wall time         |       1,174.908 ms |       159.890 ms |
| Expected native exits             |                4/4 |              4/4 |

Median CPU improves **9.59×** at load averages 44–53. Wall times are retained as
diagnostics. Amortized CPU is 201.97 versus 21.07 ns per read iteration, including
loop arithmetic, type checks, summation and initialization. This is not an
isolated load-instruction latency. The structural improvement replaces a search
through a tree with vector indexing and a value-cell read.

The expanded semantic fixture passes a Node reference and **eight fresh native
processes under LLDB**, each initially stopped and finally exiting 42. It covers
mixed general values, false, stored undefined versus holes, truncation, aliases,
closures, sorting, shrink/regrow, sparse migration, reference cycles and moving
GC on a 32 KiB heap. The focused compiler/IR tests first reproduced the admission
failure, then passed **18/18**. Raw counters, build manifests, adapter identity,
test logs and debugger outcomes are pinned in the JSON and compressed artifacts.

The matched full native compiler comparison is still running. The sparse-built
compiler has already emitted the expected dense image byte for byte; the
dense-built compiler must reproduce those same bytes. Production-host emission
equivalence, final artifact checks and workspace gates remain outstanding, so
this checkpoint does not claim merge readiness.

Test262's managed images explicitly disable this private-header optimization,
and native compilation also requires no managed surfaces before authorizing it.
That boundary remains intact. This slice targets generated native compiler code;
its operation speedup cannot be projected into whole-suite execution hours or
substituted for a Test262 outcome measurement.
