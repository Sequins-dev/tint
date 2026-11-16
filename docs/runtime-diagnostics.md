# Runtime diagnostics

Three opt-in facilities make native Tint programs observable by external
tools: symbolicated stack traces for uncaught throws, `os_signpost` intervals
for collector phases, and debugger/profiler visibility of code published at
runtime. Each is a `BuildRequest` option. Without them an image is
byte-for-byte what it was before these facilities existed; every routine,
table and data word described here exists only in opted-in images. Tint emits
all of it itself (no C shims, platform linker or profiler runtime): routines
are AArch64 code composed after the program module, and OS facilities are
reached through the image's own import table.

| Option (`BuildRequest`) | Hosted fixture variable | Feature                             |
| ----------------------- | ----------------------- | ----------------------------------- |
| `stackTraces`           | `TINT_STACK_TRACES=1`   | Uncaught-throw value and trace      |
| `signposts`             | `TINT_SIGNPOSTS=1`      | GC and allocation intervals         |
| `jitDebugInterface`     | `TINT_JIT_DEBUG=1`      | GDB/LLDB JIT interface (+ perf map) |

`jitDebugInterface` requires `allowJit`. The routines live in
`packages/codegen/src/aarch64/diagnostics.ts`; startup composition
(`startup.ts`) patches their call sites and `build.ts` adds the tables.

## Stack traces

With `stackTraces`, every throw origin (an IR `throw` or `throw-literal`
terminator in the allocator, runtime and program modules) calls a capture
routine with the thrown value. It walks the frame-pointer chain from the
throwing frame and records up to 64 `(frame pointer, return address)` pairs
in the image's `__DATA`, stopping at the first return address outside the
image. A throw of the value already recorded, from a frame of the recorded
chain with the same callers, is a rethrow (`catch (e) { …; throw e; }`,
`finally`): the original origin is kept. Another throw replaces the record.
The routine preserves every register except `x16`/`x17`, so throw sites need
no extra spills; its cost is paid only when a throw happens.

When the program's entry completes by throwing, startup calls the reporter
before exiting with status 70 (unchanged). The reporter writes to standard
error and allocates nothing, so heap exhaustion and stack overflow still
report:

```text
Uncaught boom é世😀
    at fixture:inner (fixture:1:46)
    at fixture:inner (fixture:1:92)
    at fixture:outer (fixture:2:48)
    at fixture:run (fixture:4:70)
    at __tint_invoke (code+0x753d4)
    at tint:process-entry (code+0xaf4)
```

Format:

- `Uncaught <value>`: strings print their text (UTF-8, at most 160 UTF-16
  units, then `...`); integral numbers below 2^32 in magnitude print exactly,
  other numbers as `<number>`; `true`, `false`, `null`, `undefined`; objects
  (including `Error` objects of JavaScript programs) as `<object>`. The
  engine's reserved stack-overflow/impossible-allocation value prints as
  `RangeError: stack overflow or impossible allocation`.
- One `    at <function> (<file>:<line>:<column>)` line per frame, innermost
  first. Lines and columns are 1-based UTF-16 positions, as in DWARF. Frames
  without a source row print `(code+0x<offset>)`, the offset from the image's
  first instruction; unknown functions print `<unknown>`.
- Function names are the debug-symbol names without generated-instance
  suffixes; program functions omit the `program:` prefix, runtime and
  allocator functions keep `runtime:`/`allocator:`.
- `    (no throw-site trace was recorded for this value)` when the uncaught
  value was not thrown by a throw terminator (stack overflow, allocation
  failure) or a moving collection relocated it after the throw.

Each frame's source position is that of its call instruction (the return
address minus 4); the innermost is the throw itself. Inlined callees have no
frames of their own: their throws report the inlining caller's call site, as
the DWARF rows do. The trace table is the compact format in
`@tint/image/trace-table` (functions, line rows, file names; little-endian
u32 records sorted by code offset), stored in `__TEXT,__const` after the
code; `lookupTraceTable` is its reference reader. Its rows are the same
source ranges that `debugSymbols` encodes as DWARF, but no DWARF or symbol
table is required.

Limitations: the record is process-wide, so threaded programs report the most
recent throw of any thread; `Error().stack` is not implemented by the
JavaScript runtime and is unaffected.

## Signposts

With `signposts`, collector phases and allocation slow paths emit
`os_signpost` intervals (subsystem `dev.tint.runtime`, category
`PointsOfInterest`), called directly through `libSystem` imports
(`_os_log_create`, `os_signpost_enabled`, `_os_signpost_emit_with_name_impl`).
libtrace accepts interval names only from the image's `__TEXT,__cstring`, so
the image gains that section. Intervals:

| Name                                      | Function                                                                     |
| ----------------------------------------- | ---------------------------------------------------------------------------- |
| `gc.collect`                              | One collection (generational or copying `collect`); generational collections end with `major=… nursery=… copied=… old=…` |
| `gc.minor` / `gc.major`                   | Serial evacuation (Cheney `collect`), by whether remembered roots are passed |
| `gc.parallel-minor` / `gc.parallel-major` | Parallel evacuation, by its minor flag                                       |
| `gc.worker`                               | One worker's evacuation share, on every participating thread                 |
| `gc.roots`                                | The precise stack-map root walk (`walkNativeStack`, serial or on a worker)   |
| `gc.remembered`                           | Parallel remembered-set scanning                                             |
| `alloc.slow`                              | Each runtime allocation slow-path call (the context's allocator entry)       |

Functions are instrumented at composition: their first instruction (the
standard frame push) becomes a branch to a thunk that begins the interval,
calls a stub replaying the push and continuing in the body, and ends the
interval. The interval identifier is the thunk's frame address, so nested and
concurrent intervals pair correctly. Stack-passed arguments are copied for the
body. The allocation entry stored in the runtime context is replaced by a
forwarding thunk. When no tool is recording, each interval costs an
`os_signpost_enabled` check.

Record and inspect:

```sh
TINT_BUILD_ONLY=1 TINT_SIGNPOSTS=1 node tools/<fixture>.ts   # prints the image path
xcrun xctrace record --template 'Logging' --output gc.trace --launch -- <image>
xcrun xctrace export --input gc.trace \
  --xpath '/trace-toc/run[@number="1"]/data/table[@schema="OSSignpostIntervals"]'
```

The `gc.collect` end message reports the collection's metrics from the
allocation state: whether it was major, the nursery bytes it evacuated, the
bytes it copied (promoted by a minor, surviving a major) and the old-space
bytes after it (see [native heap profiling](native-heap-profiling.md)).

Instruments' `os_signpost` and Points of Interest instruments show the same
intervals; `node tools/verify-hosted-signposts.ts <dir>` records a GC-heavy
fixture and summarizes the intervals per name and thread.

## JIT code visibility

With `jitDebugInterface`, the image exports `__jit_debug_register_code` (a
two-instruction routine) and `__jit_debug_descriptor` (version 1, in
`__DATA`), the GDB JIT interface that LLDB's `JITLoaderGDB` reads. Host
operations expose it to trusted runtime code:

| Host operation         | Binding (`@tint/native-runtime/intrinsics/diagnostics`) |
| ---------------------- | ------------------------------------------------------- |
| `jit-debug-descriptor` | `jitDebugDescriptor(): number`                          |
| `jit-debug-register`   | `notifyJitDebugger(): void`                             |
| `memory-write-bytes`   | `writeMemoryBytes(address, byteLength, offset, bytes)`  |
| `process-id`           | `processId(): number`                                   |

`createJitDebugRegistrar` (`@tint/js-engine/native/jit-debug`) implements the
protocol over injected hosts. `register({ address, code, functions, lines,
directory })` builds an in-memory `MH_OBJECT` (`@tint/image/darwin/macho/jit-object`)
whose `__text` lies at the code's live address, with an absolute symbol per
function and, when line rows are given, DWARF compiled by the shared
`@tint/image/dwarf` encoder; links it as the descriptor's first entry; and
calls the hook. `unregister(entry)` unlinks it before code is replaced. With a
perf-map host it also appends `<start> <size> <name>` (hexadecimal) lines to
`/tmp/perf-<pid>.map`, replacing a stale file left by an earlier process with
the same ID; samply and Linux perf read this format. Without a debugger
attached, registration costs the object construction and a call to an empty
routine.

`createEngineCodeStorage` accepts a `published(address, bytes, functions)`
observer: the engine's Script and dynamic-function publishers pass each
emitted module's function names, so an embedding can register all JIT code
by forwarding to the registrar.

LLDB disables its JIT loader on Darwin by default; enable it before launch:

```text
(lldb) settings set plugin.jit-loader.gdb.enable on
(lldb) breakpoint set --name jit:jitSum          # pending until registration
(lldb) breakpoint set --file jit-source.ts --line 3
(lldb) process launch
```

`node tools/verify-hosted-jit-debug.ts <dir>` builds a native program that
compiles `jitSum` with the in-image compiler, publishes, registers and calls
it, then checks under LLDB that both pending breakpoints resolve, the
backtrace runs from the JIT function through its native callers, the line
entry is `jit-source.ts:3`, and the perf map names the function.

## Evidence

Native runs are recorded in
[runtime-diagnostics-v1](results/runtime-diagnostics-v1.json).
