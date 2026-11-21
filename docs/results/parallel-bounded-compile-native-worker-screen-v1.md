# Native SSA worker screening and self-compile profile

November 21, 2026. This screen used the shared Linux arm64 `dev` VM. The
VM exposed nine CPUs and supported task-clock measurements. Hardware
cycles were unavailable. Other validation jobs used the host during the
screen. These results establish a pass-level comparison.

The self-compile used the native compiler with the LICM and settled-SSA
changes. The compiler SHA-256 was
`c8d55bccbff2be25263907388d8be0b7bb0958ca7a569aec96896b618874c585`.
It built the frozen 821-file merged-main workload with `--pass-stats`.
The process took 356.05 s wall and 284.71 s CPU, with 2,096,724 KiB peak
RSS. It exited zero and wrote a Linux arm64 image with SHA-256
`30c2dcb3323529be64ba35c4ca114b112936bc6b2caccf34a2479e3903dcb440`.

| Pass                   | Wall (s) |
| ---------------------- | -------: |
| Native code emission   |   139.97 |
| Loop-cell promotion    |    16.21 |
| Array access selection |    15.57 |
| SSA constants          |    14.60 |
| List-vector caching    |    13.45 |
| Loop invariant motion  |    11.51 |

Reported passes accounted for 263.44 s. Code emission accounted for
53.1% of pass time and 39.3% of process wall time. It was the largest
stage after the serial optimizer changes.

An instrumented rebuild of the same frozen source produced the
same 49,771,592-byte Linux image by `cmp`. It took 262.11 s wall
and 300.06 s CPU with 2,096,532 KiB peak RSS. Within that run the
AArch64 emitter spent 103.73 of its 120.16 s emitting function bodies.
Word facts took 6.93 s, verification 3.31 s, and layout took 3.25 s.
The function emission loop accounted for 86.3% of emitter time.

## Native worker transport

The typed fixture ran the settled-SSA kernel over all 5,665 functions
captured at the start of the real self-compile pass. The capture's
SHA-256 was
`4053bbf28a61207be71c538d01dc1883cc24c4225a0709a858bb47fbeb3ac1e6`.
The coordinator assigned 27 contiguous batches by instruction and block
count. An isolate received a batch number through `node:worker_threads`,
read the immutable packed input, decoded and optimized one function at a
time, and published a packed result with its counters. The serial
control used the same decoder, kernel and output writer in the calling
isolate. The process metrics include worker launch, input and output.

| Order | Workers | Wall (s) | CPU (s) | Peak RSS (KiB) |
| ----- | ------: | -------: | ------: | -------------: |
| A     |       0 |    23.15 |   22.87 |        539,056 |
| A     |       2 |    11.65 |   21.87 |      1,073,996 |
| A     |       6 |     7.26 |   22.53 |      3,113,368 |
| A     |       1 |    23.66 |   22.63 |        545,144 |
| B     |       1 |    25.53 |   24.48 |        545,144 |
| B     |       6 |     8.12 |   28.16 |      3,048,520 |
| B     |       2 |    14.37 |   27.53 |      1,073,992 |
| B     |       0 |    27.24 |   25.85 |        539,048 |

Two workers reduced median wall time by 48.4% with 1.4% higher median
CPU time. Six reduced median wall time by 69.5% with 4.0% higher median
CPU time. Peak RSS roughly doubled with two workers and reached
approximately 2.97 GiB with six.

All eight runs exited with fixture status 42. Every batch file matched
the first serial run with `cmp`. The ordered aggregate SHA-256 was
`2e060725ff87aaf1bacc3fe8c071841981b2bcf356e1cb9f3a6a92d174658cbc`.
All produced 85,469,637 visits and 135,019 rewrites, the same counts as
the self-compile profile. An earlier variant read the output path from
the compiler process arguments inside each worker. Its serial run
completed and a two-worker launch exited 1 before producing a result.
The rotated variant initializes the path through worker data.

The prototype remains outside the production optimizer. End-to-end
compiler wall time, signed executable identity across worker counts,
and the self-build fixed point still require the compiler integration.
Raw observations are in the experiment directory under
`optimizer-combined-linux-profile.log`, `native-spill-linux-v2-*.log`,
`linux-spill-rotation-v2-controller.log`, and
`codegen-profile-linux.log`.
