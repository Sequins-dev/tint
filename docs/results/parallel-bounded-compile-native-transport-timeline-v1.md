# Native register-home transport timeline

The November 22, 2026 Linux arm64 screen compiled the frozen 821-source
self-build. Both runs used the same instrumented native compiler and
`with-lock.sh both`. The two-worker run used a separate native Worker
host with a 1,536 MiB old-generation allowance per isolate. It started
when the compiler published the first register-home batch. The
coordinator used all 5,910 worker plans. The 31 input files matched the
frozen register-home capture. The output from both runs matched by
`cmp`, with the following SHA-256.

```text
30c2dcb3323529be64ba35c4ca114b112936bc6b2caccf34a2479e3903dcb440
```

| Run             | Wall (s) | Compiler CPU (s) | Worker CPU (s) | Peak sampled RSS (KiB) |
| --------------- | -------: | ---------------: | -------------: | ---------------------: |
| Two workers     |  111.633 |           121.67 |          33.45 |              5,200,376 |
| Serial          |  147.560 |           167.78 |              — |              2,097,744 |

This screen used separate lock acquisitions with other work in between.
The front of the compile, through the first emitter form attempt,
took 60.9 s with workers and 82.1 s inline. The observed wall difference
includes substantial variation outside the worker stage. Combined peak
RSS was sampled every 25 ms and sums coordinator and native worker
process RSS. CPU excludes the lightweight broker. Hardware cycles were
unavailable in the Linux VM.

## Coordinator and host

All timestamps below use the compiler spawn as zero. The worker host
started at 66.484 s and entered its native entry point at 66.494 s.
The isolates received their first assignments at 66.500 and 66.501 s.
The complete input was 44,789,868 packed bytes.

| Coordinator portion                                     | Wall (s) |
| ------------------------------------------------------- | -------: |
| Prepare and publish all requests                        |    9.285 |
| Vocabulary scan within preparation                      |    0.021 |
| Function encode within preparation                      |    0.318 |
| Per-function row copy within preparation                |    0.079 |
| Batch concatenation within preparation                  |    0.004 |
| File publication within preparation                     |    0.091 |
| Remaining discovery and frame inputs within preparation |    8.771 |
| Wait after last input publication                       |    9.756 |
| Read and decode results                                 |    0.059 |
| Function emission after applying results                |   24.275 |

The remaining discovery time includes integer and slot-sharing facts,
call-frame inspection, traversal outside the packing callback, and
scheduling gaps. The trace measured these together. The last worker
finished computation and publication at 85.192 s. The host exited at
85.285 s. The coordinator received the completion signal at 85.368 s,
after the broker compared the packed inputs. Completion signalling
includes that validation overhead.

| Worker | Isolate setup (s) | Batches | Idle before receive (s) | Wait for input (s) | Read (s) | Per-batch table setup (s) | Decode (s) | Kernel (s) | Pack and publish result (s) |
| -----: | ----------------: | ------: | ----------------------: | -----------------: | -------: | ------------------------: | ---------: | ---------: | --------------------------: |
|      1 |             0.003 |      13 |                   0.010 |              1.336 |    0.035 |                     0.003 |      0.359 |     15.227 |                       0.083 |
|      2 |             0.003 |      18 |                   0.015 |              0.826 |    0.056 |                     0.005 |      0.606 |     17.048 |                       0.135 |

Worker durations overlap. The worker kernel timings include native
allocation and garbage collection during each call. The per-batch
table timings include rebuilding the vocabulary and reading the
no-safepoint table. The sampling and markers do not isolate GC from
other native kernel time.

## Per-worker timeline

Publish, receive, release, and end are timestamps in seconds from
compiler launch. Read, table, decode, kernel, and output are elapsed
seconds inside each batch. A worker can receive an ID before the
producer publishes its input. Release records the worker receiving
the FIFO notification, and output includes result encoding and
publication. Table setup below 0.0005 s rounds to zero.

| Batch | Worker | Functions | Publish | Receive | Release | Read | Table | Decode | Kernel | Output | End |
| ----: | -----: | --------: | ------: | ------: | ------: | ---: | ----: | -----: | -----: | -----: | --: |
| 0 | 1 | 444 | 66.460 | 66.500 | 66.513 | 0.003 | 0.000 | 0.028 | 0.203 | 0.009 | 66.756 |
| 1 | 2 | 602 | 66.567 | 66.501 | 66.593 | 0.003 | 0.000 | 0.033 | 0.255 | 0.006 | 66.890 |
| 2 | 1 | 180 | 66.703 | 66.757 | 66.757 | 0.003 | 0.000 | 0.031 | 0.408 | 0.006 | 67.205 |
| 3 | 2 | 98 | 66.893 | 66.891 | 66.900 | 0.003 | 0.000 | 0.031 | 1.067 | 0.006 | 68.007 |
| 4 | 1 | 53 | 68.377 | 67.206 | 68.403 | 0.003 | 0.000 | 0.032 | 9.195 | 0.017 | 77.650 |
| 5 | 2 | 133 | 68.526 | 68.008 | 68.539 | 0.003 | 0.000 | 0.032 | 0.553 | 0.006 | 69.134 |
| 6 | 2 | 66 | 68.755 | 69.135 | 69.161 | 0.003 | 0.000 | 0.032 | 1.044 | 0.006 | 70.246 |
| 7 | 2 | 154 | 69.952 | 70.247 | 70.249 | 0.011 | 0.000 | 0.099 | 1.353 | 0.011 | 71.724 |
| 8 | 2 | 94 | 70.078 | 71.724 | 71.738 | 0.003 | 0.000 | 0.027 | 0.309 | 0.005 | 72.081 |
| 9 | 2 | 145 | 70.268 | 72.082 | 72.088 | 0.003 | 0.000 | 0.031 | 0.488 | 0.007 | 72.618 |
| 10 | 2 | 416 | 70.371 | 72.619 | 72.643 | 0.003 | 0.000 | 0.032 | 0.239 | 0.006 | 72.924 |
| 11 | 2 | 380 | 70.488 | 72.925 | 72.936 | 0.003 | 0.000 | 0.036 | 0.284 | 0.006 | 73.266 |
| 12 | 2 | 97 | 70.629 | 73.266 | 73.275 | 0.003 | 0.000 | 0.029 | 0.591 | 0.005 | 73.903 |
| 13 | 2 | 179 | 70.749 | 73.904 | 73.908 | 0.003 | 0.000 | 0.029 | 0.329 | 0.005 | 74.274 |
| 14 | 2 | 107 | 70.954 | 74.276 | 74.300 | 0.003 | 0.000 | 0.029 | 0.612 | 0.009 | 74.952 |
| 15 | 2 | 147 | 71.131 | 74.954 | 74.962 | 0.003 | 0.000 | 0.030 | 0.418 | 0.005 | 75.419 |
| 16 | 2 | 117 | 71.253 | 75.420 | 75.438 | 0.003 | 0.000 | 0.024 | 0.368 | 0.005 | 75.838 |
| 17 | 2 | 138 | 71.430 | 75.838 | 75.842 | 0.002 | 0.000 | 0.024 | 0.446 | 0.006 | 76.320 |
| 18 | 2 | 511 | 71.549 | 76.321 | 76.322 | 0.002 | 0.000 | 0.028 | 0.236 | 0.005 | 76.593 |
| 19 | 2 | 529 | 71.667 | 76.594 | 76.612 | 0.002 | 0.000 | 0.026 | 0.212 | 0.005 | 76.857 |
| 20 | 2 | 79 | 73.125 | 76.858 | 76.880 | 0.003 | 0.000 | 0.034 | 8.243 | 0.030 | 85.192 |
| 21 | 1 | 168 | 73.381 | 77.651 | 77.661 | 0.003 | 0.000 | 0.025 | 0.943 | 0.005 | 78.637 |
| 22 | 1 | 117 | 73.838 | 78.638 | 78.650 | 0.008 | 0.000 | 0.067 | 0.981 | 0.008 | 79.713 |
| 23 | 1 | 176 | 73.977 | 79.714 | 79.720 | 0.002 | 0.000 | 0.024 | 0.341 | 0.005 | 80.091 |
| 24 | 1 | 135 | 74.174 | 80.091 | 80.106 | 0.002 | 0.000 | 0.024 | 0.890 | 0.005 | 81.027 |
| 25 | 1 | 105 | 74.315 | 81.028 | 81.036 | 0.002 | 0.000 | 0.025 | 0.471 | 0.005 | 81.539 |
| 26 | 1 | 119 | 74.518 | 81.540 | 81.543 | 0.003 | 0.000 | 0.026 | 0.605 | 0.005 | 82.180 |
| 27 | 1 | 105 | 75.234 | 82.181 | 82.203 | 0.002 | 0.000 | 0.022 | 0.353 | 0.006 | 82.587 |
| 28 | 1 | 89 | 75.422 | 82.587 | 82.607 | 0.002 | 0.000 | 0.025 | 0.379 | 0.005 | 83.019 |
| 29 | 1 | 169 | 75.587 | 83.020 | 83.043 | 0.002 | 0.000 | 0.025 | 0.407 | 0.005 | 83.482 |
| 30 | 1 | 58 | 75.612 | 83.483 | 83.492 | 0.001 | 0.000 | 0.006 | 0.051 | 0.003 | 83.553 |

## Granularity

Batches 4 and 20 took 17.438 kernel seconds, 54.0% of the work across
both isolates. They contained 132 of 5,910 functions. In a replay of
the observed batch release times and durations, a scheduler choosing
the most expensive available batch lowered modeled two-worker makespan
from 18.645 s to 17.946 s. At six workers a single late batch still
set a 15.109 s floor. These are scheduling estimates. Changing worker
counts can alter kernel duration, cache behavior, and memory pressure.

A separate census grouped functions connected by direct calls in two
frozen captures. A worker owning an entire closed group could run
module-wide passes without cross-group direct-call facts. The largest
such group contained 92.6% of instructions and terminators before SSA,
and 96.7% before emission.

| Capture      | Functions | Direct call sites | Closed groups | Functions in largest group | Ops in largest group | Total ops |
| ------------ | --------: | ----------------: | ------------: | -------------------------: | -------------------: | --------: |
| SSA input    |     5,665 |            43,350 |         1,709 |                      3,848 |            3,099,052 | 3,346,485 |
| AArch64 IR   |     7,111 |            73,154 |         1,268 |                      5,810 |            3,568,533 | 3,689,414 |

Direct calls alone establish these component sizes. Indirect calls
and shared record layouts can add constraints. Coarse worker ranges
inside these components need frozen cross-range facts and an ordered
merge. The operation counts describe graph coverage. Kernel time
can be distributed differently.

Raw logs are `register-transport-timeline-late-2/{compiler,worker}.log`,
`events.json` and `summary.json` in that run's directory,
`register-transport-timeline-control-transport/`,
`register-transport-schedule-late-2.json`, and `coarse-groups-{ssa,codegen}.json`.
