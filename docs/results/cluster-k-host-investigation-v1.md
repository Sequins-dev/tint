# Cluster K native host investigation

This is a source investigation, not a native conformance run. The measurement
snapshot is recorded in `frozen-node-toolchain-cluster-k-v1.json`; exact pinned
selection/subdirectory populations and historical report candidates are recorded
in `cluster-k-selection-inventory-v1.json`.

## Established contracts

- `tools/test262-native.ts` creates child **realms** using the parent's
  `ScriptAgent`. `$262.createRealm` therefore cannot implement `$262.agent.start`.
  `installRealmHost` does not expose an `agent` property.
- `packages/js-runtime/src/objects/jobs.ts` owns an agent's execution context,
  job queue, kept objects, weak storage and module evaluation counter. Native
  workers must have independent instances and managed heaps; shared raw backing
  must contain no managed references.
- `packages/js-runtime/src/bytes/shared.ts` keys notifications by block identity
  plus absolute byte offset. Int32 and BigInt64 widths do not create separate
  waiter lists. Its current capability covers notify, not waiter enrollment.
- `packages/native-runtime/src/shared-blocks.ts` provides create/attach for an
  engine-scoped raw registry. Payload descriptors contain native addresses;
  attaching the registry alone does not map those addresses in another process.
- `packages/codegen/src/aarch64/scalar/index.ts` implements `memory-map` using
  `PosixHostABI.anonymousPrivateFlags`. Existing mapping cannot establish
  cross-process shared backing after fork or exec.
- `prepareAtomicWait` in `objects/atomics-access.ts` implements mismatches and
  nonpositive timeouts after coercions and CanBlock validation. A positive timeout
  with a matching value explicitly rejects unsupported execution. The native
  backing does not provide notification authority either.
- The native Test262 checkpoint drains jobs and returns. It has no external event
  pump, so registering an async waiter without a host event source would leave
  `$DONE` pending. Promise settlement must occur on the owner agent's job queue.

## Required end-to-end behavior

A real host must create isolated native workers, evaluate unchanged worker source,
broadcast shared backing by stable identity, collect FIFO reports, support leaving,
sleep and a monotonic clock, and reclaim workers on completion and failure.
Wait registration must atomically compare and enroll under the same synchronization
used by notify. Notifications and deadlines compete for one terminal waiter state;
normal spurious OS wakes cannot produce observable completions. Async waiters retain
their promise and realm on the owner agent; foreign workers communicate scalar
completion records instead of dereferencing that heap. The event pump must keep
async tests alive until completion or containment timeout. Worker faults must stay
inside native debugger/process containment and remain visible in reports.

There are two possible native isolation extensions: worker threads with independent
managed-context startup and an engine-owned waiter registry, or worker processes
with explicit shareable mappings and descriptor transfer. Neither is available in
the current host ABI. Returning zero from notify or invoking worker source in a
second realm would not implement these contracts.

## Historical observations, retained separately

- ArrayBuffer: 442/442; SharedArrayBuffer: 208/208.
- DataView: 1,110/1,120; ten recorded pre-entry LLDB failures.
- Atomics full baseline: 366/778; 184 failures, 222 harness errors, six pre-entry
  debugger failures. This predates immediate wait/notify changes.
- Newer waitAsync baseline: 88/202; 106 agent-dependent harness errors and eight
  unsupported parking cases, no semantic failures or infrastructure errors.
- No complete saved TypedArray or TypedArrayConstructors family report was found.

These are historical reports on different source snapshots, not current reruns.

## Proposed native thread host boundary

Prefer native worker threads with a fresh hosted managed context per worker. This
reuses the existing address-based block registry in one address space. A thread
entry must initialize its own stack, heap, roots, allocator, permanent domain token
and executable publication arena before creating its ScriptAgent. Reuse the hosted
startup layout and managed-entry contracts rather than calling a managed callback
with the parent's context. Only raw engine registry/queue addresses and scalar
handles cross the startup boundary; worker source is copied into owned storage.

The process-isolation alternative needs explicitly shareable mappings plus a
mapping/descriptor transfer protocol, because current private mappings and raw
addresses are insufficient. The isolation choice changes native startup,
containment and the platform ABI; the coordinator has been asked to choose before
implementation of that boundary. Independent measurement can continue meanwhile.

## Initial workspace validation

`pnpm install` and `pnpm build` exited 0. The first slot-wrapped workspace check
exited 1: 4,503/4,504 tests passed, with the sole failure an absent local
`.tint-bootstrap/test262` path in a module-graph fixture test. Type checks passed;
boundary and format gates did not run after the fail-fast test failure. A local
symlink to the unchanged pinned checkout repaired setup. The focused module-graph
file then passed 10/10 (exit 0). The failed check log remains at
`.tint-bootstrap/cluster-k/check-v1.log`; the complete wrapper rerun uses
`check-v2.log`. No compiler/runtime source was changed by this investigation.

## Coordinator decision

The coordinator selected threads with isolated managed contexts. The requested
sequence is host ABI/lifecycle, wait/notify, `$262.agent`, then complete native
reruns. Each thread owns its heap, collector, roots, realms, jobs and executable
code. No managed value crosses threads. Platform additions must be explicit and
portable, with Darwin arm64 implementation and a future Linux boundary. Lifecycle
and race/stress validation must run under LLDB, and portable compiler/runtime
changes require a frozen native self-build with stage-image comparison.
