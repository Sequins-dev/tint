# Array-access worker image identity and Object memory

## Native fixed point

The integrated worker host reproduced all six result packets at widths
1, 2 and 6 on Linux arm64 and macOS arm64. The six functions came from
the frozen array-access pass input, including its two largest jobs by
work count. Full compiles at the same requested widths returned each
platform's reference image. Those compiles dispatched one function.
The six-packet replay exercised concurrent work at the wider settings.

The native compiler built the candidate source snapshot at width 1,
then its output built that same snapshot at width 6. Stage 2 equalled
stage 3 on both hosts. Each also matched the candidate compiler
built by the main toolchain. The macOS runner verified the native
inferiors under LLDB.

| Host        | Candidate stage 1, 2 and 3 SHA-256                                 |
| ----------- | ------------------------------------------------------------------ |
| Linux arm64 | `69bfe3723299cb9a49cedc55ec046fdf03df7c61d388d95487fed34dc3b258bb` |
| macOS arm64 | `29830393036d579b04e4a58ace61e387a4c861fd8caf1268e47bbe32488a699d` |

The CLI and packet regressions passed. The focused optimizer total
was 31 passing tests.

## Object compile-only memory

Both compilers built one signed image for all 2,252 Object variants on
November 21, 2026. The input was Test262
`91c70759363c46557b694792bf34a2551a7af5ba` and the same 821-file
runtime snapshot
`3a18302aa8ab690b7a191a684da148d7e0eb46952853853c48dce75e7a32644b`.
Each Node toolchain was frozen independently. The candidate compiler
source identity was
`60390f540091de6c70b0e6a36375416434e43cd233b41bea40e67839e5ef0e12`.
Both used Node 24.12.0, 4,096 MiB old space and 4 MiB semi-spaces.

| Compiler                | Wall (s) | CPU (s) | Cycles (billions) | Peak RSS (bytes) |
| ----------------------- | -------: | ------: | ----------------: | ---------------: |
| Serial main             |   504.72 |  708.50 |         2,698.156 |    5,849,382,912 |
| Candidate with fallback |   491.36 |  683.37 |         2,687.095 |    5,747,507,200 |

The candidate published one 1,584,745-byte packet for function 22779.
The run deliberately left the result absent. The compiler analyzed
that function inline and used 97.2 MiB less peak RSS in this pair.
The measurement covers the planner and its fallback with the worker
process absent. Both 189,955,295-byte images matched by `cmp`, SHA-256
`eb5d8c874f32acbf66169ef9c0bbcf4c5e7392958de65fcf3cf9241834ae00c0`.
They were built only. The compile-only runner logged idle-inferior
heartbeat warnings while the compiler remained active.

Raw logs are `production-array-plan-{linux,mac,object}-verification.log`,
`production-array-plan-object-{control,candidate}.log`,
`production-array-plan-*-aarch64-{count,fixed}-*.log` and
the `production-array-plan-packets` capture.
