# Test262 runner contract

For current coverage and priorities, see [Test262 integration](test262.md).

The current development adapter is `native-script-v6-eval-script`. Its realm-local
`$262.evalScript` host passes all seven [native integration cases](results/native-test262-script-service-validation-v1.json);
unchanged conformance reruns are running. The frozen v9 survey keeps its earlier
adapter, sources and resource policy.

Development images use one uniform budget: 256 MiB managed heap, 8 Mi allocation
metadata capacity, 16,384 roots, 16 MiB stack and a 4 MiB executable arena per agent.
Scripts have a 256 KiB per-compilation code limit; dynamic `Function` retains 64 KiB.
The shared registry retains up to 2,048 blocks and 32 MiB of page-rounded payload
reservations through engine shutdown. The unchanged shared conversion matrix
creates 1,120 four-byte blocks, reserving 17.5 MiB with 16 KiB native pages. Its
original failures under the 1,024-block / 16 MiB profile remain preserved. Each
new report records the uniform profile used for that run.
These match an observed native evaluator pass, not proven minimum requirements.
Set `TINT_TEST262_CONTAINMENT_MS` once per run and retain it in the report; initial
integration fixtures use 300,000 ms. Host faults are crashes (exits 13–17); supported
JavaScript throws stay language completions, and unsupported compilation stays sticky.

## Native service linking identity

Frozen toolchains that capture `date-time-service-factory.ts` default to cached
AOT service composition. Set `TINT_TEST262_NATIVE_SERVICES=aot` to require this
path or `monolithic` for the outcome-equivalence control. AOT composition requires
an immutable frozen toolchain identity. `TINT_NATIVE_SERVICE_CACHE` selects the
content-addressed cache directory; keep it outside the frozen toolchain tree.
The default cache is `.tint-bootstrap/native-service-cache`.

Reports and schema-2 journals record `nativeLinkingMode` and
`nativeServiceUnitIndexSha256` alongside the compiler and source hashes. Resume
rejects a different mode or unit index before skipping earlier observations.
The monolithic mode records a null unit index. Public Intl installation remains
identical in both modes; service units change compilation and composition only.
Cache construction and preparation cost must be reported separately from warm
batch compile CPU in performance comparisons.

## Run the adapters

Use an explicit checkout and preserve source bytes:

```sh
git -c core.autocrlf=false clone https://github.com/tc39/test262.git /path/to/test262
git -C /path/to/test262 checkout 91c70759363c46557b694792bf34a2551a7af5ba
pnpm build
```

The selection argument names a file or directory below `test/`; `.` selects the full
suite. `_FIXTURE` files are not standalone tests. Write each run to a new report.
An explicit trailing `/*.js` selects only standalone JavaScript files directly in
that directory, preserving order and fixture exclusion. Quote it in a shell, for
example `'intl402/*.js'`. This batches the namespace tests without selecting the
Temporal child family. Complete per-file reports can be extracted from its journal
with `test262-native-extract.ts`, retaining all source/harness hashes.

For a focused recheck, set `TINT_TEST262_VARIANTS=/path/to/variants.json` to a
nonempty JSON array. Paths remain relative to `test/` and must belong to the
ordinary selection argument. For example:

```json
[
  {
    "path": "language/statements/for-await-of/head-let-init.js",
    "variant": "strict"
  }
]
```

Each entry requires `path` and `variant` (`sloppy`, `strict`, `raw` or `module`);
an optional `sha256` must match the pinned source bytes. Missing or out-of-selection
paths, fixture files, metadata-incompatible variants, duplicates, empty lists and
hash mismatches fail before native preparation. Syntax-negative grouping and the
selection's original within-lane order are preserved rather than manifest order.
The existing batch size, isolated processes, heartbeat, negative-phase handling
and resource limits apply to every requested variant, including non-passes.

Use a fresh report and journal with the frozen toolchain as usual. The report's
selection is labeled `[explicit variant subset]` and includes `rootSelection`,
`requestedVariants` and `complete: true` only after every request is observed.
The schema-2 journal retains the root selection and subset count; both artifacts
record `variantSubsetSha256` over the normalized paths, variants and pinned source
hashes. Resume requires the same subset identity. These are complete focused
reports, not complete reports for the root family; original outcomes remain in
their original reports.

```sh
# Inventory only; no execution.
node tools/test262-syntax.ts /path/to/test262 . > syntax.json

# Tint native execution (currently macOS arm64).
node tools/test262-native-run.ts /path/to/test262 language/expressions/addition > native.json

# Node reference execution for the same selection.
node tools/test262-run.ts /path/to/test262 language/expressions/addition > reference.json
```

The native runner accepts an optional compilation batch size (default 8, range
1–64) after the selection. Each image contains multiple cases but executes only
the selected case in a fresh process; globals, realms and jobs are not reused.
Each batch compiles one shared runtime host and ordered Script callback arrays.
Identical lowered Scripts share code; each harness entry still executes separately
in the selected fresh process. The [shared-host regression](results/native-shared-host-v1.json)
checks isolation, error classification and async completion. Parse-negative batches
use a separate parser host and never evaluate their sources. Compilation failures are retained
for every affected variant without automatic retries; use an explicitly recorded
single-case diagnostic run to isolate them. Reports record batch membership,
compilation time and outcomes. Per-variant elapsed time includes queue/compilation
waiting and is not a runtime benchmark.

The native runner emits an immediate status line on each phase transition and a
periodic heartbeat to **stderr** (stdout remains the JSON report).
`TINT_TEST262_HEARTBEAT_MS` defaults to `30000`; `0` disables all heartbeat
output. Values must be decimal integers in 0–2147483647 milliseconds.
`TINT_TEST262_STALL_MS` accepts decimal integers in 1–2147483647 milliseconds.
It defaults to five heartbeat intervals (150000 ms at the default interval,
capped at 2147483647; with heartbeat disabled its unused default is 150000).
This advisory threshold gives several progress observations before warning about
slow compilation or debugger execution; it does not change any timeout or outcome.

Lines include an ISO timestamp, selection, phase and its elapsed milliseconds,
done/total variants, and pass/fail/unsupported/infra counts. Infra combines crashes,
timeouts and harness errors. Counts include restored journal observations.
After the stall threshold, every heartbeat says `STALL` and includes the runner
and any live descendant child/inferior PIDs (or an explicit lookup-unavailable
message). Pause heartbeats always name the marker path and elapsed pause time.
A worker keeps heartbeats visible during synchronous compilation, debugger waits
and pause-file waits. Its timer and worker are unreferenced and disposed on success
or error. No heartbeat settings or events enter journals or reports; frozen-runner
identity checks still apply when resuming. With the default interval, silence for
more than about 60 seconds should be investigated as a runner/observer hang,
even if no `STALL` line has appeared. For example:

```sh
TINT_TEST262_HEARTBEAT_MS=30000 TINT_TEST262_STALL_MS=150000 \
node tools/test262-native-run.ts /path/to/test262 language/comments 8 > native.json 2> native.stderr
```

For long runs, set `TINT_TEST262_JOURNAL` to a new JSONL path. The runner refuses
to overwrite an existing journal and appends compilation and per-variant evidence
as it arrives. Only a final `complete` record establishes a finished run; an
interrupted prefix is not a full selection result. The ordinary stdout JSON report
remains the canonical complete report.

Schema-2 journals from a frozen Node toolchain can resume with
`TINT_TEST262_RESUME=1`, the same journal, frozen runner, source snapshot, selection,
batch size and execution settings. First verify the previous runner and its
inferiors have exited. The runner checks the frozen files and the recorded
source/harness prefix, retains every outcome, and executes only unobserved
variants. An interrupted batch remains recorded; its remaining variants receive
a new batch ID. Changed identities, truncated records and inconsistent outcomes
are rejected. A completed journal can regenerate its report without executing
tests or appending records. Older schema-1 journals cannot resume.

To publish an already completed family from a longer survey, run
`node tools/test262-native-extract.ts <checkout> <journal> <selection> <new-report>`.
The extractor verifies every expected variant, source and harness identity against
the pinned checkout. Missing or duplicate variants and inconsistent outcomes are
rejected. The immutable report retains all selected outcomes and the exact journal
prefix hash; it does not combine runs or establish a whole-suite percentage.

`node tools/verify-test262-native-batch.ts` checks native case selection, process
isolation, error classification and syntax-only execution under LLDB.

Ordinary workspace tests do not require an external Test262 checkout. Metadata
parsing uses the Node-only `yaml` dependency; it is not part of the native compiler.

Agent blocking requirements are part of each execution plan. `CanBlockIsFalse`
creates a non-suspending native agent; `CanBlockIsTrue` and unflagged cases use
an allowed agent. Each fresh case gets its own immutable policy, and child realms
share that agent. Reports retain the selected `canSuspend` value. This policy does
not provide threads or waiting by itself. The Node reference adapter reports the
non-suspending policy as unsupported because it does not configure such an agent.

## Deduplicated native coverage ledger

Run analysis only (no compilation or native execution):

```sh
node tools/test262-coverage-ledger.ts /path/to/pinned/test262 docs/results/test262-coverage-ledger-vN.json
```

Use a new version each time; both JSON and Markdown destinations are immutable.
Default JSON is compact: totals, directory gaps, evidence age and toolchain spread,
all accepted artifact names, selected-artifact provenance, excluded/rejected
artifacts, and a SHA-256 commitment to the full per-variant table. No per-variant
rows are stored in the committed report.

To export the table on request, use a new ignored destination (never commit it):

```sh
node tools/test262-coverage-ledger.ts /path/to/pinned/test262 docs/results/test262-coverage-ledger-vN.json --full .tint-bootstrap/coverage-ledger-vN.jsonl
shasum -a 256 .tint-bootstrap/coverage-ledger-vN.jsonl
```

The full export is optional and exclusive-create; its destination must be ignored
by Git. It is canonical UTF-8 JSONL, sorted by binary path then variant, with
compact JSON objects in the fixed field order `path`, `variant`, `sha256`,
`syntaxNegative`, `status`, `report`, and one LF after every row, including the
last. Its SHA-256, byte length, row count and serialization policy are included
in the compact report even without exporting it. The hash excludes generation
timestamps. The same committed inputs (identified by `inputMain`), Git addition
dates and pinned checkout reproduce the same table and hash. Preserve those
inputs when verifying an older report; later observations can change the hash.

The tool inventories all 103,264 pinned variants with the runner's metadata,
`syntaxVariants`, harness and fixture policy. It scans reports and streaming JSONL
journals tracked under `docs/results/` on local `main`; rebase first. Progress goes
to stderr. Canonical Tint native runtime reports must contain every expected
variant in their selection with consistent totals. Explicit subset reports instead
require `complete: true`, a `rootSelection` and a matching `requestedVariants`
count; every listed variant must belong to that root. Journals additionally require
a final, consistent `complete` record. Interrupted prefixes and rejected evidence
are listed separately and contribute nothing. Every source and ordered harness
hash is checked against the clean pinned checkout. A mismatched observation
rejects its entire artifact; no failure or unsupported outcome is filtered away.
Quoted `directory/*.js` and root `*.js` selections use the checkout's direct-file
membership policy, so nested directories remain separate populations.

For each variant, the latest accepted complete artifact wins, including later
non-passes. Dates use `generatedAt`, `timestamp`, `completedAt`, then `startedAt`;
otherwise a linked journal's start time, then the first Git-addition commit date.
Git dates are explicit proxies for unavailable run dates. Equal dates use the
lexically greatest repository-relative filename, independent of scan order or
filesystem mtimes. Canonical JSON and completed journals use the same rule.
Missing frozen-toolchain identities remain explicitly unknown; source snapshots
are retained separately. JSON records selected-artifact provenance, evidence dates,
toolchain spread, accepted artifact names and rejection diagnostics. The Markdown companion summarizes
all outcomes and disjoint directory gaps at depth 2–3.

This is a **deduplicated aggregate of separate complete runs on varying
toolchains**, not a whole-suite measurement or proof about today's compiler.
Its pass fraction is an evidence lower bound over the full denominator. Native
syntax-gate summaries and Node results are excluded; parse/early negatives count
only when individually observed in an accepted native runtime report. The goal's
complete pinned whole-suite run requirement remains unchanged.

## Full native syntax validation

`tools/test262-early-errors.ts` inventories parsing plus declaration/context checks
on the bootstrap host. `tools/build-test262-native-parser.ts` builds one native
parser for the complete suite, avoiding a compiler invocation per syntax case:

```sh
node tools/test262-early-errors.ts /path/to/test262 . > early-errors.json
TINT_DEBUG_SYMBOLS=1 node tools/build-test262-native-parser.ts /path/to/test262 /new/run-directory .
```

The build records immutable source hashes and variants in `manifest.json`, writes
its input manifest, and prints the executable path. Run that image under LLDB with
stopped-at-entry and expected exit-42 assertions. It reads each original source as
data, applies the recorded strict prefix, parses and validates it without execution,
and emits indexed `CASE` records followed by `COMPLETE`. A valid report requires
exactly one outcome for every manifest entry, the matching completion count, and
the native process's expected exit status. Crashes and incomplete runs remain
recorded; do not infer a full-suite result from a passing prefix.

The corpus host uses the standard compiler budgets: 3 GiB managed storage,
100,663,296 allocation entries, 1,048,576 roots and a 256 MiB stack. These differ
from the smaller Script execution fixtures. Syntax-only binding validation checks
early errors without requiring executable Annex B binding plans. Its results
cannot be used as an executable binding plan or as behavior/API conformance.

## Native execution baseline

Each supported variant is AOT compiled through Tint's native pipeline and executed
under LLDB in an isolated process. Node hosts compilation and result collection.
Original harness files and the test are separate Script entries sharing one global
environment and realm, preserving each file's own directives. Tests are not wrapped
in functions, and assertions and harness sources are not rewritten.

Script execution uses a uniform 64 MiB managed heap, 1,048,576 collector workspace
entries, 4,096 root slots, a 1 MiB stack, a 16 MiB per-buffer allocation cap
and a default 60-second total debugger containment budget. Resizable buffers can declare a larger logical
maximum; allocations above the cap throw RangeError. Reports
record these limits as `executionResources`. Current images use the two-space
copying collector: 32 MiB is usable and 32 MiB is reserved for evacuation. The
host additionally records a 1 MiB executable arena and a 64 KiB per-function code
limit. JIT-capable images explicitly grant executable-memory operations and carry
Tint-signed JIT entitlements. The generational write-proof gate has not been
relaxed for raw code capabilities. Earlier reports used different collectors or
a 4 MiB heap and can hit allocation limits before
large generated inputs are constructed. Parse-negative hosts retain the compiler
host's own memory configuration; the containment budget applies to both hosts.
Resource failures remain failures or unsupported outcomes, never passes.

The native adapter supports strict, sloppy and raw Scripts, including Promise-job
async completion through the unchanged `$DONE` harness. It drains jobs after the
Script stack exits and rejects duplicate completion. An empty job queue without
`$DONE` is reported as timeout: this host has no external async event sources.
Async declarations, expressions, arrows and methods support native await suspension.
Async-generator declarations, expressions and methods support ordered requests,
for-await iteration and async delegation. Module execution and `$262.agent` remain
unsupported. Sloppy semantics and standard intrinsics are incomplete.

`$262.createRealm()` creates separate native globals and intrinsics, sharing the
agent and symbol registry. The returned host exposes `global`, `createRealm` and
`evalScript`; the child global also exposes its own `$262`. String-valued `eval` and
`evalScript` explicitly report unsupported until native dynamic compilation is
connected, even when Script catches the resulting exception. Non-string `eval` arguments are returned unchanged. Realm support does
not imply dynamic-source execution support. `tools/verify-test262-native-realms.ts`
checks isolation, shared symbols and Proxy execution-realm behavior.
`$262.detachArrayBuffer` detaches the actual backing storage, invalidating existing
DataView access; it is not a test-only substitute for the runtime operation.

Parse/early-negative variants compile their source as data into a native parser
host. The built parser uses Script or JavaScript Module grammar, with the same
strict prefix policy, and never evaluates the test. Native lexical/syntax diagnostics, duplicate binding names and invalid binding
contexts produce a parse-phase SyntaxError outcome. Unsupported syntax and parser
limits stay unsupported; accepted negative source fails its expected-error check.
Binding uses JavaScript Script/module rules: unknown names and immutable writes
remain runtime operations, while module declaration collisions remain early
errors. Duplicate explicit export names and unresolved local exports are also
early errors; indirect export resolution remains a linking concern. This does not
yet certify every specification early error. Positive tests still
report bootstrap parser/lowerer rejection as unsupported rather than conformance.
`tools/verify-test262-native-syntax.ts` verifies rejection, acceptance without
execution, module grammar and unsupported diagnostics.

LLDB records process state and exit status in a private result file; program stdout
is not the outcome protocol. Stopped faults remain contained by the debugger, and
timeouts terminate the recorded inferior. Launch failures retain their diagnostics.
Focused Script fixtures accept `TINT_BUILD_ONLY=1` to retain an executable and
print its path and case count without launching LLDB. The fixture helper normally
checks the same source in Node first. A spec-driven fixture may explicitly set
`nodeReference: false` when Node differs or native host facilities are required;
link the governing specification and state the reason in that fixture. This allows debugger runs
to remain serial while independent compilation proceeds. Do not suspend an active
runner to serialize work: its timeout clock continues while the coordinator is stopped.
There is no automatic retry. Distinguish pre-execution debugger failures from
faults after execution begins; neither counts as a pass.

## Reporting contract

Reports record checkout revision and tracked-dirty state, source/harness hashes,
metadata, variant, outcome and elapsed time. Preserve BOMs and line endings.
Only extracted YAML metadata is normalized. Strict variants receive the required
`"use strict";` prefix; raw variants do not. Inventory diagnostics identify the
prefix offset. Unexpected inventory tool failures abort rather than masquerading
as syntax failures.

| Native outcome                                                        | Classification   |
| --------------------------------------------------------------------- | ---------------- |
| Positive test completes normally                                      | Pass             |
| Negative test throws the specified constructor in the specified phase | Pass             |
| Wrong error, wrong phase, or unexpected completion                    | Fail             |
| Harness throws                                                        | Harness error    |
| Missing capability or uncertified parser rejection                    | Unsupported      |
| Deadline exceeded or process/debugger failure                         | Timeout or crash |

The `early` negative phase maps to `parse`. Harness errors cannot satisfy a test's
negative expectation. Keep all statuses in the denominator and retain every
original observation when investigating failures.

Syntax reports explicitly set `conformance: false` and `executed: 0`:

- `accepted`: a positive input parsed; binding and execution remain untested.
- `rejected`: a positive input received a syntax diagnostic.
- `unsupported`: syntax is explicitly unavailable.
- `negative-accepted`: a negative input parsed; some early errors require binding.
- `negative-rejected-unverified`: rejected, but the reason is not certified.
- `limit`: a resource budget was reached. Historical `unavailable-goal` reports
  predate support for inspecting all four source goals.

The Node reference adapter uses fresh processes/realms and unchanged harness files.
It supports synchronous and asynchronous Scripts with the original `$DONE`
protocol; modules and agents remain unsupported. Missing async completion times
out, and duplicate completion or uncaught exceptions fail. Its results validate
runner behavior and provide comparisons, not Tint passes.

Normative guidance: [Interpreting Test262 Tests](https://github.com/tc39/test262/blob/main/INTERPRETING.md).

### Source lifetime

Each CLI run captures one workspace source graph before processing variants.
Execution and syntax builders both resolve from that captured graph, including
when their first builds occur at different times. Reports and journals record its
source-content/mapping hash and file count. Rebuild the workspace before starting
a run so the bootstrap compiler artifacts match its source.

### Executable lifetime

The `native-script-v4-shared-image` adapter stages one immutable executable file
per batch and launches a fresh inferior process for each variant. Only the file
is reused; globals, heap state and jobs remain process-isolated. Each launch has
its own debugger outcome and PID files, and failures are recorded without retry.
The staged executable is removed when its batch closes.

## Legacy host object

The native host now exposes `$262.IsHTMLDDA` as a callable internally branded
object. Only its Boolean conversion, `typeof`, and loose equality with nullish
values receive Annex B behavior. Property access and callability remain object
operations; neither inheritance nor a Proxy forwards the brand. Three native regression cases pass; the fourth had a pre-entry debugger attach
failure and passes a separate diagnostic. Both reports remain in the dashboard.
Complete unchanged Annex B selections are queued.

### Debugger transport

Darwin runs use `/usr/bin/lldb` and its bundled debugserver. By default
(`debugserver-direct`) the private stub launches the inferior and establishes its
initial stop before LLDB connects. The [direct-protocol probe](results/object-lldb-direct-protocol-probe-v1.json)
completed all five previously crashed Object cases, while connected launch still
intermittently reports `failed to catch stop after launch` with PID 0 even after the
connection-readiness fix.

With `TINT_TEST262_DEBUGGER_LAUNCH=debugserver-connected`, the private stub accepts a
connection before LLDB launches the inferior.
The debugger connects asynchronously, then launches synchronously through the
connected process's `SBProcess.RemoteLaunch` API, with an initial stop and explicit
argument vector. This avoids target-level launch rejecting the existing connection
as already debugged. A [fixed six-launch validation](results/native-connected-remote-launch-v1.json)
passes without outcome-driven retries; earlier launch failures remain recorded. The [RemoteLaunch argument fixture](results/native-connected-remote-arguments-v2.json)
checks flag bytes received by the program and exits with its expected status 42;
a previous [fixed 12-launch schedule](results/native-connected-launch-smoke-v1.json)
passed without outcome-driven retries. Earlier pre-entry failures remain recorded.

Development images explicitly embed `com.apple.security.get-task-allow` in both
XML and DER, using Tint's own signer. The permission is independent of DWARF.
The [controlled diagnostic](results/native-debugger-entitled-cold-v1.json) passed
nine fresh-image cases. [Tint-signed date](results/native-temporal-date-with-own-signature-v2.json),
[date-time](results/native-temporal-date-time-with-own-signature-v2.json) and
[labelled-function](results/native-labelled-functions-own-signature-v2.json)
fixtures also pass without host signing. Older pre-entry failures remain in their
reports and [interrupted baseline](results/test262-full-suite-native-v2-interruption.json).
Complete unchanged selections measure the effect on conformance totals.

Images are written to a private staging path, flushed with `fsync`, closed and
assigned executable permissions before atomic rename to the launch path. Terminal
I/O is disabled. Debugger-owned files independently record the initial stopped
state and final exit state; shell success alone never proves completion. Cleanup
includes the private stub and suspended children, including pre-handshake failures.
Infrastructure failures remain failures; the adapter does not retry them into passes.

### Interleaving focused diagnostics

`TINT_TEST262_PAUSE` optionally names a unique marker path for a long run. A
requester creates the marker and waits for its `.ack` file, whose PID identifies
the runner stopped **between** variants with no active inferior. It can then run
focused native diagnostics and remove the marker after cleaning up its children.
The runner removes the acknowledgement and records the pause duration in its
journal and final `diagnosticPauses` list. Native execution timeouts keep running
normally within each variant; no process signals suspend an in-flight test.
After a requester/server failure, inspect live processes before clearing a marker.

### Focused fixture provenance

`TINT_BUILD_ONLY=1` on a native Script fixture retains `fixture.json` beside its
binary. The manifest records the frozen workspace graph fingerprint, each exact
Script source and hash, image hash, execution budgets and reference-execution
policy. Capture this build-time manifest in regression evidence instead of
inferring the tested sources from a fixture file that may have changed later.
The graph fingerprint uses the same stable serialization as full-suite reports.

Full runs can preserve their exact compiler source graph with
`TINT_TEST262_CAPTURE_SOURCES=<new-file>`. The runner saves the captured bytes,
module ownership and import mappings before constructing either native builder;
the file is exclusive and cannot overwrite an earlier snapshot. The journal and
final report record its path. `TINT_TEST262_SOURCES=<saved-file>` restores that
graph after validating its fingerprint. This reproduces compiler inputs; it does
not by itself resume observations or combine partial reports into a complete run.
The saved graph does not freeze Node's loaded compiler artifacts or the runner
itself; build-host and adapter versions remain separate provenance when comparing
runs.

`TINT_TEST262_MODULES=1` enables the captured native source-module host and
records adapter `native-script-v10-modules`. The snapshot must provide the
complete lowered-module contract; leaving the variable unset preserves the v9
Script path. Static sibling JavaScript fixtures are loaded through a per-process
module table, and their hashes enter resume identity even when fixture preparation
is unsupported. Parse/early negatives still use syntax validation without loading
or evaluation. Unparsed fixtures, JSON, attributes, top-level await, dynamic import
and `import.meta` remain explicitly unsupported. Other flag values are setup errors.

`TINT_TEST262_DEBUGGER_TRACE=1` enables private process-state and remote-packet
logs; reports record this choice. Failure diagnostics retain bounded tails of
those logs and the launch error. Tracing is diagnostic instrumentation, not a
retry or a fix for missed initial-stop events. The latest observed launch error
is `failed to catch stop after launch`; no Tint execution is established in those
observations.

### Debugger launch experiments

`TINT_TEST262_DEBUGGER_LAUNCH=lldb-local` selects LLDB-managed launch on macOS;
`debugserver-direct` (launch before connect) is the Darwin default.
`debugserver-connected` remains available for controlled comparisons. Reports record
the selected protocol. Both require a recorded initial stopped state and the
inferior's final outcome. Local launches use a private process group so failed
pre-handoff launches can be cleaned up without affecting another session. A
comparison must use identical frozen compiler sources, selections and budgets;
retain original launch failures separately instead of retrying them into passes.

A patient direct-launch profile is available for hosts where the initial native
stop takes longer than LLDB's remote launch window:

```sh
TINT_TEST262_DEBUGGER_LAUNCH=debugserver-direct \
TINT_TEST262_CONTAINMENT_MS=180000 \
TINT_TEST262_DEBUGGER_TRACE=1 \
node tools/test262-native-run.ts .tint-bootstrap/test262 built-ins/ArrayBuffer
```

The stub establishes the initial stop before the debugger connects. The budget
covers both startup and execution; it is not a separate three-minute runtime
allowance after startup. Choose one profile for the entire selection. Reports
record its actual resources and launch protocol, and preserve every outcome.
The [immutable-view native fixture](results/native-immutable-views-direct-patient-v1.json)
passed under this protocol after the retained connected/local launch failures.
This does not convert earlier failed observations into passes or change the
protocol/budget of an active frozen survey.

## Throughput analysis

`node tools/test262-throughput.ts [journal-directory]` aggregates JSONL journals
(default: `docs/results`) by engine, selection directory and compilation kind.
It retains interrupted batches and reports truncated tails. Batch time is counted
once, independently of the number of recorded observations. Overlapping reruns
remain workload measurements and must not be added into suite coverage.

Historical `elapsedMs` includes compilation, preparation and earlier launches.
The analysis therefore reports execution wall time as unavailable, alongside the
raw latency sum and approximate within-batch observation deltas. Compilation-only
whole-suite extrapolations use the observed batch occupancy and 103,264 variants;
they exclude debugger launch, native execution and preparation. Use matched CPU
and wall measurements for optimization claims. The exported `analyzeCPUProfile`
helper attributes V8 sampling intervals to the innermost compiler stage and keeps
GC and synchronous child-process waits separate. Sampled intervals are elapsed
time, not process CPU accounting.

The [historical corpus refresh](results/native-journal-throughput-v3.md) separates
compiled execution batches from syntax and fast rejected compilations. It also
excludes exact copied journals before aggregation; distinct overlapping runs
remain separate workload observations.

For generated-code work, profile native execution separately from the Node build
host. The [native workload attribution](results/native-hot-functions-v2.md)
retains symbolized stage-2 compiler, addition, division and eval/catch samples.
`attributeNativeSample` in `tools/native-sample-attribution.ts` derives exclusive
main-thread counts from the complete Apple `sample` call tree, including groups
omitted by its five-sample leaf-summary threshold. Aggregate specializations of
one source function, but keep workload denominators separate. Selected sampling
windows are not duration-weighted whole-run profiles.

The [private-array compiler measurement](results/native-codegen-dense-inline-selfbuild-v1.md)
compares generated native compilers on identical frozen sources and identical
emitted images. Its dense-array optimization still requires a closed executable
with private headers and no managed surfaces. Test262's managed batch images
retain their existing setting, so a native compiler speedup does not establish
a runner compile-time or variant execution-time improvement.

Retain the image and build-manifest identities, initial debugger stop, final
inferior outcome, CPU observations and load averages with each measurement.
Under saturation, use repeated inferior CPU measurements and emitted instruction,
call and allocation counts; a timeout or wall-time ratio alone cannot establish
a generated-code regression or improvement. Bespoke fixtures and longer profile
diagnostics remain separate from unchanged Test262 selection totals.

When debugserver stalls in `task_for_pid` before the initial stop, retain the
launch as infrastructure and check the host's Developer Tools authorization.
The [retained A1 recheck](results/test262-addition-post-C2-correct-budget-v3-audit.json)
completed with two pre-entry crashes during a confirmed authorization stall.
It provides no native execution timing. Recheck into a new report after host
authorization is restored; preserve the original report and journal.

The [leaf pointer register measurement](results/native-leaf-reference-throughput-v1.md)
records repeated inferior CPU/cycle measurements, four identical native compiler
stage images and nine unchanged canonical outcomes. Its operation-loop speedups
do not imply a whole-suite speedup. The [current attribution](results/native-hot-functions-v13.md)
keeps real native preparation separate from Node-hosted batch compilation.

The [held indexed-Set assessment](results/native-indexed-set-assessment-v1.md)
retains matched 17/17 outcomes, identical self-build images and the real-workload
regression despite a large-lookup win. The [scalar-register assessment](results/native-runtime-scalar-assessment-v1.md)
retains the three contention rechecks, including the remaining timeout. Neither
report authorizes a candidate implementation or a whole-suite speedup claim.

The [immutable word-capture measurement](results/native-word-captures-throughput-v1.md)
records direct traced closure payloads, moving-GC checks, identical native compiler
stage images and nine unchanged Test262 outcomes. Its repeated allocation-workload
CPU gain is separate from mixed compiler CPU and Node-hosted batch compilation.

The [deferred temporary-root measurement](results/native-deferred-roots-throughput-v1.md)
records bounded cleanup at potential collection blocks, four identical native
compiler images and nine unchanged Test262 outcomes. Instruction reductions are
reported separately from mixed CPU timings; failed prototypes remain preserved.

The [direct comparison-branch measurement](results/native-comparison-branches-throughput-v1.md)
records same-source canonical controls, repeated CPU/instruction/cycle counters,
matched native compiler samples and four identical stage images. The conservative
control adapter is covered by its frozen toolchain identity; journal checks and
resource limits remain unchanged.
