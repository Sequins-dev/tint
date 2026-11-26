# Native actor compute and scheduling limits

November 22, 2026. This analysis uses the occupied-word slot-sharing
replay and the native Linux arm64 serial function profile of the same
7,111 frozen bodies. The replay includes two native Workers at 704 MiB
each and reproduces every reference packet. The serial profile predates
the Worker merge. The two runs had different co-load and do not form a
performance pair.
[Replay and image evidence](parallel-bounded-compile-live-native-actors-v1.md)
[Serial function profile](parallel-bounded-compile-actor-timeline-v1.md)

The two replay lanes completed 16 and 19 ranges in 123.087 s and
122.892 s from their first job starts. Packet publication took a total
of 0.864 s across both lanes. The traced function 5,648 spent 39.32 s
in its actor call. Its markers bracket 1.19 s in slot sharing and
12.20 s between slot sharing and completed register-home planning.
The other lane continued processing ranges during that interval.

| Frozen function ID | Serial profiler visit | Worker actor call | Cost rank |
| --- | ---: | ---: | ---: |
| 6,002 | 2.78 s | 22.56 s | 1 |
| 1,928 | 3.60 s | 24.46 s | 2 |
| 5,648 | 14.09 s | 39.32 s | 4 |
| 1,524 | 15.68 s | 34.56 s | 5 |

The work estimator promoted the first two functions by its operation
and scratch estimates. Their measured runtime ordering differs. Changing
that ordering can improve the start of a memory admission wave. Both
lanes already finished within 0.20 s of one another in this replay.

One alternative keeps the coordinator's faster local emitter active and
hands some ranges to a single Worker. An optimistic schedule treats the
ranges as divisible, sorts by local time saved per second of actor work,
and stops assigning once the two lanes finish together. The calculation
uses each range's serial profiler sum and its actual replay duration
including packet publication. At those costs it reduces 70.43 s of
serial function visits to 48.16 s, a 31.62% stage reduction before
packing or placement. Applying that stage reduction to the earlier
critical-path shares would save 10.94% of the macOS build and 12.67% of
the Linux build. A separate full inline-actor run also reached 2,112,236
KiB coordinator RSS by the end of packet emission. The 2,227,064 KiB
experimental guard leaves only 114,828 KiB at that high-water mark.
A hybrid would need a faster Worker and lower live coordinator scratch
to qualify. This is a schedule calculation with measured inputs.

## CPU samples within one native Worker

A symbolized Linux arm64 build of the occupied-word variant repeated
range 3 in one 704 MiB Worker. The debugger confirmed a stopped launch
and inferior exit 42. The packet matched the full replay by `cmp`.
Linux `perf` collected 2,658 user-space CPU-clock samples at 99 Hz
with zero lost samples. The guest did not expose hardware cycle
counters. The sampling wrapper reported an assertion on the sampler's
SIGINT exit after it wrote the profile. The packet, capture count, and
inferior exit were verified separately.

| Function | Inclusive samples | Self samples |
| --- | ---: | ---: |
| Slot-home analysis | 36.46% | 0.11% |
| Slot-liveness solver | 29.57% | 16.82% |
| Dominant sparse-list read specialization | 22.99% | 1.35% |
| Packed live-slot iteration | 15.91% | 8.20% |
| Record guard dataflow | 15.88% | 0.04% |
| Copying collection | 5.34% | 0.19% |

The inclusive rows overlap. Register homes and the stack-map analyses
revisit slot liveness. Sparse-list traversal also serves other analyses
in the range. An allocator change can affect this job's capacity, but
collection represents 5.34% of its sampled CPU time. Measurements of
this range point to compact, reusable liveness data and faster fact
lookups as the next opportunities.

An earlier locked Linux pair completed the decoded full build in
92.79 s, including 34.05 s in the function loop. At that observed
baseline the whole 15% saving would leave just 20.13 s in the
replacement loop, before any additional coordinator cost.
[Late packing rotation](parallel-bounded-compile-actor-lifetimes-v1.md)

## Dedicated generational actor processes

The arm64 Worker fixture uses a copying collector. A separate fixture
executes the same prepared ranges as ordinary native processes, with
the compiler's generational runtime. Each process reads the frozen
inputs into managed typed arrays once. This transport adds one input
copy per process and avoids raw-memory capabilities in a generational
mutator.

The first fixture lacked the clock binding and exited 70. Adding the
binding without its runtime module failed the hosted build. With both
declared, the 704 MiB mapping completed range 13 and matched its
packet. For range 3 it opened the preparation and exited 70 before
emission. The Linux RSS high-water mark was 390,020 KiB. The runtime
uses half of the specified extent as managed capacity.

Increasing the extent to 1,152 MiB completed range 3 at 519,828 KiB
peak RSS in 16.54 s and range 0 at 502,920 KiB in 6.89 s. Both packets
matched the reference. The wider fixture includes stack traces.

The same standalone fixture with a copying collector and a 1,152 MiB
extent crossed its 980,000 KiB RSS guard in range 3. Its last sampled
high-water mark was 1,025,828 KiB. The guard terminated the inferior
before it published a packet. A larger copying heap increases the
two-lane scratch requirement.

Two persistent instances then ran the whole capture concurrently.
One handled ranges 0–3 and the other handled 4–34. Both verified exits
and all 35 packet comparisons passed. The replay took 105.97 s
including debugger launches, with 8,508 total CPU ticks. The sum of
the two resident high-water marks was 1,095,976 KiB. This sum bounds
the actor processes during this run. The compiler coordinator is
outside that measurement. The static split finished in 67.41 s and
102.97 s from the respective debugger entries. Scheduling the observed
job durations largest first on two lanes gives an estimated 85.02 s
before launch and placement. The estimate holds the observed per-job
costs fixed. These unpaired shared-host cells show reduced actor CPU
and RSS. They provide no whole-compiler speedup result.

The raw replay is in
`actor-active-sharing-linux-aarch64-2-704-1795320152/fixture.log` and
the serial range inputs are in `native-groups-profile.log`. The CPU
profile and LLDB transcript are in
`actor-profile-job3-linux-1795320956/`. The alternate-runtime screens
are in `post-pr11-generational-*-linux-functional.log`,
`post-pr11-copying-expanded-jobs-linux-functional.log`, and the
corresponding `actor-generational-*` and `actor-copying-expanded-*`
directories. All are under
`.tint-bootstrap/worker-overhead.BMVafJRT`.
