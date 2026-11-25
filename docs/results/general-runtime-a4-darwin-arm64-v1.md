# General runtime A4 · call path · Darwin arm64

Step A4 of the revised plan for PR #12: strip the dead property-cache witness load, lower `scriptEntryGuard` + `activeContext` via a dedicated IR `script-entry` instruction, invert `argumentAt` fall-through and fold script-call immediate constants, inline fast-mode object construction in `createSourceInstance`, prove closure-environment layout in `record-facts`, and sink cold closure-environment loads to their use blocks. Base `bee1ba669` (A3 head); head `58ddd3fff`. Apple M5 Max, Node 26.13.1.

Every warm-call probe drops substantially: `method(o)` **338 → 237 instructions (−29.9%)**, `make(v)` **646 → 479 (−25.9%)**, `callDeep(s)` **283 → 202 (−28.6%)**, `setState(t, v)` **119 → 91 (−23.5%)**, `Box.prototype.get` **90 → 67 (−25.6%)**, `dot(a, b)` **643 → 533 (−17.1%)**, `walk(t)` **1,584 → 1,319 (−16.7%)**, and `Vec.prototype.dot` **396 → 368 (−7.1%)**. On the `neon` probe, the `script-entry` hit path takes **19 instructions** (down from ~87 instructions for `scriptEntryGuard` + prologue `$active` read), `Box.prototype.get` unpacks only `$sites` at entry with zero environment descriptor check and 3 callee-saved pairs instead of 5, and `createSourceInstance` allocates the 280-byte (`0x118`) fast-mode `OrdinaryObject` directly in 145 instructions (down from 210 across `createSourceInstance` + `createObject`). Against `bee1ba669` on Octane (18 paired rounds), **RayTrace runs 4.68% faster** (`30.763 → 28.191 ms/op`; `28.20 → 27.45`, −2.98% on ≥75%-idle rounds), while DeltaBlue, Richards, and NavierStokes are within noise. On the generality kernels (18 paired rounds), call-heavy and capture-heavy kernels improve across the board (`mutableCapture` **−11.5%**, `buildString` **−9.6%**, `arguments3` **−8.1%**, `receivers4` **−7.8%**, `objectRoundTrip` **−5.8%**, `receivers2` **−4.0%**, `arguments4` **−3.7%**, `receivers8` **−2.7%**). On the call/loop kernels (20 paired rounds, 88.1–92.2% host idle), `control` improves **−10.8%** (`0.14 → 0.13 ns/iter`), all other seven kernels are within ±0.6%, and untyped Tint remains ahead of Node on all eight. The frozen v7 self-compile produces a bit-for-bit identical `__text` section.

## What changed

| Commit                   | Change                                                                                                                                                                                                                                                                                               |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `1709abaf5`              | Drop the dead `$errors.objectPrototype` witness argument from `readProperty` / `cachedPropertyStore` and resolve the `OrdinaryObject` record descriptor directly from `ScriptPropertyCache.inheritedObject` in `ts-native` `bindPropertyLoad` / `bindPropertyStore`.                                 |
| `203e10408`, `58ddd3fff` | Invert `argumentAt` so the register-actual fast path falls through, fold script-call immediate constants (`mode`/`argCount`), and construct the 280-byte (`0x118`) fast-mode `OrdinaryObject` directly in `createSourceInstance` (typed explicitly as `OrdinaryObject<ScriptPropertyKey, unknown>`). |
| `c9d0776cc`              | Lower `scriptEntryGuard` via a new `script-entry` IR instruction (aarch64 and x86-64 codegen + verifier) that checks receiver/callee record descriptor, `internalScriptRegisterEntry`, and inline `agent.activeContext` in a single compact 19-instruction sequence.                                 |
| `74bb1cec5`              | Prove closure-environment record descriptor layout in `record-facts` (eliminating redundant environment descriptor checks) and add a `sink-environment-loads` IR pass that sinks closure-environment field loads used only in cold blocks (such as IC-miss paths) into their dominating use block.   |
| `3df6909a0`              | Update IR and codegen unit-test expectations for `script-entry` lowering and `sink-environment-loads`.                                                                                                                                                                                               |

## Warm calls

One warm call (the 501st), entry to return with callees, single-stepped under LLDB (`tools/general-call-bench/count_call.py`) on the `neon` probe ([traces](general-runtime-a4-traces-darwin-arm64-v1.json)):

| Probe function                      | A3 (`7ae641170`) | A4 (`58ddd3fff`) |            Change |
| ----------------------------------- | ---------------: | ---------------: | ----------------: |
| `method(o)`: `o.get()`              |              338 |          **237** | **−101 (−29.9%)** |
| `make(v)`: `new Box(v)`             |              646 |          **479** | **−167 (−25.9%)** |
| `dot(a, b)`: `a.dot(b)`             |              643 |          **533** | **−110 (−17.1%)** |
| `callDeep(s)` (depth-2 prototype)   |              283 |          **202** |  **−81 (−28.6%)** |
| `walk(t)` (3 × `isHeldOrSuspended`) |            1,584 |        **1,319** | **−265 (−16.7%)** |
| `setState(t, v)`: `t.state = v`     |              119 |           **91** |  **−28 (−23.5%)** |
| `Box.prototype.get`                 |               90 |           **67** |  **−23 (−25.6%)** |
| `Vec.prototype.dot`                 |              396 |          **368** |   **−28 (−7.1%)** |

Breakdowns on `58ddd3fff`:

- `method(o)` (`237` instructions, down from `338`): `method` caller `170` (was `248`, −78), `Box.prototype.get` `67` (was `90`, −23).
- `make(v)` (`479` instructions, down from `646`): `make` caller `243` (was `320`, −77), `createSourceInstance` `145` (was `105 + 105 = 210` across `createSourceInstance` + `createObject`, −65), `Box` constructor `91` (was `116`, −25).
- `callDeep(s)` (`202` instructions, down from `283`): `callDeep` caller `159` (was `237`, −78), `Base.prototype.deepGet` `43` (was `46`, −3).
- `dot(a, b)` (`533` instructions, down from `643`): `dot` caller `165` (was `247`, −82), `Vec.prototype.dot` `368` (was `396`, −28).
- `walk(t)` (`1,319` instructions, down from `1,584`): `walk` `520`, `Task.prototype.isHeldOrSuspended` `799`.

## Octane

18 paired rounds of base `bee1ba669` vs A4 `58ddd3fff`, ms/op medians and median `[q1, q3]` of per-round percent change ([data](general-runtime-a4-octane-darwin-arm64-v1.json); host median idle 73.9–77.3% due to concurrent background builds on the shared host). Bold: interquartile range excludes zero.

| Program      |  Node |   Base |     A4 |                 A4 − base |
| ------------ | ----: | -----: | -----: | ------------------------: |
| Richards     | 0.051 |  2.473 |  2.374 |     +0.06% [−6.78, +2.08] |
| DeltaBlue    | 0.070 | 12.955 | 12.919 |     −1.35% [−8.07, +2.70] |
| NavierStokes | 1.928 | 70.989 | 68.896 |     +0.84% [−5.17, +1.97] |
| RayTrace     | 0.568 | 30.763 | 28.191 | **−4.68% [−9.19, −2.02]** |

On the 10/18 rounds where both engines ran with ≥75% host idle: RayTrace `28.20 → 27.45 ms/op` (−2.98% [−7.92, −2.02]), DeltaBlue `12.60 → 12.51` (−0.89% [−1.83, +1.82]), Richards `2.33 → 2.33` (−0.11% [−4.16, +0.38]), and NavierStokes `66.67 → 66.69` (+1.27% [+0.08, +1.65]).

## Generality kernels

18 paired rounds of base `bee1ba669` vs A4 `58ddd3fff`: ns/iteration medians and per-round percent change ([data](general-runtime-a4-generality-darwin-arm64-v1.json); host median idle 65.9–71.3% due to concurrent background builds on the shared host; per-round deltas pair base and A4 within each round).

| Kernel               |  Node |   Base |     A4 |                A4 − base |
| -------------------- | ----: | -----: | -----: | -----------------------: |
| `allocateObjects`    |  7.82 | 144.87 | 160.73 |       −2.2% [−4.6, +4.7] |
| `arguments3`         |  2.61 |  26.04 |  25.82 |  **−8.1% [−11.0, −3.9]** |
| `arguments4`         |  2.65 |  31.66 |  33.72 |   **−3.7% [−9.3, −1.9]** |
| `arguments5`         |  2.77 |  37.96 |  40.56 |       −1.2% [−6.1, +3.6] |
| `arguments6`         |  3.00 |  48.74 |  46.50 |       −7.2% [−9.2, +3.1] |
| `buildString`        | 11.04 |  20.04 |  20.32 |  **−9.6% [−16.4, −3.9]** |
| `builtinMethod`      |  5.16 |  90.63 |  98.18 |       −0.7% [−9.1, +1.6] |
| `catchInLoop`        |  3.91 |  22.99 |  23.76 |       −4.9% [−8.4, +2.8] |
| `concatenateStrings` |  8.18 |  14.78 |  15.38 |       −5.3% [−9.2, +1.4] |
| `mathMax`            |  2.64 | 146.33 | 153.52 |       −0.1% [−6.0, +0.7] |
| `mixedCall`          |  4.45 |  23.06 |  23.82 |       −2.5% [−7.6, +0.6] |
| `mutableCapture`     |  6.76 |  17.18 |  16.59 | **−11.5% [−16.5, −7.9]** |
| `numberCall`         |  2.78 | 104.92 | 112.37 |       +0.8% [−6.6, +2.9] |
| `objectArray`        |  2.83 |  17.06 |  18.57 |       +3.0% [−4.3, +6.7] |
| `objectRoundTrip`    |  2.64 |  20.36 |  19.97 |  **−5.8% [−12.4, −1.2]** |
| `receivers2`         |  6.16 |  26.63 |  26.33 |   **−4.0% [−7.5, −1.0]** |
| `receivers4`         |  6.22 |  27.71 |  27.05 |  **−7.8% [−12.5, −2.8]** |
| `receivers8`         |  7.38 |  47.75 |  50.21 |   **−2.7% [−9.0, −1.6]** |

On the 7/18 high-idle rounds (both engines ≥75% idle), medians align with the paired deltas: `mutableCapture` `15.56 → 13.46 ns/iter` (−9.9%), `buildString` `17.99 → 16.52` (−8.7%), `arguments6` `44.18 → 40.69` (−8.3%), `concatenateStrings` `13.57 → 12.83` (−7.4%), `receivers4` `25.00 → 22.87` (−7.4%), `catchInLoop` `20.92 → 19.90` (−6.3%), `arguments3` `23.56 → 22.12` (−5.2%), `arguments4` `28.83 → 27.79` (−3.0%), `objectRoundTrip` `18.39 → 17.57` (−2.9%), `receivers2` `23.47 → 22.89` (−2.5%), `mixedCall` `20.99 → 20.46` (−2.5%), `receivers8` `44.71 → 43.02` (−1.8%), and `objectArray` `15.59 → 16.41` (+3.9%; pure indexed array loop with no calls).

## Call and loop kernels

20 paired rounds of base `bee1ba669` vs A4 `58ddd3fff` ([data](general-runtime-a4-kernels-darwin-arm64-v1.json); host median idle 88.1–92.2%): `control` improves **−10.8% [−15.1, −8.9]** (`0.14 → 0.13 ns/iter`), all other seven kernels are unchanged within ±0.6%, and untyped Tint remains ahead of Node on all eight (`array` 1.51 vs 1.81, `closure` 2.34 vs 4.60, `control` 0.13 vs 3.88, `method` 2.48 vs 4.32, `property` 1.19 vs 1.82, `recursive` 114.38 vs 234.67, `rest` 0.80 vs 8.67, `stringEquality` 1.18 vs 2.20 ns/iter).

## Frozen v7 self-compile

Built the frozen v7 compiler image with `--runtime-tree` at `74bb1cec5` (`a4-74bb1cec5`, `53,413,554` bytes; subsequent commits `3df6909a0` and `58ddd3fff` touch only unit tests and `packages/js-runtime`). Its `__text` section (`30,702,976` bytes at file offset `4096`) is bit-for-bit identical to A3 (`native-a3-7ae641170`) and base (`native-a3-base-6735358c5`): SHA-256 `f34e866923d72f4e216255008788c8a5d42f2a71740927c46a9af9097fd7bb1d`.

## Validation

- Workspace concurrent check (`env -u TZ pnpm check:concurrent` on `3df6909a0`: `pnpm typecheck`, 6,209 pass / 3 skipped / 0 fail, `pnpm boundaries`, `pnpm format:check`), plus incremental `pnpm build`, `pnpm typecheck`, `pnpm format:check`, `packages/js-runtime/test/ordinary-object-shapes.test.ts` (16/16), `tools/script-runtime-surface.test.ts` (1/1), and `tools/native-script-cases.test.ts` (2/2) on `58ddd3fff` pass.
- All 28 `manifest.memory` tests (including `selfhost-linked.test.ts` 19/19 `complete native compiler pipeline`, `test262-*.test.ts`, `managed-*.test.ts`, `scalar-compact-forms.test.ts`, `script-compile.test.ts`, `typescript-conformance.test.ts`) pass.
- x86-64 `script-entry` codegen (`verify()` + `emitModule(..., { target: "linux-x64" })`) verified for both `construct: false` and `construct: true`.
- Stage-1 native bootstrap (`TZ=UTC node tools/bootstrap-compiler.ts`) succeeds (`48,562,314` bytes).
- All 17 hosted native fixtures (`ordinary-objects`, `arguments`, `tail-dispatch`, `promise-objects`, `promise-intrinsics`, `generator-objects`, `async-generator-objects`, `async-functions`, `async-iteration`, `await`, `shadow-realm`, `dynamic-import`, `module-lowering`, `script-jobs`, `source-tail-steps`, `native-general-property-caches`, `worker-messages`) pass under LLDB (stopped at entry, exit status 42).

## Next (A5 · cold paths)

Disassembly of `method(o)` (237 instructions) and `Box.prototype.get` (67 instructions) on `58ddd3fff` highlights the remaining call-path and cold-path costs:

- **Redundant closure/signature checks in `scriptInvoke` (~13 instructions/call):** `call-indirect` on `ObjectRegisterEntry.scriptInvoke` still checks null, closure descriptor, and signature pointer even though the field type already guarantees a matching closure.
- **Native script entry prologue/epilogue (~42 prologue + ~15 epilogue instructions/call):** saves/restores up to 5 callee-saved pairs, unpacks `x2` mode/count, spills all 6 register actuals (`x10..x15`) plus header (`x4..x9`), and links/unlinks the 32-byte activation record even in leaf callees that never throw or inspect the stack.
- **Caller inlining budget on `script-entry`:** large callers like `run()` in `neon` can exhaust the inlining budget and call `resolveScriptCallEntry` out-of-line instead of emitting inline `script-entry`.
- **A5 cold-path & IC targets:** cold slow-path outlining, polymorphic/megamorphic dispatch overhead, and remaining builtin/element paths ahead of step 6 speculative typing.
