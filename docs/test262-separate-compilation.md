# Test262 separate compilation

Status: implemented for Script cases (`TINT_TEST262_LINKING=units`),
2026-11-11. Decision recorded by the user on 2026-11-10:
compile the runtime once per toolchain and link each batch's lowered test
scripts against it, keeping ahead-of-time (AOT) semantics. Building one
test-independent image that compiles test sources with the in-image script
compiler at run time was rejected, because the ledger would then measure the
runtime-compile path.

## Why

Measurements on the frozen toolchain at 1bc017b0 (macOS arm64, Node 24):

- **Runner wall time:** 88% compiling batch images, 6% preparing services,
  3% native execution, 2% initialization. Source: phase intervals of the
  runner heartbeat over a 22-variant staging selection.
- **Batch cost is independent of the tests:** a batch holding one trivial Script
  took 318–387 s (under load) and produced a 101,186,767-byte image. A batch
  compiles the generated `test262-runtime` module, the JavaScript runtime and
  engine, the in-image script compiler, and the hosts, as one linked whole
  program.
- **Inside a batch compile** (V8 profile of two 6-variant batches): codegen 27%
  (half of it the IR verifier), closure checking 18%, lowering 15%, collection
  runtime preparation 12%, managed surface preparation 15%, GC 14%.

So nearly all suite compute repeats the same runtime compilation, about 15,000
times for a full run.

## Mechanism: Script units linked into a host compiled once

Each runner compiles one host program and links each batch's Scripts into it
as separately compiled units. Units are linked at build time, in Node, so every
batch is still an ordinary AOT image; no unit loader runs in the image.

- **Host, once per runner** (`createNativeUnitBatchBuilder`): the same runtime,
  engine, harness and Script surface as a whole-program batch, plus a slot
  facade of 1,024 factory slots (`prepareNativeUnitHost`). The host does not
  depend on the batch: the process argument selects a case as
  `<async><suspend>:<slot>,...`. Each slot is called with the Script entry
  frame, as the Script evaluator calls a compiled entry, and the results run
  through the same `runNativeScripts` harness. `compileMacOSProgram` compiles
  it; slots name only their surface, and the compiler derives the factory
  contract from the directory it publishes. Compiled hosts are cached on disk
  by frozen toolchain, sources and configuration.
- **Units, once per Script** (`createScriptUnitCompiler`): each AOT-lowered
  Script is compiled with factory initialization against the host's published
  `scriptRuntime` directory, through the entry pipeline in-image evaluation
  uses. Units are memoized by content, so shared harness Scripts compile once
  per run.
- **Batch:** `linkMacOSProgram` binds the batch's units to slots (unused slots
  share one linked copy) and writes the image.
- **Routing:** module, Script-root and agent cases, and Scripts the entry
  profile rejects (for example `callback variance crosses surface classes` in
  some `yield*` tests), use the whole-program path. The runner queues the
  kinds separately so each fills whole batches, and journals observations in
  selection order through a reorder buffer, so resume is unchanged.
- **Visibility:** compilation records carry `linking: "units"`, failure
  reasons and fallback reasons.

What stays the same: Script lowering, the JavaScript runtime, engine and
harness, and the execution host. What changes: a lowered Script is checked
against the published surface rather than the whole program, and is not part
of the runtime's closed-world optimizations. A result that differs between
the two paths is a compiler bug in one of them.

## Results

Full `language` selection, six shards, frozen toolchain `str-u6`
(macOS arm64, Node 24, TZ=UTC), against the whole-program run `full27`:

|                        | whole program | units           |
| ---------------------- | ------------- | --------------- |
| statuses               | 44,701 pass   | 44,701 pass     |
| per shard              | ~2 h 10 min   | 42–46 min       |
| linked as units        | –             | 34,567 variants |
| whole-program fallback | all           | 1,846 variants  |

Per shard (units run): about 4 min compiling the host (before the host
cache), about 0.14 s per Script unit, 4–5 min per 128-variant whole-program
batch under six-way load, and about 0.05 s per variant executing.

## Next steps

- Module and Script-root cases as units (the remaining whole-program batches).
- Unit compile time, especially the large Unicode identifier Scripts
  (30–120 s each).
- Shard count: the host has 18 cores and 128 GB; runners peak near 5 GB.
