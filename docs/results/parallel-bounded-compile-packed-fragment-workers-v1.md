# Shared packed codegen with cost-weighted ranges

This stage replay used Node 24.12.0 on macOS arm64 on November 22,
2026. The input was the full 7,111-body AArch64 capture from the
frozen self-compile. Its SHA-256 was
`5115e42db0c942900e33cac5d03c82939fa2c7b03d68719445bfb260d7b5fce4`.
The prior ordered merger assigns canonical dispatch IDs and final
offsets from symbolic worker fragments. This replay changed data
ownership and scheduling.

Each invocation starts fresh under both gate locks. Workers are
created before the driver loads the captured IR. The coordinator
computes module-wide facts once and packs the prepared function
bodies in byte order. The workers receive read-only shared buffers
for the packed bodies and their offsets. The coordinator gives up
its decoded bodies after packing. Each worker loads the 11.9 MB
prepared metadata once, then decodes function bodies as needed for
its assigned ranges. The packed bodies occupy 43.6 MB. Range
weights estimate frame cost from operation and slot counts. Persistent
workers consume higher estimated costs first and return code pages
through transferable buffers. The merger consumes results by
function range and needs no decoded function bodies.

The stage clock includes loading the capture, shared preparation,
packing, one explicit coordinator GC before dispatch, worker
computation and result placement. The whole-process timing counters
also include start, verification and exit. Golden comparisons
covered emitted code, functions, relocations, descriptors, imports,
stack maps and the rest of the emission payload. Native worker and
whole-compile measurements remain separate.

| Liveness and workers           | Stage wall (s) | Stage CPU (s) | Peak RSS (KiB) | Process cycles (billions) |
| ------------------------------ | -------------: | ------------: | -------------: | ------------------------: |
| Sparse, serial                 |        106.057 |        116.74 |      3,819,280 |                   333.482 |
| Sparse, two workers            |         63.195 |        126.63 |      5,273,440 |                   344.331 |
| Sparse, six workers            |         45.111 |        158.37 |      8,810,032 |                   421.575 |
| Compact, two workers           |         62.667 |        117.76 |      3,457,376 |                   324.492 |
| Compact, serial                |        100.095 |        115.99 |      2,411,792 |                   329.539 |
| Compact, two workers, 384 MiB old generation each | 65.809 | 134.33 | 3,376,416 | 360.884 |

The order in the table is the invocation order. These are stage
screens from separate lock acquisitions. The compact representation
uses the earlier bitset liveness kernel for large functions.
It lowered two-worker peak RSS by 1.73 GiB and lowered the matching
serial peak by 1.34 GiB. The compact two-worker stage took 37.4% less
wall time than compact serial and raised peak RSS by 43.4%.
A 384 MiB old-generation setting for each worker cut another 79 MiB,
leaving peak RSS 40.0% above compact serial. The bounded variant
ran the same optimization work and produced the same output. Its CPU
and cycles increased. A startup probe showed that a Node CLI old-space
override would mask the isolate limit. That queued invocation was
replaced before running the bounded replay.

At two workers, four ranges spent 39.28 and 36.87 seconds in the
two compact worker lanes. The sparse six-worker ranges finished
21.51 s after coordinator GC and took another 3.15 s in final placement.
The compact two-worker run spent 14.17 s preparing the module,
0.91 s packing it, 40.56 s dispatching and producing fragments
after GC, and 3.32 s in termination and placement. The worker lanes
overlap. The stage timings include coordination and transfer.

The serial golden results for compact and sparse liveness matched
by `cmp`. Each worker run matched the complete golden result by
deep comparison. All runs emitted 48,799,664 code bytes, SHA-256
`ed326c4353628ea079f6e765cbcd2b37eb2077d88103c39aab36c75`.

Packed input and once-prepared facts helped stage throughput and
reduced two-worker RSS compared with the previous copied-body replay.
The comparable serial controls show that the worker RSS regression
persists. Replaying only the emitter bypasses the native worker
hosting and the lifetime of IR created by the full compiler.
A native candidate needs the packed representation to replace the
decoded coordinator state and needs function-local scratch bounded
over concurrent jobs. The native throughput gate remains untested
for this fragment design.

Raw logs are `replay-packed-codegen-{serial,2,6}.log`,
`replay-compact-codegen-{serial,2}.log`,
and `replay-compact-codegen-bounded-384-r1.log`.
