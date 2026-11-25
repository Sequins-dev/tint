# General runtime step 5a-4 · loop element caching, module global caches, reducible `for` loops, and builtin hot paths · Darwin arm64

Step 5a-4 builds directly on [step 5a-3](general-runtime-step5a3-darwin-arm64-v1.md) (`36394a26d` / `07e14862f`) to eliminate remaining per-iteration overhead in packed element loops, `Math.*` / `Number` / `String.prototype` builtin calls, and `Map`/`Set` operations:

- **Module-level global identifier caching (`packages/js-engine/src/lowering/index.ts`):** modules without dynamic bindings now materialize `const $globalScope = createGlobalScope($global)` once at module initialization and route `Math`, `Number`, and other global identifier reads through `withGlobalIdentifierCache` (matching Script mode), eliminating repeated global property lookups inside `Math.floor`, `Math.sqrt`, `Math.max`, and `Number(...)` loops while preserving full dynamic-mutation invalidation (e.g. `globalThis.Math = ...`).
- **Flattened `ScriptMap` with Fibonacci hashing and direct exports (`packages/js-runtime/src/objects/{collection-data,intrinsic-functions,index}.ts`):** flattened `hasScriptMap`/`getScriptMap`/`setScriptMap`/`addScriptSet`/`deleteScriptMap` with inline `number`/`string` hot paths, cached `map.mask`, Fibonacci bucket mixing `(Math.imul(hash, 0x9e3779b1) >>> 0) & map.mask`, 0.5 max load factor, cold `insertScriptMapEntry`, and direct re-exports (`scriptMapGet`/`Has`/`Set`, `scriptSetAdd`) removing wrapper frames; `inlineIntrinsicCall` deduplicates `viewObjectValue(base)`/`internalExoticSlots` reads across `mapHas`/`setHas`.
- **Loop-invariant element storage caching (`element-storage` / `element-count`, IR opcodes 123/124, `packages/ir/src/optimization/element-cache.ts`):** new scalar IR operations and `cacheElementStorage` pass hoist up to 4 loop-invariant packed `Float64Array` `(storage, count)` pairs per innermost loop into the preheader and invalidate `count = 0` after cold calls, `property-store`s, or record-write terminators. AArch64 codegen (`packages/codegen/src/aarch64/scalar/index.ts`) uses `fjcvtzs` for index conversion/range validation, fuses `general-is(..., "number")` on element loads (`fusedNumberElement`), and takes an unboxed `wrappedNumberValues` fast path on `element-store`.
- **Reducible `for`/`while` loops, conditional number-shadow analysis, and guarded counted loops:**
  - `packages/js-engine/src/lowering/index.ts` drops the synthetic `$first` boolean flag for `while` and `continue`-free `for` loops (checked via `hasContinueTargetingLoop`), making JS `for` loops cleanly reducible so `cacheElementStorage` and `boundCountedLoops` apply.
  - `packages/ir/src/optimization/control-flow.ts` merges single-predecessor jump chains (`<= 64` instructions, excluding `record-read` and `record`/`record-cell` terminators) for functions with script operations (`hasScriptOperations`), followed by targeted `cleanupSelectedFunctions` and wrap/unwrap forwarding in `packages/ir/src/optimization/forward-loads.ts`.
  - `packages/ir/src/optimization/general-numbers.ts` upgrades number-shadow propagation to conditional forward must-analysis over `(reachable, known)` tracking candidate slots (including unshadowed merge temporaries) and proving Number on `element-load`/`element-length` + `absent` false edges.
  - `packages/ir/src/optimization/counted-loops.ts` recognizes `element-load`/`element-store`/bitwise index uses and loop-invariant boolean-guard headers, compacting unreachable blocks via `compactReachableBlocks` after guarded loop bounding.

At `7dbc33c40` against Step 5a-3 (`36394a26d`) and A3 (`bee1ba669`) over 16 rotated paired rounds on Apple M5 Max:

- **Warm-call instruction counts drop sharply on `Math.*` and `Map`/`Set`:** `mathFloor` `941 → 293` (−648, −68.9%, zero callees; 5.8× fewer than Step 5a-2), `setAddHas` `1,241 → 756` (−485, −39.1%), `mapSetHas` `1,217 → 776` (−441, −36.2%), and `callAdd` `737 → 730` (−0.9%), with all other probes steady.
- **`elements.ts` geomean improves another 1.76× beyond Step 5a-3 (`0.568×`, `0.093×` vs A3 — 10.8× faster than A3, `2.66×` vs Node 26):** `mathFloor` drops `26.6 → 6.95 ns` (**3.83×**), `mathSqrt` drops `27.8 → 7.30 ns` (**3.81×**), `setAddHas` drops `62.0 → 18.7 ns` (**3.32×**), `mapSetHas` drops `62.2 → 20.1 ns` (**3.10×**, `2.27×` Node), `numberElementWrite` drops `6.35 → 2.52 ns` (**2.51×**, only **`1.31×`** Node 26), `numberElementUpdate` drops `8.49 → 4.11 ns` (**2.07×**), `objectElementRead` drops `13.9 → 8.74 ns` (**1.60×**), `numberArrayLiteral` drops `46.5 → 39.2 ns` (−15.8%), and `numberElementRead` drops `6.88 → 6.16 ns` (−10.5%); `pushLength` ticks `19.8 → 21.6 ns` (+2.08 ns, still 41.6× faster than A3).
- **`generality` geomean improves another 29.3% beyond Step 5a-3 (`0.707×`, `0.505×` vs A3, `4.61×` vs Node 26) with zero regressions across all 18 kernels:** `numberCall` drops `26.8 → 6.59 ns` (**4.07×**), `mathMax` drops `26.6 → 7.58 ns` (**3.51×**), `mixedCall` drops `24.5 → 12.3 ns` (**1.98×**), `buildString` drops `13.8 → 7.05 ns` (**`0.70×` of Node 26's `10.13 ns`** — 30% faster than Node 26 on untyped JS), `builtinMethod` (`map.get`) drops `20.7 → 13.1 ns` (**1.58×**), `arguments4..6` drop 10.5–21.2%, `concatenateStrings` drops `14.9 → 12.3 ns` (−17.9%, `1.60×` Node), `objectArray` drops `16.3 → 13.5 ns` (−17.0%), `receivers2/4/8` drop 12.4–14.2%, `mutableCapture` drops `17.2 → 14.8 ns` (−13.7%), and `allocateObjects` drops `68.0 → 59.3 ns` (−12.8%).
- **Octane improves 8.1% geomean beyond Step 5a-3 (`0.919×`, `0.543×` vs A3):** **NavierStokes** drops **−16.7%** (`19.057 → 15.873 ms/op`, paired median **−2.52 ms** [IQR −3.68, −2.16], **4.55×** faster than A3's `72.228 ms/op`, `7.60×` vs Node 26), while **DeltaBlue** (`6.847 → 6.497 ms/op`), **RayTrace** (`28.001 → 26.640 ms/op`), and **Richards** (`2.567 → 2.431 ms/op`) all edge lower.
- **Frozen `v7 --runtime-tree`** remains byte-identical across every Mach-O section (`__TEXT,__text` `f34e866923d72f4e…`), arm64 `stage1 == stage2` fixpoint is byte-identical (`49,619,082` bytes), Linux x86-64 stage 1 cross-bootstrap passes (`193,026,056` bytes), all static/concurrent (`6,215/6,215`)/memory (`242/242`)/native LLDB checks pass, and native Test262 passes **6,239/6,240** (`3,514/3,514` + `2,725/2,726`, 0 failures, 1 expected unsupported module top-level-await variant).

Branch `perf/general-runtime-arrays`. Base A3 `bee1ba669`, prior milestone Step 5a-3 `36394a26d`, candidate `7dbc33c40`. Apple M5 Max, Node 26.13.1.

## Commits on top of Step 5a-3 (`07e14862f`)

| Commit      | Change                                                                                                                                                                                                                                                                                                                                                                     |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `7dbc33c40` | Module global identifier cache, flattened Fibonacci-hashed `ScriptMap`, `element-storage`/`element-count` IR opcodes (123/124) & `cacheElementStorage` pass, `fjcvtzs` + fused `general-is`/`wrappedNumberValues` AArch64 element fast paths, reducible `for` loop lowering, conditional `general-numbers` analysis, jump-chain merging, and guarded counted-loop headers. |

Script runtime surface remains unchanged at 180 functions / 207 entries, 133 anchors / 59 collections / 61 runtimes (`tools/script-runtime-surface.test.ts`). Compiler catalog updated to 831 files / 639 explicit import grants (`packages/ir/src/optimization/element-cache.ts`). `packages/foundation/` and call-path files (`scriptEntryGuard`, `argumentAt`, `packages/js-runtime/src/environments/global/scope.ts`) were not modified.

## Warm-call instruction traces

One warm call (the 501st), entry to return with callees, single-stepped under LLDB (`tools/general-call-bench/count_call.py`) on untyped debug-symbol images of Step 5a-3 (`36394a26d`) and Step 5a-4 (`7dbc33c40`):

| Probe (source)                                          | Step 5a-3 (`36394a26d`) | Step 5a-4 (`7dbc33c40`) | Δ vs Step 5a-3    |
| ------------------------------------------------------- | ----------------------: | ----------------------: | ----------------- |
| `makeEmpty()`: `return []`                              |                     257 |                     257 | 0 (+0.0%)         |
| `makeNumbers()`: `return [1, 2, 3, 4]`                  |                     491 |                     491 | 0 (+0.0%)         |
| `makeObjects(o)`: `return [o, o, o, o]`                 |                     729 |                     729 | 0 (+0.0%)         |
| `callAdd(list, i)`: `return list[i & 3].add(i & 7) + 0` |                     737 |                 **730** | **−7 (−0.9%)**    |
| `makePair(a, b)`: `return { left: a, right: b }`        |                     275 |                     275 | 0 (+0.0%)         |
| `makeTriple(a)`: `return { x: a, y: a, z: a }`          |                     274 |                     274 | 0 (+0.0%)         |
| `makeEmptyObject()`: `return {}`                        |                     201 |                     201 | 0 (+0.0%)         |
| `makeReceiver(n)`: `return { offset: n, add(v) { … } }` |                   7,985 |                   7,985 | 0 (+0.0%)         |
| `pushOne(a, v)`: `return a.push(v)`                     |                     572 |                     572 | 0 (+0.0%)         |
| `lenOf(a)`: `return a.length`                           |                     111 |                     111 | 0 (+0.0%)         |
| `mapSetHas(m, k, v)`: `m.set(k, v); return m.has(k)`    |                   1,217 |                 **776** | **−441 (−36.2%)** |
| `setAddHas(s, k)`: `s.add(k); return s.has(k)`          |                   1,241 |                 **756** | **−485 (−39.1%)** |
| `mathFloor(x)`: `return Math.floor(x)`                  |                     941 |                 **293** | **−648 (−68.9%)** |
| `charCode(s, i)`: `return s.charCodeAt(i)`              |                     234 |                     235 | +1 (+0.4%)        |

## Elements, builtins, and creation kernels

Sixteen rotated fresh-process rounds (4 engines × 4 full rotations: Node 26.13.1, A3 `bee1ba669`, Step 5a-3 `36394a26d`, Step 5a-4 `7dbc33c40`) under `tools/gate/with-lock.sh both` on Apple M5 Max (clean trees, `patchSha256` empty `e3b0c442…`; load1 median `5.03`, max `5.84`; idle median `74.8%`). Every native inferior reached its entry stop and exited 42. Paired deltas are per round against Step 5a-3 (`36394a26d`) and against A3 (`bee1ba669`) (median `[q1, q3]`); bold indicates the IQR excludes zero.

| Kernel                | Node ns |   A3 ns | Step 5a-3 ns | Step 5a-4 ns | Δ vs Step 5a-3, median [IQR] | Δ vs A3, median [IQR]       | Step 5a-4 ÷ Node |
| --------------------- | ------: | ------: | -----------: | -----------: | ---------------------------- | --------------------------- | ---------------: |
| `numberElementRead`   |   2.099 |  17.139 |        6.877 |        6.156 | **−0.746 [−1.01, −0.315]**   | **−11.0 [−12.7, −10.7]**    |            2.93× |
| `numberElementWrite`  |   1.930 |  26.879 |        6.345 |        2.524 | **−3.83 [−3.97, −3.55]**     | **−24.4 [−27.2, −23.9]**    |            1.31× |
| `numberElementUpdate` |   1.754 |  139.83 |        8.489 |        4.105 | **−4.39 [−4.81, −3.91]**     | **−135.7 [−152.1, −132.7]** |            2.34× |
| `objectElementRead`   |   1.850 |  14.763 |       13.944 |        8.736 | **−4.74 [−5.75, −4.00]**     | **−6.06 [−7.15, −5.66]**    |            4.72× |
| `numberArrayLiteral`  |   9.116 | 1,118.7 |       46.489 |       39.161 | **−7.55 [−10.1, −4.05]**     | **−1,080 [−1,180, −1,045]** |            4.30× |
| `objectArrayLiteral`  |   4.778 | 1,193.0 |       40.195 |       40.146 | −0.811 [−3.93, +2.26]        | **−1,154 [−1,289, −1,131]** |            8.40× |
| `objectLiteral`*      |   5.832 |   1.288 |        1.286 |        1.260 | −0.001 [−0.070, +0.010]      | −0.029 [−0.083, +0.008]     |            0.22× |
| `pushLength`          |   4.594 |  900.37 |       19.838 |       21.626 | **+2.08 [+1.24, +3.09]**     | **−878.4 [−982.0, −838.4]** |            4.71× |
| `charCodeAt`          |   2.195 |  135.71 |        9.550 |        9.411 | +0.314 [−0.788, +0.583]      | **−126.2 [−135.4, −121.9]** |            4.29× |
| `mathFloor`           |   2.245 |  117.65 |       26.646 |        6.951 | **−19.5 [−21.5, −17.9]**     | **−111.1 [−117.8, −106.4]** |            3.10× |
| `mathSqrt`            |   2.565 |  116.32 |       27.838 |        7.303 | **−20.3 [−23.0, −17.7]**     | **−109.3 [−118.2, −106.1]** |            2.85× |
| `mapSetHas`           |   8.857 |  201.50 |       62.182 |       20.089 | **−41.4 [−45.8, −39.2]**     | **−182.1 [−195.8, −176.3]** |            2.27× |
| `setAddHas`           |   7.442 |  196.95 |       62.000 |       18.684 | **−42.8 [−46.9, −40.9]**     | **−178.8 [−198.2, −172.5]** |            2.51× |
| **Geomean**           |       — |       — |            — |            — | **0.568×** (−43.2%)          | **0.093×** (−90.7%)         |            2.66× |

\* `objectLiteral` is a non-escaping numeric object literal specialized to a typed record on all three builds (`0.22×` Node). Escaping JS object literals are measured by `allocateObjects` in `generality` below.

[Paired rounds](general-runtime-step5a4-elements-darwin-arm64-v1.json)

## Generality kernels

Sixteen rotated fresh-process rounds (Node 26.13.1, A3 `bee1ba669`, Step 5a-3 `36394a26d`, Step 5a-4 `7dbc33c40`) under `tools/gate/with-lock.sh both` on Apple M5 Max (clean trees, `patchSha256` empty `e3b0c442…`; load1 median `5.12`, max `5.50`; idle median `75.1%`). Every native inferior reached its entry stop and exited 42.

| Kernel               | Node ns |  A3 ns | Step 5a-3 ns | Step 5a-4 ns | Δ vs Step 5a-3, median [IQR] | Δ vs A3, median [IQR]       | Step 5a-4 ÷ Node |
| -------------------- | ------: | -----: | -----------: | -----------: | ---------------------------- | --------------------------- | ---------------: |
| `numberCall`         |   2.374 | 105.43 |       26.809 |        6.590 | **−20.2 [−21.9, −19.2]**     | **−98.7 [−107.5, −94.7]**   |            2.78× |
| `mathMax`            |   2.315 | 144.45 |       26.577 |        7.576 | **−19.2 [−21.7, −17.9]**     | **−137.1 [−148.0, −131.6]** |            3.27× |
| `mixedCall`          |   3.961 | 23.454 |       24.451 |       12.332 | **−11.8 [−13.2, −11.0]**     | **−10.8 [−14.1, −10.2]**    |            3.11× |
| `buildString`        |  10.130 | 20.594 |       13.764 |        7.053 | **−6.73 [−7.45, −5.94]**     | **−13.2 [−15.1, −11.8]**    |            0.70× |
| `builtinMethod`      |   5.005 | 91.974 |       20.669 |       13.095 | **−7.76 [−8.48, −7.10]**     | **−78.6 [−85.7, −73.7]**    |            2.62× |
| `arguments6`         |   2.842 | 47.016 |       47.638 |       37.519 | **−10.4 [−11.8, −7.13]**     | **−8.91 [−11.6, −6.23]**    |           13.20× |
| `concatenateStrings` |   7.651 | 15.021 |       14.929 |       12.250 | **−2.71 [−4.07, −2.39]**     | **−2.98 [−4.44, −1.93]**    |            1.60× |
| `objectArray`        |   2.545 | 17.473 |       16.256 |       13.489 | **−2.31 [−3.67, −1.41]**     | **−3.86 [−5.92, −2.60]**    |            5.30× |
| `arguments5`         |   2.692 | 38.645 |       38.390 |       32.492 | **−5.16 [−7.08, −3.18]**     | **−5.07 [−8.10, −2.56]**    |           12.07× |
| `receivers2`         |   4.986 | 26.756 |       24.723 |       21.216 | **−3.69 [−4.74, −2.63]**     | **−4.98 [−7.51, −3.00]**    |            4.26× |
| `mutableCapture`     |   6.314 | 17.538 |       17.189 |       14.836 | **−2.03 [−2.79, −1.07]**     | **−2.36 [−4.12, −1.43]**    |            2.35× |
| `allocateObjects`    |   6.624 | 149.65 |       67.995 |       59.303 | **−10.2 [−13.4, −2.53]**     | **−89.1 [−97.5, −84.3]**    |            8.95× |
| `receivers8`         |   6.530 | 49.181 |       45.046 |       39.439 | **−6.01 [−7.91, −2.83]**     | **−9.74 [−17.7, −7.57]**    |            6.04× |
| `receivers4`         |   5.131 | 27.677 |       25.399 |       22.243 | **−3.52 [−5.01, −2.53]**     | **−5.62 [−7.79, −3.99]**    |            4.33× |
| `arguments4`         |   2.569 | 31.294 |       31.879 |       28.532 | **−3.06 [−5.70, −1.16]**     | **−2.47 [−4.59, −0.849]**   |           11.11× |
| `arguments3`         |   2.426 | 25.902 |       25.931 |       23.906 | −2.03 [−2.62, +0.083]        | **−1.52 [−2.61, −0.828]**   |            9.86× |
| `objectRoundTrip`    |   2.387 | 20.164 |       19.498 |       18.227 | **−1.34 [−2.08, −0.544]**    | **−1.74 [−4.53, −0.805]**   |            7.64× |
| `catchInLoop`        |   3.581 | 23.207 |       23.070 |       22.861 | −0.180 [−1.42, +1.50]        | −0.374 [−2.54, +0.743]      |            6.38× |
| **Geomean**          |       — |      — |            — |            — | **0.707×** (−29.3%)          | **0.505×** (−49.5%)         |            4.61× |

[Paired rounds](general-runtime-step5a4-generality-darwin-arm64-v1.json)

## Octane against Node 26.13.1

Sixteen rotated fresh-process rounds (Node 26.13.1, A3 `bee1ba669`, Step 5a-3 `36394a26d`, Step 5a-4 `7dbc33c40`) under `tools/gate/with-lock.sh both` on Apple M5 Max (clean trees, `patchSha256` empty `e3b0c442…`; load1 median `5.08`, max `6.04`; idle median `74.8%`). Every native inferior reached its entry stop and exited 42.

| Program        | Node ms/op | A3 ms/op | Step 5a-3 ms/op | Step 5a-4 ms/op | Δ vs Step 5a-3, median [IQR] | Δ vs A3, median [IQR]     | Step 5a-4 ÷ Node |
| -------------- | ---------: | -------: | --------------: | --------------: | ---------------------------- | ------------------------- | ---------------: |
| `Richards`     |      0.051 |    2.445 |           2.567 |           2.431 | −0.036 [−0.113, +0.067]      | +0.016 [−0.173, +0.124]   |           47.23× |
| `DeltaBlue`    |      0.073 |   14.171 |           6.847 |           6.497 | −0.122 [−0.444, +0.130]      | **−6.94 [−8.39, −6.37]**  |           89.14× |
| `NavierStokes` |      2.089 |   72.228 |          19.057 |          15.873 | **−2.52 [−3.68, −2.16]**     | **−56.0 [−64.0, −51.9]**  |            7.60× |
| `RayTrace`     |      0.582 |   30.798 |          28.001 |          26.640 | −0.361 [−3.20, +0.730]       | **−3.68 [−7.46, −0.606]** |           45.75× |
| **Geomean**    |          — |        — |               — |               — | **0.919×** (−8.1%)           | **0.543×** (−45.7%)       |           34.78× |

[Paired rounds](general-runtime-step5a4-octane-darwin-arm64-v1.json)

## Frozen v7 self-compile

Frozen `v7` with `--runtime-tree`, comparing A3 (`bee1ba669`) and Step 5a-4 (`7dbc33c40`): both images are `53,413,554` bytes and every Mach-O code and data section is bit-for-bit identical:

- `__TEXT,__text`: `30,702,976` bytes, SHA-256 `f34e866923d72f4e…`
- `__TEXT,__eh_frame`: `270,680` bytes, SHA-256 `5a6370012f45f338…`
- `__TEXT,__unwind_info`: `45,300` bytes, SHA-256 `9ce2a20b156a28bc…`
- `__DATA,__data`: `2,256` bytes, SHA-256 `4ad5a6cd559772ee…`

## Validation

- **Static checks** (`7dbc33c40`): `pnpm build`, `tsc --noEmit -p tsconfig.tests.json`, `tsc --noEmit -p tsconfig.host.json`, `pnpm boundaries`, `node tools/generate-compiler-catalog.ts` (831 files, 639 explicit import grants), and `pnpm format:check` all pass.
- **Workspace unit tests** (`7dbc33c40`):
  - `packages/ir/test/optimization-element-cache.test.ts` (new, registered in `tools/check-test-files.json` `concurrent`), `packages/ir/test/optimization-general-numbers.test.ts`, `packages/ir/test/scalar-verifier.test.ts`, `packages/ir/test/function-store.test.ts`, `packages/ir/test/optimization-index.test.ts`, `packages/compiler/test/native-index.test.ts`, `packages/js-engine/test/module-async-lowering.test.ts`, `packages/js-runtime/test/ordinary-object-arrays.test.ts`, and `tools/selfhost-linked.test.ts` all pass.
  - `check-concurrent`: **6,215/6,215 pass**, 0 fail (3 skipped).
  - `check-memory`: **242/242 pass**, 0 fail (including `tools/script-runtime-surface.test.ts` 1/1 and `tools/test262-dynamic-import-host.test.ts` 15/15).
- **Native general fixtures under LLDB** (`TZ=UTC`, verified twice each):
  - `tools/native-general-elements.test.ts` (10 sections including `cachedLoops`: mid-loop shrink/unpack/freeze invalidation and unlabelled/labelled/nested `continue` `for` loops)
  - `tools/native-general-intrinsics.test.ts` (including mid-loop module-level `globalThis.Math` replacement invalidation)
  - `tools/native-general-numbers.test.ts`
  - `tools/native-general-property-caches.test.ts`
  - `tools/native-script-cases.test.ts` (2/2)
- **Darwin arm64 self-build fixpoint** (`7dbc33c40`): stage 1 (`49,619,082` bytes) builds stage 2 from the same frozen source tree under LLDB asserting stopped-at-entry (`eStateStopped`) and exit status 0 (`eStateExited`); `cmp stage1 stage2` is byte-identical (SHA-256 `14d13b4ad870d50db67c9a22fd331fb838473ba0936e1b0cdbbb37210c1e349b`).
- **Linux x86-64 stage 1 cross-bootstrap** (`7dbc33c40`): passes (`193,026,056` bytes, SHA-256 `f5df1531d420a807c7402a58d3f415171a766fa60e24537bfd691827df804c9e`).

## Test262

Two explicit native selections run at Step 5a-4 (`7dbc33c40`; source snapshot `9787fb9facc14aa5…` [831 files], frozen toolchain `a6a5da1fbdb1d565…`, suite linking, `TZ=UTC`, `NODE_OPTIONS="--max-old-space-size=16384"`, `dirty: false`, `complete: true`), totaling **6,239/6,240 pass**, 0 failures, 0 timeouts, 0 crashes, 0 harness errors, and 1 expected unsupported module top-level-await variant:

1. **Step 5a selection (`3,514/3,514 pass`, 0 failures, 0 unsupported):** covers compound, logical, and update assignment, property accessors, `built-ins/Math`, `built-ins/Number`, `String.prototype.{charAt,charCodeAt}`, `Map.prototype.{get,set,has}`, `Set.prototype.{add,has}`, `Array` `length` and `prototype/{push,pop,shift,unshift,splice,fill,reverse,join}`, and `TypedArrayConstructors/internals/{Get,Set}`. [Report](test262-general-runtime-step5a4-native-v1.json)
2. **Array/object literal and rest-parameter selection (`2,725/2,726 pass`, 0 failures, 1 unsupported):** covers `language/expressions/array` (104/104), `language/expressions/object` (2,251/2,252 — the single unsupported variant is `cpn-obj-lit-computed-property-name-from-await-expression.js [module]`, `native module execution is not implemented`), `language/rest-parameters` (22/22), `built-ins/Array/{from,of}` (90/90, 32/32), `built-ins/Object/{keys,values,entries}` (118/118, 40/40, 42/42), and `built-ins/Reflect/ownKeys` (26/26). [Report](test262-general-runtime-step5a4-extra-native-v1.json)

| Selection                                                                                  | Variants |  Pass | Fail | Unsupported |
| ------------------------------------------------------------------------------------------ | -------: | ----: | ---: | ----------: |
| `language/expressions/compound-assignment`                                                 |      786 |   786 |    0 |           0 |
| `language/expressions/logical-assignment`                                                  |      132 |   132 |    0 |           0 |
| `language/expressions/{postfix,prefix}-{increment,decrement}`                              |      246 |   246 |    0 |           0 |
| `language/expressions/property-accessors`                                                  |       42 |    42 |    0 |           0 |
| `built-ins/Math`                                                                           |      654 |   654 |    0 |           0 |
| `built-ins/Number`                                                                         |      680 |   680 |    0 |           0 |
| `built-ins/String/prototype/{charAt,charCodeAt}`                                           |      110 |   110 |    0 |           0 |
| `built-ins/Map/prototype/{get,set,has}`                                                    |       72 |    72 |    0 |           0 |
| `built-ins/Set/prototype/{add,has}`                                                        |      102 |   102 |    0 |           0 |
| `built-ins/Array/length` and `prototype/{push,pop,shift,unshift,splice,fill,reverse,join}` |      528 |   528 |    0 |           0 |
| `built-ins/TypedArrayConstructors/internals/{Get,Set}`                                     |      162 |   162 |    0 |           0 |
| `language/expressions/array`                                                               |      104 |   104 |    0 |           0 |
| `language/expressions/object`                                                              |    2,252 | 2,251 |    0 |           1 |
| `language/rest-parameters`                                                                 |       22 |    22 |    0 |           0 |
| `built-ins/Array/{from,of}`                                                                |      122 |   122 |    0 |           0 |
| `built-ins/Object/{keys,values,entries}` and `Reflect/ownKeys`                             |      226 |   226 |    0 |           0 |
