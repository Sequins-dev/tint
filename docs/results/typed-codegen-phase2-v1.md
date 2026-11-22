# Typed code generation against Node: Phase 2, first fixes

23 November 2026. Progress on the [fix plan](typed-codegen-baseline-v1.md#fix-plan-ranked)
of PR #17. Each fix was measured against the image before it with the same
protocol as the baseline: `tools/typed-bench/bench.ts measure`, 15 or 16
rotated rounds, macOS arm64 (Apple M5 Max) under the timing and launch locks,
every native run under LLDB with stop at entry and exit 42, steady-state
medians with the interquartile range, ratios paired per round. Host load
during the A/B runs was 3–11 (other streams); it is recorded in each raw file.

## Fixes

| # | Fix (commit) | Measured against the previous image (candidate / base, median and IQR) | Raw rounds |
| --- | --- | --- | --- |
| 1 | Decimal string→number fast path: Clinger's exact path for at most 15 significant digits and \|exponent\| ≤ 22, exact accumulation for integers below 2^53 (`a10b63824`) | `compiler` 0.243 (0.240–0.251): 4.19× → 1.02× Node; others neutral | [number-parse](typed-codegen-v1-number-parse-darwin.json) |
| 2 | Safe integers formatted as one string instead of one per digit (`f356f062f`) | `stringBuild` 0.860 (0.835–0.896), `strings` 0.901 (0.864–0.934); others neutral | [number-format](typed-codegen-v1-number-format-darwin.json) |
| 3 | Typed-array indexes proven against the array's own length with constant margins (`i ± d` under `i + k < a.length - c`), integer elements kept as int64, int64 values stored to word arrays without staging (`2f5cd0847`) | `numeric` 0.240 (0.233–0.258): 4.05× → 1.00× Node; `typedArrays` 0.592 (0.583–0.622): 2.46× → 1.50×; `stringBuild` read 1.093 (1.054–1.116) though its code did not change (load 8–10); others neutral | [array-bounds](typed-codegen-v1-array-bounds-darwin.json) |
| 4 | FJCVTZS for ToInt32/ToUint32 of doubles where the target declares FEAT_JSCVT (Darwin arm64); constants materialized into their GP home (`02690241d`) | medians `stringBuild` 0.924, `calls` 0.961, `closures` 0.958, `typedArrays` 0.973, others 0.97–1.02; every IQR spans 1 (load 8–11) | [jscvt](typed-codegen-v1-jscvt-darwin.json) |
| 5 | Per-caller inlining allowance for CFG callees with traced references 128 → 384, so loops over several `number[]` inline their accessors (`11c07e8c5`) | `allocation` 0.875 (0.848–0.904): 2.99× → 2.64× Node; `typedArrays` 0.968, `closures` 0.971, `arrays` 0.975; others neutral. A `resizeNumberList` dense-shrink fast path measured neutral on its own and was dropped | [number-lists](typed-codegen-v1-number-lists-darwin.json) |

## Frozen v7

Codegen and inliner changes must not slow the native self-compile. Frozen
v7 (`tools/frozen-workload.ts`, `--runtime-tree` on every build), three
interleaved rounds under the timing lock at load about 9, built from main
`183ec7044`, from this branch with the old 128-unit allowance, and from this
branch as committed ([raw log](typed-codegen-phase2-v1-frozen-v7.txt)):

| Build | Wall (s) | Cycles (G): min, median | Instructions (G) | Image |
| --- | --- | --- | --- | --- |
| main `183ec7044` | 109.7, 97.0, 110.3 | 345.1, 385.5 | 1,626 | 77.2 MB |
| branch, allowance 128 | 105.6, 99.1, 111.7 | 358.3, 365.2 | 1,575 (−3.1%) | 77.0 MB |
| branch, allowance 384 | 94.7, 107.7, 84.8 | 335.3, 340.1 | 1,552 (−4.6%) | 80.9 MB |

The three outputs are byte-identical. Wall time and cycles are noisy at this
load, but nothing regresses and instructions fall 4.6%; the larger allowance
costs 3.9 MB (5%) of compiler image, with peak RSS unchanged (2.23 GB).

## Where each kernel stands

One run of the baseline image (`1c17f171c`) against this branch's head
(`8d194ee9d`) and Node, 15 rotated rounds at load 3–7
([raw rounds](typed-codegen-phase2-v1-darwin.json)), steady state, ms per
iteration:

| Kernel | Node | Tint before | Tint now | Before / Node | Now / Node |
| --- | ---: | ---: | ---: | ---: | ---: |
| `compiler` | 8.8 | 37.1 | 8.9 | 4.20× | **1.02×** (0.99–1.03) |
| `stringEquality` | 11.9 | 12.5 | 12.3 | 1.05× | **1.03×** (1.01–1.08) |
| `numeric` | 9.9 | 45.7 | 11.0 | 4.56× | **1.11×** (1.11–1.12) |
| `typedArrays` | 18.0 | 48.0 | 27.2 | 2.67× | 1.51× (1.50–1.52) |
| `strings` | 12.1 | 25.1 | 22.4 | 2.07× | 1.85× (1.80–1.87) |
| `mapSet` | 19.8 | 46.7 | 46.2 | 2.36× | 2.34× (2.31–2.36) |
| `escape` | 11.2 | 28.4 | 28.3 | 2.54× | 2.52× (2.30–2.66) |
| `stringBuild` | 17.6 | 53.3 | 45.6 | 3.03× | 2.58× (2.49–2.62) |
| `calls` | 18.5 | 51.6 | 50.1 | 2.77× | 2.70× (2.66–2.75) |
| `allocation` | 4.1 | 13.9 | 12.1 | 3.42× | 2.96× (2.83–3.05) |
| `closures` | 3.3 | 12.5 | 11.7 | 3.78× | 3.52× (3.44–3.55) |
| `arrays` | 19.4 | 80.2 | 79.9 | 4.13× | 4.13× (4.05–4.18) |

The same comparison on Linux arm64 (the `dev` machine, images built there,
Node 26.13.1 linux-arm64, load 0.1–0.9,
[raw rounds](typed-codegen-phase2-v1-linux.json)). FJCVTZS is not used on
Linux targets:

| Kernel | Node | Tint before | Tint now | Before / Node | Now / Node |
| --- | ---: | ---: | ---: | ---: | ---: |
| `compiler` | 9.5 | 38.4 | 9.1 | 4.06× | **0.95×** (0.93–0.98) |
| `stringEquality` | 12.5 | 12.5 | 12.4 | 0.99× | **1.00×** (0.97–1.03) |
| `numeric` | 10.3 | 46.3 | 11.4 | 4.52× | **1.09×** (1.06–1.13) |
| `typedArrays` | 18.4 | 48.7 | 27.8 | 2.64× | 1.53× (1.50–1.54) |
| `strings` | 13.6 | 26.2 | 22.6 | 1.92× | 1.67× (1.64–1.72) |
| `stringBuild` | 20.6 | 56.1 | 47.1 | 2.74× | 2.36× (2.27–2.40) |
| `escape` | 11.8 | 28.4 | 28.2 | 2.46× | 2.45× (2.23–2.51) |
| `allocation` | 5.2 | 14.4 | 12.7 | 2.77× | 2.46× (2.33–2.53) |
| `mapSet` | 20.0 | 48.6 | 48.4 | 2.43× | 2.46× (2.42–2.49) |
| `calls` | 19.3 | 52.7 | 52.0 | 2.70× | 2.72× (2.65–2.76) |
| `closures` | 3.6 | 13.0 | 12.4 | 3.55× | 3.41× (3.32–3.53) |
| `arrays` | 21.6 | 80.7 | 80.3 | 3.74× | 3.73× (3.62–3.83) |

**Three kernels now match or beat Node** (`compiler`, `stringEquality` and,
within about 10%, `numeric`); the others are 1.5–4.1× and need the items
below.

## Typed-only gaps found

`parseInt` and `parseFloat` do not link in typed code (`unknown value name:
parseFloat`); recorded in the gap table with the others the baseline found.

## Next, re-ranked

The fixes so far removed the algorithmic outliers (number parsing and
formatting) and the bounds-check gap. What remains needs larger changes:

| Kernel (now) | Cause | Fix |
| --- | --- | --- |
| `arrays` 4.1×, `closures` 3.5× | `number[]` accessors are general runtime TypeScript: each read inlines as an 11-block CFG behind a checked descriptor read and NaN-boxes its result; `pop` is three calls; the length is a double field converted on every `i < list.length` | Dense number-list fast paths in codegen, as dense reference lists have (vector and length cached per loop, int64 length), falling back to the runtime call |
| `allocation` 3.0×, `escape` 2.5× | Inline allocation is about 22 instructions: the context reloaded from the frame, a dependent chain to the allocation state, and an object-start bitmap read-modify-write per object; `[a, b, c]` creates a NumberList through runtime calls | Allocation state in a register or loaded once per function, start bits outside the inline path; inline literal number lists. Needs the collector owners' agreement on the allocation contract |
| `stringBuild` 2.6×, `strings` 1.9× | `s += t` copies the whole accumulated string each time (UTF-16, 8 bytes per copy step) | A loop-local append builder for strings only appended to in the loop, materialized once; wider copies |
| `calls` 2.7× | Every `{ x, y }` literal in the program shares the structural type, so each field read checks two descriptors, per field; list headers and `points.length` (a double) are reloaded per access | Layout facts through list elements and inlined arguments, one check per object per iteration; integer list lengths |
| `mapSet` 2.3× | Generic linked Map/Set lookups rehash the string key on every operation; number keys go through `valueHash` | Cached string hashes and inline probes for number and string keys |
| `typedArrays` 1.5×, `numeric` 1.1× | `round < scale` with `scale: number` keeps loop counters doubles, so `(x * 3 + round) \| 0` runs in double arithmetic; data pointers reload per access; V8 unrolls these loops 4× | Integer induction variables under a preheader bound guard; int32 truncation of `+ - *` trees feeding `\| 0`, `>>>`, `&` and integer stores; logical-immediate operands (`& 255`, `\| 0`, `^ c`; the ISA has no bitmask-immediate forms yet) and loop-invariant multi-instruction constants kept in registers (the `numeric` hash step is 21 instructions against V8's 6) |
| `compiler` 1.02× | Now spread out: `tokenize` 15%, Map lookups (`findMap` 11%, `hashString` 9%), list growth (the dense write accessor's copy-and-grow path, 7%; pushes within capacity are already inline), string slices 9% | Map items below; then re-profile |
| `stringEquality` 1.03× | The kernel body itself (literal `===` chains, the `switch`, a double index from `%` into `reservedWords`) | Integer induction from `%` results; then re-profile |
| `classes` 98× | Not typed code (general fallback) | Native class lowering: ownership decision pending |
