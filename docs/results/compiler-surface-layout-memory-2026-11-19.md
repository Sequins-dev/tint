# Managed surface layout memory, 2026-11-19

Node 24.12.0 on macOS arm64 used module support, suite linking, `TZ=UTC`
and AOT native services. The paired 4,096 MiB runs used frozen input
`0500ec98c485615d962135d9f77c6f0fa3bca0713841c0da3572270bb6e524ae` and
both passed all 2,252 object variants. Their images are byte-identical
(SHA-256 `ed04bf2bc060e87d01eb265c78a42126333a7fdca307c93525a0daafa5330ad5`).

| Measure                                        | Separate layout links | Shared runtime link |
| ---------------------------------------------- | --------------------: | ------------------: |
| Full runtime closure links for the two layouts |                     2 |                   1 |
| Link stage returned, live MiB                  |                   561 |                 560 |
| Highest layout probe, live MiB                 |                 1,625 |               1,623 |
| Second application instance, live MiB          |                 1,967 |               1,967 |
| Lowering returned, live MiB                    |                 1,870 |               1,870 |
| Maximum RSS, MiB                               |                 4,942 |               5,466 |
| Wall time, s                                   |              2,544.63 |            1,635.03 |

The host was running other builds and validation. The wall and maximum RSS
columns reflect those instrumented runs.

| Run                       | Cap, MiB | Result                                                     | Maximum RSS, MiB | Wall time, s |
| ------------------------- | -------: | ---------------------------------------------------------- | ---------------: | -----------: |
| `obj-check-owner-3072`    |    3,072 | 2,252/2,252                                                |            4,340 |     2,782.50 |
| `obj-surface-shared-3072` |    3,072 | V8 OOM during lowering                                     |            3,615 |     1,453.06 |
| `obj-surface-shared-2560` |    2,560 | V8 OOM during link-stage preparation for the second layout |            3,246 |       426.29 |

The capped runs in this second table used each compiler's own captured source
input. The raw probes and reports are in `scratchpad/bm` for session
`9f6a53a7-7af8-4730-8505-43ba9450ac72`. The paired runs are
`obj-check-owner-matched-4096` and `obj-surface-shared-matched-4096`.
