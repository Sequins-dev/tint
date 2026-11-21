# Native AArch64 function emission profile

On November 21, 2026, an instrumented native compiler rebuilt the frozen
821-file workload on Linux arm64. The compiler contained the LICM and
settled-SSA changes. The 49,771,592-byte output matched the preceding
Linux control by `cmp`, with SHA-256
`30c2dcb3323529be64ba35c4ca114b112936bc6b2caccf34a2479e3903dcb440`.

The process took 303.44 s wall and 319.16 s user plus system CPU, with
2,095,324 KiB peak RSS. The VM did not expose hardware cycles. The
monotonic clock was sampled at the following boundaries inside each
emission attempt, including attempts the emitter later retried.

| Function-emission work              | Total (s) |
| ----------------------------------- | --------: |
| Integer use analysis                |    13.626 |
| Frame planning                      |    68.486 |
| Prologue and record guards          |    12.573 |
| Instruction emission                |    21.507 |
| Register forwarding                 |     0.982 |
| Stack-map collection                |     4.788 |
| Function release and retry handling |     0.112 |

Frame planning accounted for 55.7% of the attributed function work.
It includes slot sharing, register homes, temporary slots, and
safepoint liveness. A standalone worker for register forwarding would
have less than one second of measured work to remove from this run.

Two initial instrumentation builds failed the native checker because
the timing helper's name collided with a per-attempt rollback marker.
The completed build used a distinct name. The logs are
`codegen-kernel-linux-build-r0.log`, `codegen-kernel-linux-build-r1.log`,
`codegen-kernel-linux-build.log`, and `codegen-kernel-linux.log`.

## Packed chunk eviction screen

An 8 MiB function store kept recently used chunks in access order as
an alternative to spilling in insertion order. A deterministic hot
chunk test reduced reads from 13 to eight. On a reachability replay
over the 5,665 captured functions from the frozen SSA input, both
policies read 26 chunks and 36,162,185 bytes. Both visited all 5,665
functions and produced the same reachability bitmap, with SHA-256
`51d55f7be46b3ca2e0f1ee3b39eddd8d9c0c6fd0f269e28e9d298813ad24aac9`.
The replay seeded every captured export. The shared-host screen
recorded about 1.42 s CPU for both variants. This screen leaves the
eviction change experimental.
