# General runtime step 5a-5 · rebase onto A5, witness-free element loops, integer element indices, outermost element caching, accumulator shadowing, and typed `ScriptMap` keys · Darwin arm64

Step 5a-5 rebases `perf/general-runtime-arrays` onto [A5](general-runtime-a5-darwin-arm64-v1.md) (`9d94f0936`) — bringing together A5's global cells, deep/spilled/inherited property ICs, `script-entry` outlining, and `call-indirect` specialization with [Step 5a-4](general-runtime-step5a4-darwin-arm64-v1.md) (`7dbc33c40` → rebased `3f7162dd6`) — and eliminates the remaining per-iteration overhead in packed element loops, `NavierStokes`, `Math.*` / `String.prototype` / `Array.prototype.push` builtins, and `Map`/`Set` hot paths:

- **Witness-free element access and 1-argument `viewTypeofObject` lowering (`packages/js-runtime/src/objects/{element-access,array-append,intrinsic-functions}.ts`, `packages/ts-native/src/closure/lowering/index.ts`, `packages/js-engine/src/lowering/{index,runtime-imports}.ts`):**
  - `packedNumberElement`, `storePackedNumberElement`, `packedArrayLength`, and `absentElementValue` now take `$errors` directly instead of reading `$errors.objectPrototype` on every access (`−8` instructions per element access), and dead `arrayPushEpoch` increments are removed from `appendPackedElement` / `arrayPush`.
  - Replaced all five `viewObjectValue(x, $errors.objectPrototype)` call sites (`packedGeneralCell`, `inlineIntrinsicCall` callee and receiver checks, `new` return check, and sloppy receiver check) with 1-argument `viewTypeofObject(x)`, keeping `scriptRuntimeSurface` at exactly 182 functions / 209 entries while removing `$errors.objectPrototype` witness loads across `objectElementRead`, `Math.{floor,sqrt,max}`, `charCodeAt`, `pushLength`, `Map`/`Set` intrinsics, and calls.
  - Fixed `packedGeneralCell` and `readComputedProperty` index validation from `key === index` (a 28-instruction boxed dynamic equality dispatch) to `typeof key === "number" && key === index`, compiling to a single typed integer compare on `objectElementRead` and `objectArray`.
- **Integer `element-count`, integer `general-wrap`, and generalized `property-fusion` (`packages/ir/src/optimization/{bounds,index}.ts`, `packages/codegen/src/aarch64/scalar/index.ts`, `packages/codegen/src/scalar/property-fusion.ts`):**
  - Added `[0, 4294967295]` interval tracking for `element-count` and marked `element-load`/`element-store` `index` and `cachedCount` operands bounds-relevant; AArch64 scalar codegen keeps `element-count` in integer registers (converting once in the preheader via `fcvtzu` and comparing via `cmp x_idx, x_cnt` in the hot loop) and adds `element-load`, `element-store`, and script-scoped `general-wrap` to `findIntegerUses()`, eliminating `scvtf + fmov + fcvtzs` round-trips on bitwise loop indices such as `i & 1023`.
  - Generalized `property-fusion` `general-is(..., "absent")` matching across trailing shadow stores so fused `element-load` miss branches stay intact alongside number-shadow writes.
- **Outermost-loop `element-cache` with reachability-based invalidation checks and `general-numbers` accumulator/merge-temp shadowing (`packages/ir/src/optimization/{element-cache,general-numbers}.ts`):**
  - `cacheElementStorage` (gated on `hasScriptOperations(fn)` for zero impact on typed AOT builds) now hoists loop-invariant packed `Float64Array` `(storage, count)` pairs to the outermost valid enclosing loop weighted by loop depth. Reachability-based `hasCleanIteration` rejects any loop where no path from header to latch avoids invalidating blocks — including lowered JS call diamonds (`if (entry) call-indirect else call` such as `set_bnd` in `NavierStokes` `lin_solve`/`lin_solve2`) — so arrays hoist cleanly into the `j`-loop preheader instead of above the `k`-loop.
  - `shadowGeneralNumbers` now materializes proven script loads from the number shadow (`load(payload); general-wrap`) so hot-path general-slot stores become dead, counts `element-store` value loads in shadow benefits (unlocking unboxed `wrappedNumberValues` stores in `NavierStokes`), and propagates `copyEdges` to a fixpoint with loop multiplier `12` so `sum += elem` merge temporaries stay shadowed, breaking the 18-cycle GP↔FP boxing dependency chain on `numberElementRead`.
- **Typed `ScriptMapEntry.numberKey`, cold-path splitting, and packed-array fast path (`packages/js-runtime/src/objects/{collection-data,array-like,coercion}.ts`):**
  - Added a typed `numberKey: number` field on `ScriptMapEntry` and split `*Slow` paths out of `hasScriptMap`, `getScriptMap`, `setScriptMap`, and `addScriptSet`.
  - Split `createGeneralArray1..4` out of `createArray1..4` (keeping numeric array literal creation compact) and added a packed numeric/general array fast path at the top of `readObjectValuePropertyKey`.

At `beaa3eef0` against pre-rebase Step 5a-4 (`7dbc33c40`) and rebased A5+5a-4 (`3f7162dd6`) over 16 rotated paired rounds on Apple M5 Max:

- **Warm-call instruction counts drop 12.7% to 31.1% across every hot call, element, builtin, and collection probe:** `mathFloor` `293 → 202` (−91, −31.1%, 0 callees), `lenOf` `111 → 82` (−29, −26.1%), `callAdd` `730 → 558` (−172, −23.6%), `pushOne` `572 → 454` (−118, −20.6%), `charCode` `235 → 195` (−40, −17.0%), `mapSetHas` `776 → 668` (−108, −13.9%), and `setAddHas` `756 → 660` (−96, −12.7%).
- **`elements.ts` geomean improves 22.0% over A5+5a-4 (`0.780×`, `0.851×` vs pre-rebase Step 5a-4, `2.32×` vs Node 26):** `numberElementWrite` drops `2.605 → 1.316 ns` (**`0.74×` of Node 26's `1.774 ns`** — 26% faster than Node 26 on untyped JS), `numberElementRead` drops `5.553 → 2.279 ns` (**2.44×** faster, **`1.16×` Node 26**), `numberElementUpdate` drops `4.355 → 2.103 ns` (**2.07×** faster, **`1.34×` Node 26**), `mathSqrt` drops `5.475 → 4.178 ns` (−23.7%, `1.90×` Node), `objectElementRead` drops `8.728 → 7.415 ns` (−15.0%), `charCodeAt` drops `7.792 → 6.782 ns` (−13.0%), `setAddHas` drops `17.324 → 15.098 ns` (−12.9%, `2.17×` Node), `pushLength` drops `17.181 → 15.823 ns` (−7.9%, −20.7% vs Step 5a-4), `numberArrayLiteral` drops `36.120 → 33.800 ns` (−6.4%), `mapSetHas` drops `19.013 → 18.115 ns` (−4.7%, `2.23×` Node), and `mathFloor` drops `5.541 → 5.289 ns` (−4.5%); `objectArrayLiteral` ticks `+1.73 ns` (`37.412 → 39.005 ns`) from cold-splitting `createGeneralArray4`.
- **`generality` geomean improves 9.9% over A5+5a-4 (`0.901×`, `0.854×` vs Step 5a-4, `4.37×` vs Node 26) with 17/18 kernels faster and zero regressions:** `numberCall` `5.645 → 4.413 ns` (−21.8%, `2.40×` Node), `receivers4` `18.163 → 15.062 ns` (−17.1%), `receivers2` `17.647 → 14.709 ns` (−16.6%), `mathMax` `6.776 → 5.778 ns` (−14.7%), `builtinMethod` (`map.get`) `11.990 → 10.227 ns` (−14.7%, `2.60×` Node), `objectArray` `13.475 → 11.555 ns` (−14.2%), `arguments3..6` −8.1% to −11.6%, `receivers8` `37.296 → 34.356 ns` (−7.9%, erasing A5's megamorphic regression), `allocateObjects` `50.390 → 46.917 ns` (−6.9%, −13.5% vs Step 5a-4), and `buildString` `6.546 → 6.187 ns` (**`0.74×` of Node 26's `8.321 ns`** — 26% faster than Node 26).
- **Octane improves 1.7% geomean over A5+5a-4 (`0.983×`, `0.757×` / −24.3% vs pre-rebase Step 5a-4, `27.55×` vs Node 26):** **Richards** drops `1.443 → 1.383 ms/op` (−4.2% vs A5+5a-4, −38.6% vs Step 5a-4), **DeltaBlue** drops `4.518 → 4.413 ms/op` (−2.3% vs A5+5a-4, −26.6% vs Step 5a-4), and **NavierStokes** drops `14.637 → 14.279 ms/op` (−2.4% vs A5+5a-4, **`7.80×` vs Node 26**), while **RayTrace** moves `17.216 → 17.592 ms/op` (+0.318 ms vs A5+5a-4, still −25.7% vs Step 5a-4's `23.687 ms/op`).
- **Frozen `v7 --runtime-tree`** is 100% bit-for-bit identical to A5 (`9d94f0936`) across every Mach-O code, data, and unwind section (`53,578,178` bytes, `__TEXT,__text` `6e301d3b102bcd9b…`), Darwin arm64 `stage1 == stage2` fixpoint is byte-identical (`51,484,938` bytes), Linux x86-64 stage 1 cross-bootstrap passes (`201,700,808` bytes), all static/concurrent (`6,247/6,247`)/memory (`242/242`)/native LLDB (`6/6`) gates pass, and native Test262 passes **6,239/6,240** (`3,514/3,514` + `2,725/2,726`, 0 failures, 1 expected unsupported module top-level-await variant).

Branch `perf/general-runtime-arrays`. Base A5 `9d94f0936`, pre-rebase Step 5a-4 `7dbc33c40`, rebased A5+5a-4 `3f7162dd6`, candidate `beaa3eef0`. Apple M5 Max, Node 26.13.1.

## Commits on top of A5 (`9d94f0936`)

| Commit      | Change                                                                                                                                                                                                                                                                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `aeaf88bf0` | Step 5a-3: fixed-arity array/object literals, inline `Array.length`/`push`, and builtin hot paths (rebased onto A5).                                                                                                                                                                                                                              |
| `f8453b0ba` | Step 5a-3: deleted `push` and live `Map` iteration checks in native fixtures (rebased onto A5).                                                                                                                                                                                                                                                   |
| `1f247daca` | Report step 5a-3 (rebased onto A5).                                                                                                                                                                                                                                                                                                               |
| `375ca840f` | Step 5a-4: loop element caching (`element-storage`/`element-count`), flattened Fibonacci-hashed `ScriptMap`, reducible `for` loops, and conditional `general-numbers` analysis (rebased onto A5).                                                                                                                                                 |
| `3f7162dd6` | Report step 5a-4 (rebased onto A5; A5+5a-4 benchmark baseline).                                                                                                                                                                                                                                                                                   |
| `beaa3eef0` | Step 5a-5: witness-free element access, `viewTypeofObject`, typed numeric index compare in `packedGeneralCell`/`readComputedProperty`, int64 `element-count`/`general-wrap`, outermost `element-cache` with reachability invalidation checks, fixpoint `general-numbers` merge-temp shadowing, typed `ScriptMapEntry.numberKey`, and cold splits. |

Script runtime surface remains at 182 functions / 209 entries (`tools/script-runtime-surface.test.ts`, matching A5+5a-4; `viewTypeofObject` replaces `viewObjectValue`). Compiler catalog stays at 831 files / 639 explicit import grants. `packages/foundation/` was not modified, and A6 scope (speculative call/method inlining) was not touched.

## Warm-call instruction traces

One warm call (the 501st), entry to return with callees, single-stepped under LLDB (`tools/general-call-bench/count_call.py`) on untyped debug-symbol images of Step 5a-4 (`7dbc33c40`) and Step 5a-5 (`beaa3eef0`):

| Probe (source)                                          | Step 5a-4 (`7dbc33c40`) | Step 5a-5 (`beaa3eef0`) | Δ vs Step 5a-4    |
| ------------------------------------------------------- | ----------------------: | ----------------------: | ----------------- |
| `makeEmpty()`: `return []`                              |                     257 |                     272 | +15 (+5.8%)       |
| `makeNumbers()`: `return [1, 2, 3, 4]`                  |                     491 |                     510 | +19 (+3.9%)       |
| `makeObjects(o)`: `return [o, o, o, o]`                 |                     729 |                     822 | +93 (+12.8%)      |
| `callAdd(list, i)`: `return list[i & 3].add(i & 7) + 0` |                     730 |                 **558** | **−172 (−23.6%)** |
| `makePair(a, b)`: `return { left: a, right: b }`        |                     275 |                     267 | −8 (−2.9%)        |
| `makeTriple(a)`: `return { x: a, y: a, z: a }`          |                     274 |                     269 | −5 (−1.8%)        |
| `makeEmptyObject()`: `return {}`                        |                     201 |                     196 | −5 (−2.5%)        |
| `makeReceiver(n)`: `return { offset: n, add(v) { … } }` |                   7,985 |                   8,046 | +61 (+0.8%)       |
| `pushOne(a, v)`: `return a.push(v)`                     |                     572 |                 **454** | **−118 (−20.6%)** |
| `lenOf(a)`: `return a.length`                           |                     111 |                  **82** | **−29 (−26.1%)**  |
| `mapSetHas(m, k, v)`: `m.set(k, v); return m.has(k)`    |                     776 |                 **668** | **−108 (−13.9%)** |
| `setAddHas(s, k)`: `s.add(k); return s.has(k)`          |                     756 |                 **660** | **−96 (−12.7%)**  |
| `mathFloor(x)`: `return Math.floor(x)`                  |                     293 |                 **202** | **−91 (−31.1%)**  |
| `charCode(s, i)`: `return s.charCodeAt(i)`              |                     235 |                 **195** | **−40 (−17.0%)**  |

Per-symbol breakdown notes:

- `callAdd` (`730 → 558`, `−172`): caller drops `575 → 421` (`−154` from A5 `script-entry`/`call-indirect` specialization plus Step 5a-5 `viewTypeofObject` and typed numeric `key === index` in `packedGeneralCell`), and callee `add` drops `155 → 137` (`−18`).
- `pushOne` (`572 → 454`, `−118`): caller drops `296 → 191` (`−105` from A5 direct inherited `Array.prototype.push` + `viewTypeofObject`), and `appendPackedElement` drops `276 → 263` (`−13` from removing dead `arrayPushEpoch`).
- `mapSetHas` (`776 → 668`, `−108`) and `setAddHas` (`756 → 660`, `−96`): `hasScriptMap` drops `160 → 111` (`−49`), `setScriptMap` drops `179 → 142` (`−37`), `addScriptSet` drops `153 → 116` (`−37`), and callers drop `−22`/`−10` from `viewTypeofObject`.
- `makeEmpty` (`+15`) and `makeNumbers` (`+19`) reflect A5's `+18`-instruction `arrayEmptyShape`/`internalArrayChildShape` check in `packRealmArray` (`101 → 119`), which enables `pushOne`'s direct inherited IC hit; `makeObjects` (`+93`) additionally reflects `createArray4` delegating to cold-split `createGeneralArray4`.

## Elements, builtins, and creation kernels

Sixteen rotated fresh-process rounds (4 engines × 4 full rotations: Node 26.13.1, Step 5a-4 `7dbc33c40`, A5+5a-4 `3f7162dd6`, Step 5a-5 `beaa3eef0`) under `tools/gate/with-lock.sh both` on Apple M5 Max (clean trees, `patchSha256` empty `e3b0c442…`; load1 median `3.41`, max `4.93`; idle median `89.0%`). Every native inferior reached its entry stop and exited 42. Paired deltas are per round against A5+5a-4 (`3f7162dd6`) and against pre-rebase Step 5a-4 (`7dbc33c40`) (median `[q1, q3]`); bold indicates the IQR excludes zero.

| Kernel                | Node ns | Step 5a-4 ns | A5+5a-4 ns | Step 5a-5 ns | Δ vs A5+5a-4, median [IQR]  | Δ vs Step 5a-4, median [IQR] | Step 5a-5 ÷ Node |
| --------------------- | ------: | -----------: | ---------: | -----------: | --------------------------- | ---------------------------- | ---------------: |
| `charCodeAt`          |   2.035 |        8.828 |      7.792 |        6.782 | **−1.02 [−1.09, −0.932]**   | **−2.03 [−2.21, −1.81]**     |            3.33× |
| `mapSetHas`           |   8.110 |       18.860 |     19.013 |       18.115 | **−0.939 [−1.32, −0.581]**  | **−0.840 [−1.06, −0.640]**   |            2.23× |
| `mathFloor`           |   2.111 |        6.234 |      5.541 |        5.289 | **−0.222 [−0.271, −0.171]** | **−0.892 [−0.978, −0.808]**  |            2.50× |
| `mathSqrt`            |   2.194 |        6.641 |      5.475 |        4.178 | **−1.30 [−1.33, −1.27]**    | **−2.44 [−2.52, −2.38]**     |            1.90× |
| `numberArrayLiteral`  |   7.827 |       33.713 |     36.120 |       33.800 | **−2.50 [−3.52, −0.967]**   | −0.020 [−1.15, +1.25]        |            4.32× |
| `numberElementRead`   |   1.973 |        5.671 |      5.553 |        2.279 | **−3.28 [−3.32, −3.26]**    | **−3.39 [−3.49, −3.35]**     |            1.16× |
| `numberElementUpdate` |   1.565 |        3.771 |      4.355 |        2.103 | **−2.26 [−2.27, −2.23]**    | **−1.66 [−1.73, −1.63]**     |            1.34× |
| `numberElementWrite`  |   1.774 |        2.316 |      2.605 |        1.316 | **−1.28 [−1.30, −1.26]**    | **−0.993 [−1.01, −0.978]**   |            0.74× |
| `objectArrayLiteral`  |   3.820 |       36.337 |     37.412 |       39.005 | **+1.73 [+0.983, +2.96]**   | **+2.81 [+2.09, +3.08]**     |           10.21× |
| `objectElementRead`   |   1.721 |        7.948 |      8.728 |        7.415 | **−1.33 [−1.52, −1.25]**    | **−0.545 [−0.815, −0.395]**  |            4.31× |
| `objectLiteral`*      |   4.898 |        1.191 |      4.239 |        4.196 | −0.033 [−0.117, +0.008]     | **+2.99 [+2.95, +3.04]**     |            0.86× |
| `pushLength`          |   4.136 |       19.962 |     17.181 |       15.823 | **−1.43 [−1.52, −1.15]**    | **−4.11 [−4.30, −3.84]**     |            3.83× |
| `setAddHas`           |   6.952 |       17.183 |     17.324 |       15.098 | **−2.13 [−2.41, −2.04]**    | **−2.06 [−2.19, −1.97]**     |            2.17× |
| **Geomean**           |       — |            — |          — |            — | **0.780×** (−22.0%)         | **0.851×** (−14.9%)          |            2.32× |

\* `objectLiteral` shifted from `1.191` to `4.239 ns` in A5 (`3f7162dd6`) and is flat in Step 5a-5 (`4.196 ns`, still `0.86×` Node 26). Escaping JS object literals are measured by `allocateObjects` in `generality` below.

[Paired rounds](general-runtime-step5a5-elements-darwin-arm64-v1.json)

## Generality kernels

Sixteen rotated fresh-process rounds (Node 26.13.1, Step 5a-4 `7dbc33c40`, A5+5a-4 `3f7162dd6`, Step 5a-5 `beaa3eef0`) under `tools/gate/with-lock.sh both` on Apple M5 Max (clean trees, `patchSha256` empty `e3b0c442…`; load1 median `2.37`, max `3.47`; idle median `92.9%`). Every native inferior reached its entry stop and exited 42.

| Kernel               | Node ns | Step 5a-4 ns | A5+5a-4 ns | Step 5a-5 ns | Δ vs A5+5a-4, median [IQR]  | Δ vs Step 5a-4, median [IQR] | Step 5a-5 ÷ Node |
| -------------------- | ------: | -----------: | ---------: | -----------: | --------------------------- | ---------------------------- | ---------------: |
| `allocateObjects`    |   5.466 |       54.260 |     50.390 |       46.917 | **−4.06 [−5.17, −1.50]**    | **−7.86 [−8.94, −6.31]**     |            8.58× |
| `arguments3`         |   2.268 |       22.992 |     21.647 |       19.888 | **−1.76 [−1.99, −1.44]**    | **−3.11 [−3.30, −2.88]**     |            8.77× |
| `arguments4`         |   2.292 |       26.783 |     26.064 |       23.128 | **−2.91 [−3.16, −2.69]**    | **−3.71 [−3.80, −3.42]**     |           10.09× |
| `arguments5`         |   2.309 |       31.428 |     30.336 |       26.814 | **−3.61 [−3.75, −3.37]**    | **−4.62 [−4.71, −4.14]**     |           11.62× |
| `arguments6`         |   2.322 |       35.544 |     33.992 |       30.146 | **−3.81 [−4.09, −3.58]**    | **−5.44 [−5.82, −5.16]**     |           12.98× |
| `buildString`        |   8.321 |        6.530 |      6.546 |        6.187 | **−0.365 [−0.426, −0.318]** | **−0.333 [−0.390, −0.282]**  |            0.74× |
| `builtinMethod`      |   3.932 |       12.290 |     11.990 |       10.227 | **−1.77 [−1.86, −1.66]**    | **−2.10 [−2.22, −1.92]**     |            2.60× |
| `catchInLoop`        |   3.208 |       21.438 |     19.554 |       19.357 | **−0.174 [−0.269, −0.028]** | **−2.08 [−2.15, −1.85]**     |            6.03× |
| `concatenateStrings` |   6.487 |       11.311 |     11.358 |       11.266 | −0.134 [−0.256, +0.031]     | −0.123 [−0.194, +0.038]      |            1.74× |
| `mathMax`            |   2.038 |        7.058 |      6.776 |        5.778 | **−1.01 [−1.10, −0.959]**   | **−1.28 [−1.38, −1.21]**     |            2.84× |
| `mixedCall`          |   3.434 |       11.760 |     10.516 |        9.915 | **−0.630 [−0.703, −0.504]** | **−1.89 [−1.96, −1.80]**     |            2.89× |
| `mutableCapture`     |   4.983 |       14.320 |     12.617 |       11.866 | **−0.853 [−0.917, −0.609]** | **−2.36 [−2.57, −2.15]**     |            2.38× |
| `numberCall`         |   1.839 |        6.183 |      5.645 |        4.413 | **−1.25 [−1.27, −1.22]**    | **−1.77 [−1.83, −1.74]**     |            2.40× |
| `objectArray`        |   2.051 |       12.749 |     13.475 |       11.555 | **−1.89 [−1.97, −1.53]**    | **−1.17 [−1.24, −0.776]**    |            5.63× |
| `objectRoundTrip`    |   2.080 |       17.276 |     15.689 |       15.754 | +0.113 [−0.321, +0.331]     | **−1.47 [−1.78, −1.31]**     |            7.57× |
| `receivers2`         |   4.325 |       19.745 |     17.647 |       14.709 | **−2.97 [−3.04, −2.73]**    | **−5.01 [−5.20, −4.87]**     |            3.40× |
| `receivers4`         |   4.343 |       20.556 |     18.163 |       15.062 | **−3.06 [−3.19, −2.70]**    | **−5.36 [−5.77, −4.93]**     |            3.47× |
| `receivers8`         |   5.458 |       35.974 |     37.296 |       34.356 | **−2.83 [−3.08, −2.64]**    | **−1.69 [−2.27, −1.14]**     |            6.29× |
| **Geomean**          |       — |            — |          — |            — | **0.901×** (−9.9%)          | **0.854×** (−14.6%)          |            4.37× |

[Paired rounds](general-runtime-step5a5-generality-darwin-arm64-v1.json)

## Octane against Node 26.13.1

Sixteen rotated fresh-process rounds (Node 26.13.1, Step 5a-4 `7dbc33c40`, A5+5a-4 `3f7162dd6`, Step 5a-5 `beaa3eef0`) under `tools/gate/with-lock.sh both` on Apple M5 Max (clean trees, `patchSha256` empty `e3b0c442…`; load1 median `3.02`, max `4.29`; idle median `88.6%`). Every native inferior reached its entry stop and exited 42.

| Program        | Node ms/op | Step 5a-4 ms/op | A5+5a-4 ms/op | Step 5a-5 ms/op | Δ vs A5+5a-4, median [IQR]  | Δ vs Step 5a-4, median [IQR] | Step 5a-5 ÷ Node |
| -------------- | ---------: | --------------: | ------------: | --------------: | --------------------------- | ---------------------------- | ---------------: |
| `Richards`     |      0.046 |           2.253 |         1.443 |           1.383 | **−0.060 [−0.069, −0.047]** | **−0.865 [−0.888, −0.846]**  |           30.15× |
| `DeltaBlue`    |      0.062 |           6.009 |         4.518 |           4.413 | **−0.112 [−0.129, −0.063]** | **−1.59 [−1.62, −1.55]**     |           70.61× |
| `NavierStokes` |      1.831 |          14.562 |        14.637 |          14.279 | **−0.364 [−0.459, −0.292]** | **−0.285 [−0.352, −0.262]**  |            7.80× |
| `RayTrace`     |      0.507 |          23.687 |        17.216 |          17.592 | **+0.318 [+0.215, +0.503]** | **−6.16 [−6.26, −6.02]**     |           34.68× |
| **Geomean**    |          — |               — |             — |               — | **0.983×** (−1.7%)          | **0.757×** (−24.3%)          |           27.55× |

[Paired rounds](general-runtime-step5a5-octane-darwin-arm64-v1.json)

## Frozen v7 self-compile

Frozen `v7` with `--runtime-tree`, comparing A5 (`9d94f0936`) and Step 5a-5 (`beaa3eef0`): both images are `53,578,178` bytes and every Mach-O code, data, and unwind section is bit-for-bit identical:

- `__TEXT,__text`: `30,770,496` bytes, SHA-256 `6e301d3b102bcd9b53d9c80d8b4d63835a5e26a02be8794d92a8bd7a62c6a2dd`
- `__TEXT,__eh_frame`: `270,352` bytes, SHA-256 `97f0554497dcf19f31bf80d9121e0a719652019f5083a9ab6b853360fa1e5b36`
- `__TEXT,__unwind_info`: `45,300` bytes, SHA-256 `c49f8447e316a326a9b5d3beb1db12d621d68b0a7dad6e52389ebb8c22d68943`
- `__DATA,__data`: `2,256` bytes, SHA-256 `4ad5a6cd559772eecc5ddffbf2b50b06c25e08b9922a572fcb1057fa6adbc5f5`

## Validation

- **Static checks** (`beaa3eef0`, `env -u TZ`): `pnpm build`, `tsc --noEmit -p tsconfig.tests.json`, `tsc --noEmit -p tsconfig.host.json`, `pnpm boundaries` (14 portable packages verified), `node tools/generate-compiler-catalog.ts` (831 files, 639 explicit import grants), and `pnpm format:check` all pass.
- **Workspace unit tests** (`beaa3eef0`, `env -u TZ`):
  - New and updated tests in `packages/ir/test/optimization-element-cache.test.ts` (outermost enclosing loop hoisting and rejecting outer loops with unconditional diamond calls), `packages/ir/test/optimization-general-numbers.test.ts` (script proven-load materialization and merge-temporary accumulator/`element-store` shadowing), and `packages/js-engine/test/{eval-guard,import-call-lowering,module-async-lowering,runtime-surface}.test.ts` all pass.
  - `check-concurrent`: **6,247/6,247 pass**, 0 fail (3 skipped).
  - `check-memory`: **242/242 pass**, 0 fail (including `tools/script-runtime-surface.test.ts` 1/1 at 182 functions / 209 entries and `tools/selfhost-linked.test.ts`).
- **Native general fixtures under LLDB** (`beaa3eef0`, `TZ=UTC`, verified twice each):
  - `tools/native-general-elements.test.ts`
  - `tools/native-general-intrinsics.test.ts`
  - `tools/native-general-numbers.test.ts`
  - `tools/native-general-property-caches.test.ts`
  - `tools/native-script-cases.test.ts` (`2/2`)
  - Total: **6/6 pass**, 0 fail.
- **Darwin arm64 self-build fixpoint** (`beaa3eef0`, `TZ=UTC`): stage 1 (`51,484,938` bytes) builds stage 2 from the same frozen source snapshot under LLDB asserting stopped-at-entry (`eStateStopped`) and exit status 0 (`eStateExited`); `cmp stage1 stage2` is byte-identical (SHA-256 `4088952b0c65fdef597f6d619fa911bfa2a13ae94cfdeeb55eab284aaf3a61ce`).
- **Linux x86-64 stage 1 cross-bootstrap** (`beaa3eef0`, `TZ=UTC`): passes (`201,700,808` bytes, SHA-256 `bb88a8fd88b2eb2698d8adf0955260f6620a48c1de0210b7304d4e1befd41710`).

## Test262

Two explicit native selections run at Step 5a-5 (`beaa3eef0`; source snapshot `56251e7b19e8ec30…` [831 files], frozen toolchain `f1255ef4b69239a3…`, suite linking, `TZ=UTC`, `NODE_OPTIONS="--max-old-space-size=16384"`, `dirty: false`, `complete: true`), totaling **6,239/6,240 pass**, 0 failures, 0 timeouts, 0 crashes, 0 harness errors, and 1 expected unsupported module top-level-await variant:

1. **Step 5a selection (`3,514/3,514 pass`, 0 failures, 0 unsupported):** covers compound, logical, and update assignment, property accessors, `built-ins/Math`, `built-ins/Number`, `String.prototype.{charAt,charCodeAt}`, `Map.prototype.{get,set,has}`, `Set.prototype.{add,has}`, `Array` `length` and `prototype/{push,pop,shift,unshift,splice,fill,reverse,join}`, and `TypedArrayConstructors/internals/{Get,Set}`. [Report](test262-general-runtime-step5a5-native-v1.json)
2. **Array/object literal and rest-parameter selection (`2,725/2,726 pass`, 0 failures, 1 unsupported):** covers `language/expressions/array` (104/104), `language/expressions/object` (2,251/2,252 — the single unsupported variant is `cpn-obj-lit-computed-property-name-from-await-expression.js [module]`, `native module execution is not implemented`), `language/rest-parameters` (22/22), `built-ins/Array/{from,of}` (90/90, 32/32), `built-ins/Object/{keys,values,entries}` (118/118, 40/40, 42/42), and `built-ins/Reflect/ownKeys` (26/26). [Report](test262-general-runtime-step5a5-extra-native-v1.json)

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
