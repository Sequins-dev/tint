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

At most two full macOS gates are admitted at a time. Additional gates wait
for an admission slot before building or running tests. The total wall
budget is 3,600 seconds (`TINT_GATE_BUDGET`, in seconds), including admission
and lock waits. When it expires the gate exits with status 124 and reports
the active step or the admission wait. If the gate has started writing
evidence, it also records the timeout in `budget.tsv`.

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
exclusively locked batch. The gate bounds Node test file concurrency because
concurrent LLDB and debugserver launches can overwhelm macOS admission even
while the batch holds the exclusive lock. Set `TINT_GATE_NATIVE_CONCURRENCY`
to override the default of two workers for the locked batch or standalone
`pnpm check:exclusive`. The macOS gate prints the effective limit and records
it in `check-native-concurrency.txt` alongside `locks.tsv`.
Separating those builds from their launches is future work. Test262 units
and program smoke runs build their images under the semaphore and acquire
the exclusive lock for admission and execution.

Each macOS native bootstrap stage takes the exclusive lock for its LLDB
invocation. LLDB attaches and debugserver launches can fail under concurrent
load, so these invocations are serialized with the native test batch and
other exclusive steps. Node bootstrap and toolchain freezes use a memory
slot, and byte comparisons run unlocked.

The watchdog starts when a step begins running, after any resource wait.
Defaults are 1,800 seconds per bootstrap stage (`TINT_GATE_STAGE_TIMEOUT`),
1,800 seconds for the native test batch (`TINT_GATE_NATIVE_TIMEOUT`), and
600 seconds per Test262 admission or execution launch (`TINT_GATE_SMOKE_TIMEOUT`).
In a reference run, the gate held the
exclusive lock for 252 seconds for the batch and at most 2.2 seconds per smoke
launch. The smoke deadline allows for contention in the host's first-launch
admission queue. Both unlocked Linux native bootstrap stages use the stage
timeout as well.

On macOS the watchdog attempts a five-second process sample before killing the
stalled command tree, including the debugger and inferior. The sample itself
has a bounded deadline. A timeout releases the held resource, fails the gate,
and records the step in `stalls.tsv`, `stall-<step>.txt`, and the final summary.

Each gate creates a fresh `.tint-bootstrap/gate.*` evidence directory and
prints its path, commit, and timestamped step results with wall time including
queue time. On macOS
the final line reports total exclusive lock hold in milliseconds, excluding
queue time. `locks.tsv` records the step, lock path, UTC epoch acquisition
time in milliseconds, and hold duration excluding queue time. Use the
`stage2` and `stage3` exclusive-lock rows to revisit the bootstrap timeout. The logs include exit statuses,
self-build SHA-256s and both Test262 reports. The gate stops on the first
failed step.

## Classifying a test file

Update [the test manifest](../tools/check-test-files.json) when adding,
moving, or changing a test. Read the test and follow the helper it calls.
Direct process operations, debugger helpers, wall-clock deadlines, native
publication, and full compilation passes determine which resource it needs.

| Group        | Evidence to look for                                                                                                                                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `concurrent` | In-process assertions, isolated temporary files, byte emission without executing the image, and bounded work with no wall-clock deadline. Untimed Node reference commands and static inspection tools can also run here.  |
| `memory`     | Full workspace or managed/JIT compilation and large fixtures without timed execution, such as `selfhost-linked` and `managed-jit-entry`.                                                                                  |
| `native`     | Native image execution, LLDB/GDB, signal and deadline tests, or fixtures that combine native builds and execution. Examples include `native-process-launch`, `native-ffi`, `runtime-diagnostics`, and the DevTools tests. |

The test selector uses the same two globs as the original workspace gate
and rejects missing, duplicate, or unclassified entries before running
either half. The manifest test also exercises this check under `pnpm test`.
