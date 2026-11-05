# HOST-AGENT: `$262.agent`, real Atomics waiting and agent contexts

Status: **missing**. Plan ready. Backlog entry: [README](README.md). This is a
documentation-only plan captured on 2026-11-04 from source, the pinned Test262
checkout (`91c7075…`) and primary specifications. It contains no run evidence.
The parent owns integration and native validation.

## 1. Population and current evidence

Counts come from a read-only scan of `.tint-bootstrap/test262/test` (frontmatter
stripped; one variant for `onlyStrict`/`noStrict`/`raw`/`module`, else two).
These are populations, not expected gains. Rows overlap and must not be summed.

| Selection                                          | Files / variants | Current native evidence                                                                                                                                              | Slice      |
| -------------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| **Owned:** files using `$262.agent`                | 112 / 224        | All include `atomicsHelper.js`, which calls `$262.agent.getReport.bind` at load, so every one is a harness error today                                               | A1–A5      |
| — `Atomics/wait`                                   | 43 / 86          | [family v1](../results/test262-atomics-family-native-v1.json) (stale: predates immediate waits)                                                                      | A2, A3, A5 |
| — `Atomics/waitAsync`                              | 53 / 106         | [waitAsync v1](../results/test262-wait-async-immediate-native-v1.json): exactly its 106 harness errors                                                               | A1–A5      |
| — `Atomics/notify`                                 | 16 / 32          | family v1 (stale)                                                                                                                                                    | A3, A5     |
| Owned subset: `$262.agent` without `start`         | 3 / 6            | `waitAsync/{,bigint/}true-for-timeout.js`, `waitAsync/returns-result-object-value-is-promise-resolves-to-timed-out.js`: need `monotonicNow` and timeout jobs only    | A1         |
| Owned subset: `start` with static source only      | 3 / 6            | `wait/good-views.js`, `waitAsync/good-views.js`, `waitAsync/bigint/good-views.js`: report/leaving, no broadcast, no parking                                          | A2         |
| **Dependent, not owned:** single-agent parking     | 4 / 8            | waitAsync v1's eight `unsupported` rows: `{,bigint/}undefined-for-timeout`, `implicit-infinity-for-timeout`, `returns-result-object-value-is-promise-resolves-to-ok` | A1         |
| Dependent: non-agent `wait` / `notify` files       | 34 / 68, 36 / 72 | Unmeasured since immediate waits. `wait/true-for-timeout.js` (`CanBlockIsTrue`) needs a real 1 ms timed park                                                         | after A1   |
| Not this row: other `Atomics`, `SharedArrayBuffer` | —                | Non-waiting methods 314/318 ([atomics.md](../atomics.md)); SAB has no agent use                                                                                      | —          |

The 112 agent files make 120 `start` calls. **117 pass a template literal with
`${…}` substitutions** (`${WAIT_INDEX}`, `${TIMEOUT}`, …); only the three
`good-views` files pass a substitution-free literal. 22 files start 2–4 agents
(`NUMAGENT`). No agent file carries a `CanBlock*` flag; the nine flagged Atomics
files are non-agent `wait` tests. **No whole-suite percentage is stated.**

## 2. Specification and host contract

| Source                                                                                                                                                                                                                                                                                                                                     | Plan rule                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Agents](https://tc39.es/ecma262/multipage/executable-code-and-execution-contexts.html#sec-agents), [Forward Progress](https://tc39.es/ecma262/multipage/executable-code-and-execution-contexts.html#sec-forward-progress)                                                                                                                 | An agent owns its contexts, Agent Record and executing thread. Agents with `[[CanBlock]]` true need a **dedicated** thread, and every unblocked agent must progress. `[[Signifier]]` is unique in the cluster and immutable.                                                                                                         |
| [DoWait](https://tc39.es/ecma262/multipage/structured-data.html#sec-dowait)                                                                                                                                                                                                                                                                | ValidateIntegerTypedArray, SAB check, ValidateAtomicAccess, ToInt32/ToBigInt64, ToNumber(timeout), AgentCanSuspend; **then** allocate capability and result object; **then** EnterCriticalSection, seq-cst read, compare, AddWaiter, suspend or schedule the timeout. Async `t = 0` fails fast.                                      |
| [SuspendThisAgent](https://tc39.es/ecma262/multipage/structured-data.html#sec-suspendthisagent)                                                                                                                                                                                                                                            | Leaving the critical section and suspending is one combined operation, so an intervening notification is not lost. Wake only by timeout or NotifyWaiter.                                                                                                                                                                             |
| [NotifyWaiter](https://tc39.es/ecma262/multipage/structured-data.html#sec-notifywaiter), [EnqueueResolveInAgentJob](https://tc39.es/ecma262/multipage/structured-data.html#sec-enqueueresolveinagentjob), [HostEnqueueGenericJob](https://tc39.es/ecma262/multipage/executable-code-and-execution-contexts.html#sec-hostenqueuegenericjob) | Blocking waiter: wake its agent. Same-agent async waiter: resolve now. Other-agent async waiter: enqueue a job **in the owning agent**. "An agent must not access another agent's promise capability … beyond passing it to the host."                                                                                               |
| [EnqueueAtomicsWaitAsyncTimeoutJob](https://tc39.es/ecma262/multipage/structured-data.html#sec-enqueueatomicswaitasynctimeoutjob), [Atomics.notify](https://tc39.es/ecma262/multipage/structured-data.html#sec-atomics.notify), [GetWaiterList](https://tc39.es/ecma262/multipage/structured-data.html#sec-getwaiterlist)                  | The timeout job re-enters the critical section and acts only if the record is still listed. Notify removes up to `count` waiters FIFO and returns how many. The list key is `(block, byteIndex)`, independent of view width.                                                                                                         |
| [INTERPRETING.md](https://github.com/tc39/test262/blob/91c70759363c46557b694792bf34a2551a7af5ba/INTERPRETING.md) (pinned lines 84–113), `harness/atomicsHelper.js`                                                                                                                                                                         | `start` blocks until the agent runs. `broadcast(sab, int32OrBigInt)` blocks until every agent has retrieved it. `getReport` returns a string or `null`; `report` uses ToString. `sleep` and `monotonicNow` exist on both sides; `leaving` only in agents. The helper's `waitUntil` (lines 132–139) **busy-spins** on `Atomics.load`. |

Consequences:

- The parent spins without yielding, so the 109 `start` files need real
  concurrent threads; sequential contexts cannot pass them.
- The helper's `setTimeout` polyfill (lines 39–56) keeps the Promise queue
  non-empty, so timeout jobs must be checked **between jobs**, not only after the
  queue drains, or they starve.
- Spec time is "time value (UTC)" plus permitted `additionalTimeout`.
  **Recommendation:** use monotonic deadlines. That fits within the permitted
  slack and avoids wall-clock steps.

## 3. Current implementation (evidence)

**One hosted context per process.** `codegen/src/aarch64/startup.ts` performs
all bring-up inline in process `main`:

- maps control, heap and stack with guard pages (lines 358–411);
- maps a never-recycled **domain identity page** stored at `context+72` (lines
  412–422; `nativeContextDomainOffset`, `abi/src/host.ts:1–6`);
- initializes allocator and runtime, then calls program `main` through the
  private ABI (`privateCall`, lines 316–330: x0 = context, x1 = environment,
  x3 = result area; status 1 = ok);
- unmaps its three mappings on exit (lines 495–522).

There is no reusable bring-up routine and no thread entry. Context travels in x0
and a frame slot (`scalar/index.ts:1043`), with no TLS, which suits threads.
`context-domain` reads `context+72` (`scalar/index.ts:4303–4315`), and
`resolveManagedPointers` rejects a foreign domain before descriptor reads
(`compiler/src/native/managed-imports.ts:321–322`).

**Agent Record and jobs.** `ScriptAgent` (`js-runtime/src/objects/jobs.ts:21–42`)
holds `canSuspend`, `atomicsCapabilities`, kept objects, weak registries,
`activeContext` and one FIFO `jobs` queue. It has no signifier, waiter table or
timers. `drainScriptJobs` (lines 74–109) drains to quiescence. The runner drains
once after the test (`tools/test262-native.ts:483`) and treats an empty queue
without `$DONE` as a timeout.

**Atomics.** `prepareAtomicWait` (`objects/atomics-access.ts:355–418`) follows
DoWait's coercion order and handles no-enqueue cases with one seq-cst read. A
matching value with a positive, NaN or infinite timeout calls
`rejectUnsupportedExecution` (line 397). A sync wait with `t ≤ 0` returns
`"timed-out"` without registering, which is one permitted execution of
add-then-time-out. `notifyAtomicWaiters` (lines 324–350) requires
`storage.service.notifications`; only the Node reference service provides it
(`tools/node-shared-block-service.ts:25`).

**Shared blocks.** `SharedBlockService` (`bytes/shared.ts:72–117`) already uses
opaque POD handles, never addresses. Block identity is `(engineId, blockId)`
(lines 173–178), and `attachSharedStorage` (lines 165–172) rebuilds a wrapper in
any heap. The native service (`native-runtime/src/shared-blocks.ts`) has a
creator (lines 279–316) and an attacher that validates a POD `{base, byteLength,
engineId}` (lines 317–341). Payloads are reserved at maximum and never move. It
deliberately has no destroy: "shutdown must first exclude every agent/operation"
(lines 342–347). Trusted leaves never allocate, throw or reenter (lines 40–43).
The publication lock is a bare CAS spin without a pause hint (lines 410–413).

**Code storage.** `createEngineCodeStorage` (`js-engine/src/native/code-storage.ts:22–60`)
binds one arena to its issuing domain and lazily maps **its own** arena. The
Test262 prelude creates it and the block service as module-level state
(`tools/test262-native.ts:248–270`). Darwin publication uses
`_pthread_jit_write_protect_np` and `_sys_icache_invalidate`
(`platform/src/darwin/host-abi.ts:4–9`).

**Prototype.** `tools/native-waiter-domain.ts` is a fixture only (lines 2–3):
hand-assembled AArch64 using `pthread_create`, a mutex, per-record conditions,
`pthread_cond_timedwait_relative_np`, FIFO notify and cross-width
`(block, offset)` matching (layout lines 12–41, main lines 196–304). It is
[validated](../results/native-waiter-w1-diagnostic-v2.json) as a protocol
reference, not a capability.

**Darwin facts.** Tint signs ad hoc: CodeDirectory flags = 2
(`image/src/darwin/signature.ts:126`), so there is no hardened-runtime bit.
`allow-jit` is added on request (`macho/runtime-entitlements.ts:45`). Apple's
[JIT porting guide](https://developer.apple.com/documentation/apple-silicon/porting-just-in-time-compilers-to-apple-silicon)
says that with Hardened Runtime and `allow-jit` an app "can only create one
memory region with the `MAP_JIT` flag". It also says write/execute toggling
applies "for the current thread only", and that `sys_icache_invalidate` must run
before executing updated pages. The SDK header marks
`pthread_jit_write_protect_np` as macOS-only.

## 4. Design

### 4.1 Identities (builds on the resolved RT-EVAL Q3)

| Identity             | Lifetime                                   | Holder                                            | Used for                                                                       |
| -------------------- | ------------------------------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------ |
| Context-domain token | Heap/context; page retained after teardown | `context+72`, published ranges, bindings          | Authorizing code, surfaces, frames and inbox entries. **Never** agent identity |
| Logical agent ID     | Process; monotonic counter, never reused   | Agent slot, `ScriptAgent.signifier`, waiters      | `[[Signifier]]`, waiter ownership, report/broadcast routing                    |
| Slot generation      | Per slot reuse                             | Agent slot header                                 | Rejecting stale POD references if slots are recycled                           |
| Waiter serial        | Process; monotonic                         | Native waiter record and owner's capability table | Pairing a native record with its owner-heap promise capability                 |

Each context belongs to exactly one agent; the parent is ID 1. A slot records
both the ID and the domain. Every cross-agent POD message carries
`(agentId, generation, serial)`. Before touching any local table, the receiver
checks that the slot's domain equals `currentContextDomain()`. A mismatch is an
internal invariant failure, reported as unsupported with the RT-EVAL §6.6
`missing-authority` subreason. It never falls through to a call.

### 4.2 Ownership: no shared managed pointers

Each agent owns its heap, collector, roots, module state, realms, job queue,
`RuntimeCompiler` and code cache. Only the following cross agents:

- **Shared control mapping** (new, process-lifetime, never unmapped, all fields
  scalar): the agent table, waiter registry, per-agent inboxes, report queue,
  broadcast cell and code-arena cursor. All mutation goes through `shared-*`
  leaves or the new lock and park leaves.
- **SAB payloads**, by handle.
- **Copied code units**: agent source and report strings. The sender writes
  them into the shared mapping; the receiver builds a fresh managed string.

Promise capabilities, callbacks, wrappers and realms never leave their heap. An
async waiter's capability sits in the owner's rooted `ScriptAgent.waiters`
table, keyed by serial; a remote notifier only queues the serial. Payloads stay
retained for the process, so payload refcounts are a non-goal until a destroy
API exists.

The broadcast cell has explicit counts:
`{generation, handle, valueKind, lo, hi, expected, remaining}`.

- `broadcast` waits for the previous generation to drain, publishes, signals each
  live receiver, then parks until `remaining = 0` or a host-bounded deadline. A
  passed deadline gives unsupported or timeout, never a pass.
- Each receiver copies the fields to its inbox and decrements `remaining`.
- An agent that exits without receiving is subtracted under the lock, so the
  broadcaster never waits on a dead agent.

### 4.3 Native thread lifecycle (own codegen; no C or platform linker)

1. **Factor bring-up.** Move startup lines 358–485 into
   `emitContextBringUp(request, entry)` in `startup.ts`. Ordinary images must stay
   byte-identical; the self-build stage comparison is the gate.
2. **Trampoline.** Add an emitted `agentThreadEntry` with the C ABI of a
   `pthread_create` start routine (x0 = slot address; returns a pointer).
   - It saves x19–x30 **and d8–d15**, as AAPCS64 requires.
   - It maps its own guarded stack and switches `sp`, then runs
     `emitContextBringUp` with a fresh heap and domain page.
   - It calls the retained `runAgent(slotAddress)` export through the private
     ABI and stores the exit status in the slot.
   - It unmaps only its own mappings and keeps its domain page.

   `pthread_*` symbols come in through Tint's existing foreign-import table, as
   `executable-write` already does (`scalar/index.ts:3752–3865`).

3. **Host operations** (new `HostOperation`s in `ir/scalar/host.ts`, granted
   only through `hostBindings`). All return numeric status.

   | Operation                                 | Purpose                                                               |
   | ----------------------------------------- | --------------------------------------------------------------------- |
   | `agent-thread-start(slot)` / `-join`      | Create or join the joinable agent thread                              |
   | `waiter-lock` / `waiter-unlock`           | Enter and leave the registry critical section                         |
   | `waiter-park(registry, cell, deadlineNs)` | Unlock and sleep atomically; returns `woken` or `timed-out`, relocked |
   | `waiter-signal(cell)`                     | Wake the agent parked on `cell`                                       |
   | `sleep-until(deadlineNs)`                 | Sleep until a monotonic deadline, retrying on EINTR                   |

   Symbols live in a new `PosixHostABI.threads` facet. Darwin uses
   `_pthread_create`/`_join`, mutex/cond init, `_pthread_cond_timedwait_relative_np`
   (it lacks `pthread_condattr_setclock`) and `_nanosleep`. Linux uses
   `pthread_condattr_setclock(CLOCK_MONOTONIC)` plus `clock_nanosleep(TIMER_ABSTIME)`,
   or futexes, per its own system-library policy. Windows uses `CreateThread`,
   SRW locks and condition variables, or `WaitOnAddress`. The logical operations
   are identical, and no OS conditional reaches `js-runtime`.

4. **`runAgent(slot)`** is portable TS in a new internal module,
   `@tint/js-engine/agents`. It attaches the block service from the slot's POD
   registry, builds an agent realm (`createScriptAgent(true)` plus signifier) with
   the agent-side `$262.agent`, copies the source, evaluates it (§4.5), and loops:
   - drain jobs, checking expired timers before each job;
   - move inbox entries (broadcasts, remote waiter results) into jobs;
   - exit when `leaving`, the queue is empty and no local async waiters remain;
   - otherwise park on its own cell until the next deadline or a signal.

   `start` returns once the slot reaches `running`, which is after realm creation
   and before source evaluation.

### 4.4 Waiter registry

Add `SharedBlockWaiters` beside `SharedBlockNotifications` (`bytes/shared.ts`),
implemented natively in `native-runtime/src/shared-waiters.ts` over the control
mapping.

- **`register(handle, offset, width, expectedLo, expectedHi, deadline, mode, agentId)`**:
  under the lock, re-read the word seq-cst through the existing service leaves.
  Return `not-equal`, or append a FIFO record keyed by `(blockId, byteOffset)`
  and return its serial. Notifiers store, then lock, so comparing inside the
  critical section cannot lose a wakeup.
- **`park(serial, deadline)`** (sync): loop on `waiter-park` while the record is
  `waiting` and now < deadline. Remove its own record on timeout. Rechecking the
  state absorbs spurious wakes, and the relative timeout is recomputed from the
  monotonic clock on each pass.
- **`notify(handle, offset, width, count)`**: under the lock, remove up to `count`
  records FIFO with result `ok`, and return the count. A blocking waiter gets
  `waiter-signal`; a same-agent async serial returns to the caller; a remote
  async waiter gets `(serial, "ok")` appended to its owner's inbox, then a signal.
- **`expire(serial)`** (async timeout job): remove the record and return
  `timed-out` if it is still listed; otherwise return `already-notified`.

No managed allocation, resolve call or callback runs under the lock. DoWait
already allocates the capability and result object before `register`.
Same-agent resolves run right after `notify` returns, still inside
Atomics.notify. That is observationally identical to resolving inside the
critical section, because resolving a fresh `%Promise%` with a string runs no
user code. Remote results become `HostEnqueueGenericJob`-equivalent jobs in the
owner's queue, using the stored capability's realm. Infinite or NaN timeouts
register `+∞` with no timer. Deadlines beyond the representable nanosecond range
also become `+∞`.

Start with one process lock, as the prototype does; striping is a measured
follow-up. Add the existing `cpu-pause` hint to the block-publication spin once
real threads contend.

### 4.5 Agent source: AOT-discoverable versus runtime-compiled

- **Runtime (general, required).** Parent `start(src)` applies ToString and
  copies the code units. The agent compiles them with RT-EVAL **S2**
  (`RuntimeCompiler.evaluateScript`) in its own domain, with its own surface
  table cell and cache. 117 of 120 calls need this.
- **AOT (early, narrow, not a cheat).** The runner parses each test and
  precompiles only `$262.agent.start(<string or substitution-free template>)`
  arguments with the same `lowerScript`. It links them as
  `agentScripts: {sourceText, entry}[]`. `runAgent` selects an entry by **exact
  code-unit equality**, otherwise falls back to S2, or reports unsupported if S2
  is absent. No test code is evaluated at build time, no substitutions are
  guessed, and semantics match runtime compilation. This covers only the
  `good-views` files, but it proves the whole agent lifecycle before S2.
- **Rejected:** constant-folding `${…}` at build time, because that evaluates
  test code outside the engine.

### 4.6 Executable memory across agents

Do **not** assume one MAP_JIT arena per agent: Hardened Runtime permits only
one region, and distribution may require it later. **Recommendation:**

- map one process arena;
- hand each agent a domain-tagged sub-range from an atomic bump cursor in the
  control mapping, through a new `createEngineCodeStorageWindow`. Keep the lazy
  mapper for single-context images;
- have each agent register its sub-range with its **own** collector.

Write protection is per thread, and domain checks ensure agent A's code runs only
on A's thread. That sidesteps cross-core instruction-fetch synchronization.
Linux (`mprotect` or dual mapping) and Windows (`VirtualAlloc`,
`FlushInstructionCache`) supply their own publication strategy behind
`PosixHostABI.executableMemory` or its successor.

### 4.7 `$262.agent` surface and abrupt completions

- **Parent `start(src)`:** ToString (a throw creates no slot) → reserve a slot →
  copy → `agent-thread-start` → wait for `running` or `failed`. Slot, mapping or
  thread failures report unsupported, never a language error. A failure after
  reservation releases the slot.
- **Parent `broadcast(sab, v)`:** non-SAB → TypeError before publication. `v`
  `undefined` or Number → ToInt32; BigInt → BigInt64 halves; out of range →
  unsupported (**the pinned tests pass only a SAB or a small id; this encoding is
  an assumption**). Publication is all-or-nothing, then the parent blocks (§4.2).
- **Parent `getReport()`:** one dequeued string, or `null`. The helper polls with
  `sleep(1)`.
- **Agent `report(m)`:** ToString in the agent's realm, so a throw is an agent
  error. Then enqueue a copy; a full bounded queue reports unsupported.
- **Agent `receiveBroadcast(fn)`:** store `fn` and return `undefined`. Delivery
  builds a fresh per-agent SAB wrapper with `attachSharedStorage`; block identity
  is shared, wrapper identity is not.
- **Agent `leaving()`:** mark the slot. Exit follows quiescence.
- **Both sides:** `sleep(ms)` (ToNumber, then `sleep-until`; NaN or negative → 0) and `monotonicNow()` (the existing `monotonic-time` operation, in
  fractional milliseconds).

Uncaught agent errors are recorded in the slot. The parent turns them into a test
error at its final checkpoint.

**Cleanup.** When parent `main` returns, the process exits. Agents never touch
the parent heap, so its unmapping is safe. Shared control and payload mappings
are never unmapped. Parked agents are terminated by the OS, which is acceptable
with process-per-case isolation. The runner's containment timeout covers
deadlocks.

### 4.8 Ordering checklist

- `wait`/`waitAsync`: every coercion throw precedes allocation and registration.
  Not-equal allocates a result only in async mode. Async `t = 0` never registers.
  A sync wait in a `canSuspend = false` agent throws after timeout conversion;
  agent threads are always `canSuspend = true`.
- `notify`: a non-shared buffer returns 0 after count conversion. A shared buffer
  takes the lock even for count 0.
- Same-agent reactions run at the next drain. Remote resolution runs only on the
  owner's thread.
- Timeout versus notify is decided by the lock, never by a clock comparison.

## 5. Ordered slices

Each slice is test-first: Node tests for portable logic, then status-coded
hosted fixtures built with `TINT_BUILD_ONLY=1` and run serially under LLDB,
asserting the stopped-at-entry state and the exact exit. Changes to the
compiler, codegen or startup need a frozen-source native self-build with
byte-identical stages.

**A0. Two live contexts and foreign-domain rejection (no threads).** This closes
the RT-EVAL S0 gap.

- Files: `startup.ts` (`emitContextBringUp`, plus a fixture-only sequential
  `bring-up-secondary-context` host operation), `ir/scalar/host.ts`, and a new
  `tools/verify-hosted-two-contexts.ts`.
- Fixture: context A initializes, publishes JIT code and an identity binding,
  roots an object and churns 32 MiB. While A is still live and mapped, B
  initializes. Check distinct domains and heaps, fresh B module state (a
  module-level counter at its initial value), and that B's GC never moves A's
  objects. A's binding resolved with B's domain is rejected before any
  descriptor read (spy reader); invoking A's entry from B is rejected with the
  sentinel unset; A's own call still succeeds. Tear down B and bring up B′: its
  domain differs even if addresses are reused.
- It also verifies that module state is per context, which is currently inferred.

**A1. Single-agent waiter registry and agent shell (no threads, no RT-EVAL).
Highest-value slice before full RT-EVAL.**

- Files:
  - `bytes/shared.ts` (`SharedBlockWaiters`) and
    `native-runtime/src/shared-waiters.ts`;
  - `atomics-access.ts`: replace line 397 with register, park, timeout job and
    same-agent resolve; route notify through the registry;
  - `jobs.ts`: `signifier`, `waiters`, a timer heap, `enqueueTimeoutJob`, a timer
    check before each job, and sleeping until the earliest finite timer when the
    queue is empty;
  - the runner prelude: native `$262.agent` with `monotonicNow`, `sleep`, and
    `getReport` → `null`; `start` and `broadcast` report unsupported.
- Node tests: DoWait order with throwing coercions before allocation; the async
  `t = 0` path; FIFO notify with count 0, `Infinity` and negative counts; an
  Int32 waiter notified through a BigInt64 view at the same offset; timeout job
  versus notify interleavings (spy lock); the spurious-wake loop; the realm of
  the resolved promise.
- Native fixtures: same-agent `waitAsync` then `notify` → `ok`; a 1 ms timeout
  amid busy Promise jobs → `timed-out`; sync `wait(…, 1)`; an infinite sync wait
  in a non-suspending agent → TypeError with no registration.
- Unchanged Test262: the 4 + 3 files (14 variants), then a fresh complete
  `built-ins/Atomics/{wait,waitAsync,notify}` rerun in a new report.

**A2. Real agent threads, AOT-static sources.**

- Files: `startup.ts` (`agentThreadEntry`), `PosixHostABI.threads` plus the Darwin
  facet, `@tint/js-engine/agents` (`runAgent`, slots, report queue), and runner
  `agentScripts`.
- Native fixtures: two agents report interleaved strings and leave; a report
  argument whose `toString` throws → agent error recorded; an injected
  thread-start failure → unsupported; the parent spins on `Atomics.load` while an
  agent stores; 100 start/leave cycles leak no slot or mapping (domain pages are
  retained by design); agent GC under churn while the parent allocates.
- Unchanged Test262: the three `good-views` files (6 variants).

**A3. Cross-agent waiting.** Remote notify → inbox → owner job; blocking parks
use `waiter-park`/`-signal`; `broadcast`/`receiveBroadcast` use the counted cell.

- Fixtures: the notify-before-park race over 10⁴ randomized iterations; a
  remote `waitAsync` resolved in the owner's queue and realm; a remote notify
  racing a local timeout yields exactly one result; an agent that exits with a
  pending broadcast releases the broadcaster.
- Test262: still limited to A2's exact-match table.

**A4. Shared code arena** (§4.6), before any runtime agent compilation. The
fixture compiles concurrently in two agents, checks domain-tagged sub-ranges,
rejects a cross-agent invocation, and reports arena exhaustion as unsupported.

**A5. Runtime agent sources (requires RT-EVAL S1/S2).** `runAgent` falls back to
`evaluateScript`. Then unchanged complete reruns of the 112 agent files and the
rest of `built-ins/Atomics`, each in a new immutable report.

## 6. Reused frameworks and contracts

| Need          | Reuse                                                                                   | New                                                         |
| ------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Shared memory | `SharedBlockService`, native leaves, `attachNativeSharedBlockService`                   | `SharedBlockWaiters`; control-mapping layout in `@tint/abi` |
| Authority     | `context-domain`, `ManagedIdentityBinding.domain`, `EngineCodeStorage.domain`           | Slot↔domain check on inbox entries                          |
| Jobs          | `JobQueue`, `drainScriptJobs`, `createSourceExecutionContext`                           | Timer heap; inbox → job transfer                            |
| Threads       | Foreign-import table (`executable-write` precedent); `native-waiter-domain.ts` protocol | `agentThreadEntry`, `threads` facet, host operations        |
| Compilation   | RT-EVAL S2 `RuntimeCompiler`; `lowerScript` for the AOT table                           | Per-agent compiler instance                                 |

Entrypoints stay narrow: `js-runtime` sees capabilities, `native-runtime` owns
the leaves, `@tint/js-engine/agents` owns the loop, and the runner holds only
wiring. There is no system JS, ICU or C fallback.

## 7. Decisions, unverified facts and risks

**Decisions (recommended defaults):** one process waiter lock and monotonic
deadlines; a shared code arena with per-agent sub-ranges; logical IDs never
reused; an exact-text AOT agent table before S2; no payload refcounts until
blocks can be destroyed; an agent heap budget recorded in reports, starting at
**16 MiB per agent (an assumption to measure)**.

**Unverified facts (verify in the named slice):**

1. Module-level state lives in each context's heap, so a second bring-up gets
   fresh state (A0).
2. Multi-threaded Tint images work under LLDB's stopped-at-entry protocol, with
   useful per-thread fault reports (A2).
3. Whether an unhardened ad-hoc image may map several MAP_JIT regions is moot
   under §4.6. Same-thread publish-then-execute stays on the existing leaf (A4).
4. `pthread_cond_timedwait_relative_np` measures against a monotonic base, as
   the prototype assumes (A1/A3).
5. The Linux and Windows primitives in §4.3 are design targets only.

**Risks:**

- **Compile cost.** Each agent has its own RuntimeCompiler and surface: RT-EVAL
  risk 1, multiplied by up to four agents.
- **Duration.** `timeouts.huge` is 10 s. Keep the uniform containment timeout
  and record it.
- **Identity versus lifetime.** Inbox, report and waiter entries must be
  validated against the slot's current domain and generation. An exiting agent
  must purge its listed waiters under the lock, or notify counts phantom agents.
- **Startup factoring.** Moving bring-up risks byte drift; the self-build
  comparison gates it.
- **Spin locks under real preemption.** Add the pause hint and measure.

**Non-goals:** a shared heap, cross-agent stop-the-world, payload reclamation,
thread pools, `CanBlockIsFalse` worker agents, HOST-ESM workers, and a Node
fallback.
