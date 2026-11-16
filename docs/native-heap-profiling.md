# Native heap profiling

Native Tint programs are heap-profiled with standard external tools: LLDB,
Chrome DevTools' Memory panel, Memlab, `go tool pprof`, pprofessor and
Instruments. Images contain no profiler. They carry only metadata and inert
hooks that external tools read or attach to:

- **`__tint_heap_descriptor`**: an exported, versioned data symbol that
  locates the managed heap, the allocation and collector state, the
  object-start bitmap and the stack-map registry, and describes the object
  header and every built-in object kind.
- **DWARF types for every object kind**: one global variable per record
  descriptor, whose type is the structure of the objects it describes, and a
  named structure for each built-in kind.
- **`__tint_allocation_sample`**: an exported no-op function. It is called
  only while a tool has armed allocation sampling.
- **GC signposts**: `os_signpost` intervals for collector phases. Each
  collection's interval ends with that collection's metrics.

The descriptor, the DWARF variables and the sampling hook are part of
**heap introspection**. Debug builds include it by default: `--debug-symbols`,
`TINT_DEBUG_SYMBOLS=1` or `BuildRequest.debugSymbols`. `heapIntrospection`
(`TINT_HEAP_INTROSPECTION=0/1` for hosted fixtures, `--no-heap-introspection`
for `tools/bootstrap-compiler.ts`) overrides that default. Default builds
contain none of it and are byte-identical to builds made before it existed.
Signposts stay a separate opt-in (`signposts`, see
[runtime diagnostics](runtime-diagnostics.md)).

## Workflows

All commands run from the repository root. `<image>` is a debug build, for
example `TINT_KEEP_NATIVE=1 node tools/verify-heap-tools.ts` (the image path
is printed) or a frozen-workload compiler `.tint-bootstrap/workload-v3/native-<label>`.

### Inspect objects in LLDB

```text
(lldb) command script import tools/lldb/tint.py
(lldb) frame variable *holder
({items, names, numbers, index, tags, anything}) *holder = {
  items = 0x0000000106cfc090 {length, root}
  index = 0x0000000106cfc160 {keys, buckets, head, tail, size, order}
  anything = "dynamic"
  ...
}
(lldb) frame variable -P 2 holder->index
(object *) holder->index = 0x0000000106cd8160 {keys, buckets, head, tail, size, order} {
  ["first"] = 0x0000000106cd8420 {x, y, label} { x = 0  y = 0  label = 0x0000000106cd84f0 "p0" }
  ["second"] = ...
}
```

Add the import line to `~/.lldbinit` to load the formatters in every
session. They cover:

- **Strings** (`string`, `string *`): the text.
- **Opaque references** (`object *`): retyped from the object's header to
  its record structure or built-in kind, so nested fields expand.
- **Lists** (`{length, root}`): their elements.
- **Number lists** (`{length, values, present}`): their present numbers.
- **Insertion-ordered maps and sets** (`{head, tail, size, ...}`): entries
  named by their keys.
- **Reference vectors**: their slots.
- **General values** (`general`): the value, by tag.

`tint-heap info` prints the descriptor and the current heap state, and
`tint-heap verify` walks every object.

### Take a heap snapshot and open it in DevTools or Memlab

```sh
node tools/heap-snapshot/cli.ts capture <image> --out /tmp/heap --after-majors -- <args>
node tools/heap-snapshot/cli.ts convert /tmp/heap/after-054 \
  --heapsnapshot /tmp/after-054.heapsnapshot --pprof /tmp/after-054.pb.gz \
  --report /tmp/after-054.json
```

`capture` launches the program under LLDB and dumps the heap at the
requested points. Each dump is a directory holding the active old and young
spaces, the start bits, the stack, the registry and `meta.json`:

| Option             | When the heap is dumped                                                                                                                                                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--after N,...`    | After collection N (1-based), at the first allocation once the collection returns. This is a precise safepoint: only objects that survived are present.                                                                                                                   |
| `--after-majors`   | After every major collection.                                                                                                                                                                                                                                             |
| `--peak` (default) | One dump after the major collection that leaves the largest old space.                                                                                                                                                                                                    |
| `--before N,...`   | Inside the slow path, before collection N. Live and dead objects are both present; the snapshot keeps the reachable ones unless `--include-unreachable` is given.                                                                                                         |
| `--before-majors`  | Before every collection that cannot be minor.                                                                                                                                                                                                                             |
| `--pid <pid>`      | Attach and dump at the next allocation.                                                                                                                                                                                                                                   |
| `--core <file>`    | Dump from a core file saved inside an allocation slow path, for example after `tint-heap arm 1` and a stop at `__tint_allocation_sample`, then `process save-core <file>`. A default macOS core omits image pages, which the converter reads from the executable instead. |

Every capture also writes `collections.json`, a log of every collection:
nursery bytes, old-space bytes before and after, and whether it was major.

`convert` needs only the dump and the executable. It builds the object
graph:

- Objects come from the start bits, decoded through the descriptor's kind
  table or the object's record descriptor.
- Edges come from record descriptors, vector slots, view owners and weak
  slots, named by the DWARF field names.
- Roots come from a precise stack walk using the image's safepoint maps,
  with the runtime's own `walkNativeStack`.

`convert` computes reachability, the dominator tree and retained sizes, then
writes:

- **`.heapsnapshot`**: the V8 format.
  - Load it in Chrome DevTools: Memory, then _Load profile_. Summary
    (constructors are record structure names), Containment, Retainers,
    Dominators and Comparison all work.
  - Memlab reads it too (`memlab analyze`, or `@memlab/core`'s
    `getSnapshotFromFile`).
  - Roots appear as `(GC roots)` › `(Stack roots)` › one synthetic node per
    frame, named by function and line. Edges from a frame are named by the
    frame word (`sp+<offset>`) or `register`.
  - Strings are named by their text. Literal strings live in the image, not
    the heap, and are not nodes.
  - Node IDs derive from addresses. A moving collection gives a surviving
    object a new ID, so in Comparison view a moved object appears as
    deleted and re-added.
- **pprof `inuse_objects`/`inuse_space`**: each object's stack is its type,
  then the types of its dominator chain (repeats merged), up to the frame
  that retains it. A flame graph therefore answers _who retains this
  memory_.
  - `go tool pprof -http=:0 /tmp/after-054.pb.gz`
  - `pprofessor analyze /tmp/after-054.pb.gz`
- **`--report`**: JSON with totals (including header bytes), each type's
  count, self bytes and retained bytes (DevTools' constructor retained
  size), the largest dominators with their dominator paths, and each
  frame's retained bytes.

### Profile allocations with pprof

```sh
node tools/heap-snapshot/cli.ts allocations <image> --interval 1048576 --out /tmp/alloc.pb.gz -- <args>
go tool pprof -http=:0 -sample_index=alloc_space /tmp/alloc.pb.gz
go tool pprof -tagfocus='type={value, next}' -top /tmp/alloc.pb.gz
```

How the sampler works:

- The tool arms sampling with a mean interval in bytes. Intervals are drawn
  from an exponential distribution unless `--fixed` is given.
- At each stop in `__tint_allocation_sample`, it records the allocating
  stack, symbolized by LLDB from DWARF, inlined frames included.
- At the next stop, it records the object's type, read from the object's
  now-initialized header.

Each sample from the nursery stands for 1 / (1 − e^(−size/interval))
objects. Allocations placed directly in the old space always take the slow
path, so each counts once. Samples carry `type` and `space` labels. The
profile has the image mapping (path, load address, UUID), so pprofessor can
symbolize addresses too. Expect about 3–5 ms per sample under LLDB: frozen
v3 allocates 74.5 GiB, so a 1 MiB interval takes about 76,000 samples.

### See collections in Instruments

Build with `signposts` (`--signposts`, or `TINT_SIGNPOSTS=1`) and record
with the Logging template or the os_signpost instrument:

- **Interval names**: the collector intervals listed in
  [runtime diagnostics](runtime-diagnostics.md#signposts).
- **`gc.collect` end message**:
  `major=<0|1> nursery=<bytes> copied=<bytes> old=<bytes>`.
  - `nursery`: the bytes the collection evacuated.
  - `copied`: bytes promoted by a minor collection, or bytes surviving a
    major one.
  - `old`: old-space bytes afterwards.
  - The interval's duration is the pause.

`node tools/verify-hosted-signposts.ts <dir>` records a GC-heavy fixture and
checks that every collection reports its metrics.

## The heap descriptor

The layout is defined in [`packages/abi/src/heap-debug.ts`](../packages/abi/src/heap-debug.ts)
(version 2). It is `__DATA` storage, so tools read it from a live process
or from a core.

| Field                  | Contents                                                                                                                                                                                                                                                                                                                               |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| magic, version, length | `TINTHEAP`, 2, byte length. Tools reject versions they do not know.                                                                                                                                                                                                                                                                    |
| context                | The main hosted context. Startup publishes it after the runtime initializes and clears it at teardown; 0 means no managed heap.                                                                                                                                                                                                        |
| sampling words         | Interval, saved young limit and sample count. Tools write the interval and limit; the thunk writes the count.                                                                                                                                                                                                                          |
| header layout          | Header and granule bytes (8 and 8), the header word's offset and the bit where its three kind-flag bits start (48; the marker is the header modulo 2^48), the largest built-in marker, the record descriptor format (extent, reference list, index word before it), the general-value size and reference tags, the reference encoding. |
| collector              | 2: generational. A young nursery and a packed old prefix in the active semispace.                                                                                                                                                                                                                                                      |
| context offsets        | The stack-map registry, the managed base and length, and the allocation state block.                                                                                                                                                                                                                                                   |
| state word indices     | Young top, limit and base; old top; young start bits; old capacity; dirty bits; remembered-queue count.                                                                                                                                                                                                                                |
| kind table             | Marker, flags, fixed bytes, count offset, element bytes, edge rule, reference offset, DWARF name and minimum element count for each built-in kind: strings (heap and image literals share one kind; at least four units), the four typed buffers (owning, external, view), reference vectors, weak and ephemeron slots.                |

Live state is not copied into the descriptor. It lives in words the runtime
already maintains with plain stores at allocation and collection, which the
descriptor locates. Keeping the descriptor current therefore costs nothing.
That state is consistent at every safepoint, including the sample hook,
and inconsistent only inside a collection.

The active old space starts at young base − old capacity. One start bit
covers each granule from there; parallel evacuation leaves unformatted gaps,
so walks use the bits rather than scanning linearly. An object's extent is
align(fixed + max(count, minimum) × element, granule) for a built-in kind, or the record
descriptor's first word.

A later layout change (mark-region old space, compressed references) changes the version and the fields above. Tools then learn the
new structure from the descriptor rather than from code.

## DWARF

Debug builds with heap introspection describe every heap object kind:

- **Records**:
  - Each record descriptor of the runtime and program modules has a global
    variable named `__tint_record.<module>.<index>`, located at the
    descriptor (`DW_OP_addr`). Its type is the structure of the objects it
    describes: header words, fields at their realized offsets, and
    presence and cell-state bytes (`<field>.present`, `<field>.state`).
  - Records with source names keep them: class names, `{field, ...}` for
    object types.
  - Records without source names are named by role: `env:<function>` for
    closure environments, `cell<type>` for cells, otherwise
    `record#<index>{types}`.
  - `__tint_record.<module>.function` is the function record (`entry`,
    `environment`, `signature`).
- **Built-in kinds**: `string` (`length`, `units[]`), `vector`
  (`capacity`, `slots[]`), `Uint8Array`/`Uint16Array`/`Uint32Array`/`Float64Array`
  (`length`, `data`, `elements[]`), their `.external` (borrowed storage) and
  `.view` (`owner`) forms, and `weak-slot`/`ephemeron-slot` (`key` and
  `value` general values). These are the names the descriptor's kind table
  refers to.

Given the header word, a tool decodes any object:

- A built-in marker selects the kind table entry and its structure.
- Any other marker is a descriptor address, whose variable gives the
  structure.

`tools/lldb/tint.py`'s `record_types` builds that map from the variables'
DWARF locations, and does not read memory, so it works on cores.

## The allocation sampling hook

The hook costs nothing unless a tool arms it:

- **Unarmed**: generated code and the inline allocation sequence are
  unchanged.
  - Heap introspection points the context's allocation slow-path entry at
    `__tint_allocation_sample_thunk`, which only forwards the call.
  - The slow path runs only when the nursery fills (every 256 MiB on v3),
    for large objects, and for allocations without an inline path.
- **Armed**: the tool writes the interval into the descriptor and lowers the
  state block's young limit to min(capacity, top + interval).
  - The next allocation that crosses the limit takes the slow path.
  - After the real allocator returns, the thunk calls
    `__tint_allocation_sample(address, size, context)`, then rearms the
    limit from the current interval (or restores it once disarmed).
  - Startup applies an interval written before the program started.
- **Tracers**: tools can breakpoint, DTrace-probe or uprobe the hook. The
  thunk's frame is transparent to stack maps and returns into the
  allocating frame at its allocation safepoint, so roots can be walked
  precisely from any stop under the thunk. Captures use this.

Frozen v3, debug build with heap introspection (`obs-desc`) against `mem2`
(the same base without it), 6 alternating rounds under the timing lock. Output
was byte-identical to `out-sdisp`.

| Build      | Cycles min / median | Wall min / median | Peak RSS |
| ---------- | ------------------- | ----------------- | -------- |
| `mem2`     | 214.1 / 215.7 G     | 46.51 / 47.5 s    | 2.925 GB |
| `obs-desc` | 212.8 / 214.7 G     | 46.79 / 47.2 s    | 2.925 GB |

## Linux USDT plan

There is no Linux image writer or host ABI yet (`packages/platform` and
`packages/image` target Darwin only). These parts already carry over:

- The descriptor, the DWARF and the sampling hook. `uprobe:<image>:__tint_allocation_sample`
  replaces the LLDB breakpoint, with `arg0`–`arg2` as address, size and
  context.
- `tint.py`'s logic, which ports to GDB's Python API (`gdb.Inferior.read_memory`,
  `gdb.lookup_global_symbol`).

The Linux target should add Statically Defined Tracing probes in place of
`os_signpost`:

- **Probe sites**: a `nop` at each site, inside the diagnostics routines:
  - `tint:gc__begin` and `tint:gc__end` in the collection thunk. `gc__end`
    takes `8@x9 8@x10 8@x11 8@x12`: major, nursery, copied and old bytes,
    in registers the thunk loads for the probe.
  - `tint:alloc__slow` around the slow-path entry.
  - `tint:alloc__sample` in the sample hook (`8@x0 8@x1 8@x2`).
- **Notes**: one `.note.stapsdt` ELF note per probe: owner `stapsdt`,
  type 3. The descriptor holds the probe address, the `.stapsdt.base`
  address, the semaphore address, then NUL-terminated provider, name and
  argument strings. The image also emits a `.stapsdt.base` section so
  tracers can relocate PIE addresses.
- **Semaphores**: a 16-bit counter per probe in `.probes`, which tracers
  increment while attached. The thunk then gathers metrics only when the
  probe is enabled, as the Darwin routine checks `os_signpost_enabled`.
- **Remaining work**: the ELF writer (sections, notes, symbol table,
  `.debug_*` from the shared DWARF encoder), a Linux `PosixHostABI` without
  the signpost facility, and the note emission in `startup.ts`. With these,
  `bpftrace -e 'usdt:<image>:tint:gc__end { @copied = hist(arg2); }'` and
  `perf record -e sdt_tint:gc__end` work unchanged.

## Verification

- **`tools/verify-heap-tools.ts`** builds one fixture
  (`tools/heap-tools-fixture.ts`) and checks it under LLDB:
  - **Descriptor**: matches the collector's own locals at two collections;
    the start-bit walks cover exactly the young and old tops.
  - **Formatters**: their output is checked.
  - **Snapshot**: a dump at the fixture's `inspect` safepoint has exactly
    5000 chain nodes retaining 160,000 bytes from `run`'s and `inspect`'s
    frames, and a structurally valid `.heapsnapshot` and pprof profile.
  - **Core**: a dump from `process save-core` equals the live one.
  - **Allocations**: the sampled profile attributes more than 98% of
    samples to `makeChain` and estimates the allocation volume within 10%.
  - **Unarmed**: the image runs normally.
- **Memlab** (`@memlab/core` 1.1, `getSnapshotFromFile`, then its
  dominator pass) loaded the fixture snapshot. Its node, edge and byte
  totals and its retained sizes matched the tool's, and its shortest
  retainer path ran from the frame through `(Stack roots)` to `(GC roots)`.
- **pprof readers**: `go tool pprof` and `pprofessor analyze` read both
  profile kinds.
- **At scale**: on frozen v3 ([findings](results/native-heap-findings-v3-obs.md)),
  every object found through the start bits after each major collection was
  reachable from the precise root walk. Memlab parsed the 615 MB peak
  snapshot (12.3 M nodes) with identical totals. The sampled allocation
  volume (73.4 GiB) matched the census.
- **Pending allocation**: a dump stopped at the sample hook skips the
  reported allocation, which is not yet initialized; the dump records its
  address and size.
- **Unit tests**: `packages/codegen/test/runtime-diagnostics.test.ts`
  covers the descriptor bytes, symbols, thunk and metrics routine;
  `packages/image/test/dwarf-variables.test.ts` covers the DWARF globals.
