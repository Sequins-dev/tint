# Native synchronous Atomics wait

The shared service's explicit waiting capability creates one raw waiter registry
and exposes only a scalar descriptor for agent-local attachment. Its notification
facet uses that same authority. Failed waiter creation rolls back the unpublished
block registry; unconfigured services retain no counterfeit wait/notify facet.

The Script adapter registers exact expected words after conversions and CanBlock
validation, preserves an absolute monotonic deadline, rechecks terminal state after
all advisory kernel returns, and releases enrollment on abrupt host failure.
Positive-timeout asynchronous waiting remains explicitly unsupported until the
owner-agent event path is connected.

Red-first tests reproduced unsupported synchronous parking, then a leaked slot
when the host clock failed. The corrected combined Atomics/backing/registry suite
passes 42/42 (exit 0). `pnpm build`, test TypeScript and host TypeScript checks pass
(exit 0). The [native fixture](native-sync-atomics-wait-v1.json) exits 42 under LLDB:
a Script Atomics.wait is woken by an independent native worker attached through
copied scalar descriptors. The same process checks real deadlines, exact BigInt
expected-word wrapping and immediate mismatch. The build-time manifest identifies
the [rebased frozen toolchain](frozen-node-toolchain-sync-wait-v1.json).

This is regression evidence, not unchanged Test262 agent conformance. The earlier
pre-rebase self-build was explicitly stopped during the host memory emergency;
its [interruption report](cluster-k-selfbuild-interrupted-v1.json) preserves stage1
and profiles without claiming stage2. Final workspace gates and one combined
rebased frozen comparison remain required before the host/waiting range is
merge-ready. Full TypedArray measurement continues independently.
