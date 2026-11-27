# Dense AArch64 register-home liveness

This experiment kept one bit per tracked slot in each large
register-home liveness row during unbounded AOT compilation.
The sparse solver kept its traversal and work accounting.
The two representations exposed identical ordered slot lists.
All 88 focused liveness and scalar emission tests passed,
including a test crossing the high bit and the next word.

Every self-build below reproduced the frozen 821-file reference.
The 50,163,978-byte signed macOS image had SHA-256
`334b71602e62113f13c967a902a728df52e5445eacbe4eec1886bbf27eda9613`.
The 49,771,592-byte Linux image had SHA-256
`30c2dcb3323529be64ba35c4ca114b112936bc6b2caccf34a2479e3903dcb440`.
The macOS candidate also built matching native stages 2 and 3,
SHA-256 `04fe075ca8711162123a4558b3f489867e6a7157992044d5c50cd13cd357d020`.
Every macOS inferior stopped at entry and reached its expected exit.

## macOS arm64

| Order | Rows   | Wall (s) | CPU (s) | Cycles (billions) | Peak sampled RSS (MiB) |
| ----: | ------ | -------: | ------: | ----------------: | ---------------------: |
|     1 | Sparse |  149.014 | 170.916 |           527.447 |                2,051.7 |
|     2 | Dense  |  177.147 | 169.993 |           514.257 |                1,996.8 |
|     3 | Dense  |  135.906 | 151.311 |           500.546 |                1,996.3 |
|     4 | Sparse |  178.408 | 180.032 |           537.649 |                2,052.3 |
|     5 | Sparse |  175.013 | 177.393 |           538.391 |                2,051.6 |
|     6 | Dense  |  149.678 | 166.701 |           512.174 |                1,996.8 |

Median wall time fell from 175.013 to 149.678 s. Two pairs
saved wall time and one added 28.133 s. All three pairs
reduced CPU, cycles and peak RSS. Other jobs shared the host.
The lock protected launch and timing admission.

## Linux arm64

| Order | Rows   | Wall (s) | CPU (s) | Peak RSS (KiB) |
| ----: | ------ | -------: | ------: | -------------: |
|     1 | Sparse |   169.07 |  190.60 |      2,095,828 |
|     2 | Dense  |   163.12 |  180.81 |      2,039,696 |
|     3 | Dense  |   164.07 |  181.57 |      2,040,476 |
|     4 | Sparse |   173.87 |  197.51 |      2,096,872 |

Both pairs used less wall time, CPU and memory. Median wall fell
4.6%. The VM did not expose hardware cycle counters.

## Pinned Object input

An initial screen froze each compiler together with its own source
tree, including the runtime sources built into the Object suite
image. Those images differed at byte 138 and had different lengths.
That comparison changed both the compiler and the program input.

The follow-up pinned the same Object runtime source snapshot
for both compilers and verified each compiler's separate frozen
Node toolchain manifest. The 821-file input snapshot was
`3a18302aa8ab690b7a191a684da148d7e0eb46952853853c48dce75e7a32644b`.
Node 24.12.0 compiled all 2,252 variants with 4,096 MiB old space,
4 MiB semi-spaces and monolithic native linking. Both images
matched by `cmp`. Each was 189,955,295 bytes, SHA-256
`eb5d8c874f32acbf66169ef9c0bbcf4c5e7392958de65fcf3cf9241834ae00c0`.

| Order | Rows   | Wall (s) | CPU (s) | Cycles (billions) | Peak RSS (bytes) |
| ----: | ------ | -------: | ------: | ----------------: | ---------------: |
|     1 | Dense  |   599.79 |  802.27 |         2,849.151 |    5,926,895,616 |
|     2 | Sparse |   544.60 |  772.27 |         2,897.581 |    5,768,429,568 |

The dense path saved about 55 MiB on the compiler's self-build
and used 151.1 MiB more peak RSS on the pinned Object input.
It stays experimental.

Raw logs are `register-home-compact-only-{linux,darwin}-rotation.log`,
`register-home-compact-only-darwin-extra.log`,
`register-home-compact-only-darwin-fixed.log`,
`register-home-compact-only-object-rotation.log` and
`register-home-fixed-input-object-rotation.log`.
