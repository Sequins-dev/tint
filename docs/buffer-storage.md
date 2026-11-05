# Buffer storage boundaries

## Owned storage

`@tint/js-runtime/bytes` owns allocation, copying and lifecycle policy. Ordinary
ArrayBuffer, TypedArray and DataView objects adapt that policy to ECMAScript
brands, coercion order and errors. Numeric and text codecs operate on validated
byte windows and do not implement object policy themselves.

An immutable owned buffer is fixed length and remains readable. Creation copies
initialized bytes into independent storage before publication; failed transfer
leaves the source attached. Resize, transfer, detach and writable borrows reject
immutable storage, including zero-length writes. A raw read borrow is trusted
internal access and must not be mutated. Reacquire borrows after observable calls
that may change ordinary storage.

The immutable storage, view policy and public producer APIs are implemented.
Five focused native API cases and the direct native view-policy fixture pass.
The latest pre-SAB [ArrayBuffer baseline](results/test262-arraybuffer-postrestart-baseline-native-v1.json)
passes 418/442 variants; its 24 semantic failures require SharedArrayBuffer.
That completed run has no infrastructure errors. The [proposal algorithms](https://tc39.es/proposal-immutable-arraybuffer/)
guide those adapters and the unchanged pinned Test262 population defines the
measured coverage.

## Shared backing

SharedArrayBuffer belongs in this architecture alongside ArrayBuffer. Sharing,
mutability and size policy are separate concerns; `immutable` must never become
an alias for `shared`, and ordinary `resizable` must not imply shared growth.
Keep distinct ArrayBuffer and SharedArrayBuffer brands even where their views
share implementation. Valid public states are mutable fixed/resizable ArrayBuffer,
immutable fixed ArrayBuffer, and mutable fixed/growable SharedArrayBuffer. Shared
storage does not gain ArrayBuffer detachment or transfer operations.

The native shared backend has a stable block identity, an aligned backing
allocation and a separately published current byte length. It supports fixed or
grow-only storage. It cannot use ordinary ByteStorage's copy-and-replace resize
or detachable ownership transfer. Growth initializes the new range before
publishing its length, and concurrent growth must preserve the specification's
ordering and bounds behavior. Serialize growth preparation as well as length
publication: a losing grower must not zero bytes another agent has already
published and written. These are requirements from the
[SharedArrayBuffer algorithms](https://tc39.es/ecma262/multipage/structured-data.html#sec-sharedarraybuffer-objects).

Each agent owns its wrappers and GC-managed objects. Cross-agent handles retain
the backing block, rather than exposing another agent's movable heap pointers.
The initial service owns bounded mappings through engine/process lifetime.
Its scalar registry controls block count, reserved bytes and publication, with
no managed pointers in shared memory. Reclamation before engine shutdown remains
a future contract that must exclude every handle and in-flight operation.

## Access and compilation contracts

A shared read or write carries its element width, alignment, access order and
tearing requirements. TypedArray and DataView access must use these operations;
adding Atomics alone does not make existing byte-by-byte codecs correct for
shared memory. Atomic read-modify-write operations must remain indivisible and
satisfy the [ECMAScript memory model](https://tc39.es/ecma262/multipage/memory-model.html).

Represent these effects explicitly through native lowering. Optimizations must
not reuse mutable shared contents or lengths across synchronization, split atomic
operations into ordinary byte accesses, or infer thread confinement merely from
a wrapper's local lifetime. AOT and live execution use the same primitives.

Slicing must reject a species result that aliases the source block even through
a different wrapper. Fixed views over growable shared storage may prevent
extensions; tracking views may not. Those decisions follow the view and backing
identity contracts rather than an ordinary buffer resizability flag.

Host adapters own backing mappings, thread creation, blocking and wakeups.
Portable policy owns argument validation, buffer/view semantics, waiter identity
and job delivery. Keep macOS, Linux and Windows implementations behind that
boundary. The arm64 encoder now provides acquire/release loads/stores, exclusive loads/stores,
barriers and exclusive-monitor clearing, verified against independent assembler
output. The native service and single-agent API/view paths now pass
[native service](results/shared-block-service-s1b-native-v2.json) and
[combined API](results/shared-array-buffer-api-native-v1.json) fixtures. Typed-array
integer accesses and raw bulk copies retain their element width; DataView/codecs
use explicitly byte-oriented operations. Concurrent memory-order correctness,
Non-waiting [Atomics operations](atomics.md) now use explicit native atomic
backing. Multi-agent execution and waiting remain separate implementation and
validation work.

## Validation order

1. Validate owned immutable storage and all existing writer boundaries.
2. Establish shared-block lifetime, stable backing and ordered length operations.
3. Add SharedArrayBuffer brands, construction, accessors, slice and growth, with
   TypedArray/DataView shared-access paths.
4. Add atomic loads, stores and read-modify-write operations, then waiter queues,
   agents and asynchronous notification delivery.
5. Run unchanged complete SharedArrayBuffer and Atomics families plus native
   multi-agent publication, contention, growth and reclamation tests.

Single-agent API passes do not establish concurrent memory-model correctness or
agent support. The captured Test262 host installs SharedArrayBuffer only when its
public installer and native service contract are available; full-family reruns
measure that integration separately from bespoke fixtures.

The pinned complete SharedArrayBuffer selection contains 208 variants; Atomics
contains 778. The explicit shared/atomic feature union spans 1,226 variants across
families. These overlapping populations must be measured separately. SharedArrayBuffer's
208 variants require no agents, so that complete API selection is an early gate;
passing it does not establish cross-agent correctness.
