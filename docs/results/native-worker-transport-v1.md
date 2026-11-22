# Native Worker transport microbenchmarks

November 22, 2026. The same Worker workload ran under Node 24.12.0
and as a Tint image. The native runner asserted LLDB's stopped-at-entry
state and the hosted suite's exit value of 42. The tests exercised the
standard Script-facing Worker API. Array scans include ordinary JavaScript
indexed reads and exclude the act of creating the source array.

Startup is the median of ten fresh workers through the ready message.
Small round trips are medians of five batches of 1,000 request/reply
pairs. Clone and transfer alternate across five batches of eight
round trips of a 4 MiB ArrayBuffer, or 64 MiB of payload per batch.
Both ends check byte length, the first and last bytes, and transfer
detachment. The ordinary and shared read tests each sum four passes
over a 1 MiB Uint32Array and check the result. The ordinary case
includes sending the initial 1 MiB buffer. Each wait/notify batch
contains 1,000 wake round trips with an observed successful notification
and an ordered reply. Startup and teardown sit outside that timer.
Idle CPU measures the inferior process, including its worker threads,
during an approximately two-second wait with zero or four parked workers.
The CPU sampling clocks have a resolution of about 10 ms.

## Initial comparison

The initial candidate combined mapped buffer snapshots, waiter scan
bounds and a small-packet mailbox record. Node references ran on the
same hosts. These initial host runs took separate lock acquisitions.
The later rotations isolate the individual changes.

| Operation                 | Unit            | macOS Tint before | macOS candidate | macOS Node | Linux Tint before | Linux candidate | Linux Node |
| ------------------------- | --------------- | ----------------: | --------------: | ---------: | ----------------: | --------------: | ---------: |
| Startup                   | ms/worker       |             4.163 |           5.793 |     19.365 |             6.555 |           3.052 |     15.964 |
| Small message round trip  | µs/pair         |           140.514 |         152.516 |     15.150 |           275.869 |          64.710 |     40.473 |
| Clone 4 MiB buffers       | ms/64 MiB batch |        14,634.378 |          15.263 |      6.085 |        19,069.758 |          14.768 |     12.777 |
| Transfer 4 MiB buffers    | ms/64 MiB batch |             1.598 |           1.933 |      0.219 |             2.841 |           0.896 |      0.692 |
| Ordinary Uint32Array scan | ms/4 MiB        |         1,493.180 |         938.477 |      1.147 |         1,369.624 |         690.269 |      0.921 |
| Shared Uint32Array scan   | ms/4 MiB        |         1,807.389 |       1,602.968 |      0.997 |         1,843.643 |       1,419.515 |      0.889 |
| Wait/notify round trip    | µs/pair         |         3,769.552 |          38.619 |      8.545 |         2,689.028 |          33.626 |     27.953 |
| Idle CPU, 0 / 4 workers   | ms/process      |            0 / 10 |           0 / 0 |      0 / 0 |             0 / 0 |           0 / 0 |     0 / 10 |

Clone previously emitted one UTF-16 code unit per source byte and
copied those units individually into and out of the mailbox. The
candidate carries only a backing grant. It takes one byte copy at the
point serialization encounters the buffer, preserves aliases and
resizability, and releases unpublished grants on failure. Transfer uses
the existing detach-and-move path. The focused clone test failed with
the original implementation because the bytes went into the text packet.

With one waiter in a 65,536-row registry, the original notify performed
65,544 metadata reads. The new test requires fewer than 32 after a
second waiter times out and its terminal ticket is taken. The candidate
keeps a lock-protected end index for occupied rows and shrinks it when
the tail is released. Notification order and ticket completion rules
are unchanged.

## Mailbox and shared-read experiments

Each host ran the same sequence under both locks, then reversed it.
A has mapped clones, the shorter scan and an inline mailbox slot.
B adds a one-entry backing descriptor cache. C has the cache and
uses the original mapping path for every packet. Each cell below is
one whole benchmark invocation.

| Host  | Order | Configuration | Small RTT (µs) | Transfer (ms/64 MiB batch) | Shared scan (ms/4 MiB) |
| ----- | ----: | ------------- | -------------: | -------------------------: | ---------------------: |
| macOS |     1 | A             |         77.642 |                      0.811 |              1,059.296 |
| macOS |     2 | B             |        105.671 |                      1.032 |              1,818.662 |
| macOS |     3 | C             |        122.951 |                      1.575 |              1,415.529 |
| macOS |     4 | C             |        122.069 |                      1.387 |              1,298.618 |
| macOS |     5 | B             |        107.671 |                      1.416 |              1,358.648 |
| macOS |     6 | A             |        148.869 |                      1.679 |              1,439.945 |
| Linux |     1 | A             |         87.406 |                      0.880 |              1,572.099 |
| Linux |     2 | B             |        101.287 |                      1.212 |              1,074.607 |
| Linux |     3 | C             |        112.495 |                      1.356 |              1,259.147 |
| Linux |     4 | C             |         82.100 |                      0.848 |                924.513 |
| Linux |     5 | B             |         84.213 |                      1.184 |                954.453 |
| Linux |     6 | A             |         69.930 |                      0.873 |              1,318.868 |

The inline slot replaces one packet mapping and unmapping with a reserve
and release in the existing queue page. Small-message RTT fell 11.8–14.1%
on macOS and fell 10.0% or rose 2.6% on Linux. Transfer includes the
two small ownership envelopes. It also moved in opposite directions
across the two pairs. The queue variant stays experimental.

Caching immutable backing metadata cut 48 registry reads to 8 in the
isolated eight-read test, while the test still observed a second facade's
grow. Shared scan time fell 27.6–31.6% in the Linux comparisons and
moved in opposite directions on macOS. The shared scanner remained far
slower than Node with the cache. The ordinary array scan exposes a large
cost in Script indexing independently of the shared registry. The shared
path also allocates and decodes a byte representation for element reads.
These scans do not measure the typed backend's read-only mapped IR kernel.
The descriptor cache stays experimental.

A two-second sample from the original macOS clone workload recorded peak
physical footprint of 650.5 MB. The stripped image did not resolve the
native function names. The code path, focused packet test and registry read
counter identify the work removed. An initial 32 MiB hosted benchmark
failed with `PROMISE_INTERNAL_REACTION_INVARIANT` after its small-message
samples. The full measurements used 256 MiB managed heaps. The first
AOT build of the waiter change also exposed a native binding failure
from mutating a literal-inferred loop cursor. An explicit numeric type
fixed that build.

## Reproduce

Run `pnpm build` with Node 24.12.0. Then use the same workload for both
hosts:

```sh
node tools/run-worker-threads-benchmark.mjs node
TINT_BUILD_ONLY=1 node tools/build-worker-threads-benchmark.ts
node tools/run-worker-threads-benchmark.mjs native <image-path-from-build>
```

Both runners can run inside `tools/gate/with-lock.sh both`. Set
`TINT_NATIVE_TARGET=linux-aarch64` to cross-build the Linux image, then
run that image under LLDB on the Linux host. The initial run logs are
`native-{macos,linux}-{baseline,candidate-r1}.log` and
`node-{macos,linux}-reference-r1.log`. The variant rows come from
`rotation-{macos,linux}-*.log` in the worker-overhead experiment directory.

The exact runtime split uses the mapped clones and the shorter waiter
scan. Its focused tests cover separately mapped clones, aliasing,
resizability, failed or unpublished sends and FIFO across recycled
waiter slots. The shared Worker suite also checks an 8 MiB clone
over a MessageChannel on both hosts.
