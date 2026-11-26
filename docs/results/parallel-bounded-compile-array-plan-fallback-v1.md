# Array-access plans without blocking in the optimizer

The coordinator packed one late function after LICM and published it for
a native Worker sidecar. That worker had a 192 MiB managed heap limit.
At the existing serial visit for the function, the coordinator tried to
read the atomically published plan once. If the result was absent, the
coordinator analyzed the original function inline. The worker used its
own IR copy. The result carried instruction positions and facts, which
the coordinator applied to the original body in the existing order.

This November 21, 2026 rotation used the frozen 821-file self-compile on
Linux arm64. The same native compiler ran with the worker path enabled
and disabled. Both worker cells reused their one plan. A fifth run enabled
worker dispatch but deliberately left the result absent. The serial
fallback ran and produced the expected executable.

| Order | Mode           | Wall (s) | CPU (s) | Peak combined RSS (KiB) | Array-access selection (s) | Emission (s) |
| ----: | -------------- | -------: | ------: | ----------------------: | -------------------------: | -----------: |
|     1 | Inline         |  224.018 | 261.952 |               2,149,268 |                     11.778 |       93.106 |
|     2 | One worker     |  180.578 | 211.243 |               2,166,520 |                      8.081 |       83.335 |
|     3 | One worker     |  167.030 | 195.077 |               2,167,144 |                      7.273 |       72.603 |
|     4 | Inline         |  153.137 | 174.361 |               2,150,512 |                      6.672 |       72.220 |
|     5 | Missing result |  227.756 | 254.006 |               2,151,200 |                      7.887 |      112.767 |

CPU and peak RSS include the compiler, broker and worker host. Hardware
cycle counters were unavailable in the Linux VM. The runs shared the host
with other work. Both total wall time and time in the affected pass moved
in opposite directions across the pairs. Peak RSS increased 16.2–16.8 MiB
in the worker cells. The scheduling variant stays experimental.

All five 49,771,592-byte ELF files matched by `cmp`, SHA-256
`30c2dcb3323529be64ba35c4ca114b112936bc6b2caccf34a2479e3903dcb440`.
The tested compiler SHA-256 was
`d99c6b246985ed1a3030be59289eb3543d5c452f678f7574faf58a4d981a8573`.
The worker SHA-256 was
`336a52ee560b722b03cbbf4011189bd7dd5624b92ff4efc76c2d8755b6ce31b7`.

Raw logs are `bounds-available-build.log`,
`bounds-available-worker-build.log`, `bounds-available-rotation.log`
and `bounds-available-{control-a,pool-a,pool-b,control-b,absent}/`.
