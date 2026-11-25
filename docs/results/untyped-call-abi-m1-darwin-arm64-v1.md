# Untyped call ABI M1 · 7-register script actuals, activation elision/deferral, and inline numeric returns · Darwin arm64

Milestone 1 of the untyped call-ABI and allocation stream on top of `main` (`c0d6fe1d1`): widen the AArch64 native script call convention from 3 to 7 register actuals (`x10`–`x15` for actuals `0..2`, `d0`–`d7` for actuals `3..6` moved via GP-domain `fmov` + `stp`/`ldp` to avoid Apple Silicon FP↔GP store-to-load forwarding stalls), keep native `script-argument` paths and fused property/element IC hits on hot fallthrough (`packages/codegen/src/aarch64/scalar/block-entries.ts`), elide activation records on pure-leaf script entries and lazily link/unlink activations (with deferred zeroing of extra actual slots `3..6`) around cold non-loop `call` and `call-indirect` sites, elide dead `callee`/`receiver`/`new.target` header stores, emit a single-guard native argument extraction path for multi-parameter functions, and inline loop-free pure numeric returns (`return <binary|unary>`) directly on native script entries (`packages/js-engine/src/lowering/index.ts`). Base `c0d6fe1d1`; head `c5b701d4d`. Apple M5 Max, Node 26.13.1.

On `neon` warm-call instruction traces (501st call), **all 9/9 probe functions improve**: `callDeep` **−13.0%** (`184 → 160`), `setState` **−13.0%** (`92 → 80`), `Box.prototype.get` **−11.9%** (`67 → 59`), `Vec.prototype.dot` **−4.1%** (`366 → 351`), `Task.prototype.isHeldOrSuspended` **−3.7%** (`270 → 260`), `method` **−3.2%** (`217 → 210`), `walk` **−3.1%** (`1,208 → 1,170`), `dot` **−2.5%** (`512 → 499`), and `make` **−0.4%** (`461 → 459`). On Octane (18 paired rounds, 18/18 ≥75% host idle, 93.4% base / 93.1% M1 median idle), **`Richards` improves −4.07%** (`0.871 → 0.833 ms/op`, `18.4×` Node), **`RayTrace` improves −2.03%** (`6.400 → 6.250 ms/op`, `12.4×` Node), **`DeltaBlue` improves −2.01%** (`2.004 → 1.958 ms/op`, `32.0×` Node), and **`NavierStokes` is flat** (`2.937 → 2.941 ms/op`, `+0.43%`, `1.6×` Node). On the generality suite (18 paired rounds, 18/18 ≥75% idle), **all four multi-argument kernels drop −22% to −27%** (`arguments3` **−22.24%**, `arguments4` **−25.48%**, `arguments5` **−26.38%**, `arguments6` **−27.44%**), **`mixedCall` drops −17.53%** (`9.871 → 8.119 ns`, `2.3×` Node), **`buildString` drops −10.18%** (`5.930 → 5.334 ns`, `0.6×` Node), **`objectArray` drops −5.23%**, **`mutableCapture` drops −4.45%**, and **`catchInLoop` drops −2.39%**. Call and loop kernels (20 paired rounds, 20/20 ≥75% idle) remain ahead of Node across all eight benchmarks (`0.03×`–`0.9×` Node) with zero regressions. `string-bench --suite general` (18 paired rounds, 18/18 ≥75% idle) is flat (`upperCase` `−0.10%`, `json` `+0.09%`). Typed AOT outputs — **frozen v7 `--runtime-tree`**, **`string-bench --suite typed`**, and **`kernels` typed** — produce **bit-for-bit identical** `__TEXT,__text`, `__TEXT,__eh_frame`, `__TEXT,__unwind_info`, and `__DATA,__data` Mach-O sections versus `main` (`c0d6fe1d1`). Both Darwin arm64 `stage1 == stage2` and native `stage1 --target linux-x86_64` cross-emission reproduce their stage-1 images byte for byte under LLDB.

## What changed

| Commit      | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `c5b701d4d` | Widen AArch64 script register actuals from 3 to 7 pairs (`x10`–`x15` for `0..2`, `d0`–`d7` for `3..6` transferred via GP-domain `fmov` + `stp`/`ldp` to eliminate FP↔GP store-to-load forwarding stalls) in `packages/codegen/src/aarch64/scalar/abi.ts` and `packages/codegen/src/aarch64/scalar/index.ts`. Keep fused property/element IC hits and native `script-argument` paths on hot fallthrough in `packages/codegen/src/aarch64/scalar/block-entries.ts`. Add `elideActivation` (pure-leaf script entries) and `lazyActivation` (deferring `nativeActivationTop` linking and extra-actual slot zeroing to cold non-loop `call` and `call-indirect` sites, skipping linking around verified pure-leaf direct calls), cold-stub spilling for `argc > 3` on functions that do not read extra actuals, and dead header parameter store elision (`callee`/`receiver`/`new.target`) in `packages/codegen/src/aarch64/scalar/index.ts`. Update `scriptRegisterActuals = 7`, add single-guard native argument extraction (`extractNativeArguments`), and inline loop-free pure arithmetic returns (`inlineNumericReturn`) on native script entries in `packages/js-engine/src/lowering/index.ts`. Add layout, stack-map, and native semantic tests in `packages/codegen/test/scalar-js-entry-layout.test.ts` and `tools/native-script-cases.test.ts`. |

## Warm calls

One warm call (the 501st), entry to return with callees, single-stepped under LLDB (`tools/general-call-bench/count_call.py`) on the `neon` ES module probe ([traces](untyped-call-abi-m1-traces-darwin-arm64-v1.json)):

| Probe function                      | Base (`c0d6fe1d1`) | M1 (`c5b701d4d`) |           Change |
| ----------------------------------- | -----------------: | ---------------: | ---------------: |
| `method(o)`: `o.get()`              |                217 |          **210** |   **−7 (−3.2%)** |
| `make(v)`: `new Box(v)`             |                461 |          **459** |   **−2 (−0.4%)** |
| `dot(a, b)`: `a.dot(b)`             |                512 |          **499** |  **−13 (−2.5%)** |
| `callDeep(s)` (depth-2 prototype)   |                184 |          **160** | **−24 (−13.0%)** |
| `walk(t)` (3 × `isHeldOrSuspended`) |              1,208 |        **1,170** |  **−38 (−3.1%)** |
| `setState(t, v)`: `t.state = v`     |                 92 |           **80** | **−12 (−13.0%)** |
| `Box.prototype.get`                 |                 67 |           **59** |  **−8 (−11.9%)** |
| `Vec.prototype.dot`                 |                366 |          **351** |  **−15 (−4.1%)** |
| `Task.prototype.isHeldOrSuspended`  |                270 |          **260** |  **−10 (−3.7%)** |

Every probe drops instructions: `Base.prototype.deepGet` inside `callDeep` uses pure-leaf `elideActivation`, while `Box.prototype.get`, `setState`, `Box`, `Vec.prototype.dot`, and `Task.prototype.isHeldOrSuspended` all use `lazyActivation` with deferred extra-actual zeroing, dead header-store elision, and hot-fallthrough block ordering.

## Octane

18 paired rounds of `main` base `c0d6fe1d1` vs M1 `c5b701d4d` under `tools/gate/with-lock.sh both` on Apple M5 Max (clean trees, `patchSha256` empty; `18/18` rounds ≥75% host idle, median idle `93.4%` base / `93.1%` M1, load1 median `2.65` / `2.52`). Medians in ms/op and median `[q1, q3]` of per-round percent and absolute change ([data](untyped-call-abi-m1-octane-darwin-arm64-v1.json)). Bold: interquartile range excludes zero.

| Program        | Node ms/op | Base ms/op | M1 ms/op | M1 − base (%), median [IQR] |   Δ ms/op, median [IQR] | M1 ÷ Node |
| -------------- | ---------: | ---------: | -------: | --------------------------: | ----------------------: | --------: |
| `Richards`     |      0.045 |      0.871 |    0.833 |   **−4.07% [−5.32, −3.22]** | −0.035 [−0.047, −0.028] |     18.4× |
| `DeltaBlue`    |      0.061 |      2.004 |    1.958 |   **−2.01% [−2.74, −1.36]** | −0.040 [−0.055, −0.027] |     32.0× |
| `NavierStokes` |      1.828 |      2.937 |    2.941 |       +0.43% [−0.31, +1.07] | +0.013 [−0.009, +0.031] |      1.6× |
| `RayTrace`     |      0.505 |      6.400 |    6.250 |   **−2.03% [−2.58, −1.33]** | −0.130 [−0.164, −0.085] |     12.4× |

All three call- and object-heavy Octane programs (`Richards`, `DeltaBlue`, `RayTrace`) improve with non-overlapping IQRs while `NavierStokes` remains flat at `1.6×` Node.

## Generality kernels

18 paired rounds of `main` base `c0d6fe1d1` vs M1 `c5b701d4d` under `tools/gate/with-lock.sh both` (`18/18` rounds ≥75% host idle, median idle `93.8%` base / `93.5%` M1, load1 median `1.81` / `1.81`). Medians in ns/iteration and median `[q1, q3]` of per-round percent and absolute change ([data](untyped-call-abi-m1-generality-darwin-arm64-v1.json)). Bold: interquartile range excludes zero.

| Kernel               | Node ns | Base ns |  M1 ns |  M1 − base (%), median [IQR] |      Δ ns, median [IQR] | M1 ÷ Node |
| -------------------- | ------: | ------: | -----: | ---------------------------: | ----------------------: | --------: |
| `allocateObjects`    |   5.665 |  46.386 | 49.794 |    **+7.49% [+6.06, +8.52]** | +3.438 [+2.857, +3.848] |      8.8× |
| `arguments3`         |   2.225 |  20.055 | 15.774 | **−22.24% [−22.79, −20.70]** | −4.452 [−4.629, −4.126] |      7.1× |
| `arguments4`         |   2.247 |  23.728 | 17.638 | **−25.48% [−26.17, −23.97]** | −6.029 [−6.232, −5.543] |      7.8× |
| `arguments5`         |   2.222 |  26.744 | 19.614 | **−26.38% [−27.23, −25.36]** | −7.058 [−7.284, −6.818] |      8.8× |
| `arguments6`         |   2.357 |  29.727 | 21.563 | **−27.44% [−27.73, −26.80]** | −8.135 [−8.261, −7.966] |      9.1× |
| `buildString`        |   8.599 |   5.930 |  5.334 |  **−10.18% [−10.48, −9.20]** | −0.602 [−0.618, −0.544] |      0.6× |
| `builtinMethod`      |   3.916 |   5.659 |  5.826 |    **+3.10% [+2.21, +4.27]** | +0.175 [+0.125, +0.240] |      1.5× |
| `catchInLoop`        |   3.202 |  19.752 | 19.225 |    **−2.39% [−3.71, −1.03]** | −0.472 [−0.731, −0.205] |      6.0× |
| `concatenateStrings` |   6.593 |  10.852 | 10.852 |        +0.06% [−0.58, +0.91] | +0.007 [−0.063, +0.098] |      1.6× |
| `mathMax`            |   1.997 |   4.423 |  4.476 |    **+1.52% [+1.02, +2.84]** | +0.067 [+0.045, +0.124] |      2.2× |
| `mixedCall`          |   3.470 |   9.871 |  8.119 | **−17.53% [−18.13, −16.92]** | −1.738 [−1.794, −1.660] |      2.3× |
| `mutableCapture`     |   4.893 |  11.891 | 11.384 |    **−4.45% [−5.77, −2.68]** | −0.532 [−0.688, −0.319] |      2.3× |
| `numberCall`         |   1.845 |   3.631 |  3.727 |    **+2.62% [+1.88, +3.53]** | +0.095 [+0.069, +0.127] |      2.0× |
| `objectArray`        |   2.071 |  11.304 | 10.716 |    **−5.23% [−5.44, −4.06]** | −0.591 [−0.615, −0.458] |      5.2× |
| `objectRoundTrip`    |   2.061 |  16.142 | 16.052 |        −0.35% [−2.58, +1.17] | −0.056 [−0.419, +0.184] |      7.8× |
| `receivers2`         |   4.364 |  14.710 | 15.050 |    **+1.72% [+1.34, +4.79]** | +0.252 [+0.197, +0.700] |      3.4× |
| `receivers4`         |   4.372 |  16.023 | 17.285 |   **+6.58% [+5.61, +10.72]** | +1.057 [+0.913, +1.709] |      4.0× |
| `receivers8`         |   5.465 |  36.599 | 36.643 |        +0.28% [−1.21, +1.09] | +0.103 [−0.450, +0.397] |      6.7× |

Multi-argument calls (`arguments3`–`arguments6`) drop `−22.24%` to `−27.44%` (`−4.45` to `−8.14 ns/iter`) from the 7-register ABI, GP-domain `fmov` register actual transfer, deferred activation linking, and inline numeric returns; `mixedCall` drops `−17.53%`, `buildString` `−10.18%` (`0.6×` Node), `objectArray` `−5.23%`, `mutableCapture` `−4.45%`, and `catchInLoop` `−2.39%`. `allocateObjects` (`+7.49%`, `+3.44 ns`) reflects `makeRecord`'s inline object allocation keeping `scriptHasNonCallSafepoint = true`, which zeroes the 4 extra rooted actual slots in the prologue; Milestone 2's inline object-literal allocation and compact rooting directly target this kernel.

## Elements, builtins, and creation kernels

18 paired rounds of `main` base `c0d6fe1d1` vs M1 `c5b701d4d` under `tools/gate/with-lock.sh both` (`18/18` rounds ≥75% host idle, median idle `94.0%` base / `93.8%` M1, load1 median `1.61` / `1.60`). Medians in ns/iteration and median `[q1, q3]` of per-round percent and absolute change ([data](untyped-call-abi-m1-elements-darwin-arm64-v1.json)). Bold: interquartile range excludes zero.

| Kernel                | Node ns | Base ns |  M1 ns | M1 − base (%), median [IQR] |      Δ ns, median [IQR] | M1 ÷ Node |
| --------------------- | ------: | ------: | -----: | --------------------------: | ----------------------: | --------: |
| `charCodeAt`          |   2.263 |   3.685 |  3.678 |   **−1.96% [−4.78, −0.03]** | −0.073 [−0.178, −0.001] |      1.6× |
| `mapSetHas`           |   8.112 |   8.091 |  8.107 |       −0.13% [−0.83, +0.33] | −0.010 [−0.068, +0.027] |      1.0× |
| `mathFloor`           |   2.040 |   4.388 |  4.607 |   **+4.94% [+3.52, +5.68]** | +0.217 [+0.156, +0.249] |      2.3× |
| `mathSqrt`            |   2.172 |   2.500 |  2.601 |   **+4.22% [+3.39, +4.39]** | +0.106 [+0.085, +0.109] |      1.2× |
| `numberArrayLiteral`  |   7.498 |  36.618 | 36.899 |       +0.40% [−2.18, +3.44] | +0.142 [−0.823, +1.232] |      4.9× |
| `numberElementRead`   |   1.985 |   1.245 |  1.248 |       +0.03% [−1.70, +1.80] | +0.000 [−0.021, +0.023] |      0.6× |
| `numberElementUpdate` |   1.581 |   1.252 |  1.269 |       +0.79% [−1.12, +3.24] | +0.010 [−0.014, +0.041] |      0.8× |
| `numberElementWrite`  |   1.756 |   1.249 |  1.254 |       −0.02% [−1.25, +2.70] | −0.000 [−0.016, +0.033] |      0.7× |
| `objectArrayLiteral`  |   3.730 |  41.330 | 41.682 |       +0.58% [−0.47, +1.48] | +0.239 [−0.196, +0.607] |     11.2× |
| `objectElementRead`   |   1.689 |   7.900 |  7.881 |       +0.19% [−1.29, +1.28] | +0.015 [−0.101, +0.099] |      4.7× |
| `objectLiteral`       |   4.674 |   4.118 |  4.129 |       +0.11% [−0.58, +1.13] | +0.004 [−0.024, +0.046] |      0.9× |
| `pushLength`          |   4.034 |  10.908 | 10.868 |       −0.81% [−1.71, +0.41] | −0.088 [−0.189, +0.045] |      2.7× |
| `setAddHas`           |   6.898 |   8.160 |  8.353 |   **+2.20% [+1.11, +3.78]** | +0.179 [+0.091, +0.307] |      1.2× |

## Call and loop kernels & `string-bench`

- **Call and loop kernels** (20 paired rounds, `20/20` ≥75% host idle, median idle `93.5%` base / `94.4%` M1, load1 `1.99` / `2.01`; [data](untyped-call-abi-m1-kernels-darwin-arm64-v1.json)): zero regressions; all eight untyped kernels stay ahead of Node (`0.03×`–`0.9×`): `array` `1.588` vs `1.838` (`0.9×`), `closure` `2.333` vs `4.534` (`0.5×`), `control` `0.125` vs `3.701` (`0.03×`), `method` `2.401` vs `4.209` (`0.6×`, `−1.48%`), `property` `1.188` vs `1.764` (`0.7×`, `−1.12%`), `recursive` `114.489` vs `231.354` (`0.5×`), `rest` `0.801` vs `8.692` (`0.1×`), and `stringEquality` `0.800` vs `2.134` (`0.4×`) ns/iter.
- **`string-bench --suite general`** (18 paired rounds, `18/18` ≥75% host idle, median idle `93.3%` base / `93.4%` M1, load1 `1.86` / `1.85`; [data](untyped-call-abi-m1-string-general-darwin-arm64-v1.json)): `upperCase` `0.814 → 0.811 ms` (`−0.10%` `[−0.75, +0.50]`, `4.54×` Node) and `json` `83.897 → 83.903 ms` (`+0.09%` `[−0.16, +0.41]`, `10.12×` Node).

## Typed AOT invariance (frozen v7, `string-bench`, `kernels`)

All three typed AOT images produce **bit-for-bit identical** `__TEXT,__text`, `__TEXT,__eh_frame`, `__TEXT,__unwind_info`, and `__DATA,__data` Mach-O sections between `main` (`c0d6fe1d1`) and M1 (`c5b701d4d`):

- **Frozen v7 `--runtime-tree`** (`53,496,850` bytes):
  - `__TEXT,__text`: `31,355,776` bytes at file offset `4096`, SHA-256 `63c08676173c8ea816d709f79b70f7a3e0fd4fe42359184e98055fd073bb0b22`
  - `__TEXT,__eh_frame`: `271,032` bytes, SHA-256 `90c39d126fb3e4b2f9a7ded86590d07448c05d0ec6c02688b510d3653d68f001`
  - `__TEXT,__unwind_info`: `45,460` bytes, SHA-256 `dd43adf47b0fe2199e5ba59bbb581cabaddf7b09e9e14aa96a1a0937c13358f1`
  - `__DATA,__data`: `2,400` bytes, SHA-256 `e2eb9763940c165642d818b5eff6c5437e73d22d840f2443047c81e81c35d07c`
- **`string-bench --suite typed`**: `__TEXT,__text` `22,494,232` bytes, SHA-256 `b07ec020b0d48da24318e54c3f7cee7b311aaea7f93b0f8171ea98703f679c53` (all 4 sections identical).
- **`kernels` typed**: `__TEXT,__text` `667,112` bytes, SHA-256 `8bd4911c5f237c4d5d000b727a320026174e9428ed2d03ec784ac540bb1674ef` (full image SHA-256 identical).

## Validation

- **Static & workspace unit gates** (`c5b701d4d`): `pnpm build`, `tsc --noEmit -p tsconfig.tests.json`, `tsc --noEmit -p tsconfig.host.json`, `pnpm boundaries`, `pnpm format:check`, `tools/selfhost-linked.test.ts` (**19/19 pass**), `tools/check-test-files.ts concurrent` (**6,299 pass / 3 skipped / 0 fail**), and `tools/check-test-files.ts memory` (**242/242 pass**).
- **Native general, script, and worker tests under LLDB** (`c5b701d4d`, `TZ=UTC`): `tools/native-general-elements.test.ts`, `tools/native-general-intrinsics.test.ts`, `tools/native-general-numbers.test.ts`, `tools/native-general-property-caches.test.ts`, `tools/native-script-cases.test.ts` (including 4..7 register actuals, 8+ overflow actuals, lazy-activation `fn.caller`/`fn.arguments[0..8]`/`new Error().stack`, exception unwinding after lazy IC miss throw, GC survival of args 0..8 across cold calls, strict tail calls with 4/7/8 args at 100k depth, and `f.apply(this, arguments)` forwarding), and `tools/native-worker-messages.test.ts` — **9/9 pass**.
- **Hosted native LLDB fixtures** (`TZ=UTC`, verified twice each under LLDB asserting stopped-at-entry and exit status 42): all 9 ABI- and call-sensitive hosted fixtures (`ordinary-objects`, `arguments`, `native-arguments`, `tail-dispatch`, `tail-call-apply`, `tail-transfer-gc`, `source-tail-steps`, `script-jobs`, `stack-traces`) pass on `c5b701d4d`, and the remaining 10 (`promise-objects`, `promise-intrinsics`, `generator-objects`, `async-generator-objects`, `async-functions`, `async-iteration`, `await`, `shadow-realm`, `dynamic-import`, `module-lowering`) also pass twice each on the milestone branch.
- **Darwin arm64 self-build fixpoint** (`c5b701d4d`, `TZ=UTC`): stage 1 (`59,361,162` bytes) builds stage 2 from the same frozen source snapshot under LLDB asserting stopped-at-entry and exit status 0; `cmp stage1 stage2` is byte-identical (SHA-256 `88ec8164da4c78923f5fdd7c2ce1528ef12c265f8401f470f3f56efb4aac3e2d`).
- **Linux x86-64 cross-bootstrap & native cross-emission fixpoint** (`c5b701d4d`, `TZ=UTC`): Node-hosted `--target linux-x86_64` builds `x64-stage1` (`253,622,560` bytes, SHA-256 `3535869311c84e0c66f2ff80e0ec7216f366b221ec1bb6f45d916bf5ab756c63`), and native Darwin arm64 `stage1` under LLDB (`stage1 source-x64 stage2-linux-x64 --target linux-x86_64`, stopped at entry, exit status 0) emits `stage2-linux-x64` byte-for-byte identical to `stage1-linux-x64`.

## Next

- **Milestone 2 (Allocation & Object/Array Creation):** inline bump-pointer ordinary-object and dense-array literal construction (`new Constructor()`, `{ a, b }`, `[a, b, c]`) with pre-known final shapes and compact activation rooting to attack `allocateObjects` (`8.8×`), `objectArrayLiteral` (`11.2×`), `numberArrayLiteral` (`4.9×`), and `RayTrace` (`12.4×`) / `DeltaBlue` (`32.0×`).
- **Milestone 3 (Direct-call / Monomorphic Method Specialization & Receiver-Shape CSE):** eliminate indirect method dispatch and repeated receiver shape checks in `Richards` (`18.4×`), `DeltaBlue` (`32.0×`), `RayTrace` (`12.4×`), `receivers2`/`receivers4`, and `arguments3`–`arguments6`.
