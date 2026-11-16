# Chrome DevTools for native programs

`tools/devtools` is a Node sidecar that opens a native process in Chrome
DevTools. It speaks the Chrome DevTools Protocol (CDP) to the frontend and
the Debug Adapter Protocol (DAP) to a debug adapter, `lldb-dap` by default.
It controls the process from outside through the OS debugger interface, so
the binary contains no CDP or agent code.

- **Generic native programs**: anything built with debug info (`clang -g`)
  gets the language-neutral parts: Sources, breakpoints, stepping, call
  stacks with inlined frames, scopes and locals, console output, and CPU
  profiles.
- **Tint debug builds** also get the Tint plugin: JavaScript-like values,
  source frame names, heap snapshots, sampling heap profiles and forced
  garbage collection.

The binary carries only what debug builds already have: DWARF, unwind info,
the heap descriptor (`__tint_heap_descriptor`) and the dormant
`__tint_allocation_sample` hook ([native debugging](native-debugging.md),
[native heap profiling](native-heap-profiling.md)). Default builds are
unaffected.

## Workflow

```sh
# A Tint debug build, for example the heap tools fixture (the image path is
# printed), or any program built with clang -g.
TINT_KEEP_NATIVE=1 node tools/verify-heap-tools.ts unarmed

node tools/devtools/cli.ts --wait <image> [-- <args>...]
# DevTools listening on ws://127.0.0.1:9229/<id>
# Open devtools://devtools/bundled/inspector.html?ws=127.0.0.1:9229/<id>
# or chrome://inspect (Configure: 127.0.0.1:9229)
```

1. Open the printed `devtools://` URL in Chrome, or open
   `chrome://inspect`, add `127.0.0.1:9229` under _Configure_, and click
   _inspect_ on the target.
   - `/json/list` also gives the `js_app.html` (Node-style) URL.
2. With `--wait`, the program starts when DevTools sends
   `Runtime.runIfWaitingForDebugger`, which it does once it is attached.
   Breakpoints set before then are in place from the first instruction.
3. Use the panels:
   - **Sources**: every file of the line tables, set breakpoints, step,
     inspect scopes. Hovering a variable reads it without running code.
   - **Console**: the program's output.
   - **Memory** (Tint): _Heap snapshot_, _Allocation sampling_ and the
     _Collect garbage_ button.
   - **Performance** / **JavaScript Profiler**: CPU profiles.
4. When the program exits, DevTools stays connected, so the profiles and
   snapshots stay open. Press Ctrl-C to quit the bridge, which kills a
   launched program and detaches from an attached one.

### Options

| Option                 | Meaning                                                                                                                                |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `--pid <pid>`          | Attach to a running process instead of launching one.                                                                                  |
| `--port`, `--host`     | The CDP/HTTP endpoint (default `127.0.0.1:9229`; `--port 0` picks a free port).                                                        |
| `--wait`               | Start the program when DevTools connects.                                                                                              |
| `--plugin`             | `auto` (default: Tint for images whose symbols name `tint:process-entry`), `tint` or `none`.                                           |
| `--source-root <dir>`  | Resolve relative debug-info paths. The current directory and the program's directory are always tried.                                 |
| `--source-map <p>=<f>` | Read debug-info path `p` from file `f`, for example `fixture=/tmp/fixture.ts` for a hosted fixture whose source exists only in memory. |
| `--sampler`            | `pprofessor` (default when installed) or `backend`.                                                                                    |
| `--adapter <path>`     | The `lldb-dap` binary. The default is `xcrun -f lldb-dap`, then `$LLDB_DAP`, then `PATH`.                                              |
| `--trace`              | Log CDP and DAP traffic to stderr.                                                                                                     |

The HTTP endpoints and the WebSocket accept only loopback host names and
IP literals in the `Host` header, as Node's inspector does, so a web page
cannot reach the bridge through DNS rebinding.

## Generic native programs

```sh
clang -g -O0 prog.c -o prog
node tools/devtools/cli.ts --wait ./prog
```

- **Scripts**: every source file of every module's line tables, so system
  libraries with debug info appear too.
- **Frames without source** (system code) open as their disassembly,
  through DAP `source`.
- **Inlined frames**: inlined calls, including `always_inline` ones at
  `-O0`, are separate call frames.
- **Values**:
  - Numbers, booleans and C strings (`char *`, `char[]`) are primitives.
  - Structures and pointers expand.
  - Arrays show their element count.
- **CPU profiles**: frames carry the C file and line, with ticks per line.

`tools/devtools-c.test.ts` drives all of this on a C program.

## The Tint plugin

### Values

`tools/lldb/tint.py`'s formatters run inside `lldb-dap`. The plugin turns
their output into JavaScript RemoteObjects:

| Value                                 | RemoteObject                                                                                    |
| ------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `double`, int64 `long`                | number (`-0`, `NaN` and the infinities as unserializable values)                                |
| `bool`                                | boolean                                                                                         |
| strings (`string *`, summaries)       | string                                                                                          |
| lists, number lists, vectors          | `Array(n)`; elements are named `0`, `1`, …                                                      |
| insertion-ordered maps / sets         | `Map` / `Set`; entries are named by key, or by index for sets                                   |
| records                               | an object named by its class or field list (`{x, y, label}`); headers and presence bytes hidden |
| general values                        | the value they hold. A general holding an object expands to that object's fields.               |
| function records                      | function                                                                                        |
| null references, `undefined` generals | `undefined`                                                                                     |

Frame names are source names, so `program:fixture:run [@1:value:3$255]`
becomes `run`. Inlined functions are separate frames, callee first.

### Heap snapshots (`HeapProfiler.takeHeapSnapshot`)

1. The bridge stops the program at a **precise safepoint**: it runs
   `tint-heap arm 1`, which sends the next allocation into the slow path,
   and stops at `__tint_allocation_sample` after that allocation. Every
   frame below the hook is at a safepoint
   ([native heap profiling](native-heap-profiling.md#the-allocation-sampling-hook)).
2. `tint-heap dump` runs inside the debugger and reads the heap in one
   in-process pass. It never goes through DAP `readMemory`, which is too
   slow for GB-scale heaps.
3. The shared profiling core (`tools/profiling`) builds the graph, the
   dominators and the `.heapsnapshot`.
4. The bridge streams the snapshot as `HeapProfiler.addHeapSnapshotChunk`
   events of about 1 MB, honouring socket backpressure, with
   `reportHeapSnapshotProgress` when asked.

Root frames are named by source function and line, for example
`inspect (fixture:27)`, under `(GC roots)` › `(Stack roots)`.

If the program was paused, it is shown paused again afterwards, now at the
allocation it reached. The hook frames are hidden. If no allocation comes
within 30 s (an idle or blocked program), the method fails with an error
and the program is left as it was.

### Sampling heap profiles

- `HeapProfiler.startSampling({samplingInterval})` arms the hook with
  exponentially distributed intervals of that mean.
- The bridge keeps a function breakpoint on `__tint_allocation_sample`.
  At each stop it runs `tint-heap sample-record`, which records the stack
  and draws the next interval, and continues. The frontend never sees
  these stops.
- `getSamplingProfile` returns the samples so far without stopping the
  program; `stopSampling` disarms the hook and returns the profile.
- The profile is DevTools' `SamplingHeapProfile`, built by the shared core:
  - Node `selfSize` is the estimated number of bytes allocated there (each
    nursery sample stands for 1 / (1 − e^(−size/interval)) allocations).
  - Call frames link to the Sources panel's scripts.

Each sample costs a debugger round trip (a few milliseconds), so choose the
interval accordingly. The bridge does not use LLDB breakpoint script
callbacks for this: with `lldb-dap` they left stops unreported and
`continue` requests blocked until the process exited.

### Garbage collection (`HeapProfiler.collectGarbage`)

The runtime's allocator treats a request of size 0 as a forced full
collection. The bridge makes that request only at a safepoint:

1. **Reach a safepoint.** `tint-heap arm 1` sends the next allocation into
   the slow path. The bridge stops at the entry of
   `__tint_allocation_sample_thunk`, which the allocation's frame calls at
   its allocation safepoint.
2. **`tint-heap collect-begin`**:
   - saves the argument registers;
   - pushes a frame record `{fp, lr}` of the allocating frame just below
     `sp`, and points `fp` and `sp` at it;
   - sets `lr` to the thunk's entry and the request (`d0`) to 0.
   - Continuing calls the thunk with request 0, which collects. The
     precise root walk passes through the thunk's transparent frames to
     the pushed record, whose return address is the allocating frame's
     safepoint.
3. **`tint-heap collect-end`**: at the return to the thunk's entry (the
   same breakpoint), restores the argument registers, `lr`, `fp` and `sp`.
   `x19`–`x28` keep the collector's updates. Continuing performs the
   original allocation.

The test checks the effect and that the program stays correct:

- the nursery is empty afterwards;
- the old space holds only live data;
- the program, collected while paused and while running, still exits 42.

### `Runtime.getHeapUsage`

Reported while the program is paused: the bytes used in the old and young
spaces, and the managed heap's size. While the program runs it returns an
error rather than stopping the program each time DevTools polls.

## CPU profiles (Profiler domain)

`Profiler.start` and `Profiler.stop` return a CDP `Profile` (`.cpuprofile`)
that the Performance and JavaScript Profiler panels load. Two samplers are
available:

- **pprofessor** (default when installed): runs
  `pprofessor attach <pid> --main-thread --freq <1e6 / interval>`.
  - It samples through the Mach task port while the debugger holds the
    process.
  - On stop, its pprof profile is decoded by the shared core.
  - Every address is re-symbolised from DWARF through the debugger
    (`devtools symbolize`): file, line, column, the function's start line,
    and inlined callees as their own nodes.
  - Ticks per line become `positionTicks`.
- **backend** (`--sampler backend`): stops the program at the interval
  (at least 10 ms), reads the stack, and continues. It works with any
  backend that can read stacks, but is coarse and intrusive.

Offline, the same conversion is available:
`node tools/heap-snapshot/cli.ts cpu <profile.pb.gz> --image <exe> --cpuprofile <out>`.

## The shared profiling core

`tools/profiling` is format-neutral. Producers fill one of two models:

- **A heap graph** (`heap-graph.ts`): objects, named edges and root frames.
- **A sample profile** (`samples.ts`): samples with DWARF-symbolised
  stacks, inlined lines included.

Writers turn them into:

- `.heapsnapshot` (`heapsnapshot.ts`), to a file or a chunk sink;
- pprof (`pprof.ts`), which encodes and decodes;
- `.cpuprofile` and `.heapprofile` (`devtools-profiles.ts`);
- in-use and allocation profiles (`heap-profiles.ts`).

The CLI (`tools/heap-snapshot/cli.ts`) and the bridge use the same code.

## Supported CDP methods

Unsupported methods answer at once with a CDP error: `-32601` for unknown
methods, `-32000` with a reason for known but unsupported ones. Nothing
waits for a reply that never comes.

| Domain       | Supported                                                                                                                                                                                                                                                                                                                                                                                         | Unsupported (error)                                                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Debugger     | `enable`, `disable`, `getScriptSource`, `setBreakpointByUrl` (url, urlRegex, condition), `setBreakpoint`, `removeBreakpoint`, `setBreakpointsActive`, `getPossibleBreakpoints`, `pause`, `resume`, `stepOver`, `stepInto`, `stepOut`, `evaluateOnCallFrame` (plain variable paths such as `a.b[0]`); no-ops: `setPauseOnExceptions`, `setAsyncCallStackDepth`, `setBlackbox*`, `setSkipAllPauses` | `setVariableValue`, `setScriptSource`, `restartFrame`, `continueToLocation`, `setReturnValue`, `searchInContent`, `setInstrumentationBreakpoint`, other expressions |
| Runtime      | `enable`, `disable`, `getProperties`, `runIfWaitingForDebugger`, `getIsolateId`, `getHeapUsage` (Tint, paused); no-ops: `releaseObject(Group)`, `discardConsoleEntries`, `setAsyncCallStackDepth`, `addBinding`                                                                                                                                                                                   | `evaluate`, `callFunctionOn`, `compileScript`, `runScript`, `queryObjects`, `globalLexicalScopeNames`                                                               |
| Console      | `enable`, `disable`, `clearMessages`                                                                                                                                                                                                                                                                                                                                                              |                                                                                                                                                                     |
| Profiler     | `enable`, `disable`, `setSamplingInterval`, `start`, `stop`                                                                                                                                                                                                                                                                                                                                       | precise and best-effort coverage                                                                                                                                    |
| HeapProfiler | (Tint) `enable`, `disable`, `takeHeapSnapshot`, `collectGarbage`, `startSampling`, `getSamplingProfile`, `stopSampling`, `addInspectedHeapObject`                                                                                                                                                                                                                                                 | `startTrackingHeapObjects`, `stopTrackingHeapObjects`, `getObjectByHeapObjectId`, `getHeapObjectId`                                                                 |
| Schema       | `getDomains`                                                                                                                                                                                                                                                                                                                                                                                      |                                                                                                                                                                     |

Events:

- `Debugger`: `scriptParsed`, `paused` (reason `other`, or `exception` for
  a fault, with `hitBreakpoints`), `resumed`, `breakpointResolved`.
- `Runtime`: `executionContextCreated`, `executionContextDestroyed` (at
  exit), `consoleAPICalled` (one message per output line; the process's
  exit status as `info`).
- `HeapProfiler`: `addHeapSnapshotChunk`, `reportHeapSnapshotProgress`.

`/json/protocol` lists the methods the running bridge implements.

## Limitations

- **One thread**: pauses, frames and CPU profiles show one thread (the
  stopped thread, or the main thread for CPU profiles). The process
  stops as a whole.
- **No expression evaluation**: hovers and watches resolve plain variable
  paths only.
- **Merged output**: `lldb-dap` runs the program on a pseudo-terminal, so
  stdout and stderr arrive merged as `log` messages.
- **Pauses after heap operations**: a heap operation run while the program
  is paused needs a safepoint, so the pause moves to the next allocation.
- **One CPU profile at a time.** Sampling heap profiles and heap
  operations can be combined: an operation re-arms sampling afterwards.

## Phase 2 design hooks

These are not built yet.

- **`Runtime.evaluate` / `Debugger.evaluateOnCallFrame`**: call the
  embedded compiler in the paused process at a safepoint.
  - The hook: a plugin `evaluate` method beside `formatVariable`.
  - It would reach the safepoint through `BridgeContext.internal` and the
    same thunk-entry stop that `collectGarbage` uses, then make a call
    with a pushed frame record as `collect-begin` does.
  - Today both methods return an error that names phase 2.
- **Structured `console.*`**: a persistent function breakpoint (see
  `setPersistentFunctionBreakpoints`) on the runtime's console
  implementation. A stop handler would read the arguments with the value
  formatters, emit `Runtime.consoleAPICalled` with RemoteObjects and stack
  traces, and continue, as allocation sampling does.
- **Async stack traces** (opt-in): persistent breakpoints on promise-job
  enqueue and run, recording the enqueuing stack per job and attaching it
  as `asyncStackTrace` to the pauses inside that job.

## Verification

`pnpm check` runs these tests. They script the CDP calls DevTools makes,
over a raw WebSocket (`tools/devtools/test-client.ts`).

- **`tools/devtools-c.test.ts`** (a clang `-g` C program):
  - discovery, Host checks and scripts;
  - a breakpoint by url in an `always_inline` callee, with three frames
    (`weight`, `spin`, `main`);
  - locals and structure fields, hover paths;
  - step over and step out, pause while running;
  - console output, CDP errors, and the exit status.
- **`tools/devtools-tint.test.ts`** (a Tint debug build, core only):
  - `weight` inlined into `scale`, inlined into `run`, as separate frames;
  - locals, stepping, pause while running, exit 42.
- **`tools/devtools-tint-plugin.test.ts`**:
  - every value kind above;
  - a streamed snapshot with exactly the 5000 retained chain nodes;
  - more than 90% of sampled bytes in `makeChain`, with source links;
  - `collectGarbage` while paused and while running, then exit 42.
- **`tools/devtools-profiler.test.ts`**:
  - pprofessor and backend CPU profiles of C, with `spin`'s line and the
    inlined `weight` as a child;
  - a Tint CPU profile with `makeChain` linked to its script.
- **`tools/profiling-core.test.ts`**: the core's writers and pprof round
  trips.
- **Memlab** (`@memlab/core` 1.1.43, `utils.getSnapshotFromFile` plus its
  `TraceFinder` retained sizes) read a snapshot taken through the bridge
  from the fixture paused in `inspect`:
  - 5027 nodes, 5034 edges and 120,872 bytes, the same totals as the
    bridge's;
  - the chain head retaining 120,000 bytes;
  - a retainer path frame › `(Stack roots)` › `(GC roots)`.
