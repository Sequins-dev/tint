# Isolating the worker option on Linux arm64

This rotation used the same native compiler for inline and worker
builds of the frozen 821-file input. The array planner and rewrite
split ran in both modes. Each worker cell used one result for
function 6067. All images matched the 49,771,592-byte reference ELF
by `cmp`, SHA-256
`30c2dcb3323529be64ba35c4ca114b112936bc6b2caccf34a2479e3903dcb440`.

| Order | Workers | Wall (s) | CPU (s) | peak combined RSS (KiB) | Array-access selection (s) | Emission (s) |
| ----: | ------: | -------: | ------: | ----------------------: | -------------------------: | -----------: |
|     1 |       1 |   98.171 | 120.190 |               2,190,436 |                      3.862 |       45.335 |
|     2 |  Inline |   94.458 | 113.290 |               2,172,044 |                      4.019 |       41.109 |
|     3 |  Inline |   92.708 | 111.380 |               2,173,140 |                      4.042 |       41.709 |
|     4 |       1 |   97.052 | 118.860 |               2,188,408 |                      4.154 |       43.416 |

Worker mode added 3.71 s and 4.34 s of whole-build wall time.
It spent 0.16 s less in array-access selection in the first pair and
0.11 s more in reverse. Unchanged code emission also varied across the
cells. Peak combined RSS rose 14.9–18.0 MiB.

GNU time measured CPU for the launcher and its children. The peak
is the largest concurrent RSS sum sampled at 25 ms intervals, using
parent IDs in `/proc/<pid>/status` to identify both native processes.
Hardware cycle counters were unavailable in the VM.

This rotation isolates enabling the worker path. The earlier integrated
comparison also changed the inline planner and used the main compiler
as its control.
[Integrated native rotation](parallel-bounded-compile-array-plan-integration-v1.md)

Raw logs are `production-array-plan-linux-rotation-r2.log` and
`production-array-plan-linux-aarch64-r2-{control,pool1}-{a,b}/`.
