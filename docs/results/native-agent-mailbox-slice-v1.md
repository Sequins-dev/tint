# Native agent copied mailbox validation

The raw agent mailbox preserves strings as UTF-16 code units. Facades, scratch
arrays and reconstructed strings belong to one managed context. Only a scalar
registry descriptor and raw mappings cross threads. Publication uses the same
sequentially consistent scalar mutex as detachment. Payload preparation and managed
allocation happen before acquiring that mutex; the receiving owner detaches before
allocating its string and unmaps the payload after copying, including abrupt exits.
The registry remains mapped until all agents have joined.

Three red-first semantic tests cover exact strings (including NUL, astral
characters and lone surrogates), FIFO across independent facades, allocation
failure without publication, payload release and descriptor validation. They pass.
The native [four-producer fixture](native-agent-mailbox-v1.json) runs 400 copied
messages through isolated worker contexts while the root drains the queue. It
asserts per-producer FIFO and exact code units, joins all four workers and exits42.
Initial-stop and final-exit assertions passed under direct LLDB containment. This
is runtime regression evidence, not unchanged Test262 conformance.

The first build driver failed to resolve its fixture module because its relative
path climbed too far. No compiler or native inferior started in that attempt.
The corrected build uses the same production graph fingerprint as the fresh
[frozen toolchain](frozen-node-toolchain-cluster-k-resumed-v1.json). Both local
build logs remain in `.tint-bootstrap/cluster-k/build-mailbox-v{1,2}.log`.

This is a prerequisite for the agent host. Worker lifecycle handshakes, broadcast
retrieval acknowledgement, Script realm installation and asynchronous wait jobs
remain to be connected. The mailbox is currently an internal runtime module.
