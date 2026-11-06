# Cluster K agent implementation paused (WIP)

The user paused K to save host memory. This branch contains unfinished production
runtime work and is not claimed merge-ready. No self-build on the rebased source
has completed. The cancelled queued combined self-build never began stage1.

Implemented native regressions cover isolated hosted thread contexts (including
collector roots, permanent domains and independent executable mappings), Darwin
raw parking, scalar FIFO waiter registration and cross-agent synchronous
Atomics.wait. Their immutable manifests and observations are committed alongside
the slice reports. The last completed full wrapped workspace check passed all
4527 tests, types, boundaries and formatting before the copied mailbox addition.

The final unintegrated experiment is `packages/native-runtime/src/agent-messages.ts`.
It maps UTF-16 source/report payloads outside managed heaps, publishes a raw FIFO
under a scalar mutex, copies into the receiver's heap and frees detached payloads.
It preserves NULs, astral characters and lone surrogates. Three red-first focused
Node tests now pass. It has no public host integration, native fixture or frozen
self-build yet. Treat it as WIP. The source catalog includes it; no new dependency
or public package export was introduced.

Remaining work includes raw worker lifecycle and broadcast handshakes, Script
realm installation and worker evaluation, exact SharedArrayBuffer/BigInt message
reconstruction, error/timeout containment, owner-agent async waiter completion,
and complete Atomics/waitAsync reruns. Positive waitAsync and `$262.agent` remain
unsupported in the Test262 host. Existing synchronous waiting authority must also
be explicitly installed by that host; it is currently exercised by the native
fixture rather than the unchanged Test262 adapter.

Held coverage journal: `.tint-bootstrap/cluster-k/typedarray-v1.jsonl`, frozen
`toolchain-v1`, 196/2890 observed, 187 passes and 9 infrastructure nonpasses.
Completed subdirectory reports are canonical extracts from that one journal,
retain every nonpass, and overlap the held parent. They must not be added to the
parent total. TypedArrayConstructors has not started. LLDB launch failures and
host-load timeouts must be rechecked separately without rewriting old reports.
