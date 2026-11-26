# Untyped Octane M2 · Inline constructors, transactional methods, loop property caches, and fast array/Math ops · Darwin arm64

Milestone 2 of the untyped Octane optimization stream on top of `main` (`6d87a9258`): inline direct `ConstructSite` ordinary-object allocation (`1..8` fields + conditional tails) and Prototype.js-style `Class.create()` forwarding constructors (`this.initialize.apply(this, arguments)`), staged-commit transactional method and free-call inlining with aliasing-safe read-after-write and exact mid-method throw rollback preserving `Error.stack`, script object allocator IR inlining (`createLiteralObject1..4`, `createConstructedObject1..8`, gated on `hasScriptEntries`), slot-copy and `record-read` closure devirtualization (`packages/ir/src/optimization/closures.ts`, gated on `hasScriptEntries`), loop property-cache disjoint-store disambiguation and 1-hop chaining (`packages/ir/src/optimization/property-cache.ts`), monomorphic `ElementCell.elementValue` + fast steady-state general-array `push`/`pop` (`packages/js-runtime/src/objects/array-append.ts`), guarded direct `new Array()` and `Math.pow` fast paths, and direct `general` `null` representation in `scriptEntry` functions (`packages/ts-native/src/closure/lowering/index.ts`). Base `6d87a9258`; head `c1b017635`. Apple M5 Max, Node 26.13.1.

On Octane (18 paired rounds, 18/18 ≥75% host idle, 93.9% base / 94.1% M2 median idle), **all three OOP and allocation-heavy programs drop sharply**: **`RayTrace` improves −37.38%** (`6.239 → 3.920 ms/op`, `7.8×` Node, down from `12.4×`), **`DeltaBlue` improves −32.92%** (`1.955 → 1.310 ms/op`, `21.0×` Node, down from `32.0×`), **`Richards` improves −26.68%** (`0.845 → 0.619 ms/op`, `13.6×` Node, down from `18.4×`), and **`NavierStokes` stays flat** (`2.943 → 2.941 ms/op`, `−0.07%`, `1.6×` Node). On the generality suite (18 paired rounds, 18/18 ≥75% idle), **13 of 18 kernels improve with IQRs excluding zero**: **`arguments3` drops −82.46%** (`15.385 → 2.700 ns`, `1.2×` Node), **`arguments4` drops −82.18%** (`17.603 → 3.141 ns`, `1.5×` Node), **`arguments5` drops −80.88%** (`19.616 → 3.743 ns`, `1.6×` Node), **`arguments6` drops −79.95%** (`21.648 → 4.336 ns`, `1.9×` Node), **`catchInLoop` drops −69.29%** (`19.513 → 5.982 ns`, `1.9×` Node), **`mixedCall` drops −40.14%** (`8.106 → 4.844 ns`, `1.4×` Node), **`objectRoundTrip` drops −33.04%** (`14.789 → 9.927 ns`, `4.9×` Node), **`receivers8` drops −24.15%** (`36.957 → 28.000 ns`, `5.1×` Node), **`allocateObjects` drops −14.82%** (`49.917 → 43.427 ns`, `7.4×` Node, recovering M1's `+7.49%` regression and beating pre-M1), **`objectArray` drops −9.82%**, **`receivers2` drops −5.97%**, **`receivers4` drops −4.69%**, and **`builtinMethod` drops −2.59%**, while `numberCall` rises `+18.40%` (`+0.599 ns`, `2.1×` Node). On elements/builtins/creation (18 paired rounds, 18/18 ≥75% idle), **`objectElementRead` drops −11.16%** (`7.891 → 7.055 ns`, `4.3×` Node), **`setAddHas` drops −4.32%**, and **`mapSetHas` drops −2.44%** (`1.0×` Node). Call and loop kernels (20 paired rounds, 20/20 ≥75% idle) remain ahead of Node across all eight benchmarks (`0.03×`–`0.9×` Node), with `stringEquality` dropping **−3.71%** (`0.4×` Node). `string-bench --suite general` (18 paired rounds, 18/18 ≥75% idle) is essentially flat (`json` `−0.23%`, `upperCase` `+1.37%`). Typed AOT outputs — **frozen v7 `--runtime-tree`** and **`kernels` typed** — produce **bit-for-bit identical** `__TEXT,__text`, `__TEXT,__eh_frame`, `__TEXT,__unwind_info`, and `__DATA,__data` Mach-O sections versus `main` (`6d87a9258`). Both Darwin arm64 `stage1 == stage2` and native `stage1 --target linux-x86_64` cross-emission reproduce their stage-1 images byte for byte under LLDB.

## What changed

| Commit      | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `c1b017635` | Add `ConstructSite` (`packages/js-runtime/src/objects/operations.ts`) and `warmConstructSite`, `createConstructedObject1..8`, and `warmOrdinaryDataProperty` (`packages/js-runtime/src/objects/values.ts`) so warmed constructors allocate ordinary objects directly in their final shape after checking the prototype chain for exotic objects, accessors, and non-writable data properties. Extract cold miss helpers on `createLiteralObject1..4` and teach `inlineSmallFunctions` (`packages/ir/src/optimization/inline.ts`, gated on `hasScriptEntries`) to inline script object allocators into `scriptEntry` callers up to a bounded per-caller cap. Add `packages/js-engine/src/lowering/inline-methods.ts` and integrate direct `ConstructSite` / `markForwardingConstructor` (`Class.create()`) construction, staged-commit transactional method and free-call inlining (aliasing-safe read-after-write, short-circuit `&&`/` |     | `, freshly-constructed write coalescing, and mid-method throw rollback preserving partial writes and `Error.stack`), guarded `new Array()`and`Math.pow`fast paths, and shared property/construct/literal sites in`packages/js-engine/src/lowering/index.ts`. Extend `devirtualizeClosureCalls` (`packages/ir/src/optimization/closures.ts`, gated on `hasScriptEntries`) with slot-copy and `record-read`propagation, extend`cacheLoopProperties` (`packages/ir/src/optimization/property-cache.ts`) with `analyzeModulePropertySites`disjoint-store disambiguation and 1-hop cached property chaining, and guard`scriptEntry`record-read verification budgets in`branch-threading.ts`and`record-access.ts`. Rename `ElementCell.value`to`elementValue`, add fast steady-state packed general-array `push`in`scriptArrayPush` (`packages/js-runtime/src/objects/array-append.ts`), lower `null`directly as`general`in`scriptEntry` functions (`packages/ts-native/src/closure/lowering/index.ts`), regenerate `packages/compiler/src/catalog.ts`, and add IR unit and native LLDB semantic tests (`packages/ir/test/optimization-inline.test.ts`, `packages/ir/test/optimization-property-cache.test.ts`, `tools/native-general-property-caches.test.ts`, `tools/native-script-cases.test.ts`). |

## Octane

18 paired rounds of `main` base `6d87a9258` vs M2 `c1b017635` under `tools/gate/with-lock.sh both` on Apple M5 Max (clean trees, `patchSha256` empty; `18/18` rounds ≥75% host idle, median idle `93.9%` base / `94.1%` M2, load1 median `2.16` / `2.20`). Medians in ms/op and median `[q1, q3]` of per-round percent and absolute change ([data](untyped-octane-m2-octane-darwin-arm64-v1.json)). Bold: interquartile range excludes zero.

| Program        | Node ms/op | Base ms/op | M2 ms/op |  M2 − base (%), median [IQR] |   Δ ms/op, median [IQR] | M2 ÷ Node |
| -------------- | ---------: | ---------: | -------: | ---------------------------: | ----------------------: | --------: |
| `Richards`     |      0.046 |      0.845 |    0.619 | **−26.68% [−27.55, −26.10]** | −0.224 [−0.233, −0.217] |     13.6× |
| `DeltaBlue`    |      0.062 |      1.955 |    1.310 | **−32.92% [−33.33, −32.52]** | −0.644 [−0.654, −0.632] |     21.0× |
| `NavierStokes` |      1.829 |      2.943 |    2.941 |        −0.07% [−0.32, +0.16] | −0.002 [−0.009, +0.005] |      1.6× |
| `RayTrace`     |      0.504 |      6.239 |    3.920 | **−37.38% [−37.74, −36.48]** | −2.325 [−2.355, −2.285] |      7.8× |

All three OOP/allocation-heavy Octane programs drop sharply with tight, non-overlapping IQRs (`RayTrace` `−37.38%`, `DeltaBlue` `−32.92%`, `Richards` `−26.68%`) while `NavierStokes` remains flat at `1.6×` Node.

## Generality kernels

18 paired rounds of `main` base `6d87a9258` vs M2 `c1b017635` under `tools/gate/with-lock.sh both` (`18/18` rounds ≥75% host idle, median idle `94.7%` base / `94.6%` M2, load1 median `1.72` / `1.68`). Medians in ns/iteration and median `[q1, q3]` of per-round percent and absolute change ([data](untyped-octane-m2-generality-darwin-arm64-v1.json)). Bold: interquartile range excludes zero.

| Kernel               | Node ns | Base ns |  M2 ns |  M2 − base (%), median [IQR] |         Δ ns, median [IQR] | M2 ÷ Node |
| -------------------- | ------: | ------: | -----: | ---------------------------: | -------------------------: | --------: |
| `allocateObjects`    |   5.837 |  49.917 | 43.427 | **−14.82% [−17.75, −11.96]** |    −7.467 [−8.823, −5.972] |      7.4× |
| `arguments3`         |   2.174 |  15.385 |  2.700 | **−82.46% [−82.59, −82.06]** | −12.672 [−12.798, −12.617] |      1.2× |
| `arguments4`         |   2.100 |  17.603 |  3.141 | **−82.18% [−82.42, −82.02]** | −14.452 [−14.565, −14.349] |      1.5× |
| `arguments5`         |   2.305 |  19.616 |  3.743 | **−80.88% [−80.97, −80.72]** | −15.850 [−15.917, −15.707] |      1.6× |
| `arguments6`         |   2.341 |  21.648 |  4.336 | **−79.95% [−80.10, −79.82]** | −17.317 [−17.604, −17.158] |      1.9× |
| `buildString`        |   8.491 |   5.350 |  5.369 |        +0.30% [−1.35, +1.70] |    +0.016 [−0.072, +0.091] |      0.6× |
| `builtinMethod`      |   4.026 |   5.801 |  5.639 |    **−2.59% [−4.19, −1.47]** |    −0.150 [−0.243, −0.085] |      1.4× |
| `catchInLoop`        |   3.153 |  19.513 |  5.982 | **−69.29% [−69.48, −69.03]** | −13.478 [−13.615, −13.340] |      1.9× |
| `concatenateStrings` |   6.510 |  10.754 | 10.815 |        +0.46% [−0.14, +1.15] |    +0.049 [−0.015, +0.124] |      1.7× |
| `mathMax`            |   2.033 |   4.466 |  4.495 |    **+0.69% [+0.50, +3.44]** |    +0.031 [+0.022, +0.155] |      2.2× |
| `mixedCall`          |   3.457 |   8.106 |  4.844 | **−40.14% [−40.37, −39.99]** |    −3.255 [−3.274, −3.232] |      1.4× |
| `mutableCapture`     |   4.874 |  11.344 | 11.575 |    **+1.56% [+1.16, +3.46]** |    +0.179 [+0.131, +0.386] |      2.4× |
| `numberCall`         |   1.805 |   3.241 |  3.854 | **+18.40% [+16.93, +19.95]** |    +0.599 [+0.556, +0.638] |      2.1× |
| `objectArray`        |   2.116 |  10.850 |  9.790 |   **−9.82% [−10.75, −7.48]** |    −1.064 [−1.179, −0.798] |      4.6× |
| `objectRoundTrip`    |   2.009 |  14.789 |  9.927 | **−33.04% [−37.11, −31.69]** |    −4.886 [−5.912, −4.604] |      4.9× |
| `receivers2`         |   4.387 |  15.673 | 14.809 |    **−5.97% [−8.12, −3.10]** |    −0.955 [−1.276, −0.479] |      3.4× |
| `receivers4`         |   4.434 |  15.642 | 14.726 |    **−4.69% [−9.03, −1.53]** |    −0.729 [−1.453, −0.235] |      3.3× |
| `receivers8`         |   5.467 |  36.957 | 28.000 | **−24.15% [−24.95, −23.71]** |    −8.856 [−9.247, −8.742] |      5.1× |

Inlining small script callees and constructors collapses `arguments3`–`arguments6` by `−79.95%` to `−82.46%` (`1.2×`–`1.9×` Node), `catchInLoop` by `−69.29%`, `mixedCall` by `−40.14%`, `objectRoundTrip` by `−33.04%`, `receivers8` by `−24.15%`, `allocateObjects` by `−14.82%` (erasing M1's `+7.49%` regression), `objectArray` by `−9.82%`, and `receivers2`/`receivers4` by `−5.97%`/`−4.69%`. `numberCall` (`+18.40%`, `+0.599 ns`, `2.1×` Node) reflects extra register/guard pressure in the small numeric-call loop and is tracked for Milestone 3.

## Elements, builtins, and creation kernels

18 paired rounds of `main` base `6d87a9258` vs M2 `c1b017635` under `tools/gate/with-lock.sh both` (`18/18` rounds ≥75% host idle, median idle `94.7%` base / `94.0%` M2, load1 median `2.04` / `2.08`). Medians in ns/iteration and median `[q1, q3]` of per-round percent and absolute change ([data](untyped-octane-m2-elements-darwin-arm64-v1.json)). Bold: interquartile range excludes zero.

| Kernel                | Node ns | Base ns |  M2 ns | M2 − base (%), median [IQR] |      Δ ns, median [IQR] | M2 ÷ Node |
| --------------------- | ------: | ------: | -----: | --------------------------: | ----------------------: | --------: |
| `charCodeAt`          |   2.056 |   3.696 |  3.668 |       −0.97% [−2.16, +2.06] | −0.036 [−0.080, +0.074] |      1.8× |
| `mapSetHas`           |   8.061 |   8.128 |  7.930 |   **−2.44% [−3.53, −1.16]** | −0.198 [−0.288, −0.094] |      1.0× |
| `mathFloor`           |   2.108 |   4.599 |  4.601 |       −0.00% [−0.59, +0.47] | −0.000 [−0.027, +0.021] |      2.2× |
| `mathSqrt`            |   2.191 |   2.610 |  2.604 |   **−0.20% [−0.53, −0.04]** | −0.005 [−0.014, −0.001] |      1.2× |
| `numberArrayLiteral`  |   7.598 |  37.074 | 37.385 |       +0.95% [−1.40, +3.52] | +0.352 [−0.527, +1.284] |      4.9× |
| `numberElementRead`   |   1.970 |   1.243 |  1.261 |       +0.72% [−2.19, +2.66] | +0.009 [−0.028, +0.033] |      0.6× |
| `numberElementUpdate` |   1.599 |   1.242 |  1.255 |       +0.18% [−0.31, +1.38] | +0.002 [−0.004, +0.017] |      0.8× |
| `numberElementWrite`  |   1.743 |   1.248 |  1.250 |       −0.05% [−0.80, +2.07] | −0.001 [−0.010, +0.026] |      0.7× |
| `objectArrayLiteral`  |   3.660 |  41.507 | 41.774 |   **+0.68% [+0.34, +1.42]** | +0.281 [+0.141, +0.586] |     11.4× |
| `objectElementRead`   |   1.635 |   7.891 |  7.055 | **−11.16% [−12.33, −9.77]** | −0.881 [−1.000, −0.762] |      4.3× |
| `objectLiteral`       |   4.589 |   4.115 |  4.116 |       −0.07% [−0.85, +0.46] | −0.003 [−0.035, +0.019] |      0.9× |
| `pushLength`          |   3.916 |  10.776 | 10.996 |   **+1.85% [+0.09, +2.75]** | +0.198 [+0.010, +0.296] |      2.8× |
| `setAddHas`           |   6.926 |   8.306 |  7.960 |   **−4.32% [−5.87, −2.59]** | −0.358 [−0.499, −0.213] |      1.1× |

Renaming `ElementCell.value` to `elementValue` keeps packed general-element reads monomorphic, dropping `objectElementRead` by `−11.16%` (`7.891 → 7.055 ns`), while `setAddHas` (`−4.32%`) and `mapSetHas` (`−2.44%`, `1.0×` Node) also improve.

## Call and loop kernels & `string-bench`

- **Call and loop kernels** (20 paired rounds, `20/20` ≥75% host idle, median idle `94.4%` base / `94.3%` M2, load1 `1.91` / `1.92`; [data](untyped-octane-m2-kernels-darwin-arm64-v1.json)): all eight untyped kernels stay ahead of Node (`0.03×`–`0.9×`): `array` `1.571` vs `1.789` (`0.9×`, `−0.61%`), `closure` `2.327` vs `4.555` (`0.5×`, **−0.98%**), `control` `0.132` vs `3.851` (`0.03×`, `+0.008 ns`), `method` `2.426` vs `4.250` (`0.6×`, `−1.94%`), `property` `1.184` vs `1.750` (`0.7×`, `+0.36%`), `recursive` `113.979` vs `230.802` (`0.5×`, **−0.41%**), `rest` `0.796` vs `8.579` (`0.1×`, `+0.03%`), and `stringEquality` `0.798` vs `2.189` (`0.4×`, **−3.71%**) ns/iter.
- **`string-bench --suite general`** (18 paired rounds, `18/18` ≥75% host idle, median idle `93.4%` base / `93.4%` M2, load1 `2.55` / `2.61`; [data](untyped-octane-m2-string-general-darwin-arm64-v1.json)): `upperCase` `0.834 → 0.847 ms` (`+1.37%` `[+0.63, +2.15]`, `4.78×` Node) and `json` `83.742 → 83.530 ms` (`−0.23%` `[−0.60, +0.04]`, `10.04×` Node).

## Typed AOT invariance (frozen v7, `kernels`)

Typed AOT images produce **bit-for-bit identical** `__TEXT,__text`, `__TEXT,__eh_frame`, `__TEXT,__unwind_info`, and `__DATA,__data` Mach-O sections between `main` (`6d87a9258`) and M2 (`c1b017635`):

- **Frozen v7 `--runtime-tree`** (`53,631,538` bytes):
  - `__TEXT,__text`: `31,432,528` bytes, SHA-256 `45bd0e9aa9e6aba6ec78a0b8472a618c25566aa5cdd60553e4e85fced3c187fe`
  - `__TEXT,__eh_frame`: `272,104` bytes, SHA-256 `f988648da6926ed8c610496b39ece029d32ed5b6d050b6b676a58d568991c432`
  - `__TEXT,__unwind_info`: `45,636` bytes, SHA-256 `1779c89a1f65a846ceb6f9a0900a48af12d9f770241435b31c766d01d692f425`
  - `__DATA,__data`: `2,400` bytes, SHA-256 `e2eb9763940c165642d818b5eff6c5437e73d22d840f2443047c81e81c35d07c`
- **`kernels` typed** (`777,065` bytes, full image SHA-256 `36ac9a8f9752bdd230c75e0673d763bd7b7bbffde1db319fcf849998eb72da75` identical):
  - `__TEXT,__text`: `713,368` bytes, SHA-256 `83e9941d3c42f1961501c2c22a08a4f3960eb5b130b09b270c4d1e9eb747495e`
  - `__TEXT,__eh_frame`: `17,152` bytes, SHA-256 `3992be195d6976a823f7aa9332a35c9ecbf0ee1919aa81a94de669cf4c9892b1`
  - `__TEXT,__unwind_info`: `2,952` bytes, SHA-256 `93e9fb10115767c2bd642dbbae947c42bfc350e1704adb0b020f86b643b9af50`
  - `__DATA,__data`: `112` bytes, SHA-256 `1ed8b47d15399fdf6a95800e42719cfb06121efd260bea951866bc04f7486662`
- _(Note: `tools/string-bench/bench.ts prepare ... --suite typed` has a pre-existing failure on clean `main` `6d87a9258` with `fixture:2947:3024: parameter count does not match context`, so typed AOT invariance is verified on frozen v7 `--runtime-tree` and `kernels` typed.)_

## Validation

- **Static & workspace unit gates** (`c1b017635`): `pnpm build`, `tsc --noEmit -p tsconfig.tests.json`, `tsc --noEmit -p tsconfig.host.json`, `pnpm boundaries`, `pnpm format:check`, `packages/ir/test/optimization-{inline,closures,property-cache}.test.ts` (**46/46 pass**), `tools/selfhost-linked.test.ts` (**19/19 pass**), `tools/check-test-files.ts concurrent` (**6,363 pass / 3 skipped / 0 fail**), and `tools/check-test-files.ts memory` (**242/242 pass**).
- **Native general, script, and worker tests under LLDB** (`c1b017635`, `TZ=UTC`): `tools/native-general-elements.test.ts`, `tools/native-general-intrinsics.test.ts`, `tools/native-general-numbers.test.ts`, `tools/native-general-property-caches.test.ts` (17 sections including direct `ConstructSite` 1..8 fields and prototype/writable/setter/primitive/`Proxy`/`Reflect.construct` invalidations, `Class.create()` forwarding + `initialize`/`Function.prototype.apply` invalidations, staged-commit transactional methods with aliasing, read-after-write, `&&`/`||`, mid-method throw rollback preserving partial writes and `Error.stack`, `Set.prototype.add` coexistence, freshly-constructed write coalescing, general-array `push`/`pop` + frozen/read-only-length/prototype-setter invalidations, shadowed `new Array()`, `Math.pow` edge cases & override, script `null`, and loop property-cache disambiguation + 1-hop chaining), `tools/native-script-cases.test.ts` (12 script sections including sloppy Script-goal `ConstructSite`, `Class.create()` forwarding + transactional throw, and `globalThis` global-cell invalidation in cached property loops), and `tools/native-worker-messages.test.ts` (**5/5 pass**) — **all pass**.
- **Hosted native LLDB fixtures** (`TZ=UTC`, verified under LLDB asserting stopped-at-entry and exit status 42): `ordinary-objects`, `arguments`, `native-arguments` (with `--debug-symbols -c`), `tail-dispatch`, `tail-call-apply`, `stack-traces` (typed + general uncaught-throw traces), `tail-transfer-gc`, `source-tail-steps`, and `script-jobs` — **9/9 pass**.
- **Darwin arm64 self-build fixpoint** (`c1b017635`, `TZ=UTC`): stage 1 (`62,366,346` bytes) builds stage 2 from the same frozen source snapshot under LLDB asserting stopped-at-entry and exit status 0; `cmp stage1 stage2` is byte-identical (SHA-256 `e7212eb25815c4d6277e5fbf57be3b95c43685c5ba8c8f6e67c8ff400fd0e4a4`).
- **Linux x86-64 cross-bootstrap & native cross-emission fixpoint** (`c1b017635`, `TZ=UTC`): Node-hosted `--target linux-x86_64` builds `stage1-x64` (`268,570,232` bytes, SHA-256 `78be552aef317e0dd0c30b3940fd52c583debc0fef65e1747e2273f559d7cf38`), and native Darwin arm64 `stage1-darwin` under LLDB (`--target linux-x86_64`, stopped at entry, exit status 0) emits `stage2-x64` byte-for-byte identical to `stage1-x64`.

## Next

- **Milestone 3 (Direct-call / Polymorphic Method Specialization, Receiver-Shape CSE & Allocation Elision):** extend method specialization and receiver-shape CSE across deeper call graphs (`DeltaBlue` `21.0×`, `Richards` `13.6×`, `RayTrace` `7.8×`, `receivers2`/`receivers4`), eliminate remaining boxed-array and constructor overhead (`objectArrayLiteral` `11.4×`, `numberArrayLiteral` `4.9×`, `allocateObjects` `7.4×`), and investigate the `+0.599 ns` regression in `numberCall`.
