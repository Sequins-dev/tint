# General runtime quick wins from the independent review · Darwin arm64

The independent review of PR #12 (head `99e9cd83a`) named five quick wins. Each was implemented as its own commit and measured on its own: warm-call instruction traces of a probe built from the review's kernels, and paired, rotated timing (Octane and the generality kernels, 21 rounds, cumulative variants, Apple M5 Max, Node 26.13.1). Three are kept: the barrier's non-reference filter, direct shadows for non-number wraps, and zeroed record fields stored as `XZR`. Two are reverted although they cut instructions, because they cost time: miss-last block layout and fused `OrThrow` slow paths.

Base `99e9cd83a`. Variants (cumulative): L `3dbb0957e` (layout), B `8443f20b7` (barrier), S `4961cdb97` (shadows), F `a99a2f610` (fused results), Z `e67013afb` (zeroing). S2/F2/Z2 and later variants add the shadow cost-model follow-up `7d59ed497`.

## Decisions

| Change | Commit | Outcome | Evidence |
| --- | --- | --- | --- |
| Miss-last block layout for cached property accesses | `3dbb0957e` | **Reverted** (`35d043414`) | Octane within noise except NavierStokes **+3.2%** [+1.4, +5.3]; `objectArray` +7.5% |
| Remembered-set helper skipped for non-reference stores to old objects | `8443f20b7` | Kept | Old-object number store 146 → 126 instructions; NavierStokes −2.1% [−3.1, −1.0] |
| Shadows written directly for wrapped non-numbers | `4961cdb97` + `7d59ed497` | Kept | `isHeldOrSuspended` walk 1,562 → 1,547; NavierStokes −2.3% (S), −0.4…−1.7% (S2) |
| Fused `OrThrow` helpers in AOT slow paths | `a99a2f610` | **Reverted** (`690f2d7f9`) | Richards **+18%**, DeltaBlue +5%, NavierStokes +4.6%, RayTrace +4.5%; builtin-call kernels +7…+12% |
| Zero record fields stored as `XZR`, folded constants not materialized | `e67013afb` | Kept | `new Box` 1,201 → 906 instructions; RayTrace −3.0…−4.2%, `allocateObjects` −9.9% |

The cumulative kept state (B, S2, Z without L and F) was not timed as one image; each kept change's own effect is above. The next boundary benchmark measures the head.

## Warm calls

One warm call (the 501st), entry to return with callees, single-stepped under LLDB (`tools/general-call-bench/count_call.py`). The first number is instructions, the second the function's own code bytes ([traces](general-runtime-quickwins-traces-darwin-arm64-v1.json)).

| Probe function | Base | L | B | S2 | F2 | Z2 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `method(o)`: `o.get()` | 334 / 3,360 | 330 / 3,352 | 330 / 3,352 | 330 / 3,352 | 329 / 2,924 | 329 / 2,892 |
| `make(v)`: `new Box(v)` | 1,203 / 3,940 | 1,201 / 3,936 | 1,201 / 3,936 | 1,201 / 3,936 | 1,203 / 3,500 | **906** / 3,468 |
| `Vec.prototype.dot` | 396 / 13,824 | 384 / 13,800 | 384 / 13,800 | 384 / 13,800 | 342 / **6,724** | 342 / 6,724 |
| `callDeep(s)` (depth-2 prototype) | 937 / 4,788 | 939 / 4,780 | 939 / 4,780 | 939 / 4,780 | 943 / 4,380 | 943 / 4,316 |
| `walk(t)` (3 × `isHeldOrSuspended`) | 1,584 / 4,916 | 1,562 / 4,904 | 1,562 / 4,904 | **1,547** / 4,904 | 1,534 / 4,468 | 1,534 / 4,436 |
| `Box.prototype.get` | 90 / 668 | 88 / 664 | 88 / 664 | 88 / 664 | 88 / 664 | 88 / 664 |

Old-object stores (`oldstore.js`, the object promoted before the timed calls): storing a number 146 instructions at the base (26 of them in `remember-object`), 126 with the filter; storing a reference 151 → 156 (the tag test before the helper).

`Vec.prototype.dot` at the base: `store` 80, `property-load` 72, `general-is`/`wrap`/`value`/`none` 72, frame about 64, arithmetic 7 of 396.

## Octane

21 paired rounds, ms/op; each step against the previous variant, median [q1, q3] ([data](general-runtime-quickwins-octane-darwin-arm64-v1.json)).

| Program | Node | Base | L − base | B − L | S − B | F − S | Z − F |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Richards | 0.047 | 2.468 | −1.0% | −0.5% | −0.2% | **+18.0%** | −0.4% |
| DeltaBlue | 0.067 | 15.501 | +0.3% | −0.1% | +0.0% | **+5.2%** | +0.2% |
| NavierStokes | 1.838 | 66.103 | **+3.2%** | **−2.1%** | **−2.3%** | **+4.6%** | −0.9% |
| RayTrace | 0.511 | 31.384 | −0.6% | −0.4% | +0.1% | **+4.5%** | **−3.0%** |

Bold: the interquartile range of the paired difference excludes zero. NavierStokes moved by up to ±4% between separate runs of identical images (Z − F: −0.9%, +0.6%, +3.8% in three runs), so single NavierStokes steps under 4% are weak evidence.

## Generality kernels

21 paired rounds, ns/iteration ([data](general-runtime-quickwins-generality-darwin-arm64-v1.json)). Steps whose interquartile range excludes zero:

- L: `objectArray` +7.5%, `catchInLoop` +1.4%.
- B: `mutableCapture` −4.8%, `receivers2` −2.2%, `numberCall` −1.7%, `arguments3` −1.3%.
- S: `concatenateStrings` −2.1%, `receivers2` −1.5%; `mutableCapture` +2.0%, `arguments5`/`arguments6` +1.0…+1.1%.
- F: `builtinMethod` +12.4%, `numberCall` +10.2%, `mathMax` +7.2%, `allocateObjects` +6.1%, `arguments4` +5.3%; `receivers8` −7.6%, `objectArray` −6.4%, `concatenateStrings` −6.1%, `mutableCapture` −5.9%.
- Z: `allocateObjects` −9.9%, `arguments5` −7.4%, `objectRoundTrip` −1.4%.

## Why the reverted changes lost time

**Layout.** The rule (a property access's miss is unlikely) is wrong where the inline cache misses on every access today: an array's `length` (arrays are dictionary-mode) and depth-2 prototype methods (the inline inherited cache covers depth 1). There the miss became an out-of-line round trip. It should return once those sites hit (step 5a arrays, deep caches) or with profile data.

**Fused results.** Some slow paths run on every call: calls of builtins and other non-native callees (`callObjectValue`), constructions, and sloppy receiver coercion (`sloppyCallReceiver`, every sloppy method call). Fusing them added a call level and an out-of-line `throwIfRuntimeError`; a sampled profile of the Octane image shows `sloppyCallReceiverOrThrow` and `throwIfRuntimeError` among the hottest functions. Keeping those three inline (F3, then F4) left Richards +19.7% and then **+5.0%** [+4.2, +5.6], NavierStokes +4.5% and then **+2.5%**, while DeltaBlue and RayTrace became neutral ([data](general-runtime-quickwins-fused-octane-darwin-arm64-v1.json); generality for F3 in [this run](general-runtime-quickwins-fused-generality-darwin-arm64-v1.json): builtin kernels neutral, receivers −3…−5%). Fusion belongs with cold-path outlining, where the remaining fused paths are genuinely cold.

## Not a quick win

Cold slow-path helpers such as `readCachedObjectValueProperty` reach general code as closure-environment captures called through `call-indirect` (environment field 0 in `Box.prototype.get`), while other runtime calls are direct. The cause is in ts-native's closure conversion of that import; it is scheduled with cold-path outlining.

## Not measured

The frozen self-compile: the kept changes affect typed code too (the barrier filter and zeroed record fields), so the next boundary run includes frozen v7. Linux targets: x86-64 keeps the unfiltered barrier and per-word record initialization (correct, slower).
