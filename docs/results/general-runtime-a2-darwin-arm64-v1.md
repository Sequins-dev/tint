# General runtime A2 · polymorphic and deep inline property caches · Darwin arm64

Step A2 of the revised plan for PR #12: a property read site holds four inline entries instead of one, and a method site's entries may name any prototype up to three levels up instead of only the immediate one. Base `307630b86` (after the review's quick wins); head `d58dffa2f`. Apple M5 Max, Node 26.13.1.

Against the base, DeltaBlue runs 17.6% faster and Richards 7.1%; two- and four-receiver method sites 26% and 39% faster; a warm depth-2 method call executes 283 instructions instead of 937. RayTrace is 2.4% slower: an inherited hit now validates the whole chain with one epoch compare, which takes one more dependent load than the old holder-shape check, and method sites select the receiver for entries without a holder. A site that always misses (`Math.max`) is 3.7% slower. The call and loop kernels and the frozen v7 self-compile are unchanged.

## What changed

| Commit                   | Change                                                                                                                                                                                                                                                                                                                                        |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ca8506457`              | Four own and four inherited entries per site (IR `property-load` `entries`). An inherited entry is a receiver shape, a word index and a holder up to three prototypes up; one epoch, advanced by every structural change of an object used as a prototype, validates all of a site's inherited entries at once (`epochRecord`, `epochField`). |
| `a0a4efe2b`, `eabc6cc32` | Entry 0 stays inline and falls through on a hit; entries 1–3 are tested in a cold stub after the function body.                                                                                                                                                                                                                               |
| `c79c28c26`              | Entries fill in order and stay once full: further shapes make the site megamorphic and use the shared stub cache instead of rotating through the entries (a cycle of more shapes than entries missed on every read).                                                                                                                          |
| `c81f9df7d`              | A method site (`o.m()`) reads only its inherited entries and keeps a receiver's own methods there too, with no holder; generated code then uses the receiver (`CSEL` on aarch64, `CMOV` on x86-64). A method site needs one inline test instead of two.                                                                                       |
| `d58dffa2f`              | A full site returns from the runtime's entry update before scanning the entries or computing a slot word.                                                                                                                                                                                                                                     |

## Warm calls

One warm call (the 501st), entry to return with callees, single-stepped under LLDB (`tools/general-call-bench/count_call.py`): instructions ([traces](general-runtime-a2-traces-darwin-arm64-v1.json)).

| Probe function                      |  Base | `ca8506457` | `eabc6cc32` | `c81f9df7d` |  Head |
| ----------------------------------- | ----: | ----------: | ----------: | ----------: | ----: |
| `method(o)`: `o.get()`              |   334 |         335 |         336 |         338 |   338 |
| `callDeep(s)` (depth-2 prototype)   |   937 |         280 |         281 |         283 |   283 |
| `make(v)`: `new Box(v)`             |   906 |         906 |         906 |         906 |   906 |
| `Vec.prototype.dot`                 |   396 |         396 |         396 |         396 |   396 |
| `walk(t)` (3 × `isHeldOrSuspended`) | 1,569 |       1,572 |       1,575 |       1,578 | 1,578 |
| `Box.prototype.get`                 |    90 |          90 |          90 |          90 |    90 |

The `receivers8` method site (`list[i & 7].add(i & 7)`, eight receiver shapes with their own `add`), one call of the loop body:

|                                 |  Base | `c81f9df7d` |  Head |
| ------------------------------- | ----: | ----------: | ----: |
| A shape in the inline entries   | 1,278 |         715 |   715 |
| A shape past them (megamorphic) | 1,568 |       1,970 | 1,695 |

The base's single entry rotated, so all eight shapes missed. At `c81f9df7d` a miss at the full site spent 254 instructions scanning the entries and 96 computing a slot word, only to add nothing; `d58dffa2f` returns first. A miss still costs about 130 instructions more than at the base: the epoch and entry tests, the branch through the cold stub and `lookupCachedScriptProperty`'s larger frame.

## Octane

24 paired rounds of base, `eabc6cc32` and `c81f9df7d`: ms/op medians, then the median [q1, q3] of the per-round change ([data](general-runtime-a2-octane-darwin-arm64-v1.json)). Bold: the interquartile range excludes zero.

| Program      |  Node |   Base | `eabc6cc32` | `c81f9df7d` |        `c81f9df7d` − base | `c81f9df7d` − `eabc6cc32` |
| ------------ | ----: | -----: | ----------: | ----------: | ------------------------: | ------------------------: |
| Richards     | 0.047 |  2.509 |       2.326 |       2.317 |    **−7.1% [−8.0, −5.2]** |        −0.2% [−1.2, +0.8] |
| DeltaBlue    | 0.066 | 15.396 |      12.806 |      12.662 | **−17.6% [−19.0, −16.6]** |        −0.2% [−1.7, +1.2] |
| NavierStokes | 1.835 | 65.361 |      67.656 |      64.476 |        −1.1% [−3.2, +0.5] |    **−4.3% [−5.8, −2.9]** |
| RayTrace     | 0.511 | 30.472 |      31.378 |      31.167 |    **+2.4% [+1.7, +3.2]** |        −0.5% [−1.5, +0.1] |

NavierStokes moves by up to ±4% between runs of identical images, so its −4.3% is weak evidence. Earlier runs: `ca8506457` against the base, 21 rounds: DeltaBlue −17.8% [−18.5, −17.5], Richards −5.0% [−6.0, −4.2], NavierStokes +1.4% [+0.3, +3.1], RayTrace +0.5% [−0.2, +0.9] ([data](general-runtime-a2-octane-ca8506457-darwin-arm64-v1.json)); `eabc6cc32` against `ca8506457`, 24 rounds: all within noise, RayTrace +2.7% [−0.6, +4.1] ([data](general-runtime-a2-octane-eabc6cc32-darwin-arm64-v1.json)).

The head's own run (base, `c81f9df7d`, head; 24 rounds) was taken under external load up to 20 (Node itself ran 10% slower) and only resolves DeltaBlue, −16.2% [−17.0, −9.3] against the base; it is kept for completeness ([data](general-runtime-a2-octane-loaded-darwin-arm64-v1.json)). `d58dffa2f` changes only the runtime's update after a miss at a full site.

## Generality kernels

24 paired rounds of base, `c81f9df7d` and head: ns/iteration medians and the per-round change ([data](general-runtime-a2-generality-darwin-arm64-v1.json)).

| Kernel             |  Node |   Base | `c81f9df7d` |   Head |               Head − base |       Head − `c81f9df7d` |
| ------------------ | ----: | -----: | ----------: | -----: | ------------------------: | -----------------------: |
| allocateObjects    |  6.98 | 155.59 |      156.78 | 161.12 |        +1.1% [−5.8, +9.1] |       −1.0% [−6.0, +6.5] |
| arguments3         |  2.47 |  25.09 |       25.54 |  25.54 |        +0.2% [−3.2, +3.0] |       −2.3% [−4.9, +1.6] |
| arguments4         |  2.67 |  32.43 |       31.49 |  31.08 |        −1.1% [−6.6, +2.4] |       +0.0% [−4.8, +4.1] |
| arguments5         |  2.60 |  38.40 |       38.45 |  37.55 |        −0.2% [−4.2, +2.9] |       −2.0% [−4.6, +0.0] |
| arguments6         |  2.87 |  47.34 |       47.11 |  46.15 |        −2.1% [−7.5, +2.1] |       −3.3% [−6.2, +1.5] |
| buildString        | 11.05 |  20.17 |       20.98 |  20.01 |        +0.9% [−2.4, +3.9] |       −1.8% [−8.6, +2.7] |
| builtinMethod      |  4.93 |  94.66 |       94.83 |  93.37 |        −0.6% [−4.1, +1.8] |       −2.8% [−4.8, +0.8] |
| catchInLoop        |  3.67 |  23.29 |       23.04 |  23.09 |        +0.1% [−4.7, +2.7] |       +0.2% [−2.7, +1.6] |
| concatenateStrings |  7.40 |  15.09 |       15.11 |  15.04 |        −0.0% [−2.2, +3.4] |       −0.7% [−4.3, +1.7] |
| mathMax            |  2.30 | 144.39 |      149.07 | 151.08 |    **+3.7% [+0.5, +9.3]** |       −0.2% [−2.4, +4.9] |
| mixedCall          |  3.92 |  23.27 |       23.61 |  23.58 |        +0.2% [−4.6, +5.4] |       −0.7% [−5.8, +4.6] |
| mutableCapture     |  6.64 |  17.43 |       17.41 |  17.56 |        +0.7% [−3.3, +4.1] |       +2.6% [−5.2, +6.4] |
| numberCall         |  2.52 | 112.69 |      109.53 | 110.56 |        −1.0% [−3.6, +1.1] |       +0.4% [−1.3, +3.4] |
| objectArray        |  2.51 |  17.94 |       17.23 |  17.05 |        −2.3% [−5.9, +0.3] |       −1.3% [−5.0, +3.7] |
| objectRoundTrip    |  2.34 |  20.52 |       20.47 |  20.34 |        −1.3% [−4.5, +1.4] |       −0.8% [−5.4, +5.6] |
| receivers2         |  5.42 |  36.51 |       26.94 |  26.28 | **−26.0% [−30.4, −22.6]** |       −1.0% [−8.3, +5.9] |
| receivers4         |  5.61 |  45.01 |       27.22 |  26.61 | **−39.0% [−41.4, −35.6]** |       −1.4% [−7.8, +4.4] |
| receivers8         |  6.80 |  51.15 |       54.63 |  50.37 |        −2.1% [−4.2, +0.9] | **−10.0% [−13.4, −3.3]** |

A quieter run of `c81f9df7d` against the base (21 rounds, [data](general-runtime-a2-generality-c81f9df7d-darwin-arm64-v1.json)) agrees: receivers2 −25.3%, receivers4 −37.9%, and receivers8 +10.0% [+4.8, +12.0] before `d58dffa2f`. Along the way: `ca8506457` alone made receivers8 32% slower (entries rotated through eight shapes) and objectArray 13% slower ([data](general-runtime-a2-generality-ca8506457-darwin-arm64-v1.json)); `eabc6cc32` brought those to +8% [+2, +19] and +1% (within noise) ([data](general-runtime-a2-generality-eabc6cc32-darwin-arm64-v1.json)).

## Call and loop kernels

20 paired rounds, `c81f9df7d` against the base ([data](general-runtime-a2-kernels-darwin-arm64-v1.json)): every kernel within noise except `control` −6.4% [−8.1, −5.1] (0.013 ns/iteration). `d58dffa2f` changes only the update after a miss at a full site, which these kernels do not reach in steady state.

## Frozen v7 self-compile

`node tools/frozen-workload.ts run v7 pre-307630b86 a2m-c81f9df7d --rounds 15`, both images built with `--runtime-tree` ([data](general-runtime-a2-frozen-v7-darwin-arm64-v1.json)).

|                       |      Base | `c81f9df7d` |          Paired change |
| --------------------- | --------: | ----------: | ---------------------: |
| Wall (median)         |   62.60 s |     62.20 s | −0.21 s [−3.23, +2.21] |
| Cycles (median)       |   302.4 G |     299.1 G | −2.24 G [−8.89, +2.83] |
| Instructions (median) | 1,513.9 G |   1,514.1 G | +0.18 G [−0.45, +0.52] |
| RSS (median)          | 2,123 MiB |   2,123 MiB |              +0.06 MiB |

Instructions are unchanged; cycles and wall moved with external load in this run. `ca8506457` against the base, measured on a quieter host: cycles +0.12 G [−0.38, +1.11], wall +0.03 s [−0.10, +0.15].

## Open

- **RayTrace** (+2.4%). An inherited hit loads the site's epoch record, the current epoch and the site's epoch (three loads, two of them dependent) where the base loaded the holder and its shape; method sites add `CMP` and `CSEL`. Candidates: keep the current epoch in a register across a function's inherited sites, or check the holder's shape for depth-1 entries and the epoch only for deeper ones.
- **Megamorphic misses** still call the runtime (about 1,700 instructions per `receivers8` miss). A stub-cache probe in generated code belongs with cold-path outlining (A5).
- **Sites that always miss** pay for the longer inline test before the runtime call: `Math.max` reads a builtin's method past the in-place slots (+3.7%). Builtin intrinsics (step 5a) remove that miss.
