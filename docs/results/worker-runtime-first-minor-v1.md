# The first minor collection's one-time cost

23 November 2026, macOS arm64 (M5 Max). Base `a60cd3ce7` (images built
from it; `346da3fef` changes no code they contain).

## Problem

An isolate's first minor collection is the slow first sample of the isolated
1 MiB string clone (about 500–1,100 µs, against about 270 µs in the steady
state). The collection:

- promotes the startup heap (the realm's intrinsics), about 7 ms of work per
  isolate the first time it runs;
- starts the collector pool's threads when it is large enough to run in
  parallel.

## Variants

| Variant                | Change                                                                                                   | Outcome                                                                                                         |
| ---------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Startup collection (S) | Force a collection at the end of host setup                                                              | First samples about 20% better, but Worker startup goes from 1.4 ms to 8.4–9.5 ms (Node: 5.2–5.6 ms). Rejected. |
| Early pool start (P)   | Start the pool's threads with the heap (`ParallelEvacuator.warm`), not inside the first large collection | Kept: every gate holds (below).                                                                                 |

The remaining lever is a smaller startup heap: allocating the realm's
intrinsics directly as old objects, or creating them lazily. It is assessed
separately.

## Early pool start (P)

Each set ran 15 rotated rounds under the timing lock.

**Isolated 1 MiB clone** (µs per round trip; five round trips per sample;
median and interquartile range; load median 5.9).
Evidence: [isolated runs](worker-runtime-first-minor-v1-isolated.txt), where
`a` is the base, `b` is P and every native run reports its stop at entry and
exit 42.

|              | Sample 1      | Sample 2      | Sample 3      | Sum  |
| ------------ | ------------- | ------------- | ------------- | ---- |
| Base         | 382 (357–413) | 602 (576–635) | 448 (424–470) | 1436 |
| P            | 371 (366–411) | 574 (554–713) | 432 (423–497) | 1400 |
| Node 26.13.1 | 265 (246–284) | 156 (147–175) | 146 (142–164) | 577  |

Every sample's median improves (3–5%), and the interquartile ranges overlap.

**Transport suite** (load median 5.1).
Evidence: [transport](worker-runtime-first-minor-v1-transport.json).

| Operation             | P / base          | P / Node  |
| --------------------- | ----------------- | --------- |
| Worker startup        | 1.06× (0.90–1.18) | 0.28×     |
| terminate             | 1.11× (0.83–1.51) | 0.38×     |
| startup-8             | 1.04× (0.97–1.07) | 0.26×     |
| 1 MiB clone           | 0.94× (0.90–1.01) | 1.16×     |
| Every other operation | 0.97–1.07×        | unchanged |

**Frozen v7** (paired ratios P / base; median and interquartile range;
`frozen-workload.ts` records no load).
Evidence: [v7 rounds](worker-runtime-first-minor-v1-v7.txt).

| Wall                | Cycles               | Instructions           | Peak RSS               |
| ------------------- | -------------------- | ---------------------- | ---------------------- |
| 1.003 (0.982–1.033) | 1.0025 (0.982–1.019) | 1.0000 (0.9998–1.0001) | 0.9999 (0.9997–1.0003) |

## Decision

P is kept. All three gates hold:

- v7 is neutral;
- Worker startup stays below Node;
- the isolated clone's first samples improve.

P starts a pool in every generational isolate, so the pool must be joined
when an isolate exits. On arm64 it never was: startup never sent the
allocator's shutdown request, which only x86-64 sent. The commit before P
(`f8c556b0d`) adds that request to the arm64 cleanup.
