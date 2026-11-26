# Integrated arm64 array-access worker rotation

The native compiler published selected functions into a private
directory. The launcher started the native worker host before the
compiler. The host waited for the job count, started its Worker isolate
and returned a packed plan. The compiler used the result if available
at the serial visit and analyzed the body inline otherwise. Each worker
cell used one published plan for function 6067.

The November 21, 2026 rotations used the frozen 821-file self-compile.
The control used the serial optimizer landed in PR #9. On each host,
all four complete images matched that platform's reference by `cmp`.
The macOS launcher verified stop-at-entry and expected exit under LLDB
for the compiler and worker. Each adjacent macOS pair used one admission
for both the timing and launch locks.

## Linux arm64

| Order | Workers | Wall (s) | CPU (s) | Largest process RSS (KiB) | Array-access selection (s) | Emission (s) |
| ----: | ------: | -------: | ------: | ------------------------: | -------------------------: | -----------: |
|     1 |  Inline |   98.501 | 117.470 |                 2,095,704 |                      4.094 |       41.405 |
|     2 |       1 |   90.573 | 110.700 |                 2,112,364 |                      3.664 |       41.225 |
|     3 |       1 |   90.844 | 111.290 |                 2,112,276 |                      3.637 |       41.402 |
|     4 |  Inline |   93.605 | 112.750 |                 2,096,244 |                      4.190 |       42.272 |

The worker reduced wall and CPU time in both pairs. The affected pass
saved 0.43 s and 0.55 s. GNU time reported CPU across the launcher
and its children, and peak RSS for the largest process in that tree.
The combined sampler depended on a process-tree entry the VM kernel
does not expose, so the table uses GNU time's measurements. Hardware
cycle counters were unavailable on the VM.

The 49,771,592-byte ELF SHA-256 was
`30c2dcb3323529be64ba35c4ca114b112936bc6b2caccf34a2479e3903dcb440`.

## macOS arm64

| Order | Workers | Wall (s) | CPU (s) | Cycles (billions) | Peak combined RSS (KiB) | Array-access selection (s) | Emission (s) |
| ----: | ------: | -------: | ------: | ----------------: | ----------------------: | -------------------------: | -----------: |
|     1 |  Inline |   97.538 | 103.965 |           438.244 |               2,185,296 |                      4.042 |       37.126 |
|     2 |       1 |   85.694 | 100.932 |           431.913 |               2,203,264 |                      3.358 |       37.510 |
|     3 |       1 |   99.918 | 112.881 |           455.576 |               2,202,352 |                      4.034 |       39.192 |
|     4 |  Inline |   90.583 | 101.581 |           431.550 |               2,184,736 |                      3.879 |       38.079 |

The first pair saved 11.84 s of wall time and the reverse pair added
9.34 s. CPU time and cycles moved in the same direction as wall within
each pair. Combined RSS rose 17.2–17.5 MiB. CPU and cycles sum the
last sampled compiler, worker and launcher values.

The signed 50,163,978-byte image SHA-256 was
`334b71602e62113f13c967a902a728df52e5445eacbe4eec1886bbf27eda9613`.

The first candidate native builds rejected an extra object-spread variant
in the build request. An explicit optional union field preserved the
same record shape for both worker modes. The dedicated worker host
required typed Worker startup, and its dispatch closure captured a numeric
job count. Both native coordinators and both worker hosts built after
those corrections. The packet codec and CLI round-trip tests also passed.

The candidate Linux coordinator SHA-256 was
`69bfe3723299cb9a49cedc55ec046fdf03df7c61d388d95487fed34dc3b258bb`
and its worker SHA-256 was
`309ebdbaa07d8aa05271ffb974ea9bff94fc99ae9a56dc48c5480281481aa285`.
The candidate macOS coordinator SHA-256 was
`29830393036d579b04e4a58ace61e387a4c861fd8caf1268e47bbe32488a699d`
and its worker SHA-256 was
`fbcb2818432254eb52e5b1f9b6b71e72fc75dfaa4986ee00a300742bf247f451`.

Raw logs are `production-array-plan-{linux,darwin}-rotation.log`
and `production-array-plan-*-aarch64-{control,pool1}-{a,b}/`.
