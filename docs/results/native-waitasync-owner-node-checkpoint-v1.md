# Owner-agent asynchronous waiting checkpoint

Positive Atomics.waitAsync now enrolls a raw waiter and returns an intrinsic
method-realm Promise. Only the owning ScriptAgent retains that Promise capability.
Notification and timeout publish scalar terminal state and completion order; no
managed value crosses into a notifying thread. Same-agent notify resolves exactly
the waiters selected by that notification before returning. Cross-agent completion
is processed at the owner's host checkpoint, preserving notification order across
locations and queuing normal Promise reactions on the existing Script job queue.
Unrelated same-agent notification cannot pull an external completion forward.

The native registry's ordered-notify result identifies one locked transaction by
its completion sequence interval. Its ordinary notify method retains the existing
numeric count contract. Sequence metadata consumes previously reserved raw fields.
Waiter slot reclamation still belongs solely to the owner, after terminal state.

Focused semantic validation passed 47 tests (Atomics, raw registry, configured
waiting service), plus subsequent host/lifecycle checks and TypeScript checks.
The [four native async cases](native-script-waitasync-agent-v1.json) pass
same-agent reaction ordering, cross-agent resolution, timeout removal and a worker
owning an asynchronous wait. Those manifests identify the exact tested snapshot;
later cleanup and host changes still require a refreshed native build and frozen
self-build. This is regression evidence, not a complete Test262 selection report.

The embedding pumps its existing job queue before external completion processing.
Main waits do not keep a completed synchronous variant alive merely because an
unobserved Promise remains pending. Worker pending waits are processed in their
own context, and worker failures remain sticky in raw lifecycle state. Complete
Atomics and waitAsync selections remain to be run after combined validation.

Normative contracts: [DoWait and NotifyWaiter](https://tc39.es/ecma262/2025/multipage/structured-data.html#sec-dowait).
