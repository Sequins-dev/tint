# Precise guarded reads in stack maps (frozen v3, `space-pr2`)

These measurements come from one run of each tool. They are not a running
log.

## Root cause

[native-heap-findings-v3-obs.md](native-heap-findings-v3-obs.md) found
414 MiB retained by the compile driver's frame (`compileTypedProgram`'s
direct variant, `@36:value:35$4366$direct`) at every major. A per-root walk
of an `obs-final` snapshot after major #234 (`tools/heap-snapshot`, frame
roots by stack offset) showed what held it:

| Root     | Holds                                                            | Retained  |
| -------- | ---------------------------------------------------------------- | --------- |
| `sp+608` | the `let representation` cell (pre-prune module)                 | 199.7 MiB |
| `sp+248` | `nativeChecked`                                                  | 133.3 MiB |
| `sp+368` | `linked` (`{evaluationOrder, module, exports, origins, ranges}`) | 79.7 MiB  |

The findings attributed the third root to `lowered`, but the record is
`linkModules`' result.

No closure environment or hoisted helper was on these paths. The frame
slots themselves were listed in the safepoint map of the `emitModule` call.
The optimized IR of that function (Node-hosted frozen compile, analyzed with
`safepointLiveSlots`) had 56 tracked slots live across the call. For 44 of
them, the only "use" ahead was a `record … operation=read slot=N`
terminator, which writes slot N.

`analyzeSlots` modeled every record, record-cell and cell terminator as
reading and writing its slot ("conservatively retain guarded transfer slots
on both edges"). A guarded read writes its slot on the consequent edge
only, and the alternate edge keeps the old contents. Counting the read as a
use kept whatever an earlier binding left in a slot reachable until a later
read overwrote it. Slot compaction and sharing put many short-lived read
destinations on the same slots as long-dead locals, so this retained large
structures.

## Change

- `analyzeLiveSlotsPrecisely` (`@tint/ir/scalar`) kills a guarded read's
  slot on its consequent edge alone. The slot stays live into the block when
  the alternate edge or an exception handler needs it, or when both edges
  coincide.
- `safepointLiveSlots` and the precise stack-map liveness use it. So do
  register roots (`SlotHomes.registerRoots`). Register interference, root
  clearing and the optimizer passes keep the conservative model.
- Slot sharing already modeled guarded reads this way, and codegen writes a
  read's destination only after the guard succeeds. Entry zeroing uses the
  same precise analysis, so the stack-map soundness argument
  ([gc-stack-maps.md](../gc-stack-maps.md)) still holds.

After the change, 12 slots are live across the `emitModule` call. Each of
them is read later.

## Live heap after each major

`tools/heap-snapshot/cli.ts capture native-space-pr2 --after-majors`
reports 292 collections and 5 majors, the same counts as `obs-final`. Output
is byte-identical to `out-sdisp`.

| Major (obs-final / space-pr2) | obs-final | space-pr2 | Change            |
| ----------------------------- | --------- | --------- | ----------------- |
| #54 / #54 (optimizer)         | 770.6 MiB | 699.2 MiB | -71.4             |
| #161 / #164 (optimizer)       | 828.9 MiB | 757.3 MiB | -71.6             |
| #234 / #235 (codegen)         | 723.3 MiB | 523.6 MiB | -199.7            |
| #248 / #250 (codegen)         | 763.5 MiB | 565.9 MiB | -197.6            |
| #279 / #291 (codegen, peak)   | 934.1 MiB | 676.2 MiB | **-257.9 (-28%)** |

Reachable objects at the peak fell from 12.33 M to 9.76 M, and headers from
188.2 to 149.0 MiB.

The compile frame now retains 214.2 MiB during codegen: `nativeChecked`
(133.3) and `linked` (79.7). The source reads both after `emitModule` (debug
symbols, error locations). During optimization it also holds the pre-prune
and pruned modules (148.6 MiB each); `reachable` is read after
`optimizeModule`. Freeing these requires changes to the compiler's sources,
not to codegen.

## Timing (`lockf … frozen-workload.ts run v3 mem2 space-pr2 --rounds 6`)

|                     | mem2            | space-pr2                 |
| ------------------- | --------------- | ------------------------- |
| Peak RSS            | 2.925 GB        | 2.762 GB (-163 MB, -5.6%) |
| Instructions (min)  | 1132.6 G        | 1119.4 G (-1.2%)          |
| Cycles min / median | 207.6 / 222.4 G | 204.6 / 216.4 G           |
| Wall min / median   | 40.29 / 53.5 s  | 40.90 / 49.0 s            |

The host was shared, and one space-pr2 round took 116 s under external
load. Cycles and wall time are within noise. The first variant, `space-pr`
(frame slots only), showed the same RSS (2.762 GB) and instruction
reduction.

## Feature bench (baseline worktree at `dc43cdf57` vs this change, interleaved, best of 3)

| Kernel      | Base Gcyc | New Gcyc | Base Gins | New Gins |
| ----------- | --------- | -------- | --------- | -------- |
| closures    | 1.10      | 1.05     | 5.44      | 5.44     |
| records     | 7.38      | 7.18     | 35.58     | 35.56    |
| collections | 8.70      | 8.78     | 48.63     | 48.68    |
| recursion   | 6.02      | 6.16     | 26.03     | 26.29    |
| exceptions  | 0.11      | 0.11     | 0.37      | 0.37     |

These are from the second of two interleaved pairs; the first pair ran
under heavy external load. All kernels are neutral within noise, because
the feature kernels hold little dead data across collections.

## Tests

- `packages/ir/test/scalar-liveness.test.ts`: a guarded read's slot is
  killed on the consequent edge only. It stays live when the alternate
  edge, an exception handler or a shared edge needs it.
- `packages/codegen/test/scalar-stack-maps.test.ts`: a stale reference in a
  later read's slot is not listed at a call, whether it sits in a frame
  word or a callee-saved register, unless the failure edge reads it.
- `tools/native-safe-for-space.test.ts`, Node vs native under LLDB:
  - closures around guarded reads under collection pressure: reassigned
    captured lets seen by siblings, hoisted helpers, closures in loops,
    recursive helpers, escaping closures and throws. Typed native traps TDZ
    reads, so the fixture checks ordering without a TDZ violation.
  - a weak slot keyed by a list left in a read's destination slot is
    cleared by the next forced collection. Without the change it survives
    (exit status 11).
