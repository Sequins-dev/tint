# Native kernel parity and serial backend measurements

November 22, 2026. The fixture consumes the existing 7,111-body packed
capture and emits range 3, function 5,648. All completed cells compared
the typed output packet to the earlier frozen replay by `cmp`. Each
inferior stopped at entry under LLDB and exited with status 42. The
Linux cells below shared the host.
[Capture and packet evidence](parallel-bounded-compile-live-native-actors-v1.md)

## Main thread and Worker at the same heap size

One native executable contains both paths. The hosted bridge maps the
selected Worker peer to the same typed start function as the main
thread. Building the fixture sets `TINT_GENERAL_FALLBACK=0` and passes
`requireTyped` for application lowering. The Script host initializes
Node's Worker and event-loop APIs in both paths. The callback crosses
that bridge before entering the typed backend. The kernel call stacks
resolve to AOT symbols from the same image.

Each lane opens the preparation and packed mappings once, then reuses
the actor for all its ranges. The worker's execution context allocates
its own managed heap. Branch-form retries reuse per-function register
homes and guard dataflow. Body decoding and analysis scratch allocation
occur as functions are processed.

The first Linux comparison used the unmodified fixture's 1,536 MiB heap
extent on both threads. The main path took 51.99 s and 2,941 CPU ticks.
The Worker took 50.64 s and 2,619 CPU ticks. Another Worker cell used
704 MiB and took 45.71 s with 2,407 CPU ticks.

A second executable used equal 704 MiB copying heap extents. It
instrumented successful managed allocations on the inline and slow
copying paths in a per-context counter. The main and Worker processes
took 48.66 s and 51.23 s, with 2,415 and 2,557 CPU ticks respectively.
Peak RSS was 745,372 KiB on the main path and 750,516 KiB on the Worker
path. The first call to each kernel was measured separately.

| Kernel | Main wall | Worker wall | Main allocation delta | Worker allocation delta |
| --- | ---: | ---: | ---: | ---: |
| Register homes | 16.893 s | 15.996 s | 827,708 | 827,713 |
| Precise slot liveness | 1.621 s | 2.241 s | 153,906 | 153,903 |
| Entry slot liveness | 1.434 s | 1.562 s | 28,219 | 28,239 |
| Record guard dataflow | 7.178 s | 8.958 s | 174,142 | 174,138 |

The allocation deltas include publishing the opening trace marker.
Back-to-back markers in this build account for about 3,847 allocations
per marker. The Linux arm64 guest reports retired instructions as
unsupported. The observed timings and allocation counts show similar
work in the main and Worker paths. The earlier comparison used the
copying-heap pool and the full generational compiler.

The release compiler uses the generational collector with an extent
just under 4 GiB. This AArch64 Worker fixture uses a copying collector
with a 704 MiB extent. Its active semispace is 352 MiB. The raw memory
capability used to adopt the packed byte mappings is rejected by the
AArch64 generational mutator's tracked-write check. The earlier
standalone generational cell removed that capability and copied inputs
into managed storage. Collector type, available heap, and the standalone
fixtures differ across those experiments.
[Allocator comparison](parallel-bounded-compile-actor-compute-v1.md)

## Serial analysis candidates

The baseline native compiler built the frozen ELF under LLDB while
`perf` captured 24,166 Linux user CPU-clock samples. The image matched
the frozen serial reference. Inclusive shares were 9.95% for register
homes, 9.03% for slot liveness and 2.42% for record guard dataflow.
These rows overlap. The shared-host profiling run took 441.22 s with
24,986 total CPU ticks and a 2,190,912 KiB resident high-water mark.

Register-home analysis used to build precise safepoint liveness for
every eligible reference. Stack maps consume only references that
receive a register. The AOT candidate assigns homes first, then
analyzes the selected reference slots. Register interference still
uses the original conservative liveness. Bounded callers keep their
ordering and accounting. The focused test observed five unnecessary
safepoint classification calls on main and zero with the candidate
when all references used stack storage.

Two rotated Node-hosted kernel comparisons processed 5,910 captured
functions. Every register assignment and stack-map root list produced
the same serialized digest
`6103ad10d789aef72c73627a73945ad9daefbdc19d5a3703e3af119b37a5ef59`.
The measured kernel was 16.975 → 13.016 s and 14.289 → 13.681 s.
Whole replay retired instructions, including intake, fell from
200.25 → 186.78 billion and 200.82 → 186.92 billion. These are
kernel replay observations from the shared host.

A further prototype delayed conservative liveness until after
interference-group ranking in functions without exception handlers.
It analyzed only slots in ranked groups that could share a register.
The capture has 5,695 such functions with 891,169 blocks, including the
two largest bodies by block count. Every home and stack map still
matched. Whole-replay instruction counts rose from 186.77 to 195.26
billion and from 186.75 to 196.20 billion in the two orders. The extra
variant stays out of the candidate.

A release compiler with the register-home change reproduced the full
frozen ELF by `cmp`. The shared-host cell took 386.91 s with 22,388
CPU ticks and a 2,177,980 KiB peak. A separate run of the release
control at the same main revision used 2,190,696 KiB. These runs
provide image and resident observations. Rotated native wall-time
comparisons are a separate gate.

The conservative record guard solver checks membership in each live-in
row when facts first reach a block. The frozen capture had 41,633,326
live row entries and 8,586,690 outgoing facts on those edges. Replacing
the growable fact pool with a 32-bit array preserved every proof and
increased Node replay wall time in both orders. Keeping the sparse
solver and storing its large live-in rows as packed membership instead
also preserved all proofs, with digest
`d1224c866fef0506634371fafa3956fd36f3050ca795cb1711480050251eff60`.
The two packed cells used 1,477,967,872 and 1,450,311,680 bytes peak
RSS, against 1,893,990,400 and 1,892,630,528 bytes in their controls.
The first packed wall comparison improved from 4.607 to 3.179 s.
The second regressed from 4.518 to 19.395 s on the shared host. This
screen establishes output and resident-footprint evidence.

The packed version initially failed native subset checking because the
checker lost a record narrowing across the inner loop. Reading its
optional backing and row stride into locals fixed the native build.
The corrected candidate passed 34 liveness and record proof tests plus
the complete native compiler subset check.

## Parallel replay with both changes

The packed actor replay carries both serial candidates, along with
the occupied-word slot-sharing variant. Two persistent native Workers
used 704 MiB copying heap extents. All 35 packets matched the existing
frozen output. The actor process peaked at 1,524,872 KiB and used
15,593 CPU ticks. The earlier occupied-word variant used 18,435 ticks
and peaked at 1,525,060 KiB. The corresponding wall observations were
166.52 s and 123.66 s under different co-load. Both are standalone
backend replays. The worker compute time remains above the earlier
33.53 s Linux replacement-stage budget for a 15% full-build win.

A single Worker using the same executable and heap also matched all
35 packets. It took 334.54 s, used 15,080 CPU ticks, and peaked at
794,540 KiB. This documents scaling for the replay under shared-host
conditions. The full compiler requires its own rotated comparisons,
whole-image identity across widths, and a worker-enabled fixed point.
[Earlier CPU and stage boundaries](parallel-bounded-compile-actor-compute-v1.md)

## Artifacts

Raw output is under `.tint-bootstrap/worker-overhead.BMVafJRT`.
See `post-pr11-kernel-parity-initial-linux.log`,
`post-pr11-kernel-parity-linux-functional.log`,
`post-pr11-serial-kernel-profile-linux.log`,
`backend-dataflow-home-replay-functional.log`,
`backend-dataflow-ranked-interference-functional.log`,
`backend-dataflow-candidate-linux-functional.log`,
`backend-dataflow-record-replay-functional.log`,
`backend-dataflow-packed-record-replay-functional.log`, and
`post-pr11-optimized-kernels-replay-linux.log`.
