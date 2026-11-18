# Test262 timeouts under host load (v1)

Branch `perf/test262-load-timeouts`. macOS arm64 (18 CPUs: 6 P + 12 E), Node
24.12.0, `TZ=UTC`, batch size 128, default 60,000 ms containment. Every run used
a frozen toolchain: `tc-main` (main at 3855696d5) or `tc-fix` (this change).
Test262 sources were unchanged.

## Observed failures

The timeouts all had the same shape. The **first launches of a freshly staged
image** timed out at the full containment budget, and later launches of the
same image passed in milliseconds.

| Report                                           | Linking | Timed out                                | Then                          |
| ------------------------------------------------ | ------- | ---------------------------------------- | ----------------------------- |
| convergence `built-ins/Map` (383/405)            | units   | first 10 of batch 0, first 12 of batch 2 | rest of each batch passed     |
| convergence concat `large-typed-array` (0/2)     | units   | both launches                            | —                             |
| FFI gate `stability-2048-elements` (2 reports)   | program | `sloppy` (first launch)                  | `strict` passed 47–54 s later |
| region-root-scan host smoke `11.1.5-0-1`         | program | `sloppy` (first launch)                  | `strict` passed 21.5 s later  |
| this checkout's earlier smokes (`c1-mac`, `nm2`) | program | both launches                            | —                             |

In program linking, elapsed times of about 330–374 s break down as follows:

- **Node-hosted whole-engine compilation:** 270–370 s, recorded as `compileMs`
  (for example 329,347 ms and 313,689 ms).
- **Containment:** 60 s per launch, timed from process spawn.
- **Native execution:** the passing variant ran in seconds; an unloaded rerun
  finished both variants 1.8 s after compilation.

The program-mode image is not slow to start or run. `elapsedMs` is documented
as latency since the variant was prepared, so it includes the compile. The
containment budget never included compilation: `spawnSync`'s `timeout` starts
at spawn. Its "after launch" wording was nevertheless misleading, because the
time it charged was spent before the process could run.

## Cause: macOS first-launch assessment of new executables

macOS assesses each new executable file on its first `exec`. `syspolicyd` and
`XprotectService` scan it before the process starts, and later launches of the
same file skip the scan. Measured with copies of a 93 MB units-linked batch
image, run with no case argument (exit 99):

| Measurement                                 | First launch         | Second launch |
| ------------------------------------------- | -------------------- | ------------- |
| idle host, 3 fresh copies                   | 1.83 / 2.07 / 1.77 s | 0.00–0.01 s   |
| 40 extra busy CPU loops (load ~31)          | 1.78 / 1.80 / 1.68 s | —             |
| 8 fresh copies launched concurrently        | 1.98, 3.92 … 13.93 s | —             |
| 44 MB / 93 MB / 198 MB image                | 1.0 / 1.56 / 3.03 s  | 0.00–0.02 s   |
| during 48 concurrent clone launches (flood) | 96.4 s               | —             |

- **Per file, not per content.** A byte-identical copy is scanned again, and so
  is an APFS clone.
- **Scales with size:** about 16 ms per MiB plus about 0.3 s. Units batch
  images are 88–93 MB and program images about 100 MB, almost all `__text`.
- **Serial for the whole host.** Concurrent first launches complete about 1.7 s
  apart. Every agent's new binaries, including self-build stages, fixtures and
  other runners' batch images, share one queue.
- **Not slowed by CPU load.** The daemons outrank busy loops. In one probe
  launch, `syspolicyd` used 0.75 s of CPU and `XprotectService` 1.04 s;
  `syspolicyd` had used 6,895 CPU-minutes over 14 days of uptime.

"Load ~20" was a correlate. Heavy multi-agent activity means many new
executables, and the assessment queue backs up for minutes. Killing the
launch at 60 s did not cancel the pending scan, so the next variant queued
behind it again.

### Ruled out

- **Node-hosted compilation:** it has no deadline and is recorded separately.
  Units batches compiled in 1.5–4.8 s in every run here.
- **LLDB:** the default launch mode is a plain child process.
- **CPU-bound execution or GC:** the concat variants run in 0.19–0.21 s idle
  (220 MB RSS) and 0.38–0.60 s under 40 extra busy loops. The 6-worker
  collector showed no pathological spinning or parking. Map variants take
  about 5 ms.
- **CPU load:** `built-ins/Map` on `tc-main` passed 405/405 with 10 extra busy
  loops (load average 21, 92 s wall) and with 30 (load average 59, 178 s).

## Reproduction

`flood.sh 48 <seconds>` keeps 48 first launches of fresh APFS clones of one
batch image in flight. CPU load stays modest (load average 13–19, with 10 extra
busy loops where noted). The script signals only its own processes. Each
experiment ran for 5–7 minutes.

**Side effect on other agents.** The floods ran 23:06–23:11 and 23:15–23:22 UTC
on 2026-11-17. They overlapped, and probably caused, two of the timeouts listed
above: the FFI gate's `stability-2048-elements` at 23:07 and the
region-root-scan smoke at 23:17. Treat those two as caused by this
experiment. The earlier occurrences (10:55, 18:19, 18:59 UTC) predate it.

| Run (under flood unless noted)         | Result  | Admission per batch                    |
| -------------------------------------- | ------- | -------------------------------------- |
| `tc-main` built-ins/Map                | 404/405 | — (first variant of batch 0 timed out) |
| `tc-fix` built-ins/Map, +10 busy loops | 405/405 | 75.8 / 89.1 / 88.3 / 89.7 s            |
| `tc-main` concat large-typed-array     | 1/2     | — (`sloppy` timed out)                 |
| `tc-fix` concat large-typed-array      | 2/2     | 87.2 s                                 |
| `tc-fix` built-ins/Map, idle           | 405/405 | 1.07 / 1.08 / 1.10 / 0.96 s            |

Under the flood, every `tc-fix` batch waited longer than the 60 s budget to
start, and no case was charged for the wait.

## Fix: launch admission is separate from execution

The containment budget limits a test's own launch and execution. The
assessment wait comes before any test code runs and depends on other agents.
Raising the limit would not separate the two, and CPU-time accounting would
not help because the stalled process has not started.

- **Admission launch.** `NativeImageRunner` launches each staged image once,
  with no case argument, before its first case. Every batch host returns 99
  without a selector, after runtime initialization only.
- **Budget.** Admission has its own budget, `TINT_TEST262_ADMISSION_MS`
  (default 1,800,000 ms), recorded in `executionResources` as
  `admissionTimeoutMs`. Case budgets start after admission.
- **Outcomes.** Any exit or signal admits the image. A fault during
  initialization recurs, and is recorded, in each case's own launch. An image
  not admitted within its budget runs no case: each of its variants is a
  timeout whose detail says `not admitted … no case was executed`.
- **Journal and heartbeats.** Compilation records are journaled after staging,
  with `admissionMs`. Heartbeats show `admitting batch N (first launch)`.

Phase accounting was made explicit at the same time:

- `unitCompileMs`: each units batch's Script compilation, done while routing
  its cases. It was previously in no field, because routing memoizes it
  outside `compileMs`.
- `hostPreparationMs`: the unit host's one-time compilation or cache load,
  recorded on the next batch. A cold cache had shown up only as about 300 s of
  the first variant's `elapsedMs`.

None of these phases has ever been part of a case's containment. The default
linking mode is unchanged (`program`).

### Throughput

When idle, admission costs 1.0–1.1 s per 128-variant units batch, about 5% of
a Map batch's wall time. It already happened before this change, hidden in the
first case. Overlapping it with the next batch's compilation would need an
asynchronous wait in the synchronous runner, so it is left out. Under
contention the queue sets the wait. Two levers remain:

- **Smaller images.** The scan cost is linear in size.
- **A host setting.** Adding the launching terminal under _Privacy & Security
  → Developer Tools_ exempts the binaries it launches from the scan. That is
  the user's decision and was not changed.

## Validation

These checks ran on the merged tree (main f2c522e18 plus the admission change)
through frozen toolchain `tc-gate`, with units linking and batch size 128:

- **Workspace gate:** native-subset pipeline test clean; `pnpm check` passed
  (types, tests, boundaries; formatting after a fix); stage2 == stage3 under
  LLDB.
- **Standard slice:** every variant passed except one:

| Selection                      | Passed / total                                         |
| ------------------------------ | ------------------------------------------------------ |
| built-ins/WeakRef              | 58 / 58                                                |
| built-ins/FinalizationRegistry | 94 / 94                                                |
| built-ins/WeakMap              | 281 / 281                                              |
| built-ins/WeakSet              | 170 / 170                                              |
| built-ins/Map                  | 405 / 405                                              |
| built-ins/Set                  | 764 / 764                                              |
| language/expressions/object    | 2251 / 2252 (1 unsupported module variant, as on main) |
| built-ins/Array                | 6119 / 6119                                            |
| concat large-typed-array       | 2 / 2                                                  |

- **Array admission:** 49 batches, 1.03 s minimum, 1.40 s median, 10.6 s
  maximum.
- **Host smoke, units:** 2/2, `compileMs` 1,591, `admissionMs` 10,461.
- **Host smoke, program:** 2/2, `compileMs` 296,533, `admissionMs` 1,336.
  Both variants executed within about 1 s of each other after admission.

### Phase accounting check

`built-ins/Map` with units linking through a fresh frozen toolchain (`tc-acct`,
cold unit-host cache) passed 405/405. Before this change, the first variant's
`elapsedMs` of 467 s had no phase to which it could be attributed.

| Batch | `compileMs` | `unitCompileMs` | `hostPreparationMs` | `admissionMs` |
| ----- | ----------- | --------------- | ------------------- | ------------- |
| 0     | 2,761       | 19,095          | 442,648             | 1,433         |
| 1     | 2,909       | 19,926          | —                   | 1,543         |
| 2     | 6,818       | 30,406          | —                   | 1,561         |
| 3     | 5,905       | 32,802          | —                   | 1,859         |

With the host warm, Node-side unit compilation during routing, not linking or
execution, is the largest per-batch phase. It is the obvious target for runner
throughput.
