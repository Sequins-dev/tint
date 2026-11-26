# Targeted register-home liveness and the threaded compiler collector

On November 21, 2026, a function-local AArch64 experiment computed
conservative liveness at marked handler entries, tracked interference
only for ranked groups, and delayed precise register-root lists until
registers had been assigned. It preserved the bounded JIT path. Both
variants produced identical plans for all 5,910 captured requests.
The targeted handler-entry query matched the existing set-based
reference on 500 graphs. All 88 focused liveness and emitter tests passed.

## Locked Node replay on macOS arm64

This rotated replay used the two largest functions from the frozen
input. Time and counters include reading the captured requests.

| Order | Liveness | Wall (s) | CPU (s) | Cycles (billions) | Peak RSS (bytes) |
| ----: | -------- | -------: | ------: | ----------------: | ---------------: |
|     1 | Original |     7.52 |    7.08 |            17.473 |    1,409,744,896 |
|     2 | Targeted |     4.07 |    5.06 |            16.122 |    1,300,889,600 |
|     3 | Targeted |     3.49 |    4.44 |            14.920 |    1,427,095,552 |
|     4 | Original |     3.70 |    4.57 |            15.475 |    1,293,303,808 |

## Native self-compile on Linux arm64

All four native builds used the same frozen 821-file input and matched
the 49,771,592-byte reference ELF, SHA-256
`30c2dcb3323529be64ba35c4ca114b112936bc6b2caccf34a2479e3903dcb440`.
The candidate compiler used a typed helper to resolve the chosen array
after the initial native check rejected indexed access through an optional
local alias. A shared-host Linux gate ran during part of the rotation.
The Linux VM did not expose hardware cycles.

| Order | Liveness | Wall (s) | CPU (s) | RSS (KiB) | AArch64 emission (s) |
| ----: | -------- | -------: | ------: | --------: | -------------------: |
|     1 | Original |   164.52 |  194.89 | 2,097,324 |               75.516 |
|     2 | Targeted |   164.09 |  190.29 | 2,133,760 |               77.550 |
|     3 | Targeted |   167.70 |  197.95 | 2,132,944 |               69.288 |
|     4 | Original |   134.24 |  157.39 | 2,097,092 |               57.444 |

The targeted path did not show a repeatable benefit at whole-build
scope. Its peak increased by about 35 MiB in both pairs. The Object
toolchains were prepared and frozen but neither was timed because the
candidate did not qualify on the self-compile.

## Generational collector in the in-process worker compiler

The earlier in-process worker compiler used a copying collector and
spent 728.10 s on an exact build. The next variant selected the
ordinary compiler's generational collector and retained the typed
worker entry. AArch64 emission rejected raw-memory host operations
because the generational mutator requires tracked managed writes.
The trial produced no executable. The type and collector checks stayed
enabled.

An independent transport probe captured compact integer graph data
for the two largest conservative liveness jobs. Each input was about
581 KB. Delta and run-length coding still left about 23.4 MB of
conservative live rows per function. The precise rows encoded to about
1.9 MB per function. The capture reproduced both register-home plans
in Node. This made whole-row transport a higher-volume seam than
sending the final register-home records.

Raw logs are `register-home-ranked-equality-r2.log`,
`register-home-ranked-focused-r2.log`,
`register-home-ranked-node-rotation-r2.log`,
`register-home-ranked-linux-rotation-r2.log`,
`register-home-generational-worker-build.log` and
`capture-packed-slot-problems.log`.
