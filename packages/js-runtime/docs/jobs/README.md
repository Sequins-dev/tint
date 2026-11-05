# Job queue

A dependency-free FIFO queue with explicit, non-reentrant checkpoints. Enqueuing
never invokes code. `drainJobs` runs queued entries in order, including entries
appended during the checkpoint. Each entry carries an opaque host context; the
executor owns entering/restoring the appropriate realm and Script/module context.

Consumed entries are unlinked before execution. If the executor throws, that error
propagates, the checkpoint guard clears, and later entries remain available without
replaying the failed entry. A host that reports errors and continues should catch
inside its executor. The queue does not impose an error-reporting policy.

This primitive supports Promise-job scheduling but does not itself implement
Promises, rejection tracking, timers, an event loop, or execution-context stacks.
The host must only begin a checkpoint when no JavaScript computation is running;
the reentrancy guard prevents nested drains, not arbitrary host misuse.

Native validation: `tools/verify-hosted-jobs.ts` checks deferred execution, ordering,
context capture, nested drains, exceptions, 100,000 self-scheduled jobs, and
retention of queued object contexts while another queue creates allocation pressure.

Specification contract: [Jobs and HostEnqueuePromiseJob](https://tc39.es/ecma262/multipage/executable-code-and-execution-contexts.html#sec-hostenqueuepromisejob).
