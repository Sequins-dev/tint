# General runtime A5 · cold paths, global cells, deep/spilled ICs, and call specialization · Darwin arm64

Step A5 of the revised plan for PR #12 on top of the unified `perf/general-runtime` baseline (`bcf773b60`, merging `origin/main` `0ed4fe783` and `origin/perf/general-runtime-arrays` `50560bd67`): keep `sink-environment-loads` out of fusable `property-load` miss-test blocks, inline global identifier caches via IR `global-cell` and enable ES module `$globalScope` caching, cache deep and dictionary-mode inherited values directly with linked 16-slot `PropertySpill` own-slot reads and String primitive / packed array shapes, specialize `call-indirect` for proven `script-entry` callees, outline `script-entry` slow/miss paths to a cold stub, fold the script-entry prologue bit-0 test, remove dead `invoke`/`constructNative` undefined-init stores, and exempt single-instruction script cache/entry intrinsics from `inline.ts` per-caller growth and `referenceAllowance` caps. Base `bcf773b60`; head `9effe80c6`. Apple M5 Max, Node 26.13.1.

Every Octane program improves with tight IQRs over 18 paired rounds (18/18 rounds ≥75% host idle, 86.7–87.4% median idle): **Richards −27.67%** (`1.997 → 1.452 ms/op`, `31.6×` Node), **RayTrace −23.71%** (`23.140 → 17.643 ms/op`, `34.3×` Node), **DeltaBlue −15.04%** (`5.501 → 4.693 ms/op`, `73.1×` Node), and **NavierStokes −2.29%** (`16.645 → 16.253 ms/op`, `8.9×` Node). On the elements and builtins suite (18 paired rounds, 86.1–87.1% median idle), previously uncached global/spilled/prototype/string builtin paths drop **3.5× to 6.5×**: **`mathFloor` −84.55%** (`47.386 → 7.298 ns`, `3.4×` Node), **`mathSqrt` −80.85%** (`48.503 → 9.254 ns`, `4.3×` Node), **`charCodeAt` −76.34%** (`34.400 → 8.152 ns`, `3.5×` Node), **`pushLength` −71.02%** (`114.907 → 33.204 ns`, `8.0×` Node), plus packed element access (`numberElementWrite` **−12.98%**, `numberElementRead` **−12.26%**, `numberElementUpdate` **−8.46%**); `numberArrayLiteral` (`+5.59%`, `+5.09 ns`) and `objectArrayLiteral` (`+6.91%`, `+7.40 ns`) pay the `arrayEmptyShape` lookup that gives packed arrays a clean `internalArrayChildShape` for `pushLength` (fixed-arity literal creation is scoped to Step 5a-3). On the generality suite (18 paired rounds, 87.6–89.3% median idle), **`mathMax` drops −81.86%** (`47.351 → 8.517 ns`, `4.1×` Node), **`numberCall` −73.71%** (`24.425 → 6.456 ns`, `3.4×` Node), **`mixedCall` −30.39%** (`20.067 → 14.050 ns`, `4.0×` Node), **`buildString` −15.10%** (`13.409 → 11.462 ns`, `1.3×` Node), **`catchInLoop` −2.52%**, and **`objectRoundTrip` −1.55%**, with one small regression on megamorphic 8-shape **`receivers8` (+5.58%**, `+2.21 ns`). On the call/loop kernels (20 paired rounds, 90.8–91.9% median idle), all eight kernels are flat or faster and untyped Tint remains ahead of Node on all eight. Every warm-call `neon` probe drops (`method(o)` **237 → 217**, `callDeep(s)` **202 → 181**, `dot(a, b)` **533 → 508**, `walk(t)` **1,319 → 1,269**, `make(v)` **479 → 466**), and `neon` `run()` drops from 8 out-of-line cache/entry calls to **0**. Frozen v7 `--runtime-tree` produces bit-for-bit identical code, data, unwind, and debug-table Mach-O sections.

## What changed

| Commit                                             | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `b5fca335e`, `bcf773b60`                           | Unify `perf/general-runtime` (A4 `ecb30e68b`) with `origin/main` (`0ed4fe783`) and `origin/perf/general-runtime-arrays` (`50560bd67`, Step 5a-2 compact fast-mode arrays and inline element/builtin intrinsics). Verified as the A5 measurement base.                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `3fff4285d`                                        | Keep `sink-environment-loads` out of single-predecessor `general-is absent` miss-test blocks and allow `closure-environment` in `property-fusion` skippable ops so fused `property-load`/`element-load` direct miss branches stay intact.                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `49e979361`                                        | Flatten `GlobalIdentifierCache` (`global`, `lexicalEpoch`, `objectEpoch`, `cell` on the site record), bind `cachedGlobalIdentifierCell` to a new IR `global-cell` instruction across IR verification, optimization, codec, AArch64, and x86-64 codegen, and declare `$globalScope = createGlobalScope($global)` in ES modules without dynamic bindings so globals (`Math`, `Number`, `Array`) hit inline.                                                                                                                                                                                                                                                                                          |
| `8ab966c4e`                                        | Cache inherited property values directly on `ScriptPropertyCache` entries (`slot === 0`, covering prototype depth up to 16, spilled prototype slots, and dictionary-mode prototypes like `Array.prototype`/`Map.prototype`/`Set.prototype`/`String.prototype`, invalidated on prototype value writes via `propertyEpoch`), replace `OrdinaryObject.internalValues` with linked 16-slot `PropertySpill` chunks with inline own-slot reads (e.g. `Math.{floor,sqrt,max}`), add a clean packed array shape (`internalArrayChildShape`), and add String primitive tag-3 IC hits (`stringShape`).                                                                                                       |
| `890b627e0`, `fa9190afa`                           | Skip redundant closure descriptor and signature checks in `call-indirect` (AArch64 and x86-64) when `scriptArguments` is present and `callee` flows from `script-entry` (`−11` instructions/call), outline `script-entry` slow/miss paths to a cold stub on AArch64 (`0` taken branches on hit), fold `scriptEntry` prologue `ubfm`+`cmp` into `tst x2, #1`, leave `invoke`/`constructNative` result temporaries uninitialized when both branches assign them, and exempt single-instruction script cache/entry intrinsic wrappers (`property-load/store`, `element-load/store`, `script-entry`, `global-cell`) from `inline.ts` per-caller `allowance` and fixed `128`-unit `referenceAllowance`. |
| `c8ff3950d`, `b03423d57`, `18e2e3f58`, `9effe80c6` | Keep A5 compiler changes in Tint's native self-hosting subset, deduplicate `globalModule` runtime entry in `tools/test262-native.ts`, keep retained cache helpers (`cachedOwnPropertyValue`, `cachedInheritedPropertyValue`, `readPropertyValueSlot`, `cachedGlobalIdentifierCell`) free of non-retained local calls, and refresh `js-engine` lowering golden hashes.                                                                                                                                                                                                                                                                                                                              |

Replacing `OrdinaryObject.internalValues` (`Value[]`) with linked `PropertySpill` chunks removes one collection anchor from the Script runtime surface (`tools/script-runtime-surface.test.ts`: `132` anchors, down from `133`; `59` collections [`50` list / `2` set / `7` map], `497` collection operations).

## Warm calls

One warm call (the 501st), entry to return with callees, single-stepped under LLDB (`tools/general-call-bench/count_call.py`) on the `neon` probe ([traces](general-runtime-a5-traces-darwin-arm64-v1.json)):

| Probe function                      | Base (`bcf773b60`) | A5 (`9effe80c6`) |           Change |
| ----------------------------------- | -----------------: | ---------------: | ---------------: |
| `method(o)`: `o.get()`              |                237 |          **217** |  **−20 (−8.4%)** |
| `make(v)`: `new Box(v)`             |                479 |          **466** |  **−13 (−2.7%)** |
| `dot(a, b)`: `a.dot(b)`             |                533 |          **508** |  **−25 (−4.7%)** |
| `callDeep(s)` (depth-2 prototype)   |                202 |          **181** | **−21 (−10.4%)** |
| `walk(t)` (3 × `isHeldOrSuspended`) |              1,319 |        **1,269** |  **−50 (−3.8%)** |
| `setState(t, v)`: `t.state = v`     |                 91 |           **90** |   **−1 (−1.1%)** |
| `Box.prototype.get`                 |                 67 |               67 |        0 (+0.0%) |
| `Vec.prototype.dot`                 |                368 |          **363** |   **−5 (−1.4%)** |
| `Task.prototype.isHeldOrSuspended`  |                291 |          **285** |   **−6 (−2.1%)** |

Breakdowns on `9effe80c6`:

- `method(o)` (`217` instructions, down from `237`): `method` caller `150` (was `170`, `−20`), `Box.prototype.get` `67` (`0`: `tst x2, #1` saves `1`, `tbnz x13, #63` own-spill check adds `1`). At the `method` call site, `script-entry` runs `18` straight-line instructions with `0` taken branches (slow/miss outlined) and specialized `call-indirect` skips closure-descriptor and signature checks completely.
- `make(v)` (`466` instructions, down from `479`): `make` caller `231` (was `243`, `−12`), `createSourceInstance` `145`, `Box` constructor `90` (was `91`, `−1`).
- `dot(a, b)` (`508` instructions, down from `533`): `dot` caller `145` (was `165`, `−20`), `Vec.prototype.dot` `363` (was `368`, `−5`).
- `callDeep(s)` (`181` instructions, down from `202`): `callDeep` caller `139` (was `159`, `−20`), `Base.prototype.deepGet` `42` (was `43`, `−1`).
- `walk(t)` (`1,269` instructions, down from `1,319`): `walk` `489` (was `520`, `−31` across 3 calls), `Task.prototype.isHeldOrSuspended` `780` (was `799`, `−19` across 3 calls).
- In `neon` `run()` (`closure@1061`), exempting single-instruction script cache/entry intrinsics from `referenceAllowance` eliminated all `8` out-of-line runtime calls (`6× resolveScriptCallEntry`, `1× cachedOwnPropertyValue`, `1× viewObjectValue` → `0`).

## Octane

18 paired rounds of unified base `bcf773b60` vs A5 `9effe80c6` under `tools/gate/with-lock.sh both` on Apple M5 Max (clean trees, `patchSha256` empty; `18/18` rounds ≥75% host idle, median idle `87.4%` base / `86.7%` A5, load1 median `2.81` / `2.82`). Medians in ms/op and median `[q1, q3]` of per-round percent and absolute change ([data](general-runtime-a5-octane-darwin-arm64-v1.json)). Bold: interquartile range excludes zero.

| Program        | Node ms/op | Base ms/op | A5 ms/op |  A5 − base (%), median [IQR] |   Δ ms/op, median [IQR] | A5 ÷ Node |
| -------------- | ---------: | ---------: | -------: | ---------------------------: | ----------------------: | --------: |
| `Richards`     |      0.046 |      1.997 |    1.452 | **−27.67% [−28.99, −26.00]** | −0.553 [−0.587, −0.518] |     31.6× |
| `DeltaBlue`    |      0.064 |      5.501 |    4.693 | **−15.04% [−16.02, −14.00]** | −0.828 [−0.881, −0.770] |     73.1× |
| `NavierStokes` |      1.833 |     16.645 |   16.253 |    **−2.29% [−2.65, −1.93]** | −0.381 [−0.441, −0.321] |      8.9× |
| `RayTrace`     |      0.514 |     23.140 |   17.643 | **−23.71% [−24.92, −22.61]** | −5.455 [−5.757, −5.220] |     34.3× |

## Elements, builtins, and creation kernels

18 paired rounds of unified base `bcf773b60` vs A5 `9effe80c6` under `tools/gate/with-lock.sh both` (`17/18` rounds ≥75% host idle, median idle `86.1%` base / `87.1%` A5, load1 median `2.49` / `2.51`). Medians in ns/iteration and median `[q1, q3]` of per-round percent and absolute change ([data](general-runtime-a5-elements-darwin-arm64-v1.json)). Bold: interquartile range excludes zero.

| Kernel                | Node ns | Base ns |   A5 ns |  A5 − base (%), median [IQR] |         Δ ns, median [IQR] | A5 ÷ Node |
| --------------------- | ------: | ------: | ------: | ---------------------------: | -------------------------: | --------: |
| `charCodeAt`          |   2.309 |  34.400 |   8.152 | **−76.34% [−76.69, −76.03]** | −26.269 [−26.520, −25.903] |      3.5× |
| `mapSetHas`           |   8.176 |  75.454 |  76.808 |    **+1.67% [+1.24, +3.15]** |    +1.269 [+0.936, +2.351] |      9.4× |
| `mathFloor`           |   2.144 |  47.386 |   7.298 | **−84.55% [−84.80, −84.29]** | −40.064 [−41.094, −39.244] |      3.4× |
| `mathSqrt`            |   2.176 |  48.503 |   9.254 | **−80.85% [−81.30, −80.63]** | −39.196 [−40.133, −38.461] |      4.3× |
| `numberArrayLiteral`  |   7.743 |  90.702 |  96.835 |    **+5.59% [+4.88, +9.45]** |    +5.094 [+4.459, +8.360] |     12.5× |
| `numberElementRead`   |   1.995 |   6.923 |   6.078 | **−12.26% [−12.88, −11.39]** |    −0.848 [−0.894, −0.782] |      3.0× |
| `numberElementUpdate` |   1.622 |   9.162 |   8.368 |    **−8.46% [−9.67, −7.25]** |    −0.767 [−0.892, −0.671] |      5.2× |
| `numberElementWrite`  |   1.769 |   6.292 |   5.453 | **−12.98% [−13.72, −12.34]** |    −0.819 [−0.863, −0.774] |      3.1× |
| `objectArrayLiteral`  |   3.889 | 107.424 | 114.483 |    **+6.91% [+5.59, +7.84]** |    +7.397 [+6.066, +8.406] |     29.4× |
| `objectElementRead`   |   1.707 |  10.780 |  10.830 |        +0.23% [−0.23, +1.16] |    +0.025 [−0.025, +0.124] |      6.3× |
| `objectLiteral`       |   4.780 |   3.496 |   3.508 |        +0.30% [−0.70, +1.16] |    +0.010 [−0.024, +0.040] |      0.7× |
| `pushLength`          |   4.155 | 114.907 |  33.204 | **−71.02% [−71.44, −70.47]** | −81.738 [−83.118, −80.561] |      8.0× |
| `setAddHas`           |   7.172 |  75.475 |  74.345 |        −1.63% [−2.24, +0.40] |    −1.233 [−1.707, +0.298] |     10.4× |

`mathFloor` (`−84.55%`) and `mathSqrt` (`−80.85%`) combine inline ES module `global-cell` reads of `Math` with linked `PropertySpill` own-slot hits on `Math.floor`/`Math.sqrt`. `charCodeAt` (`−76.34%`) hits directly on the String primitive tag-3 `stringShape` + direct inherited value. `pushLength` (`−71.02%`, `−81.7 ns`) hits directly on packed arrays' dedicated `internalArrayChildShape` + direct inherited `Array.prototype.push`; the accompanying `arrayEmptyShape` check in `createPackedArrayObject` adds `+5.1 ns` to `numberArrayLiteral` and `+7.4 ns` to `objectArrayLiteral` (whose remaining cost is `ScriptValue[]` list construction, addressed in Step 5a-3).

## Generality kernels

18 paired rounds of unified base `bcf773b60` vs A5 `9effe80c6` under `tools/gate/with-lock.sh both` (`16/18` rounds ≥75% host idle, median idle `87.6%` base / `89.3%` A5, load1 median `2.53` / `2.53`). Medians in ns/iteration and median `[q1, q3]` of per-round percent and absolute change ([data](general-runtime-a5-generality-darwin-arm64-v1.json)). Bold: interquartile range excludes zero.

| Kernel               | Node ns | Base ns |  A5 ns |  A5 − base (%), median [IQR] |         Δ ns, median [IQR] | A5 ÷ Node |
| -------------------- | ------: | ------: | -----: | ---------------------------: | -------------------------: | --------: |
| `allocateObjects`    |   5.918 |  94.826 | 95.539 |        −0.46% [−1.63, +2.46] |    −0.452 [−1.571, +2.269] |     16.1× |
| `arguments3`         |   2.149 |  22.221 | 22.455 |        +0.72% [−0.16, +1.96] |    +0.158 [−0.035, +0.448] |     10.4× |
| `arguments4`         |   2.284 |  27.569 | 27.273 |        −1.70% [−3.65, +0.26] |    −0.466 [−1.032, +0.071] |     11.9× |
| `arguments5`         |   2.282 |  33.951 | 33.688 |        −0.53% [−3.84, +0.73] |    −0.178 [−1.308, +0.245] |     14.8× |
| `arguments6`         |   2.498 |  40.821 | 40.838 |        −0.38% [−1.81, +0.26] |    −0.159 [−0.755, +0.104] |     16.3× |
| `buildString`        |   8.822 |  13.409 | 11.462 | **−15.10% [−16.41, −13.77]** |    −2.025 [−2.298, −1.831] |      1.3× |
| `builtinMethod`      |   4.104 |  29.364 | 29.715 |        +0.47% [−1.43, +2.12] |    +0.136 [−0.448, +0.618] |      7.2× |
| `catchInLoop`        |   3.312 |  19.574 | 19.107 |    **−2.52% [−4.40, −0.55]** |    −0.490 [−0.884, −0.106] |      5.8× |
| `concatenateStrings` |   6.656 |  12.624 | 12.621 |        +0.12% [−0.88, +2.93] |    +0.015 [−0.112, +0.363] |      1.9× |
| `mathMax`            |   2.076 |  47.351 |  8.517 | **−81.86% [−82.17, −81.56]** | −38.515 [−39.387, −38.072] |      4.1× |
| `mixedCall`          |   3.476 |  20.067 | 14.050 | **−30.39% [−30.77, −29.71]** |    −6.074 [−6.261, −5.957] |      4.0× |
| `mutableCapture`     |   5.118 |  13.483 | 13.419 |        −0.87% [−1.81, +0.20] |    −0.118 [−0.244, +0.026] |      2.6× |
| `numberCall`         |   1.881 |  24.425 |  6.456 | **−73.71% [−74.28, −73.49]** | −17.991 [−18.674, −17.863] |      3.4× |
| `objectArray`        |   2.132 |  14.677 | 14.699 |        −0.26% [−0.77, +0.56] |    −0.038 [−0.115, +0.082] |      6.9× |
| `objectRoundTrip`    |   2.069 |  16.071 | 15.769 |    **−1.55% [−3.90, −0.12]** |    −0.249 [−0.626, −0.018] |      7.6× |
| `receivers2`         |   4.459 |  20.433 | 20.144 |        −0.71% [−3.15, +2.81] |    −0.154 [−0.644, +0.555] |      4.5× |
| `receivers4`         |   4.539 |  20.865 | 20.679 |        −0.96% [−6.40, +0.22] |    −0.196 [−1.366, +0.046] |      4.6× |
| `receivers8`         |   5.538 |  39.764 | 42.142 |    **+5.58% [+0.98, +7.10]** |    +2.210 [+0.418, +2.797] |      7.6× |

## Call and loop kernels

20 paired rounds of unified base `bcf773b60` vs A5 `9effe80c6` under `tools/gate/with-lock.sh both` (`20/20` rounds ≥75% host idle, median idle `91.9%` base / `90.8%` A5, load1 median `3.16` / `3.25`; [data](general-runtime-a5-kernels-darwin-arm64-v1.json)). Every kernel is unchanged or faster within noise (`stringEquality` `0.944 → 0.831 ns`, `−11.46%` [IQR −13.70, +2.94]; all other seven within `±0.5%`), and untyped Tint remains ahead of Node on all eight: `array` `1.501` vs `1.815`, `closure` `2.346` vs `4.625`, `control` `0.126` vs `3.758`, `method` `2.420` vs `4.261`, `property` `1.179` vs `1.753`, `recursive` `114.031` vs `234.125`, `rest` `0.804` vs `8.690`, and `stringEquality` `0.831` vs `2.226` ns/iter.

## Frozen v7 self-compile

Built the frozen v7 compiler image with `--runtime-tree` at unified base (`bcf773b60`, `native-a5-base-bcf773b60`, `53,578,178` bytes) and A5 (`9effe80c6`, `native-a5-cand-9effe80c6`, `53,578,178` bytes). Every code, data, unwind, and debug-table Mach-O section is bit-for-bit identical:

- `__TEXT,__text`: `30,770,496` bytes at file offset `4096`, SHA-256 `6e301d3b102bcd9b53d9c80d8b4d63835a5e26a02be8794d92a8bd7a62c6a2dd`
- `__TEXT,__eh_frame`: `270,352` bytes, SHA-256 `97f0554497dcf19f31bf80d9121e0a719652019f5083a9ab6b853360fa1e5b36`
- `__TEXT,__unwind_info`: `45,300` bytes, SHA-256 `c49f8447e316a326a9b5d3beb1db12d621d68b0a7dad6e52389ebb8c22d68943`
- `__DATA,__data`: `2,256` bytes, SHA-256 `4ad5a6cd559772eecc5ddffbf2b50b06c25e08b9922a572fcb1057fa6adbc5f5`

## Validation

- **Static & workspace unit gates** (`9effe80c6`, `env -u TZ`): `pnpm typecheck` (`pnpm build && tsc -p tsconfig.tests.json && tsc -p tsconfig.host.json`), `pnpm boundaries`, `pnpm format:check`, `tools/check-test-files.ts concurrent` (**6,237 pass / 3 skipped / 0 fail**), `tools/gate-lock.test.ts` (**15/15 pass**), and `tools/check-test-files.ts memory` (**242/242 pass**, all 28 files including `selfhost-linked.test.ts`, `script-runtime-surface.test.ts`, `test262-*.test.ts`, `managed-*.test.ts`, `typescript-conformance.test.ts`).
- **Native general, script, and worker tests under LLDB** (`9effe80c6`, `TZ=UTC`, verified twice each): `tools/native-general-elements.test.ts`, `tools/native-general-intrinsics.test.ts`, `tools/native-general-numbers.test.ts`, `tools/native-general-property-caches.test.ts` (including new section 14 covering deep prototype chains, spilled own slots, `Math.{floor,sqrt,max}`, `String.prototype`, `Array.prototype`, `Map.prototype`/`Set.prototype`, and prototype mutation/deletion invalidation), `tools/native-script-cases.test.ts` (`2/2`), and `tools/native-worker-messages.test.ts` (`3/3`) — **9/9 pass**.
- **Hosted native LLDB fixtures** (`9effe80c6`, `TZ=UTC`, verified twice each): all 15 hosted fixtures (`ordinary-objects`, `arguments`, `tail-dispatch`, `promise-objects`, `promise-intrinsics`, `generator-objects`, `async-generator-objects`, `async-functions`, `async-iteration`, `await`, `shadow-realm`, `dynamic-import`, `module-lowering`, `script-jobs`, `source-tail-steps`) pass (stopped at entry, exit status 42).
- **Darwin arm64 self-build fixpoint** (`c8ff3950d`, identical compiler packages to `9effe80c6`): stage 1 (`50,329,098` bytes) builds stage 2 from the same frozen source snapshot under LLDB asserting stopped-at-entry and exit status 0; `cmp stage1 stage2` is byte-identical (SHA-256 `fc208a258b12d027e2955170932a9cfa7ff764cdaaa0f519d834aaaf293f8f6b`).
- **Linux x86-64 stage 1 cross-bootstrap** (`9effe80c6`, `TZ=UTC`): succeeds cleanly (`196,553,496` bytes, SHA-256 `5835745eaf9c7eb27ccfa0b4ec8646a683149f98b1cf2fca1365cd387dcb2c2d`), plus standalone x86-64 `emitModule` verification for `global-cell` and spilled/inherited `property-load`.

## Next (Step 5a-3 & Step 6)

- **Fixed-arity array & object literal helpers (Step 5a-3, separate stream):** `numberArrayLiteral`, `objectArrayLiteral`, and `allocateObjects` remain dominated by temporary `ScriptValue[]` argument list construction (`createArrayFromList` / `createLiteralObject`).
- **Leaf script-entry prologue/epilogue & register actuals:** `Box.prototype.get` (`67` insns) and `setState` (`90` insns) still spill all 6 register actuals (`x10..x15`), unpack `x2`, and link/unlink the 32-byte activation record even in leaf callees.
- **Megamorphic dispatch (`receivers8`, `+5.58%`):** trim the extra branch/spill work on the megamorphic miss path in `lookupCachedScriptProperty` / `cachedScriptPropertyValue`.
- **Step 6 speculative typing & inlining:** direct typed fast paths for monomorphic script functions and constructors, guarded by shape/callee identity, feeding into the existing typed IR pipeline.
