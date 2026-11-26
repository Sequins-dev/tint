# Isolating the worker option on macOS arm64

Two adjacent native runs used the same integrated compiler on the
frozen 821-file self-compile. The serial compiler path and worker
path shared the planner refactor. Both ran under one timing and
launch-lock admission. LLDB verified entry and exit for the compiler
and the prelaunched sidecar. The worker build reused one plan for
function 6067.

| Workers | Wall (s) | CPU (s) | Cycles (billions) | Peak combined RSS (KiB) | Array-access selection (s) | Emission (s) |
| ------: | -------: | ------: | ----------------: | ----------------------: | -------------------------: | -----------: |
|  Inline |  102.394 | 113.764 |           455.286 |               2,184,944 |                      4.212 |       40.368 |
|       1 |   94.381 | 110.515 |           452.413 |               2,201,408 |                      4.390 |       39.854 |

The worker cell finished 8.01 s sooner and used 16.1 MiB more peak
combined RSS. Time in the affected pass rose 0.18 s. CPU and cycles
sum the last compiler, worker and launcher samples. Whole-build
timings also moved in opposite directions in the earlier macOS
rotation against main. The same-compiler rotation on Linux added
wall time in both orders. The integrated worker remains experimental.
[macOS rotation against main](parallel-bounded-compile-array-plan-integration-v1.md) ·
[Same-compiler Linux rotation](parallel-bounded-compile-array-plan-isolated-linux-v1.md)

Both signed 50,163,978-byte images matched by `cmp`, SHA-256
`334b71602e62113f13c967a902a728df52e5445eacbe4eec1886bbf27eda9613`.
The candidate compiler and sidecar are identified in the integrated
rotation. Raw logs are `production-array-plan-darwin-extra.log` and
`production-array-plan-darwin-aarch64-shared-{control,pool}/`.
