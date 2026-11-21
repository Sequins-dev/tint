# Object suite reaches packed AArch64 emission

November 21, 2026. Both macOS arm64 runs used Node 24.12.0, all 2,252
variants of the Object selection in one suite, an 8 MiB packed-store
budget, and 4 MiB V8 semispaces. The frozen input SHA-256 was
`7d3f40ab7477dce55da4b3dff2f539c91678141eba2ee077a7556968fcbeed42`.

The prototype kept the optimizer tail packed, using helper names from
the function headers to avoid full scans of bodies when no dense-list
accessors were present. It built a descriptor-stability summary for the
record rewrite, streamed selected cleanup with compact effect summaries,
traced and renumbered the final reachable graph, and passed the resulting
body store to the existing AArch64 emitter.

| Checkpoint                              | 2,400 MiB old space, RSS bytes | 2,250 MiB old space, RSS bytes |
| --------------------------------------- | -----------------------------: | -----------------------------: |
| Begin loop-cell promotion               |                  2,873,868,288 |                  2,974,941,184 |
| Complete loop-cell promotion            |                  2,878,717,952 |                  2,977,087,488 |
| Complete record reads                   |                  2,910,339,072 |                  2,991,063,040 |
| Complete selected cleanup               |                  2,924,511,232 |                  3,010,347,008 |
| Enter packed emission after final prune |                  2,953,003,008 |                  3,019,587,584 |

Both runs promoted 193 loop-cell pairs, lowered 279,574 proven field
reads, and reported 5,319,466 rewrites in selected cleanup. They entered
code generation with 391,352,944 and 389,826,336 bytes of live JS heap
respectively. The lower-heap run also released the linked application
reference after its initial check.

| V8 old space | Wall (s) |  CPU (s) | Cycles (billions) | Peak RSS (bytes) |
| ------------ | -------: | -------: | ----------------: | ---------------: |
| 2,400 MiB    | 1,866.96 | 2,526.86 |          6,619.01 |    3,963,305,984 |
| 2,250 MiB    | 1,955.27 | 2,641.72 |          6,890.62 |    4,048,240,640 |

Both ran out of V8 heap after entering packed emission. The first run's
last full collection left 2,252.0 MiB of JS heap in use. Its measured
process high-water mark exceeded 2.8 GiB. Neither wrote the Object suite
image. These were diagnostic screens on a shared machine.

Raw logs are `object-packed-tail-2400.log` and
`object-packed-front-2250.log` in the experiment directory. The logs
preserve the running suite heartbeats and V8 failures.
