# Dense arrays: matched native compiler execution and production equivalence

The same compiler implementation, generated with sparse versus dense private
arrays, compiles the same sealed 568-source graph with **3.96× lower inferior
CPU**. Both executions emit exactly the same compiler image.

| Measurement                | Sparse-generated compiler | Dense-generated compiler |
| -------------------------- | ------------------------: | -----------------------: |
| Inferior user + system CPU |               1,576.460 s |                397.927 s |
| Maximum missing CPU bound  |                   0.105 s |                  0.104 s |
| Inferior wall time         |               3,085.735 s |                527.469 s |
| Final native exit          |                         0 |                        0 |
| Emitted image bytes        |                60,838,434 |               60,838,434 |

The emitted SHA-256 is
`1dab38f754be7255d3579175932d16fceafc560640d9cabda4f8abc760b3944d`.
The dense compiler's own stage-1 image has those exact bytes. Signature and DWARF
checks pass, with nonempty debug abbreviation, information and line sections.
This is one full native execution per representation; the separate
[operation benchmark](native-codegen-dense-inline-elements-v1.json) supplies
four alternating pairs and CPU median/spread, with a **9.59×** gain and eight
equivalent native exits. Wall timings remain diagnostics under changing load.

The [complete record](native-codegen-dense-inline-selfbuild-v1.json) pins both
compiler-host identities, the prototype adapter hash, sealed input snapshot,
commands, loads, debugger entry/final states, CPU bounds and compressed logs.
Both native compiler executables contain the same candidate source implementation;
their generated representations differ. The unchanged production Node host then
emits the same candidate image **byte for byte**, without any loader adapter.
Its three implementation files match the sealed candidate exactly. Current
workspace source adds only a contract-comment clarification to those files.

The workspace gate passes **4,579/4,579** tests, typecheck, dependency boundaries
and formatting. The [semantic fixture](native-codegen-dense-inline-elements-v1.json)
passes a Node reference and eight fresh LLDB-contained native processes across
holes, stored undefined/false, mixed values, aliasing and moving GC. No resource
cap, timeout, source goal, harness or journal schema changes are part of this slice.

These results measure the execution of Tint-generated compiler code. Current
Test262 batch compilation still runs in Node, and managed Test262 images retain
their existing private-array boundary. No Test262 execution-time improvement or
whole-suite hours reduction is inferred from this compiler workload. The separate
canonical A1 run remains queued; its earlier configuration mismatch and pre-entry
failure remain preserved separately.
