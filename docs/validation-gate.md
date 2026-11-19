# Validation gate

Run `pnpm check` for the workspace gate. Run `pnpm check:concurrent` for
type checks, boundaries, formatting, and load-tolerant tests, or
`pnpm check:exclusive` for tests with heavier builds, native launches, or
timing dependencies. The two commands cover the same file patterns as
`pnpm test`. Standalone pnpm commands leave host coordination to the caller.

Use Node 24.12.0 and install the pinned workspace dependencies first. From
the checkout being validated, run `tools/gate/mac-gate.sh` on macOS arm64.
Set `TINT_GATE_TEST262` to the pinned Test262 checkout if it is outside the
usual bootstrap directory. On the Linux dev machine run
`tools/gate/linux-gate.sh` from the corresponding checkout. Use separate
checkouts for parallel gates so each build can update its own TypeScript
output. Run the gate on a fixed source tree.

The macOS gate runs ordinary builds and checks without locks. Its memory
semaphore uses `TINT_GATE_MEMORY_SLOTS` slots (default three) shared across
checkouts in `~/.t3/tint-gate-memory`. Use the same count for all gates on
the host. Node bootstrap, frozen toolchain preparation, and heavy test
builds use this semaphore. An occupied semaphore waits between probes.
The exclusive lock at `~/.t3/tint-gate.lock` is shared with legacy gate
callers. The gate uses `/usr/bin/lockf -k` for every acquisition so the
exclusive pathname and memory slot inodes survive release. Use `-k` for
manual acquisitions and keep those lock files in place.

The gate runs all native-launch and timing-sensitive test files in one
locked batch with the usual Node test concurrency. This keeps fixture
builds and debugger sessions together and queues one waiter per gate.
Separating those builds from their launches is future work. Test262 units
and program smoke runs build their images under the semaphore and acquire
the exclusive lock for admission and execution. Each native bootstrap
stage takes the exclusive lock for its own LLDB invocation. That invocation
produces the next stage's image. Toolchain freezes and byte comparisons run
outside the exclusive lock.

Each gate creates a fresh `.tint-bootstrap/gate.*` evidence directory and
prints its path, commit, timestamped step results, and wall time. On macOS
the final line reports total exclusive lock hold in milliseconds, excluding
queue time. `locks.tsv` records the step, lock path, UTC epoch acquisition
time in milliseconds, and hold duration. The logs include exit statuses,
self-build SHA-256s and both Test262 reports. The gate stops on the first
failed step.

## Classifying a test file

Update [the test manifest](../tools/check-test-files.json) when adding,
moving, or changing a test. Read the test and follow the helper it calls.
Direct process operations, debugger helpers, wall-clock deadlines, native
publication, and full compilation passes determine which resource it needs.

| Group | Evidence to look for |
| --- | --- |
| `concurrent` | In-process assertions, isolated temporary files, byte emission without executing the image, and bounded work with no wall-clock deadline. Untimed Node reference commands and static inspection tools can also run here. |
| `memory` | Full workspace or managed/JIT compilation and large fixtures without timed execution, such as `selfhost-linked` and `managed-jit-entry`. |
| `native` | Native image execution, LLDB/GDB, signal and deadline tests, or fixtures that combine native builds and execution. Examples include `native-process-launch`, `native-ffi`, `runtime-diagnostics`, and the DevTools tests. |

The test selector uses the same two globs as the original workspace gate
and rejects missing, duplicate, or unclassified entries before running
either half. The manifest test also exercises this check under `pnpm test`.
