# Native packed emission lifetimes and actor replays

November 22, 2026. These are screens on the frozen 821-source self-compile
and on its captured AArch64 backend input. Test invocations used
`tools/gate/with-lock.sh both` and `TZ=UTC`. Native runs used LLDB
stopped at entry and checked exit status 0. Node screens used v24.12.0.
The stage and image results are reported separately.

## Packing before backend preparation

Two Linux arm64 builds ran consecutively. The first used decoded bodies.
The second packed all bodies at the normal storage seam with a 32 MiB
budget, before verification, slot compaction and effect preparation.
Both enabled pass statistics, which retains a reference to the
observed optimized module. At each marker, the monitor sampled current
RSS and the kernel's high-water RSS from the inferior only.

| Variant                   | Whole build wall | Backend wall |      Peak RSS | RSS entering function loop |
| ------------------------- | ---------------: | -----------: | ------------: | -------------------------: |
| Decoded control           |        137.380 s |     54.471 s | 2,149,896 KiB |              1,437,556 KiB |
| Packed before preparation |        182.553 s |    112.887 s | 2,061,692 KiB |              1,170,716 KiB |

The pack itself took 0.390 s. The interval from verification to the
function loop rose from 8.25 to 48.49 s. Several whole-program fact
sweeps decode the same packed bodies, including record-flow analysis.
The packed path lowered peak RSS by 86 MiB and current RSS entering
the function loop by 261 MiB. Its backend took 58.4 s longer.
Both 49,771,592-byte ELF images matched the frozen serial image
by `cmp`, SHA-256
`30c2dcb3323529be64ba35c4ca114b112936bc6b2caccf34a2479e3903dcb440`.
These are single screen cells. The probe recorded wall time and RSS. Hardware cycle
counters are unavailable in the Linux VM.

## Source actor stage

The Node prototype opened workers before intake, assigned source IDs
and shared UTF-8 byte ranges, and returned compact import and export
records or diagnostics in canonical source order. All four runs
agreed across all 821 files. They read 22,060,358 source bytes and
returned 1,983,990 JSON bytes, SHA-256
`a32879da5ae1f9b5a354581f22e763204dfde1feb0b08672ab60ae3f4143efea`.
Each lane owns its parser state and drops each tree after extracting records.
The frozen module resolver was outside this stage replay.

| Order | Workers | Stage wall | Wall including intake |   Job CPU |    Peak RSS | Process cycles |
| ----: | ------: | ---------: | --------------------: | --------: | ----------: | -------------: |
|     1 |       0 |   660.1 ms |              703.5 ms | 1336.1 ms | 262,656 KiB |  5.818 billion |
|     2 |       2 |   416.6 ms |              450.5 ms | 1867.8 ms | 394,112 KiB |  7.610 billion |
|     3 |       2 |   423.0 ms |              460.4 ms | 1867.3 ms | 394,848 KiB |  7.552 billion |
|     4 |       0 |   686.2 ms |              721.7 ms | 1377.4 ms | 316,496 KiB |  5.792 billion |

At two workers the parse-and-summary replay saved 244 and 263 ms.
It used 36–40% more job CPU and 76–128 MiB more RSS. The native
stage census put graph and timed source loads together below two
percent of overall wall time. This prototype stays out of the compiler.

## Bounded fragment replay

The backend capture contains 7,111 bodies, SHA-256
`5115e42db0c942900e33cac5d03c82939fa2c7b03d68719445bfb260d7b5fce4`.
The replay uses the existing compact liveness and ordered fragment
placement prototype. Workers reuse the same pool, borrow immutable
packed body bytes and decode per-function record facts lazily from a
second shared arena. Each worker fuses frame planning and instruction
emission for a cost-ranked function range. Relocatable fragments are
sealed to temporary files. Placement rereads one fragment at a time
in canonical order using function headers and fixups.

The first harness invocation mistakenly compared the seven-function
fixture against the full 7,111-body golden. The deep assertion tried to
render the large mismatch. We stopped it at 202 s wall time after its
resident peak reached 26.65 GiB. The run is excluded from timing comparisons.
The corrected harness checks both body count and the code digest
before comparing the remaining metadata. The seven-function smoke
fixture then matched all emitted bytes and metadata.

The next screens guarded the Node-stage serial peak of 2,411,792 KiB
plus a 128 MiB margin. A 100 ms sampler stops the run on a breach.
This is a diagnostic stop with sampling overshoot. Native production
admission still needs an upper bound for coordinator and worker
scratch, including external arrays as well as managed heaps.

| Variant                                     | Coordinator RSS at worker admission | Outcome                                |
| ------------------------------------------- | ----------------------------------: | -------------------------------------- |
| Same-process preparation, two worker lanes  |                       1,460,768 KiB | Stopped at 2,546,112 KiB after 20.79 s |
| Preparation process exits, two worker lanes |                         250,352 KiB | Stopped at 2,570,992 KiB after 23.82 s |

The first worker phase began with 44.5 MiB of live coordinator JS heap,
yet the process still retained roughly 1.43 GiB RSS. Exiting the prep
process reduces admission RSS by 1.15 GiB and removes the coordinator's
decoded IR before worker computation. Two heavy jobs still crossed the
cap. The 384 MiB old-generation limit on each worker leaves native
backing allocations outside the limit.

The next version isolates high-cost functions as individual jobs.
The scheduling rule considers a function large when its slot count
times block count reaches six million, a scale observed in the native
frame profile. At most one of these jobs runs at a time. Other jobs
use cost-weighted ranges. Both one and two workers completed the
whole replay with 35 fragments, including 17 large functions. The
full emission payload matched the golden at both widths. The one-lane
screen took 48.47 s with a sampled aggregate peak of 1,506,160 KiB.
The two-lane screen took 38.38 s and peaked at 1,818,880 KiB.
Each run sealed 162,191,109 bytes of code pages and relocation metadata.
The summed publication time was 0.50–0.62 s.

A subsequent rotated macOS stage screen compared against direct
serial emission using the same compact liveness. Stage times include
intake, preparation, worker execution and canonical placement.
Process CPU includes the preparation child and stage monitor. The
instrumented wrapper's cycle counter only measured the wrapper, so
paired cycles are omitted.

| Order | Variant     | Whole wall | Stage wall | Whole CPU |              Peak RSS | Output            |
| ----: | ----------- | ---------: | ---------: | --------: | --------------------: | ----------------- |
|     1 | Serial      |    71.18 s |    71.04 s |   74.68 s |         2,718,384 KiB | Full golden match |
|     2 | Two workers |    39.13 s |    38.92 s |   82.92 s |         1,810,736 KiB | Full golden match |
|     3 | Six workers |    11.47 s |          — |   23.76 s | 2,573,952 KiB sampled | RSS stop          |
|     4 | Two workers |    37.49 s |    37.30 s |   80.47 s |         1,816,784 KiB | Full golden match |
|     5 | Serial      |    65.71 s |    65.57 s |   71.26 s |         2,739,152 KiB | Full golden match |

Two workers saved 45.0% and 42.9% whole replay wall time and used
11.0–12.9% more CPU. The peak fell by about one third. Six workers
started one large job and five smaller jobs, then tripped the cap
less than one second after dispatch began. The per-job size heuristic
on its own cannot bound the sum of concurrent external allocations.
Each successful stage run matched every emission field and
48,799,664 code bytes, SHA-256
`ed326c4353628ea079f6e765cbcd2bfb2a89d2b37eb2077d88103c39aab36c75`.

Six persistent workers with only two concurrent jobs also exceeded
the limit. Rotating work onto previously unused isolates left the
earlier lanes' memory resident. This variant stopped after 15.46 s
at 2,558,976 KiB sampled RSS. Both six-worker attempts retained the
one-large-job rule. The two-lane variant is the one that completed
inside the screen's envelope.

In the first successful rotated two-worker cell, the preparation
process exited at 13.23 s. Loading the sealed inputs took another
0.06 s. The two lanes ran 14 and 21 jobs. Their summed kernel
times were 22.26 and 21.76 s. Publishing fragments took 0.14 and
0.34 s. The last result arrived at 36.53 s. Worker termination
and ordered placement took 2.39 s.

The native loader counter in the [actor timeline](parallel-bounded-compile-actor-timeline-v1.md)
sums 372 returned module entries across its calls. The source-stage
time was measured around those calls and is unchanged.

## Packing after native preparation

The next Linux arm64 compiler can keep decoded access through the
shared fact sweeps and pack the compacted bodies at the start of the
function loop. It then drops the decoded body array. The two cells
use the same compiler binary and a stage-only observer so pass
statistics do not keep the optimized IR alive.

| Variant                  | Whole wall | Function loop |      Peak RSS | RSS entering function loop |
| ------------------------ | ---------: | ------------: | ------------: | -------------------------: |
| Decoded control          |   92.788 s |      34.047 s | 2,148,572 KiB |              1,437,964 KiB |
| Packed after preparation |   92.115 s |      33.714 s | 2,073,168 KiB |              1,520,152 KiB |

Both emitted the frozen reference ELF. Packing took 0.320 s. Late
packing avoided the repeated decoding charge from the early-pack
experiment. Whole-build peak fell 73.6 MiB in this pair, while RSS
at the prospective worker handoff rose 80.3 MiB. Dropping the
decoded references does not immediately free resident pages.
This pair measures the cost and lifetime of the packing seam.

The first three versions of the diagnostic compiler failed native
type checking. The failures were at the extra body-source method,
the conditional request storage shape, and the inline stage
observer. The successful version used the existing stage hook plus
explicitly typed storage and observer records. Its compiler image
hash was
`2b2199b7433caccf0645b4a45514c30d29ef5aadfe8a90a838937e239954e608`.

A second same-compiler Linux pair forced one full collection just after
packing. The compiler used the existing trusted allocator collection
intrinsic. The first bootstrap refused the binding until the
intrinsic's runtime module was declared explicitly.

| Variant                               | Whole wall |      Peak RSS | RSS entering function loop |
| ------------------------------------- | ---------: | ------------: | -------------------------: |
| Late pack, ordinary collection        |  103.231 s | 2,073,060 KiB |              1,519,840 KiB |
| Late pack, full collection at handoff |   99.131 s | 2,118,128 KiB |                539,024 KiB |

The collection took 135 ms. Current RSS fell from 1,520,216 to
538,496 KiB during collection, a 959 MiB reduction. Whole-build
RSS peaked later, 44.0 MiB above the paired late-pack control.
The front half of the second build was faster before the collection
ran. This result measures available memory at handoff. Admission
must also cover worker allocations and final placement.

Both images matched the frozen ELF by `cmp`. The compiler SHA-256
was `05268d3b8a30cf21e21a9019c5b6be1dbc31f029413d7e2fd5c2bd697d3b2e18`.

## Native cost of the large-job scheduling rule

The 17 functions that the replay admits one at a time match the
native profiles by function ID and operation count. All 7,111
function IDs and operation counts agree on both hosts. Timing
excludes writing the per-function sample records.

| Native profile | Total function loop | 17 large functions |  Share | Maximum overlap with other jobs at the measured costs |
| -------------- | ------------------: | -----------------: | -----: | ----------------------------------------------------: |
| macOS arm64    |            54.808 s |           33.391 s | 60.92% |                                              21.417 s |
| Linux arm64    |            70.430 s |           44.947 s | 63.82% |                                              25.482 s |

The stopped-at-entry macOS profile took 141.36 s wall, including its
debugger wrapper. Fifteen percent of that time is 21.20 s. Holding
the measured native function costs fixed, the one-large-job rule
leaves only about 0.21 s for all added work in that profile.
Packing, dispatch and fragment placement spend part of that
margin. This is a scheduling bound based on the observed kernel
costs. Changing scratch representation or splitting the largest jobs
could change the bound.

The same Mac profile spent 54.258 of 54.808 s in the largest closed
direct-call component. The signed Mac image and the Linux image
matched their serial controls. The profiling compiler on macOS had
SHA-256
`7e12936a4f1e117cc49350a367531253866bac219a59b773381077812bfb5e6f`.

The native experiments establish a cheap packing seam after shared
preparation and a way to return decoded-body pages before worker
dispatch. The exact two-worker fragment replay remains Node-hosted.
Its V8 metadata and fragment packets need native-subset encodings
and a trusted immutable arena that works with the generational
coordinator. A native pool must budget resident scratch of every
warmed worker, including external arrays and the placement peak.
Achieving the wall-time target with the observed skew also needs
cheaper large-function scratch or enough headroom to overlap more
of the large jobs. All experiments kept full AOT optimization
budgets. There is no native worker candidate for the six-pair or
fixed-point gates in this report.

Raw evidence is in the worker-overhead experiment directory:
`native-actors-linux-{decoded,packed}-screen.{log,rss.jsonl}`,
`native-late-{decoded,packed}-screen.{log,rss.jsonl}`,
`native-late-gc-{packed,gc}-screen.{log,rss.jsonl}`,
`native-groups-macos-{build,profile,controller}.log`,
`source-actor-screen.log`, `actor-codegen-stage-r*.log`,
`actor-admission-rotation-*.log`, and
`actor-codegen-width-six-bounded.log`.
