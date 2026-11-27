# Live native backend actor handoff on Linux

November 22, 2026. This experiment used the merged Worker runtime
from PR #11 at `3d10cb5c0577477384bf2ecee8a368af781ceff7`. The
frozen compiler input contains 821 source files. The phase consumed
the same 7,111-function input and the same 35 cost-ranked ranges as the
[bounded replay](parallel-bounded-compile-packed-frame-sharing-v1.md).

A generational compiler coordinator and a native companion process
both stopped at entry under LLDB. The companion launched two Workers
with 704 MiB heap ceilings during compiler startup. A host driver
sent the readiness signals. The Workers waited for their first range
before opening the immutable input mappings.

The coordinator prepared the module, packed its bodies and facts,
dropped the decoded bodies, and forced collection. It published two
files and signaled the companion. Workers mapped both files read-only,
decoded bodies as needed, and published typed fragment packets and
range-specific branch forms. The coordinator placed the resulting
packets in canonical function order. The debugger saw exit 42 for
the companion and exit 0 for the compiler.

The complete 49,771,592-byte ELF matched the frozen serial reference
with SHA-256
`30c2dcb3323529be64ba35c4ca114b112936bc6b2caccf34a2479e3903dcb440`.
The sampled peak RSS of the two inferior processes was
2,159,444 KiB under a 2,227,064 KiB experimental guard. At the
handoff the compiler used 634,636 KiB and the waiting companion used
18,620 KiB. An earlier observation saw three companion threads and
zero accumulated CPU time during the wait at displayed precision.

| Milestone | Elapsed since launch |
| --- | ---: |
| Worker pool ready | 9.09 s |
| Compiler collection completed | 305.95 s |
| Input files published | 306.55 s |
| Last fragment published | 465.07 s |
| Coordinator finished reading packets | 467.39 s |
| Debugger confirmed compiler exit | 479.25 s |

The input publication took 0.61 s. Worker computation and packet
publication took 158.52 s. Reading the packets took 2.32 s and final
placement plus publication took 11.86 s. The largest time share after
handoff is inside the worker stage. This functional run shared the
host with other work. It provides frozen-image and aggregate-RSS
evidence, with no rotated timing comparison. The worker-enabled fixed
point and 1, 2 and N worker whole-image matrix remain pending.

A separate native compiler built at the same main revision compiled
the frozen inputs serially. It reproduced the same ELF in 399.42 s
from debugger entry. Its peak was 2,190,696 KiB and it sampled 31,603
total CPU ticks. The shared-host cells overlap for part of their
execution and use different start markers. They establish image
identity and resident footprints. They do not qualify as a timing pair.

Two subsequent functional probes isolated the slot-sharing case at
function 5,648. Both used one Worker with a 704 MiB heap ceiling.
Scanning only occupied words completed in 55.87 s at 750,500 KiB
peak RSS and 3,962 CPU ticks. Keeping the sparse coloring and deferring
its owner index completed in 51.09 s at 750,396 KiB and 3,741 CPU ticks.
Both produced the same packet as the earlier 1,280 MiB cell.

Both alternatives also finished all 35 ranges with two Workers at
704 MiB each. Every packet matched the full-word run by `cmp`.
The standalone worker process includes preparation reopen and packet
publication. These three functional cells shared the host.

| Slot sharing | Actor elapsed | CPU ticks | Peak RSS |
| --- | ---: | ---: | ---: |
| All words | 205.73 s | 33,501 | 1,524,692 KiB |
| Deferred sparse owner index | 143.14 s | 19,426 | 1,524,820 KiB |
| Occupied words only | 123.66 s | 18,435 | 1,525,060 KiB |

An alternate worker used the nonmoving region runtime with the same
requested 704 MiB heap ceiling. The isolated job reached 1,575,376 KiB
resident before it published a packet. The 1,550,000 KiB sampled guard
terminated that cell. Reducing the allocator's control capacity from
33,554,432 to 8,388,608 entries let the job finish in 41.73 s at
1,086,464 KiB with 4,128 CPU ticks. It still used about 328 MiB more
resident storage than the copying worker on the same job. The worker
budget must include the allocator's control storage and its heap
mappings.

The earlier locked serial profiles assigned 49.21 s on macOS and
53.59 s on Linux to frame planning and function emission. A 15% full
build improvement from that stage alone would give the replacement
stage at most 27.87 s on macOS and 33.53 s on Linux, before any extra
coordinator work. This budget uses the
[serial critical path](parallel-bounded-compile-actor-timeline-v1.md).
The 0.61 s measured input handoff is small compared with the worker time.
Further tests need to reduce actor compute and allocator work.

Raw evidence is under `.tint-bootstrap/worker-overhead.BMVafJRT`
in `post-pr11-baseline-functional-linux.log`,
`post-pr11-full-live-linux-functional.log`,
`post-pr11-sharing-isolated-linux.log`,
`post-pr11-lazy-sharing-full-linux-functional.log`,
`post-pr11-active-sharing-full-linux-functional.log`,
`post-pr11-region-job-linux-functional.log`,
`post-pr11-region-compact-job-linux-functional.log`, and the
`post-pr11-live-linux-aarch64-1795319036.workers/` directory.
