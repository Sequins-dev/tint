# General runtime step 5a-6 · rebase onto A6, direct-mapped `Map`/`Set` fast paths, `propertyEpoch`-guarded `push`, inline `charCodeAt`, direct `general === reference`, and loop property caching · Darwin arm64

Step 5a-6 rebases `perf/general-runtime-arrays` onto [A6](general-runtime-a6-darwin-arm64-v1.md) (`bdde6ac9e`, via `9ef32ed6c`) — combining A6's numeric loop specialization, inherited IC probes, and fast sloppy/call/pop lowering with [Step 5a-5](general-runtime-step5a5-darwin-arm64-v1.md) (`beaa3eef0`) — and targets the remaining hot-path costs in builtins, `Map`/`Set`, `Array.prototype.push`, `String.prototype.charCodeAt`, array literals, and loop-invariant property reads:

- **Direct `general === reference` / `optional-reference` comparison (`packages/ir/src/scalar/index.ts`, `packages/ts-native/src/scalar.ts`, `packages/js-engine/src/lowering/index.ts`):**
  - Lowers strict equality between a `general` value and a `reference` / `optional-reference` value directly via payload tag + pointer check instead of routing through generic boxed equality dispatch, trimming hot-path intrinsic/receiver identity guards across `Math.*`, `charCodeAt`, `pushLength`, `Map`/`Set`, and `numberCall`/`receivers*`.
- **Direct-mapped numeric fast tables and inlineable `*Fast` helpers for `Map`/`Set` (`packages/js-runtime/src/objects/{collection-data,index,structured-clone}.ts`, `packages/js-engine/src/lowering/{index,runtime-imports}.ts`):**
  - Adds a direct-mapped non-negative integer fast table alongside the Fibonacci-hashed `ScriptMap`/`ScriptSet` backing store (preserving insertion order, delete/clear/clone semantics, and `-0` normalization) plus five compact `*Fast` entrypoints (`scriptMapGetFast`, `scriptMapHasFast`, `scriptMapSetFast`, `scriptSetAddFast`, `scriptArrayPushFast`).
  - Hoists loop-invariant `Map`/`Set` collection unwrapping (`hoistedCollection` via `target.object`) with `useFastCollection` gating when receiver shape/prototype checks are invariant across the loop.
- **`propertyEpoch`-guarded `scriptArrayPushFast`, pre-initialized `createArray0..4`, and inline `charCodeAt(idx | 0)` (`packages/js-runtime/src/objects/{array-append,array-like,errors,operations}.ts`, `packages/js-engine/src/lowering/index.ts`):**
  - Validates packed array push against `$errors.propertyEpoch` via `scriptArrayPushFast` and pre-initializes fixed-arity array literal backing stores in `createArray0..4`.
  - Lowers `String.prototype.charCodeAt` inline on integer-coerced indices (`idx | 0`) with bounds fallback to the runtime helper.
- **Loop-invariant property caching IR pass (`packages/ir/src/optimization/{property-cache,index,observer}.ts`, `packages/compiler/src/catalog.ts`):**
  - Adds `cacheLoopProperties` (strictly gated on `hasScriptOperations(fn)` so typed AOT code paths are untouched) with exact forward definite-initialization analysis, split-preheader tail-segment lookup, and exhaustive `opResultType` coverage across all scalar IR instruction kinds.

At `a31cdc0af` / `b58a29084` (identical compiler/runtime source snapshot `89d09c3f6a72f730…`, 833 files; `b58a29084` updates only `tools/native-general-intrinsics.test.ts`) against pre-rebase Step 5a-5 (`beaa3eef0`) and rebased A6+5a-5 (`9ef32ed6c`) over 16 rotated paired rounds on Apple M5 Max:

- **`elements.ts` geomean improves 21.8% over A6+5a-5 (`0.782×`, `0.732×` / −26.8% vs Step 5a-5, `1.70×` vs Node 26):** `mapSetHas` drops `17.877 → 7.669 ns` (**2.33× faster**, **`0.95×` of Node 26's `8.091 ns`** — faster than Node 26 on untyped JS), `setAddHas` drops `15.127 → 7.225 ns` (**2.09× faster**, **`1.05×` Node 26**), `pushLength` drops `15.612 → 8.895 ns` (**1.76× faster**, −43.0%), `charCodeAt` drops `6.768 → 4.002 ns` (**1.69× faster**, −40.9%), `mathSqrt` drops `4.131 → 2.506 ns` (**1.65× faster**, **`1.15×` Node 26**), `mathFloor` drops `5.304 → 4.411 ns` (−16.8%), `numberArrayLiteral` drops `32.950 → 31.689 ns` (−3.8%), and `objectArrayLiteral` drops `38.944 → 37.766 ns` (−3.0%), while `numberElementRead` (`1.272 ns`, **`0.65×` Node 26**), `numberElementWrite` (`1.479 ns`, **`0.89×` Node 26**), and `objectLiteral` (`4.168 ns`, **`0.90×` Node 26**) remain faster than Node 26.
- **`generality` geomean improves 6.3% over A6+5a-5 (`0.937×`, `0.947×` / −5.3% vs Step 5a-5, `4.15×` vs Node 26):** `builtinMethod` (`map.get`) drops `10.234 → 5.584 ns` (**1.83× faster**, −45.4%, **`1.34×` Node 26**), `mathMax` drops `5.772 → 4.348 ns` (−24.7%), `numberCall` drops `4.412 → 3.591 ns` (−18.6%), `receivers2` drops `14.898 → 14.130 ns` (−5.2%), `receivers4` drops `14.953 → 14.296 ns` (−4.4%), `receivers8` drops `41.774 → 40.855 ns` (−2.2%), and `buildString` stays at `6.150 ns` (**`0.71×` Node 26**).
- **Octane improves 52.1% geomean over pre-rebase Step 5a-5 (`0.479×`, `1.001×` vs A6+5a-5, `13.25×` vs Node 26):** **NavierStokes** improves to `5.640 ms/op` (`−0.019 ms` vs A6+5a-5, −60.6% vs Step 5a-5, **`3.09×` vs Node 26**), **Richards** stays at `0.884 ms/op` (−36.3% vs Step 5a-5), **DeltaBlue** stays at `2.192 ms/op` (−50.3% vs Step 5a-5), and **RayTrace** is `7.398 ms/op` (+0.033 ms vs A6+5a-5, −57.7% vs Step 5a-5).
- **Frozen `v7 --runtime-tree`** builds cleanly (`53,578,178` bytes) with `__DATA,__data` bit-for-bit identical to A5/A6 (`2,256` bytes) and `__TEXT,__text` shrinking by `3,600` bytes (`30,770,496 → 30,766,896` bytes) from direct `general === reference` / `optional-reference` lowering in `packages/ts-native/src/scalar.ts`. Darwin arm64 `stage1 == stage2` fixpoint is byte-identical (`52,145,418` bytes), Linux x86-64 stage 1 cross-bootstrap passes (`204,141,040` bytes), all static/concurrent (`6,252/6,252`)/memory (`242/242`)/native LLDB (`6/6`) gates pass, and native Test262 passes **6,239/6,240** (`3,514/3,514` + `2,725/2,726`, 0 failures, 1 expected unsupported module top-level-await variant).

Branch `perf/general-runtime-arrays`. Base A6 `bdde6ac9e`, pre-rebase Step 5a-5 `beaa3eef0`, rebased A6+5a-5 `9ef32ed6c`, candidate `a31cdc0af` / `b58a29084`. Apple M5 Max, Node 26.13.1.

## Commits on top of A6 (`bdde6ac9e`)

| Commit      | Change                                                                                                                                                                                                                                                     |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `99aea88a5` | Step 5a-3: fixed-arity array/object literals, inline `Array.length`/`push`, and builtin hot paths (rebased onto A6).                                                                                                                                       |
| `3336ae81b` | Step 5a-3: deleted `push` and live `Map` iteration checks in native fixtures (rebased onto A6).                                                                                                                                                            |
| `7ee8128d1` | Report step 5a-3 (rebased onto A6).                                                                                                                                                                                                                        |
| `84c3aef24` | Step 5a-4: loop element caching (`element-storage`/`element-count`), flattened Fibonacci-hashed `ScriptMap`, reducible `for` loops, and conditional `general-numbers` analysis (rebased onto A6).                                                          |
| `3a5754e7f` | Report step 5a-4 (rebased onto A6).                                                                                                                                                                                                                        |
| `0ad812482` | Step 5a-5: witness-free element loops, `viewTypeofObject`, integer element indices, outermost `element-cache`, accumulator shadowing, and typed `ScriptMapEntry.numberKey` (rebased onto A6).                                                              |
| `a8ce0259a` | Report step 5a-5 (rebased onto A6).                                                                                                                                                                                                                        |
| `9ef32ed6c` | Refresh `js-engine` lowering golden hashes after rebase onto A6 (A6+5a-5 benchmark baseline).                                                                                                                                                              |
| `a31cdc0af` | Step 5a-6: direct `general === reference`/`optional-reference`, direct-mapped `Map`/`Set` fast tables + `*Fast` helpers, `propertyEpoch`-guarded `scriptArrayPushFast`, pre-initialized `createArray0..4`, inline `charCodeAt`, and `cacheLoopProperties`. |
| `b58a29084` | Use `Map` copy instead of `structuredClone` in `tools/native-general-intrinsics.test.ts` (test-only; compiler/runtime source snapshot unchanged).                                                                                                          |

Script runtime surface is 188 functions / 215 entries (`tools/script-runtime-surface.test.ts`, +5 `*Fast` helpers over A6+5a-5's 183 functions / 210 entries). Compiler catalog is 833 files / 639 explicit import grants. `packages/foundation/` was not modified.

## Elements, builtins, and creation kernels

Sixteen rotated fresh-process rounds (4 engines × 4 full rotations: Node 26.13.1, Step 5a-5 `beaa3eef0`, A6+5a-5 `9ef32ed6c`, Step 5a-6 `a31cdc0af`) under `tools/gate/with-lock.sh both` on Apple M5 Max (clean trees, `patchSha256` empty `e3b0c442…`; load1 median `2.23`, max `2.72`; idle median `93.0%`). Every native inferior reached its entry stop and exited 42. Paired deltas are per round against A6+5a-5 (`9ef32ed6c`) and against pre-rebase Step 5a-5 (`beaa3eef0`) (median `[q1, q3]`); bold indicates the IQR excludes zero.

| Kernel                | Node ns | Step 5a-5 ns | A6+5a-5 ns | Step 5a-6 ns | Δ vs A6+5a-5, median [IQR]  | Δ vs Step 5a-5, median [IQR] | Step 5a-6 ÷ Node |
| --------------------- | ------: | -----------: | ---------: | -----------: | --------------------------- | ---------------------------- | ---------------: |
| `charCodeAt`          |   2.009 |        6.578 |      6.768 |        4.002 | **−2.76 [−2.81, −2.59]**    | **−2.43 [−2.69, −2.34]**     |            1.99× |
| `mapSetHas`           |   8.091 |       18.262 |     17.877 |        7.669 | **−10.3 [−11.0, −9.80]**    | **−10.5 [−11.0, −10.3]**     |            0.95× |
| `mathFloor`           |   2.070 |        5.073 |      5.304 |        4.411 | **−0.894 [−0.923, −0.814]** | **−0.691 [−0.852, −0.627]**  |            2.13× |
| `mathSqrt`            |   2.180 |        4.129 |      4.131 |        2.506 | **−1.62 [−1.68, −1.60]**    | **−1.63 [−1.68, −1.60]**     |            1.15× |
| `numberArrayLiteral`  |   7.817 |       33.966 |     32.950 |       31.689 | **−0.795 [−1.84, −0.093]**  | **−1.58 [−2.98, −0.289]**    |            4.05× |
| `numberElementRead`   |   1.966 |        2.274 |      1.295 |        1.272 | **−0.031 [−0.080, −0.001]** | **−1.01 [−1.03, −0.973]**    |            0.65× |
| `numberElementUpdate` |   1.619 |        2.077 |      1.314 |        1.704 | +0.338 [−0.053, +0.413]     | **−0.434 [−0.803, −0.341]**  |            1.05× |
| `numberElementWrite`  |   1.666 |        1.308 |      1.520 |        1.479 | +0.013 [−0.070, +0.168]     | **+0.171 [+0.158, +0.215]**  |            0.89× |
| `objectArrayLiteral`  |   3.780 |       38.753 |     38.944 |       37.766 | **−1.37 [−1.63, −0.882]**   | **−1.09 [−1.41, −0.675]**    |            9.99× |
| `objectElementRead`   |   1.740 |        7.413 |      7.419 |        7.454 | +0.055 [−0.065, +0.140]     | +0.020 [−0.045, +0.161]      |            4.28× |
| `objectLiteral`       |   4.632 |        4.166 |      4.152 |        4.168 | +0.011 [−0.017, +0.063]     | −0.001 [−0.039, +0.050]      |            0.90× |
| `pushLength`          |   4.035 |       15.707 |     15.612 |        8.895 | **−6.77 [−6.91, −6.62]**    | **−6.86 [−7.10, −6.75]**     |            2.20× |
| `setAddHas`           |   6.900 |       15.080 |     15.127 |        7.225 | **−7.94 [−8.04, −7.77]**    | **−7.88 [−7.95, −7.71]**     |            1.05× |
| **Geomean**           |       — |            — |          — |            — | **0.782×** (−21.8%)         | **0.732×** (−26.8%)          |            1.70× |

[Paired rounds](general-runtime-step5a6-elements-darwin-arm64-v1.json)

## Generality kernels

Sixteen rotated fresh-process rounds (Node 26.13.1, Step 5a-5 `beaa3eef0`, A6+5a-5 `9ef32ed6c`, Step 5a-6 `b58a29084`) under `tools/gate/with-lock.sh both` on Apple M5 Max (clean trees, `patchSha256` empty `e3b0c442…`; load1 median `1.76`, max `2.66`; idle median `93.6%`). Every native inferior reached its entry stop and exited 42.

| Kernel               | Node ns | Step 5a-5 ns | A6+5a-5 ns | Step 5a-6 ns | Δ vs A6+5a-5, median [IQR]  | Δ vs Step 5a-5, median [IQR] | Step 5a-6 ÷ Node |
| -------------------- | ------: | -----------: | ---------: | -----------: | --------------------------- | ---------------------------- | ---------------: |
| `allocateObjects`    |   5.490 |       46.278 |     45.363 |       46.858 | +0.992 [−0.448, +4.02]      | −0.425 [−2.25, +2.81]        |            8.53× |
| `arguments3`         |   2.075 |       19.773 |     19.713 |       19.858 | **+0.214 [+0.018, +0.343]** | +0.089 [−0.016, +0.231]      |            9.57× |
| `arguments4`         |   2.184 |       23.095 |     22.979 |       23.073 | +0.201 [−0.046, +0.456]     | +0.018 [−0.243, +0.273]      |           10.56× |
| `arguments5`         |   2.206 |       26.835 |     26.805 |       26.891 | +0.063 [−0.154, +0.460]     | −0.025 [−0.156, +0.312]      |           12.19× |
| `arguments6`         |   2.339 |       30.147 |     30.145 |       30.144 | +0.014 [−0.063, +0.131]     | +0.021 [−0.111, +0.125]      |           12.89× |
| `buildString`        |   8.639 |        6.215 |      6.175 |        6.150 | −0.052 [−0.175, +0.043]     | −0.104 [−0.141, +0.053]      |            0.71× |
| `builtinMethod`      |   4.174 |       10.218 |     10.234 |        5.584 | **−4.64 [−4.70, −4.55]**    | **−4.60 [−4.70, −4.46]**     |            1.34× |
| `catchInLoop`        |   3.120 |       19.346 |     19.337 |       19.329 | +0.026 [−0.058, +0.081]     | −0.012 [−0.188, +0.250]      |            6.19× |
| `concatenateStrings` |   6.600 |       11.205 |     11.208 |       11.275 | +0.106 [−0.011, +0.217]     | +0.101 [−0.005, +0.143]      |            1.71× |
| `mathMax`            |   1.999 |        5.756 |      5.772 |        4.348 | **−1.39 [−1.44, −1.30]**    | **−1.32 [−1.46, −1.27]**     |            2.18× |
| `mixedCall`          |   3.401 |        9.905 |      9.881 |        9.914 | +0.084 [−0.025, +0.199]     | +0.011 [−0.088, +0.177]      |            2.92× |
| `mutableCapture`     |   4.940 |       11.841 |     11.832 |       11.876 | +0.012 [−0.051, +0.251]     | +0.038 [−0.056, +0.187]      |            2.40× |
| `numberCall`         |   1.893 |        4.405 |      4.412 |        3.591 | **−0.812 [−0.839, −0.792]** | **−0.800 [−0.824, −0.722]**  |            1.90× |
| `objectArray`        |   2.093 |       11.561 |     11.536 |       11.559 | +0.015 [−0.012, +0.122]     | −0.016 [−0.041, +0.049]      |            5.52× |
| `objectRoundTrip`    |   2.063 |       15.669 |     15.771 |       15.704 | −0.004 [−0.464, +0.624]     | +0.090 [−0.031, +1.01]       |            7.61× |
| `receivers2`         |   4.304 |       14.748 |     14.898 |       14.130 | **−0.681 [−0.834, −0.445]** | **−0.604 [−0.719, −0.350]**  |            3.28× |
| `receivers4`         |   4.343 |       15.002 |     14.953 |       14.296 | **−0.761 [−0.814, −0.483]** | **−0.721 [−0.855, −0.381]**  |            3.29× |
| `receivers8`         |   5.500 |       34.182 |     41.774 |       40.855 | **−0.866 [−1.72, −0.372]**  | **+6.69 [+6.03, +7.36]**     |            7.43× |
| **Geomean**          |       — |            — |          — |            — | **0.937×** (−6.3%)          | **0.947×** (−5.3%)           |            4.15× |

[Paired rounds](general-runtime-step5a6-generality-darwin-arm64-v1.json)

## Octane against Node 26.13.1

Sixteen rotated fresh-process rounds (Node 26.13.1, Step 5a-5 `beaa3eef0`, A6+5a-5 `9ef32ed6c`, Step 5a-6 `a31cdc0af`) under `tools/gate/with-lock.sh both` on Apple M5 Max (clean trees, `patchSha256` empty `e3b0c442…`; load1 median `2.08`, max `3.51`; idle median `93.2%`). Every native inferior reached its entry stop and exited 42.

| Program        | Node ms/op | Step 5a-5 ms/op | A6+5a-5 ms/op | Step 5a-6 ms/op | Δ vs A6+5a-5, median [IQR]  | Δ vs Step 5a-5, median [IQR] | Step 5a-6 ÷ Node |
| -------------- | ---------: | --------------: | ------------: | --------------: | --------------------------- | ---------------------------- | ---------------: |
| `Richards`     |      0.046 |           1.387 |         0.882 |           0.884 | +0.002 [−0.000, +0.009]     | **−0.507 [−0.514, −0.493]**  |           19.36× |
| `DeltaBlue`    |      0.062 |           4.414 |         2.188 |           2.192 | −0.005 [−0.030, +0.051]     | **−2.22 [−2.25, −2.17]**     |           35.29× |
| `NavierStokes` |      1.826 |          14.318 |         5.663 |           5.640 | **−0.019 [−0.031, −0.009]** | **−8.68 [−8.72, −8.63]**     |            3.09× |
| `RayTrace`     |      0.507 |          17.488 |         7.370 |           7.398 | **+0.033 [+0.002, +0.116]** | **−10.1 [−10.2, −9.91]**     |           14.60× |
| **Geomean**    |          — |               — |             — |               — | **1.001×** (+0.1%)          | **0.479×** (−52.1%)          |           13.25× |

[Paired rounds](general-runtime-step5a6-octane-darwin-arm64-v1.json)

## Frozen v7 self-compile

Frozen `v7` with `--runtime-tree` at Step 5a-6 (`a31cdc0af`): total image size is unchanged at `53,578,178` bytes, `__DATA,__data` is bit-for-bit identical to A5/A6 (`2,256` bytes), and `__TEXT,__text` shrinks by `3,600` bytes (`30,770,496 → 30,766,896` bytes) from direct `general === reference` / `optional-reference` lowering in `packages/ts-native/src/scalar.ts` (`cacheLoopProperties` is gated on `hasScriptOperations(fn)` and skips typed AOT functions):

- `__TEXT,__text`: `30,766,896` bytes, SHA-256 `b068e3ffad5ab1d6d7e12e6b554ec928bd462be872edeb7d6887038660c3761e`
- `__TEXT,__eh_frame`: `270,360` bytes, SHA-256 `3ab852eac798ccae61b64969e378e46973e93324417d5fd6b198ac027c0e047d`
- `__TEXT,__unwind_info`: `45,300` bytes, SHA-256 `65ac9846be5f1bd6208a6a922985211d75fcae7f1f8b79d09451849458280762`
- `__DATA,__data`: `2,256` bytes, SHA-256 `4ad5a6cd559772eecc5ddffbf2b50b06c25e08b9922a572fcb1057fa6adbc5f5`

## Validation

- **Static checks** (`a31cdc0af` / `b58a29084`, `env -u TZ`): `pnpm build`, `tsc --noEmit -p tsconfig.tests.json`, `tsc --noEmit -p tsconfig.host.json`, `pnpm boundaries`, `node tools/generate-compiler-catalog.ts` (833 files, 639 explicit import grants), and `pnpm format:check` all pass.
- **Workspace unit tests** (`a31cdc0af` / `b58a29084`, `env -u TZ`):
  - New and updated tests in `packages/ir/test/optimization-property-cache.test.ts` (registered in `tools/check-test-files.json`), `packages/compiler/test/native-index.test.ts`, `packages/js-engine/test/{import-call-lowering,module-lowering,runtime-surface}.test.ts`, `tools/script-runtime-surface.test.ts` (188 functions / 215 entries), and `tools/test262-dynamic-import-host.test.ts` all pass.
  - `check-concurrent`: **6,252/6,252 pass**, 0 fail (3 skipped).
  - `check-memory`: **242/242 pass**, 0 fail (including `tools/selfhost-linked.test.ts` 19/19 and `tools/script-runtime-surface.test.ts` 1/1).
- **Native general fixtures under LLDB** (`a31cdc0af` / `b58a29084`, `TZ=UTC`, verified twice each):
  - `tools/native-general-elements.test.ts`
  - `tools/native-general-intrinsics.test.ts` (re-verified twice after `b58a29084`)
  - `tools/native-general-numbers.test.ts`
  - `tools/native-general-property-caches.test.ts`
  - `tools/native-script-cases.test.ts` (`2/2`)
  - Total: **6/6 pass**, 0 fail.
- **Darwin arm64 self-build fixpoint** (`a31cdc0af` / `b58a29084`, `TZ=UTC`): stage 1 (`52,145,418` bytes) builds stage 2 from the same frozen source snapshot under LLDB asserting stopped-at-entry (`eStateStopped`) and exit status 0 (`eStateExited`); `cmp stage1 stage2` is byte-identical (SHA-256 `75dd0da8001ac88a1393c05982b5002e6181f459d57edc697de34cca1c9d5970`).
- **Linux x86-64 stage 1 cross-bootstrap** (`a31cdc0af` / `b58a29084`, `TZ=UTC`): passes (`204,141,040` bytes, SHA-256 `1930b4bae4f56174ba55fead0ffcb72b0b5f8d61765b23e10b6e452e9ec8be7a`).

## Test262

Two explicit native selections run at Step 5a-6 (`a31cdc0af` / `b58a29084`; source snapshot `89d09c3f6a72f730…` [833 files], frozen toolchain `9b0d9b0464821dff…`, suite linking, `TZ=UTC`, `NODE_OPTIONS="--max-old-space-size=16384"`, `dirty: false`, `complete: true`), totaling **6,239/6,240 pass**, 0 failures, 0 timeouts, 0 crashes, 0 harness errors, and 1 expected unsupported module top-level-await variant:

1. **Step 5a selection (`3,514/3,514 pass`, 0 failures, 0 unsupported):** covers compound, logical, and update assignment, property accessors, `built-ins/Math`, `built-ins/Number`, `String.prototype.{charAt,charCodeAt}`, `Map.prototype.{get,set,has}`, `Set.prototype.{add,has}`, `Array` `length` and `prototype/{push,pop,shift,unshift,splice,fill,reverse,join}`, and `TypedArrayConstructors/internals/{Get,Set}`. [Report](test262-general-runtime-step5a6-native-v1.json)
2. **Array/object literal and rest-parameter selection (`2,725/2,726 pass`, 0 failures, 1 unsupported):** covers `language/expressions/array` (104/104), `language/expressions/object` (2,251/2,252 — the single unsupported variant is `cpn-obj-lit-computed-property-name-from-await-expression.js [module]`, `native module execution is not implemented`), `language/rest-parameters` (22/22), `built-ins/Array/{from,of}` (90/90, 32/32), `built-ins/Object/{keys,values,entries}` (118/118, 40/40, 42/42), and `built-ins/Reflect/ownKeys` (26/26). [Report](test262-general-runtime-step5a6-extra-native-v1.json)

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
