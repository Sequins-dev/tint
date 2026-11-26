# macOS arm64 main-thread and Worker kernel parity

The November 22 macOS run completes the same-executable comparison in
the [Linux parity report](parallel-bounded-compile-native-kernel-parity-v1.md).
It ran on a single frozen function, ID 5,648, in main, Worker, Worker,
main, main, Worker order under both locks. Both paths used a 704 MiB
copying heap. LLDB confirmed a stopped launch and exit 42 in every
cell. All six packets match the earlier reference with SHA-256
`efc0a0496273eef40483ebf9b16546cac3979bb3932185434e25dbcb5307fbe4`.

The table reports the median of three observations per thread.
Retired instructions are interpolated from the process counter
at the native monotonic-clock markers. Allocation deltas include
publishing the opening marker.

| Kernel                | Main wall | Worker wall | Main instructions | Worker instructions | Main allocations | Worker allocations |
| --------------------- | --------: | ----------: | ----------------: | ------------------: | ---------------: | -----------------: |
| Register homes        |   6.479 s |     6.458 s |          80.571 G |            80.562 G |          827,969 |            827,808 |
| Precise slot liveness |   0.723 s |     0.737 s |           5.690 G |             5.692 G |          154,172 |            154,175 |
| Entry slot liveness   |   0.617 s |     0.640 s |           7.050 G |             7.047 G |           28,487 |             28,492 |
| Record guard dataflow |   2.640 s |     2.705 s |          28.021 G |            28.020 G |          174,403 |            174,395 |

The estimated instruction differences are smaller than the sampling
windows around the kernel boundaries. The whole cell, including
debugger resume and exit, took 18.375 s on the main thread and 18.549 s
in the Worker at the median. Median RSS was 745,616 and 750,528 KiB.
The shared typed entry and heap settings account for the similar
kernel work. Current main has since removed the copying collector.
[Current-main Worker runtime audit](parallel-bounded-compile-recheck-v2.md)

The executable SHA-256 was
`da7e89220a4cb0c1ad7b644d98ecf10d104768ab56b393ba6c76c6da03c9ddbd`.
Raw evidence is under `.tint-bootstrap/worker-overhead.BMVafJRT` in
`post-pr11-kernel-parity-darwin-paired.log` and its six fixture
directories. Each fixture directory includes the native trace and
`instruction-samples.jsonl`.
