# General runtime step 5a-3 · fixed-arity literals, inline `Array.length`/`push`, and builtin hot paths · Darwin arm64

Step 5a-3 builds directly on [step 5a-2](general-runtime-step5a2-darwin-arm64-v1.md) (`50560bd67`) to eliminate the remaining temporary argument-list allocations and loops in small array and object literals, inline `Array.length` reads without FP register pressure, bring `Array.prototype.push` onto an inline epoch-guarded fast path, and remove property-lookup and closure-dispatch overhead from `Math`, `String.prototype.{charCodeAt,charAt}`, and `Map`/`Set`:

- **Fixed-arity small dense array literals (`createArray0..4`):** dense array literals of length `0..4` (without spreads or elisions) lower directly to `createArray0..4` in `packages/js-runtime/src/objects/array-like.ts`, constructing packed `ArrayElements` (compact `Float64Array` for all-number elements, `unknown[]` for mixed/object elements) and the 280-byte `OrdinaryObject` directly via `packRealmArray` with zero temporary `unknown[]` argument list and zero per-element loop.
- **Fixed-arity static-key object literals (`createLiteralObject1..4`):** static-key object literals of length `1..4` lower directly to `createLiteralObject1..4` in `packages/js-runtime/src/objects/operations.ts`, allocating the 280-byte `OrdinaryObject` with its cached terminal `ObjectShape` and writing slots directly when `prototype.internalChildShape === site.root`, falling back cleanly on duplicate keys, index-like keys, or mutated prototypes.
- **Inline `Array.length` (`element-length`, IR opcode 122, zero FP registers):** `packedArrayLength(witness, value)` lowers to a dedicated scalar IR operation `element-length` emitted as a GP-only 11-instruction AArch64 fast path (using only `x9..x11`, zero FP registers — avoiding any FP callee-save spill in `mixedCall`), fused with `property-fusion.ts` and preserving full ECMAScript fallback for unpacked arrays, strings, proxies, typed arrays, and ordinary objects.
- **Epoch-guarded fast `Array.prototype.push`:** `readProperty` for method calls to `"push"` checks `view.internalArrayElements !== undefined && view.properties === undefined && view.prototype === arrayProto && arrayProto.internalPropertyEpoch === intrinsics.arrayPushEpoch` inline to return `intrinsics.arrayPush` directly, and `scriptArrayPush` self-heals `arrayPushEpoch` against `arrayPrototype.properties?.get("push")` and appends Numbers inline into existing `Float64Array` capacity.
- **Reordered `Math` & `String.prototype` hot slots + dedicated `ScriptMap`:** hot `Math` methods (`floor`, `sqrt`, `max`, `min`, `abs`, `round`, `ceil`, `imul`) and `String.prototype` methods (`charCodeAt`, `charAt`, `slice`, `indexOf`) are installed within slots `0..7` so they hit inline `property-load` caches (`readProperty` probes `$errors.stringPrototype` for primitive string `charCodeAt`/`charAt` method calls). `Map` and `Set` move to a dedicated `ScriptMap` (`packages/js-runtime/src/objects/collection-data.ts`) with inline SameValueZero `number`/`string` hashing and equality (zero indirect closure dispatch; `packages/foundation/` remains completely untouched).

At `36394a26d` against Step 5a-2 (`50560bd67`) and A3 (`bee1ba669`) over 16 rotated paired rounds on Apple M5 Max:

- **Warm-call instruction counts drop 1.4–6.5× beyond Step 5a-2:** `makeEmpty` `564 → 257` (−54.4%; −78.3% vs A3), `makeNumbers` `2,244 → 491` (−78.1%; −83.5% vs A3), `makeObjects` `3,172 → 729` (−77.0%; −81.3% vs A3), `makePair` `1,354 → 275` (−79.7%), `makeTriple` `1,771 → 274` (−84.5%), `pushOne` `3,493 → 572` (−83.6%), `lenOf` `230 → 111` (−51.7%, zero callees), `charCode` `1,143 → 234` (−79.5%), `mathFloor` `1,701 → 941` (−44.7%), `mapSetHas` `1,698 → 1,217` (−28.3%), and `setAddHas` `1,696 → 1,241` (−26.8%).
- **`elements.ts` geomean improves another 1.75× over Step 5a-2 (`0.571×`, `0.154×` vs A3, `4.34×` vs Node 26):** `pushLength` drops `136.9 → 21.4 ns` (−84.4%, `6.4×` faster than 5a-2, `48.9×` faster than A3), `charCodeAt` drops `40.8 → 9.7 ns` (`4.2×`), `objectArrayLiteral` drops `124.5 → 43.9 ns` (`2.84×`), `numberArrayLiteral` drops `105.3 → 49.1 ns` (`2.15×`), `mathFloor` drops `54.9 → 28.4 ns` (`1.93×`), `mathSqrt` drops `57.7 → 30.5 ns` (`1.89×`), `mapSetHas` drops `89.0 → 65.4 ns` (`1.36×`), `setAddHas` drops `88.1 → 65.3 ns` (`1.35×`), and `numberElement{Read,Write,Update}` drop another 9–13% from inline `element-length` loop bounds.
- **`generality` geomean improves another 9.8% over Step 5a-2 (`0.902×`, `0.679×` vs A3, `6.08×` vs Node 26):** `allocateObjects` drops `107.2 → 68.7 ns` (−36.0%), `builtinMethod` drops `33.4 → 21.8 ns` (−34.9%), `mathMax` drops `54.8 → 28.2 ns` (−48.4%), `receivers8` drops `48.7 → 44.9 ns` (−7.9%), `buildString` drops `15.4 → 14.2 ns` (−7.6%), with zero regressions across all 18 kernels (`mixedCall` `24.1 ns`, neutral vs 5a-2 and faster than A3's `26.1 ns`).
- **Octane:** **DeltaBlue** drops another 6.5% beyond Step 5a-2 (`6.537 → 6.113 ms/op`, paired median **−0.381 ms** [IQR −0.492, −0.283], `0.489×` of A3's `12.510 ms/op`), while **NavierStokes** (`17.539 ms/op`, `0.266×` vs A3), **RayTrace** (`24.808 ms/op`, `0.885×` vs A3), and **Richards** (`2.283 ms/op`, `0.982×` vs A3) hold steady (`0.986×` geomean vs 5a-2, `0.580×` vs A3).
- **Frozen `v7 --runtime-tree`** remains byte-identical across every Mach-O section (`__TEXT,__text` `f34e866923d72f4e…`), arm64 `stage1 == stage2` fixpoint is byte-identical (`48,793,482` bytes), Linux x86-64 stage 1 cross-bootstrap passes (`189,482,816` bytes), all static/concurrent/memory/native LLDB checks pass, and native Test262 passes **6,239/6,240** (`3,514/3,514` + `2,725/2,726`, 0 failures, 1 expected unsupported module top-level-await variant).

Branch `perf/general-runtime-arrays`. Base A3 `bee1ba669`, prior milestone Step 5a-2 `50560bd67`, candidate `36394a26d` (compiled/runtime binary) and `ce43b64e1` (fixes two test-side JS snippets in `tools/native-general-{elements,intrinsics}.test.ts`; `packages/` is byte-identical to `36394a26d`). Apple M5 Max, Node 26.13.1.

## Commits on top of Step 5a-2 (`50560bd67`)

| Commit      | Change                                                                                                                                                                                                            |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `36394a26d` | Fixed-arity `createArray0..4` and `createLiteralObject1..4`, GP-only `element-length` IR op (opcode 122), epoch-guarded `Array.prototype.push` fast path, reordered `Math`/`String.prototype` slots, `ScriptMap`. |
| `ce43b64e1` | Fix test-side `out.push` while `Array.prototype.push` is deleted and guard `k === "a" && v === 1` in live `Map` iteration test in `tools/native-general-{elements,intrinsics}.test.ts`.                           |

Script runtime surface updated from 170 functions / 197 entries to 180 functions / 207 entries (`createArray0..4`, `createLiteralObject1..4`, `packedArrayLength`), with zero new collection anchors, collections, or runtimes (`tools/script-runtime-surface.test.ts` remains 133 anchors / 59 collections / 61 runtimes). `packages/foundation/` and call-path files (`scriptEntryGuard`, `argumentAt`) were not modified.

## Warm-call instruction traces

One warm call (the 501st), entry to return with callees, single-stepped under LLDB (`tools/general-call-bench/count_call.py`) on untyped debug-symbol images of Step 5a-2 (`6e91aebb5` / `50560bd67`) and Step 5a-3 (`36394a26d`):

| Probe (source)                                          | A3 (`bee1ba669`) | Step 5a-2 (`50560bd67`) | Step 5a-3 (`36394a26d`) | Δ vs Step 5a-2      |
| ------------------------------------------------------- | ---------------: | ----------------------: | ----------------------: | ------------------- |
| `makeEmpty()`: `return []`                              |            7,808 |                     564 |                 **257** | **−307 (−54.4%)**   |
| `makeNumbers()`: `return [1, 2, 3, 4]`                  |           29,213 |                   2,244 |                 **491** | **−1,753 (−78.1%)** |
| `makeObjects(o)`: `return [o, o, o, o]`                 |           29,564 |                   3,172 |                 **729** | **−2,443 (−77.0%)** |
| `callAdd(list, i)`: `return list[i & 3].add(i & 7) + 0` |              769 |                     730 |                     737 | +7 (+1.0%)          |
| `makePair(a, b)`: `return { left: a, right: b }`        |            2,555 |                   1,354 |                 **275** | **−1,079 (−79.7%)** |
| `makeTriple(a)`: `return { x: a, y: a, z: a }`          |            3,706 |                   1,771 |                 **274** | **−1,497 (−84.5%)** |
| `makeEmptyObject()`: `return {}`                        |              201 |                     201 |                     201 | 0 (+0.0%)           |
| `makeReceiver(n)`: `return { offset: n, add(v) { … } }` |            7,979 |                   7,985 |                   7,985 | 0 (+0.0%)           |
| `pushOne(a, v)`: `return a.push(v)`                     |                — |                   3,493 |                 **572** | **−2,921 (−83.6%)** |
| `lenOf(a)`: `return a.length`                           |                — |                     230 |                 **111** | **−119 (−51.7%)**   |
| `mapSetHas(m, k, v)`: `m.set(k, v); return m.has(k)`    |                — |                   1,698 |               **1,217** | **−481 (−28.3%)**   |
| `setAddHas(s, k)`: `s.add(k); return s.has(k)`          |                — |                   1,696 |               **1,241** | **−455 (−26.8%)**   |
| `mathFloor(x)`: `return Math.floor(x)`                  |                — |                   1,701 |                 **941** | **−760 (−44.7%)**   |
| `charCode(s, i)`: `return s.charCodeAt(i)`              |                — |                   1,143 |                 **234** | **−909 (−79.5%)**   |

## Elements, builtins, and creation kernels

Sixteen rotated fresh-process rounds (4 engines × 4 full rotations: Node 26.13.1, A3 `bee1ba669`, Step 5a-2 `50560bd67`, Step 5a-3 `36394a26d`) under `tools/gate/with-lock.sh both` on Apple M5 Max (clean trees, `patchSha256` empty `e3b0c442…`; load1 median `8.83`, max `11.25`; idle median `67.6%`). Every native inferior reached its entry stop and exited 42. Paired deltas are per round against Step 5a-2 (`50560bd67`) and against A3 (`bee1ba669`) (median `[q1, q3]`); bold indicates the IQR excludes zero.

| Kernel                | Node ns |   A3 ns | Step 5a-2 ns | Step 5a-3 ns | Δ vs Step 5a-2, median [IQR] | Δ vs A3, median [IQR]       | Step 5a-3 ÷ Node |
| --------------------- | ------: | ------: | -----------: | -----------: | ---------------------------- | --------------------------- | ---------------: |
| `numberElementRead`   |   2.439 |   19.79 |        8.404 |        7.329 | **−1.00 [−2.00, −0.41]**     | **−12.9 [−14.8, −11.0]**    |            3.00× |
| `numberElementWrite`  |   2.269 |   31.74 |        7.840 |        6.855 | **−0.94 [−1.27, −0.49]**     | **−25.2 [−28.8, −22.4]**    |            3.02× |
| `numberElementUpdate` |   2.109 |  161.69 |       10.171 |        9.294 | **−1.06 [−1.69, −0.25]**     | **−152.9 [−175.2, −143.9]** |            4.41× |
| `objectElementRead`   |   2.237 |   17.49 |       13.726 |       14.744 | +1.05 [−0.11, +1.69]         | **−3.05 [−4.09, −0.64]**    |            6.59× |
| `numberArrayLiteral`  |  10.815 | 1,234.6 |       105.32 |       49.055 | **−57.3 [−64.2, −53.9]**     | **−1,187 [−1,399, −1,152]** |            4.54× |
| `objectArrayLiteral`  |   5.314 | 1,387.3 |       124.54 |       43.864 | **−80.7 [−90.8, −78.9]**     | **−1,345 [−1,490, −1,287]** |            8.25× |
| `objectLiteral`*      |   6.966 |   1.485 |        1.386 |        1.414 | −0.008 [−0.139, +0.118]      | −0.089 [−0.175, +0.022]     |            0.20× |
| `pushLength`          |   5.015 | 1,046.8 |       136.88 |       21.388 | **−115.5 [−126.9, −110.4]**  | **−1,027 [−1,159, −992]**   |            4.26× |
| `charCodeAt`          |   2.436 |  148.39 |       40.792 |        9.710 | **−30.6 [−33.5, −28.7]**     | **−138.5 [−145.7, −134.2]** |            3.99× |
| `mathFloor`           |   2.675 |  129.15 |       54.906 |       28.415 | **−27.0 [−30.1, −23.2]**     | **−102.6 [−109.3, −92.5]**  |           10.62× |
| `mathSqrt`            |   2.825 |  127.29 |       57.687 |       30.461 | **−28.1 [−30.2, −23.6]**     | **−97.9 [−107.0, −92.1]**   |           10.78× |
| `mapSetHas`           |  10.118 |  222.62 |       89.044 |       65.387 | **−23.3 [−28.0, −20.4]**     | **−155.8 [−164.4, −147.7]** |            6.46× |
| `setAddHas`           |   8.588 |  235.94 |       88.126 |       65.335 | **−20.6 [−29.0, −17.8]**     | **−161.1 [−191.2, −156.2]** |            7.61× |
| **Geomean**           |       — |       — |            — |            — | **0.571×** (−42.9%)          | **0.154×** (−84.6%)         |            4.34× |

\* `objectLiteral` is a non-escaping numeric object literal specialized to a typed record on all three builds (`0.20×` Node). Escaping JS object literals are measured by `allocateObjects` in `generality` below.

[Paired rounds](general-runtime-step5a3-elements-darwin-arm64-v1.json)

## Generality kernels

Sixteen rotated fresh-process rounds (Node 26.13.1, A3 `bee1ba669`, Step 5a-2 `50560bd67`, Step 5a-3 `36394a26d`) under `tools/gate/with-lock.sh both` on Apple M5 Max (clean trees, `patchSha256` empty `e3b0c442…`; load1 median `7.98`, max `8.89`; idle median `67.3%`). Every native inferior reached its entry stop and exited 42.

| Kernel               | Node ns |  A3 ns | Step 5a-2 ns | Step 5a-3 ns | Δ vs Step 5a-2, median [IQR] | Δ vs A3, median [IQR]       | Step 5a-3 ÷ Node |
| -------------------- | ------: | -----: | -----------: | -----------: | ---------------------------- | --------------------------- | ---------------: |
| `allocateObjects`    |   8.111 | 154.13 |       107.23 |       68.672 | **−39.4 [−44.7, −33.0]**     | **−82.0 [−114.2, −74.1]**   |            8.47× |
| `builtinMethod`      |   5.456 |  97.03 |       33.444 |       21.787 | **−12.4 [−14.4, −10.3]**     | **−73.4 [−89.4, −67.7]**    |            3.99× |
| `mathMax`            |   2.456 | 153.31 |       54.765 |       28.248 | **−28.8 [−34.1, −24.1]**     | **−122.5 [−143.1, −112.2]** |           11.50× |
| `receivers8`         |   6.974 |  55.45 |       48.713 |       44.881 | **−3.61 [−6.99, −2.20]**     | **−6.68 [−14.85, −4.08]**   |            6.44× |
| `buildString`        |  10.809 |  21.97 |       15.362 |       14.199 | **−1.35 [−2.65, −0.50]**     | **−7.70 [−10.86, −6.28]**   |            1.31× |
| `arguments5`         |   2.918 |  42.46 |       39.859 |       37.989 | **−0.80 [−3.42, −0.15]**     | **−3.42 [−8.16, −0.09]**    |           13.02× |
| `objectRoundTrip`    |   2.475 |  21.86 |       20.972 |       19.741 | −0.93 [−2.92, +0.14]         | **−1.49 [−2.85, −0.48]**    |            7.98× |
| `numberCall`         |   2.895 | 110.75 |       27.981 |       27.658 | −0.26 [−2.47, +0.28]         | **−80.4 [−93.7, −74.4]**    |            9.55× |
| `objectArray`        |   2.737 |  19.61 |       16.406 |       16.186 | −0.09 [−0.76, +0.30]         | **−2.86 [−4.98, −0.89]**    |            5.91× |
| `receivers2`         |   6.000 |  29.48 |       25.450 |       25.271 | −0.85 [−2.57, +0.52]         | **−2.86 [−7.02, −0.85]**    |            4.21× |
| `receivers4`         |   5.964 |  30.09 |       26.935 |       26.530 | −0.50 [−2.96, +0.37]         | **−2.04 [−8.58, −1.05]**    |            4.45× |
| `mutableCapture`     |   6.894 |  18.13 |       17.562 |       17.427 | −1.08 [−2.05, +0.24]         | **−0.94 [−3.00, −0.10]**    |            2.53× |
| `arguments3`         |   2.586 |  27.47 |       27.067 |       26.341 | −1.13 [−2.49, +0.65]         | −0.64 [−3.08, +0.13]        |           10.18× |
| `arguments4`         |   2.673 |  32.61 |       32.584 |       32.920 | −0.13 [−1.72, +0.53]         | −0.64 [−3.35, +2.14]        |           12.32× |
| `arguments6`         |   3.156 |  51.13 |       49.691 |       49.450 | +0.58 [−3.27, +3.82]         | **−1.29 [−5.07, −0.02]**    |           15.67× |
| `catchInLoop`        |   3.603 |  24.41 |       23.925 |       23.826 | −0.63 [−2.50, +0.61]         | −1.02 [−2.11, +0.01]        |            6.61× |
| `concatenateStrings` |   8.108 |  16.08 |       15.318 |       15.410 | −0.48 [−1.51, +0.92]         | −0.65 [−1.28, +0.06]        |            1.90× |
| `mixedCall`          |   4.204 |  26.06 |       23.499 |       24.090 | +0.32 [−1.26, +1.58]         | −0.68 [−2.99, +1.10]        |            5.73× |
| **Geomean**          |       — |      — |            — |            — | **0.902×** (−9.8%)           | **0.679×** (−32.1%)         |            6.08× |

[Paired rounds](general-runtime-step5a3-generality-darwin-arm64-v1.json)

## Octane against Node 26.13.1

Sixteen rotated fresh-process rounds (Node 26.13.1, A3 `bee1ba669`, Step 5a-2 `50560bd67`, Step 5a-3 `36394a26d`) under `tools/gate/with-lock.sh both` on Apple M5 Max (clean trees, `patchSha256` empty `e3b0c442…`; load1 median `3.80`, max `6.24`; idle median `81.8%`). Every native inferior reached its entry stop and exited 42.

| Program        | Node ms/op | A3 ms/op | Step 5a-2 ms/op | Step 5a-3 ms/op | Δ vs Step 5a-2, median [IQR] | Δ vs A3, median [IQR]       | Step 5a-3 ÷ Node |
| -------------- | ---------: | -------: | --------------: | --------------: | ---------------------------- | --------------------------- | ---------------: |
| `Richards`     |      0.047 |    2.325 |           2.275 |           2.283 | +0.007 [−0.015, +0.034]      | **−0.033 [−0.086, −0.007]** |           48.70× |
| `DeltaBlue`    |      0.069 |   12.510 |           6.537 |           6.113 | **−0.381 [−0.492, −0.283]**  | **−6.301 [−6.677, −6.094]** |           88.68× |
| `NavierStokes` |      1.880 |   66.027 |          17.333 |          17.539 | +0.167 [−0.233, +0.345]      | **−48.63 [−49.44, −48.16]** |            9.33× |
| `RayTrace`     |      0.535 |   28.019 |          24.885 |          24.808 | −0.364 [−0.431, +0.069]      | **−3.502 [−3.986, −2.840]** |           46.34× |
| **Geomean**    |          — |        — |               — |               — | **0.986×** (−1.4%)           | **0.580×** (−42.0%)         |           36.97× |

[Paired rounds](general-runtime-step5a3-octane-darwin-arm64-v1.json)

## Frozen v7 self-compile

Frozen `v7` with `--runtime-tree`, comparing A3 (`bee1ba669`) and Step 5a-3 (`36394a26d`): both images are `53,413,554` bytes and every Mach-O code and data section is bit-for-bit identical:

- `__TEXT,__text`: `30,702,976` bytes, SHA-256 `f34e866923d72f4e…`
- `__TEXT,__eh_frame`: `270,680` bytes, SHA-256 `5a6370012f45f338…`
- `__TEXT,__unwind_info`: `45,300` bytes, SHA-256 `9ce2a20b156a28bc…`
- `__DATA,__data`: `2,256` bytes, SHA-256 `4ad5a6cd559772ee…`

## Validation

- **Static checks** (`36394a26d` / `ce43b64e1`): `pnpm build`, `tsc --noEmit -p tsconfig.tests.json`, `tsc --noEmit -p tsconfig.host.json`, `pnpm boundaries`, `node tools/generate-compiler-catalog.ts` (830 files, 639 explicit import grants), and `pnpm format:check` all pass.
- **Workspace unit tests:**
  - `packages/js-runtime/test/ordinary-object-arrays.test.ts` (29/29 pass, including `createArray0..4`, `createLiteralObject1..4`, and `ScriptMap` SameValueZero/rehash/live cursor coverage)
  - `tools/selfhost-linked.test.ts` (19/19 pass, including self-checking `packages/js-engine/src/lowering/index.ts` and complete native compiler pipeline)
  - `packages/ir/test/function-store.test.ts`, `packages/ir/test/scalar-verifier.test.ts`, and `tools/function-store-files.test.ts` (covering `element-length` codec opcode 122 and verifier rules)
  - `check-concurrent`: **6,211/6,211 pass**, 0 fail (3 skipped)
  - `check-memory`: all pass (including `tools/script-runtime-surface.test.ts` 1/1 at 180 functions / 207 entries and `tools/test262-dynamic-import-host.test.ts` 15/15)
- **Native general fixtures under LLDB** (`TZ=UTC`, verified twice each):
  - `tools/native-general-elements.test.ts` (including dense `0..4` array literals, static-key `1..4` object literals with duplicates/index keys/prototype mutation, `Array.prototype.push` own shadowing/unrelated epoch self-healing/deletion/getter/capacity growth/unpacked arrays, and inline `element-length`)
  - `tools/native-general-intrinsics.test.ts` (including reordered `Math` methods & constants, `String.prototype.charCodeAt` delete/getter, and `ScriptMap` BigInt/number/string/rehash/live deletion & clear during iteration)
  - `tools/native-general-numbers.test.ts`
  - `tools/native-general-property-caches.test.ts`
  - `tools/native-script-cases.test.ts` (2/2)
- **Darwin arm64 self-build fixpoint** (`36394a26d`, identical `packages/` to `ce43b64e1`): stage 1 (`48,793,482` bytes) builds stage 2 from the same frozen source tree under LLDB asserting stopped-at-entry (`eStateStopped`) and exit status 0 (`eStateExited`); `cmp stage1 stage2` is byte-identical (SHA-256 `77bc8504fdfc3c68bbd82181c7cb7a641fdc58eea26c19d1ee2ee601deb4a297`).
- **Linux x86-64 stage 1 cross-bootstrap** (`36394a26d`): passes (`189,482,816` bytes).

## Test262

Two explicit native selections run at Step 5a-3 (`36394a26d`, identical `packages/` to `ce43b64e1`; source snapshot `e4b519d39e4f9f66…` [830 files], frozen toolchain `30ab8ee38e7f09b6…`, suite linking, `TZ=UTC`, `NODE_OPTIONS="--max-old-space-size=16384"`, `dirty: false`, `complete: true`), totaling **6,239/6,240 pass**, 0 failures, 0 timeouts, 0 crashes, 0 harness errors, and 1 expected unsupported module top-level-await variant:

1. **Step 5a selection (`3,514/3,514 pass`, 0 failures, 0 unsupported):** covers compound, logical, and update assignment, property accessors, `built-ins/Math`, `built-ins/Number`, `String.prototype.{charAt,charCodeAt}`, `Map.prototype.{get,set,has}`, `Set.prototype.{add,has}`, `Array` `length` and `prototype/{push,pop,shift,unshift,splice,fill,reverse,join}`, and `TypedArrayConstructors/internals/{Get,Set}`. [Report](test262-general-runtime-step5a3-native-v1.json)
2. **Array/object literal and rest-parameter selection (`2,725/2,726 pass`, 0 failures, 1 unsupported):** covers `language/expressions/array` (104/104), `language/expressions/object` (2,251/2,252 — the single unsupported variant is `cpn-obj-lit-computed-property-name-from-await-expression.js [module]`, `native module execution is not implemented`), `language/rest-parameters` (22/22), `built-ins/Array/{from,of}` (90/90, 32/32), `built-ins/Object/{keys,values,entries}` (118/118, 40/40, 42/42), and `built-ins/Reflect/ownKeys` (26/26). [Report](test262-general-runtime-step5a3-extra-native-v1.json)

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
