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
5. **Packed small packets.** Every tiny packet still takes its own 16 KiB block,
   and a burst longer than the recycle bound falls back to one mapping per
   message. The plan is to append small packets to shared mailbox pages and
   recycle a page once it drains.
6. **Typed-native ports.** A typed program's messages still pass through the
   Script realm: the facade calls the realm's `postMessage`, structured clone
   builds realm values, and delivery dispatches realm listeners. That layering
   is most of the remaining per-message user time. Typed ports would serialize
   from typed values and call typed listeners directly.
7. **Bulk packet copies.** A packet still crosses one code unit per host call.
   The plan is to copy through `tint:c/memory` (`memcpy`) or a wider
   shared-memory operation.
8. **Untyped await overhead.** This belongs to the untyped runtime stream. The
   typed transport variant measures the runtime's messaging cost without it.

**Typed SharedArrayBuffer.** Typed code cannot create a `SharedArrayBuffer`
yet: the program realm does not install the global. Until it does, typed
shared memory and typed `Atomics` stay unmeasured.

**Later: one collector helper pool per process.** Each generational isolate
starts its own pool of parallel-collector helpers, which multiplies threads
when a program runs many Workers. A single process-wide pool could serve
whichever isolate collects.

## Validation

Every change must keep:

- byte-identical output for programs that start no Worker and use no
  isolate operation;
- self-build stage 2 = stage 3;
- the native Worker fixtures (suite, messages, ports, clone, backing, exit,
  safepoints, compiler) at exit 42 under LLDB;
- Test262's agent and Atomics selections without regressions;
- green CI on all three targets.

Each fix carries a paired, rotated benchmark against the
[baseline](results/worker-runtime-baseline-v1.md).
