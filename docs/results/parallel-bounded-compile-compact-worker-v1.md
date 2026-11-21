# Compact register-home workers on the frozen self-compile

On November 21, 2026, a Linux arm64 native compiler ran the frozen
821-file self-compile with compact bitsets for large register-home
liveness results. Two variants ran the same code. The control
calculated all register homes inline. The candidate spilled four
expensive functions to a native helper with two Worker isolates.
It retrieved each result when the serial emitter reached its function.
All four compiles matched the 49,771,592-byte reference ELF with
SHA-256 `30c2dcb3323529be64ba35c4ca114b112936bc6b2caccf34a2479e3903dcb440`.

## Two large functions

Two of the 5,910 register-home requests accounted for 53.3% of
Node time in the captured kernel. Each had about 21,236 blocks
and 12,353 homeable slots. Conservative live ranges put over
37.2 million slot entries in one function's block lists. The
first function reached 745,538,872 bytes of JS heap in use after
conservative liveness. The precise analysis added 4.38 million
entries and the register-root snapshots added 1.22 million.
The compact representation uses a row of bits per block, preserving
the tracked slot order and the existing work limits.

The compact and sparse implementations produced the same 5,910
plans in a Node replay. A locked rotation over the two largest jobs
gave the following results. These clocks cover the process, including
loading the real inputs.

| Order | Representation | Wall (s) | CPU (s) | Cycles (billions) | Peak RSS (MiB) |
| ----: | -------------- | -------: | ------: | ----------------: | -------------: |
|     1 | Sparse lists   |     2.46 |    3.19 |            13.653 |        1,183.2 |
|     2 | Dense bitsets  |     2.12 |    2.38 |            10.207 |          358.1 |
|     3 | Dense bitsets  |     2.11 |    2.37 |            10.176 |          358.2 |
|     4 | Sparse lists   |     2.46 |    3.17 |            13.544 |        1,215.3 |

Native kernel replay reproduced both golden result records. The
original representation exhausted a 1,024 MiB native managed heap on
the first request. At 128 MiB per Worker the compact attempt also
failed. Each successful trial used the same compact liveness code.

| Native replay | Per-worker managed heap (MiB) | Wall (s) | CPU (s) | Peak RSS (KiB) |
| ------------- | ----------------------------: | -------: | ------: | -------------: |
| Inline        |                         1,024 |     7.14 |    7.12 |        279,204 |
| 1 Worker      |                           256 |     7.22 |    7.20 |        279,928 |
| 2 Workers     |                           256 |     3.65 |    7.25 |        284,632 |

## Full native self-compile

| Order | Workers | Wall (s) | Total CPU (s) | Peak combined RSS (KiB) | AArch64 emission (s) |
| ----: | ------: | -------: | ------------: | ----------------------: | -------------------: |
|     1 |  Inline |   91.150 |        106.33 |               2,041,184 |               38.512 |
|     2 |       2 |   92.849 |        119.45 |               2,439,324 |               41.926 |
|     3 |       2 |  102.729 |        131.55 |               2,310,100 |               45.999 |
|     4 |  Inline |  106.696 |        123.90 |               2,040,244 |               45.087 |

CPU includes both processes. Peak RSS is the maximum contemporaneous
sum sampled at 25 ms intervals. The Linux VM did not expose hardware
cycles. Preparing the four bodies and their frame inputs took
2.33–2.54 s before dispatch. The emitter waited less than half a second
for the first result, and each remaining handoff took less than 11 ms.

One pair took 1.70 s longer with workers and the reverse order saved
3.97 s. Both worker runs used more CPU, spent more time in codegen,
and raised peak RSS by 13–20%. The whole-build results ruled out
retaining this pool. The Object workload was measured separately
for the previous memory prototypes. This pool was rejected on the
frozen self-compile before an Object run.

Raw logs are `register-home-top-two-allocation-profile.log`,
`register-home-compact-node-pairs.log`,
`register-home-top-two-compact-matrix-r2.log` and
`register-home-lazy-{control,pool2}-{a,b}/`.
