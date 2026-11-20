# Slice 3 dense source replay comparison

The stress graph contains one entry and twelve imported leaves. Each leaf
exports twelve functions of the form
`function valueM_I(seed: number): number { return seed + arguments.length; }`.
The entry sums all 144 functions called with `1` and returns 42 when the
sum is 288. Both build modes use whole-module fallback for all 13 modules.
The source graphs and native target match within each row. The builds ran
sequentially on macOS using Node 24.12.0, `TZ=UTC`,
`TINT_NATIVE_TARGET=linux-aarch64`, and `TINT_BUILD_ONLY=1`. The replay
builds use `TINT_SOURCE_REPLAY=1`. Wall time and peak RSS come from
`/usr/bin/time -lp`.

| Implementation | Owned wall seconds | Replay wall seconds | Owned peak RSS bytes | Replay peak RSS bytes | Modules replayed |
|---|---:|---:|---:|---:|---:|
| Initial replay with whole graph available | 43.07 | 37.29 | 1,796,800,512 | 2,120,548,352 | 1,532 |
| Selective partition replay | 32.61 | 38.76 | 2,106,572,800 | 1,902,198,784 | 9,795 |
| Retained runtime syntax experiment | 34.68 | 43.53 | 2,264,662,016 | 2,071,740,416 | 1,688 |
| Selective replay with implicit arguments detection in imported leaves | 29.67 | 30.90 | 2,056,044,544 | 1,938,882,560 | 1,545 |

Each pair built successfully and `cmp` exited 0. Every image has SHA-256
`00d391e96ed954aba7bb6f36bbc9a411a6bfea185f1f8ad41e6dde6d422ae6d2`.
Both images in each of the three selective rounds stopped at entry under
LLDB on `dev` and exited 42. The first round only compared images.

The retained runtime syntax experiment reduced parsing and exceeded the
wall-time budget. The final route closes the known implicit-arguments
boundaries before retrying. Its manifest recorded 33 loader calls,
1,545 modules, and 34,444,282 UTF-16 units. The captured workspace
snapshot SHA-256 was
`ed8c899511b98ef928c908cc3396e650414ceade9d14ec2550662b1cca9ce36d`.
The final pair meets both replay budgets for this graph. These are
single paired observations for each implementation.
