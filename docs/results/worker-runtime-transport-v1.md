# Worker transport: wake latency and per-message cost

23 November 2026. Two changes to the
[Worker message path](../design-worker-runtime.md#5-message-path), each
measured with rotated, paired transport sets against Node 26.13.1:

- the wake path: immediate polls on macOS, and polling a port's queue before
  the loop parks;
- per-message overhead for small messages.

Every native run is under LLDB, which had to report the stop at entry and
exit 42; Node had to exit 42. The tables show median microseconds per
operation and the ratio to Node in the same set.

| Target      | Host                                                 |
| ----------- | ---------------------------------------------------- |
| macOS arm64 | Apple host, macOS 26.6.2                             |
| Linux arm64 | Shared `dev` machine (Debian 12, kernel 6.1, 9 CPUs) |

## Wake latency

**Root cause.** On macOS a zero-timeout `kevent64` is not a poll. A zero
timespec takes the timed-wait path and reschedules the thread.

- A standalone diagnostic measured 11.3 µs per call.
- With `KEVENT_FLAG_IMMEDIATE` and no timeout, the same call takes 0.15 µs.
- The event loop polls with a zero timeout on every turn that has work
  queued, so every message hop paid it.

Linux's `epoll_wait` with a zero timeout is already a true poll.

**The kernel wake is not the cost.** Two native threads ping-pong without
the runtime:

| Wake                                                                                    | Round trip |
| --------------------------------------------------------------------------------------- | ---------: |
| A pipe watched by the peer's kqueue (what ports use)                                    |     5.8 µs |
| An `EVFILT_USER` trigger on the peer's kqueue (libuv 1.52.1's `uv_async_send` on macOS) |     3.9 µs |
| Word park and wake (`__ulock`)                                                          |     4.6 µs |

**Polling before parking.** Before a loop blocks, a port that delivered in
that turn polls its queue for up to 50 µs, bounded by the next timer.

- While it polls, the port's signal flag tells senders it is awake, so they
  skip the pipe write.
- It then settles under the queue lock: it schedules queued packets, or it
  clears the flag so that the next send wakes it.
- A loop that keeps finding work this way checks its descriptors at most
  once per millisecond.

Counters in an instrumented round-trip build:

- Of about 10,000 idle turns per isolate, about 9,850 found work while
  polling.
- Only 148 (main) and 225 (Worker) ended in a blocking `kevent`.

Over the whole transport suite, process CPU rose about 8% (user plus system,
2.60 s to 2.81 s, LLDB included).

**Results.**

- Base `b629c92ce`; new `e1df6fe47`.
- 15 rounds on each target.
- Evidence: [macOS](worker-runtime-transport-v1-wake-darwin.json),
  [Linux](worker-runtime-transport-v1-wake-linux.json).

| Operation            | Node, macOS |    Base, macOS |     New, macOS | Node, Linux |    Base, Linux |     New, Linux |
| -------------------- | ----------: | -------------: | -------------: | ----------: | -------------: | -------------: |
| Round trip           |        8.92 |  39.96 (4.48×) |   7.14 (0.80×) |       20.03 |  28.52 (1.42×) |   8.06 (0.40×) |
| Port round trip      |        8.00 |  36.62 (4.58×) |   4.83 (0.60×) |       18.96 |  24.57 (1.30×) |   5.04 (0.27×) |
| Clone, 1 KiB string  |        9.45 |  42.66 (4.51×) |   9.27 (0.98×) |       21.36 |  30.29 (1.42×) |   9.87 (0.46×) |
| Transfer, 64 KiB     |       10.00 |  44.13 (4.41×) |   9.79 (0.98×) |       21.55 |  31.63 (1.47×) |  10.53 (0.49×) |
| Clone, 1,024 numbers |       64.06 |  88.98 (1.39×) |  55.56 (0.87×) |       71.03 |  80.69 (1.14×) |  56.68 (0.80×) |
| Clone, 1 MiB string  |      157.74 | 168.73 (1.07×) | 196.31 (1.24×) |      314.86 | 215.12 (0.68×) | 254.97 (0.81×) |
| Batch                |        0.64 |   0.68 (1.06×) |   0.66 (1.03×) |        0.53 |   0.72 (1.37×) |   0.73 (1.38×) |
| wait/notify          |        6.25 |   8.16 (1.31×) |   8.10 (1.30×) |       16.00 |  19.77 (1.24×) |  19.43 (1.21×) |
| waitAsync            |        7.39 |   7.37 (1.00×) |   7.61 (1.03×) |       18.26 |  21.30 (1.17×) |  20.92 (1.15×) |

**The 1 MiB string clone on macOS.** Its samples are bimodal on every image,
Node's included: about 140 µs, or 190–290 µs.

- The 2 MiB packets reused the warm cached mapping in 76 of 76 sends.
- Arming only after small packets did not change it.
- An image with a zero-length polling window matched the image without
  polling.
- Run alone in its process, the two trees were equal (436 µs and 426 µs).

So the difference was heap state left by earlier operations, not polling
during the operation. The per-message changes below removed it.

## Per-message overhead

A Linux `perf` profile of the batch operation (cpu-clock sampling) showed
where small messages spent their time:

- about 15% in the codec, for messages that are a single number;
- about 21% in mailbox metadata host calls.

A native microbenchmark measured one metadata access through the shared
memory host:

| Access           | Through the host | Raw-word intrinsic |
| ---------------- | ---------------: | -----------------: |
| Read             |            15 ns |             1.7 ns |
| Compare-exchange |            22 ns |             3.6 ns |

`6d37cee2b` makes three changes:

- A lone primitive serializes and deserializes without the reference tables
  and helper closures an object graph needs, and writes the same bytes.
- A producer reserves a segment's packet references when it opens the
  segment, so carving a packet makes no shared read or compare-exchange.
- An atomic-wait checkpoint with nothing pending returns at once.

**Results.**

- Base `fca316131`; new `6d37cee2b`.
- Seven rounds on each target.
- Evidence: [macOS](worker-runtime-transport-v1-batch-darwin.json),
  [Linux](worker-runtime-transport-v1-batch-linux.json).

| Operation           | Node, macOS |    Base, macOS |     New, macOS | Node, Linux |    Base, Linux |     New, Linux |
| ------------------- | ----------: | -------------: | -------------: | ----------: | -------------: | -------------: |
| Batch               |        0.63 |   0.65 (1.04×) |   0.48 (0.76×) |        0.52 |   0.69 (1.33×) |   0.49 (0.95×) |
| Round trip          |        8.78 |   7.30 (0.83×) |   6.78 (0.77×) |       19.85 |   7.90 (0.40×) |   7.42 (0.37×) |
| Port round trip     |        7.98 |   4.81 (0.60×) |   4.19 (0.53×) |       18.46 |   5.05 (0.27×) |   4.26 (0.23×) |
| Clone, 1 MiB string |      163.87 | 193.96 (1.18×) | 145.72 (0.89×) |      297.33 | 248.96 (0.84×) | 190.75 (0.64×) |
| wait/notify         |        6.21 |   8.21 (1.32×) |   8.05 (1.30×) |       15.88 |  19.16 (1.21×) |  19.00 (1.20×) |

## Remaining gaps

- **Records, trees and contended counters.** About 2–6× for records and
  trees and 7–40× for counters. These costs are in the untyped object model
  and the untyped builtin call floor:
  - an untyped `Math.abs` costs 225 ns natively;
  - after `b629c92ce`, an untyped `Atomics.add` costs 345 ns.
- **wait/notify on macOS, 1.30×.** Each round makes about six untyped
  builtin calls (wait, notify, load and store). At the call floor that
  accounts for the 1.8 µs difference.
