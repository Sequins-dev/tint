# Upper bound for a native backend worker split

November 22, 2026. This report combines the native kernel probe from
[the whole-build comparison](parallel-bounded-compile-deferred-liveness-whole-build-v1.md)
with the earlier actor measurements. It asks whether any measured worker
design can clear the acceptance bar: a median wall-time reduction of at
least 15% with the whole paired IQR below zero on both arm64 hosts. The
arithmetic below is a bound computed from measured inputs. It is not a
timing result.

## Inputs

| Quantity                                                    |               Value | Source                                                                          |
| ----------------------------------------------------------- | ------------------: | ------------------------------------------------------------------------------- |
| Serial backend function loop, macOS                         |             32.44 s | kernel probe, main                                                              |
| Serial backend function loop, Linux                         |             33.69 s | kernel probe, main                                                              |
| Frozen whole build, paired base median, macOS               |              97.3 s | rotation controls                                                               |
| Largest function (emitter closure), Linux                   |              7.63 s | kernel probe                                                                    |
| Inline actor path, emitting and sealing all ranges, Linux   |             51.57 s | [actor scratch screens](parallel-bounded-compile-native-fragment-scratch-v1.md) |
| Canonical placement and publication after the actors, Linux |              7.13 s | same run                                                                        |
| Input publication to Workers                                |              0.61 s | [live actor handoff](parallel-bounded-compile-live-native-actors-v1.md)         |
| Actor CPU for the whole capture, two generational processes |         8,508 ticks | [actor compute](parallel-bounded-compile-actor-compute-v1.md)                   |
| Actor CPU, two copying-heap Workers                         | 15,593–18,435 ticks | same report                                                                     |

The inline actor path ran in the same generational compiler image as the
serial loop. It took 1.53 times the serial loop's time for the same
functions. Those two cells come from different runs on a shared host, so
the ratio is approximate.

## Bound

With N lanes, the backend stage takes at least the larger of the largest
job and an even share of the actor work, plus placement and publication:

    stage(N) >= max(1.53 * 7.63, 1.53 * 33.69 / N) + 7.13 + 0.61

|     Lanes | Stage bound | Saving vs. serial loop | Share of a 97 s build |
| --------: | ----------: | ---------------------: | --------------------: |
|         2 |      33.5 s |                  0.2 s |                  0.2% |
|         4 |      20.6 s |                 13.1 s |                 13.5% |
|         6 |      19.4 s |                 14.3 s |                 14.7% |
| unlimited |      19.4 s |                 14.3 s |                 14.7% |

The bound has no imbalance and no coordinator contention, and it assumes
Workers run at generational-heap speed. It stays below 15% at any width.
The macOS controls' paired wall IQR spans about 20 percentage points under
the current host load, so a 15% median would still not place the whole
IQR below zero.

## Arm64 Worker heaps and the closed world

The AArch64 emitter accepts the generational mutator only for modules whose
host operations are all closed-world. The native Worker runtime uses
`thread-start`, `hosted-thread-entry`, `word-park`, `word-wake` and the
`shared-*` operations. These preserve descriptors, but they are not
closed-world. A generational Worker fixture fails with "generational
mutator requires tracked managed writes; raw memory capabilities are
unsupported", so arm64 Workers use the copying heap. The x86-64 emitter
requires only descriptor stability.

The copying heap explains most of the earlier actor slowdown. The same
range took 45–50 s in a 704 MiB copying Worker and 16.5 s in a
generational process.

The same classification also gates the compiler's interprocedural
analyses: list vectors, word arguments, call targets, call boundaries,
record flow, reachability and the emitter's stable layouts. If the
compiler image linked `node:worker_threads`, it would lose them all.
Every serial phase of the compiler, not only the offloaded one, would
then run slower code.

## Conclusion

No measured native worker design clears the acceptance bar, and the bound
shows that none can with the current actor costs. The worker machinery on
this branch should not land. A future attempt needs all of the following
before a rotation is worthwhile:

1. Thread-entry and shared-memory host operations classified for the
   closed-world analyses, with Worker entry functions as roots. This keeps
   the generational heap and interprocedural facts in a compiler image
   that starts Workers.
2. The per-function actor overhead (decoding packed bodies and rebuilding
   per-function facts) reduced from about 1.5 times the serial cost toward
   1.1 times.
3. Placement and publication reduced from 7.1 s to under about 1 s.
4. A smaller largest job. The emitter's own per-function closure alone
   bounds any split at about 7.6 s per copy.

Serial kernel work lowers the baseline that a split must beat by 15%.
[Dense live-in rows](https://github.com/Sequins-dev/tint/tree/perf/liveness-rows)
removed 4.75% of the build's instructions and 6.15% of its cycles in the
first eight macOS pairs of their acceptance rotation.
