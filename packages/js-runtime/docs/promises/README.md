# Promise protocol

Representation-independent Promise state, resolving functions and reactions. The
embedding supplies value classification, identity, property access, calls, errors,
job scheduling and rejection notifications through `PromiseHooks<Value>`.
JavaScript property/call failures cross that boundary as `PromiseCompletion<Value>`;
host failures remain distinct. The core has no object model or scheduler dependency.

`createPromiseRecord` starts pending. `createResolvingFunctions` shares an
already-resolved cell between resolve/reject and sets it before reading `then`.
Primitives and non-callable then properties fulfill immediately. Callable then
methods are captured synchronously and invoked in a queued job with fresh resolving
functions. Self-resolution rejects; getter/call errors retain their original values.

`performPromiseThen` registers or queues fulfillment/rejection reactions. Missing
handlers forward the value or reason. Handler outcomes resolve/reject the supplied
capability, whose own exceptions propagate from the job. Internal reactions without
a capability must complete normally. Settlement releases both reaction lists;
rejection tracking distinguishes initial rejection from subsequent handling.

The host's enqueue hook receives the relevant callable, or undefined for an absent
handler. It must capture the job realm and active Script/module and run the job
later, in FIFO order. The non-browser host uses the default JobCallback behavior.
TypeError creation must use the executing resolving function's realm. These are
adapter contracts, not properties inferred from a mutable prototype chain.

The Script Promise constructor, species/capability construction, static methods,
combinators, rejection-reporting policy and async syntax are separate integration
work. This core is not a claim of Script-level Promise conformance.

Validation: semantic tests cover resolution, reentrancy, ordering, thenable chains,
handler cycles, forwarding, tracking and custom capability errors.
`tools/verify-hosted-promises.ts` compiles the protocol and job queue to native code,
including a 10,000-step thenable chain.

Specification: [Promise abstract operations and jobs](https://tc39.es/ecma262/multipage/control-abstraction-objects.html#sec-promise-abstract-operations).
