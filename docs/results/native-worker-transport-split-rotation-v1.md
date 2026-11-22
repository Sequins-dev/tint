# Exact native Worker transport split

November 22, 2026. The mapped clone and waiter-scan changes were
built without the inline mailbox and shared descriptor cache
experiments. Both hosts ran main, split, split, main under
`tools/gate/with-lock.sh both` with `TZ=UTC`. Each cell is the
within-invocation median. The workload and units are defined in the
[initial transport report](native-worker-transport-v1.md).

| Host  | Order | Source | Startup (ms) | Small RTT (µs) | Clone (ms/64 MiB) | Transfer (ms/64 MiB) | Ordinary scan (ms/4 MiB) | Shared scan (ms/4 MiB) | Wake RTT (µs) | Idle CPU at 0/4 workers (ms) |
| ----- | ----: | ------ | -----------: | -------------: | ----------------: | -------------------: | -----------------------: | ---------------------: | ------------: | ---------------------------: |
| macOS |     1 | main   |        3.106 |        103.979 |        11,159.770 |                1.053 |                  855.502 |              1,170.063 |     1,607.258 |                       0 / 10 |
| macOS |     2 | split  |        2.891 |         87.676 |             9.961 |                0.946 |                  675.225 |              1,135.411 |        19.163 |                        0 / 0 |
| macOS |     3 | split  |        2.394 |         72.600 |             8.287 |                0.829 |                  644.702 |              1,094.987 |        19.805 |                        0 / 0 |
| macOS |     4 | main   |        4.552 |      1,461.682 |        12,271.348 |                2.503 |                1,349.475 |              1,528.912 |     2,333.604 |                        0 / 0 |
| Linux |     1 | main   |        3.024 |         73.582 |        10,084.900 |                0.887 |                  792.136 |              1,125.571 |     1,914.033 |                        0 / 0 |
| Linux |     2 | split  |        2.907 |         72.164 |            13.006 |                0.842 |                  661.486 |              1,122.354 |        31.890 |                        0 / 0 |
| Linux |     3 | split  |        2.880 |         65.006 |            15.125 |                0.821 |                  631.090 |              1,088.210 |        26.348 |                        0 / 0 |
| Linux |     4 | main   |        2.798 |         68.194 |         9,967.845 |                0.953 |                  803.570 |              1,075.635 |     1,509.567 |                        0 / 0 |

Clone and wake improved in both orders on both hosts. Other operations
varied more across cells. Small RTT reached 1.46 ms in the second
macOS main run. The report preserves that observation. The split
retains the two changes with the large paired effects.

All eight benchmark invocations and both native suites reported
`INFERIOR_EXIT 42` under LLDB. The native suites exercise an 8 MiB
ArrayBuffer clone, buffer aliases and isolation, and the existing
Worker, MessagePort and Atomics behavior. The workspace build, test
and host type checks, dependency boundaries and 14 focused tests
passed. The focused suite has one separately gated Node-hosted
native fixture skip.

The benchmark images for the split had SHA-256
`320e57132d4a7635748416c956091f6840ae3375b08e04d6ea91a4d35815f8f1` on macOS
and `c659a31b0c1bfacdf021c2895379620eca40c85bb29f23b22ce7a544bca5a48b` on Linux.
Their main controls had SHA-256
`97b23647d82a742b2c3afb61efae5980152acc30fac966af066d533a8d3b3160` and
`efb3ff90c24a144f15900a0a31e984721c597b21bc9ff61f2c64f646c7065d15`.
The suite image SHA-256 values were
`5012a811362bb4d99f0c0ed1c8d4838eb51fa06105c7b8dea77b180625df6e32` and
`86fdb34f9c939a648848f4ecae87b2ec13bf88f1e24defe93e75bac88e763c97`.
Raw logs are `runtime-split-{macos,linux}-rotation-*.log` and
`runtime-split-{macos,linux}-suite.log`.
