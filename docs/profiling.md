# Profiling native Tint

For what the compiler did to a program (pass statistics, per-pass IR dumps
and diffs, optimization remarks, annotated disassembly with profile samples
and code size reports), see [compiler observability](compiler-observability.md).

Opt-in runtime diagnostics — symbolicated uncaught-throw traces, collector
`os_signpost` intervals for Instruments (USDT probes on Linux), and
LLDB/perf-map visibility of JIT code — are described in
[Runtime diagnostics](runtime-diagnostics.md).

On Linux, pprofessor's role is played by `perf`: `perf record -e cpu-clock
--call-graph fp -- <image>` (or `-p <pid>`), then
`node tools/heap-snapshot/cli.ts perf perf.data --image <image> --pprof
cpu.pb.gz` writes a DWARF-symbolised pprof profile that `go tool pprof`,
`pprofessor analyze`, `tools/op-cost/analyze.ts --profile` and
`tools/disasm/annotate.ts --profile` read (see
[native heap profiling](native-heap-profiling.md#cpu-profiles-with-perf-linux)).

Build a compiler with Mach-O function symbols and embedded DWARF source mappings:

```sh
pnpm build
node tools/bootstrap-compiler.ts .tint-bootstrap/stage1-profile --debug-symbols
```

The native CLI accepts the same trailing `--debug-symbols` flag when building an
output. `BuildRequest.debugSymbols` and `CompileRequest.debugSymbols` expose the
underlying capability to module callers. Symbols are optional and are emitted by
Tint's own publisher, before UUID calculation and signing. No platform linker,
external symbol file, or address-search instrumentation is required.

## Profiling a verified compiler

Run a newly emitted image under LLDB first. Use absolute paths and distinct
outputs for verification and profiling.

```sh
image="$PWD/.tint-bootstrap/stage1-profile"
source=/absolute/frozen-source
verified="$PWD/.tint-bootstrap/verified-profile-stage"
profiled="$PWD/.tint-bootstrap/profiled-stage"

tools/gate/with-lock.sh launch verify-profile-stage \
  lldb --no-lldbinit --batch \
  -o "settings set target.disable-aslr false" \
  -o "process launch --stop-at-entry -- \"$source\" \"$verified\"" \
  -o "script assert lldb.process.GetState() == lldb.eStateStopped" \
  -o continue \
  -o "script assert lldb.process.GetState() == lldb.eStateExited and lldb.process.GetExitStatus() == 0" \
  "$image"
test -s "$verified"

tools/gate/with-lock.sh both profile-stage \
  pprofessor run --no-publish --output checking.pb.gz -- "$image" "$source" "$profiled"
test -s "$profiled"
cmp "$verified" "$profiled"
go tool pprof -top checking.pb.gz
```

Use pprofessor as the sole tracer on the profiling run. Attaching it to an
LLDB inferior while resuming from entry races debugserver at dyld
shared-library notifications. That race can leave the inferior stopped
long after the profiler has written its profile. Keep the verified image,
arguments, and source snapshot fixed between runs. Check the workload's
completion evidence and resulting bytes because the profiler's own exit
status can succeed after a failed child. For fixtures without an output
file, have the workload emit an explicit completion marker after its last
check.

The capture can also be opened in PProfessor.app. See the
[shared lock wrapper](validation-gate.md#timing-and-profiling-on-the-shared-mac)
for idle limits and stall evidence.

Function symbols identify the allocator, runtime, program, native helpers, and
source module/function. Specialized instances keep distinct generated suffixes;
anonymous functions use their source span offset. The A64 frame-pointer chains
allow pprofessor to recover callers. DWARF v4 records original TypeScript files,
lines, and UTF-16 columns for emitted instruction ranges. Imports and generic
specializations retain their original source locations. Startup, generated helpers,
and other instructions without a source span remain unmapped rather than inheriting
the preceding line. Debug builds also describe two artificial saved pointers,
`__tint_context` and `__tint_result`, within emitter-proven frame-valid PC ranges.
LLDB can inspect them with `frame variable --show-types __tint_context __tint_result`.
The [live inspection](results/native-debug-frame-inspection-v1.json) confirms their
values match the actual stack slots and that the program completes normally.
These are opaque ABI pointers, not source variables or initialized completion data.
They are unavailable during the prologue and return teardown. Source parameters
and locals, record types and inlined frames are described as well; see
[native debugging](native-debugging.md) for usage, what is described and the
remaining limitations. The `frame variable` results reported below for older
snapshots predate that support.

`SourceModule.sourcePosition` resolves original UTF-16 offsets; `loadSourceGraph`
provides it using the shared source-text module. Callers constructing parsed modules
directly must supply this optional function to obtain line mappings. The native CLI
uses the project root as the DWARF compilation directory; library callers can set
`BuildRequest.debugDirectory`. Keep the matching source snapshot available when
viewing annotated profiles. These are source-span locations, not a claim that each
machine instruction corresponds to a separate source expression.

The reusable `@tint/image/dwarf` encoder has no dependency on Mach-O or the frontend.
The image writer places its sections in `__DWARF` and includes them in signing.
Apple's `dwarfdump --verify` and LLDB source lookups validate the emitted format.

The `stage1-script-function-bindings-v1` snapshot was checked with Apple's
`dwarfdump --verify` (no errors). LLDB resolves address `0x1006ca600` to
`incompatibleArrayView + 476 at array-views.ts:7:3`, with a full snapshot path in
`LineEntry`. A source breakpoint at `array-views.ts:13` resolves to the nested
`incompatible` function. These are offline symbol/line-table checks, not a verified
live stack walk: this run failed to attach before any thread could be inspected.
The image currently has a single compilation unit named for the first source file;
`image dump line-table array-views.ts` did not find a matching compilation unit,
although address lookup and source breakpoints resolved that file correctly.

A later live check of `stage1-runtime-scopes-v1` successfully stopped at
`incompatibleArrayView` during native compilation. `thread backtrace -c 12`
recovered the following caller chain (generated instance suffixes omitted here):

```text
closure-lowering/src/array-views.ts:incompatibleArrayView
closure-lowering/src/index.ts:lowerEntries          at index.ts:250:23
closure-lowering/src/index.ts:lowerClosureFactory   at index.ts:3203:18
compiler-driver/src/index.ts:buildMacOSProgram      at index.ts:95:19
compiler-cli/src/index.ts:main                     at index.ts:64:19
program:__tint_invoke
tint:process-entry
```

This verifies a real native frame walk with caller symbols and source locations.
The top breakpoint is at function entry, before mapped body instructions; generated
entry helpers intentionally have no source lines. It does not add local-variable
debugging, inline frames, or debugger type descriptions. Debugger attachment has
been intermittent; a successful run does not establish that startup failures are
fixed.

A first named capture of the full native self-build resolved function names
without the earlier temporary address maps. In its 10-second checking window,
711 of 713 samples included graph marking; object scanning and allocation-address
lookup dominated. This identifies a GC hot path for follow-up, not an end-to-end
speedup or evidence that self-hosting is complete.

A subsequent capture from the compiler with DWARF resolved `findEntry` samples to
`sparse-list/src/index.ts:63–65`; its caller profile attributed 337 of 681 samples
to the literal-resolution scan in `ts-checker/src/interfaces.ts`. The native
compiler also emitted the debug-enabled runtime smoke binary byte-for-byte equal
to Node's output; that output passed `dwarfdump --verify` and returned 42 under
LLDB. This verifies native debug-info generation, not complete self-hosting.
The previous self-build performance goal is complete: two minutes was the accepted
threshold and one minute the stretch target. Language coverage is now the active
goal. When measuring performance, include source loading, parsing, checking,
lowering, emission, signing, and output publication. Preserve validation and
debug-info configuration in reported measurements; do not substitute Node output
or cached artifacts. Verify byte-identical self-build output and generated compiler
correctness separately from timing.

The scalar-native verifier can exercise the same fixture corpus with
`TINT_OPTIMIZATION=basic TINT_NATIVE_LLDB=1 node tools/verify-scalar-native.ts`.
The LLDB mode captures the program's binary result separately and checks normal
process termination, so a bad generated instruction remains in the debugger
instead of producing a macOS crash-report window. Omitting `TINT_OPTIMIZATION`
keeps the baseline emitter path for differential runs.

For builds that will be profiled while development continues, pass
`--snapshot .tint-bootstrap/source-snapshot-N` to `tools/bootstrap-compiler.ts`.
The parent directory must exist; the snapshot directory must be new. This copies
the exact compiler source inputs and uses that directory for DWARF resolution.
Run the emitted compiler with this snapshot as its project root. Its self-built
output then has the same source directory as the Node baseline, enabling byte
comparisons without letting subsequent workspace edits change annotated profiles.

`--source-root <snapshot>` rebuilds from a saved source directory using the
bootstrap tool's current compiler project manifest. `--managed-bytes <bytes>` and
`--allocation-capacity <count>` override the emitted executable's heap and
allocation descriptor capacity for controlled memory-pressure experiments. Neither
edits the compiler project's own defaults: that compiler still emits the capacities
specified by its source. Keep this distinction in cross-generation comparisons and
report both overrides alongside timings. Heap bytes and descriptor count are
independent limits; instrumenting the collector entry exposed collection at
16,777,215 allocated objects with a 16,777,216-descriptor configuration. This is
inventory size before marking, not the count of reachable objects after marking.

A live `stage1-record-view-v3` self-build also stopped at the source breakpoint
`array-views.ts:13`, resolving the nested `incompatible` function at line 13,
column 9. Its caller stack recovered `incompatibleArrayView`, `lowerEntries`,
`lowerClosureFactory`, `buildMacOSProgram`, `main`, and generated entry helpers.
LLDB displayed the matching snapshot source. `dwarfdump --verify` reported no
errors. `frame variable` explicitly reported no variable information; the debugger
function type remains `void (void)`, so this is stack/source mapping support, not
argument/local inspection or meaningful debugger types.

The `stage1-base-classes-v1` snapshot also passed `dwarfdump --verify` and a live
source breakpoint at `array-views.ts:13:9`. Its backtrace resolved `incompatible`,
`incompatibleArrayView` (72:9), `lowerEntries` (259:23), `lowerClosureFactory`
(3298:18), `buildMacOSProgram` (97:19), `main` (64:19), and the two generated
entry helpers. LLDB displayed the frozen TypeScript source. `frame variable`
reported no variable information and the function type remained `void (void)`;
local/argument locations and meaningful debugger types are still not emitted.

A live check of `stage1-class-prototype-v1` resolved a source breakpoint at
`representation-views.ts:14:9`. The backtrace recovered `incompatible`,
`incompatibleRepresentationView` (95:9), `lowerEntries` (261:23),
`lowerClosureFactory` (3303:18), `buildMacOSProgram` (97:19), `main` (64:19),
`__tint_invoke`, and `tint:process-entry`. LLDB displayed the matching frozen
snapshot source and column; DWARF verification reported no errors. Variable
inspection still reports no variable information, and function types remain
`void (void)`. The debug probe was stopped intentionally after inspecting the
stack; it was not a completed compiler run.

Hosted native fixtures accept `TINT_DEBUG_SYMBOLS=1` alongside `TINT_BUILD_ONLY=1`.
Their generated entry module now supplies source positions, so LLDB can identify
`fixture:line:column` as well as source-package frames. The generated `fixture`
source lives in the corresponding tool's string literal; this is not a promise
that LLDB can open it as a standalone source file.

Test262 batch and Script fixture images (`createNativeBatchBuilder`, used by
`tools/native-script-fixture.ts` and the native runner) also accept
`TINT_DEBUG_SYMBOLS=1`. With `TINT_BUILD_ONLY=1` the fixture keeps the image so
it can be launched under LLDB and sampled with Apple `sample`;
`attributeNativeSample` then gives exclusive counts. Inclusive shares need the
full call tree, as in the
[Script call-overhead profiles](results/cluster-k-script-call-overhead-v1-evidence/).
Default images are unchanged, so timing comparisons should use images built
without symbols.
