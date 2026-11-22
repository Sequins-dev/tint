# Worker runtime: per-isolate fast heaps and per-entry analyses

22 November 2026 · status: **in progress** (stream `perf/worker-runtime`, PR #15)

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

## 3. Inlining in Worker images

Commit 402d2750a added stop polls to Worker application functions at managed
allocation and call safepoints. To keep runtime helpers free of those polls, it
set `inlining: "none"` for the whole image. As a result, typed code on the main
thread of a Worker program ran without inlining.

The `calls` kernel measured 13.5× the plain program. Restoring the closed-world
facts (section 2) recovers most of that; missing inlining accounts for the
remaining factor of about 1.8.

**Rule.** An inlining candidate must be in the same interruptibility class as
its caller. Application code can then inline application code, and runtime code
can inline runtime code. A helper is never inlined into an interruptible
function, and the reverse never happens either.

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

The baseline ranks the transport costs. The profiles in the report attribute
them, and fixes follow in that order.

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
