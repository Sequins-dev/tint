# Iterator protocol

Representation-independent iterator and generator operations. The embedding supplies
property reads, calls, value classification, truthiness, an undefined value, and
TypeError creation through `IteratorHooks<Value>`. The core has no runtime or
platform dependencies.

`getIteratorFromMethod` calls a supplied iterator method and caches `next` without
prematurely validating its callability. `iteratorNext` preserves argument presence.
`iteratorStep` checks completion without reading `value`; `iteratorStepValue` also
reads the yielded value. Failures from next, done, or value mark the record done.

`iteratorClose` receives whether the caller already has a thrown completion. It
still gets and calls `return`, but preserves that original throw over close errors.
Other completion kinds propagate close errors. The caller owns its pending value
and control-flow target, decides whether closing is needed, and tracks completion;
the close primitive does not silently consume the record.

The Script adapter lives in `@tint/js-runtime/objects`. Async iteration is separate.

Specification: https://tc39.es/ecma262/multipage/abstract-operations.html#sec-iteration

The generator primitives manage suspended-start, suspended-yield, executing and
completed states. `createGeneratorRecord` captures a continuation without running
it. `resumeGenerator` accepts next/return/throw requests, rejects reentrancy, skips
the body for an abrupt request before initial execution, and releases the stored
continuation on completion or an uncaught exception. A completed next produces
undefined, a completed return preserves its supplied value, and a completed throw
throws that supplied value.

A continuation returns either a yielded iterator-result object or a final return
value. Yielded results pass through unchanged, so delegation can preserve identity
and getters. The caller's hooks construct completion results; the continuation
owns the frame, program counter and pending catch/finally completions. Receiver
and brand validation belongs to the object adapter. This is native continuation
control, not an interpreter or an implementation of generator source lowering.

Specification: https://tc39.es/ecma262/multipage/control-abstraction-objects.html#sec-generator-abstract-operations

`resumeYieldDelegate` implements one synchronous `yield*` delegation step using
the same iterator hooks. The continuation supplies `next(undefined)` initially
and retains the iterator record between calls. Each request supplies exactly one
argument to the cached next or freshly looked-up return/throw method. A yielded
result keeps its identity without reading value. Normal completion supplies the
yield-expression value; return completion must unwind the enclosing generator.
The helper does not own the enclosing frame or its catch/finally scopes.

A missing throw method closes the iterator with no arguments before reporting a
TypeError. Close failures take precedence over that protocol error. A delegate
return that yields does not retain the earlier return request: the next resume
request determines subsequent control flow. Async delegation remains separate.

Specification: https://tc39.es/ecma262/multipage/ecmascript-language-functions-and-classes.html#sec-generator-function-definitions-runtime-semantics-evaluation

`runGeneratorSteps` consumes internal transfer outcomes between native segments.
Each segment returns before the destination is called, keeping loop backedges
stack-bounded and preventing a preceding segment from catching destination errors.
Only terminal yield/return outcomes reach the generator protocol; yielded result
identity is preserved.

## Async generator requests

`createAsyncGeneratorRecord` and `enqueueAsyncGenerator` manage an ordered request
queue across native continuation suspensions. The continuation explicitly returns
await, yield or return outcomes; source lowering must await yield/return expressions
before emitting their terminal outcomes. This avoids extra jobs for implicit returns.

The host supplies Promise settlement, internal await reactions, iterator-result
construction and exception conversion. Return requests await their inputs before
resuming a suspended yield or completing an exhausted generator. Rejected inputs
re-enter the continuation as throws. Reentrant calls enqueue; completion releases
the continuation and drains pending requests without recursive stack growth.

Unit tests compare yielding-finally behavior with JavaScript async generators.
`tools/verify-hosted-async-generators.ts` verifies the protocol in native code,
including 20,000 queued requests. The ordinary-object adapter supplies Promise and realm integration. Async-generator
source lowering uses `runAsyncGeneratorSteps` for stack-bounded transfers that
preserve the distinction between await suspension and yielded values.

## Async-from-sync adaptation

`resumeAsyncFromSyncIterator` calls a cached next or freshly looked-up return/throw
method synchronously, preserves argument presence and reads done before value.
Its host hooks assimilate the value and settle a fresh iterator result. Requests
are independent, unlike an async generator's ordered queue.

Rejected values close unfinished next/throw results while preserving the original
error. Return failures do not close again. A missing throw closes before reporting
a protocol error; a missing return preserves its argument without awaiting it.
`tools/verify-hosted-async-from-sync.ts` verifies this protocol natively. The
ordinary-object adapter and intrinsic Promise checks live in
`tools/verify-hosted-async-iteration.ts`.
