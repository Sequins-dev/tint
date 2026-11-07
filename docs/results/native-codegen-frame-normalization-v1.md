# Used-local native frame planning

Native frame planning now applies the existing bounded slot compactor after
original IR verification and before slot-indexed codegen analyses. The optional
scalar optimizer can exhaust its module budget before its final cleanup; those
unused declarations no longer reserve native storage or GC root locations.
ABI arguments, receiver storage, exception and guarded-transfer destinations,
and every explicit slot use remain intact. A bounded failure retains the input.

The [matched native compiler run](native-codegen-frame-normalization-v1.json)
uses the same sealed compiler implementation and input sources for both generated
representations:

| Measurement                | Original frames | Compacted frames |
| -------------------------- | --------------: | ---------------: |
| Inferior user + system CPU |       487.451 s |        399.786 s |
| Maximum missing CPU bound  |         0.110 s |          0.112 s |
| Inferior wall time         |       688.156 s |        570.659 s |
| Native exit                |               0 |                0 |
| Emitted compiler bytes     |      60,079,074 |       60,079,074 |

This is **1.22× lower CPU in one full-workload pair**. Both outputs and the
after compiler's stage-1 image have SHA-256
`81c8bc9c9ab986f41f955920761e22a5f0e3cd3671d0084de7222a0efdf26764`.
Signature and DWARF checks pass with nonempty debug sections. Frozen host files
were rehashed against both manifests. Earlier dense-array timings use different
compiler implementation sources; these speedups are not a matched combined gain.

All **165 codegen tests** pass, including four new cases for unused roots,
noncontiguous ABI arguments, exception/guarded storage and original invalid-IR
diagnostics. Two wide-frame fixtures now explicitly use their local storage,
preserving the addressing cases after unused declarations are removed. The full
workspace gate passes **4,583/4,583**, typecheck, boundaries and formatting.

Eight fresh LLDB-contained executions of the same managed-invocation fixture
exit 42 across both hosts. They exercise AOT/generated/AOT callbacks, canonical
record identity, allocating and throwing callbacks, nested calls, fresh returns,
copying GC and root-chain restoration. Their timings are verification context.

The [static frame attribution](native-codegen-unused-frame-slots-v1.json) explains
the mechanism on a separately captured compiler graph: reference-root locations
fall from 200,302 to 117,182 and tagged-general locations from 5,187 to 2,931.
Those static totals are not current-run live-object counts.

The earlier AOT-only A1 prototype retains two separate 300-second timeouts. Both
images embed the unchanged v9 compiler source, so that diagnostic does not test
the production v10 compiler implementation or establish an A1 speedup. The
canonical A1 runner remains queued. No whole-suite hours gain is extrapolated
from this compiler workload.
