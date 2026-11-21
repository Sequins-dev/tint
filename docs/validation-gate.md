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
for an admission slot before building or running tests. The active budget
is 3,600 seconds (`TINT_GATE_BUDGET`). It excludes admission, memory and
launch acquisition, including Test262 smoke launches, and periods when
every native test worker is queued. A gate can wait for a shared lock as
long as needed. An active budget expiry exits 124, names the step, and
records the deadline in `budget.tsv` when evidence exists.
Each `gate-step` line reports active and queued milliseconds for that step.
The final `gate-budget` line reports the totals, including time spent
waiting for admission.

The macOS gate runs ordinary builds and checks without locks. Its memory
semaphore uses `TINT_GATE_MEMORY_SLOTS` slots (default three) shared across
checkouts in `~/.t3/tint-gate-memory`. Use the same count for all gates on
the host. Node bootstrap, frozen toolchain preparation, and heavy test
builds use this semaphore. An occupied semaphore waits between probes.
The exclusive lock at `~/.t3/tint-gate.lock` is shared with legacy gate
callers. The gate uses `/usr/bin/lockf -k` for every acquisition so the
exclusive pathname and memory slot inodes survive release. Use `-k` for
manual acquisitions and keep those lock files in place.

The gate bounds native test file concurrency to limit simultaneous fixture
builds and contention for LLDB admission. Set `TINT_GATE_NATIVE_CONCURRENCY`
to override the default of three workers for the macOS gate. Standalone
`pnpm check:exclusive` and the macOS CI runner default to two. The macOS gate prints the effective limit and records
it in `check-native-concurrency.txt`. Fixture builds use the memory semaphore
and release the slot before taking the exclusive lock for admission and
execution. `native-images.jsonl` records path, bytes, build time, memory and
exclusive waits, admission and execution. Phase start records survive a
cancelled batch. The gate prints distinct built, admitted and launch-attempted
path counts. Hosted callers can set `TINT_BUILD_ONLY=defer-admission` to
produce an image without LLDB admission. `TINT_BUILD_ONLY=1` still admits
Darwin images before returning. Test262 smokes also separate building from
admission and execution.

Each macOS native bootstrap stage takes the exclusive lock for its LLDB
invocation. LLDB attaches and debugserver launches can fail under concurrent
load, so these invocations are serialized with native fixture launches and
other exclusive steps. Node bootstrap and toolchain freezes use a memory
slot, and byte comparisons run unlocked.

The watchdog starts when a step begins running. The native batch watchdog
pauses while every active test file worker waits for a memory slot or the
exclusive lock. If any worker is building or executing, that interval counts
once as active wall time.
Build, admission and execution continue to count against its deadline.
DevTools sessions wait asynchronously for the launch lock. Their test
deadlines start after admission in the gate.
The batch logs active time and all-worker queue time (wall time), and the
per-image journal logs individual lock waits.
Defaults are 1,800 seconds per bootstrap stage (`TINT_GATE_STAGE_TIMEOUT`),
1,800 seconds for the native test batch (`TINT_GATE_NATIVE_TIMEOUT`), and
600 seconds per Test262 admission or execution launch (`TINT_GATE_SMOKE_TIMEOUT`).
The smoke deadline allows for contention in the host's first-launch
admission queue. Both unlocked Linux native bootstrap stages use the stage
timeout as well.

The macOS gate also watches launch-lock holders for 120 seconds of no
progress. It observes the identified inferior's accumulated CPU time, so a
stopped or blocked inferior can time out even while its profiler is busy.
If the inferior is still launching, it watches the debugger, then falls
back to the command tree for jobs without a debugger. An idle stall exits
125. An active deadline exits 124. The watchdog snapshots process
state and CPU time, attempts a bounded five-second `sample`, and kills the
command tree, including the debugger and inferior. The gate records the
step in `stalls.tsv`, `stall-<step>.txt`, and the final summary.

Each gate creates a fresh `.tint-bootstrap/gate.*` evidence directory and
prints its path, commit, and timestamped step results with wall time including
queue time. On macOS
the final line reports total exclusive lock hold in milliseconds, excluding
queue time. `locks.tsv` records the step, lock path, UTC epoch acquisition
time in milliseconds, and hold duration excluding queue time. Use the
`stage2` and `stage3` exclusive-lock rows to revisit the bootstrap timeout. The logs include exit statuses,
self-build SHA-256s and both Test262 reports. The gate stops on the first
failed step.

## Timing and profiling on the shared Mac

Use the watched lock wrapper for commands that need either shared lock.
Every job that needs both locks must use `with-lock.sh both`. Nesting
`lockf` commands holds the first lock for the entire wait on the second.
Prepare images and unrelated inputs before entering the wrapper.
Pass the complete foreground command so the watchdog owns its descendants.

```sh
tools/gate/with-lock.sh both frozen-v7 \
  node tools/frozen-workload.ts run v7 base candidate --rounds 3

tools/gate/with-lock.sh both profile-stage \
  pprofessor run --no-publish --output stage.pb.gz -- "$image" "$source" "$output"
```

`launch` uses the native launch lock, `timing` uses the timing lock, and
`both` runs only when it can acquire both. Single-lock calls join the blocking
`lockf -k` queue. Dual-lock calls probe launch and then timing without
blocking. If a probe fails, they release all acquired locks and join the
busy lock's blocking pathname queue, then retry the complete set.
A queued job keeps its place until the busy lock is available or the wrapper
is interrupted. The wakeup does not reserve either lock for the next probe.
The wrapper starts both deadlines after acquisition. Set `TINT_GATE_IDLE_TIMEOUT` for a
workload that intentionally goes without CPU progress for longer than 120
seconds. The hard holder deadline is `TINT_GATE_STEP_TIMEOUT` and defaults to
3,600 seconds. `TINT_GATE_EVIDENCE` can name an existing directory. By default
the wrapper creates a temporary evidence directory and prints the report
path on a stall. For a command whose inferior cannot be located from the
debugger process tree, set `TINT_GATE_INFERIOR_PID_FILE` to a fresh file and
write the inferior PID there at launch.

See [profiling](profiling.md#profiling-a-verified-compiler) for how to verify an
image under LLDB before sampling it. Existing raw `lockf -k` callers still
share the same inodes. Adopt the wrapper to get no-progress detection for
those jobs.

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
