# Atomics

Tint exposes Atomics through the Script runtime, with explicit target facts and
shared-memory authority supplied by the embedding host. Portable language logic
has no OS dependencies. The [coverage dashboard](test262.md) owns measured results.

## Validation and coercion

`@tint/js-runtime/objects` (`atomics-access.ts`) validates integer typed-array brands, access
permissions and the initial index before converting operands. It revalidates the
view after all observable conversions. Ordinary ArrayBuffer storage is legal for
non-waiting operations; floating and clamped arrays are rejected. Immutable
storage rejects writes before executing index or operand hooks.

Conversions follow the [ECMAScript Atomics algorithms](https://tc39.es/ecma262/multipage/structured-data.html#sec-atomics-object).
Operands are encoded modulo the element width. BigInt payloads travel through
exact bytes or two uint32 halves, never a uint64 represented as Number.

## Shared operations

The backing service provides whole-width sequentially consistent loads and
stores. Its optional `SharedBlockAtomics` facet provides compare-and-exchange
for 1-, 2-, 4- and 8-byte payloads. Shared operations never fall back to an
ordinary load/store pair when atomic authority is absent.

Native embeddings explicitly pass `nativeSharedAtomicMemoryHost()` as the third
argument to the shared service factory and grant the unsigned CAS leaf separately.
The original seven-operation backing host remains usable without this facet.
Captured public exports determine Test262 host capabilities; mutable workspace
files and private implementation filenames do not enable features in old snapshots.

Exchange, addition, subtraction and bitwise updates use a CAS retry loop over
encoded bytes. Operand coercion executes once, before retryable work. Byte
arithmetic preserves modular carry/borrow at every element width. A failed CAS
supplies the next observed payload; successful equal-value updates still execute
an atomic operation. A [native regression](results/atomics-rmw-native-v1.json) covers all six updates,
including exact 64-bit wraparound. The [complete baseline](results/test262-atomics-family-native-v1.json) includes all six updates; its non-waiting methods and namespace pass 314/318 with four pre-entry failures.

`isLockFree` uses stable agent-cluster target facts. Four-byte operations always
report true. `pause` ignores Script arguments and optionally invokes one trusted,
nonallocating CPU hint; the AArch64 adapter emits YIELD.

## Waiting and notification

`notify` validates Int32/BigInt64 views and converts index/count before returning
zero for ordinary buffers. It does not revalidate after count hooks, which may
detach ordinary backing. Shared notification requires explicit
`SharedBlockNotifications` authority, including for count zero. Configured native
services expose one raw waiter registry shared by their local facades.

Waiter identity is shared block identity plus absolute byte offset, independently
of wrapper and integer width. Comparison and enrollment share the notification
lock. FIFO follows registration tickets across recycled slots. Timeout and notify
compete for one terminal transition; only the owning agent consumes that result.
Raw blocks and waiter records remain mapped through engine shutdown, after every
referencing worker has exited. Kernel wakes alone never complete a wait.

`wait` and `waitAsync` finish operand and timeout conversions before checking the
synchronous suspension policy and revalidating access. Mismatch and nonpositive
timeout return without enrollment. Positive synchronous waits use absolute
monotonic deadlines and recheck terminal state after advisory kernel returns.
Abrupt host failures release an outstanding enrollment.

Positive asynchronous waits return a method-realm intrinsic Promise. The owning
ScriptAgent retains its capability and pending registrations. The shared registry
contains only scalar identities, terminal states and completion sequence numbers.
Same-agent notify resolves exactly its selected registrations before returning;
foreign notifications are delivered at the owner's job checkpoint. Promise
reactions use the existing Script job queue. Notification transaction ranges keep
an unrelated same-agent notify from resolving an earlier foreign notification
synchronously. Timeout completion also occurs on the owner agent and competes
with notification under the same registry lock.

Embeddings install parking, monotonic clock and waiter authority explicitly. A
service without those capabilities rejects positive waits as unsupported. The
native Test262 host discovers the public provider from its captured source graph;
old snapshots do not gain capabilities from mutable workspace files.

## Native agents and platform ABI

The native Test262 host implements `$262.agent` with threads inside each fresh
variant process. Each worker initializes its own managed heap, collector, roots,
realm, jobs and executable arena. The parent passes a raw lifecycle record address
to the hosted system-thread thunk. No managed reference crosses that boundary.

Source and reports are copied as exact UTF-16 through raw mailboxes. The receiver
detaches a message under a scalar mutex, reconstructs it outside the lock with the
foundation string builder, then releases its mapping. Broadcasts carry a shared
block handle and copied Int32/BigInt identifier. Each worker attaches local SAB and
waiter facades, reconstructs the identifier, and acknowledges retrieval before
calling its Script receiver. The parent waits for every live recipient's
acknowledgement. Reports are FIFO; `getReport` returns a string or null.

`start` waits for worker readiness. `leaving` records completion; engine cleanup
joins workers and checks their scalar exit status. Exceptions and unhandled
worker Promise rejections become sticky failures visible to the parent. Startup
and broadcast deadlines are bounded. Unsafe asynchronous thread cancellation is
not used; LLDB contains whole-variant faults and timeouts.

The optional platform adapter supplies thread create/join, raw word wait/wake and
monotonic time. macOS arm64 uses pthread and Darwin ulock symbols through Tint's
own ABI, code generation and linking machinery. No C intermediary or platform
linker is involved. Linux can supply its thread and futex implementation behind
that boundary. Native resources record agent and waiter limits for reproducible
runs.

## Validation and measured coverage

Native regressions separately cover [eight isolated managed contexts](results/native-isolated-thread-lifecycle-v2.json),
[private executable ownership](results/native-isolated-thread-lifecycle-v3.json),
[parking races](results/native-word-parking-v2.json),
[cross-width FIFO](results/native-wait-registry-v1.json),
[synchronous Script waiting](results/native-sync-atomics-wait-resumed-v1.json),
and [owner-agent waitAsync delivery](results/native-script-waitasync-agent-v2.json).
The [Script agent bridge](results/native-script-test262-agent-v2.json) covers
worker global isolation, copied reports, shared broadcasts, exact BigInt IDs and
synchronous waiting. The first bridge observation remains preserved: its lone
surrogate assertion used an unescaped source literal that the build encoder
normalized; the corrected fixture checks code units directly.
The combined [frozen self-build](results/cluster-k-agent-selfbuild-v1.json) produces
byte-identical stages and verifies signing and DWARF. These are regression and
self-hosting evidence, not complete unchanged Test262 selections.

The [combined validation record](results/cluster-k-agent-host-validation-v1.json)
records the full workspace gate and expected worker error/rejection exits. The
[paired child-realm fixture](results/cluster-k-agent-child-validation-v1.json)
completes a successful child evaluation and rejects a caught child code-budget
failure with the expected graceful host status. The original large child-realm
stress input retains three post-entry timeouts and CPU samples; it remains a
separate compilation-cost observation.

The measured [waitAsync baseline](results/test262-wait-async-immediate-native-v1.json)
remains 88/202 until its complete rerun. It retains 106 missing-agent harness errors
and eight unsupported positive waits from the old host. The corresponding full
Atomics and waitAsync reruns are pending; the dashboard retains their old totals.
The real-agent [notify selection](results/test262-atomics-notify-cluster-k-v1.json)
passes 104/104. The complete [wait rerun](results/test262-atomics-wait-cluster-k-v2.json) passes
154/154. Its old survey retains 60 contained exits under the old Script budget.
Paired native controls separately validate the
[uniform resource-profile fix](results/cluster-k-agent-script-resource-acceptance-v1.json).
Earlier parking, debugger-launch and fixture failures remain in immutable reports.
