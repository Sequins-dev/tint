# Re-measurement of parallel bounded compile upper bound on current main

November 27, 2026. This report re-measures the native backend worker split
upper bound from [worker-bound-v1](parallel-bounded-compile-worker-bound-v1.md)
after rebasing PR #4 onto `origin/main` (`d119763b9`, following PRs #13, #15,
#17, #18, #45–#53). It checks whether the four blockers identified on November
22 have improved enough for a worker split to clear the 15% whole-build wall
reduction bar.

## Methodology and provenance

All timings were run natively on macOS arm64 under LLDB (confirming stopped at
entry and `EXIT 0` independently of LLDB's shell status) inside
`tools/gate/with-lock.sh both` to isolate execution from concurrent builds
(host one-minute load average at start: `5.08`).

- Base commit: `origin/main` `d119763b9` plus rebased PR #4 fragment/storage
  prototype and `ReferenceError` packed-IR codec fix (`packages/ir/src/storage/codec.ts`).
- Frozen workload: 881-file compiler source snapshot (7,782 emitted functions).
- Stage1 == stage2 unmodified fixed point confirmed before instrumentation
  (46,250,634 bytes, `stage1-serial` == `stage2-serial`).
- Instrumented native probe (`stage1-probe`) compiled from an out-of-tree copy
  of the frozen snapshot, running both `--probe-serial` and `--probe-actor`
  (76 contiguous ranges, inline detached `openFragmentActor` + `packPreparation`
  + packet encode/decode + canonical placement) on the identical frozen snapshot.
- **Byte-identical output verified**: `stage2-serial`, `stage2-probe-serial`,
  and `stage2-probe-actor` all produced the exact same 46,250,634-byte signed
  Darwin arm64 executable with SHA-256
  `1f168e8a89fd6303ce999103f4946c4902daa83e4b81841fa5bdd0de6565f012`.

Note: the full native actor byte-identity check uncovered a pre-existing bug in
`packages/ir/src/storage/codec.ts`, which encoded `NativeErrorKind`
`"ReferenceError"` as `2` (`"Error"`). Fixing `errorCode`/`errorName` restored
exact byte identity across all 46.25 MB.

## Side-by-side comparison (Nov 22 vs. Nov 27)

| Quantity | Nov 22 (`worker-bound-v1`) | Nov 27 (macOS arm64, `d119763b9`) | Change |
| --- | ---: | ---: | ---: |
| Compiler source graph / emitted functions | 821 files / 7,111 funcs | 881 files / 7,782 funcs | +7.3% / +9.4% |
| Signed Darwin arm64 image size | 50,163,978 B | 46,250,634 B | −7.8% |
| Whole native self-build wall time (unmodified) | 97.3 s (paired median) | 165.36 s (single locked run)\* | +70.0% |
| Whole native self-build wall time (`probe-serial`) | — | 173.10 s (173.88 s LLDB) | — |
| Total `emit-native-code` pass (`probe-serial`) | 38.8 s (macOS) | 44.41 s (42.15 s unmodified) | +14.5% |
| Backend `prepare()` (`probe-serial` / `probe-actor`) | — | 4.45 s / 4.44 s | — |
| Serial backend function loop (`loop_ms`) | 32.44 s macOS / 33.69 s Linux | **38.79 s** | +19.6% vs. macOS |
| Largest single function (`emitModuleForms`) | 7.13 s macOS / 7.63 s Linux (×2 copies) | **18.99 s** (1 copy; 48.9% of loop) | **+166% single job** |
| Second-largest function | 6.13 s macOS (2nd copy) | 0.89 s | −85.5% |
| Inline actor path, all 76 ranges (`actor_exec_ms`) | 51.57 s (Linux) | **40.53 s** (75.92 MB packets) | −21.4% |
| **Actor / serial overhead ratio** | **1.53×** | **1.045×** (`40.53 / 38.79`) | **−31.7% (−48.5 pp)** |
| Input publication (`packPreparation`) | 0.61 s | **0.42 s** (2.67 MB prep + 45.57 MB bodies) | −31.1% |
| Actor open (`openFragmentActor`) | — | 0.009 s (8.9 ms) | — |
| Canonical placement & finalize after actors | 7.13 s (Linux) | **2.15 s** (`0.48 s` merge + `1.67 s` finalize)\*\* | **−69.8%** |
| Byte-identical image vs. serial control | Yes | **Yes** (`1f168e8a...5f012`) | Pass |

\* In today's unmodified self-build (`165.36 s` wall, `132.68 s` total pass
time), optimizer passes rose from `33.5 s` (Nov 22) to `90.53 s`, dominated by
`fold-constants` (`40.25 s` across 4 runs: `#2` 1.32 s, `#19` 7.59 s, `#42`
2.59 s, `#62` **28.76 s**).

\*\* In `probe-serial`, backend finalization (helpers, string pool, descriptors,
stack maps, patching) took `1.16 s`; in `probe-actor`, packet sort/decode/merge
took `0.48 s` and finalization took `1.67 s`, so the incremental placement cost
above serial finalization is `0.99 s` (`0.48 + 0.51 s`).

### Largest function profile (`probe-serial`)

PR #48 eliminated the duplicate copy of `emitModuleForms`, so the second-largest
function dropped from `6.13 s` to `0.89 s`. However, `packages/codegen/src/aarch64/scalar/index.ts`
nearly doubled in source size since Nov 22 (from ~17.5k lines to 34.2k lines across
PRs #17–#53), growing the remaining single copy of `emitModuleForms`
(`id=5827`, `@56:value:267$5757$direct`) from `21,235 blocks / 13,645 slots / 72,931 insns`
to **`35,130 blocks / 18,963 slots / 131,651 insns`**, taking **`18.99 s`**
(**48.9%** of the entire `38.79 s` serial function loop).

| Rank | Function | Blocks | Slots | Instructions | Wall (ms) | Share of loop |
| ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 1 | `emitModuleForms` (`@56:value:267$5757$direct`) | 35,130 | 18,963 | 131,651 | 18,987.6 | 48.9% |
| 2 | `@172:value:20$5426$direct` | 21,540 | 3,450 | 34,861 | 892.1 | 2.3% |
| 3 | `@56:value:1332$5845$direct` | 3,056 | 139 | 6,131 | 619.7 | 1.6% |
| 4 | `@55:value:71$7997$direct` | 10,605 | 3,073 | 25,024 | 500.1 | 1.3% |
| 5 | `@195:value:292$6988$direct` | 12,850 | 3,944 | 29,862 | 402.4 | 1.0% |

## Updated N-lane upper bound

Using the same lower-bound model as `worker-bound-v1`:

    stage(N) >= max(ratio * largestFn, ratio * serialLoop / N) + placement + publish

With today's measured macOS inputs (`ratio = 1.045`, `largestFn = 18.99 s`,
`serialLoop = 38.79 s`, `serialLoop + serialFinalize = 39.96 s`,
`placement = 2.15 s`, `publish = 0.42 s`, whole unmodified build `= 165.36 s`):

    stage(N) >= max(1.045 * 18.99, 40.53 / N) + 2.15 + 0.42
             >= max(19.84, 40.53 / N) + 2.57

| Lanes | Stage bound | Saving vs. `serialLoop + finalize` (39.96 s) | Share of 165.4 s build | Saving vs. `serialLoop` only (38.79 s) | Share of 165.4 s build | Nov 22 share (97.3 s build) |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2 | 22.83 s | 17.13 s | **10.4%** | 15.96 s | 9.7% | 0.2% |
| 4 | 22.41 s | 17.55 s | **10.6%** | 16.38 s | 9.9% | 13.5% |
| 6 | 22.41 s | 17.55 s | **10.6%** | 16.38 s | 9.9% | 14.7% |
| unlimited | 22.41 s | 17.55 s | **10.6%** | 16.38 s | 9.9% | 14.7% |

Notice that at `N = 2`, the bound already jumps from Nov 22's `0.2%` to `10.4%`
because the actor overhead ratio dropped from `1.53×` to `1.045×` and placement
dropped from `7.13 s` to `2.15 s`. However, by `N = 3` (`40.53 / 3 = 13.51 s < 19.84 s`),
the single `emitModuleForms` job (`19.84 s` in actor mode) completely saturates
the critical path, flattening all widths `N >= 4` at **10.6%** (below the 15%
acceptance bar).

### Counterfactual: if `emitModuleForms` is split below 2 s per function

Holding every other Nov 27 measurement fixed (`ratio = 1.045`, `placement = 2.15 s`,
`publish = 0.42 s`, whole build `= 165.36 s`), decomposing `emitModuleForms` so
that `largestFn <= 2.0 s` removes the critical-path floor:

| Lanes | Counterfactual stage bound | Saving vs. 39.96 s | Share of 165.4 s build | Share of 136.6 s build (excl. `fold-constants` #62) |
| ---: | ---: | ---: | ---: | ---: |
| 2 | 22.83 s | 17.13 s | 10.4% | 12.5% |
| 4 | 12.70 s | 27.26 s | **16.5%** | **20.0%** |
| 6 | 9.32 s | 30.64 s | **18.5%** | **22.4%** |
| unlimited | 4.66 s | 35.30 s | **21.3%** | **25.8%** |

## Closed-world and Worker runtime audit on current `main`

All closed-world and generational-heap blockers reported in `worker-bound-v1`
have been **resolved** on current `main` (`d119763b9`):

1. **Generational GC is now the only collector**:
   - `packages/native-runtime/src/index.ts:100` exports only `initializeGenerationalRuntime`.
   - `packages/compiler/src/build.ts:483,495` requires `initializeGenerationalRuntime`
     whenever `runtimeEntry` is set, and `tools/worker-fixture-options.ts:167`
     runs all Worker fixtures on `initializeGenerationalRuntime`.
   - `packages/codegen/src/aarch64/scalar/index.ts:5989` (and
     `packages/codegen/src/x86_64/scalar/index.ts:6873`) gate `generationalBarriers`
     on `trackedManagedWrites` (`packages/ir/src/scalar/record-facts.ts:199-211`),
     which accepts `descriptorPreservingHostOperation`, including all isolate
     operations.
2. **All Worker and shared-memory host operations are now closed-world**:
   - `closedWorldHostOperation` (`packages/ir/src/scalar/record-facts.ts:18-74`)
     delegates its `default` branch (`:72`) to `isolateHostOperation` (`:88-110`),
     which admits all 16 isolate/Worker/SAB operations: `thread-start`,
     `thread-join`, `hosted-thread-entry`, `memory-unmap`, `word-park`,
     `word-wake`, `shared-read-unsigned`, `shared-write-unsigned`,
     `shared-read-word64`, `shared-write-word64`,
     `shared-compare-exchange-unsigned`, `shared-compare-exchange-word64`,
     `memory-write-float64`, `memory-write-string`, `string-at`, and `string-copy`.
   - All remaining host bindings used by `node:worker_threads`
     (`tools/worker-fixture-options.ts:8-78`) — `memory-map` (`:46`),
     `context-domain` (`:42`), `memory-read-float64` (`:55`),
     `memory-read-string` (`:56`), `string-address` (`:58`) — are directly in
     `closedWorldHostOperation`, while `string-flat` lowers to an IR instruction
     (`packages/ir/src/scalar/host.ts:520-521`).
   - `hosted-thread-entry` enters through the image's own hosted entry and
     reaches the program through the same closed roots
     (`packages/ir/src/scalar/record-facts.ts:76-78`).
3. **Every interprocedural analysis now stays active when linking `node:worker_threads`**:
   - List vectors: `packages/ir/src/optimization/list-vectors.ts:148,327` (`stableRecordLayouts`) — **active**.
   - Number-list loops: `packages/ir/src/optimization/number-list-loops.ts:1039` (`stableRecordLayouts`) — **active**.
   - Word arguments: `packages/ir/src/scalar/word-arguments.ts:21` (`stableRecordLayouts`) — **active**.
   - Call targets: `packages/ir/src/scalar/call-targets.ts:112` (`closed && stableRecordLayouts`) — **active**.
   - Call boundaries (`provenDirectOnlyFunctions`): `packages/ir/src/scalar/call-boundaries.ts:18` (`stableRecordLayouts`) — **active**.
   - Record flow (`provenRecordFacts`): `packages/ir/src/scalar/record-flow.ts:55` (`stableRecordLayouts`) — **active**.
   - Reachability (`traceClosedModule`): `packages/ir/src/optimization/reachability.ts:28` (`stableRecordLayouts`) — **active**.
   - Unallocated records: `packages/ir/src/optimization/unallocated-records.ts:38` (`stableRecordLayouts`) — **active**.
   - Emitter `stableLayouts` / `stableSlots` (`wordReturns`, `wordArguments`):
     `packages/codegen/src/aarch64/scalar/index.ts:6091-6115` (`stableRecordLayouts`) — **active**.

## Verdict

Three of the four blockers from November 22 are now **solved or beaten**:

1. Closed-world Worker classification & generational arm64 Workers: **solved**.
2. Actor / serial overhead ratio (`1.53×` → target `~1.1×`): **beaten (`1.045×`)**.
3. Placement & publication (`7.13 s` → target `< 1 s`): **solved (`0.48 s` packet merge / `0.99 s` incremental / `2.15 s` with full finalize; `0.42 s` pack)**.
4. Largest single job (`emitModuleForms`): **regressed from `7.13 s` to `18.99 s`** (`48.9%` of the serial backend loop).

Because `emitModuleForms` alone caps any N-lane parallel backend split at
**10.6%** of the whole build, a multi-worker rotation still cannot clear the 15%
acceptance bar today, and PR #4 should remain a **draft**. However, the
parallelization machinery itself is now fast enough (`1.045×` actor overhead,
`0.48 s` merge, `0.42 s` pack, full closed-world generational Workers) that
**decomposing `emitModuleForms` into smaller functions is the single prerequisite
needed to push 4–6 lanes past the 15% bar (16.5%–18.5%, or 20%–22% once the
`28.8 s` `fold-constants` #62 cost on `emitModuleForms` is also addressed).**
