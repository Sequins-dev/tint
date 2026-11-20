# Event loop, isolates and workers

21 November 2026 · status: **approved by the user (decisions in section 12)**

## Decision

Tint owns the event loop. **Each isolate runs on its own OS thread**, the same model as Node's `worker_threads`. Scheduling multiple isolates on one thread is deferred, and the design keeps that door open (section 10).

This model removes a class of problems that sharing a thread brings with it: stack-switching parks, compiler-inserted preemption checks, and every way C libraries can observe two clients on one thread. C libraries see exactly what they see in Node: one thread per worker.

**Background:** the [async runtime](async-runtime.md), [native agent host](test262-backlog/host-agent.md), [runtime host surface](runtime-host-surface.md), [native FFI](native-ffi.md) and [parallel GC](parallel-gc.md) describe the existing components. Claims marked **(verified)** were checked against the repository's implementation.

## 1. Goals

1. **Tint-owned event loop** for async code, in AOT and live mode. macOS arm64 first, then Linux arm64 and x86-64, keeping a clean platform boundary for Windows later.
2. **A `node:worker_threads`-compatible surface:** `Worker`, `MessageChannel` and `MessagePort`, `parentPort`, `workerData`, transfer lists, `SharedArrayBuffer`, `terminate()`. Each worker keeps Node's event-loop ordering (`nextTick`, microtasks, timers, immediates, I/O). The same API works in the Node-hosted version.
3. **Direct C interop:** the existing FFI layer stays as it is (leaf calls about 1 ns). Callbacks from C work on the isolate's thread. Callbacks from foreign threads work through an explicit opt-in.
4. **Leave room for GC-owned memory backing C pointers,** with a free function run on collection, like V8's cppgc or Node's wrap-with-finalizer.
5. **Performance:** native Tint beats Node. Worker creation and messaging should be cheaper than Node's.

**Non-goals for now:**
- multiple isolates per thread;
- a shared heap across isolates;
- Windows IOCP and io_uring;
- Node addon / libuv-loop compatibility.

## 2. What exists today (verified)

- **`createScriptAgent` already models one ECMAScript agent:** contexts, one job FIFO, weak cells, finalization registries and pending atomic waits ([jobs.ts](../packages/js-runtime/src/objects/jobs.ts)). `await` uses heap continuations ([async-functions.ts](../packages/js-runtime/src/objects/async-functions.ts)). Both are kept.
- **The native Test262 agent cluster already runs one thread per agent**, with its own realm and heap ([agent-lifecycle.ts](../packages/native-runtime/src/agent-lifecycle.ts), [agent-messages.ts](../packages/native-runtime/src/agent-messages.ts)). Its mailbox, raw wake and waiter protocols are reusable. Its policy parts aren't: broadcast acknowledgements, a 1 ms polling loop while waits are pending, and join at test end.
- **The collector's single-mutator rule is per heap,** so concurrent isolates already work.
- **Hosted startup** on both backends builds a private runtime and a guarded managed stack per entry ([AArch64 startup](../packages/codegen/src/aarch64/startup.ts), [x86-64 startup](../packages/codegen/src/x86_64/startup.ts)). C calls run on that stack.
- **FFI callback thread-local state** is bound on first allocation ([`callbackState()`](../packages/native-runtime/src/ffi/index.ts)). Static wrappers already classify calls as leaf or may-callback.
- **Not built yet:** runtime timers, a reactor, the `worker_threads` API and structured clone. The platform I/O surface is synchronous.
- **[Stable external FFI storage](../packages/native-runtime/src/ffi/index.ts)** exists, with memory-pressure accounting. There's no general "free function on collection" queue.

## 3. Model

| Term | Meaning |
|---|---|
| **Isolate** | One ECMAScript agent, on its own OS thread for its whole life. It owns its heap, allocator, roots, module-instance state, realms, job queue, loop-phase state, timers, handles, reactor and managed stack. It has a logical id and generation that don't depend on the OS thread, which keeps later multiplexing possible. |
| **Turn** | One host callback (timer, I/O, message, immediate) run to completion, then its checkpoint: drain `nextTick`, then the microtask FIFO, repeating until both are empty. |
| **Inbox** | The isolate's raw, lock-protected queue. Other threads post here: messages, foreign-thread FFI notifications, cross-isolate atomic notifications, completions. A post also rings the isolate's wake. |

**Invariants:**
- Only the isolate's own thread runs its JS, allocates in its heap or collects it.
- Isolates never exchange managed pointers. They communicate only through copied or transferred messages and shared memory blocks (`SharedArrayBuffer` backing).

## 4. The event loop (one per isolate)

Each isolate thread runs this loop:

1. Run due timers, pending callbacks, I/O callbacks, immediates and close callbacks in Node's phase order, with a checkpoint after each callback.
2. Drain the inbox into the right phase queues: messages, notifications, completions.
3. If nothing is ready and the isolate is still alive, block in the reactor until the next timer deadline.

**Reactor:** one kqueue (Darwin) or epoll instance (Linux) per isolate thread. A control wake (`EVFILT_USER` on Darwin, `eventfd` on Linux) lets other threads interrupt the wait when they post to the inbox. OS calls, structures and error conventions live in the platform adapters ([Darwin host ABI](../packages/platform/src/darwin/host-abi.ts), [Linux host ABI](../packages/platform/src/linux/host-abi.ts)). The runtime owns the policy.

**Timers:** a monotonic min-heap ordered by deadline and insertion sequence. It handles cancellation generations and repeat policy, and doesn't pile up missed interval callbacks after a long turn. Delay coercion and ordering are checked against oracle traces from the pinned Node 26.13.1.

**Ordering** ([existing job FIFO](../packages/js-runtime/src/objects/jobs.ts)):
- A tick queued during a Promise job doesn't jump the remaining microtasks.
- ESM evaluation may already be inside a microtask.
- Immediate-before-timer holds when both are scheduled from I/O.
- Non-Node embeddings (Script/Test262) use a simpler policy over the same driver.

**Liveness:** referenced timers, handles, ports, workers and in-flight operations keep an isolate alive. `unref` removes the hold. A pending Promise alone doesn't keep it alive. The main isolate's exit ends the process, as in Node.

**I/O:** nonblocking handles register with the isolate's reactor. Sync fs and sync child-process calls block the isolate's thread, exactly as in Node, which is fine because the thread belongs to that isolate alone. Async fs operations that the OS can't do nonblockingly go to a small, bounded helper pool. The result is posted back to the inbox.

## 5. Atomics

- **`Atomics.wait`** blocks the isolate's thread through the existing waiter registry ([shared-waiters.ts](../packages/native-runtime/src/shared-waiters.ts)). The registry already guarantees one winner between timeout and notify. The 1 ms polling loop becomes a proper wake.
- **`Atomics.waitAsync`** keeps the isolate runnable. A notify from another isolate posts to its inbox, and settlement happens on the owning thread.
- **Progress** is the OS scheduler's job, as in Node. Spinning Workers and blocked waiters each hold their own thread, so a notifier always gets to run.

## 6. Workers (`node:worker_threads`)

- **`new Worker(...)`** creates an isolate on a new thread from the same image. It evaluates the worker module, then runs its loop. This builds on the existing `runNativeAgent` path and replaces the harness's thread-join assumptions with completion records and `exit`/`error` events.
- **Messaging:**
  - `MessagePort` and `MessageChannel` are built on inboxes.
  - Structured clone is new work and needs sizing.
  - Transferring an `ArrayBuffer` moves its stable external backing in O(1), without copying. This is the same backing future GC-owned C memory needs (section 8).
  - `SharedArrayBuffer` uses the existing shared-block registry.
- **`threadId`** is a stable logical id. **`resourceLimits`** maps onto per-isolate heap and stack limits; Node's covers engine generations, code range and stack, and excludes external data.
- **`terminate()`** stops the worker:
  - A worker blocked in `Atomics.wait`, a sync call or the reactor is woken with a termination outcome.
  - Termination of running JS is checked at existing safepoints: allocation and call GC safepoints, and turn boundaries.
  - An allocation-free, call-free tight loop can't be interrupted without a dedicated check. Section 11 lists this as an open item.

  Termination never kills a thread inside C. It waits for C to return, as Node does.
- **Node-hosted version (verified):** no product pool of Tint isolates exists inside Node today. The proposed adapter: each Tint `Worker` in a Node embedder is one real Node `worker_threads` Worker that loads the Tint AOT artifact. Both hosts share one Worker test suite covering lifecycle, ports, clone/transfer, SAB and termination.

## 7. C interop

C is always called directly on the isolate's thread through the existing FFI layer: same stack, same thread every time, callbacks re-entering nested. A C library sees exactly what it sees in Node. Per-thread state, locks held across calls, thread-keyed registries and thread-exit cleanup all behave as expected. Each worker's thread exits when the worker ends, so TLS destructors run.

| Situation | Behaviour |
|---|---|
| **Leaf and may-callback calls** | Unchanged from today. |
| **Callback from C on the isolate's own thread, outside an FFI call** (strict `node:ffi`, slice 1B) | A trusted outer entry runs the callback synchronously and returns its value. The registration thread is the isolate's thread, so Node's check is exact. Depends on b3 registration. |
| **Callback from one of C's own threads** | Strict `node:ffi` aborts, matching Node 26.13.1. The **Tint opt-in one-way notification** (slice 1A, `void(scalar…)` only) copies the arguments, posts to the isolate's inbox and returns at once. The callback then runs as a turn. |
| **Blocking C** | Blocks the isolate's thread, as in Node. No other isolate is affected. |

The design study measured the alternative of running C on separate threads with callbacks as messages. It costs about 5.6 µs per handoff, against about 1 ns for a direct call. It isn't needed in this model.

## 8. Garbage collection and future GC-owned C memory

- **One heap per isolate,** with the existing collectors. A collection pauses only its own isolate.
- **Parallel GC helper threads** are counted against CPU capacity.
- **A post-GC work sink** runs on each isolate's thread: FinalizationRegistry jobs today, native free functions later.
- **Reserved for later** ([existing external FFI storage](../packages/native-runtime/src/ffi/index.ts)):
  - stable, non-moving payloads owned by movable JS objects;
  - counted handles held by C, like N-API's `napi_ref`;
  - free functions run once after collection on the owning thread, or on a background thread if declared thread-safe, and never resurrecting the owner;
  - tracing C structs from TypeScript interface layouts, which needs explicit edge annotations because C writes bypass the write barrier.

  Thread-per-isolate makes the "required executor" for a free function simply the owning thread.

## 9. Phased plan

Estimates are engineering time for one engineer familiar with Tint, adapted from the studies. They exclude gate queues.

| # | Slice | Delivers | Estimate |
|---|---|---|---|
| 0 | **Baselines** | Isolate + thread creation time and RSS from an AOT image; message round-trip latency; frozen-workload baseline | 3–5 days |
| 1 | **Per-isolate event loop** | Phases and checkpoints; timers; kqueue reactor with control wake, then epoll; ref/unref and liveness; one real nonblocking I/O handle; `waitAsync` and `Atomics.wait` on proper wakes instead of the 1 ms poll | 3–6 weeks |
| 2 | **Product worker lifecycle** | Create and destroy isolates on new threads from one image; completion records; `exit`/`error`; termination at safepoints; both backends | 1–3 weeks |
| 3 | **`node:worker_threads` API** | `Worker`, `parentPort`, `MessageChannel`/`MessagePort`, structured clone, transfer, SAB, `terminate`, `resourceLimits`; Node adapter; shared test suite | 3–6 weeks (structured clone unsized) |
| 1A | **Foreign-thread notifications** | Async FFI callbacks from C threads (Tint opt-in) | 4–8 days, can run in parallel with slice 1 |
| 1B | **Strict same-thread callback entry** | Node-exact `node:ffi` callbacks outside an FFI call | 5–10 days after b3 registration |

**Critical path: 0 → 1 → 2 → 3, roughly 8–16 weeks.** 1A touches different files, so it can run early and unblock async FFI.

Compared with the multiplexed design, this drops the stack-switching park, compiler preemption checks, migration, exclusive placement and per-thread-state declarations. That removes about 5–12 weeks and most of the risk.

## 10. Deferred: several isolates per thread

If thread count or per-worker memory becomes a real constraint, the deferred design is:
- pinned isolates multiplexed per thread;
- an in-place stackful park at runtime wait points;
- compiler preemption checks;
- exclusive placement for C libraries with per-thread state.

**Kept now so it stays possible:**
- isolate identity independent of the OS thread;
- all cross-thread delivery through inboxes, never by running JS on a foreign thread;
- persistent isolate state kept out of frame-relative startup storage where slice 2 touches it anyway.

## 11. Self-review

### Is it sound?

Yes. Every invariant matches an existing, proven model:
- **One mutator per heap.** The collector already relies on this, and concurrent agent heaps already run.
- **One thread per agent.** This is ECMAScript's simplest valid agent mapping, and Node's.
- **Direct C on a dedicated thread.** C sees exactly the Node environment.

All cross-thread interaction goes through inboxes plus a wake, or through `SharedArrayBuffer` under the existing memory model and waiter registry.

**Remaining risks:**

1. **Termination of tight loops.** An allocation-free, call-free loop never reaches an existing safepoint, so `terminate()` can't stop it. Node can, through V8's interrupt checks. **Accepted as a documented gap** (section 12). If it's fixed later, use a termination-only check at loop back-edges, which only throws and unwinds and never resumes.
2. **Wake races.** Posting to an inbox and the target blocking in its reactor must not lose a wake. Use the standard pattern: publish, then signal; the target checks the inbox after arming and before blocking.
3. **Sizing structured clone.** It's a large compatibility surface, and the doc doesn't estimate it yet.
4. **Node phase parity.** Ordering corner cases need oracle traces from the pinned Node, not hand reasoning.

### Will it perform?

- **Synchronous code is unchanged:** no checks or switches are added.
- **Leaf FFI calls are unchanged.**
- **I/O readiness arrives directly on the isolate's own thread.** Only posts from other threads need a wake.
- **Worker creation** costs an OS thread plus isolate initialization. Node's costs a thread plus V8 isolate and Node bootstrap, typically milliseconds and several MB. Tint should win if intrinsics come from image data and code and read-only data are shared. Slice 0 measures it.
- **Memory per worker:** a thread, a guarded managed stack (reserve generously, commit lazily) and a heap. Expected to be comparable to or better than Node; slice 0 measures it.
- **Messaging between workers** costs a copy (or an O(1) transfer) plus a cross-thread wake, about the same as Node.
- **The limit:** thousands of workers mean thousands of threads, as in Node. That's the trigger for revisiting section 10.

## 12. Decisions (user, 2026-11-21)

1. **Termination of tight loops:** accepted as a documented gap for now. Fix it later if it matters.
2. **First real C consumer: OpenSSL.** It's the start of building a Node-equivalent core, beginning with `node:crypto`.
   - It's almost entirely direct leaf calls, which need no new FFI machinery.
   - Its per-thread error queue (`ERR_*`) is safe because each isolate has its own thread.
   - Async crypto (`crypto.pbkdf2`, `scrypt`, `randomBytes` with a callback) uses the bounded helper pool from section 4, with the result posted to the inbox.
   - It needs no libuv loop pointer.
   - Foreign-thread callbacks (1A) and strict outer entry (1B) aren't on its path, so they follow node:ffi b3 instead of blocking this work.
3. **Worker counts and memory per worker:** no limits for now. Slice 0 still records the baselines so regressions are visible.
4. **Compatibility target: match Node's `worker_threads`.** That includes the lifecycle, ports, structured clone, transfer, SAB and event-loop ordering.

   **The motivating use: a multi-threaded compiler.** The compiler can offload parts of compilation to a worker pool and use every core. Because the API matches Node, the same compiler code runs on real `node:worker_threads` while Node hosts the bootstrap, and on Tint's workers in the native self-build. The compiler sources must stay compilable by Tint, so the worker API has to be usable from them.
5. **Node product scope:** the Node-hosted adapter (each Tint Worker is one real Node Worker) follows from 4.

## 13. Follow-on streams

- **Parallel compilation:** a worker pool in the compiler. Candidate stages: per-module parse and check where independent, per-function codegen, and image section emission. It is measured against the single-threaded self-compile (cycles and wall time) and needs byte-identical output, with stage 2 equal to stage 3. It starts after slice 3 lands.
- **`node:crypto` over OpenSSL:** bindings through the existing FFI layer, with async variants on the helper pool. It starts after slice 1 lands.
