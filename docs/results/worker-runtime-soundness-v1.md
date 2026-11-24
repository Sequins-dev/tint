# Worker runtime soundness: shared memory and isolate boundaries

22 November 2026. With the
[Worker runtime changes](../design-worker-runtime.md), threaded images keep the
whole-program analyses and inlining, and each isolate has its own generational
heap. This report checks three properties:

- **(a)** no optimization caches, forwards, hoists or eliminates a shared
  access across an `Atomics` operation, a call or a loop back-edge;
- **(b)** `Atomics` operations compile as the required barriers on arm64 and
  x86-64;
- **(c)** no heap pointer crosses an isolate.

It then compares Test262's `Atomics` (including every agent test) and
`SharedArrayBuffer` selections with main.

**Images.** All images are built from `f5400a5ee` (clean tree) unless noted
and run under LLDB, which had to report the stop at entry and exit 42. The
[final-head runs](#final-head) repeat them at `6263c2571`, after merging main.

| Target | Host |
| --- | --- |
| macOS arm64 | Apple host |
| Linux arm64 | Shared `dev` machine (Debian 12, kernel 6.1, 9 CPUs) |
| Linux x86-64 | Debian 13 VM under QEMU TCG emulation, 8 vCPUs |

## Why the optimizer cannot move shared accesses

Section 6 of the design states the argument. In short:

- Every shared access is a `shared-*` host call.
- Host calls have unknown effects.
- The inliner does not inline a callee that contains one.
- Neither backend schedules instructions.
- Typed code cannot reach a `SharedArrayBuffer`.

The fixtures below test the outcome under real concurrency. They do not rely
on that argument.

## (a) Litmus tests through Workers

`tools/worker-memory-model.mjs` runs as an untyped program with Workers, built
by `tools/build-worker-memory-model-fixture.ts`. The same source passes under
Node (`tools/worker-memory-model.test.ts`). It checks five behaviours.

**Spins.**

- Two threads alternate turns 20,000 times by spinning on `Atomics.load`.
- One spin is an inline loop whose body is the load and a counter. The other
  spins in a helper function, which inlining exercises.
- Each spin stops after a fixed count, so a hoisted or cached load fails
  instead of hanging.

**Plain data published by `Atomics.store`.** On every turn the writer makes 16
plain `Int32Array` stores and one plain `Float64Array` store before its
`Atomics.store`. The reader checks all of them after its `Atomics.load`.

**Store buffering.**

- Two threads each run 40,000 rounds of an `Atomics.store` followed by an
  `Atomics.load` of the other thread's word.
- The outcome where both loads read 0 is forbidden, and must never occur.
- A plain-access variant runs as a control.

**Counters.** Four Workers each run 20,000 rounds of:

- `Atomics.add` and `Atomics.sub` on `Int32Array`;
- `Atomics.add` on `BigInt64Array`;
- compare-exchange retry loops on `Uint8Array` and `Uint16Array`;
- plain read-modify-writes on a `Float64Array` and an `Int32Array`, inside a
  compare-exchange spinlock released by `Atomics.store`.

**Wait and notify.** 4,000 rounds of a plain write, `Atomics.store` and
`Atomics.notify`. The waiter wakes and reads the plain data.

| Target | Result |
| --- | --- |
| macOS arm64 | exit 42: all counts exact, 0 forbidden store-buffering outcomes |
| Linux arm64 | exit 42: all counts exact, 0 forbidden |
| Linux x86-64 | exit 42: all counts exact, 0 forbidden |

The plain store-buffering control showed no relaxed outcome natively; Node
shows about 75 in 40,000 rounds. A plain element access on a
`SharedArrayBuffer` reads the block length with seq-cst order before it touches
the element, because `bufferStorageWindow` defaults to `seq-cst`, so each
access is fenced. That is stronger than the specification requires, and costs
two `dmb ish` per access on arm64; it is listed under follow-ups. The
leaf-level litmus below shows reordering without that fence.

## (b) Barriers

**Instruction tests.**

- `packages/codegen/test/scalar-shared-memory.test.ts` runs the arm64 leaves on
  a model machine.
  - A seq-cst load or store is fenced on both sides: `dmb ish`, `ldar|stlr`,
    `dmb ish`.
  - An unordered access is a plain `ldr`/`str` without a fence.
  - Compare-exchange is a fenced `ldaxr`/`stlxr` loop that clears the exclusive
    monitor on a mismatch.
  - The ordered-load fence assertion is new.
- `packages/codegen/test/x64-shared-memory.test.ts` (new) emits every x86-64
  shared operation.
  - Seq-cst stores are `xchg` at every width, and unordered stores are `mov`.
  - Compare-exchange is `lock cmpxchg`.
  - Loads are `mov`, and a load never stores to the cell.
  - Mutation check: with ordered stores rewritten to `mov`, the store test
    fails.

**Leaf-level litmus on hardware.** `tools/build-shared-ordering-litmus-fixture.ts`
races two native threads directly on the shared access leaves.

- The racing words sit on separate 128-byte lines, with nothing but the leaf
  between the racing accesses.
- Each phase runs 200,000 rounds, once seq-cst and once unordered.
- The two tests are:
  - **Store buffering:** both loads read 0.
  - **Message passing:** a data store, then a flag store, against a flag load,
    then a data load. The forbidden outcome is a stale data read after the
    flag is seen.

| Target | Store buffering, seq-cst | Store buffering, unordered | Message passing, seq-cst | Message passing, unordered |
| --- | ---: | ---: | ---: | ---: |
| macOS arm64 (3 runs) | 0 | 5, 6, 8 | 0 | 11,054; 13,156; 10,845 |
| macOS arm64, `6263c2571` | 0 | 3 | 0 | 4,522 |
| Linux arm64 | 0 | 26 | 0 | 29,033 |
| Linux arm64, `6263c2571` | 0 | 19 | 0 | 18,457 |
| Linux x86-64 (TCG) | 0 | 0 | 0 | 0 |

The unordered phases show that the test observes real hardware reordering on
arm64, and the seq-cst phases never show it. Two earlier macOS runs, with a
narrower delay sweep, saw store-buffering 0 and 0 unordered and message-passing
5,113 and 34,592 unordered.

On x86-64:

- TSO forbids message-passing reordering, so 0 is expected for both orders.
- TCG emulates x86 ordering conservatively and showed no store-buffering
  reordering either.

So the x86-64 run shows only that seq-cst never failed. The instruction test is
the x86-64 barrier evidence.

## (c) Isolate boundaries

**Transfers and clones during collections.** `tools/worker-transfer-stress.mjs`
runs as an untyped program.

- Each of 240 rounds transfers one `ArrayBuffer` (16 B to 1 MiB) and clones
  another.
- The receiver verifies both, mutates the transferred one in place and returns
  it, with a fresh buffer of its own.
- Both isolates churn 3,000 records per round, retaining a rolling set so that
  objects are promoted.
- The sender keeps using its clone while the Worker checks its copy.
- Each side keeps 24–48 received buffers and verifies them again at the end.
- Transferred buffers must be detached in the sender.

A debug-symbol build of the same source counted calls to the generational
`collect` under LLDB: **1,608 on the main thread and 1,420 in the Worker**,
with exit 42. The release image exits 42 on macOS arm64, Linux arm64 and Linux
x86-64.

**zlib under the same churn.** `tools/build-worker-zlib-stress-fixture.ts` runs
a typed main entry and a typed Worker entry, with no general fallback.

- Each isolate runs 240 `node:zlib` deflate/inflate round trips (16 B to
  256 KiB) under the same churn.
- Each keeps 24 outputs and verifies them again at the end.
- The debug build counted **102 collections in each isolate**.
- It exits 42 on macOS arm64 and Linux arm64.
- `node:zlib` does not yet resolve for x86-64 (`UNDECLARED_IMPORT: tint:c/zlib`),
  so the x86-64 image cannot be built.

**Helper threads.**

- `node:zlib` has none: it runs in the calling isolate.
- The blocking pool on main has one fixture user. Its helpers are hosted
  isolates that exchange strings through mapped mailboxes.
- PR #6's `node:crypto` pool is not on main or this branch.
  - Its jobs pass the helper only the decimal address of a `tint:ffi`
    allocation.
  - The submitting isolate owns that allocation until the reply.
  - The result is copied into a fresh managed array on the owner's thread.
- No heap pointer reaches a helper thread.

## The MessageChannel fault

**Symptom.** The native transport benchmark faulted at Worker exit on
`34a2fde64`.

- macOS: 1 of 15 rotated rounds.
- Linux arm64: 15 of 15.
- The fault was `EXC_BAD_ACCESS` in the `shared-read-word64` leaf, reading an
  unmapped packet block during the transferred `MessageChannel` port phase.
- The failed runs are kept in the
  [Linux report](worker-runtime-linux-v1.md#failed-observations).

**Root cause.** Packet blocks are recycled through a free stack.

- A recycled block keeps its free-stack link in header word 0, which the
  message queue also uses as its next pointer. A fresh mapping is zero-filled.
- When a recycled block carried the last queued message, the receiver followed
  the stale link into the free stack.
- That corrupted the queue until blocks were reused and unmapped twice.
- Disabling recycling removed the fault.

**Fix.** `8d112612d` clears the word when a packet is prepared in a recycled
block. `tools/native-agent-messages.test.ts` reuses several blocks in one burst
and fails without the fix.

**Native fixture.** `tools/build-worker-port-recycling-fixture.ts` (new)
repeats the benchmark's sequence in each of eight Worker lifetimes:

- 4 bursts of 256 messages on `parentPort`, each followed by 64 single round
  trips that travel in recycled blocks;
- the same on a transferred `MessageChannel` port, which is then closed;
- the same again on `parentPort`, then Worker exit, which releases both
  mailboxes.

| Built from | Result |
| --- | --- |
| `34a2fde64` (the defect) | `EXC_BAD_ACCESS` in `shared-read-word64`, 3 of 3 runs |
| `6263c2571` | exit 42 on macOS arm64 and Linux arm64 |

## Final head

At `6263c2571` (this branch merged with main `a85173493`):

- All 14 native Worker fixtures exit 42 under LLDB on macOS arm64 and Linux
  arm64:
  - the suite, typed entry, messages, ports, clone, backing, exit, safepoints
    and compiler fixtures;
  - the memory model, ordering litmus, transfer stress, zlib stress and port
    recycling fixtures.
- The soundness fixture images hash the same as their `f5400a5ee` builds:
  main's live-in rows change no output.
- The no-Worker benchmark image is byte-identical between main `a85173493` and
  this head: `04845cd33e69bdcb…` on macOS arm64 and `e67a410c6ce83cfe…` on Linux
  arm64.
- Self-build: stage 2 = stage 3 (`db7a8cf6e117…`).

## Test262

<!-- filled after the runs -->

## Typed-pipeline gaps found

Writing the typed zlib stress hit four gaps. Each one rejected the build, so
none was silently worked around:

- a `.length` read on an `ArrayBuffer[]`;
- an element store into an `ArrayBuffer[]`, which the checker expects to be a
  numeric typed array;
- `new Uint8Array(buffer)` over an `ArrayBuffer`, which requires the realm
  constructor;
- posting a typed-code `Uint8Array`, which throws `DataCloneError` natively
  but works under Node.

As a result, typed code cannot carry bytes between isolates yet. Separately, an
untyped program that imports `node:worker_threads` lowers as general code, and
general code cannot reach `node:zlib`'s C bindings.

## Follow-ups

- **Plain `SharedArrayBuffer` element access:**
  - `typedArrayWindow` captures the block length with seq-cst order by default
    (two `dmb ish` on arm64).
  - Every access allocates scratch typed arrays.
  - The specification requires only an unordered length read for element
    access.
- **Typed-pipeline gaps:** the four above.
