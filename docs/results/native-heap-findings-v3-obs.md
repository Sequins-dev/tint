# Frozen v3 heap findings (heap observability tools, `obs-final`)

These are measurements only. Nothing here was implemented; the proposals at
the end are ranked for the coordinator.

## Method

- **Image**: `native-obs-final`, frozen v3 built at `fdc8b6452` with
  `--runtime-tree --tree packages/abi/src/host.ts --tree packages/foundation/src/collections`.
  It is a debug build with heap introspection, which differs from `mem2` only
  in debug metadata and the dormant hook. TZ=UTC. Both runs produced output
  byte-identical to `out-sdisp`.
- **Snapshots**:
  `node tools/heap-snapshot/cli.ts capture <image> --after-majors --before 234 -- source out`.
  The run took 2 min 23 s under LLDB, with 292 collections and 5 majors
  (#54, #161, #234, #248, #279). Each "after" dump is taken at the first
  allocation after its major, a precise safepoint.
- **Root walk check**: at every after-major dump, all objects found through
  the start bits were reachable from the precise stack-root walk
  (11,359,677 of 11,359,677 objects; …; 12,331,962 of 12,331,962). The tool's
  root walk and the collector's tracing agree exactly.
- **Allocation profile**:
  `allocations <image> --interval 1048576` took 71,054 samples. Its estimate
  of 73.4 GiB allocated in total matches the census's 74.5 GiB nursery
  volume.
- **Peak snapshot**: after #279, 615 MB as a `.heapsnapshot` (12.33 M
  nodes, 16.9 M edges). Memlab (`@memlab/core` 1.1) parsed it with identical
  totals and computed its dominators. It loads in Chrome DevTools.

## Live heap after each major

| Major | Live | Objects | Headers | Records | Buffers | Vectors | Strings |
| --- | --- | --- | --- | --- | --- | --- | --- |
| #54 (optimizer) | 770.6 MiB | 11.36 M | 173.3 MiB (22%) | 574.1 | 42.3 | 134.9 | 19.1 |
| #161 (optimizer) | 828.9 MiB | 11.89 M | 181.5 MiB (22%) | 623.5 | 41.9 | 144.1 | 19.1 |
| #234 (codegen) | 723.3 MiB | 11.02 M | 168.2 MiB (23%) | 557.9 | 42.1 | 104.0 | 19.1 |
| #248 (codegen) | 763.5 MiB | 11.25 M | 171.6 MiB (22%) | 567.0 | 70.5 | 106.7 | 19.1 |
| **#279 (codegen, peak)** | **934.1 MiB** | 12.33 M | 188.2 MiB (20%) | 611.1 | 190.3 | 113.4 | 19.2 |

Before #234, the old prefix held 1.54 GiB, of which **924 MiB was dead**:
promoted by minors, then dropped. Most of it was optimizer IR (vectors
399 MiB, `{id, instructions, terminator, exception}` blocks 195 MiB, field
instructions 155 MiB, `{lo, hi, integer}` 31 MiB). The nursery held 148 MiB
of dead and 108 MiB of live objects.

## Who retains the peak (after #279)

| Retainer | Retained |
| --- | --- |
| `compileArm64Program`'s frame (`compiler/src/native/index.ts:1556`, inside `emitModule`) | 414.0 MiB |
| ↳ `let representation` (pre-prune module), kept alive by a closure cell | 199.7 MiB |
| ↳ `nativeChecked` (checker result: `typeNames`, `classes`, `typeFlows`, `receiverTypes`, ...) | 133.3 MiB |
| ↳ `lowered` (`{ok, value}` from `lowerModuleEntries`) | 79.7 MiB |
| The optimized module's function vector (8192 `FunctionIR`s), shared by the compile and emit frames | 229.4 MiB |
| `emitModule`'s frame (`codegen/.../scalar/index.ts:2795`) | 192.1 MiB |
| ↳ the current function's slot-sharing state `{color, colors, otherLiveIn}`: two to three 32 MiB `Uint32Array` owner tables | 96.0 MiB |
| ↳ the code buffer `{length, tail, tailUsed, pageWords, maxWords, pages}` | 20.1 MiB |

The compile frame holds about 412–434 MiB at every major: during
optimization at #54 and #161 (`index.ts:1536`, the `optimizeModule` call),
and during codegen at #234–#279. The 456 `Uint32Array`s at the peak total
152.9 MiB. Of record self bytes, the top types are IR operands and
instructions: `{start, end, kind, id, slot}` 92.0 MiB (1.5 M),
`{id, instructions, terminator, exception}` 66.5 MiB, and field
instructions 49.5 MiB.

## Where allocation volume comes from (73.4 GiB)

By type: vectors 26.0 GiB (35%), `Float64Array` 13.5 GiB (18%), and
`{lo, hi, integer}` 5.7 GiB (8%). Number lists and strings are 3.3 and
3.0 GiB, `Uint32Array` 2.7 GiB and closures (`function`) 2.4 GiB.

| Site (cumulative) | Volume | What |
| --- | --- | --- |
| `bounds.ts:selectArrayAccesses` (frozen snapshot's dense analysis) | 26.8 GiB (36.5%) | `propagate` 21 GiB (vector growth in `__tint_reference_list_write`, `{lo, hi, integer}` from `join`/`meet` at line 88, 5.6 GiB), `merge` 6.2 GiB |
| `number-list.ts:reserve` (line 51, `new Float64Array`) | 13.6 GiB (18.5%) | Doubling growth of number lists |
| ↳ `foldFunctionConstants` (`optimization/index.ts:150`: `wraps[op.id]`, `absent[op.id]`) | 7.5 GiB | Two holey lists indexed by value id, grown per function per fold (two phases, `index.ts:821` and `:1214`) |
| ↳ `emitModule` | 3.6 GiB | Per-function number lists (`scalar/index.ts:680`, `:2783`, slot-sharing `liveIn`/`occupied`) |
| `emitModule` in total | 15.1 GiB (20.6%) | `Float64Array` 4.3, `Uint32Array` 2.2 (slot-sharing owner tables, 1.2 GiB), number lists 1.7, closures 1.0 |
| `createNumberList` | 4.3 GiB | List headers and first buffers |
| `linked-set appendSet`, `linked-map setMapHashed`/`createMapStorage` | 4.6 GiB | Set/Map entries and tables |

The current tree has replaced `bounds.ts` (sparse form), so the census's
interval vectors and the 36.5% here are specific to the frozen snapshot.
The `foldFunctionConstants`, number-list, slot-sharing and closure-cell
patterns are unchanged in the current tree.

## Ranked proposals

Each estimate is from the measurements above.

1. **Release front-end state before optimization and emission**
   (`compileArm64Program`).
   - The problem: `let representation` is captured by a closure (line
     ~1537), so its cell keeps the pre-prune module alive. `nativeChecked`
     and `lowered` are also reachable from the frame through optimization
     and codegen.
   - The fix: stop capturing `representation` (or clear it after
     `prune`/`optimizeModule`). Do the work that needs the checker and
     lowering results (debug-name resolution, service checks) before
     optimization, or keep only the small extracts it needs.
   - Expected: up to about 414 MiB less live data at every major (44% of
     the peak), fewer and cheaper majors (each copies the whole live
     heap), and lower peak RSS.
   - Risk: low. This is lifetime only, with no layout change.
2. **Drop each function's IR once it is emitted.**
   - The problem: the optimized module's 8192 `FunctionIR`s (229 MiB) stay
     live through all of `emitModule`.
   - The fix: emission (and the debug description that follows it) could
     consume functions in order and release `blocks`.
   - Expected: about half of 229 MiB on average during codegen, which is
     where the peak occurs.
   - Debug builds would keep the bindings they need.
3. **Age nursery survivors before promotion** (GC policy, `mem`'s area).
   - The problem: minors promote everything live, so optimizer temporaries
     alive across one minor fill the old prefix with 924 MiB of garbage by
     #234. That garbage forces majors, and minors copied 4.75 GiB over the
     run.
   - The fix: one survivor generation, or a promotion age of 2, would keep
     pass-local IR in the nursery.
   - Expected: fewer majors, less promotion copying and a smaller old
     prefix (peak RSS).
   - Measure with `capture --before-majors` and `collections.json`.
4. **Fixed-size scratch for `foldFunctionConstants`.**
   - The problem: `wraps` and `absent` are holey `number[]` lists indexed by
     value id. Each fold of each function grows a `Float64Array` (plus
     presence bytes) by doubling from 4 up to the largest id.
   - The fix: a `Uint32Array`/`Uint8Array` sized once to the function's
     value count, or kept across functions and cleared by an epoch stamp.
   - Expected: about 7.5 GiB (10%) less allocation volume and fewer minors.
5. **Shrink slot sharing's owner table.**
   - The problem: three parallel `Uint32Array`s sized to a power of two
     above 2× the live-ins (up to 4×) hold 96 MiB for the largest function
     at the peak, and 1.2 GiB of volume.
   - The fix: pack the group and block into one key array, use a 1.5× load
     factor with linear probing, or index by block for single-slot groups.
   - Expected: about 50–70 MiB off the codegen peak.
6. **Pre-size number lists that grow by doubling** (`number-list.ts:reserve`,
   13.6 GiB).
   - The fix: callers that know their final length (per-function arrays
     indexed by slot, block or instruction in codegen, at
     `scalar/index.ts:680` and `:2783`) should create lists with that
     capacity. Doubling from 4 copies every element about once more and
     leaves up to half of the capacity unused.
   - Expected: several GiB of volume, beyond the fold scratch in item 4.
7. **Vector slack and growth garbage.**
   - The problem: vectors are 35% of all allocation volume and 399 MiB of
     the dead old prefix at #234.
   - The fix: exact-size creation exists now; extend it to rebuilt
     instruction and block lists in optimizer passes (allocate the result
     at the input's size, then truncate).
8. **Headers are 20–23% of every live snapshot** (168–197 MiB). The planned
   8-byte header (owned by `mem`) is worth about 85–100 MiB at the peak.
   The descriptor and DWARF describe the header, so the tools need only
   their metadata to follow it.

## Reproduce

```sh
V=.tint-bootstrap/workload-v3
node tools/heap-snapshot/cli.ts capture $V/native-obs-final --out /tmp/v3heap --after-majors -- $V/source /tmp/out
node tools/heap-snapshot/cli.ts convert /tmp/v3heap/after-279 --report r.json --pprof inuse.pb.gz --heapsnapshot peak.heapsnapshot
node tools/heap-snapshot/cli.ts allocations $V/native-obs-final --interval 1048576 --out alloc.pb.gz -- $V/source /tmp/out2
go tool pprof -top -cum -sample_index=alloc_space alloc.pb.gz
```
