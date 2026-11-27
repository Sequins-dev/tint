# Medium-sized AArch64 frame-plan jobs

The next codegen probe excluded the largest frame plans and the
earliest functions. It selected bodies with 128–4,096 slots,
256–12,000 blocks and a slot-count times operation-count estimate
of at least 10 million. It produced 25 plans in 10 batches.
The coordinator kept one batch of results and consumed plans
in function order. Both workers had 128 MiB managed heap limits.

Every run on the frozen 821-file input produced the same
49,771,592-byte ELF, SHA-256
`30c2dcb3323529be64ba35c4ca114b112936bc6b2caccf34a2479e3903dcb440`.

| Order | Workers | Wall (s) | CPU (s) | Peak combined RSS (KiB) | AArch64 emission (s) |
| ----: | ------: | -------: | ------: | ----------------------: | -------------------: |
|     1 |       2 |  137.876 | 166.458 |               2,128,164 |               65.827 |
|     2 |  Inline |  141.494 | 163.519 |               2,091,100 |               58.848 |
|     3 |  Inline |  117.255 | 136.492 |               2,091,340 |               51.536 |
|     4 |       2 |  129.946 | 158.144 |               2,128,464 |               52.042 |

Wall covers the full build. CPU and peak RSS include the compiler,
worker host and broker. Hardware cycles were unavailable in the
Linux VM. The coordinator prepared the first run's requests in
0.666 s. The first result handoff took 10.72 ms. All 25 selected
plans were consumed in both runs.

Smaller jobs lowered the worker memory cost to about 36 MiB
above the controls. The pool saved 3.62 s in the first pair and
lost 12.69 s in reverse. Both worker runs used more CPU and more
emission wall time. This variant stays experimental.

Raw logs are `register-home-medium-build.log`,
`register-home-medium-rotation.log` and
`register-home-medium-{pool2,control}-{a,b}/`.
