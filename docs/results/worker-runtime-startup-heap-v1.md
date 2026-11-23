# Startup heap: assessed, not built

24 November 2026, macOS arm64 (M5 Max), at `95721c654`. This assessment
follows [the first minor collection](worker-runtime-first-minor-v1.md). It
weighed two ways to shrink the first minor collection's one-time cost:
allocating the startup heap directly as old objects, or creating intrinsics
lazily.

## Measurements

Timings are from LLDB breakpoints on the generational `collect`, which read
the allocation state block (young top, old top) at entry and return. They
include breakpoint overhead, so they are upper bounds.

**Startup heap.** A scratch program forced a full collection first thing
in the main isolate and in a Worker. Each isolate allocated about 2.7 MB
during host setup, and 1.5 MB of it was live. The two isolates agreed within
1%.

**Minor collections with a 32 MiB nursery** (isolated records clone, 268 MiB
heaps):

| Isolate | First minor: promoted / time | Later minors: promoted / time |
| ------- | ---------------------------- | ----------------------------- |
| Worker  | 3.05 MB / 6.0 ms             | 0.9–2.5 MB / 5.0–5.5 ms       |
| Main    | 4.7 MB / 8.6 ms              | 2.1–2.6 MB / 5.3–5.8 ms       |

The startup heap adds about 1–3 ms to the first minor, once per isolate. The
benchmark's first samples agree: the records clone's first sample costs about
3.3–3.6 ms per operation, against 2.8–3.0 ms in the steady state. The "about
7 ms of startup promotion" in the earlier report was mostly the cost of any
minor collection at this nursery size.

Worker startup is 1.4–2.0 ms, 0.25–0.28× Node. With zero-copy string bodies,
the isolated 1 MiB clone no longer triggers a minor collection at all.

## Options

| Option                                                                           | Saves                                                                                                                          | Costs                                                                              |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Allocate the startup window as old (promote it in place at the first collection) | 1–3 ms once per isolate                                                                                                        | About 1.2 MB of startup garbage per isolate, kept until the first major collection |
| Lazy intrinsics                                                                  | Some of the 2.7 MB of setup allocation and 1.5 MB of startup heap: about 1 ms of startup and 1–3 ms of first minor per isolate | A broad refactor of intrinsic installation across every image                      |

## Decision

Neither is built: no gated number moves meaningfully.

What this assessment found instead is a fixed per-collection cost: every minor
costs about 5 ms whatever it promotes, and a full collection with 1.5 MB live
costs about 11 ms. That is being investigated separately.
