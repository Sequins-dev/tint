# Compiler memory

## Direction

A whole-program build must not hold everything until the image is written.
Peak memory should be the global summaries whole-program analysis needs plus
a per-function working set, as independent of program size as possible.

- Per-function data (IR bodies, emitter output) lives in a **function store**:
  resident while a phase works on it, otherwise packed in a compact binary
  encoding, in memory or spilled to disk. Phases stream through it.
- Global facts (headers, record layouts, call-graph and closed-world
  summaries, the symbol/fixup index) stay resident in typed arrays.
- Spilling never changes output. Images and self-build stages are
  byte-identical with spilling off, forced for everything, or budget-driven.
- The store and the format are portable compiler code (native subset). The
  Node host and the native compiler supply the disk backend.

## Measured lifetimes (main 82441e410)

Node-hosted Test262 suite images (`TINT_TEST262_LINKING=suite`, `TZ=UTC`),
probed after a forced GC at each stage boundary (live heap, MB):

| Stage boundary                         | 1 file (2 variants) | expressions/object (2,252) |
| -------------------------------------- | ------------------: | -------------------------: |
| Host has prepared the modules          |                 171 |                      2,989 |
| Program linked / specialized / checked |                   — |      3,297 / 3,597 / 3,894 |
| Program lowered (IR built)             |                 951 |                      5,381 |
| Pruned / optimized                     |           887 / 854 |              4,526 / 4,448 |
| Emitted (IR still held)                |                 873 |                      4,505 |
| Compile returned (IR released)         |                 185 |                      3,032 |
| Image written (array buffers)          |                 401 |                      1,333 |
| Process max RSS (GB)                   |                 5.3 |                       13.4 |
| Functions lowered → after pruning      |     24,819 → 19,718 |  38,675 → 38,675 (gave up) |

Heap snapshots (built-ins/Map) attribute the terms:

- **Input ASTs, 1.25–1.9 MB per variant, held for the whole build.** Before
  compilation 95% of the heap is syntax nodes of the host-prepared
  `SourceModule`s (lowered Test262 Scripts and their hosts). The host and the
  compile request keep them until the build returns: the runtime and program
  front ends, the general fallback and remark/debug lookups read
  `request.modules`. Object: 2.8 of the 4.5 GB live during optimization.
- **IR, 0.34 MB per variant, 31 KB per function.** About 60 bytes per
  instruction object, 54 per block, plus arrays: 6.1 M instructions are
  830 MB. A packed encoding is 6–10 bytes per instruction.
- **Front end and lowering transients.** Linking, specialization and checking
  add ~0.9 GB for object; lowering holds checker results and the whole new IR
  together (5.4 GB live, 9.1 GB RSS). This is the live peak today.
- **Link copies.** The program's code is copied by service linking, hosted
  composition, the trace-table extension and the image writer: four buffers
  of the image size (1.3 GB for object, ~5 GB for built-ins/Array).
- **Closed-module pruning gives up** above about 10 M work units
  (`pruneClosedModule`'s default budget): Map and object prune nothing while
  the 1-file image drops 21% of its functions. The give-up is invisible in pass
  statistics. Fixing it changes large images (fewer functions), so it is a
  separate, intentional change, not part of these slices.

The native self-compile (frozen v6) peaks at 2.25 GB RSS natively and
3.75 GB under Node; its IR and input ASTs are the same two linear terms.

### Single-copy link measurements

Node 24.12.0, macOS arm64, main `e83a2a68d` and the single-copy link
implementation `6dc0bd339` compiled the same captured 768-file source graph
with `TZ=UTC`, monolithic native services, modules enabled and suite linking.
The object selection passed all 2,252 variants on both builds and produced
the same 173,624,927-byte executable (SHA-256
`5ac04d05c15a7669ea65b3a6de11e66fa26f7e6217d2d9fb594c502d830e1f1f`).
The Map selection passed all 405 variants on both builds and produced a
matching image (SHA-256
`8db59afca387c77c5353c5d3de26d97d1a36f1a99586f63adc5868fb07511431`).

| Object suite boundary | Main heap (MiB) | Single-copy heap (MiB) | Main ArrayBuffers (MiB) | Single-copy ArrayBuffers (MiB) |
| --------------------- | --------------: | ---------------------: | ----------------------: | -----------------------------: |
| Before link           |             266 |                    266 |                     241 |                            241 |
| After hosted startup  |             262 |                    265 |                     404 |                            241 |
| Before image writer   |             264 |                    264 |                     404 |                            241 |
| After image writer    |             264 |                    264 |                     570 |                            418 |

V8 heap and ArrayBuffers were sampled after forced GC. Whole-process peak RSS
fell from 9,095 MiB to 8,692 MiB under `/usr/bin/time -l`. Each run used
an independently frozen Node toolchain. Pruning budget exhaustion was
outside the probe's scope.

On the frozen main compiler source, Node-hosted self-compile peak RSS was
3,899 MiB on main and 3,898 MiB with single-copy link. Both produced the same
compiler (SHA-256
`fc57933b7946a3932b1a0017545daf1285e6c3e4097d5ca589307acfed3dd986`).

Native stage-2 compilers built the same frozen main source under LLDB in
three interleaved rounds under `tint-timing.lock`. Wall time and hardware
counters were sampled from inferior entry to libc exit. All six output
images matched the compiler hash above.

| Round | Main wall (s) | Single-copy wall (s) | Main cycles (billions) | Single-copy cycles (billions) |
| ----: | ------------: | -------------------: | ---------------------: | ----------------------------: |
|     1 |       167.290 |              156.525 |                609.287 |                       592.056 |
|     2 |       122.539 |              122.972 |                558.824 |                       564.188 |
|     3 |       117.178 |              117.936 |                546.001 |                       551.242 |

Median wall time rose by 0.35% and median cycles rose by 0.96%. The first
round overlapped with other validation work and recorded a faster branch
run. The latter two pairs recorded a small increase on the branch.

A second measurement ran five interleaved rounds of the same pair of stage-2
compilers on an otherwise idle host. All ten outputs were identical.

| Round | Main wall (s) | Single-copy wall (s) | Main cycles (billions) | Single-copy cycles (billions) |
| ----: | ------------: | -------------------: | ---------------------: | ----------------------------: |
|     1 |        114.93 |               117.86 |                541.002 |                       550.288 |
|     2 |        113.76 |               124.34 |                540.524 |                       574.540 |
|     3 |        122.78 |               125.55 |                566.046 |                       571.499 |
|     4 |        125.67 |               120.34 |                572.068 |                       556.115 |
|     5 |        116.19 |               119.55 |                547.920 |                       556.941 |

Median cycles rose by 1.5% (547.9 to 556.1 billion) and median wall time
by 3.6%. Round 4 recorded a faster branch run. The change was accepted
for its memory saving: build memory caps what can be built at all, while
build time only lengthens the build. Generated code is byte-identical,
so runtime is unaffected.

### Link

On the 2,252-variant `language/expressions/object` suite, the compiler
omits the unused origin table and releases its input modules after linking.
Managed surface layout gets only the reachable runtime modules.

| Live heap after forced GC (MiB) | Main `eb1d822db` | Link memory `34a064ec7` |
| ------------------------------- | ---------------: | ----------------------: |
| Input modules before linking    |              785 |                       — |
| Application rewritten           |            1,284 |                   1,105 |
| Second surface layout bound     |            2,076 |                   1,621 |
| Link returned                   |              560 |                     560 |

At a 3,072 MiB old-space cap, main runs out of heap during linking.
The link-memory build reaches the check stage, where the second instance
preparation reaches 2,571 MiB live in the uncapped run.
See the [probe records](results/compiler-link-memory-2026-11-19.md).

### Check

The object suite retries collection preparation after its first instantiated
graph exposes more collection requirements. The original checked graph and
its specialized syntax can be released when that retry starts. The check now
hands off a replaceable observation from a short-lived frame.

The second instance preparation drops from 2,571 to 1,967 MiB of live heap
on matched source input. The check stage still returns about 1,100 MiB.
See the [check-stage probes and snapshot](results/compiler-check-memory-2026-11-19.md).

### Managed surface layouts

A build with multiple managed surfaces links the runtime closure once and
links each surface's layout declarations independently. Each surface still
checks and lowers its own combined program. On the same frozen object-suite
input, one runtime closure link replaces two, layouts peak at 1,623 MiB
live instead of 1,625 MiB, and the 2,252-variant image is unchanged.
See the [layout and heap-cap probes](results/compiler-surface-layout-memory-2026-11-19.md).

### Lowering

Lowering retains only the used elements of finalized instruction arrays and
releases each function's record expression plans after emitting its body.
On the matched object-suite input, live heap before IR verification fell
from 2,972 to 2,658 MiB. The byte-identical suite image builds at a 2,944 MiB
old-space cap and the 2,912 MiB run exhausts heap late in lowering.
See the [lowering probes and heap-cap results](results/compiler-lowering-memory-2026-11-19.md).

## What is global and what is per function

| Data                                                                                         | Scope                    | Needed by                                          |
| -------------------------------------------------------------------------------------------- | ------------------------ | -------------------------------------------------- |
| Function headers: id, name, flags, parameters, slot types, return type, environment          | global                   | every phase (call signatures, ABI, identities)     |
| Record layouts, signature groups, dispatch sets, string-literal keys                         | global                   | optimizer, emitter, link                           |
| Effect summaries, word returns/arguments, record flows, no-safepoint and direct-return facts | global (typed arrays)    | optimizer passes, emitter                          |
| Call graph / closed-world roots, pruning maps                                                | global (typed arrays)    | pruning, devirtualization, inlining                |
| Symbol table, fixup and relocation index, function offsets                                   | global (compact records) | final patching, link, image                        |
| Blocks, instructions, terminators, debug bindings                                            | per function             | the pass or emission working on that function      |
| Inline candidates (small leaf bodies)                                                        | per callee, bounded      | inlining of their callers                          |
| Emitted words, safepoints, source/operation ranges, debug trackers                           | per function             | final patching and link only                       |
| Input syntax (`SourceModule.module`)                                                         | per module               | front ends (allocator, runtime, program, fallback) |

## Function store (`@tint/ir/storage`)

A function's body has one of three states; its header is always resident.

| State    | Memory                   | Access               |
| -------- | ------------------------ | -------------------- |
| resident | the `FunctionIR` object  | free                 |
| packed   | encoded bytes in a chunk | decode               |
| spilled  | bytes in a disk segment  | read segment, decode |

- `put(fn)` packs (encodes) the body; `get(id)` returns a resident body,
  decoding (and reading its segment) when needed; `release(id)` drops the
  resident object. Writers replace a body with `put`; there is no in-place
  mutation, so a packed copy is always current.
- **Budget and eviction.** `residentBytes` bounds decoded bodies (estimated
  from instruction, block and slot counts); beyond it the least recently used
  resident body is released. `packedBytes` bounds packed chunks in memory;
  beyond it whole chunks are flushed to the spill backend in id order. Phases
  pin what they work on (`get` … `release`). Policies: `memory` (never spill),
  `budget` (default for large builds), `all` (spill every packed body: the
  identity test and fault-finding mode).
- **Phase needs drive eviction.** Streaming phases visit ids in order, so the
  store prefetches a chunk and releases behind the cursor. Random access
  (inline candidates, an emission retry) is bounded: candidates are small and
  are cached resident by size class.
- **Identity.** A reloaded body is a new object. Change tracking is explicit
  (the store records which ids a pass `put`), never `!==` on objects.

### Spill backend

```ts
interface SpillBackend {
  write(bytes: Uint8Array): number; // segment handle
  read(segment: number): Uint8Array; // whole segment
  release(segment: number): void;
  close(): void;
}
```

Segments are written once and read whole, so the file host's
create/open/read/write/close/remove suffice (no `pread`/`lseek` on the host
surface). `createFileSpillBackend` (`@tint/compiler/spill-files`) keeps one
temporary file per segment beside a prefix (the output path) through a
`FileHost`, so the native compiler and Node hosts share it. An in-memory
backend serves tests and hosts without files.

### Binary format, version 1

Deterministic: the same IR always encodes to the same bytes.

- **Chunk:** magic `TIRS`, format version (u8), function count, string table
  (UTF-16 code-unit counts and units, first-use order), then function records.
- **Function record:** id, flags (import, exported, optional-field presence),
  name (string index), parameters, slot types (one byte each), integer slots,
  return type, entry, receiver/closure-environment slots, environment cells,
  blocks, debug section.
- **Block:** id, instruction count, instructions, terminator, optional
  exception edge.
- **Instruction:** opcode byte (one per instruction kind, in a fixed versioned
  table), a presence byte when the kind has optional fields, then fields in a
  fixed order. Unsigned integers are LEB128; possibly negative or fractional
  numbers (constants) carry a tag byte (small integer, double as 8 bytes);
  strings are string-table indexes; operand lists are a count plus values.
  Spans are `start` and `end - start`.
- **Foreign descriptors** (`ForeignCall`, `ForeignMemoryAccess` of c-call and
  c-memory) are interned in a resident side table and encoded by index. They
  are few and small, and the FFI vocabulary evolves independently; the spill
  file is private to one build process, so it never needs them serialized.
- **Spans** are deltas from the previous span start in the record.
- **Round trip.** `decode(encode(fn))` equals `fn` structurally, including
  which optional fields are present. The codec test lists every instruction
  and terminator kind in a mapped type, so a new kind fails to type-check
  until the test (and its round trip) covers it.
- **Measured** on the compiler's own IR (Node, 1.6 M instructions, no
  mismatches lowered or optimized, with and without debug metadata):
  13.1 B per instruction lowered and 16.1 B optimized (blocks, spans and
  slots included; 26 MB for the optimized compiler), encoding about
  0.4 µs and decoding about 0.55 µs per instruction.

## Streaming emission (codegen)

1. **Summaries first.** The emitter's whole-module analyses (word returns
   fixpoint, word arguments, record flows, no-safepoints, direct returns, the
   signature table, list shapes, module-wide feature scans) sweep bodies from
   the store one at a time into typed-array summaries. `compactSlots` runs as
   a store pass before them (it renumbers slots the analyses index).
2. **Emit in order.** Each function is fetched, emitted (with its own
   island/long-branch retries), and released. Nothing later reads its body:
   callers read headers and summaries.
3. **Output index.** Emitted words stay in the paged word buffer; pages behind
   the last open fixup range can spill. Fixups, safepoints and ranges are
   kept as compact records. Final patching walks fixups by page.
4. **Retries.** A whole-module retry (compact calls out of reach) re-streams
   bodies from the store: spilled bodies make it re-readable, so no copy of
   the module is kept for it.
5. **Link.** Hosted startup, services, diagnostics and the trace table
   describe their code extents before either executable writer allocates
   the output. The writers reserve those extents in the file layout, then
   place each emitted module and read-only payload directly in the final
   image. Startup and platform relocations patch the placed code before
   hashing and signing. Large Mach-O placement maps the logical code
   range to its signed file chunks and uses a small scratch window for
   patches that cross a chunk boundary.

The link keeps the module emission buffers and the final executable buffer.
It removes the combined service code, hosted code, trace extension and
unsigned Mach-O buffers. Incremental SHA-256 hashes the image prefix and
identity data in order, so UUID and build-ID generation also avoid a copy.
The executable result still exposes one contiguous byte array, including
for large images. A file-backed final result remains a separate change.

`BuildRequest.storage` selects the packing policy for typed program emission.
`memory` emits from decoded bodies without packing. `budget` takes a
`byteBudget` for packed storage, spilling sealed chunks when a file host and
directory are supplied; without them packed chunks stay in memory. The active chunk and a decoded function are additional
working memory. `all` requires a file host and directory and reads every body
back from disk. The compiler removes the spill files when emission ends.

### Automatic packing

A request without `storage` emits from decoded bodies while the optimized IR
has at most `automaticPackingSize` (5 M) instructions plus blocks, and above
that packs every body into an in-memory `budget` store with
`automaticResidentBytes` (256 MiB) of decoded bodies. Decoded bodies take
about ten times their packed size (about 17 bytes per instruction), and a
large emission's transient working set otherwise exceeds the heap.

The compiler's own optimized IR has 2.12 M instructions in 0.90 M blocks
and stays decoded, so the self-compile is unchanged. The
`language/expressions/object` suite image has 6.14 M instructions in
2.31 M blocks. Under a 4 GiB Node heap the decoded default ran out of
memory during emission. A 256 MiB budget spilling to disk completed in
460 s with 5.6 GB peak RSS, and all 2,252 variants passed.

The Node bootstrap and native Test262 runner accept `TINT_STORAGE=memory`,
`budget`, or `all`. Set `TINT_STORAGE_BYTE_BUDGET` for `budget` and optionally
set `TINT_STORAGE_DIRECTORY` to an existing directory. The Node tools default
to the system temporary directory.

## IR between optimizer phases

- Function-local passes (`rewriteFunctions`) stream: get, rewrite, put,
  release. Consecutive local passes over the same function may run back to
  back (function-major) only where no whole-module pass or summary sits
  between them; reordering that changes any summary input is not allowed.
- Whole-module passes (effects, devirtualization, inlining, loop-cell
  promotion, bulk list copies, proven record reads, list vectors) become
  summarize-then-rewrite: a streaming sweep builds the facts they read from
  other functions, then a streaming rewrite applies them. Until a pass is
  converted it loads the bodies it needs through the store, so peaks shrink
  pass by pass while output stays identical.
- Lowering puts functions into the store as it produces them.

## Input syntax

The compiler takes ownership of request modules: after the last front end
that needs them, it keeps only module ids, dependency maps and position
providers. A typed failure that needs the general fallback re-obtains syntax
through a host callback (`reloadModule(id)`) instead of keeping every AST. The
Test262 host keeps source text and its preparation recipe rather than prepared
ASTs, and prepares them when the suite program is built.

## Interaction with the native compiler and Node

- Store, codec and emitter changes are compiler sources and stay in the native
  subset (Uint8Array/Uint32Array only, no tuples, explicit annotations); the
  self-build exercises them. The native compiler benefits directly: its IR
  phases shrink the same way and its GC no longer traces the packed bodies.
- Node keeps dead locals of cold (unoptimized) stage functions alive until
  they return; stage code passes the store, never arrays of bodies, between
  phases.
- Only the backend touches the host: Node uses `node:fs`; the native compiler
  its `FileHost`.

## Slices

Each slice preserves image and self-build stage identity. Measurements cover
suite peak RSS and live heap, Node-hosted self-compile and native stage-2
wall time and cycles on a shared frozen source graph.

1. **Store and format:** `packages/ir/src/storage/` (codec, store, memory
   backend), Node and native backends, round-trip tests over the self-compile
   IR. No pipeline change.
2. **Streaming emission:** emitter summaries and the emission loop read the
   store; `compileTypedProgram` hands the optimized IR to the store; forced
   spilling test comparing images. Files: `packages/codegen/src/aarch64/scalar/index.ts`
   (localized to the analysis prologue and the function loop),
   `packages/ir/src/scalar/{word-facts,word-arguments,record-flow,safepoints,call-boundaries,record-facts}.ts`
   (store-reading entry points beside the module ones),
   `packages/compiler/src/native/index.ts` (`compileTypedProgram` emission
   call only), `packages/compiler/src/build.ts` (`BuildRequest.storage`).
3. **Optimizer streaming:** `packages/ir/src/optimization/index.ts`
   (`rewriteFunctions`, version adoption), then whole-module passes one by
   one.
4. **Single-copy link:** Startup and native service composition produce code
   placement plans. `build.ts` adds the trace payload and the Mach-O and ELF
   writers place all the code directly into the executable. Callback thunk
   data and range registration retain their existing layout.
5. **Input syntax ownership:** `compileMacOSProgram`, the general fallback's
   module source, Test262 suite host.
