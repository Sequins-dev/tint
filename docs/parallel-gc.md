# Parallel collection

Status: implemented for the generational runtime
(`packages/native-runtime/src/tracing/parallel.ts`, used by
`packages/native-runtime/src/generational.ts`). Extends the
[lifetime contract](memory-and-lifetimes.md).

## Motivation

On the `v2` frozen workload (the compiler compiling itself), the serial
collector takes 11.4% of samples, about 7 s of a 62 s run. The write barrier
takes a further 5.8%. Node finishes the same work in 36 s. Its cycle count is
similar to ours, but its collector and JIT use helper threads. Parallel
stop-the-world collection takes most of that pause time out of wall time without
changing the mutator.

## Scope

- In scope: minor nursery evacuation runs on a pool of helper threads. The
  mutator thread takes part as worker 0. The pool has at most six workers,
  fewer when the process may use fewer CPUs (affinity mask and cgroup v2
  `cpu.max`, queried when the runtime initializes; see
  [the Linux contract](linux-aarch64-target.md#collector-parallelism)); a
  single CPU keeps collections serial. Majors compact the space in place
  (mark-compact; see `createCompactor` in `tracing/cheney.ts`), marking and
  forwarding on the same pool. Weak slots are processed on the pool too
  ([weak slots](#weak-slots)).
- Out of scope for now: concurrent marking, scheduling contexts across threads
  and idle-time collection. The design keeps them possible (see
  [Portability](#portability)).

## Portability

The collector never reads process-wide or mutator-thread state. A collection is
described by two kinds of state:

- **A raw shared record** in its own mapping. It holds the worker closure's
  address, the epoch and command words, active and finished counters, the
  failure word, the destination cursor, the remembered-set chunk cursor, and a
  segment stack guarded by a spin lock.
- **Permanent per-worker state records**, created from control memory while the
  runtime initializes. Each holds a worker's source and destination windows, its
  LAB and its scan pointer.

The requesting thread captures the root head (the stack-map registry, with its
own frame as the walk start) and writes each collection's parameters before it
publishes the epoch.

The worker closure is also created during initialization, so it is permanent.
It captures only these records, the start bitmap and the remembered set. A pool
thread can therefore evacuate any heap whose owner is stopped at a safepoint. A
later scheduler that parks contexts can hand an idle context's heap to the same
pool without changing the collector.

Worker-reachable code never allocates, never touches the mutator's managed
objects and never writes module state.

## Primitives

New trusted host operations. The raw-word atomics share the `memory-read-word`
window contract and validation, and return the word observed before the
operation, or -1 when invalid:

| Operation                                       | AArch64              | Use                                                 |
| ----------------------------------------------- | -------------------- | --------------------------------------------------- |
| `memory-compare-exchange-word`                  | `ldaxr`/`stlxr` loop | claim an object; the segment-stack lock             |
| `memory-fetch-add-word` (signed delta)          | `ldaxr`/`stlxr` loop | claim destination space and remembered-set chunks   |
| `memory-load-acquire-word`                      | `ldar`               | observe a forwarded header, the epoch, termination  |
| `memory-store-release-word`                     | `stlr`               | publish a forwarded header; unlock                  |
| `collector-worker-entry`                        | address              | the worker thunk                                    |
| `permanent-function-address` / `-array-address` | address              | the worker closure; the start bitmap for atomic ORs |

The pool also reuses `thread-start`, `word-park`/`word-wake`, `cpu-pause` and
`shared-compare-exchange-unsigned`.

The startup thunk `tint:collector-worker-entry` is emitted only when an image
imports it. It is a raw pthread entry: it builds a hosted context on the
thread's own stack and calls the closure stored in word 0 of its argument. That
context has a stack limit 256 KiB below its entry, no stack-map registry, no allocator
and no domain. An attempted allocation therefore faults immediately. The thunk
shares nothing with `hosted-thread-entry`, which builds a whole new heap.

## Evacuation protocol

The object header is two words: `marker` (layout or descriptor) and `flags`.

1. Read `flags` with acquire semantics.
   - If it is `FORWARDED`, `marker` holds the destination.
   - If it is `CLAIMED`, spin until it becomes `FORWARDED`.
2. Otherwise compare-and-exchange `flags` from its observed value to `CLAIMED`.
   A worker that loses the race goes back to step 1.
3. The winner reserves destination space, copies the object, restores the
   original `flags` in the copy and sets its start bit. It then performs the
   per-kind fixups: an inline array's data pointer, or a view's owner and data
   offset. A view's owner is evacuated recursively, and the acquire in step 1
   orders the owner copy's data pointer before it is read.
4. The winner writes `marker := destination`, then store-releases
   `flags := FORWARDED`.

## Allocation

- Each worker copies objects of up to 1 KiB into a 32 KiB local allocation
  buffer (LAB), claimed from the shared cursor with fetch-add. Larger objects
  are reserved exactly from the cursor, then exported for scanning once copied.
- Reservations are exact, with no alignment padding.
- Start-bit words strictly inside the current LAB have a single writer and are
  updated plainly. Every other word may be shared with a neighbouring LAB, a
  large object or old objects, and is updated with a 32-bit compare-exchange.
- A LAB retires only when an object of at most 1 KiB does not fit, so its
  unused tail stays a hole of under 1/32 of the LAB. Nothing walks survivor
  space linearly, because start bits identify objects.
- **Space check:** a collection runs in parallel only if its survivor limit plus
  1/30 waste plus one LAB per worker fits the destination. Otherwise it falls
  back to the serial Cheney collector.
  - Minors use the nursery size as the survivor limit.

## Work distribution and termination

- Each worker Cheney-scans its own LAB, advancing its scan pointer past an
  object before scanning it.
- A retiring LAB exports its unscanned remainder as a segment. While other
  workers are hungry, a worker also exports 4 KiB or more of local work every
  32 objects.
- Worker 0 walks the requesting thread's stack (its stack maps). Every worker claims remembered-set chunks of
  256 entries, or after an overflow 4096 dirty-card bytes, by fetch-add.
- **Termination:**
  - A worker decrements the active count only after it fails to pop a segment.
  - An idle worker increments the count again before popping, and only after it
    sees a segment.
  - So an active count of 0 means no segment can appear, and every worker
    returns.
- Between collections, workers park on the epoch word.

## Weak slots

Weak cells (WeakRef, FinalizationRegistry, WeakMap/WeakSet backing,
`tint:ffi`'s `external`) keep both parallel phases; the rules are those of
[weak cells](memory-and-lifetimes.md#weak-cells), applied per worker:

- **Evacuation (minors).** A weak slot is copied like any object, but its key
  and value are not scanned. Its winner links it into one of two per-worker
  lists through the source copy's first payload word, which nothing reads
  once the forwarded header is published: ephemerons whose values are not
  yet traced, and every other slot. The lists need no storage and cannot
  overflow. Remembered old slots are scanned strongly, as in the serial minor
  (their keys are old).
- **Mark (majors).** A marked weak slot is recorded in its marker's bounded
  list (65,536 entries per worker, mapped once), with pending ephemerons kept
  as a prefix.
- **Ephemeron rounds.** After the strong closure, each round wakes the pool:
  every worker traces the values of its own pending ephemerons whose keys
  are live (evacuating or marking them), moves those out of the pending
  list, and then the pool drains as in the main phase. Rounds repeat until
  one traces nothing. A round cannot miss a key that becomes live while it
  runs: keys become live only through tracing, and a round that traced
  anything is followed by another. Weak slots copied or marked during a
  round join their worker's lists for the next one.
- **Clearing.** The requesting thread then walks every list: a dead key
  clears both pairs, a weak cell drops its value pair, and live keys of
  copied slots are updated to their destinations.
- **Fallback.** A full mark list or an overflowed mark stack (during the mark
  or a round) leaves weak processing to the compactor's serial fixpoint after
  its rescan, which visits every live slot; the parallel mark and forwarding
  are kept.

Ephemeron rounds run on the pool rather than as a serial post-pass on the
requesting thread: on a WeakMap/WeakRef-heavy benchmark (`tools/gc-weak-bench.ts`)
the pool rounds took 1.51 s against 1.80 s (serial rounds) and 2.65 s
(serial collection before this change), at 4-15% more cycles; see the
[experiments table](native-performance-analysis.md#experiments).

## Failure

A worker invariant failure is fatal:

- The worker records a failure code and stops.
- Every spin-wait checks the failure word, so no worker waits forever on an
  object that a failed worker claimed.
- Worker 0 throws once every worker has finished. A partially moved heap is
  never resumed.

## Measurement

Collector code is runtime source. Build with
`frozen-workload.ts build <name> <label> --runtime-tree` to replace the
snapshot's runtime files with the tree's. The snapshot's catalog also selects
the program's input files, so it is never changed. New runtime files need a
fresh freeze; `v2` was frozen with `parallel.ts`.

On `v2` (frozen 2026-11-13; outputs byte-identical to the serial build and to
Node):

| Build                        | Wall   | Cycles      |
| ---------------------------- | ------ | ----------- |
| serial                       | 61.6 s | 264G        |
| 6 workers, aligned LABs      | 58.7 s | 276G        |
| 6 workers, exact LABs        | 57.2 s | 287G        |
| 4 / 10 workers, exact LABs   | 57.4 s | 277G / 315G |
| 6 workers, busy-wait workers | 73.1 s | 1560G       |
| Node                         | 35.7 s | 251G        |

Findings:

- **Alignment waste forced serial majors.** With 512-byte-aligned LABs and
  rounded large objects, the conservative space check rejected every major.
  Exact reservations fixed that.
- **Collections are short.** The median pause is about one 1.5 ms sample, and
  workers are still waking at the start of nearly every pause.
- **Worker count barely matters.** Collection CPU is about 1.55× the serial
  collector's, from per-object atomics and cross-core cache traffic.
- **Busy-waiting is worse.** Spinning workers slow the mutator, which shares the
  cluster's clock and memory system.

## Later work

- Cheaper per-object evacuation; the per-call prologue cost dominates the
  profile.
- Parallel marking and reference updating for the mark-compact major, and
  a non-moving (mark-region) old space with selective evacuation.
- Concurrent old-generation marking (snapshot-at-the-beginning, extending the
  existing barrier). This would break the single-mutator, collect-on-request
  invariant that C leaf FFI calls rely on (see
  [memory-and-lifetimes.md](memory-and-lifetimes.md#single-mutator-collection-on-request));
  it needs a replacement contract for leaf calls first.
- Idle-time collection through a context scheduler, using the same records and
  pool.
