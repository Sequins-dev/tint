# Native frames retain unused managed locals after optimization exhausts

The real frozen compiler IR retains **278,818 unused local slots**, including
111,643 managed/general slots. Its optional scalar optimizer exhausts the shared
20-million-work budget during post-inlining cleanup, before slot compaction.
The emitter then reserves storage and root locations for unused declarations.
This is generated-code overhead: the compiler's source operations do not need
those locals at execution time.

Reusing the existing slot compactor before emission of the **same verified IR**
changes these static totals:

| Emitted property              |     Before |  Compacted |
| ----------------------------- | ---------: | ---------: |
| Reference-root locations      |    200,302 |    117,182 |
| Tagged-general root locations |      5,187 |      2,931 |
| Root frames                   |      3,954 |      3,954 |
| Code bytes                    | 47,056,408 | 45,619,224 |

The roots are static descriptor locations summed across functions, not peak live
objects or dynamic collection counts. Retaining the same number of root frames
does not make the removed locations useful: function entry initializes roots,
and collection scans them. Large frames also require more address-generation
instructions when operands exceed direct load/store displacement ranges.

| Source function        | Frame bytes before / after | Root locations before / after | Code bytes before / after |
| ---------------------- | -------------------------: | ----------------------------: | ------------------------: |
| `isa.word`             |                  160 / 144 |                         2 / 1 |                 564 / 560 |
| `isa.encode`           |             16,848 / 5,216 |                     598 / 132 |           91,636 / 89,768 |
| `closure.lowerEntries` |            56,400 / 22,992 |                 2,820 / 1,450 |         908,288 / 607,204 |

Instruction encoding and tree lowering are expected compiler work. Initializing
and scanning unused stack locations is extra per-operation cost. This finding
does not depend on changing those source algorithms. The proposed codegen change
normalizes frames with the existing compactor, using a per-function bounded
attempt and retaining original frames on exhaustion. It preserves ABI arguments,
receiver storage, exception and guarded-transfer destinations, and every explicit
slot use. Normalization must precede slot-indexed codegen analyses, and original
IR verification must precede normalization.

The [data and compressed function tables](native-codegen-unused-frame-slots-v1.json)
pin the input IR and exact emitted counts. This captured source graph predates C2;
these static results do not establish current-main native CPU improvement. The
emitter also independently proves 15,479 record guards in this graph, so zero
`record-read` operations in optimizer output does not mean all emitted accesses
retain their guards. Four prototype tests cover unused roots, ABI arguments,
exception storage and original verification errors. Matched symbolized addition
A1 images are being built for native CPU and sample comparisons. This report is
an investigation checkpoint, not a merge-ready codegen slice.
