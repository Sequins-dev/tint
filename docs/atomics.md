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

## Remaining work

Native pthread CAS contention [passes all three widths in the first observation](results/native-contention-validation-v1.json). A [corrected deterministic contention barrier](results/native-contention-validation-v2.json) passes u8/u16, retaining one u32 pre-entry failure. These are raw native race kernels, separate from Script-agent conformance. Generic hosted workers now have independent managed contexts and roots; the
Script-agent host still needs per-thread realm/job creation and shared mailboxes. Payload/control mappings contain
no moving managed pointers and currently have bounded engine-lifetime retention.

`notify` validates Int32/BigInt64 views and converts index/count before returning
zero for ordinary buffers. It deliberately does not revalidate after count hooks,
which may detach ordinary backing. Shared notification requires an explicit
`SharedBlockNotifications` capability, even for count zero. The Node reference
adapter uses genuine Atomics.notify; a native waiter registry is still pending.
Waiter identity is shared block identity plus absolute byte offset, independently
of wrapper and integer width. The [combined native fixture](results/atomics-notify-native-v1.json) passes
ordinary-buffer notification, count-hook detachment, explicit rejection of a
missing shared capability, and the earlier CAS/RMW width cases.

The Script agent now stores its host-supplied suspension policy, shared across
that agent’s realms. Test262 CanBlock flags select it independently per case.
Both policies pass [native host validation](results/native-agent-policy-validation-v1.json).

Wait and waitAsync implement their argument validation and coercion order,
including the synchronous non-suspending-agent TypeError after conversions.
After those checks, one sequentially consistent shared-word read now handles the
no-enqueue cases: a mismatch returns `not-equal`; an equal value with nonpositive
timeout returns `timed-out`. Integer conversion wraps to the actual 32/64-bit
word before comparison. Async immediate results are fresh method-realm ordinary
objects with `async: false` and a string value. The fast path linearizes at the
read and never registers a waiter; it cannot lose a notification for a parked
agent because it does not park. [Five native regressions](results/native-immediate-waits-validation-v1.json)
cover conversion/order, results and cross-realm behavior. The matching-value,
positive-timeout path still explicitly reports unsupported.

The [complete unchanged waitAsync selection](results/test262-wait-async-immediate-native-v1.json) passes 88/202, with no semantic failures, crashes or timeouts. The remaining outcomes are 106 missing-agent harness errors and eight unsupported parking cases.

Real waiting and the Test262 agent host remain unimplemented. They need
an engine-owned waiter registry, no-lost-wakeup registration, monotonic timeouts,
and owning-agent job delivery. A worker host must execute actual Script sources;
a precompiled native race kernel alone does not satisfy `$262.agent` conformance.

A fixture-only native waiter prototype also [passes its trace-enabled observation](results/native-waiter-w1-diagnostic-v2.json), with the [earlier pre-entry failure](results/native-waiter-w1-v1.json) retained. It exercises real pthread parking, FIFO notification, timeout and cross-width shared-location matching in a bounded two-record domain. It supplies no production waiting capability, managed workers or Script agents.


## Native lifecycle and parking prerequisites

Opt-in hosted worker startup initializes a fresh stack, heap, collector and
ownership domain for each system thread. The
[managed lifecycle fixture](results/native-isolated-thread-lifecycle-v2.json)
checks eight simultaneously live contexts under allocation stress and a throwing
worker. The [executable ownership fixture](results/native-isolated-thread-lifecycle-v3.json)
also publishes and invokes a distinct executable mapping in each live worker,
before and after collection. These are native infrastructure fixtures, not
unchanged Test262 agent passes.

The Darwin platform adapter explicitly grants `__ulock_wait2` / `__ulock_wake`
compare-and-park operations. Timeout arguments are relative nanoseconds (zero
means indefinite). Raw statuses remain advisory; state, notification ownership
and absolute deadlines belong to the waiter registry. The native leaf touches a
caller-owned cell before waiting because XNU's locked atomic copy-in cannot fault
an untouched page in. See Apple's [ABI header](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/ulock.h)
and [kernel implementation](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/sys_ulock.c).
The [parking fixture](results/native-word-parking-v2.json) covers mismatch,
timeout, empty wake and sixteen cross-thread publication/wake races. Its
[initial failure](results/native-word-parking-v1.json) and
[error-code diagnostic](results/native-word-parking-diagnostic-v1.json) retain the
untouched-page EFAULT observation. Observable Atomics waiting remains unsupported
until registry and owner-agent delivery are connected.

The native engine now also has an explicit scalar waiter registry. Its facades
are local managed objects; descriptors, ticket identities, location keys and
terminal states live in raw engine-lifetime storage. Compare-and-enroll and notify
share one registry lock. Notifications use registration order, including across
recycled slots, and match block identity plus byte offset independently of width.
Timeout and notification compete for one terminal state. Only the ticket owner
consumes a terminal result, after its in-flight park has returned. Kernel wakes
alone never complete a registration. The [native registry fixture](results/native-wait-registry-v1.json)
checks two isolated worker facades, cross-width FIFO notification, native parking
and timeout ownership. Script adapters and owner-agent promise delivery are still
pending; this does not change the Test262 agent-host status above.
