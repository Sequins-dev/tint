# Native agent worker host (integration in progress)

The public `@tint/native-runtime/agents` entry exposes local facades for raw worker
lifecycle and copied mailbox services. A root owns the registry and supplies its
thread/clock adapter explicitly. Each worker attaches from its raw record address,
copies source, publishes readiness, reports through a copied FIFO, acknowledges
broadcast retrieval before invoking any Script callback, and publishes leaving.
The root joins completed workers and checks their exit status. Startup and
broadcast handshakes use monotonic deadlines; no asynchronous thread cancellation
attempts to unwind a managed heap. Raw registry and mailbox mappings remain mapped
through engine shutdown, after every referencing agent has exited.

Only scalar shared-block/waiter descriptors cross into a worker. It constructs
new descriptor objects and must attach a new service facade in its own context.
Int32 and BigInt broadcast identifiers travel as copied text with a separate type
tag; the Script adapter remains responsible for normative conversion and local
reconstruction. Distinct raw queues hold broadcasts and failure diagnostics, so
an unreceived broadcast cannot be mistaken for an exception. Failure status is
sticky even when allocating the diagnostic fails. Unpublished startup allocations
roll back before a thread can observe their addresses.

Semantic tests cover readiness, source/report exactness, bounded waits, sticky
failures, native exit statuses, retrieval acknowledgement, descriptor identity,
allocation failure and queue rollback. Native fixtures separately pass four-worker
[start/report/join](native-agent-lifecycle-v1.json) and
[broadcast retrieval](native-agent-broadcast-v2.json). Their manifests identify
exact source snapshots; later safety refinements require a fresh native build.

Initial native build attempts found two checker restrictions (optional union
assignment and a loop-carried optional value) and an incorrect fixture host
operation name (`clock-monotonic` instead of the existing `monotonic-time`). No
inferior started for those attempts. Build logs v1-v4 are preserved under
`.tint-bootstrap/cluster-k/`. Later fixture builds and native observations remain
separate, immutable evidence. This commit is not a claim that `$262.agent` or
Atomics.waitAsync is installed in the Test262 host. That bridge, a fresh frozen
self-build and full gates remain for this worker-host slice.
