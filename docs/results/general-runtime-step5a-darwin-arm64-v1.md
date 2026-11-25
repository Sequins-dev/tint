# General runtime step 5a · inline elements and builtin calls on Darwin arm64

Step 5a of the [route to parity](../design-general-runtime-rearchitecture.md#route-to-parity-2026-11-23): untyped code reads and overwrites packed number elements inline, keeps general elements in updatable cells, appends to packed arrays in place, creates dense array literals and static-key object literals directly, reads string code units and array lengths inline, and performs calls of common builtins (Math methods, `Number`, `String.prototype.charCodeAt`/`charAt`, `Map`/`Set` `get`/`has`/`set`/`add`, `Array.prototype.push`) inline when the callee is the realm's own function. Semantics stay exactly JavaScript: every fast path is guarded and misses to the existing generic path. At the rebased head (`698594cb5` / `848f04839`) against `perf/general-runtime` `1f475dfe0` + `origin/main` `b5ff7e6e4` (`d6c6453ad`), every Octane program improves: NavierStokes drops from 64.3 to 17.0 ms/op (paired median −47.4 ms [IQR −47.5, −46.9]), DeltaBlue from 12.3 to 8.33 ms (−3.94 ms), RayTrace from 29.7 to 26.5 ms (−3.09 ms), and Richards from 2.29 to 2.24 ms (−0.063 ms); dense array literals drop 4.4–4.6× (1,138 → 259 ns and 1,237 → 268 ns), `push`+`length` drops 5.9× (911 → 154 ns), `allocateObjects` drops 30% (134 → 94 ns), builtin calls drop 50–125 ns, and `a[i] += v` drops 15× (144 → 9.6 ns). Tint remains 1.6× (`buildString`) to 131× (`DeltaBlue`) slower than Node 26.13.1 on these benchmarks (below the parity landing bar); the remaining gaps are listed under "Dependencies".

Branch `perf/general-runtime-arrays`. Slice 1 (elements, builtins, lengths) was measured at `c1637b389` against `perf/general-runtime` `9b28147e0` and at `7adf28aa0` against `687508045`; slice 2 (cells, appends) at `465cd30b8`; the regressions those runs exposed were fixed (`af1ecf359`/`9efd5732f`, `524e0f43b`/`d7fc17d53`), measured at `d7fc17d53` against `37bdaf804`. After the CI pipeline landed on `main` (`b5ff7e6e4`), the branch was cleanly rebased as a linear stack (`9b061f67a`..`848f04839`) on top of `d6c6453ad` (`origin/perf/general-runtime` `1f475dfe0` merged with `origin/main` `b5ff7e6e4`), incorporating the array/object creation follow-up and the numeric-leaf bare-index compile fix (`9fe5ec2ed`).

## Changes

- **Element storage.** `ArrayElements` keeps numbers in a `Float64Array` (its length is the capacity) with `numberCount`, the element count while every element is a Number, which is zero once general storage holds the elements; so one compare decides whether an index is a packed number element. An emptied array starts over with number storage. Packed elements also mirror the array's `length`, refreshed by every length definition (`defineLength` in `arrays.ts`).
- **IR `element-load` and `element-store`** (opcodes 120 and 121). `element-load` returns the packed binary64 element of an object value or the absent value; `element-store` overwrites one with a Number and returns whether it did. Both check the object tag, the `OrdinaryObject` record descriptor, the elements reference, an integer index (exact integers compare unsigned; any other number must convert back exactly, so −0 is element 0 and NaN misses) below `numberCount`, then address the storage. No write barrier is needed (raw binary64 words). AArch64 and x86-64 emit both inline; on AArch64 a miss branches straight to the block's slow successor (`property-fusion.ts` now treats element loads and stores like cached property accesses), and both are transparent to temporary register homes (x9–x13, d0, d1 only). The bindings (`packedNumberElement`, `absentElementValue`, `storePackedNumberElement` in `js-runtime/src/objects/element-access.ts`) carry portable bodies for hosted execution.
- **Lowering.** Computed reads try `element-load` (a non-Number key passes index −1, which no element has), then a String's code unit for an integer below its length, then the existing packed general element path, then `readObjectValuePropertyKey`. Computed writes try `element-store`, then `writeObjectValuePropertyKey`. Read-modify-writes (`a[i] += v`, `a[i]++`, logical assignment) with a Number key read the element directly instead of converting the key to a string first; any other key converts once and is retained for PutValue, as before. `x.length` keeps upstream's shape (a String's length, else the runtime read), and the runtime read (`readCachedLengthValue`) returns the mirrored length of an array with packed elements before the cached read.
- **Builtin calls.** The realm records the functions it installs in `ErrorRealm.intrinsicFunctions` (`js-runtime/src/objects/intrinsic-functions.ts`, object-reference fields). A call naming one (`Math.floor(x)`, `Number(x)`, `s.charCodeAt(i)`, `m.get(k)`, `a.push(v)`, …) evaluates its operands once, then compares the callee's object view with the realm's function by reference: on a match with operands of the inline form's types it performs the typed operation the builtin itself performs (`Math.floor` on a Number, `charCodeAt` on a String with a Number position, the collection operation on the receiver's storage, a packed append), otherwise it calls the callee through `invoke` with the same evaluated operands (register, native and native-tail calls as usual). The callee syntax only selects which builtin to compare with. Replaced, deleted or accessor builtins, uninstalled builtins (undefined fields), other realms' functions, other receivers and converting operands take the ordinary call. `Math.fround` is excluded (the typed library performs it with `roundFloat`).

- **General element cells (second commit).** General elements each have their own cell, never shared between arrays, so an overwrite updates the cell instead of allocating a new box. Generated reads take a packed general element through the inlined dense list read and its cell; generated writes overwrite one in place before the runtime write.
- **Packed appends (second commit).** The runtime's computed write, `Array.prototype.push` and a `push` intrinsic at call sites (one argument) append in place when [[Set]] can only create the element: an extensible array whose writable length equals its count, whose prototype is the realm's `Array.prototype` with no elements, whose prototype in turn is the realm's `Object.prototype` in fast mode (an index key moves an ordinary object to dictionary mode). The length descriptor is the array's own cell and is updated in place with the mirror. Inherited index setters, non-extensible arrays, read-only lengths, subclasses, other realms and holes keep the ordinary path.
- **Fixes found in review and measurement.** A realm that never installs a builtin (a program that never names `Math`, `Map` or `Set`) left its intrinsic field undefined, so an undefined method such as `holder.floor(1.5)` matched it and ran inline instead of throwing (`7adf28aa0`, regression check in the elements fixture). The guard's fallback took the generic list call, regressing user methods named like builtins (below; `af1ecf359`, `9efd5732f`). Reading the mirrored array length inline gave every function with a `length` read a number temporary, so its prologue saved FP registers on every call, and String length reads paid for a mutable result: `score` in `mixedCall` executed 8 more instructions on every path and 14 more for a String. The mirror is now read in the runtime (`524e0f43b`, `d7fc17d53`); a warm `score` call executes exactly upstream's 83/76/92 instructions (undefined/number/String) and a warm array `length` read 279 (upstream 1,914; the inline form was 152).

## Octane against Node 26.13.1

Fifteen rotated fresh-process rounds (Node, base, candidate) under the shared timing and launch locks on an Apple M5 Max; one-minute load median 4.7, maximum 10.6 (other streams' work and two of my builds overlapped some rounds). Every native inferior reached its entry stop and exited 42. Base `9b28147e0`, candidate `c1637b389`, both with clean trees.

| Program      | Node ms/op | Base ms/op | Candidate ms/op | Δ vs base, median [IQR] | Candidate ÷ Node |
| ------------ | ---------: | ---------: | --------------: | ----------------------- | ---------------: |
| Richards     |      0.046 |      4.336 |           4.208 | −0.128 [−0.285, −0.048] |              91× |
| DeltaBlue    |      0.067 |       20.4 |            18.8 | −1.78 [−2.39, −1.02]    |             279× |
| NavierStokes |      1.879 |       81.1 |            24.7 | −56.4 [−58.8, −55.5]    |              13× |
| RayTrace     |      0.519 |      162.7 |           156.7 | −6.07 [−9.57, −2.83]    |             302× |

[Paired rounds](general-runtime-step5a-octane-darwin-arm64-v1.json)

After the change, NavierStokes main-thread samples (pprofessor, 997 Hz, debug-symbol image) fall 80% in generated code: `lin_solve` 59%, `advect` 13%, `project` 8%. The element sequences themselves are about 10% of `lin_solve`'s samples; the rest is general-value frame traffic (boxing `++currentRow` into frame slots and reloading it) and closure-variable cell checks, which steps 4 and 6 address. The runtime element helpers that held 44% of the samples (`writeObjectValuePropertyKey`, `objectPropertyKey`, `setObjectValueProperty`) are gone from the profile.

## Elements and builtin kernels

`tools/general-call-bench/elements.ts` (new): untyped kernels for packed number element reads, writes and updates, object element reads, `Math.floor`, `Math.sqrt`, `charCodeAt`, `Map` `set`+`has` and `Set` `add`+`has` (ns per iteration). Sixteen rotated rounds of four engines: Node, upstream `687508045`, slice 1 (`7adf28aa0`) and slice 2 (`465cd30b8`); load median 3.2, maximum 4.3. Each delta is paired per round against the previous engine.

| Kernel                | Node | Upstream | Slice 1 | Slice 2 | Slice 1 Δ vs upstream | Slice 2 Δ vs slice 1 | Slice 2 ÷ Node |
| --------------------- | ---: | -------: | ------: | ------: | --------------------- | -------------------- | -------------: |
| `numberElementRead`   | 1.98 |     16.0 |    14.6 |    7.41 | −1.49 [−1.87, −1.31]  | −7.14 [−7.23, −7.05] |           3.7× |
| `numberElementWrite`  | 1.82 |     24.6 |    15.1 |    6.92 | −9.38 [−9.55, −9.19]  | −8.16 [−8.36, −8.06] |           3.8× |
| `numberElementUpdate` | 1.66 |    136.6 |    16.0 |    9.07 | −121 [−122, −120]     | −6.90 [−7.05, −6.64] |           5.5× |
| `objectElementRead`   | 1.63 |     14.9 |    13.5 |    11.9 | −1.52 [−1.57, −1.38]  | −1.47 [−1.69, −1.28] |           7.3× |
| `mathFloor`           | 2.15 |    121.3 |    44.7 |    44.6 | −76.6 [−77.9, −76.0]  | −0.17 [−0.33, +0.55] |          20.7× |
| `mathSqrt`            | 2.17 |    122.3 |    46.1 |    45.6 | −76.1 [−77.1, −75.4]  | −0.49 [−0.90, −0.06] |          21.0× |
| `charCodeAt`          | 2.05 |    135.5 |    30.0 |    29.9 | −106 [−107, −104]     | −0.17 [−0.67, +0.24] |          14.6× |
| `mapSetHas`           | 8.13 |    215.1 |    75.9 |    75.4 | −140 [−143, −138]     | +0.35 [−1.36, +0.71] |           9.3× |
| `setAddHas`           | 7.08 |    202.8 |    75.4 |    75.6 | −127 [−129, −127]     | +0.54 [−1.27, +1.74] |          10.7× |

Slice 2's gain on the number element kernels comes from its write lowering (`if (store) {} else …` lets the store's miss fuse straight to the general path, as cached property stores do) and the smaller shared fallback (`packedGeneralCell`), which leave the loop fewer frame slots. [Paired rounds](general-runtime-step5a-elements-darwin-arm64-v1.json)

## Generality kernels

Same four engines and protocol (load median 3.1, maximum 3.7). The builtin kernels drop sharply (`Number(x)` 112 → 24.5 ns, `Math.max` 140 → 44, `map.get` 95 → 30) and `buildString` (`text.charAt(10)`) by 4.9 ns. This run also exposed a regression, fixed afterwards (below):

| Kernel            | Node | Upstream | Slice 1 | Slice 2 | Slice 1 Δ vs upstream    | Slice 2 Δ vs slice 1 |
| ----------------- | ---: | -------: | ------: | ------: | ------------------------ | -------------------- |
| `numberCall`      | 1.91 |    112.1 |    24.8 |    24.5 | −87.5 [−88.4, −86.7]     | −0.13 [−0.45, +0.71] |
| `mathMax`         | 2.06 |    139.9 |    43.9 |    44.3 | −95.8 [−96.7, −95.2]     | +0.43 [−0.36, +1.45] |
| `builtinMethod`   | 4.18 |     95.0 |    30.0 |    30.3 | −64.6 [−65.6, −64.1]     | −0.21 [−0.33, +0.47] |
| `buildString`     | 8.81 |     18.0 |    13.1 |    13.2 | −4.91 [−5.12, −4.74]     | −0.00 [−0.20, +0.47] |
| `allocateObjects` | 5.83 |    181.8 |   182.3 |   170.0 | +0.18 [−0.34, +1.58]     | −12.2 [−13.3, −10.7] |
| `objectArray`     | 2.22 |     16.6 |    16.0 |    14.7 | −0.54 [−0.94, −0.31]     | −1.11 [−1.44, −0.84] |
| `receivers2`      | 4.51 |     58.8 |   108.5 |   112.2 | **+50.6** [+48.4, +52.9] | +3.68 [−1.45, +5.72] |
| `receivers4`      | 4.63 |     64.3 |   117.4 |   120.9 | **+53.5** [+50.7, +56.9] | +1.99 [−1.23, +5.41] |
| `receivers8`      | 5.64 |     70.9 |   124.5 |   129.0 | **+53.0** [+51.0, +54.8] | +4.99 [+1.35, +5.98] |

The other nine kernels (`arguments3`–`6`, `catchInLoop`, `concatenateStrings`, `mixedCall`, `mutableCapture`, `objectRoundTrip`) moved by at most ±2 ns in either slice. [Paired rounds](general-runtime-step5a-generality-darwin-arm64-v1.json)

**The receivers regression.** The receivers kernels call a user method named `add`, which the lowering treats as a possible `Set.prototype.add`. When the guard missed, the fallback called through the generic argument-list path (`invokePrepared`, as numeric leaves do) instead of the register and native call paths `invoke` uses, and the guard itself called `scriptStrictEqual`. Every user method named like an inline builtin (`get`, `set`, `has`, `add`, `push`, `floor`, …) paid this. The fix (`af1ecf359`, `9efd5732f`): `invoke` takes the already evaluated arguments, so the fallback keeps the register and native calls, and the guard compares the callee's object view with the realm's function by reference (fields typed as object references; an uninstalled builtin stays undefined, which no view matches). A lowering test checks that such calls emit `callRegisterObjectValue` and no `callObjectValue` or `scriptStrictEqual`. The final measurement below includes the fix.

## Slices 1 and 2 against upstream `37bdaf804`

`d7fc17d53` (both slices and the regression fixes) against `perf/general-runtime` `37bdaf804`, which it contains; clean trees, Node 26.13.1, rotated fresh-process rounds holding the launch lock and then the timing lock. Every native inferior reached its entry stop and exited 42. Deltas are paired per round against upstream (median [IQR]).

**Octane** (15 rounds; load median 3.2, maximum 4.8). Upstream itself moved since the slice 1 run (Richards 4.3 → 2.5 ms, RayTrace 163 → 34 ms), so the ratios to Node are lower than in the first table.

| Program      | Node ms/op | Upstream ms/op | Final ms/op | Δ vs upstream, median [IQR] | Final ÷ Node |
| ------------ | ---------: | -------------: | ----------: | --------------------------- | -----------: |
| Richards     |      0.046 |           2.53 |        2.62 | +0.001 [−0.029, +0.150]     |          56× |
| DeltaBlue    |      0.068 |           16.2 |        11.8 | −4.08 [−4.64, −3.63]        |         172× |
| NavierStokes |       1.84 |           68.8 |        17.5 | −51.4 [−53.1, −49.2]        |         9.5× |
| RayTrace     |      0.524 |           33.9 |        29.7 | −3.11 [−4.51, −2.71]        |          57× |

[Paired rounds](general-runtime-step5a-octane-darwin-arm64-v2.json)

**Elements and builtin kernels** (15 rounds; load median 4.3, maximum 5.6), ns per iteration:

| Kernel                | Node | Upstream | Final | Δ vs upstream           | Final ÷ Node |
| --------------------- | ---: | -------: | ----: | ----------------------- | -----------: |
| `numberElementRead`   | 2.03 |     18.7 |  7.64 | −10.9 [−11.6, −10.3]    |         3.8× |
| `numberElementWrite`  | 1.91 |     25.8 |  7.10 | −18.6 [−19.5, −17.9]    |         3.7× |
| `numberElementUpdate` | 1.72 |    135.6 |  9.10 | −126.7 [−136.3, −123.9] |         5.3× |
| `objectElementRead`   | 1.71 |     14.0 |  11.7 | −2.22 [−2.65, −1.65]    |         6.8× |
| `mathFloor`           | 2.16 |    111.2 |  45.8 | −66.9 [−71.7, −64.7]    |          21× |
| `mathSqrt`            | 2.36 |    110.8 |  46.7 | −64.4 [−67.6, −61.2]    |          20× |
| `charCodeAt`          | 2.15 |    127.5 |  30.2 | −97.1 [−104.5, −94.6]   |          14× |
| `mapSetHas`           | 8.28 |    199.6 |  76.0 | −120.4 [−130.3, −119.2] |         9.2× |
| `setAddHas`           | 6.97 |    186.5 |  74.7 | −112.4 [−119.4, −108.7] |          11× |

[Paired rounds](general-runtime-step5a-elements-darwin-arm64-v3.json)

**Generality kernels** (16 rounds of four engines: Node, upstream, `524e0f43b` and the final `d7fc17d53`; load median 3.0, maximum 3.8), ns per iteration:

| Kernel               | Node | Upstream | Final | Δ vs upstream        | Final ÷ Node |
| -------------------- | ---: | -------: | ----: | -------------------- | -----------: |
| `numberCall`         | 1.89 |     99.9 |  24.6 | −74.4 [−76.0, −73.7] |          13× |
| `mathMax`            | 2.04 |    128.7 |  43.6 | −84.6 [−85.8, −82.6] |          21× |
| `builtinMethod`      | 4.09 |     84.3 |  29.4 | −54.6 [−55.2, −54.3] |         7.2× |
| `buildString`        | 8.64 |     18.2 |  13.9 | −4.28 [−4.66, −4.07] |         1.6× |
| `allocateObjects`    | 5.88 |    156.0 | 148.1 | −7.98 [−8.86, −7.03] |          25× |
| `objectArray`        | 2.22 |     15.4 |  14.7 | −0.67 [−0.77, −0.55] |         6.6× |
| `receivers2`         | 4.38 |     33.2 |  32.8 | +0.45 [−1.00, +1.44] |         7.5× |
| `receivers4`         | 4.47 |     38.4 |  38.9 | +0.47 [+0.00, +0.94] |         8.7× |
| `receivers8`         | 5.57 |     46.8 |  46.0 | −0.41 [−1.52, +1.02] |         8.3× |
| `mixedCall`          | 3.52 |     20.9 |  21.4 | +0.48 [+0.32, +0.86] |         6.1× |
| `mutableCapture`     | 4.85 |     15.8 |  16.0 | +0.02 [−0.23, +0.74] |         3.3× |
| `arguments3`         | 2.19 |     23.3 |  23.3 | −0.04 [−0.15, +0.20] |          11× |
| `arguments4`         | 2.24 |     28.4 |  29.4 | +0.72 [+0.29, +1.29] |          13× |
| `arguments5`         | 2.31 |     34.7 |  34.7 | −0.20 [−0.92, +0.25] |          15× |
| `arguments6`         | 2.38 |     43.3 |  43.2 | −0.19 [−0.75, +0.51] |          18× |
| `catchInLoop`        | 3.15 |     21.0 |  21.1 | +0.13 [−0.06, +0.39] |         6.7× |
| `concatenateStrings` | 6.60 |     13.8 |  13.8 | +0.05 [−0.18, +0.27] |         2.1× |
| `objectRoundTrip`    | 2.00 |     18.2 |  18.3 | +0.02 [−0.21, +0.30] |         9.2× |

[Paired rounds](general-runtime-step5a-generality-darwin-arm64-v4.json)

**The three small positive deltas** (`mixedCall` +0.48 ns, `arguments4` +0.72, `receivers4` +0.47) were traced as whole kernel calls (`n = 3`) in debug-symbol images of upstream and `d7fc17d53` built from the same source. `mixedCall` executes 2,139 instructions in both and `arguments4` 4,108 in both, so their deltas are code placement, not work. `receivers4` executed 4,431 more instructions per kernel call, all in creating its receiver array once per call (`firstReceivers()`); its per-iteration call `list[i & 3].add(i & 7)` executes 732 instructions against upstream's 772. Each kernel call runs 100,000 iterations, so that setup is 0.04 instructions per iteration, which cannot explain 0.47 ns either. The setup cost itself was real, though: every new array allocated an empty `Float64Array`, and every length definition looked `length` up again to refresh the mirror. The follow-up below fixes it and makes array literals cheaper than upstream.

## Follow-up: array and object creation, numeric-leaf fix, and rebased measurements

Follow-up commits rebased cleanly onto `d6c6453ad` (`origin/perf/general-runtime` `1f475dfe0` + `origin/main` `b5ff7e6e4`), prompted by the receivers trace and the independent review of PR #12:

- **`1aa028b00` (originally `7ac01e64d`) Create arrays without number storage or a second length lookup.** Arrays without number storage share one zero-length `Float64Array` (it has no cells to write), and an accepted length definition with a value mirrors exactly that value instead of looking `length` up again.
- **`30d1721c4` (originally `0a5781f77`) Create dense array literals from their element values.** A literal without spreads or holes evaluates its elements in order and calls `createArrayFromList`, which writes its new array's packed elements directly: CreateDataPropertyOrThrow on a new extensible array always succeeds and runs no user code. Before, each element took `createDataProperty` with a `String(index)` key through the array's exotic [[DefineOwnProperty]], about 6,000 instructions. Rest parameters and the runtime's list results (`Object.keys`, Map and Set iteration, RegExp split and others) share the path. Literals with spreads or holes keep the existing lowering.
- **`abb1d04f3` (originally `784990cc3` + `6f726a522`) Create static-key object literals from their site's shape.** A literal whose properties are all `key: value` definitions with static keys evaluates its values in order and calls `createLiteralObject` with a per-site record (slot table `$oc`). The first evaluation defines each key as before and records the root shape it started at and the shared shape it reached; a later evaluation starting at that root takes the shape and fills its slots in key order. Duplicate, index-like and too many keys never leave a recordable shape (one shared shape per definition is required) and keep defining each key. Methods, accessors, spreads, computed keys and `__proto__: v` keep the existing lowering. `usesObjectLiterals` is set after its declaration so the Script host compiles natively.
- **`9fe5ec2ed` Keep bare numeric literal reads out of numeric leaves.** The typed checker reads `number[]` elements as `number | undefined`, so an untyped loop leaf such as `const values = [1, 2, 3, 4]; sum += values[i & 3]` failed the general check (upstream too, since `6baa93459`). Bare index reads now stay on the general path while `read ?? number` stays a numeric leaf; native fixture cases (`sumMasked`, `sumDefaulted`, `sumPastEnd`) verify both in `tools/native-general-elements.test.ts`.
- **`698594cb5` Measure array and object literals and appends in the elements kernels.** Adds `numberArrayLiteral`, `objectArrayLiteral`, `objectLiteral`, and `pushLength` to `tools/general-call-bench/elements.ts`.
- **`848f04839` Update managed Script surface counts and historical capture filter for step 5a.** Adds the 11 step-5a `@tint/js-runtime/objects` exports to `missingFastPaths` in `tools/script-runtime-request.ts` and updates `tools/script-runtime-surface.test.ts` and `tools/test262-dynamic-import-host.test.ts` for the 170-function / 197-entry surface (`maxSpecializations: 16384` for the full-vocabulary test).

### Creation warm-call traces

Single-stepped warm calls (501st call, entry to return with callees under LLDB) comparing the creation commits (`d8b175aa6`) against upstream `182270e76`:

| Probe (source)                                          | Upstream | Candidate |
| ------------------------------------------------------- | -------: | --------: |
| `makeEmpty()`: `return []`                              |    8,192 |     3,739 |
| `makeNumbers()`: `return [1, 2, 3, 4]`                  |   30,258 |     6,431 |
| `makeObjects(o)`: `return [o, o, o, o]`                 |   30,702 |     7,242 |
| `makePair(a, b)`: `return { left: a, right: b }`        |    2,869 |     1,674 |
| `makeTriple(a)`: `return { x: a, y: a, z: a }`          |    4,048 |     2,106 |
| `makeEmptyObject()`: `return {}`                        |      461 |       461 |
| `callAdd(list, i)`: `return list[i & 3].add(i & 7) + 0` |      729 |       711 |

### Rebased head against `perf/general-runtime` `1f475dfe0` + `origin/main` `b5ff7e6e4`

Candidate `698594cb5` (identical compiler/runtime binary to `848f04839`, which only updates `tools/`) against clean base `d6c6453ad` (`origin/perf/general-runtime` `1f475dfe0` merged with `origin/main` `b5ff7e6e4`), Node 26.13.1, 15 rotated fresh-process rounds per suite under `tools/gate/with-lock.sh both` on Apple M5 Max. Every native inferior reached its entry stop and exited 42. Deltas are paired per round against base (median [IQR]).

**Octane** (15 rounds; quiet host: load1 median 2.3, max 2.5), ms per operation:

| Program      | Node ms/op | Base ms/op | Candidate ms/op | Δ vs base, median [IQR]     | Candidate ÷ Node |
| ------------ | ---------: | ---------: | --------------: | --------------------------- | ---------------: |
| Richards     |      0.046 |      2.289 |           2.238 | **−0.063 [−0.108, −0.029]** |            48.9× |
| DeltaBlue    |      0.064 |       12.3 |           8.330 | **−3.94 [−4.00, −3.90]**    |           131.2× |
| NavierStokes |      1.833 |       64.3 |            17.0 | **−47.4 [−47.5, −46.9]**    |             9.3× |
| RayTrace     |      0.510 |       29.7 |            26.5 | **−3.09 [−3.37, −2.90]**    |            51.9× |

[Paired rounds](general-runtime-step5a-octane-darwin-arm64-v3.json)

**Elements, builtins, and creation kernels** (15 rounds; load1 median 6.4, max 8.4), ns per iteration:

| Kernel                |  Node |    Base | Candidate | Δ vs base, median [IQR]  | Candidate ÷ Node |
| --------------------- | ----: | ------: | --------: | ------------------------ | ---------------: |
| `numberElementRead`   | 2.219 |    17.7 |     8.242 | **−9.38 [−10.6, −8.75]** |             3.7× |
| `numberElementWrite`  | 1.926 |    27.0 |     7.686 | **−19.3 [−20.4, −18.9]** |             4.0× |
| `numberElementUpdate` | 1.877 |   144.2 |     9.574 | **−135 [−138, −131]**    |             5.1× |
| `objectElementRead`   | 1.913 |    14.7 |      12.5 | **−2.68 [−3.20, −1.93]** |             6.5× |
| `numberArrayLiteral`  | 9.140 | 1,138.0 |     258.6 | **−879 [−928, −864]**    |            28.3× |
| `objectArrayLiteral`  | 4.542 | 1,236.8 |     268.1 | **−964 [−1,030, −946]**  |            59.0× |
| `objectLiteral`*      | 5.833 |   1.272 |     1.275 | −0.028 [−0.167, +0.022]  |             0.2× |
| `pushLength`          | 4.365 |   910.5 |     153.5 | **−758 [−799, −724]**    |            35.2× |
| `charCodeAt`          | 2.250 |   136.0 |      36.9 | **−99.1 [−103, −94.8]**  |            16.4× |
| `mathFloor`           | 2.396 |   119.1 |      49.2 | **−69.6 [−71.9, −67.8]** |            20.5× |
| `mathSqrt`            | 2.586 |   118.1 |      50.4 | **−68.2 [−70.6, −63.7]** |            19.5× |
| `mapSetHas`           | 9.154 |   205.4 |      81.7 | **−125 [−128, −120]**    |             8.9× |
| `setAddHas`           | 7.630 |   197.6 |      83.9 | **−115 [−124, −109]**    |            11.0× |

\* `objectLiteral` (`const pair = { left: i, right: 1 }; sum += pair.left + pair.right`) is a non-escaping numeric object literal, so `numericObjectLiteral` already specializes it to a typed record on both base and candidate (0.2× Node). Real escaping JS object literals are measured by `allocateObjects` in the generality suite below (**134.1 → 94.0 ns**, **−40.1 ns**).

[Paired rounds](general-runtime-step5a-elements-darwin-arm64-v4.json)

**Generality kernels** (15 rounds; quiet host: load1 median 2.5, max 2.7), ns per iteration:

| Kernel               |  Node |  Base | Candidate | Δ vs base, median [IQR]  | Candidate ÷ Node |
| -------------------- | ----: | ----: | --------: | ------------------------ | ---------------: |
| `allocateObjects`    | 5.755 | 134.1 |      94.0 | **−40.1 [−41.2, −39.7]** |            16.3× |
| `numberCall`         | 1.935 |  94.2 |      24.1 | **−70.0 [−70.4, −69.2]** |            12.4× |
| `mathMax`            | 2.023 | 127.0 |      47.3 | **−79.8 [−81.4, −79.2]** |            23.4× |
| `builtinMethod`      | 3.917 |  80.3 |      30.0 | **−50.4 [−51.1, −49.8]** |             7.7× |
| `buildString`        | 8.450 |  17.9 |      13.4 | **−4.60 [−4.99, −4.36]** |             1.6× |
| `objectArray`        | 2.140 |  15.4 |      14.4 | **−0.92 [−1.03, −0.86]** |             6.7× |
| `receivers2`         | 4.310 |  24.2 |      23.4 | **−0.71 [−1.25, −0.27]** |             5.4× |
| `receivers4`         | 4.343 |  24.3 |      24.0 | −0.26 [−0.87, +0.40]     |             5.5× |
| `receivers8`         | 5.491 |  44.6 |      41.2 | **−2.49 [−3.75, −1.84]** |             7.5× |
| `arguments3`         | 2.113 |  23.3 |      23.3 | −0.08 [−0.25, +0.48]     |            11.0× |
| `arguments4`         | 2.190 |  28.9 |      28.9 | +0.05 [−0.81, +0.65]     |            13.2× |
| `arguments5`         | 2.245 |  34.7 |      34.7 | −0.21 [−0.54, +0.26]     |            15.5× |
| `arguments6`         | 2.322 |  43.4 |      44.3 | +0.94 [+0.26, +1.12]     |            19.1× |
| `catchInLoop`        | 3.183 |  20.7 |      20.7 | +0.11 [+0.02, +0.19]     |             6.5× |
| `concatenateStrings` | 6.540 |  13.2 |      13.3 | +0.05 [−0.01, +0.10]     |             2.0× |
| `mixedCall`          | 3.441 |  20.9 |      21.1 | +0.22 [+0.09, +0.25]     |             6.1× |
| `mutableCapture`     | 4.940 |  15.6 |      15.6 | +0.08 [−0.21, +0.39]     |             3.2× |
| `objectRoundTrip`    | 2.056 |  18.3 |      18.3 | +0.17 [−0.29, +0.49]     |             8.9× |

[Paired rounds](general-runtime-step5a-generality-darwin-arm64-v5.json)

## Warm calls

One warm call (the 501st) of each probe function, entry to return with callees, single-stepped under LLDB with `tools/general-call-bench/count_call.py`. Base is `perf/general-runtime` `687508045`, candidate `de06b5e26` (the same upstream plus this slice); both untyped hosted images built with debug symbols from the same source.

| Probe (source)                               |  Base | Candidate |
| -------------------------------------------- | ----: | --------: |
| `readAt(a, i)`: `return a[i]`                |   244 |       118 |
| `writeAt(a, i, v)`: `a[i] = v`               |   603 |       133 |
| `addAt(a, i, v)`: `a[i] += v`                | 3,150 |       220 |
| `lengthOf(a)`: `return a.length`             | 1,860 |      152† |
| `charOf(s, i)`: `return s[i]`                | 1,074 |       318 |
| `floorOf(x)`: `return Math.floor(x) + 0`     | 3,295 |     1,686 |
| `codeAt(s, i)`: `return s.charCodeAt(i) + 0` | 2,962 |     1,086 |
| `getOf(m, k)`: `return m.get(k)`             |  916* |       947 |

\* `return m.get(k)` is a tail call in this strict module: the base function only records a tail-call request (`requestSourceTailCall`) and the lookup runs after it returns, outside the count; the candidate's count includes the whole lookup (about 500 instructions of `LinkedMap` hashing and probing). In `floorOf` the remaining 1,686 instructions are the uncached global read of `Math` (about 600) and the `Math.floor` property read, which misses the inline cache (about 450; see "Dependencies"); in `codeAt` the `charCodeAt` read misses the same way. At this head the `===` identity guard still cost a `scriptStrictEqual` call (56 instructions); the final head compares object references instead. † Inline mirror read; the final head reads the mirror in the runtime: 279 instructions for `return a.length + 0` against upstream `37bdaf804`'s 1,914.

## Frozen self-compile

Frozen `v7` with `--runtime-tree`, re-verified at the rebased head `698594cb5` against `d6c6453ad` (`origin/perf/general-runtime` `1f475dfe0` + `origin/main` `b5ff7e6e4`): both images are 53,413,554 bytes and every code and data section (`__TEXT,__text` `f34e866923d72f4e`, `__TEXT,__eh_frame` `5a6370012f45f338`, `__TEXT,__unwind_info` `9ce2a20b156a28bc`, `__DATA,__data` `4ad5a6cd559772ee`) is byte-identical. Earlier verification at `de06b5e26` vs `687508045` was likewise byte-identical (55,906,418 bytes). The compiler is typed code, which emits none of the new instructions, so the generated code and its timing are unchanged by construction; no timing run was needed.

## Validation

- **Self-build fixpoint** (rebased head `698594cb5` / `848f04839`, matching `main`'s stage 1 == stage 2 gate): stage 1 bootstrap with a source snapshot (`48,562,314` bytes), then stage 1 builds stage 2 from the same snapshot under LLDB asserting stopped-at-entry and exit 0, `cmp stage1 stage2` byte-identical (sha256 `494afa2b8d2f1061…`). Earlier stage 2 == stage 3 fixpoints also passed at `de06b5e26`, `465cd30b8`, `9efd5732f`, and `bdbd38e2d`.
- **Static checks, compiler subset, and workspace tests** at `848f04839`: `pnpm build`, `generate-compiler-catalog.ts` diff check (`catalog=0`), `tsc -p tsconfig.tests.json`, `tsc -p tsconfig.host.json`, `pnpm boundaries`, `pnpm format:check`, `selfhost-linked.test.ts` ("complete native compiler pipeline", 1/1), `check-concurrent` (6,204/6,204), and all `check-memory` tests (184/184 including `tools/script-runtime-surface.test.ts` and `tools/test262-dynamic-import-host.test.ts`) pass with zero failures.
- **Native fixtures under LLDB** (`TZ=UTC`, 6/6 pass at `698594cb5` / `848f04839`), each compared with Node from the same source:
  - `tools/native-general-elements.test.ts` (9 sections): dense number elements with −0, NaN, fractional, negative, string and out-of-range keys and indices past 2³²−2; holes with inherited and accessor elements on `Array.prototype`; kind transitions (number → general → emptied → number); frozen, sealed, non-extensible, read-only and accessor elements and non-writable `length`; typed arrays, strings (including inherited `String.prototype` indices), array-likes, proxies, Array subclasses, `arguments` and nullish bases; key conversion ordering and undefined methods in a realm without `Math`, `Map` and `Set`; `length` through growth, truncation, appends, unpacking, non-writable and failed shrinking, functions, typed arrays, proxies and 2³²−1; appends and `push` through prototype setters on `Array.prototype` and `Object.prototype`, non-extensible, frozen and read-only-length arrays, holey tails, subclasses, null prototypes, array-likes, a replaced `push`, multiple arguments and 2³²−1 lengths; dense array literals (element order, `Array.prototype` setters, sparse/spread/trailing holes, fresh instances, descriptors, rest parameters, frozen arrays, and looped masked/defaulted/out-of-bounds literal reads `sumMasked`/`sumDefaulted`/`sumPastEnd`).
  - `tools/native-general-intrinsics.test.ts` (5 sections): every inlined Math method on edge values (±0, NaN, ±Infinity, halves, 2³²), operands that convert observably and their order, too few and extra arguments, `Number` on non-Numbers, `charCodeAt`/`charAt` on edge positions, String objects and borrowed methods, replaced, deleted, accessor and shadowed builtins (`Math.floor`, `String.prototype.charCodeAt`, `globalThis.Number`, `Map.prototype.get`), Map and Set keys −0 and NaN, subclass receivers, cross-collection receivers (TypeError), and objects with their own `get`/`set`/`has`/`add`.
  - `tools/native-general-property-caches.test.ts` (13 sections, including static-key object literals alongside PR #12's `deepChains`, `polymorphic`, and `ownMethods`), `tools/native-general-numbers.test.ts`, and `tools/native-script-cases.test.ts`.
- **Linux x86-64.** Stage 1 cross-bootstrap (`node tools/bootstrap-compiler.ts ... --target linux-x86_64`) passes at `698594cb5` (`188,396,832` bytes), verifying the x86-64 emitter compiles cleanly after `main` `b5ff7e6e4`. CI on PR #12 after merge runs the full Linux x86-64 and Linux arm64 execution gates.
- Node differs from the specification in one case these fixtures exercise: `a[k] += v` with an object key converts `k` twice in V8; GetValue stores the converted key in the Reference, so Tint (before and after this change) converts once. The fixture compares only the result there.

## Test262

Two explicit native selections run at the rebased head `698594cb5` (pinned checkout `91c70759`, frozen toolchain `fe2bc2f35583e514…`, suite linking, `TZ=UTC`), totaling **6,239/6,240 pass**, 0 failures, 0 timeouts, 0 crashes, 0 harness errors, and 1 expected unsupported module top-level-await variant:

1. **Step 5a selection (`3,514/3,514 pass`, 0 failures, 0 unsupported):** covers compound, logical and update assignment, property accessors, `built-ins/Math`, `built-ins/Number`, `String.prototype.{charAt,charCodeAt}`, `Map.prototype.{get,set,has}`, `Set.prototype.{add,has}`, `Array` `length` and `prototype/{push,pop,shift,unshift,splice,fill,reverse,join}`, and `TypedArrayConstructors/internals/{Get,Set}`. [Rebased report](test262-general-runtime-step5a-native-v4.json) (earlier run at `de06b5e26`: [v1](test262-general-runtime-step5a-native-v1.json)).
2. **Array/object literal and rest-parameter selection (`2,725/2,726 pass`, 0 failures, 1 unsupported):** covers `language/expressions/array` (104/104), `language/expressions/object` (2,251/2,252 — the single unsupported variant is `cpn-obj-lit-computed-property-name-from-await-expression.js [module]`, `native module execution is not implemented`), `language/rest-parameters` (22/22), `built-ins/Array/{from,of}` (90/90, 32/32), `built-ins/Object/{keys,values,entries}` (118/118, 40/40, 42/42), and `built-ins/Reflect/ownKeys` (26/26). [Report](test262-general-runtime-step5b-extra-native-v1.json).

| Selection                                                                                  | Variants |  Pass | Unsupported |
| ------------------------------------------------------------------------------------------ | -------: | ----: | ----------: |
| `language/expressions/compound-assignment`                                                 |      786 |   786 |           0 |
| `language/expressions/logical-assignment`                                                  |      132 |   132 |           0 |
| `language/expressions/{postfix,prefix}-{increment,decrement}`                              |      246 |   246 |           0 |
| `language/expressions/property-accessors`                                                  |       42 |    42 |           0 |
| `built-ins/Math`                                                                           |      654 |   654 |           0 |
| `built-ins/Number`                                                                         |      680 |   680 |           0 |
| `built-ins/String/prototype/{charAt,charCodeAt}`                                           |      110 |   110 |           0 |
| `built-ins/Map/prototype/{get,set,has}`                                                    |       72 |    72 |           0 |
| `built-ins/Set/prototype/{add,has}`                                                        |      102 |   102 |           0 |
| `built-ins/Array/length` and `prototype/{push,pop,shift,unshift,splice,fill,reverse,join}` |      528 |   528 |           0 |
| `built-ins/TypedArrayConstructors/internals/{Get,Set}`                                     |      162 |   162 |           0 |
| `language/expressions/array`                                                               |      104 |   104 |           0 |
| `language/expressions/object`                                                              |    2,252 | 2,251 |           1 |
| `language/rest-parameters`                                                                 |       22 |    22 |           0 |
| `built-ins/Array/{from,of}`                                                                |      122 |   122 |           0 |
| `built-ins/Object/{keys,values,entries}` and `Reflect/ownKeys`                             |      226 |   226 |           0 |

## Dependencies on the PR #12 owner's work

The builtin and element paths are now short; what remains in these kernels is in areas this slice does not own:

- **Inline caches for out-of-line properties.** `Math` keeps its eight constants in the in-object slots, so every method (`Math.floor`, `Math.sqrt`, …) and every `String.prototype` method past the eighth (`charCodeAt`) misses `property-load` on every call and takes `readCachedObjectValueProperty` (about 450 instructions per call in the warm traces). The intrinsic needs the callee value, so this read bounds `Math.*` and string method calls.
- **Global reads in module code** stay uncached (`getIdentifierValue`/`findBinding`, about 600 instructions for `Math` per call in a hosted module; the benchmark kernels are modules). Script code (Octane) caches them.
- **Call ABI.** A warm call still spends 150+ instructions in entry and argument handling around these operations.
- **General values in frame slots.** Element loops spend most of their instructions storing and reloading general values; the element sequence itself is about 20 instructions.

## Coordination notes (shared files)

- IR: `element-load`/`element-store` in `ir/src/scalar/model.ts`, the verifier (`scalar/index.ts`), `effects.ts`, `operands.ts`, `substitution.ts`, `record-flow.ts`, `storage/codec.ts` (opcodes 120 and 121, chosen away from the owner's range), `optimization/inline.ts`, `reachability.ts`, `reachable.ts`, and the round-trip samples in `ir/test/function-store.test.ts`.
- Codegen: new cases in both emitters, the transparent list in `aarch64/scalar/temporary-registers.ts`, and `scalar/property-fusion.ts` (element loads and stores fuse like property accesses).
- ts-native: `RecordOperation` `element-load`/`element-store` and `bindElementLoad`/`bindElementStore` in `record-bindings.ts`; their wiring in `closure/lowering/index.ts` (for element bindings, `field` names the witness's elements field and `siteField` the count field, which the storage field must immediately follow).
- js-engine: `readComputedProperty`, the computed branch of `writeAssignment` (`writeElement`), the retained-key branch of `readAssignment`, the `length` branch of `readProperty`, and one hook before `invoke` in the call case (`invokeIntrinsic`). The element functions join `propertyCacheNames`/`propertyCacheBindings`.
- js-engine call paths: `invoke(callee, receiver, args, span, evaluated)` takes optional already evaluated arguments (the intrinsic fallback passes them so register, native and native-tail calls stay available), and `invokeNativeTail` accepts the same. A lowering test pins that calls named like inline builtins keep `callRegisterObjectValue`. The step 3 call ABI work will meet these two signatures.
- js-engine runtime surface: 197 entries (170 functions, 27 types: adds `readCachedLengthValue`, the three element bindings, `scriptMapGet`/`Has`/`Set`, `scriptSetAdd`, `scriptArrayPush`, `createObjectLiteralSite`, and `createLiteralObject`); `tools/script-runtime-request.ts` filters all 11 out of historical captures, and `tools/script-runtime-surface.test.ts` (with `maxSpecializations: 16384` for the full-vocabulary synthesis) and `tools/test262-dynamic-import-host.test.ts` are updated to match.
- js-engine numeric leaves (`9fe5ec2ed`): bare array-literal reads (`values[i & 3]`) stay general while `read ?? number` stays a numeric leaf (touches the specializer from `6baa93459`).
- js-runtime: `ArrayElements` representation (`array-elements.ts`), `defineLength` in `arrays.ts`, `createArrayFromList` in `array-like.ts`, `createObjectLiteralSite`/`createLiteralObject` in `operations.ts`, `ErrorRealm.intrinsicFunctions`, the installers that record intrinsics (`math-`, `primitive-`, `map-`, `set-intrinsics.ts`), `array-append.ts`, `element-access.ts` (`readCachedLengthValue` wraps `readCachedObjectValueProperty` for `length`), and the push fast path in `array-prototype.ts`.
- Locks: all rebased runs used the fair FIFO queue in `tools/gate/with-lock.sh` (`launch` for native fixtures, stage 2, and Test262; `both` per benchmark suite).
