# General runtime A6 · sloppy receiver fast paths, inherited IC probes, speculative numeric loops, and x86-64 fixpoint · Darwin arm64

Step A6 of PR #12 on top of the A5 head (`9d94f0936`): flush x86-64 local branch fixups, unwind records, and safepoints per function to eliminate self-host heap exhaustion during Linux x86-64 fixpoint emission; probe global megamorphic stub buckets ahead of inline entry scans and rotate inline eviction on sustained misses; expose `Function.prototype.call` and `Array.prototype.pop` realm intrinsics for inline `.call` forwarding and packed `Array.prototype.pop`; allow sequential fill of preallocated dense arrays (`new Array(n)`); inline packed array `.length` and fix eager `sloppyCallReceiver` evaluation on object receivers (with a nullish `$global.thisValue` fast path); mark `.apply`/`.call` callee receivers as method reads and probe `cachedInheritedPropertyValue` on own non-method IC misses; and add speculative 1- and 2-level nested numeric `for`-loop specialization over tight `Float64Array` views with exact general-loop deopt tails (`numeric-loop-spec.ts`). Base `9d94f0936`; head `bbf0e1d93`. Apple M5 Max, Node 26.13.1.

Every Octane program drops **37% to 63%** over 18 paired rounds (9/18 rounds ≥75% host idle, 77.5% base / 75.2% A6 median idle; identical pattern on the ≥75%-idle subset): **Richards −37.32%** (`1.500 → 0.931 ms/op`, `19.0×` Node; ≥75%-idle `1.453 → 0.914 ms/op`, `−36.32%`), **DeltaBlue −51.94%** (`4.894 → 2.542 ms/op`, `36.0×` Node; ≥75%-idle `4.666 → 2.321 ms/op`, `−50.21%`), **NavierStokes −62.97%** (`16.906 → 6.633 ms/op`, `3.5×` Node; ≥75%-idle `16.348 → 6.158 ms/op`, `−62.82%`, `3.3×` Node), and **RayTrace −57.08%** (`18.629 → 8.078 ms/op`, `14.5×` Node; ≥75%-idle `17.739 → 7.807 ms/op`, `−56.50%`). On the elements and builtins suite (18 paired rounds, 10/18 ≥75% idle), speculative numeric loops push all three packed number element kernels **ahead of Node**: **`numberElementRead` −76.72%** (`6.357 → 1.455 ns`, **`0.7×` Node**), **`numberElementUpdate` −82.75%** (`8.500 → 1.479 ns`, **`0.8×` Node**), and **`numberElementWrite` −72.44%** (`5.752 → 1.637 ns`, **`0.8×` Node**), while inline packed `.length` cuts **`pushLength` −20.05%** (`35.779 → 27.440 ns`, `6.4×` Node) and **`objectArrayLiteral` −4.77%**. On the generality suite (18 paired rounds, 18/18 ≥75% idle, 87.2% / 87.4% median idle), `allocateObjects` (`−2.07%`), `arguments5` (`−1.81%`), `buildString` (`−1.01%`), and `arguments3` (`−0.33%`) improve while probing `cachedInheritedPropertyValue` on own non-method IC misses adds overhead on megamorphic own reads (**`receivers8` +19.09%**, `41.189 → 49.291 ns`; `receivers4` `+3.45%`) alongside smaller shifts on `concatenateStrings` (`+8.40%`), `mixedCall` (`+5.27%`), and `mutableCapture` (`+4.85%`). On the call/loop kernels (20 paired rounds, 20/20 ≥75% idle), all eight kernels remain ahead of Node (`0.03×` to `0.8×` Node). Warm-call `neon` traces (strict ES module) hold steady or drop slightly (`walk(t)` `1,269 → 1,267`, `Task.prototype.isHeldOrSuspended` `285 → 284`). Frozen v7 `--runtime-tree` produces bit-for-bit identical `__text`, `__eh_frame`, `__unwind_info`, and `__data` Mach-O sections. Both Darwin arm64 `stage1 == stage2` and native `stage1 --target linux-x86_64` cross-emission reproduce their stage-1 images byte for byte under LLDB.

## What changed

| Commit      | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `b6e20b327` | Add `beginScope()` / `endScope()` to `packages/codegen/src/x86_64/isa.ts` and flush local branch fixups, unwind entries, and safepoints at the end of each emitted x86-64 function in `packages/codegen/src/x86_64/scalar/index.ts`, preventing native heap exhaustion during Linux x86-64 fixpoint emission while preserving byte-identical output. Add scoped-assembly equivalence test in `packages/codegen/test/x64-isa.test.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `686332190` | Probe global megamorphic stub buckets before scanning inline entries on megamorphic IC sites and rotate inline eviction every 8 misses (`operations.ts`); expose `ErrorRealm.functionCall`, `ErrorRealm.arrayPopMiss`, and `IntrinsicFunctions.arrayPop`; add `scriptArrayPop` / `popPackedElement` and allow sequential fill of preallocated `new Array(n)` dense arrays in `appendPackedElement` (`array-append.ts`); update `runtime-imports.ts` and Script surface/historical-capture tests (`173` values, `200` surface entries).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `bbf0e1d93` | Fix eager `sloppyCallReceiver` evaluation in sloppy function prologues by checking `viewObjectValue(receiver, $errors.objectPrototype) === undefined` before branching and fast-pathing nullish receivers to `$global.thisValue`; add `invokeForwardedCall` for `f.call(thisArg, ...args)` and mark `.apply`/`.call` callee reads with `method = true`; inline packed array `.length` and `Array.prototype.pop`; probe `cachedInheritedPropertyValue` on own non-method IC misses; add 1- and 2-level nested speculative numeric `for`-loop specialization (`packages/js-engine/src/lowering/numeric-loop-spec.ts`) over tight `Float64Array` views (`subarray(0, numberCount)` when capacity exceeds length) with pairwise aliasing guards, deferred writes, and exact general-loop deopt tails; regenerate `packages/compiler/src/catalog.ts` (`830` source files); add native semantic tests against Node in `native-general-elements.test.ts`, `native-general-property-caches.test.ts`, and `native-script-cases.test.ts`. |

An earlier prototype of guarded monomorphic/bimodal direct method twins (`direct-methods.ts`) was benchmarked on Octane and reverted before finalizing A6: although it ran cleanly and passed all tests, capturing mutable `$dmWitness` bindings and adding per-call-site receiver guards regressed Richards (`0.931 → 1.156 ms/op`), DeltaBlue (`2.542 → 2.736 ms/op`), and RayTrace (`8.078 → 10.033 ms/op`) relative to the already-specialized `script-entry` / `call-indirect` path.

## Warm calls

One warm call (the 501st), entry to return with callees, single-stepped under LLDB (`tools/general-call-bench/count_call.py`) on the `neon` ES module probe ([traces](general-runtime-a6-traces-darwin-arm64-v1.json)):

| Probe function                      | Base (`9d94f0936`) | A6 (`bbf0e1d93`) |         Change |
| ----------------------------------- | -----------------: | ---------------: | -------------: |
| `method(o)`: `o.get()`              |                217 |              217 |      0 (+0.0%) |
| `make(v)`: `new Box(v)`             |                466 |              466 |      0 (+0.0%) |
| `dot(a, b)`: `a.dot(b)`             |                508 |              508 |      0 (+0.0%) |
| `callDeep(s)` (depth-2 prototype)   |                181 |              181 |      0 (+0.0%) |
| `walk(t)` (3 × `isHeldOrSuspended`) |              1,269 |        **1,267** | **−2 (−0.2%)** |
| `setState(t, v)`: `t.state = v`     |                 90 |               90 |      0 (+0.0%) |
| `Box.prototype.get`                 |                 67 |               67 |      0 (+0.0%) |
| `Vec.prototype.dot`                 |                363 |              363 |      0 (+0.0%) |
| `Task.prototype.isHeldOrSuspended`  |                285 |          **284** | **−1 (−0.4%)** |

`neon` is a strict ES module, so sloppy-receiver binding elision and `Function.prototype.call` / `Array.prototype.pop` / numeric-loop specialization do not apply to its strict method/constructor probes; every warm strict call stays flat or drops by 1–2 instructions (`walk(t)` `489` caller + `778` callee, down from `780`).

## Octane

18 paired rounds of A5 base `9d94f0936` vs A6 `bbf0e1d93` under `tools/gate/with-lock.sh both` on Apple M5 Max (clean trees, `patchSha256` empty; `9/18` rounds ≥75% host idle, median idle `77.5%` base / `75.2%` A6, load1 median `4.75` / `4.68`). Medians in ms/op and median `[q1, q3]` of per-round percent and absolute change ([data](general-runtime-a6-octane-darwin-arm64-v1.json)). Bold: interquartile range excludes zero.

| Program        | Node ms/op | Base ms/op | A6 ms/op |  A6 − base (%), median [IQR] |      Δ ms/op, median [IQR] | A6 ÷ Node |
| -------------- | ---------: | ---------: | -------: | ---------------------------: | -------------------------: | --------: |
| `Richards`     |      0.049 |      1.500 |    0.931 | **−37.32% [−49.66, −36.13]** |    −0.574 [−1.119, −0.526] |     19.0× |
| `DeltaBlue`    |      0.071 |      4.894 |    2.542 | **−51.94% [−61.50, −49.57]** |    −2.642 [−4.870, −2.346] |     36.0× |
| `NavierStokes` |      1.920 |     16.906 |    6.633 | **−62.97% [−69.86, −60.17]** | −10.727 [−19.867, −10.104] |      3.5× |
| `RayTrace`     |      0.556 |     18.629 |    8.078 | **−57.08% [−60.44, −54.91]** |  −10.911 [−23.625, −9.791] |     14.5× |

On the `9/18` rounds where both base and A6 ran with ≥75% host idle, medians tighten slightly with the same relative improvements: `Richards` `1.453 → 0.914 ms/op` (`−36.32%`, `19.9×` Node), `DeltaBlue` `4.666 → 2.321 ms/op` (`−50.21%`, `35.4×` Node), `NavierStokes` `16.348 → 6.158 ms/op` (`−62.82%`, `3.3×` Node), and `RayTrace` `17.739 → 7.807 ms/op` (`−56.50%`, `14.8×` Node).

## Elements, builtins, and creation kernels

18 paired rounds of A5 base `9d94f0936` vs A6 `bbf0e1d93` under `tools/gate/with-lock.sh both` (`10/18` rounds ≥75% host idle, median idle `77.3%` base / `77.9%` A6, load1 median `13.16` / `13.24`). Medians in ns/iteration and median `[q1, q3]` of per-round percent and absolute change ([data](general-runtime-a6-elements-darwin-arm64-v1.json)). Bold: interquartile range excludes zero.

| Kernel                | Node ns | Base ns |   A6 ns |  A6 − base (%), median [IQR] |       Δ ns, median [IQR] | A6 ÷ Node |
| --------------------- | ------: | ------: | ------: | ---------------------------: | -----------------------: | --------: |
| `charCodeAt`          |   2.290 |   8.372 |   8.356 |        −0.98% [−2.53, +2.74] |  −0.080 [−0.214, +0.224] |      3.6× |
| `mapSetHas`           |   8.319 |  80.463 |  76.957 |        −3.06% [−5.81, +0.13] |  −2.331 [−5.030, +0.102] |      9.3× |
| `mathFloor`           |   2.140 |   7.623 |   7.413 |        +0.01% [−1.30, +1.10] |  +0.002 [−0.113, +0.087] |      3.5× |
| `mathSqrt`            |   2.374 |   9.725 |   9.526 |        −0.46% [−5.66, +2.08] |  −0.049 [−0.664, +0.192] |      4.0× |
| `numberArrayLiteral`  |   8.795 | 100.252 |  98.952 |        −2.78% [−6.57, +0.91] |  −2.664 [−8.112, +0.862] |     11.3× |
| `numberElementRead`   |   2.039 |   6.357 |   1.455 | **−76.72% [−77.38, −76.03]** |  −4.845 [−5.593, −4.638] |      0.7× |
| `numberElementUpdate` |   1.834 |   8.500 |   1.479 | **−82.75% [−83.45, −82.00]** |  −7.088 [−8.004, −6.836] |      0.8× |
| `numberElementWrite`  |   2.041 |   5.752 |   1.637 | **−72.44% [−74.20, −70.14]** |  −4.139 [−4.769, −3.833] |      0.8× |
| `objectArrayLiteral`  |   4.250 | 124.962 | 117.577 |    **−4.77% [−7.71, −3.30]** | −5.488 [−10.005, −4.027] |     27.7× |
| `objectElementRead`   |   1.837 |  11.796 |  11.664 |        +0.11% [−1.96, +1.26] |  +0.014 [−0.314, +0.144] |      6.3× |
| `objectLiteral`       |   5.183 |   3.804 |   3.610 |        −0.54% [−4.59, +0.88] |  −0.019 [−0.185, +0.033] |      0.7× |
| `pushLength`          |   4.303 |  35.779 |  27.440 | **−20.05% [−24.68, −18.73]** | −6.997 [−10.140, −6.315] |      6.4× |
| `setAddHas`           |   7.605 |  80.075 |  78.047 |        −0.55% [−4.66, +2.53] |  −0.434 [−3.589, +1.864] |     10.3× |

Speculative numeric `for`-loop specialization hoists the packed `Float64Array` view and scalar guards out of the loop, cutting `numberElementRead` (`−76.72%`, `0.7×` Node), `numberElementUpdate` (`−82.75%`, `0.8×` Node), and `numberElementWrite` (`−72.44%`, `0.8×` Node) below Node 26.13.1. Inlining packed array `.length` drops `pushLength` by `−20.05%` (`−7.00 ns`).

## Generality kernels

18 paired rounds of A5 base `9d94f0936` vs A6 `bbf0e1d93` under `tools/gate/with-lock.sh both` (`18/18` rounds ≥75% host idle, median idle `87.2%` base / `87.4%` A6, load1 median `5.40` / `5.40`). Medians in ns/iteration and median `[q1, q3]` of per-round percent and absolute change ([data](general-runtime-a6-generality-darwin-arm64-v1.json)). Bold: interquartile range excludes zero.

| Kernel               | Node ns | Base ns |  A6 ns |  A6 − base (%), median [IQR] |      Δ ns, median [IQR] | A6 ÷ Node |
| -------------------- | ------: | ------: | -----: | ---------------------------: | ----------------------: | --------: |
| `allocateObjects`    |   5.660 |  93.925 | 91.616 |    **−2.07% [−3.91, −0.56]** | −1.938 [−3.685, −0.519] |     16.2× |
| `arguments3`         |   2.112 |  22.198 | 22.130 |    **−0.33% [−1.16, −0.04]** | −0.073 [−0.260, −0.009] |     10.5× |
| `arguments4`         |   2.095 |  27.167 | 27.198 |        +0.48% [−0.97, +1.36] | +0.130 [−0.266, +0.364] |     13.0× |
| `arguments5`         |   2.207 |  33.492 | 32.820 |    **−1.81% [−3.08, −0.98]** | −0.606 [−1.034, −0.327] |     14.9× |
| `arguments6`         |   2.385 |  40.554 | 40.453 |        −0.34% [−2.43, +1.20] | −0.137 [−1.008, +0.483] |     17.0× |
| `buildString`        |   8.432 |  11.400 | 11.248 |    **−1.01% [−2.00, −0.32]** | −0.114 [−0.229, −0.037] |      1.3× |
| `builtinMethod`      |   3.872 |  29.672 | 29.704 |        −1.19% [−2.41, +0.14] | −0.359 [−0.761, +0.040] |      7.7× |
| `catchInLoop`        |   3.198 |  19.196 | 19.260 |        −0.03% [−2.60, +2.61] | −0.005 [−0.509, +0.496] |      6.0× |
| `concatenateStrings` |   6.476 |  12.521 | 13.596 |    **+8.40% [+6.67, +9.47]** | +1.050 [+0.846, +1.176] |      2.1× |
| `mathMax`            |   2.043 |   8.535 |  8.499 |        −0.47% [−1.61, +0.03] | −0.040 [−0.139, +0.002] |      4.2× |
| `mixedCall`          |   3.440 |  13.937 | 14.662 |    **+5.27% [+3.95, +5.85]** | +0.741 [+0.557, +0.815] |      4.3× |
| `mutableCapture`     |   4.870 |  13.420 | 14.105 |    **+4.85% [+3.48, +5.96]** | +0.649 [+0.475, +0.797] |      2.9× |
| `numberCall`         |   1.911 |   6.428 |  6.411 |        −0.07% [−0.81, +0.65] | −0.004 [−0.052, +0.042] |      3.4× |
| `objectArray`        |   2.156 |  14.625 | 14.776 |        +0.85% [−0.33, +2.36] | +0.124 [−0.049, +0.343] |      6.9× |
| `objectRoundTrip`    |   2.087 |  15.679 | 15.649 |        −0.14% [−0.57, +0.55] | −0.022 [−0.090, +0.085] |      7.5× |
| `receivers2`         |   4.315 |  20.087 | 20.045 |        −0.43% [−1.19, +0.25] | −0.086 [−0.237, +0.050] |      4.6× |
| `receivers4`         |   4.336 |  20.313 | 21.017 |    **+3.45% [+1.19, +6.11]** | +0.697 [+0.246, +1.208] |      4.8× |
| `receivers8`         |   5.502 |  41.189 | 49.291 | **+19.09% [+18.33, +21.53]** | +7.912 [+7.548, +8.880] |      9.0× |

The `+19.09%` (`+7.91 ns`) increase on `receivers8` (and `+3.45%` on `receivers4`) is the direct trade-off of probing `cachedInheritedPropertyValue` on own non-method IC misses before calling `readCachedObjectValueProperty`: RayTrace's inherited field defaults (`info.isHit`, `material.*`) drop RayTrace by **−57.08%** (`−10.9 ms/op`), while megamorphic own-property sites (`receivers8`) execute an extra inherited probe on each inline miss. Guarding the inherited probe on `cache.inheritedCount > 0` (or unifying inherited data hits into `property-load`) eliminates that miss cost in follow-up work.

## Call and loop kernels

20 paired rounds of A5 base `9d94f0936` vs A6 `bbf0e1d93` under `tools/gate/with-lock.sh both` (`20/20` rounds ≥75% host idle, median idle `87.3%` base / `87.5%` A6, load1 median `3.75` / `3.75`; [data](general-runtime-a6-kernels-darwin-arm64-v1.json)). Seven of eight kernels are flat within `±1.3%`, `stringEquality` returns from `0.831` to `0.949 ns` (matching A4's `0.944 ns`, `0.4×` Node), and untyped Tint remains ahead of Node on all eight: `array` `1.514` vs `1.809` (`0.8×`), `closure` `2.340` vs `4.730` (`0.5×`), `control` `0.126` vs `3.826` (`0.03×`), `method` `2.394` vs `4.283` (`0.6×`), `property` `1.182` vs `1.815` (`0.7×`), `recursive` `114.542` vs `234.573` (`0.5×`), `rest` `0.811` vs `8.527` (`0.1×`), and `stringEquality` `0.949` vs `2.114` (`0.4×`) ns/iter.

## Frozen v7 self-compile

Built the frozen v7 compiler image with `--runtime-tree` at A6 (`bbf0e1d93`, `53,578,178` bytes). Every code, data, unwind, and debug-table Mach-O section is bit-for-bit identical to A5:

- `__TEXT,__text`: `30,770,496` bytes at file offset `4096`, SHA-256 `6e301d3b102bcd9b53d9c80d8b4d63835a5e26a02be8794d92a8bd7a62c6a2dd`
- `__TEXT,__eh_frame`: `270,352` bytes, SHA-256 `97f0554497dcf19f31bf80d9121e0a719652019f5083a9ab6b853360fa1e5b36`
- `__TEXT,__unwind_info`: `45,300` bytes, SHA-256 `c49f8447e316a326a9b5d3beb1db12d621d68b0a7dad6e52389ebb8c22d68943`
- `__DATA,__data`: `2,256` bytes, SHA-256 `4ad5a6cd559772eecc5ddffbf2b50b06c25e08b9922a572fcb1057fa6adbc5f5`

## Validation

- **Static & workspace unit gates** (`bbf0e1d93`, `env -u TZ`): `pnpm build`, `pnpm typecheck` (`pnpm build && tsc -p tsconfig.tests.json && tsc -p tsconfig.host.json`), `pnpm boundaries`, `pnpm format:check`, catalog freshness (`node tools/generate-compiler-catalog.ts` diff empty, `830` source files), `tools/check-test-files.ts concurrent` (**6,238 pass / 3 skipped / 0 fail**), `tools/gate-lock.test.ts` (**15/15 pass**), and `tools/check-test-files.ts memory` (**242/242 pass**).
- **Native general, script, and worker tests under LLDB** (`TZ=UTC`, verified twice each): `tools/native-general-elements.test.ts` (including new section 10 covering `Array.prototype.pop` edge cases, `new Array(n)` sequential fill, and 1- & 2-level nested speculative numeric loops with bounds/NaN/aliasing/deopt checks), `tools/native-general-intrinsics.test.ts`, `tools/native-general-numbers.test.ts`, `tools/native-general-property-caches.test.ts` (including new section 15 covering inherited non-method IC hits, prototype mutation, own shadowing, and megamorphic eviction), `tools/native-script-cases.test.ts` (`2/2` on `bbf0e1d93`, including new `directMethodSection` covering prototype methods, sloppy primitive `this` boxing, and `Function.prototype.call` forwarding/overrides), and `tools/native-worker-messages.test.ts` (`3/3`) — **9/9 pass**.
- **Hosted native LLDB fixtures** (`TZ=UTC`, verified twice each): all 15 hosted fixtures (`ordinary-objects`, `arguments`, `tail-dispatch`, `promise-objects`, `promise-intrinsics`, `generator-objects`, `async-generator-objects`, `async-functions`, `async-iteration`, `await`, `shadow-realm`, `dynamic-import`, `module-lowering`, `script-jobs`, `source-tail-steps`) pass (stopped at entry, exit status 42).
- **Darwin arm64 self-build fixpoint** (`bbf0e1d93`, `TZ=UTC`): stage 1 (`50,345,610` bytes) builds stage 2 from the same frozen source snapshot under LLDB asserting stopped-at-entry and exit status 0; `cmp stage1 stage2` is byte-identical (SHA-256 `cf00af660d767e3370cf7da26af10b0bc71785b47437d82fd2af6decf53d7c39`).
- **Linux x86-64 cross-bootstrap & native cross-emission fixpoint** (`bbf0e1d93`, `TZ=UTC`): Node-hosted `--target linux-x86_64` builds stage 1 cleanly (`196,601,800` bytes, SHA-256 `e1cabc2390e90fc4319123cceb775d910e197279faa5134ab71d6f3670ebedb5`), and native Darwin arm64 `stage1` running under LLDB (`./stage1 source x64-stage2 --target linux-x86_64`, inside the same 4 GiB / 96M-allocation self-host heap) emits `x64-stage2` (`exit status 0`) byte-for-byte identical to stage 1 (`cmp` exact match, SHA-256 `e1cabc2390e90fc4319123cceb775d910e197279faa5134ab71d6f3670ebedb5`).

## Next

- **Eliminate `receivers8` megamorphic inherited-probe overhead:** guard the non-method `cachedInheritedPropertyValue` miss probe on inherited-entry presence (or handle inherited data directly inside the `property-load` IR fast path) so megamorphic own-property sites go straight to the global stub cache.
- **Leaf script-entry prologue/epilogue & register actuals:** trim the 32-byte activation record and 6-register spill in leaf callees (`Box.prototype.get` `67` insns, `setState` `90` insns) to cut Richards/DeltaBlue/RayTrace call overhead without regressing closure capture layout.
- **Typed/specialized object field layouts & allocation inlining:** pair with Step 5a-3/5a-4 (`createArray0..4` / `createLiteralObject1..4`) and monomorphic constructor allocation specialization (`new Vector`, `new Color`, `new Ray`, `new Constraint`).
