# Worker runtime: per-isolate fast heaps and per-entry analyses

22 November 2026 · status: **in progress** (stream `perf/worker-runtime`, PR #15).
Sections 1–4 are implemented; section 5 is partly done.
[Phase 2 results](results/worker-runtime-phase2-v1.md)

## Goal

A program that uses `node:worker_threads` runs its code as fast as the same
code in a program without Workers. Worker startup, messaging and shared memory
are at least as fast as Node 26.13.1. This covers macOS arm64 and Linux arm64,
with x86-64 checked through CI. Parallel compilation is out of scope until this
lands.

User direction (2026-11-22): "You need to make it so it can use the fast GC and
can whole-program optimize per-thread."

The measured starting point is
[the baseline report](results/worker-runtime-baseline-v1.md).

## Model (unchanged)

The [event loop design](design-event-loop.md) runs one isolate per OS thread.

- **Each isolate starts fresh.** A Worker thread enters the image's own hosted
  entry. It builds a new context with its own heap, module instances, realm and
  event loop. The generated host then dispatches on the tagged startup
  argument: `runIsolate(moduleId, …)`.
- **No managed pointer crosses isolates.** Only these cross:
  - structured-clone bytes;
  - transferred `ArrayBuffer` backings, which are stable external storage;
  - `SharedArrayBuffer` blocks;
  - parking words.

  All of them live outside every managed heap.

Both items below follow from those two facts.

## 1. A generational heap in every isolate

**Today.** The AArch64 emitter accepts the generational mutator only when
`stableRecordLayouts` holds: every host operation in the module must be
closed-world.

The Worker runtime uses these operations, and none of them was classified:

- `thread-start`, `thread-join` and `hosted-thread-entry`;
- `word-park` and `word-wake`;
- `shared-*`;
- `memory-unmap`.

So arm64 Worker images were built with `initializeCopyingRuntime`. The x86-64
emitter already accepts any descriptor-preserving operation, and its Worker
images were already generational.

**Change.** These operations are classified as closed-world (section 2). That
also satisfies the generational gate, and each isolate then initializes its own
generational runtime through the image's runtime entry, as on x86-64.

The write-barrier invariant is per heap: every managed reference store into an
old object is remembered. It holds in every isolate for three reasons:

- **The listed operations never write managed memory.** They read and write
  words in non-heap mappings, or start, join or park threads.
- **Each context publishes its own generational state.** The nursery bound sits
  at context +56, and the remembered set and collections belong to that context.
  The collector's single-mutator rule is per heap.
- **Cross-isolate values are copied in by ordinary barriered stores.**
  Structured clone allocates fresh objects in the receiving heap. Transfer
  detaches the sender's `ArrayBuffer` through ordinary field writes, and the
  receiver adopts the external backing in a fresh object. A `SharedArrayBuffer`
  facade is a per-isolate object over an external block.

The x86-64 gate is unchanged. `memory-write-word` and `memory-move` stay out of
both predicates, because they can overwrite any header. The JIT's executable
operations stay out of the arm64 predicate too: live code would have to be
compiled with matching barrier settings, and that is outside this stream.

**Raw memory.** FFI c-calls and `tint:ffi` views are separate IR operations,
not host calls, and an image that uses them already builds with the
generational collector. The baseline's `node:zlib` image measured 0.96–1.04×
the plain program.

The copying fallback that PR #6 reported for `node:crypto` comes from its
helper-thread pool. That pool uses `thread-start`, `word-park` and `shared-*`,
the same operations as Workers, so this change covers it.

## 2. Whole-program analyses per thread entry

**Today.** The interprocedural analyses are list vectors, word arguments,
precise call targets, call boundaries, record flow, reachability and stable
layouts. All of them require `stableRecordLayouts`, so an image that started a
Worker lost them everywhere.

**Roots.** Every isolate enters the program through the same closed root, the
image's `invocation` function. The host's worker dispatch is a static switch
over module indices, so every Worker entry is reachable from that root. The
program's existing closed world is therefore the union of all thread entries.

`thread-start` can only start the hosted entry that `hosted-thread-entry`
returns. The only other way to produce a code address is a capability outside
the closed set (`permanent-function-address` or the `executable-*`
operations), and an image that uses one stays open.

**Facts.** The analyses compute facts over code, and every isolate runs the same
code. No record, list or function value crosses an isolate, so a fact proven
for the union holds in each isolate. Message boundaries are already opaque:
`postMessage` takes `unknown` and structured clone rebuilds values from bytes.

**Later.** Code that several entries share is analyzed under the union of their
facts. If measurement shows that the union loses precision for a hot shared
function, the next step is to specialize per entry: clone such functions per
root set and analyze each clone with its own entry's facts.

## 3. Inlining and stop polls in Worker images

Commit 402d2750a added stop polls to Worker application functions at managed
allocation and call safepoints. To keep runtime helpers free of those polls, it
set `inlining: "none"` for the whole image. As a result, typed code on the main
thread of a Worker program ran without inlining.

The `calls` kernel measured 13.5× the plain program. Restoring the closed-world
facts (section 2) recovers most of that.

**Polls.** Worker functions now poll at each natural loop header and, when
they make calls, on entry. Unbounded execution has to pass one of those points
(a cycle or a recursion), so straight-line code needs none. Polling at loop
headers also stops allocation-free loops, which the event loop design had
listed as a gap. A function whose loops exceed the analysis budget keeps the
per-call polls.

**Inlining.**

- A runtime helper never inlines Worker code; that code would lose its polls.
- Worker code inlines a runtime helper only when the helper has no loop. The
  inliner only takes leaf callees, so a loop-free helper brings no poll site.
- Worker code inlines Worker code freely.

With both rules, every kernel measured 0.98–1.04× the plain program on the
main thread and inside a Worker
([Phase 2 results](results/worker-runtime-phase2-v1.md)).

## 4. Typed code inside Workers

**Today.** Worker modules are guest modules. They go through the general
(Script) lowering even when they are typed TypeScript, and so do the modules
they import. The same typed kernels ran 57–340× slower in a Worker than in the
plain program. This is the largest measured gap. It also breaks the
one-pipeline rule: a typed module behaves as untyped code when a Worker runs it.

**Design.**

1. **Entries.** Worker entry modules join the typed graph as entries, alongside
   the main entry.
2. **Deferred evaluation.** `deferWorkerEvaluation` moves the main entry's
   worker-dependent statements into its start function. This generalizes to one
   deferred scope per entry. A Worker entry gets a synthesized start function
   that holds its top-level statements.
3. **Dispatch.** The host's `runIsolate` calls that function for the matching
   `moduleId`, then runs the event loop, as it already does on the main thread.
4. **Bindings.** The typed `node:worker_threads` facade is already initialized
   in every isolate, before dispatch.
5. **Interruption.** Functions from application modules reachable from a Worker
   entry poll for stop requests, as guest functions do today. Runtime helpers
   stay unpolled.
6. **Shared modules.** A shared module that does not use the Worker bindings is
   an ordinary typed module, instantiated per context. A worker-dependent module
   reachable from two entries is rejected explicitly. That case keeps the
   general guest path until scoped instantiation exists.
7. **Untyped Workers.** An untyped Worker module still lowers through the
   general path, as an untyped main entry does.

## 5. Message path

The baseline profiles attribute the transport costs. The fixes, in order:

1. **Fixed-width clone counts and numbers.** The packet wrote every length,
   count and number as decimal text and parsed it back exactly. Counts now
   take four UTF-16 units, int32 numbers two, and every other number its
   binary64 words. Done.
2. **Linear packet assembly.** The serializer and the receiving mailbox built
   packets through a binary-counter string builder; the mailbox appended one
   single-character string per code unit. Both now collect parts and join
   once, and typed `join` sizes the result in one pass. Done.
3. **Fewer system calls per message.** Done:
   - The registry locks wake only when contended.
   - Port mailboxes recycle up to 32 consumed 16 KiB packet blocks.
   - A sender writes the receiver's signal pipe only when the receiver is not
     already signaled.
4. **Stop polls.** Done. Worker functions poll at natural loop headers, and on
   entry when they call, with a plain load. Polls used to sit before every
   call and allocation. This also stops allocation-free loops, the gap that
   the event loop design listed.
5. **Binary packets.** Done. A message is one native packet: a
   ValueSerializer-style encoding with one-byte tags, varints, bulk binary64
   and UTF-16 copies and back-references, decoded straight into the
   receiver's heap. Small packets share 16 KiB segments with a reference
   count; a large one takes a mapping of its own, and a mailbox keeps one
   warm large mapping for reuse.
6. **Batched delivery.** Done. One I/O task drains the whole queue and
   delivers up to 1,000 packets, with a microtask checkpoint after each. A
   lone primitive encodes and decodes without the reference tables an
   object graph needs; a producer reserves a segment's packet references
   when it opens it, so carving a packet makes no shared update; and an
   atomic-wait checkpoint with nothing pending returns at once.
7. **Wakeups.** Done:
   - On macOS, a zero-timeout `kevent64` is not a poll: a zero timespec
     takes the timed-wait path and reschedules the thread, about 11 µs per
     call. The loop makes that call on every turn that has work queued, so
     each message hop paid it. Zero-timeout polls now pass
     `KEVENT_FLAG_IMMEDIATE` (0.15 µs). Linux's `epoll_wait` with a zero
     timeout is already a true poll.
   - Before a loop blocks, a port that delivered in that turn polls its
     queue for up to 50 µs (bounded by the next timer). While it polls, its
     signal flag tells senders it is awake, so they skip the pipe write. It
     then settles under the queue lock: it schedules queued packets, or
     clears the flag so the next send wakes it. A reply to a message the
     loop just handled usually arrives within the window, so a round trip
     makes no system call. A loop that keeps finding work this way checks
     its descriptors at most once per millisecond.
   - The trade-off is CPU: an idle turn after a delivery spends up to 50 µs
     polling before it parks. Across the transport suite that is about 8%
     more process CPU (2.60 s to 2.81 s, user plus system); a Worker that
     receives one message every 100 ms spends at most 0.05% of a core on
     it. Only a port that delivered in that turn polls, so an idle Worker,
     a timer-driven loop or a loop with no ports never does.
   - The kernel wake itself is not the cost. Two native threads ping-pong in
     5.8 µs per round trip through a pipe watched by `kevent`, 3.9 µs through
     an `EVFILT_USER` trigger (libuv 1.52's `uv_async_send` on macOS) and
     4.6 µs through word park and wake. Ports keep the pipe; with idle
     polling, a steady exchange makes no wake at all.
8. **Typed-native ports.** A typed program's messages still pass through the
   Script realm: the facade calls the realm's `postMessage`, structured clone
   builds realm values, and delivery dispatches realm listeners. Typed ports
   would serialize from typed values and call typed listeners directly.
9. **Untyped await overhead.** This belongs to the untyped runtime stream. The
   typed transport variant measures the runtime's messaging cost without it.

**Typed buffers.** Typed code builds typed arrays over an `ArrayBuffer`:
`new ArrayBuffer(n)`, `byteLength`, and `new T(buffer, byteOffset?, length?)`
for the native element types (Uint8, Uint16, Uint32 and Float64), with the
RangeErrors of a fixed-length buffer. The IR's `array-view` allocates a view
of the target type over the buffer, which the collectors move by its owner's
byte displacement like any view.

- **SharedArrayBuffer.** Typed `new SharedArrayBuffer(n)` creates a
  fixed-length block of the isolate's shared block service and views its
  payload as a borrowed byte array that never moves; views of it behave as
  for an `ArrayBuffer`. The isolate's registry is recorded in its context's
  identity page, which the Worker host fills before any code runs; an
  isolate without a Worker host creates its own service on first use
  (`native-runtime/src/shared-buffers.ts`).
- **Atomics.** `load`, `store`, `add`, `sub`, `and`, `or`, `xor`,
  `exchange` and `compareExchange` on native Uint8, Uint16 and Uint32
  arrays are the IR's `array-atomic`, inline on both backends.
- **Posting.** A typed program's typed array posts as the realm typed array
  it reads as. A typed `SharedArrayBuffer`, or a view of one, shares its
  block: the Worker host finds the block by the buffer's payload address.
  Other buffers are copied.
- **Receiving.** A realm typed array passed to a native typed-array
  parameter, or narrowed by `instanceof` before `Atomics`, is viewed
  natively (`projectNativeTypedArray`): over an ordinary buffer's backing
  or over a shared block's payload. A view over an ordinary buffer observes
  the buffer's detachment, by a transfer to a Worker or by
  `ArrayBuffer.prototype.transfer`, as a realm typed array does: its length
  becomes 0, element reads give undefined, writes are ignored, and `Atomics`
  and the validating methods throw TypeError (docs/unified-pipeline.md).
  Shared-block views never detach and stay direct. Resizable buffers,
  length-tracking views and growable shared buffers have no fixed native
  window and keep the TypeError.
- Still open: the signed element types (`Int8Array` to `BigUint64Array`,
  PR #17) and with them typed `Atomics.wait` and `notify`; and narrowing an
  `unknown` to the typed `SharedArrayBuffer` type, so typed code receives a
  realm SharedArrayBuffer itself rather than a typed array over it.

**Later: one collector helper pool per process.** Each generational isolate
starts its own pool of parallel-collector helpers, which multiplies threads
when a program runs many Workers. A single process-wide pool could serve
whichever isolate collects.

## 6. Shared memory and isolate boundaries

With the analyses and inlining back on, the optimizer sees code that touches
memory another thread mutates. Three invariants keep that sound; the
[soundness report](results/worker-runtime-soundness-v1.md) has the fixtures
and their results.

**No shared access is cached, moved or removed.**

- Every realm `SharedArrayBuffer` access, plain or `Atomics`, reaches a
  `shared-*` host operation through `SharedBlockService`. Realm shared
  storage never exposes a byte array, so no realm path loads it inline.
- `instructionEffects` gives every host call unknown effects. GVN, LICM,
  store forwarding and dead-code elimination therefore treat each access as
  reading and writing all memory, and no other memory operation moves across
  it. The inliner does not inline a callee that contains one.
- Neither backend schedules instructions. On arm64 each access is a call to an
  out-of-line leaf; on x86-64 it is an inline sequence.
- Typed code views a block's payload directly. Its plain element accesses
  are unordered accesses, ordinary loads and stores optimized like any
  typed-array access. No pass introduces a read or a write, so the
  transformations are those the memory model allows for data races. A typed
  `Atomics` operation is an `array-atomic`, whose effects read and write
  the whole heap: no access merges with it or moves across it.

**Atomics are barriers.** A seq-cst access compiles to
`dmb ish; ldar|stlr; dmb ish` on arm64, and compare-exchange is a fenced
`ldaxr`/`stlxr` loop. On x86-64 a seq-cst store is `xchg`, compare-exchange is
`lock cmpxchg`, and loads are `mov`: the standard TSO mapping. Unordered
accesses are plain loads and stores on both.

**No heap pointer crosses an isolate.**

- In a Worker program, the realm's buffer allocator maps every `ArrayBuffer`
  backing outside the managed heap and tracks it with a weak slot. Transfer
  moves the mapping's address to the receiver, which adopts it in a fresh
  object. A clone copies the bytes into a new mapping.
- Structured clone rebuilds every other value from packet bytes in the
  receiving heap.
- `node:zlib` runs synchronously in the calling isolate. Blocking-pool helpers
  are separate hosted isolates that exchange strings through mapped mailboxes.
  PR #6's `node:crypto` jobs pass the helper only the address of a `tint:ffi`
  allocation. The submitting isolate owns that allocation until the reply
  and copies the result into its own heap.

## Validation

Every change must keep:

- byte-identical output for programs that start no Worker and use no
  isolate operation;
- self-build stage 2 = stage 3;
- the native Worker fixtures (suite, messages, ports, clone, backing, exit,
  safepoints, compiler, memory model, ordering litmus, transfer and zlib
  stress) at exit 42 under LLDB;
- Test262's agent and Atomics selections without regressions;
- green CI on all three targets.

Each fix carries a paired, rotated benchmark against the
[baseline](results/worker-runtime-baseline-v1.md).
