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

Both scripts run the jobs in [`jobs.sh`](../tools/gate/jobs.sh) one after
another. [CI](#ci) runs the same jobs in parallel. The macOS gate runs:

- static checks: build, compiler catalog, typecheck, boundaries and formatting;
- the `concurrent`, `memory` and `native` test groups
  ([classification](#classifying-a-test-file)), the memory group after the
  selfhost subset (`complete native compiler pipeline`) so a broken native
  pipeline fails within seconds;
- the storage tests;
- the self-build fixpoint: the Node-hosted pipeline builds stage 1 from a
  fresh source snapshot, stage 1 builds stage 2 from that snapshot under LLDB,
  and the gate requires `stage1 == stage2` byte for byte;
- the [Test262 smoke](test262-runner.md#pre-merge-host-smoke): one file,
  strict and sloppy, through the frozen Node-hosted toolchain with linked
  Script units. Both variants must pass and no batch may fall back to
  whole-program linking.

The Linux gate runs the build, the storage tests and the self-build fixpoint.

Stage 1 is the Node-hosted pipeline's build of the compiler and stage 2 is
the native compiler's build of the same sources. `stage1 == stage2` shows
that the two pipelines produce identical output and that the native compiler
reproduces itself. It implies `stage2 == stage3`, because stage 3 would be
the same bytes running on the same input, so the gate no longer builds
stage 3.

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
The exclusive lock at `~/.t3/tint-gate.lock` is the launch lock that
[`with-lock.sh`](#timing-and-profiling-on-the-shared-mac) queues for.
Exclusive gate steps and Test262 smoke launches join that queue; native
fixture launches probe the lock directly. The gate uses `/usr/bin/lockf -k`
for every acquisition so the exclusive pathname and memory slot inodes
survive release. Use `-k` for manual acquisitions and keep those lock files
in place.

The gate bounds native test file concurrency to limit simultaneous fixture
builds and contention for LLDB admission. Set `TINT_GATE_NATIVE_CONCURRENCY`
to override the default of three workers for the macOS gate. Standalone
`pnpm check:exclusive` and the macOS CI runner default to two. The macOS gate prints the effective limit and records
it in `check-native-concurrency.txt`. Fixture builds use the memory semaphore
and release the slot before taking the exclusive lock for admission and
execution. `native-images.jsonl` records path, bytes, image SHA-256, build
time, memory and exclusive waits, admission and execution. Phase start records survive a
cancelled batch. The gate prints distinct built, admitted and launch-attempted
path counts. Hosted callers can set `TINT_BUILD_ONLY=defer-admission` to
produce an image without LLDB admission. `TINT_BUILD_ONLY=1` still admits
Darwin images before returning. Test262 smokes also separate building from
admission and execution.

Hosted fixture builds in one test process share the parsed workspace modules
and the compiled allocator and runtime while the workspace sources are
unchanged. Neither depends on the fixture program (`BuildRequest.runtimeUnits`
in `packages/compiler/src/build.ts`), and images are byte-identical to builds
that compile them again (`tools/fixture-cache.test.ts`). Set
`TINT_FIXTURE_CACHE=0` to start every build from scratch.

Native fixtures launch under LLDB through `tint_start`
(`tools/lldb/native_launch.py`; `lldbStartCommands` in `tools/lldb-launch.ts`
builds the batch arguments). It launches the target with its usual settings and
the stop-at-entry flag through the SB API, fails unless the process is then
stopped, and leaves it stopped for the following commands. In batch mode
`process launch --stop-at-entry` costs about two seconds more per launch, which
dominated short fixture runs.

The macOS stage 2 build takes the exclusive lock for its LLDB invocation.
LLDB attaches and debugserver launches can fail under concurrent load, so
these invocations are serialized with native fixture launches and other
exclusive steps. Node bootstrap and toolchain freezes use a memory slot, and
byte comparisons run unlocked.

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
admission queue. The unlocked Linux stage 2 build uses the stage timeout as
well.

The macOS gate also watches launch-lock holders for 120 seconds of no
progress. It observes the identified inferior's accumulated CPU time, so a
stopped or blocked inferior can time out even while its profiler is busy.
If the inferior is still launching, it watches the debugger, then falls
back to the command tree for jobs without a debugger. An idle stall exits 125. An active deadline exits 124. The watchdog snapshots process
state and CPU time, attempts a bounded five-second `sample`, and kills the
command tree, including the debugger and inferior. The gate records the
step in `stalls.tsv`, `stall-<step>.txt`, and the final summary.

Each gate creates a fresh `.tint-bootstrap/gate.*` evidence directory and
prints its path, commit, and timestamped step results with wall time including
queue time. On macOS
the final line reports total exclusive lock hold in milliseconds, excluding
queue time. `locks.tsv` records the step, lock path, UTC epoch acquisition
time in milliseconds, and hold duration excluding queue time. Use the
`stage2` exclusive-lock row to revisit the bootstrap timeout. The logs
include exit statuses, self-build SHA-256s and the Test262 report. Each test
group also writes `<step>-files.tsv`: per test file, its top-level test count
and the sum of their durations in milliseconds. Durations include waits for
memory slots and the launch lock; the native journal separates them. The gate
stops on the first failed step.

## CI

[`ci.yml`](../.github/workflows/ci.yml) runs the static checks once on Linux
x86-64 and calls [`gate.yml`](../.github/workflows/gate.yml) for each target:
macOS arm64, Linux x86-64 and Linux arm64. Each step runs one
[`ci.sh`](../tools/gate/ci.sh) job on a fresh runner:

| Job                    | Runner                | Needs                     | Runs                                                     |
| ---------------------- | --------------------- | ------------------------- | -------------------------------------------------------- |
| `bootstrap`            | Linux (macOS: x86-64) |                           | build, storage tests, stage 1; packs the bundles         |
| `fixpoint`             | target                | `bootstrap`               | stage 2 under LLDB, `cmp stage1 stage2`                  |
| `tests (N/2)` (macOS)  | macOS arm64           | `bootstrap`               | one `concurrent` and one `memory` shard                  |
| `native (N/3)` (macOS) | macOS arm64           | `bootstrap`               | one native fixture shard                                 |
| `test262-host` (macOS) | Linux x86-64          |                           | build, freeze, compile the Darwin units host             |
| `test262` (macOS)      | macOS arm64           | `bootstrap, test262-host` | link and run the Test262 smoke on the precompiled host   |
| `result`               | Linux                 | all                       | fails unless every job that applies to the target passed |

The Linux targets run `bootstrap` and `fixpoint`, the checks of
[`linux-gate.sh`](../tools/gate/linux-gate.sh); `result` requires their other
jobs to be skipped and every macOS job to succeed. The first `tests` shard
starts with the selfhost subset.

A macOS run takes seven macOS runners, each for one group, and none before
its Linux jobs end. GitHub's free plan runs five macOS jobs at a time for the
whole organization; small separate jobs let runs share that pool as runners
free up, rather than hold a runner for groups run in turn. Node runs 2–2.5
times slower on macOS runners than on Linux x86-64, so a Linux x86-64 runner
builds the Darwin stage 1 (`--target darwin-aarch64`), which is byte-identical
to a macOS build (see [the measurements](results/ci-fast-gate-v1.md)); the
macOS fixpoint then builds stage 2 with it, so `stage1 == stage2` also shows
that the Node-hosted build does not depend on its host.

Every job uploads its evidence directories (`evidence-<target>-<job>`)
without build products; a failed fixpoint also uploads both stages.

The bootstrap job packs two bundles: `build` (each package's `dist` and build
info) and `stage1` (stage 1 and the source snapshot it was built from). It
reports each bundle's SHA-256 and stage 1's SHA-256 as job outputs. A job
that consumes a bundle receives the reported SHA-256 from the workflow and
fails unless the downloaded file matches it and records this commit; the
fixpoint also checks stage 1's own SHA-256. The target's other jobs do not
rebuild: the native fixtures, workspace tests and Test262 use the bootstrap
job's Node-hosted compiler build, and stage 2 is built by its stage 1.

The units host needs about 7.5 GB, more than the 7 GiB of a macOS runner,
where it swapped for over 20 minutes. The `test262-host` job runs beside the
bootstrap job on a 16 GiB Linux x86-64 runner. It builds the workspace,
freezes the toolchain and compiles the Darwin host with
`TINT_TEST262_UNIT_HOST=prepare` and `TINT_NATIVE_TARGET=darwin-aarch64`, then
uploads the cache entry. The macOS `test262` job starts when both the host
and bootstrap jobs end; it checks the bundle's SHA-256, freezes the toolchain
from the bootstrap job's build, fails unless that toolchain's SHA-256 equals
the one the host was compiled with (so both builds are identical), and runs
the smoke with `TINT_TEST262_UNIT_HOST=require`, so it can only link and run.

A CI job owns its runner. Its launch lock and memory slots live under
`$RUNNER_TEMP`, so no other job waits on them, but they still order LLDB
launches and fixture builds within the job. macOS jobs use one memory slot,
two native test workers and a 5,120 MB Node heap.

`node tools/check-test-files.ts GROUP --shard=INDEX/COUNT` selects one shard
of a group. Shards balance the per-file costs in
[`test-costs.json`](../tools/gate/test-costs.json): longest files first, each
to the lightest shard, with unknown files weighing the median cost. Every
file still runs in exactly one shard. Native costs are each file's image
builds, admissions and executions from the fixture journal, which leave out
memory-slot and launch-lock waits; refresh them with
`node tools/gate/native-costs.ts <native-images.jsonl>...` from the native
shards' evidence of a recent run when shards drift apart. Memory costs are
the `check-memory-files.tsv` duration sums; concurrent files are short and
weigh the default.

## Timing and profiling on the shared Mac

Use the watched lock wrapper for commands that need either shared lock.
Every job that needs both locks must use `with-lock.sh both`. Do not nest
lock requests: the wrapper refuses a request from inside another wrapper's
command, and nested `lockf` commands hold the first lock for the entire wait
on the second. Prepare images and unrelated inputs before entering the
wrapper. Pass the complete foreground command so the watchdog owns its
descendants.

```sh
tools/gate/with-lock.sh both frozen-v7 \
  node tools/frozen-workload.ts run v7 base candidate --rounds 3

tools/gate/with-lock.sh both profile-stage \
  pprofessor run --no-publish --output stage.pb.gz -- "$image" "$source" "$output"
```

`launch` uses the native launch lock, `timing` uses the timing lock, and
`both` uses both. All three join one first-in, first-out queue in the
`tint-gate-queue` directory beside the launch lock (`TINT_GATE_LOCK_QUEUE`
overrides it). Each request takes a numbered ticket and waits until every
earlier ticket that shares a lock with it has finished. A later launch-only
or timing-only request therefore never overtakes an earlier `both` request,
even while the lock it needs is idle. Requests with disjoint locks run
concurrently. At the front of the queue a request takes timing and then
launch, keeping timing while it waits in the launch lock's kernel queue.

Run this to see who holds each lock and what each queued request waits for:

```sh
tools/gate/with-lock.sh status
```

The queue cannot deadlock or starve a request. A ticket waits only for
earlier tickets, and two tickets that share a lock never reach the front
together. At the front, a request waits only for callers outside the queue,
none of which holds launch while waiting for timing. Each request runs after
the finite set of earlier conflicting tickets, each bounded by its watchdog.

Each ticket is a file that its owner flocks for as long as it lives. A
request waits for an earlier ticket by blocking on that lock, so the kernel
wakes it when the owner exits for any reason. The next request or `status`
call to find a ticket left by a killed process removes it. Killing a wrapper
releases its locks, and a lockf helper still waiting on its behalf exits once
it gets its lock.

The kernel locks still exclude callers outside the queue: raw `lockf -k`
commands, native fixture launches in the gate, and wrappers from checkouts
that predate the queue. Those callers are not ordered with queued requests.
Run the wrapper from an up-to-date checkout.

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
share the same inodes. Adopt the wrapper to get a place in the queue and
no-progress detection for those jobs.

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
