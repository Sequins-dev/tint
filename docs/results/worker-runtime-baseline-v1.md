# Worker runtime baseline (macOS arm64)

22 November 2026. This is the Phase 1 baseline for the
[Worker runtime design](../design-worker-runtime.md). It asks two questions:

- What does using `node:worker_threads` cost the code a program runs?
- How do Worker startup, messaging and shared memory compare with Node 26.13.1?

**Setup.**

- The benchmark sources are `tools/worker-bench/` at `ae24161ab`.
- The compiler and runtime are main at `3d10cb5c0`.
- The host was an Apple M5 Max (18 cores) on macOS 26.6.2, with Node 26.13.1
  as the reference.

**Protocol.**

- Each set ran 15 rounds in a single `tools/gate/with-lock.sh both` hold, with
  `TZ=UTC`.
- Each round ran every member once. Round r started at member r mod n, and odd
  rounds ran in reverse.
- Every native run was launched under LLDB. It had to report the stop at entry
  and exit status 42, and every one did.
- Every Node run had to exit 42, and every one did.
- Cells are medians across rounds with the interquartile range. Ratios are
  paired within each round.
- The 1-minute load average at round starts was 15–42 from other streams. It is
  recorded in the raw files.

Raw rounds:

- [kernels](worker-runtime-baseline-v1-kernels.json)
- [transport](worker-runtime-baseline-v1-transport.json)
- [in-Worker kernels](worker-runtime-baseline-v1-worker.json)

## Workloads

**Kernels** are typed TypeScript that Node runs with type stripping:

| Kernel | What it does |
| --- | --- |
| `allocation` | Short-lived records and arrays, with a surviving window of 32 batches |
| `numeric` | Allocation-free stencil and integer hashing |
| `calls` | Small functions over records |
| `strings` | Building, joining, slicing and scanning |
| `compiler` | Tokens, syntax records and a parent-linked scope chain of `Map`s |
| `zlib` | `node:zlib` round trips of 64-byte inputs |

Each run times one cold iteration and two steady iterations. A run's steady
value is the mean of its two steady iterations.

**Placements:**

| Placement | Program |
| --- | --- |
| `plain` | No Workers; the project's generational collector |
| `copying` | The same program on the copying collector |
| `raw` | The kernels plus the `zlib` kernel, in an image that uses C calls and `tint:ffi` external storage |
| `main` | Kernels on the main thread of a program that has started one idle Worker |
| `worker` | Kernels inside that Worker. The main thread times each request through its reply, which adds one small round trip per iteration |

**Transport** is one untyped module that runs on both sides on both hosts:

- startup to the first message, `terminate()`, and 8 Workers at once;
- small round trips;
- structured clones of records, number arrays, strings and binary trees, at two
  sizes each, echoed back;
- `ArrayBuffer` transfers at 64 KiB and 8 MiB;
- batches of 10,000 messages;
- `MessageChannel` port round trips;
- `Atomics.wait`/`notify` and `Atomics.waitAsync` ping-pong;
- 1 and 4 Workers each doing 100,000 `Atomics.add`.

## Execution tax

Steady state, in ms per iteration:

| Kernel | Tint plain | Tint copying | Tint raw | Tint main | Node plain | Node main | Node worker |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| allocation | 24.3 (23.2–26.5) | 30.6 (28.9–34.2) | 25.7 (23.3–30.1) | 86.8 (81.5–90.9) | 9.6 (8.8–10.4) | 9.2 (8.8–10.5) | 19.6 (16.9–20.9) |
| numeric | 71.1 (68.0–72.9) | 74.0 (69.9–81.8) | 77.1 (68.8–82.5) | 80.6 (79.2–83.2) | 18.3 (17.4–19.2) | 17.5 (17.0–18.6) | 18.4 (17.5–19.1) |
| calls | 78.4 (76.6–84.9) | 83.4 (76.3–89.5) | 83.2 (73.4–86.8) | 1,068 (987–1,182) | 40.1 (38.2–43.1) | 40.0 (37.8–41.6) | 41.6 (39.8–44.4) |
| strings | 49.1 (46.4–53.2) | 51.7 (48.3–56.7) | 50.0 (44.5–54.1) | 96.0 (91.6–103.9) | 24.6 (22.4–25.9) | 24.3 (23.3–25.8) | 23.7 (23.3–27.9) |
| compiler | 76.2 (70.0–80.3) | 71.6 (68.2–79.7) | 75.2 (70.7–82.7) | 178.1 (162.0–190.5) | 18.3 (17.5–19.4) | 17.9 (16.9–18.9) | 18.5 (17.6–20.5) |
| zlib | – | – | 56.4 (53.6–58.3) | – | – | – | – |

Node ran the `zlib` kernel at 45.9 ms (42.4–48.0).

Paired ratios:

| Kernel | copying / plain | raw / plain | main / plain | plain / Node |
| --- | ---: | ---: | ---: | ---: |
| allocation | 1.22× (1.19–1.33) | 1.04× (0.94–1.12) | 3.52× (3.19–3.67) | 2.53× (2.41–2.85) |
| numeric | 1.02× (0.98–1.08) | 1.03× (0.96–1.14) | 1.11× (1.07–1.20) | 3.85× (3.71–4.22) |
| calls | 1.02× (0.99–1.04) | 0.97× (0.92–1.07) | 13.46× (12.59–14.42) | 1.97× (1.87–2.08) |
| strings | 1.05× (1.02–1.06) | 0.96× (0.93–1.04) | 1.98× (1.84–2.07) | 1.92× (1.88–2.11) |
| compiler | 0.98× (0.90–1.00) | 1.02× (0.93–1.07) | 2.37× (2.12–2.51) | 4.11× (3.69–4.48) |

**Placement costs Node nothing on the main thread.** Its `main` cells match
`plain`.

**On Tint, the main thread of a Worker program runs 1.11× to 13.5× slower than
the same program without Workers.**

- The copying collector accounts for only part of that. On its own it costs
  1.22× on `allocation` and nothing measurable on the other kernels.
- The rest comes from the image-wide loss of the closed-world analyses and of
  inlining (see Attribution).

**Raw memory costs nothing.** The `node:zlib` image builds with the generational
collector and measures 0.96–1.04× the plain program. Its `zlib` kernel is 1.21×
Node (1.15–1.38).

**Tint is 1.9–4.1× slower than Node even without Workers.** This is the typed
code-generation gap, which other streams own.

## Kernels inside a Worker

Steady state, in ms per iteration:

| Kernel | Tint worker | Node worker | Tint / Node (paired) | Tint worker / Tint plain (unpaired medians) |
| --- | ---: | ---: | ---: | ---: |
| allocation | 5,535 (5,255–6,090) | 20.1 (19.0–21.2) | 278× (255–326) | 227× |
| numeric | 8,129 (7,371–8,391) | 17.9 (16.6–19.6) | 444× (399–492) | 114× |
| calls | 20,732 (19,669–22,325) | 38.4 (36.1–45.7) | 529× (492–554) | 264× |
| strings | 2,202 (1,997–2,304) | 25.1 (21.7–27.0) | 91.0× (86.6–95.7) | 44.9× |
| compiler | 3,753 (3,509–4,342) | 18.0 (16.2–19.1) | 227× (211–234) | 49.3× |

The same typed kernels run 45–264× slower inside a Tint Worker than in a
program without Workers, and 91–529× slower than inside a Node Worker. Node's
own in-Worker cells match its main thread.

## Transport

In µs per operation:

| Operation | Tint | Node | Tint / Node |
| --- | ---: | ---: | ---: |
| startup | 4,990 (4,786–5,622) | 10,708 (10,196–10,867) | 0.48× (0.44–0.50) |
| terminate | 272 (243–343) | 623 (589–682) | 0.43× (0.39–0.48) |
| startup, 8 Workers (per Worker) | 1,045 (945–1,146) | 2,302 (2,076–2,590) | 0.47× (0.39–0.54) |
| round trip | 155 (128–204) | 18.8 (17.2–22.7) | 8.30× (5.82–9.22) |
| clone records ×16 | 1,940 (1,751–2,100) | 48.2 (44.7–58.1) | 40.4× (32.3–46.8) |
| clone records ×1,024 | 121,603 (111,677–128,739) | 1,289 (1,236–1,320) | 93.4× (88.1–97.8) |
| clone numbers ×1,024 | 25,871 (24,471–26,228) | 131 (125–143) | 192× (169–203) |
| clone numbers ×65,536 | 1,680,127 (1,627,948–1,704,773) | 7,030 (6,415–7,131) | 239× (231–245) |
| clone string 1 KiB | 518 (459–598) | 21.1 (19.7–23.2) | 24.7× (20.0–27.7) |
| clone string 1 MiB | 329,510 (309,344–339,857) | 365 (281–385) | 918× (770–1,184) |
| clone tree depth 4 | 2,270 (2,165–2,844) | 66.1 (62.0–76.4) | 32.9× (29.8–44.9) |
| clone tree depth 10 | 142,860 (134,885–145,123) | 2,576 (2,411–2,649) | 55.5× (52.3–61.0) |
| transfer 64 KiB | 192 (171–224) | 20.8 (18.4–25.6) | 9.43× (8.30–11.42) |
| transfer 8 MiB | 208 (166–280) | 20.2 (17.2–25.9) | 10.5× (9.2–12.1) |
| batch (per message) | 30.5 (28.5–41.2) | 0.89 (0.78–0.92) | 35.9× (33.1–46.4) |
| port round trip | 107 (102–139) | 16.1 (14.6–18.5) | 7.66× (6.45–8.36) |
| wait/notify | 31.1 (27.1–39.8) | 13.1 (10.9–14.8) | 2.58× (2.30–2.91) |
| waitAsync | 32.9 (27.7–33.9) | 16.7 (14.7–19.0) | 1.87× (1.81–2.24) |
| counter, 1 Worker (per add) | 2.41 (2.29–2.53) | 0.014 | 171× (159–176) |
| counter, 4 Workers (per add) | 0.81 (0.77–0.84) | 0.020 | 40.6× (37.7–42.2) |

**Lifecycle is already ahead of Node.** Startup, terminate and 8-Worker startup
are about twice as fast.

**Transfer is O(1).** 64 KiB and 8 MiB cost the same. Its constant is 9–11×
Node's.

**Every message path is behind**, and structured clone is far behind.

## Attribution

### Kernels inside a Worker

Worker entries are guest modules. The general (Script) lowering runs them with
JavaScript semantics, even when they and the modules they import are typed.

A probe with typed Worker entries ran the same kernels at 36–124 ms per
iteration inside the Worker. That was a single unlocked run on the Phase 2
tree, so it is indicative only.

### Main thread of a Worker program

The arm64 emitter accepts the generational mutator only when every host
operation is closed-world. Arm64 Worker images were therefore built with the
copying collector.

The same classification switches off these analyses for the whole image:

- list vectors;
- word arguments;
- precise call targets;
- call boundaries;
- record flow;
- stable layouts.

Commit 402d2750a also sets `inlining: "none"` for any image with Worker
functions.

A single unlocked probe classified the isolate operations as closed-world, which
also restores the generational collector. Per iteration, plain vs probe:

| Kernel | Plain (ms) | Probe (ms) |
| --- | ---: | ---: |
| allocation | 24 | 31 |
| calls | 78 | 142 |
| strings | 49 | 52 |
| compiler | 76 | 86 |
| numeric | 71 | 75 |

Most of the `calls` tax was missing closed-world facts. The remaining factor of
about 1.8 is inlining.

### Raw memory

C calls and `tint:ffi` views are not host-call operations, and they keep the
closed world.

The copying fallback that PR #6 reported for `node:crypto` came from its
helper-thread pool. That pool uses `thread-start`, `word-park` and `shared-*`,
the same operations as Workers.

### Transport

pprofessor profiles at 999 Hz cover every thread of symbolized
single-operation images built from the Phase 2 tree. Parked threads also take
samples, so shares below are of the whole run.

- **Small round trip: CPU-bound, not wake-bound.** A round-trip-only run used
  0.32 s of CPU in 0.48 s of wall time for about 3,100 round trips plus
  startup. The CPU goes to two places:
  - the untyped `await` and promise machinery on both sides (async function
    resume, generator steps and job draining);
  - a fresh mapping for every packet: `prepareNativeAgentMessage` calls
    `mapMemory` once per message.
- **Number clones: text encoding.** The clone packet is UTF-16 text and writes
  every number as shortest round-trip decimal. Decoding spent 6.8 s of the
  11.3 s run, and the exact decimal parser (`stringToNumber` and its bignum
  `roundedRatio` and `shift`) took 85% of that.
- **String clones.** The benchmark's untimed payload setup dominated this
  profile. `value += …` up to 1 MiB copies the whole string at each step in
  the general runtime, where V8 uses ropes, so this needs a cleaner profile.
- **Counters: the general path.** The counters run in untyped Worker code at
  about 2.4 µs per `Atomics.add`.

### Collector helper threads

Each generational isolate starts its own parallel-collector helper pool, sized
by the processor count, on its first large collection. Those parked helpers
took most of the samples in the transport profiles.

## Ranked fix plan

| # | Fix | Expected effect | Status |
| ---: | --- | --- | --- |
| 1 | **Typed Worker entries.** Worker entry modules compile through the typed pipeline as deferred start functions in their own isolates. | 50–300× on code inside Workers | Implemented |
| 2 | **Isolate operations in the closed world.** Restores the generational collector and the interprocedural analyses for Worker images and thread-pool images (`node:crypto`). | allocation 3.5× → ~1.3×, calls 13.5× → ~1.8× on the main thread | Implemented |
| 3 | **Inlining within an interruptibility class**, instead of no inlining | The remaining ~1.8× on `calls` | Implemented |
| 4 | **A binary structured-clone format.** Fixed-width numbers with an int32 form; strings copied in bulk; records, arrays and trees without per-field text framing. | Clone, 25–918× | Next |
| 5 | **Per-message costs.** Pooled mailbox pages instead of a mapping per packet; batched wakes. | Round trip, port, batch and transfer | Next |
| 6 | **A typed transport variant**, so runtime messaging is measured separately from untyped `await` overhead | – | Next |
| 7 | **One collector helper pool per process**, serving whichever isolate collects | Thread count with many Workers | Later |

**Typed-pipeline gaps found while writing the kernels:**

- `new Map()` needs explicit type arguments even when the target is typed.
- Pushing a `Map` into a `Map[]` is rejected as "invalid method call".
- A host-bound function cannot be passed as a value ("named function values
  require managed hoisted initialization").

The kernels avoid these constructs. Their owners are the slice 4a streams.
