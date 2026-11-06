# Native scalar waiter registry

The production registry reuses the raw shared-memory host and exact metadata
accessors already used for shared blocks. Those helpers now live in one internal
module; the existing public shared-block entry reexports the same host contracts.
Each context constructs its own managed facade and scratch. No managed value is
stored in registry memory or passed to another thread.

Registration performs its whole-width payload comparison and enrollment under
one lock. Notification selects the oldest matching registration, not the lowest
free-slot index. Width validates access but does not divide a shared location into
separate queues. Terminal states have single ownership, tokens never repeat, and
consuming a terminal result allows its row to be reused. Count zero still takes
the registry lock. Kernel park/wake is advisory and leaves state authoritative.

Four red-first semantic tests failed for the missing public factory, then passed.
The combined registry/shared backing tests pass 17/17 (exit 0). `pnpm build` and
the targeted test TypeScript check pass (exit 0). The
[native fixture](native-wait-registry-v1.json) exits 42 under LLDB. Two isolated
workers attach through copied scalar descriptors, enroll Int32/BigInt64 locations,
receive FIFO notifications, poll/park, consume their results and join. The parent
also verifies exclusive timeout completion. Mappings remain owned through engine
shutdown; premature reclamation and foreign consumption are not granted by this
trusted capability.

The first native fixture build failed before execution with `retained declaration
depends on instance state: @27:value:11`. The fixture had incorrectly declared the
ordinary registry factory as a retained runtime provider. Existing shared-service
fixtures retain only raw host leaves. Following that existing boundary fixed the
fixture configuration; no compiler relaxation or source workaround was added.
The [first tool snapshot](frozen-node-toolchain-wait-registry-v1.json) and
[corrected tool snapshot](frozen-node-toolchain-wait-registry-v2.json) are retained.

This is a native infrastructure slice. Script Atomics adapters, the native
Test262 agent host, asynchronous owner-agent delivery, full workspace gates and
its frozen self-build remain outstanding. It is not merge-ready yet and does not
establish any new Test262 agent passes.

The concurrent full gate attempt retained three test failures after the host
extraction: a captured-export test still tried to remove a function declaration
from the public facade, and two factory-binding audits still read the old body
location. The export test now removes only the public reexport while retaining
its private implementation, strengthening the intended capability check. The
body audits read the extracted host implementation. Focused provider tests pass
3/3 and registry/factory audits pass 6/6 (exit 0). Full gates must still be rerun
at the completed waiting slice's merge-ready point.
