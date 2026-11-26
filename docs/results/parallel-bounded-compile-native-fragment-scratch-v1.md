# Native fragment actor handoff and scratch limits

November 22, 2026. The full-compiler probes use 821 frozen sources and
unbounded AOT optimization and codegen analysis. The actor probes use
the 7,111-body packed capture described in the
[typed packet experiment](parallel-bounded-compile-typed-fragments-v1.md).
These probes predate the Worker runtime changes merged in PR #11.
Each native execution stopped at entry under LLDB. Where the tables
say a worker exited, the inferior exit was checked independently of
LLDB's shell status.

## Planner callback and full-compiler handoff

The earlier native Linux probe trapped at the planner call in
`emitProgram`. The debugger stopped at the signature comparison at
ELF address `0xfd6320`. Both signatures took one reference parameter.
The closure's emitted descriptor declared a reference result. The
indirect call site required an optional-reference result. The planner
now declares the same reference result at the call site and the
implementation. Callers select the optional planner before calling it.

With that change the Linux arm64 compiler finished a frozen self-build
using 76 inline fragmented ranges after releasing the decoded bodies
and forcing collection. The ELF matched the serial reference by
`cmp`. A second variant serialized both the prepared input and the
output fragments and executed every range through the detached actor
entry, inline in the generational coordinator. It also matched the
49,771,592-byte serial ELF with SHA-256
`30c2dcb3323529be64ba35c4ca114b112936bc6b2caccf34a2479e3903dcb440`.
The same 76-range detached path ran inline on macOS arm64 and matched
the 50,163,978-byte signed reference with SHA-256
`334b71602e62113f13c967a902a728df52e5445eacbe4eec1886bbf27eda9613`.
The single macOS execution took 258.48 s from debugger entry in the
shared host environment, with no paired control or RSS sample.

The second Linux probe reached preparation transfer at 67.27 s from
debugger entry. It spent 51.57 s emitting and sealing the packets,
then 7.13 s on canonical placement and image publication. Its peak
was 2,112,236 KiB. Resident pages fell from 1,571,592 to 503,660 KiB
during the 144 ms collection, a reduction of 1,043 MiB. The lock
controller recorded a 120-second idle stall on the vm transport.
The inferior continued, wrote the image, and exited 0 in the recorded
debugger session. The run provides image and residency evidence and
is excluded from paired performance acceptance.

## Persistent native Workers

The stopped-at-entry fixture passed at 0, 1, 2 and 3 Workers on
both macOS arm64 and Linux arm64. Each run reproduced all three
reference packets by `cmp`. Workers read two shared read-only file
mappings and open the common preparation once.

The cost-ranked frozen replay starts with function IDs 6,002 and
1,928. The dense variant uses packed live-slot rows with an upper
limit of 16 million 32-bit words per liveness table. This is a storage
choice. The solver retains its full work allowance. The screens
used the shared timing and launch locks and a 1,550,000 KiB sampled
guard on the worker process. Each active Worker had a heap limit
set through `resourceLimits`.

| Host | Rows | Workers | Heap per Worker | Completed jobs | Peak RSS | First two jobs elapsed |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Linux arm64 | Sparse | 1 | 1,024 MiB | 3 of 35 | 1,094,452 KiB | 12.16 s |
| Linux arm64 | Dense | 1 | 704 MiB | 3 of 35 | 765,380 KiB | 14.78 s |
| Linux arm64 | Dense | 2 | 704 MiB | 2 of 35 | 1,487,696 KiB | 6.98 s |
| macOS arm64 | Dense | 2 | 704 MiB | 2 of 35 | 1,489,312 KiB sampled | 6.49 s |

The dense two-worker pool overlapped the largest two jobs on both
hosts. Their typed packets matched across hosts and matched the
Node reference. The first three Linux packets from the sparse and
dense one-worker runs also matched the reference. Both two-worker
experiments stopped before the full batch completed.

The Linux single-worker runs failed when they reached job 3, function
ID 5,648. Running that job alone in a fresh sparse worker also failed
at 1,024 MiB and 1,280 MiB. Its process reached 1,078,260 KiB and
1,342,216 KiB respectively and published no packet in either case.
The worker threw an object and the fixture reported exit 1. The
samples approach the requested heap ceilings.

A traced dense worker at 704 MiB reached 747,992 KiB and failed in
frame slot sharing, before register-home analysis. At 1,280 MiB it
completed the same isolated job at 1,344,848 KiB peak RSS. A separate
Node inspection of the slot-sharing data for function 5,648 counted
13,645 slots, 21,235 blocks and 6,002,721 live-in entries. Three owner
hash arrays alone reserve 201,326,592 bytes. Their group/block keys
associate each live slot with its stack word for dead-slot clearing.
This is one concrete allocation to replace before admitting two large
jobs within the full compiler's memory guard.

This is a backend replay. The worker RSS excludes the full compiler's
coordinator and placement peak. The stopped runs do not establish an
admission bound for the full job set. The six-pair whole-build rotations
and the worker-enabled fixed point require a complete admitted run.

Raw evidence is in `.tint-bootstrap/worker-overhead.BMVafJRT`.
See `native-fragment-r0-guards-functional.log`,
`native-fragment-integration-linux-r3-functional.log`,
`native-fragment-r3-linux-aarch64-detached-gc-*.rss.jsonl`,
`native-fragment-actor-scratch-screens.log`,
`native-fragment-actor-dense-linux-one.log`,
`native-fragment-actor-dense-mac-two.log`,
`native-fragment-actor-isolated-job.log`,
`native-fragment-actor-job3-trace.log`,
`native-fragment-job3-slot-sharing-shape.log`, and the corresponding
`actor-*/fixture.log` files.
