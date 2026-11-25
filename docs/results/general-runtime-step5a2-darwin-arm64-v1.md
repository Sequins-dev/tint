# General runtime step 5a-2 · compact fast-mode arrays on A3 · Darwin arm64

Step 5a-2 rebases the [step 5a](general-runtime-step5a-darwin-arm64-v1.md) inline element, builtin-call, and literal-creation work onto [A3](general-runtime-a3-darwin-arm64-v1.md) (`bee1ba669`, compact 280-byte `OrdinaryObject` with lazy `internalExoticSlots`, `internalRareSlots`, and `properties`), adapts step 5a's Map/Set intrinsic fast paths to A3's lazy exotic slots, and eliminates every per-array auxiliary allocation on fast-mode arrays:

- **Inline `length` and `lengthWritable` in `ArrayElements`** — packed arrays store their length and writability directly on `ArrayElements` without allocating a `Descriptor` record or a `properties` `Map`.
- **Lazy `properties` (`undefined`) on fast-mode arrays** — `createPackedArrayObject` constructs the same compact 280-byte `OrdinaryObject` layout as A3's `createObject` with `properties: undefined`, `internalArrayData: true`, and `internalArrayElements`, skipping `markPrototype` when `Array.prototype` is already marked.
- **One shared exotic `ObjectInternalMethods` per realm** — `arrayInternalMethods` caches a single `ObjectInternalMethods` record on `ArrayObjectHooks`, eliminating both the per-array `defineOwnProperty` closure allocation and the per-array wrapper object while preserving every invariant checked by `setProperty`, `refreshPropertyCell`, and property contracts.
- **Direct packed creation and zero-lookup appends** — empty array literals (`[]`) lower directly to `createArrayObject(0, …)` instead of allocating a throwaway native list for `createArrayFromList`; `createArrayElementsFromList` pre-sizes `Float64Array` for all-number lists and skips `Float64Array` allocation for non-number lists; `appendPackedElement` checks `elements.lengthWritable` and updates `elements.length` in place with zero `Map.get("length")` lookup.

Semantics remain strictly ECMAScript: `ordinaryGetOwnProperty`, `ordinaryDefineOwnProperty`, `ordinaryDeleteProperty`, `ordinaryHasOwnProperty`, `hasProperty`, `getProperty`, `setProperty`, `ordinaryOwnKeys`, and `unpackArrayElements` synthesize and materialize `"length"` identically to an own data property (`{ value: elements.length, writable: elements.lengthWritable, enumerable: false, configurable: false }`), and unpacking preserves `Reflect.ownKeys` order (`0..count-1`, `"length"`, non-index string expandos, symbols).

At `6e91aebb5` against A3 (`bee1ba669`) over 15 rotated paired rounds on Apple M5 Max:

- **Warm-call array creation drops 9.3–13.8× in instructions:** `makeEmpty()` (`return []`) drops from `7,808` to **`564`** (−92.8%; Step 5a was `3,739`), `makeNumbers()` (`return [1, 2, 3, 4]`) drops from `29,213` to **`2,244`** (−92.3%; Step 5a was `6,431`), and `makeObjects(o)` drops from `29,564` to **`3,172`** (−89.3%; Step 5a was `7,242`).
- **Array-literal and `push` kernels drop another 2.2–2.5× over Step 5a (7–11× over A3):** `numberArrayLiteral` drops `1,163.4 → 102.7 ns` (−1,061 ns, `10.3×` Node; Step 5a was `258.6 ns`), `objectArrayLiteral` drops `1,234.4 → 122.2 ns` (−1,121 ns, `26.4×` Node; Step 5a was `268.1 ns`), and `pushLength` drops `919.1 → 128.9 ns` (−790 ns, `27.7×` Node; Step 5a was `153.5 ns`).
- **Octane:** **DeltaBlue** nearly halves against A3 (`12.7 → 6.657 ms/op`, paired median **−6.02 ms** [IQR −6.79, −5.84], `90.9×` Node — a further −20% drop beyond Step 5a's `8.330 ms`), **NavierStokes** drops `67.7 → 18.3 ms/op` (−49.6 ms, `9.4×` Node), **RayTrace** drops `28.4 → 26.3 ms/op` (−3.10 ms, `46.8×` Node), and **Richards** moves `2.404 → 2.324 ms/op` (−0.063 ms, neutral within IQR).
- **Generality:** zero regressions across all 18 kernels (`allocateObjects` `133.0 → 92.9 ns`, `numberCall` `96.4 → 24.9 ns`, `mathMax` `131.9 → 48.8 ns`, `builtinMethod` `83.5 → 29.3 ns`, `buildString` `18.2 → 13.5 ns`, `objectArray` `16.0 → 14.9 ns`, `receivers2` `23.5 → 22.5 ns`, `receivers4` `25.3 → 23.7 ns`; all remaining kernels flat within IQR).
- **Frozen `v7 --runtime-tree`** is byte-identical across every Mach-O section (`__TEXT,__text` `f34e866923d72f4e…`), arm64 `stage1 == stage2` fixpoint is byte-identical, Linux x86-64 stage 1 cross-bootstrap passes, all static/concurrent/memory/native LLDB checks pass, and native Test262 passes **6,239/6,240** (`3,514/3,514` + `2,725/2,726`, 0 failures, 1 expected unsupported module top-level-await variant).

Branch `perf/general-runtime-arrays`. Base `bee1ba669` (`origin/perf/general-runtime`, A3 on `origin/main` `b5ff7e6e4`); candidate `6e91aebb5` (compiled/runtime binary) and `3cb403b8c` (adds the ECMA-262 `Object.isFrozen(Object.seal([]))` assertion in `tools/native-general-elements.test.ts`; `packages/` is byte-identical to `6e91aebb5`). Apple M5 Max, Node 26.13.1.

## Commits on top of A3 (`bee1ba669`)

| Commit                   | Change                                                                                                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `1a192ee19`..`60d7e0fbf` | Clean rebase of the 8 step 5a commits onto `bee1ba669` (inline `element-load`/`element-store`, general element cells, packed appends, builtin intrinsics, dense array & static-key object literals, report).  |
| `cb2a84b18`              | Adapt step 5a to A3's lazy `properties` and `internalExoticSlots` (`js-engine` Map/Set intrinsic lowering reads `internalExoticSlots?.internalMapData`/`internalSetData` directly; `array-append.ts` guard).  |
| `6e91aebb5`              | Compact fast-mode arrays with inline `length` + `lengthWritable`, lazy `properties`, shared `ObjectInternalMethods` on `ArrayObjectHooks`, direct `[]` lowering, and pre-sized `createArrayElementsFromList`. |
| `3cb403b8c`              | Assert `Object.isFrozen(Object.seal([])) === false` per ECMA-262 7.3.16 in `tools/native-general-elements.test.ts` (V8/Node returns `true` despite writable `"length"`).                                      |

No new Script runtime surface entries or collection anchors were added (`tools/script-runtime-surface.test.ts` remains 170 functions / 197 entries).

## Warm-call instruction traces

One warm call (the 501st), entry to return with callees, single-stepped under LLDB (`tools/general-call-bench/count_call.py`) on untyped debug-symbol images of A3 (`bee1ba669`) and Step 5a-2 (`6e91aebb5`). Previous Step 5a (`d8b175aa6`, pre-A3) numbers are shown for context where measured:

| Probe (source)                                          | Step 5a (`d8b175aa6`) | A3 (`bee1ba669`) | Step 5a-2 (`6e91aebb5`) | Δ vs A3              |
| ------------------------------------------------------- | --------------------: | ---------------: | ----------------------: | -------------------- |
| `makeEmpty()`: `return []`                              |                 3,739 |            7,808 |                 **564** | **−7,244 (−92.8%)**  |
| `makeNumbers()`: `return [1, 2, 3, 4]`                  |                 6,431 |           29,213 |               **2,244** | **−26,969 (−92.3%)** |
| `makeObjects(o)`: `return [o, o, o, o]`                 |                 7,242 |           29,564 |               **3,172** | **−26,392 (−89.3%)** |
| `callAdd(list, i)`: `return list[i & 3].add(i & 7) + 0` |                   711 |              769 |                 **730** | **−39 (−5.1%)**      |
| `makePair(a, b)`: `return { left: a, right: b }`        |                 1,674 |            2,555 |               **1,354** | **−1,201 (−47.0%)**  |
| `makeTriple(a)`: `return { x: a, y: a, z: a }`          |                 2,106 |            3,706 |               **1,771** | **−1,935 (−52.2%)**  |
| `makeEmptyObject()`: `return {}`                        |                   461 |              201 |                     201 | 0 (+0.0%)            |
| `makeReceiver(n)`: `return { offset: n, add(v) { … } }` |                     — |            7,979 |                   7,985 | +6 (+0.1%)           |

**Breakdown of the remaining array-literal cost:**

- `makeEmpty()` (`564` instructions): caller `114`, `createArrayObject` `126`, `createArrayWithElements` `83`, `createPackedArrayObject` `107`, `createArrayElements` `81`, cached `arrayInternalMethods` `53` — zero `Map`, descriptor, hashing, or closure allocations.
- `makeNumbers()` (`2,244` instructions): ~`800` instructions in packed array construction (`createArrayElementsFromList` `320`, `createArrayFromList` `143`, `createPackedArrayObject` `107`, `createArrayWithElements` `83`, `array-initialize` `60`, `arrayInternalMethods` `53`, `to-uint32` `36`) and ~`1,270` instructions building and reading the temporary `ScriptValue[]` argument list (`__tint_reference_list_write` `692`, `__tint_reference_list_read` `320`, `pushList` `176`, `__tint_dense_list_create` `82`). Fixed-arity literal helpers (`createArray1..4` / `createLiteralObject1..4`) are the clear next opportunity to cut the remaining list overhead in both array and static-key object literals.

## Elements, builtins, and creation kernels

Fifteen rotated fresh-process rounds (Node 26.13.1, A3 `bee1ba669`, Step 5a-2 `6e91aebb5`) under `tools/gate/with-lock.sh both` on Apple M5 Max (clean trees, `patchSha256` empty; load1 median `5.4`, max `6.0`; idle median `70.4%`). Every native inferior reached its entry stop and exited 42. Deltas are paired per round against A3 (median `[q1, q3]`); bold indicates the IQR excludes zero.

| Kernel                | Node ns |   A3 ns | Step 5a-2 ns | Δ vs A3, median [IQR]       | Step 5a-2 ÷ Node |
| --------------------- | ------: | ------: | -----------: | --------------------------- | ---------------: |
| `numberElementRead`   |   2.313 |    18.0 |        7.901 | **−10.1 [−10.9, −9.09]**    |             3.4× |
| `numberElementWrite`  |   2.034 |    28.0 |        7.155 | **−20.3 [−22.3, −19.9]**    |             3.5× |
| `numberElementUpdate` |   1.787 |   146.6 |        9.522 | **−137 [−141, −131]**       |             5.3× |
| `objectElementRead`   |   2.033 |    15.0 |         12.2 | **−2.84 [−3.26, −2.07]**    |             6.0× |
| `numberArrayLiteral`  |   9.963 | 1,163.4 |        102.7 | **−1,061 [−1,083, −1,027]** |            10.3× |
| `objectArrayLiteral`  |   4.635 | 1,234.4 |        122.2 | **−1,121 [−1,153, −1,077]** |            26.4× |
| `objectLiteral`*      |   6.534 |   1.310 |        1.271 | −0.029 [−0.105, +0.061]     |             0.2× |
| `pushLength`          |   4.659 |   919.1 |        128.9 | **−790 [−812, −765]**       |            27.7× |
| `charCodeAt`          |   2.325 |   141.1 |         37.0 | **−101 [−110, −96.5]**      |            15.9× |
| `mathFloor`           |   2.214 |   124.5 |         53.9 | **−68.6 [−73.7, −65.4]**    |            24.4× |
| `mathSqrt`            |   2.526 |   124.8 |         53.1 | **−66.4 [−71.3, −64.7]**    |            21.0× |
| `mapSetHas`           |   9.412 |   216.2 |         82.6 | **−134 [−136, −123]**       |             8.8× |
| `setAddHas`           |   7.907 |   198.8 |         81.3 | **−116 [−119, −108]**       |            10.3× |

\* `objectLiteral` is a non-escaping numeric object literal specialized to a typed record on both A3 and Step 5a-2 (`0.2×` Node). Escaping JS object literals are measured by `allocateObjects` in the generality suite below. Compared to Step 5a before compact fast-mode arrays (`258.6 ns`, `268.1 ns`, `153.5 ns`), `numberArrayLiteral` drops another **2.5×** (`258.6 → 102.7 ns`, **11.3×** faster than A3), `objectArrayLiteral` drops another **2.2×** (`268.1 → 122.2 ns`, **10.1×** faster than A3), and `pushLength` drops **16%** (`153.5 → 128.9 ns`, **7.1×** faster than A3).

[Paired rounds](general-runtime-step5a2-elements-darwin-arm64-v1.json)

## Generality kernels

Fifteen rotated fresh-process rounds (Node 26.13.1, A3 `bee1ba669`, Step 5a-2 `6e91aebb5`) under `tools/gate/with-lock.sh both` on Apple M5 Max (clean trees, `patchSha256` empty; load1 median `5.4`, max `6.6`; idle median `79.8%`). Every native inferior reached its entry stop and exited 42. Deltas are paired per round against A3 (median `[q1, q3]`); bold indicates the IQR excludes zero.

| Kernel               | Node ns | A3 ns | Step 5a-2 ns | Δ vs A3, median [IQR]      | Step 5a-2 ÷ Node |
| -------------------- | ------: | ----: | -----------: | -------------------------- | ---------------: |
| `allocateObjects`    |   6.075 | 133.0 |         92.9 | **−40.5 [−43.6, −38.3]**   |            15.3× |
| `numberCall`         |   2.155 |  96.4 |         24.9 | **−70.6 [−73.1, −69.0]**   |            11.6× |
| `mathMax`            |   2.097 | 131.9 |         48.8 | **−83.6 [−85.8, −80.6]**   |            23.3× |
| `builtinMethod`      |   4.263 |  83.5 |         29.3 | **−54.2 [−56.7, −53.0]**   |             6.9× |
| `buildString`        |   8.951 |  18.2 |         13.5 | **−4.72 [−4.91, −4.42]**   |             1.5× |
| `objectArray`        |   2.207 |  16.0 |         14.9 | **−1.11 [−1.22, −0.767]**  |             6.7× |
| `receivers2`         |   4.614 |  23.5 |         22.5 | **−0.890 [−1.60, −0.355]** |             4.9× |
| `receivers4`         |   4.580 |  25.3 |         23.7 | **−1.58 [−2.31, −1.07]**   |             5.2× |
| `receivers8`         |   5.697 |  43.9 |         42.0 | −1.12 [−3.09, +0.089]      |             7.4× |
| `arguments3`         |   2.308 |  24.0 |         24.6 | +0.715 [−0.008, +1.18]     |            10.7× |
| `arguments4`         |   2.425 |  29.2 |         29.3 | +0.200 [−0.895, +0.775]    |            12.1× |
| `arguments5`         |   2.498 |  35.1 |         36.1 | +0.827 [−0.591, +2.10]     |            14.4× |
| `arguments6`         |   2.582 |  45.0 |         44.6 | +0.365 [−0.720, +1.44]     |            17.3× |
| `catchInLoop`        |   3.354 |  21.6 |         21.2 | −0.247 [−0.838, +0.665]    |             6.3× |
| `concatenateStrings` |   6.798 |  13.8 |         13.6 | −0.035 [−0.312, +0.259]    |             2.0× |
| `mixedCall`          |   3.564 |  21.4 |         21.6 | −0.132 [−0.416, +0.775]    |             6.1× |
| `mutableCapture`     |   5.207 |  15.8 |         16.1 | +0.211 [−0.125, +0.520]    |             3.1× |
| `objectRoundTrip`    |   1.985 |  18.7 |         18.7 | +0.485 [−0.254, +0.741]    |             9.4× |

[Paired rounds](general-runtime-step5a2-generality-darwin-arm64-v1.json)

## Octane against Node 26.13.1

Fifteen rotated fresh-process rounds (Node 26.13.1, A3 `bee1ba669`, Step 5a-2 `6e91aebb5`) under `tools/gate/with-lock.sh both` on Apple M5 Max (clean trees, `patchSha256` empty; load1 median `4.8`, max `5.8`; idle median `77.1%`). Every native inferior reached its entry stop and exited 42. Deltas are paired per round against A3 (median `[q1, q3]`); bold indicates the IQR excludes zero.

| Program        | Node ms/op | A3 ms/op | Step 5a-2 ms/op | Δ vs A3, median [IQR]    | Step 5a-2 ÷ Node |
| -------------- | ---------: | -------: | --------------: | ------------------------ | ---------------: |
| `Richards`     |      0.049 |    2.404 |           2.324 | −0.063 [−0.107, +0.013]  |            47.2× |
| `DeltaBlue`    |      0.073 |     12.7 |           6.657 | **−6.02 [−6.79, −5.84]** |            90.9× |
| `NavierStokes` |      1.954 |     67.7 |            18.3 | **−49.6 [−53.6, −47.6]** |             9.4× |
| `RayTrace`     |      0.562 |     28.4 |            26.3 | **−3.10 [−3.76, −2.23]** |            46.8× |

DeltaBlue allocates small arrays (`OrderedCollection` backing lists and plans) heavily on every iteration; compact fast-mode arrays cut another `1.67 ms/op` (−20.1%) beyond Step 5a's `8.330 ms/op`, nearly halving A3's `12.7 ms/op`.

[Paired rounds](general-runtime-step5a2-octane-darwin-arm64-v1.json)

## Frozen v7 self-compile

Frozen `v7` with `--runtime-tree`, comparing A3 (`bee1ba669`) and Step 5a-2 (`6e91aebb5`): both images are `53,413,554` bytes and every Mach-O code and data section is bit-for-bit identical:

- `__TEXT,__text`: `30,702,976` bytes, SHA-256 `f34e866923d72f4e…`
- `__TEXT,__eh_frame`: `270,680` bytes, SHA-256 `5a6370012f45f338…`
- `__TEXT,__unwind_info`: `45,300` bytes, SHA-256 `9ce2a20b156a28bc…`
- `__DATA,__data`: `2,256` bytes, SHA-256 `4ad5a6cd559772ee…`

## Validation

- **Static checks** (`3cb403b8c`): `pnpm build`, `tsc --noEmit -p tsconfig.tests.json`, `tsc --noEmit -p tsconfig.host.json`, `pnpm boundaries`, `node tools/generate-compiler-catalog.ts` diff check (`CATALOG_OK`), and `pnpm format:check` all pass.
- **Workspace unit tests** (`3cb403b8c`):
  - `packages/js-runtime/test/ordinary-object-arrays.test.ts` (verifies lazy `properties === undefined`, shared `internalMethods` across instances, inline `"length"` descriptor/delete/freeze/seal/prototype inheritance, and expando-before-unpack `Reflect.ownKeys` order)
  - `selfhost-linked.test.ts` ("complete native compiler pipeline", 1/1)
  - `storage_tests` (`packages/ir/test/function-store.test.ts`, `tools/function-store-files.test.ts`, 7/7)
  - `check-concurrent`: **6,208/6,208 pass**, 0 fail (3 skipped)
  - `check-memory`: **242/242 pass**, 0 fail (including `tools/script-runtime-surface.test.ts` 1/1 at 170 functions / 197 entries and `tools/test262-dynamic-import-host.test.ts` 15/15)
- **Native general fixtures under LLDB** (`TZ=UTC`, verified twice each):
  - `tools/native-general-elements.test.ts` (including inline `"length"` descriptor/seal/freeze/delete, expando-before-unpack `Reflect.ownKeys`, and mixed literals; asserts `Object.isFrozen(Object.seal([])) === false` per ECMA-262 7.3.16 because V8/Node erroneously returns `true` despite writable `"length"`)
  - `tools/native-general-intrinsics.test.ts` (including A3 lazy `internalExoticSlots` Map/Set inline calls)
  - `tools/native-general-numbers.test.ts`
  - `tools/native-general-property-caches.test.ts`
  - `tools/native-script-cases.test.ts` (2/2)
- **Darwin arm64 self-build fixpoint** (`6e91aebb5`, identical `packages/` to `3cb403b8c`): stage 1 (`48,562,314` bytes) builds stage 2 from the same frozen source snapshot under LLDB asserting stopped-at-entry (`eStateStopped`) and exit status 0 (`eStateExited`); `cmp stage1 stage2` is byte-identical (SHA-256 `494afa2b8d2f1061388b20ae578e5be315a3ab0804cf235aebfc82da1d1dbaad`).
- **Linux x86-64 stage 1 cross-bootstrap** (`6e91aebb5`): passes (`188,396,832` bytes).

## Test262

Two explicit native selections run at Step 5a-2 (`6e91aebb5`, identical `packages/` to `3cb403b8c`; pinned Test262 checkout `91c70759`, source snapshot `62fa56f6ee7b8169…` [829 files], frozen toolchain `a50e45f21d2fb01a…`, suite linking, `TZ=UTC`, `dirty: false`, `complete: true`), totaling **6,239/6,240 pass**, 0 failures, 0 timeouts, 0 crashes, 0 harness errors, and 1 expected unsupported module top-level-await variant:

1. **Step 5a selection (`3,514/3,514 pass`, 0 failures, 0 unsupported):** covers compound, logical, and update assignment, property accessors, `built-ins/Math`, `built-ins/Number`, `String.prototype.{charAt,charCodeAt}`, `Map.prototype.{get,set,has}`, `Set.prototype.{add,has}`, `Array` `length` and `prototype/{push,pop,shift,unshift,splice,fill,reverse,join}`, and `TypedArrayConstructors/internals/{Get,Set}`. [Report](test262-general-runtime-step5a2-native-v1.json)
2. **Array/object literal and rest-parameter selection (`2,725/2,726 pass`, 0 failures, 1 unsupported):** covers `language/expressions/array` (104/104), `language/expressions/object` (2,251/2,252 — the single unsupported variant is `cpn-obj-lit-computed-property-name-from-await-expression.js [module]`, `native module execution is not implemented`), `language/rest-parameters` (22/22), `built-ins/Array/{from,of}` (90/90, 32/32), `built-ins/Object/{keys,values,entries}` (118/118, 40/40, 42/42), and `built-ins/Reflect/ownKeys` (26/26). [Report](test262-general-runtime-step5a2-extra-native-v1.json)

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
