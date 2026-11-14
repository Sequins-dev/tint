# Compiler observability

Opt-in reports that show what the compiler did to a program: per-pass
statistics, per-pass IR dumps and diffs, optimization remarks, annotated
disassembly and code size. Every report only observes the build; an observed
build emits byte-for-byte the same image as an unobserved one. The one
exception is the explicit pass limit used to bisect miscompiles
(`TINT_OPT_PASS_LIMIT`), which truncates the optimizer on purpose.

All reports describe the **program** module (the application compiled by
`compileArm64Program`). The allocator and runtime modules are optimized
separately and are covered only by the code size report.

| Report                          | Node tools (bootstrap, hosted fixtures) | Output                           |
| ------------------------------- | --------------------------------------- | -------------------------------- |
| Pass statistics                 | `TINT_PASS_STATS=1` or `--pass-stats`   | stderr table, `.pass-stats.json` |
| Per-pass IR dumps               | `TINT_DUMP_PASSES=<function filter>`    | `.passes/`                       |
| Optimization remarks            | `TINT_REMARKS=<filter>`                 | `.remarks.jsonl`                 |
| Code size                       | `TINT_CODE_SIZE=1` or `--code-size`     | stderr table, `.code-size.json`  |
| Pass limit (changes the output) | `TINT_OPT_PASS_LIMIT=<n>`               | the truncated image              |

Outputs are written next to the build output (`<output>.pass-stats.json`, and
so on). `tools/bootstrap-compiler.ts` writes them next to the compiler it
builds; hosted fixtures write them next to the fixture binary (keep it with
`TINT_BUILD_ONLY=1` or `TINT_KEEP_NATIVE=1`). The native compiler accepts
`--pass-stats` (below). Existing analysis inputs still apply:
`TINT_DUMP_IR=<filter>` writes the lowered/optimized IR,
`--operation-ranges`/`TINT_OPERATION_RANGES=1` the operation ranges and
`--debug-symbols`/`TINT_DEBUG_SYMBOLS=1` symbols and DWARF lines (see
[profiling](profiling.md)).

## Pass statistics

```sh
node tools/bootstrap-compiler.ts .tint-bootstrap/stage1 --pass-stats
TZ=UTC TINT_BUILD_ONLY=1 TINT_PASS_STATS=1 node tools/verify-hosted-branch-threading.ts
```

The table lists every reported pass in pipeline order: dense reference-list
lowering, unreachable-function removal (before and after the optimizer), each
optimizer phase (phases repeat, for example the inlining rounds and the
cleanups after them) and, last, native code generation (`emit-native-code`,
phase `codegen`). Columns are `visited` (work charged to the optimization
budget), `rewritten` (the pass's own change count), `skipped` (functions left
unchanged by a local analysis limit; for `emit-native-code`, codegen analyses
that exceeded a per-function size limit and fell back to conservative code,
each also reported as a `missed` remark naming the function and analysis),
wall time in milliseconds, and `exhausted` when the pass ran out of budget:
its work was discarded, the optimizer kept the previous checkpoint and no
later pass ran. Budget exhaustion and skips are therefore always visible. The
JSON form is
`{"budgetExhausted":…,"passes":[{"index","phase","pass","visited","rewritten","skipped"?,"budgetExhausted","milliseconds"?}]}`.

Ahead-of-time builds are not work-limited (`unboundedWork`): every pass runs
to completion on every function, and codegen analyses lift their limits
(`EmissionOptions.unboundedAnalysis`). Analyses whose state would grow with
blocks x slots are sparse (slot liveness, interval facts, record guard
facts), so the largest functions are analyzed too. Live compilation (JIT
programs and dynamic functions) keeps a budget and fails with an error naming
the exhausted pass (`optimizationExhaustion`) rather than emitting a
partially optimized module.

Pass time is measured between observer callbacks and excludes the observer's
own bookkeeping (IR dumps, size accounting), so other reports do not inflate
it.

### Native compiler

```sh
lldb --no-lldbinit --batch \
  -o "process launch -- $PWD/.tint-bootstrap/source $PWD/.tint-bootstrap/stage2 --pass-stats" \
  .tint-bootstrap/stage1
```

`tint-compiler <project-root> <output> [--debug-symbols] [--pass-stats]`
prints the same table to stderr and publishes `<output>.pass-stats.json`.
The flags may appear in any order. Pass timing reads the monotonic clock,
which `compilerBuildRequest` (`@tint/compiler/cli`) binds when building the
compiler; a compiler built from a request without that binding (for example
`projectBuildRequest` or an older frozen source root) reports passes without
times. The emitted program is identical with and without `--pass-stats`.

### Pass benchmark

```sh
node tools/pass-bench.ts v3 --rounds 3 --save base.json
node tools/pass-bench.ts v3 --rounds 3 --compare base.json
node tools/pass-bench.ts v3 --compiler .tint-bootstrap/stage2-sf
```

Compile time per pass on a fixed input: a frozen workload's source
(`.tint-bootstrap/workload-<name>/source`, see
[benchmarking](benchmarking.md)), compiled with `--pass-stats` by the tree's
Node-hosted compiler (run `pnpm build` first) or, with `--compiler`, a native
`tint-compiler`. The report is each pass's median milliseconds over the
rounds, keyed by name and occurrence (`fold-constants#2`) so inserting a pass
does not misalign the comparison, with its work, rewrites and skips; with
`--compare`, the change per pass and in total, and passes only one side ran.
Any pass reporting budget exhaustion fails the benchmark.

## Per-pass IR dumps and diffs

```sh
TZ=UTC TINT_BUILD_ONLY=1 TINT_DUMP_PASSES=fixture:scale node tools/verify-hosted-…ts
node tools/ir-dump/pass-diff.ts <binary>.passes --summary
node tools/ir-dump/pass-diff.ts <binary>.passes --function fixture:scale --pass hoist
```

`TINT_DUMP_PASSES=<substring>` selects functions whose generated IR name or
source name (`module:function`, for example `fixture:scale` or
`packages/foundation/src/collections/sparse-list.ts:writeList`) contains the
substring; an empty value selects every function (large for whole-compiler
builds). The directory holds `input.ir` (the selected functions before the
first pass), one `NNN-<pass>.ir` per pass that changed a selected function
(only the changed functions), and `index.json` recording each pass, its
statistics and which functions it changed or removed. Dumps use a stable
form: function IDs are omitted and call/closure targets are printed by name
(`target=@name`), so renumbering by unreachable-function removal does not
show as a change; the header ends with `; <source name>`.

`pass-diff.ts` replays each function's versions and prints unified diffs per
pass (`=== 027 hoist-loop-invariants: <function>`), or with `--summary` the
passes that changed each function with added/removed line counts. Filters:
`--function` (generated or source name), `--pass` (pass name substring) and
`--context N`.

### Bisecting a miscompile to a pass

`TINT_OPT_PASS_LIMIT=<n>` stops the program's optimization after `n`
reported passes and emits the module the last one produced (0 disables
optimization of the program after lowering). The pass indexes are those of
the pass statistics table. Binary-search `n` between 0 and the pass count
for the first limit whose binary misbehaves; the pass at index `n-1` is the
culprit, and its dump/diff shows what it changed. Every pass checkpoint is
valid input to emission, so each truncated build is a working program unless
the pass introduced the fault. Hosted fixture manifests record the limit
(`optimizationPassLimit`) because it changes the image.

```sh
TZ=UTC TINT_OPT_PASS_LIMIT=12 node tools/verify-hosted-branch-threading.ts
```

## Optimization remarks

```sh
TZ=UTC TINT_BUILD_ONLY=1 TINT_REMARKS=pass=inline,outcome=missed node tools/verify-hosted-…ts
```

Remarks are JSON lines (`<output>.remarks.jsonl`):

```text
{"pass":"hoist-loop-invariants","outcome":"applied","function":"@1:value:0$191","start":249,"end":254,"message":"hoisted binary v84 out of loop b11 to preheader b9","file":"fixture","line":7,"column":45,"sourceFunction":"fixture:run"}
```

`function` is the IR function the decision was made in and `sourceFunction`
its source name; `file`, `line` and `column` (the source module's positions,
as in DWARF line tables) locate the deciding instruction (`start`/`end` are UTF-16 offsets in that file). Remarks without
a source span (whole-function or module decisions) have no location.
Identical remarks are written once (inlining rounds revisit declined calls).

The filter is a comma-separated list: `pass=<substring>`,
`function=<substring>` (generated or source name), `file=<substring>`,
`outcome=applied|missed`, or a bare term for `function=`. Terms with the
same key are alternatives; different keys must all match. An empty value or
`1` selects every remark.

| Pass                        | Applied                                                             | Missed (with reason)                                                                                                                                           |
| --------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inline-small-functions`    | `inlined X (cost, shape)`                                           | `not inlined X:` recursive, environment, import, callee cost over limit, unsupported callee, caller growth allowance, shape-recognized caller, crossing values |
| `hoist-loop-invariants`     | hoisted computations and checked immutable reads                    | loop without a unique preheader / plain-jump preheader; record reads that stay (mutable field, variant object, non-trapping failure, layout proof dependents)  |
| `lower-proven-record-reads` | read proven: unchecked field load                                   | layout unproven; representation not fixed                                                                                                                      |
| `select-array-access`       | unchecked typed-array read/write with the length and index interval | access stays checked (length/interval facts)                                                                                                                   |
| `split-optional-numbers`    | optional-number slot held as presence and value slots               | —                                                                                                                                                              |
| `emit-native-code`          | —                                                                   | a codegen analysis exceeded its size limit (function, blocks, slots): conservative code                                                                        |
| `thread-branches`           | jump merged with a thin branch block; edges threaded past retests   | —                                                                                                                                                              |
| `devirtualize-closures`     | indirect call devirtualized to X (dispatch)                         | callee not a known closure; arity or environment mismatch                                                                                                      |
| `scalar-replace-records`    | allocation replaced by scalar slots                                 | allocation escapes, is returned or unused                                                                                                                      |
| `dense-reference-lists`     | lists sharing the dense representation                              | the whole-program reason the transform declined; rejected aliases                                                                                              |

Block numbers in remarks are the IR block IDs at that pass (branch threading
reports IDs before its final compaction). Remarks of a pass that exhausts its
budget are discarded with its work.

### API

The optimizer takes an optional observer:

```ts
optimizeModule(module, budget, {
  observer: { begin(module) {}, pass(event) {}, remark(remark) {} },
  passLimit: 12, // diagnostics only
});
```

`OptimizationObserver` (`@tint/ir/optimization`) receives the input module,
a `PassEvent` (`statistics`, the `module` the pass produced, and
`budgetExhausted`) after every pass, and `OptimizationRemark`s. Passes take
an optional `RemarkSink` and build remark text only when one is present;
without an observer the pipeline does no extra work and returns the same
result. The optimizer buffers a pass's remarks and delivers them when the pass
completes. At the program level, `CompileRequest.optimizationObserver` and
`BuildRequest.optimizationObserver` take a `ProgramOptimizationObserver`
whose remarks are `LocatedRemark`s (with `file`, `line`, `column`) and which
also receives `functionNames` (generated name to `module:function`) before
`begin`. `optimizationPassLimit` is the program-level pass limit;
`BuildRequest.onEmittedFunctions` reports every emitted function of the
allocator, runtime and program modules at image offsets.
`tools/observability/build-observer.ts` implements the Node reports on these
hooks.

## Annotated disassembly

```sh
TZ=UTC TINT_BUILD_ONLY=1 TINT_DEBUG_SYMBOLS=1 TINT_OPERATION_RANGES=1 TINT_DUMP_IR= \
  TINT_CODE_SIZE=1 node tools/verify-hosted-branch-threading.ts
node tools/disasm/annotate.ts <binary> --function fixture:run
node tools/disasm/annotate.ts <binary> --profile capture.pb.gz --hot 5
```

The tool disassembles each selected function with `xcrun llvm-objdump` and
interleaves, before the instructions each one produced, the IR operation
(`; IR b1#1 v16 = array-new type=Float64Array length=416   [const@m ->Float64Array@r]`,
the bracket holding the operands' representations; index -1 is the block's
terminator) and, from DWARF, the source line (`; ./fixture:7`).
With `--profile` (a pprofessor capture; the tools decode the pprof protobuf
themselves, as `tools/op-cost` does) each instruction is prefixed with its
self samples and each function header shows its total and share. pprofessor
samples every thread on each tick, blocked ones included, so
`--thread busiest` (or a `thread_id`) restricts the samples to the thread
doing the most work in the binary, normally the main thread.

Inputs, all next to the binary and all optional:

- `<binary>.operations.json` (operation ranges) for IR annotations;
- `<binary>.optimized.ir` (`TINT_DUMP_IR=` with an empty filter, or a filter
  covering the functions) for the full IR text instead of the operation and
  operand signature;
- `<binary>.code-size.json` for exact function extents and source names of
  every module; otherwise debug symbols (`nm`), otherwise operation range
  extents (program functions only);
- DWARF (debug builds) for source lines; `--source-root <dir>` also prints
  the source text (objdump `--source`, resolved from that directory).

Select functions with `--function <substring>` (repeatable; matches the
symbol, source or IR name), `--hot N` (with a profile: the N functions with
most samples; the default without a filter is 10) or `--all`. Image offsets
are relative to `__TEXT,__text`, which the tool reads from the Mach-O load
commands.

## Code size

```sh
node tools/bootstrap-compiler.ts .tint-bootstrap/stage1 --code-size
node tools/code-size/compare.ts base.code-size.json head.code-size.json --max-growth-percent 0.5
```

`<output>.code-size.json` records the emitted bytes of every allocator,
runtime and program function (`module`, `name`, `source` for program
functions, `offset`, `bytes`), totals per module, and the program IR size
(instructions plus terminators) at the input and after each pass with the
functions whose size the pass changed. The stderr table shows the module
totals, the largest functions and the IR size by pass with each pass's delta
and largest per-function change.

`compare.ts` prints total and per-module deltas and the functions that grew
or shrank most. Generated instance suffixes (`$123`) differ between builds,
so functions are compared by name without them, summing instances (`--exact`
compares full names). `--max-growth <bytes>` and
`--max-growth-percent <p>` make it exit 1 when the total grows beyond the
limit, for use as a size-regression check.
