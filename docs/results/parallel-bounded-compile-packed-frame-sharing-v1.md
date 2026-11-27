# Packed frame-slot sharing in native backend actors

November 22, 2026. The frozen backend capture contains 7,111
functions. These experiments use the packed preparation and typed
fragment protocol from the
[handoff report](parallel-bounded-compile-native-fragment-scratch-v1.md).
The full-pool build includes base
`3d10cb5c0577477384bf2ecee8a368af781ceff7`, the merge of PR #11.

## Representation

The sparse frame sharing solver stores live-in rows twice while
coloring slots, then builds a global owner hash table. Function 5,648
has 13,645 slots and 21,235 blocks, with 6,002,721 live-in entries.
The owner table uses 192 MiB. A 704 MiB native worker heap could
reach frame sharing and then fail.

The packed experiment preserves predecessor traversal, slot order
and the first compatible group among the original candidates. Each
slot has two bit rows for live-in and occupancy. Each group has
the union of its members' rows. The owner predicate asks whether
the group is live into a block while the current slot is absent
from its own live-in row. Members of a group have disjoint
occupancy. The arrays have a size limit per representation and the
AOT work allowance stays unbounded.

The isolated Linux native job returned 42 under LLDB with a 704 MiB
worker heap and published the same 5,410,301-byte packet as the
1,280 MiB dense register-home control. It peaked at 750,532 KiB,
compared with 1,344,848 KiB in the earlier successful native cell.
The two cells ran under different host load and serve as functional
scratch probes. Both packets match the Node reference, SHA-256
`efc0a0496273eef40483ebf9b16546cac3979bb3932185434e25dbcb5307fbe4`.
The Node comparison reproduced all 3,430 colors and 2,044,756
owner queries for the frozen function.

## Complete native actor replay with PR #11

Two persistent Workers each used a 704 MiB heap ceiling. The
coordinator of the replay sent cost-ranked IDs and the Workers
shared read-only mappings for packed input. Linux arm64 completed
35 of 35 jobs at 1,524,692 KiB sampled peak RSS, below the
1,550,000 KiB stage guard. The debugger recorded exit 42.
Each packet matched the Node reference by byte comparison.
This functional run took 205.73 s and sampled 33,501 CPU ticks.
The observed time includes allocation and collection inside the
small worker heaps. Scope is the backend actor process. Full
compiler intake, optimization, and final placement were outside
the replay.

The full-word scan variant is too slow for acceptance. Two
alternatives reduce the extra work. Active-word scans visit the
occupied words of one slot during coloring. Deferred owners keep
the original sparse coloring and build the original owner index
on the first query. Both preserve the same coloring in the
three-function Node screen.

| Function | Sparse CPU | Full word scan CPU | Active words CPU | Deferred owners CPU |
| ---: | ---: | ---: | ---: | ---: |
| 6,002 | 153 ms | 258 ms | 205 ms | 212 ms |
| 5,648 | 940 ms | 517 ms | 321 ms | 497 ms |
| 1,928 | 159 ms | 261 ms | 205 ms | 126 ms |

The Node screen isolates slot sharing from packed decoding and
emission. It confirms colors and locates work. It provides no
native whole-build timing comparison.

Raw evidence is under `.tint-bootstrap/worker-overhead.BMVafJRT`
in `native-fragment-actor-packed-sharing-job-functional.log`,
`post-pr11-packed-sharing-equivalence.log`,
`native-fragment-actor-post-pr11-linux-two-functional.log`,
`post-pr11-all-fragment-identity.log`,
`post-pr11-slot-sharing-node-ranking.log` and the corresponding
`actor-*/fixture.log` traces.
