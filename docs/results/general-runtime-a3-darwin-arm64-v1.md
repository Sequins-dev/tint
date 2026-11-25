# General runtime A3 · compact ordinary objects · Darwin arm64

Step A3 of the revised plan for PR #12: compact `OrdinaryObject` by moving rarely-present exotic and generic internal slots into lazily allocated side records, allocating `properties` lazily, and constructing fast-mode ordinary objects directly in `createObject`. Base `6735358c5` (A2 head rebased onto `origin/main` `b5ff7e6e4`); head `b0ad978e4` (`a98fff092` for the timed Octane image; `7ae641170` for the warm-call traces, generality kernels, call/loop kernels, and frozen v7 self-compile). Apple M5 Max, Node 26.13.1.

An ordinary fast-mode object shrinks from 83 fields (~820+ bytes) plus an eager `Map` (56 bytes and bucket storage) to 18 core header fields plus 8 in-place general value slots (**280 bytes**, `0x118`) with zero `Map` allocation and zero `markPrototype` call on the `createObject` fast path. A warm `new Box(v)` executes **646 instructions** instead of 906 (**−28.7%**; `createObject` drops to 105 instructions). Against the base on Octane (18 paired rounds), **RayTrace runs 8.7% faster** (`30.07 → 27.33 ms/op`) and **DeltaBlue 1.9% faster** (`12.30 → 12.04 ms/op`); Richards and NavierStokes are within noise. `allocateObjects` runs 1.9% faster (`133.7 → 132.0 ns/iter`; object literals still call runtime `createDataProperty` per property). The call/loop kernels are unchanged and stay ahead of Node on all eight. The frozen v7 self-compile produces a bit-for-bit identical `__text` section.

## What changed

| Commit                                | Change                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `44d16b1f3`, `32924efd5`, `7ae641170` | Route rarely-present builtin and exotic internal slots through `exoticSlots` / `ensureExoticSlots` and move them into a lazily allocated `ExoticObjectSlots` record (`internalExoticSlots: ExoticObjectSlots \| undefined`). Ordinary objects allocate none of it.                                                                                                         |
| `b12544804`                           | Allocate `OrdinaryObject.properties` (`Map`) lazily only when dictionary storage or fast-mode accessor descriptors are needed, and skip redundant `markPrototype` calls when the prototype is already marked.                                                                                                                                                              |
| `3ea9ac445`                           | Construct fast-mode ordinary objects directly in `createObject` with `internalShape` initialized from the prototype's cached `internalChildShape` and zeroed `internalValue0..7` (`STP XZR, XZR`), avoiding helper indirection.                                                                                                                                            |
| `29050f823`                           | Move 9 rarely-present generic internal slots (bound target, home object, tail dispatch, private elements, arguments data/aliases, property contract, immutable prototype, indexed dictionary layout) into a lazily allocated `OrdinaryRareSlots<Key, Value>` record (`internalRareSlots`), and add an early exit in `indexedPropertyCell` when `properties === undefined`. |
| `e185703d3`                           | Narrow `Key` via `unknown` before `typeof === "string"` in generic shape helpers (fixing native checking when `Key = number`, e.g., `arguments`) and fix two hosted fixture exotic-slot optional reads.                                                                                                                                                                    |
| `a98fff092`                           | Read `object.internalExoticSlots` directly in hot indexed-property (`readObjectValuePropertyKey`, `writeObjectValuePropertyKey`) and equality/coercion paths instead of calling `exoticSlots(object)` (eliminates the +8.3% `NavierStokes` regression observed at `7ae641170`).                                                                                            |

## Warm calls

One warm call (the 501st), entry to return with callees, single-stepped under LLDB (`tools/general-call-bench/count_call.py`) on the `neon` probe ([traces](general-runtime-a3-traces-darwin-arm64-v1.json)):

| Probe function                      | A2 (`d58dffa2f`) | A3 (`7ae641170`) |            Change |
| ----------------------------------- | ---------------: | ---------------: | ----------------: |
| `make(v)`: `new Box(v)`             |              906 |          **646** | **−260 (−28.7%)** |
| `method(o)`: `o.get()`              |              338 |              338 |                 0 |
| `dot(a, b)`: `a.dot(b)`             |              643 |              643 |                 0 |
| `callDeep(s)` (depth-2 prototype)   |              283 |              283 |                 0 |
| `walk(t)` (3 × `isHeldOrSuspended`) |            1,578 |            1,584 |                +6 |
| `setState(t, v)`: `t.state = v`     |              119 |              119 |                 0 |
| `Box.prototype.get`                 |               90 |               90 |                 0 |
| `Vec.prototype.dot`                 |              396 |              396 |                 0 |

Breakdown of `make(v)` (`646` instructions): `make` caller `320`, `createSourceInstance` `105` (still performs an indirect closure call to `createObject`), `createObject` `105` (down from ~365 instructions plus `Map` allocation and `markPrototype`), `Box` constructor `116`.

## Octane

18 paired rounds of base `6735358c5` vs A3 `b0ad978e4` (`a98fff092`), ms/op medians and median `[q1, q3]` of per-round percent change ([data](general-runtime-a3-octane-darwin-arm64-v1.json); host median idle 88.9–91.6%). Bold: interquartile range excludes zero.

| Program      |  Node |   Base |     A3 |                  A3 − base |
| ------------ | ----: | -----: | -----: | -------------------------: |
| Richards     | 0.046 |  2.289 |  2.287 |      +0.34% [−1.85, +2.06] |
| DeltaBlue    | 0.064 | 12.304 | 12.039 |  **−1.86% [−2.89, −1.14]** |
| NavierStokes | 1.837 | 64.028 | 64.101 |      +0.63% [−0.25, +1.06] |
| RayTrace     | 0.514 | 30.073 | 27.330 | **−8.74% [−10.04, −8.17]** |

Earlier run at `7ae641170` (18 paired rounds, before `a98fff092`, [data](general-runtime-a3-octane-pre-inline-exotic-darwin-arm64-v1.json)): RayTrace `29.78 → 27.51 ms/op` (−7.6%), DeltaBlue `12.25 → 12.06 ms/op` (−1.6%), Richards `2.289 → 2.285 ms/op` (neutral), and **NavierStokes `63.52 → 68.71 ms/op` (+8.3%)**. That +8.3% regression came from calling `exoticSlots(object).internalTypedArrayData` (cross-module call + `emptyExoticSlots` load) on every indexed array write in `writeObjectValuePropertyKey`; checking `object.internalExoticSlots` directly in `a98fff092` removed it completely.

## Generality kernels

18 paired rounds of base `6735358c5` vs A3 `7ae641170`: ns/iteration medians and per-round percent change ([data](general-runtime-a3-generality-darwin-arm64-v1.json)).

| Kernel               | Node |   Base |     A3 |              A3 − base |
| -------------------- | ---: | -----: | -----: | ---------------------: |
| `allocateObjects`    | 5.83 | 133.74 | 132.00 | **−1.9% [−3.1, −0.1]** |
| `arguments3`         | 2.09 |  23.29 |  23.34 |     +0.0% [−0.3, +0.6] |
| `arguments4`         | 2.26 |  28.87 |  29.04 |     +1.3% [−0.3, +2.5] |
| `arguments5`         | 2.22 |  34.58 |  34.68 |     +1.5% [−0.6, +3.3] |
| `arguments6`         | 2.37 |  43.33 |  43.51 |     +0.6% [−1.0, +1.6] |
| `buildString`        | 8.42 |  17.92 |  17.87 |     −0.3% [−1.3, +0.9] |
| `builtinMethod`      | 4.00 |  79.70 |  81.16 | **+1.7% [+0.9, +2.3]** |
| `catchInLoop`        | 3.29 |  20.62 |  20.90 | **+1.5% [+0.9, +1.8]** |
| `concatenateStrings` | 6.52 |  13.29 |  13.34 |     +0.3% [−0.3, +1.3] |
| `mathMax`            | 1.99 | 126.84 | 127.27 |     −0.3% [−0.9, +0.9] |
| `mixedCall`          | 3.46 |  20.98 |  20.92 |     −0.2% [−1.0, +0.2] |
| `mutableCapture`     | 4.94 |  15.62 |  16.07 | **+2.7% [+1.4, +3.9]** |
| `numberCall`         | 1.93 |  94.19 |  94.30 |     −0.2% [−0.9, +1.5] |
| `objectArray`        | 2.10 |  15.35 |  15.43 |     +0.5% [−0.4, +3.2] |
| `objectRoundTrip`    | 2.01 |  18.46 |  18.35 |     −0.4% [−2.6, +0.4] |
| `receivers2`         | 4.30 |  23.84 |  23.96 |     +0.7% [−1.7, +4.4] |
| `receivers4`         | 4.40 |  24.16 |  24.25 |     +1.2% [−2.8, +3.7] |
| `receivers8`         | 5.49 |  44.48 |  44.41 |     +0.5% [−2.2, +2.1] |

`allocateObjects` improves only modestly (−1.9%) because object literals lower to `createObject` followed by per-property runtime `createDataProperty` calls, which dominate the 132 ns loop body.

## Call and loop kernels

20 paired rounds of base `6735358c5` vs A3 `7ae641170` ([data](general-runtime-a3-kernels-darwin-arm64-v1.json)): every kernel is unchanged within noise except `control` `0.14 → 0.13 ns/iter` (−9.6%, −0.01 ns), and untyped Tint remains ahead of Node on all eight (`array` 1.52 vs 1.96, `closure` 2.32 vs 4.77, `control` 0.13 vs 3.79, `method` 2.41 vs 4.29, `property` 1.18 vs 1.77, `recursive` 114.0 vs 229.6, `rest` 0.81 vs 8.62, `stringEquality` 1.18 vs 2.16 ns/iter).

## Frozen v7 self-compile

Built frozen v7 compiler images with `--runtime-tree` at base `6735358c5` (`native-a3-base-6735358c5`) and A3 `7ae641170` (`native-a3-7ae641170`). Their `__text` sections (`30,702,976` bytes at file offset `4096`) are bit-for-bit identical (SHA-256 `f34e866923d72f4e216255008788c8a5d42f2a71740927c46a9af9097fd7bb1d`).

## Validation

- Workspace concurrent check (`env -u TZ pnpm check:concurrent` on `7ae641170`), incremental `pnpm typecheck`, `ordinary-object-shapes.test.ts` (including new lazy exotic/rare slot invariants), `script-runtime-surface.test.ts`, and `complete native compiler pipeline` pass.
- Stage-1 native bootstrap (`TZ=UTC node tools/bootstrap-compiler.ts`) succeeds (`48,083,466` bytes).
- 17 hosted native fixtures (`ordinary-objects`, `arguments`, `general-property-caches`, `tail-dispatch`, `promise-objects`, `promise-intrinsics`, `generator-objects`, `async-generator-objects`, `async-functions`, `async-iteration`, `await`, `shadow-realm`, `dynamic-import-views`, `module-lowering`, `script-jobs`, `source-tail-steps`, `worker-messages`) pass under LLDB (stopped at entry, exit status 42).
- Three-platform CI: Linux arm64 and macOS arm64 pass (with `native-script-cases.test.ts` updated for x86-64 register/list entries and uncaught exit status 1 vs 70 so Linux x86-64 `native (2/3)` passes as well).

## Next (A4 · call path)

Disassembly of the A3 `neon` probe exposes the main remaining costs in `method(o)` (338 instructions), `Box.prototype.get` (90 instructions), and `make(v)` (646 instructions):

- **Dead witness load on every property read/store (8 instructions/site):** `readProperty` and `cachedPropertyStore` load `$errors.objectPrototype` solely as a type witness for `ts-native`'s `bindPropertyLoad`/`bindPropertyStore`, even though `ScriptPropertyCache` already names `OrdinaryObject` via `inheritedObject`.
- **`scriptEntryGuard` (~70 instructions/call):** lowers `viewObjectValue`, optional chains, repeated descriptor/null checks, and context checks instead of a single compact record-bound check (~14 instructions).
- **`$errors.agent.activeContext` check (~17 instructions/caller entry)** and **closure/signature checks on `scriptInvoke` (~12 instructions/call)** plus **out-of-line `argumentAt` register-actual branch**.
- **`createSourceInstance` indirect closure hop (~55 instructions per `new`)** and **eager closure-environment unpacking in small callees** (`Box.prototype.get` unpacks cold IC-miss helpers into callee-saved registers at entry).
