# Runtime diagnostics

Three opt-in facilities make native Tint programs observable by external
tools: symbolicated stack traces for uncaught throws, collector-phase
intervals (`os_signpost` on macOS, USDT probes on Linux), and
debugger/profiler visibility of code published at runtime. Each is a `BuildRequest` option. Without them an image is
byte-for-byte what it was before these facilities existed; every routine,
table and data word described here exists only in opted-in images. Tint emits
all of it itself (no C shims, platform linker or profiler runtime): routines
are AArch64 code composed after the program module, and OS facilities are
reached through the image's own import table.

| Option (`BuildRequest`) | Hosted fixture variable | Feature                              |
| ----------------------- | ----------------------- | ------------------------------------ |
| `stackTraces`           | `TINT_STACK_TRACES=1`   | Uncaught-throw value and trace       |
| `signposts`             | `TINT_SIGNPOSTS=1`      | GC and allocation intervals (probes) |
| `jitDebugInterface`     | `TINT_JIT_DEBUG=1`      | GDB/LLDB JIT interface (+ perf map)  |

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

| Name                                       | Function                                                                                                                                                |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gc.collect`                               | One collection (generational or copying `collect`); generational collections end with `major=… nursery=… copied=… old=…`                                |
| `gc.minor` / `gc.major`                    | Serial evacuation (Cheney `collect`), by whether remembered roots are passed (generational minors; the copying runtime's whole-space copies are majors) |
| `gc.major`                                 | A generational major: mark-compact in place (`createCompactor`'s `collect`)                                                                             |
| `gc.parallel-minor`                        | Parallel evacuation of the nursery                                                                                                                      |
| `gc.parallel-mark` / `gc.parallel-forward` | A major's mark and forwarding phases on the collector pool                                                                                              |
| `gc.worker`                                | One thread's part of a pool phase (evacuation `share`, `drainMarks` or `forwardChunks`), on every participating thread                                  |
| `gc.roots`                                 | The precise stack-map root walk (`walkNativeStack`, serial or on a worker)                                                                              |
| `gc.remembered`                            | Parallel remembered-set scanning                                                                                                                        |
| `alloc.slow`                               | Each runtime allocation slow-path call (the context's allocator entry)                                                                                  |

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

A collection is major when its force flag is set, its nursery is empty or
the nursery does not fit the old space's free room, as the collector decides;
the thunk reads this at entry because majors compact in place.

### Linux USDT probes

On Linux (`linuxHostABI().signposts`: `elf-usdt`, provider `tint`) the same
option emits statically defined tracing probes instead: no library call,
string or log handle, and no startup call. The thunks and the allocation
forwarder are the same; the signpost routine they call saves x9–x13, puts
the interval identifier (the thunk's frame address) in x9 and branches in
constant time to the `nop` probe site of the interval name and edge. The
image's `.note.stapsdt` notes (SystemTap SDT v3, no semaphores) and its
allocated `.stapsdt.base` byte describe the sites.

| Probe                                  | Arguments                                                             |
| -------------------------------------- | --------------------------------------------------------------------- |
| `<interval>__begin`, `<interval>__end` | `8@x9`: interval id                                                   |
| `gc__end`                              | `8@x10 8@x11 8@x12 8@x13 8@x9`: major, nursery, copied, old bytes, id |
| `alloc__sample` (heap introspection)   | `8@x0 8@x1 8@x2`: address, size, context                              |

Interval probe names are the interval names with `.` and `-` replaced by `_`
(`gc.parallel-minor` → `gc_parallel_minor__begin`); `gc__end` fires before
`gc_collect__end` for collections with metrics. `alloc__sample` is the heap
sampling hook's `nop`, so it exists in every heap-introspection image (debug
builds), with or without `signposts`.

On Linux x86-64 the interval identifier is `8@%rbp`. The `gc__end` probe
uses `8@%r8 8@%r9 8@%r10 8@%r11 8@%rbp` in the same metric order.
One leaf stub per probe name serves every instrumented call site, including
the collector's direct closure specializations.

```sh
TINT_BUILD_ONLY=1 TINT_SIGNPOSTS=1 node tools/<fixture>.ts   # prints the image path
readelf --notes <image>
gdb -q -batch -nx -x tools/gdb/tint-probes.py <image>        # counts every probe
bpftrace -e 'usdt:<image>:tint:gc__end { @copied = hist(arg2); }' -c <image>
perf buildid-cache --add <image> && perf record -e sdt_tint:gc__end -- <image>
```

GDB parses the notes itself (`info probes stap`, `break -probe-stap
tint:gc__end`, `$_probe_arg0`…), so it works without kernel tracing support;
bpftrace and perf attach uprobes and need `CONFIG_UPROBE_EVENTS` and tracefs.
`node tools/verify-hosted-signposts.ts <dir>` on Linux checks the notes and
the probe hits under GDB.

#### Live tracing check

`tools/linux/verify-usdt-live.ts` checks perf and bpftrace against GDB on
the signpost fixture:

```sh
node tools/linux/verify-usdt-live.ts <new-output-directory> [--image <image>] [--static-only]
```

1. **Static** (no kernel support needed): it reads the image's
   `.note.stapsdt` notes itself and checks provider `tint`, no semaphores,
   the `.stapsdt.base` address, the argument specs above, one probe per
   name and a `nop` at every site. It then checks that `readelf --notes`,
   `perf list sdt` (through an isolated build-ID cache) and
   `bpftrace -l 'usdt:<image>:*'` list the same probes.
2. **GDB reference**: `tools/gdb/tint-probes.py` counts every probe and
   records `gc__end`'s metrics; the fixture must exit 42.
3. **perf**: `perf probe -x <image> -a %sdt_tint:<name>` for every probe,
   `perf record -e 'sdt_tint:*'`, `perf script -F tid,event,trace`.
4. **bpftrace**: one program counting `usdt:<image>:tint:*` by probe and
   `gc_worker__begin` by thread, and printing `gc__end`'s arguments.

Each tracer's count must equal GDB's for every probe, and the major,
nursery, copied and old values of every `gc__end`, in order, must equal
GDB's. Only `gc.worker` may differ, because a worker may join a pool phase
or not; its edges must balance across more than one thread. On the
development container the counts were identical in three GDB runs (91
collections, 4 majors, 48 worker intervals on 6 threads).

perf and bpftrace run through `sudo -n` unless the script runs as root. The
image is copied to a local temporary directory first, because uprobes
attach to an inode, and network or shared mounts may not support them. The
output directory receives `summary.json`, the listings, `gdb.txt`,
`perf-record.txt`, `perf-script.txt`, `perf.data` (root-owned when sudo
was used), `probes.bt` and `bpftrace.jsonl`. Exit status: 0 when every
check passed, 77 when the static checks passed but the kernel cannot attach
uprobes (the reason is printed and recorded), 1 on a failed check.
`tools/usdt-live.test.ts` tests the note reader, the output parsers and the
comparison without a kernel.

On Debian 13 arm64 (Linux 6.12 with uprobes and tracefs), the full
verifier passed. Perf and bpftrace matched GDB's counts and all 91
ordered `gc__end` records. [Kernel verification](results/linux-real-kernel-v1.md)

The development container (Debian 12, kernel 6.1 without uprobes or
tracefs, GDB 13.1, perf 6.1, bpftrace 0.17) passes the static checks (21
probes) and exits 77 when live tracing is requested. To run it live on
an aarch64 VM:

1. Use a kernel with `CONFIG_UPROBE_EVENTS=y`
   (`grep UPROBE_EVENTS /boot/config-$(uname -r)`) and 4 KiB or 16 KiB
   pages (`getconf PAGESIZE`; Tint images reject 64 KiB pages). Stock
   Fedora and Debian arm64 kernels are built this way.
2. Mount tracefs if it is not mounted:
   `sudo mount -t tracefs nodev /sys/kernel/tracing`.
3. Install the tools. On Fedora:
   `sudo dnf install -y git gdb perf bpftrace binutils`. On Debian:
   `sudo apt install git gdb linux-perf bpftrace binutils`.
4. Install Node 24.12 (for example from nodejs.org's
   `node-v24.12.0-linux-arm64.tar.xz`), then
   `corepack enable && corepack prepare pnpm@10.34.8 --activate`.
5. In a checkout: `pnpm install --frozen-lockfile && pnpm build`.
6. As a user with passwordless sudo, or as root:
   `node tools/linux/verify-usdt-live.ts /tmp/usdt-live-1`.
   It prints one line per stage, ending with
   `Verified live USDT tracing with perf and bpftrace.`

`--image <image>` checks an image built elsewhere (for `linux-aarch64`,
with signposts) instead of building the fixture; it must run the signpost
fixture's program for the GDB checks to hold.

## JIT code visibility

With `jitDebugInterface`, the image exports `__jit_debug_register_code` (a
two-instruction routine) and `__jit_debug_descriptor` (version 1, in the
image's data), the GDB JIT interface that GDB and LLDB's `JITLoaderGDB` read. Host
operations expose it to trusted runtime code:

| Host operation         | Binding (`@tint/native-runtime/intrinsics/diagnostics`) |
| ---------------------- | ------------------------------------------------------- |
| `jit-debug-descriptor` | `jitDebugDescriptor(): number`                          |
| `jit-debug-register`   | `notifyJitDebugger(): void`                             |
| `memory-write-bytes`   | `writeMemoryBytes(address, byteLength, offset, bytes)`  |
| `process-id`           | `processId(): number`                                   |

`createJitDebugRegistrar` (`@tint/js-engine/native/jit-debug`) implements the
protocol over injected hosts. `register({ address, code, functions, lines,
directory })` builds an in-memory object in the debugger host's `objectFormat`
(the target's): on Darwin an `MH_OBJECT` (`@tint/image/darwin/macho/jit-object`)
whose `__text` lies at the code's live address with an absolute symbol per
function, on Linux an in-place relocated `ET_REL` ELF object
(`@tint/image/linux/elf/jit-object`) whose `.text` has the live `sh_addr` and
section-relative function symbols; when line rows are given, either carries
DWARF compiled by the shared `@tint/image/dwarf` encoder. It links the object
as the descriptor's first entry and
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

GDB reads the interface without configuration; use explicit locations, since
`jit:jitSum` would otherwise parse as a file and line:

```text
(gdb) set breakpoint pending on
(gdb) break -function jit:jitSum
(gdb) break -source jit-source.ts -line 3
(gdb) run
```

On Linux the executable view of an arena is a private mapping of its memory
file ([native code loading](native-code-loading.md)), so debuggers plant
ordinary software breakpoints in JIT code; publishing into a page that holds
one writes the debugger's private copy directly.

`node tools/verify-hosted-jit-debug.ts <dir>` builds a native program for the
host target that compiles `jitSum` with the in-image compiler, publishes,
registers and calls it, publishes a second function into the same page while
the breakpoint is inserted, then checks under LLDB (and on Linux also GDB) that
both pending breakpoints resolve, the backtrace runs from the JIT function
through its native callers, the line entry is `jit-source.ts:3`, and the perf
map names the function.

## Evidence

Native runs are recorded in
[runtime-diagnostics-v1](results/runtime-diagnostics-v1.json).
