# Native hosted thread lifecycle slice

The implementation adds opt-in `BuildRequest.threaded`, an image-owned pthread
entry thunk and explicit `thread-start` / `thread-join` bindings. Darwin symbols
come from `PosixHostABI.threads`; targets without lifecycle authority reject the
request. The worker thunk initializes independent hosted stack/guard pages, heap,
collector metadata, roots, module instance and ownership domain. The process
invokes the application with scalar zero; workers receive only a raw scalar or
mailbox address. Managed callbacks and managed arguments are outside this ABI.

## Validation so far

- Red-first host binding test failed because `thread-start` was unknown.
- Red-first hosted worker test failed the old zero-argument startup contract.
- Red-first platform-policy test showed missing lifecycle authority was accepted;
  the implementation now rejects it.
- Focused host/startup tests: 8/8, exit 0.
- `pnpm build`: exit 0 after correcting exact-optional-property typing.
- `pnpm exec tsc -p tsconfig.tests.json`: exit 0.
- [Initial native fixture](native-isolated-thread-lifecycle-v1.json): completed
  under the existing LLDB containment adapter, exit 42.
- [Barrier native fixture](native-isolated-thread-lifecycle-v2.json): completed,
  exit 42. Eight workers announce readiness using native atomic operations and
  wait at a shared raw barrier before allocation stress. This guarantees live
  context overlap when checking distinct domains and root chains. Each performs
  1,000 copying-GC allocations while retaining a live array. A separate managed
  throwing worker returns status 70, and its parent subsequently succeeds.
- Full slot-wrapped gates and frozen native self-build remain queued/running.
  This slice is not yet merge-ready.

Both native reports retain the build-time manifest and exact fixture source hash.
The [v2 compiler snapshot](frozen-node-toolchain-thread-host-v2.json) and
[v3 barrier-tool snapshot](frozen-node-toolchain-thread-host-v3.json) have identical
portable source graphs. The v3 tool snapshot changes only fixture orchestration.

## Retained failed observations

The first direct fixture orchestration attempt exited 1 before compilation:
Node `process.chdir` rejected a URL object. The wrapper now supplies a path.
The next build exited 1 while parsing the portable graph: line 3819 of
`packages/codegen/src/aarch64/scalar/index.ts` used `threads!.createSymbol`, and
Tint reported `expected )`. No native execution began. Removing that unnecessary
non-null assertion restored graph admission. The earlier
[v1 frozen snapshot](frozen-node-toolchain-thread-host-v1.json) is retained; it is
not the snapshot used for passing native evidence.

The original workspace check exited 1 with 4,503/4,504 tests passing because the
fresh worktree lacked `.tint-bootstrap/test262`. A symlink to the unchanged pinned
checkout repaired setup, and its focused module-graph file then passed 10/10.
No source fix was made for this environment failure.

## Remaining boundaries

This is generic native lifecycle infrastructure, not an installed `$262.agent`
host. Each worker application must create its own ScriptAgent/realm/job queues and
executable arena. Waiter registration, futex-style parking/wake, copied mailboxes,
broadcast/report API and an external-event pump are subsequent slices. Unsafe
asynchronous thread cancellation is deliberately absent; whole-variant process
containment owns native faults and deadlines. Raw mailbox/code owners must retain
storage until all referencing threads join.
