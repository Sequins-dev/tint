# Node FFI performance at 4d463592b on Darwin arm64

Apple M5 Max, Node 26.13.1, 15 rounds and 100,000 measured
calls per case after 20,000 warmup calls. Five workloads rotated through
all launch positions under the shared timing and native launch locks (`TZ=UTC`).
All 60 native launches reached LLDB entry and exited 42.
The runner verified 1,830 case and control checksums.
CPU idle was 63.25% to 88.98% (median 79.00%).
One-minute load was 3.96 to 4.51 (median 4.12).
Tint images were prepared at `4d463592bb55723c27a453a6b033e92e661eafc9` (main `c0d6fe1d1` merged, post PR #12 + PR #18 + PR #42).
[Per-round evidence](node-ffi-benchmark-darwin-arm64-4d463592b-final.json)

## Findings

- **Typed:** 9 of 9 cases at or below Node in total call time for both literal and runtime definitions (`arity-0` takes 8.52–8.61 ns vs Node's 9.00 ns; `arity-4`..`arity-24` are 9.8×–14.3× faster than Node). 8 of 9 cases are at or below Node in FFI cost over the same-shape JavaScript twin; on `arity-0`, Tint's total call time is faster than Node (-0.35 ns), while Tint's JS twin (2.09–2.13 ns) is 1.2 ns faster than Node's (3.31 ns), leaving FFI cost at 6.46–6.52 ns vs Node's 5.47 ns.
- **General (untyped), over the built-in twin:** 9 of 9 cases at or below Node for both literal and runtime definitions (-50.89 ns to -513.22 ns vs Node).
- **General (untyped), total time and FFI cost over the JS twin (post PR #12 + `scriptInvoke`):**
  - Native `scriptInvoke` entries for compiled numeric, unary-pointer, and pointer-i32 wrappers cut `arity-0` from 120.9 ns (pre-#12) / 52.5 ns (post-#12) to **12.4 ns**, `arity-1` to **20.4 ns**, `arity-2` to **21.8 ns** (faster than Node's 27.2 ns), and `buffer` to **25.8–26.4 ns** (2.9× faster than Node's 75.2 ns).
  - Enabling the `runtimeI32` callback trampoline for untyped `(i32) -> i32` callbacks with direct unary `scriptCall` dispatch cut untyped `callback` from 327.2 ns (pre-#12) / 263.1 ns (post-#12) to **110.9 ns**, with FFI cost over the JS twin (88.5–89.6 ns) **beating Node's 96.4 ns**.
  - Inlining exact-int32 validation in `invokecallStaticFfiNumber` and PR #12's general runtime bring untyped `arity-4` (92.1 ns vs 147.1 ns), `arity-12` (187.9 ns vs 198.0 ns), and `arity-24` (337.6 ns vs 347.6 ns) below Node in both total call time and FFI cost over the JS twin.
  - Overall, untyped FFI now beats Node on **6 of 9 cases in FFI cost over the JS twin** (`arity-2`, `arity-4`, `arity-12`, `arity-24`, `buffer`, `callback`) and **5 of 9 cases in total call time** (`arity-2`, `arity-4`, `arity-12`, `arity-24`, `buffer`), with `arity-1` FFI cost within 0.4 ns of Node.

## Call time, twin time and FFI cost

Cells show median call time / JS twin time / FFI cost in ns per call.

| Case | Node | Typed literal | Typed runtime | Untyped literal | Untyped runtime |
| --- | ---: | ---: | ---: | ---: | ---: |
| arity-0 | 9.00 / 3.31 / 5.47 | 8.61 / 2.13 / 6.52 | 8.52 / 2.09 / 6.46 | 12.46 / 4.43 / 8.03 | 12.40 / 4.43 / 7.97 |
| arity-1 | 18.53 / 2.31 / 16.16 | 9.24 / 2.09 / 7.10 | 9.13 / 2.09 / 7.06 | 20.41 / 4.46 / 15.93 | 20.35 / 4.43 / 15.92 |
| arity-2 | 27.15 / 2.14 / 25.04 | 9.49 / 2.09 / 7.39 | 9.48 / 2.10 / 7.38 | 21.78 / 4.44 / 17.34 | 22.15 / 4.45 / 17.73 |
| arity-4 | 147.07 / 2.25 / 144.87 | 10.26 / 2.10 / 8.15 | 10.32 / 2.12 / 8.21 | 92.39 / 4.49 / 87.90 | 92.13 / 4.56 / 87.02 |
| arity-8 | 132.18 / 2.27 / 129.83 | 12.77 / 2.11 / 10.55 | 13.15 / 2.10 / 11.02 | 140.20 / 5.04 / 135.17 | 142.00 / 5.23 / 136.77 |
| arity-12 | 197.96 / 2.32 / 195.72 | 20.28 / 2.10 / 18.26 | 20.42 / 2.11 / 18.33 | 187.89 / 5.56 / 181.46 | 189.80 / 5.48 / 183.92 |
| arity-24 | 347.55 / 3.05 / 344.62 | 34.45 / 2.10 / 32.08 | 33.99 / 2.09 / 31.85 | 339.05 / 6.68 / 332.16 | 337.63 / 6.58 / 330.97 |
| buffer | 75.20 / 2.19 / 73.07 | 28.80 / 5.35 / 23.44 | 27.51 / 5.36 / 22.17 | 26.41 / 92.24 / -65.64 | 25.79 / 92.57 / -66.39 |
| callback | 100.34 / 3.97 / 96.41 | 90.64 / 6.06 / 84.29 | 92.08 / 6.09 / 85.98 | 110.96 / 22.61 / 89.62 | 110.92 / 22.49 / 88.52 |

Median zero-argument controls in ns were Node 2.20, Typed literal 1.83, Typed runtime 1.81, Untyped literal 4.28, Untyped runtime 4.26.

## General call time, built-in twin and FFI cost over built-in

Cells show median call time / built-in twin time / cost over built-in in ns per call.

| Case | Node | Untyped literal | Untyped runtime |
| --- | ---: | ---: | ---: |
| arity-0 | 9.00 / 3.10 / 5.87 | 12.46 / 58.92 / -45.79 | 12.40 / 58.34 / -46.08 |
| arity-1 | 18.53 / 2.43 / 15.54 | 20.41 / 73.93 / -53.44 | 20.35 / 72.34 / -52.02 |
| arity-2 | 27.15 / 2.13 / 25.13 | 21.78 / 87.07 / -64.02 | 22.15 / 83.71 / -61.84 |
| arity-4 | 147.07 / 2.12 / 144.98 | 92.39 / 122.53 / -29.61 | 92.13 / 124.96 / -29.42 |
| arity-8 | 132.18 / 2.13 / 129.88 | 140.20 / 199.28 / -58.47 | 142.00 / 197.72 / -56.65 |
| arity-12 | 197.96 / 2.12 / 195.72 | 187.89 / 282.15 / -91.04 | 189.80 / 277.60 / -86.19 |
| arity-24 | 347.55 / 2.14 / 345.41 | 339.05 / 507.80 / -170.85 | 337.63 / 498.19 / -157.88 |
| buffer | 75.20 / 4.41 / 71.03 | 26.41 / 54.37 / -27.86 | 25.79 / 55.68 / -29.99 |
| callback | 100.34 / 5.91 / 94.24 | 110.96 / 229.78 / -115.69 | 110.92 / 224.49 / -112.37 |

## Paired FFI cost versus Node (over JS twin)

Cells show the median [Q1, Q3] of Tint's FFI cost minus Node's in the same round, in ns per call. Negative values favor Tint.

| Case | Typed literal | Typed runtime | Untyped literal | Untyped runtime |
| --- | ---: | ---: | ---: | ---: |
| arity-0 | +1.25 [+0.65, +2.16] | +0.88 [+0.67, +1.91] | +2.64 [+2.36, +3.64] | +2.48 [+2.24, +3.45] |
| arity-1 | -8.83 [-9.87, -7.87] | -8.92 [-9.73, -7.87] | +0.39 [-1.04, +1.19] | +0.10 [-0.19, +1.04] |
| arity-2 | -17.13 [-18.48, -14.93] | -16.19 [-18.85, -14.70] | -7.15 [-8.38, -3.63] | -6.53 [-8.17, -4.10] |
| arity-4 | -136.85 [-145.60, -129.59] | -136.83 [-144.97, -128.15] | -57.22 [-62.69, -50.45] | -54.87 [-63.54, -50.51] |
| arity-8 | -119.05 [-119.98, -112.46] | -117.74 [-119.96, -112.22] | +5.38 [+4.00, +9.11] | +9.21 [+3.04, +16.70] |
| arity-12 | -177.43 [-183.05, -171.91] | -177.20 [-182.73, -172.19] | -8.63 [-16.81, -6.31] | -10.40 [-14.49, -6.02] |
| arity-24 | -311.75 [-325.76, -304.52] | -313.19 [-324.97, -304.79] | -17.61 [-25.67, -6.65] | -16.42 [-27.87, -11.28] |
| buffer | -50.82 [-53.50, -43.96] | -50.70 [-52.61, -45.92] | -139.05 [-148.54, -134.29] | -139.63 [-144.76, -135.73] |
| callback | -12.30 [-17.64, -9.94] | -10.91 [-12.94, -9.14] | -8.79 [-10.99, -3.47] | -7.21 [-11.62, -4.32] |

## Paired total call time versus Node

| Case | Typed literal | Typed runtime | Untyped literal | Untyped runtime |
| --- | ---: | ---: | ---: | ---: |
| arity-0 | -0.35 [-0.56, +0.10] | -0.34 [-0.74, -0.20] | +3.68 [+3.43, +4.07] | +3.51 [+3.05, +3.90] |
| arity-1 | -9.17 [-10.13, -8.10] | -9.26 [-9.97, -8.14] | +2.30 [+1.13, +3.41] | +2.37 [+1.77, +3.21] |
| arity-2 | -16.99 [-18.64, -15.11] | -15.76 [-18.93, -14.56] | -4.31 [-6.26, -1.40] | -4.08 [-6.06, -1.80] |
| arity-4 | -136.97 [-145.94, -129.63] | -136.93 [-145.02, -127.51] | -54.91 [-60.71, -48.57] | -52.53 [-61.23, -48.25] |
| arity-8 | -119.45 [-119.96, -112.60] | -117.94 [-120.14, -112.25] | +7.98 [+6.99, +12.08] | +12.71 [+5.76, +19.86] |
| arity-12 | -177.80 [-183.26, -172.01] | -177.29 [-182.90, -172.42] | -5.40 [-13.37, -3.02] | -7.08 [-11.39, -2.98] |
| arity-24 | -312.85 [-327.15, -305.18] | -313.99 [-326.34, -305.67] | -13.90 [-22.48, -2.89] | -13.18 [-24.34, -7.70] |
| buffer | -47.55 [-50.67, -40.65] | -47.45 [-49.52, -42.83] | -49.04 [-53.92, -43.99] | -49.87 [-52.67, -43.96] |
| callback | -9.08 [-15.34, -7.57] | -8.68 [-10.67, -7.07] | +11.15 [+6.72, +14.44] | +10.39 [+7.25, +14.16] |

## Paired general FFI cost over built-in twin versus Node

| Case | Untyped literal | Untyped runtime |
| --- | ---: | ---: |
| arity-0 | -50.89 [-52.96, -49.25] | -52.87 [-55.55, -51.35] |
| arity-1 | -69.21 [-71.13, -67.44] | -68.12 [-70.71, -67.33] |
| arity-2 | -89.54 [-91.53, -86.44] | -86.37 [-89.96, -84.85] |
| arity-4 | -180.80 [-187.06, -166.16] | -175.90 [-186.69, -166.48] |
| arity-8 | -186.12 [-197.03, -180.46] | -187.80 [-189.21, -178.90] |
| arity-12 | -285.10 [-287.86, -278.17] | -284.90 [-289.48, -281.35] |
| arity-24 | -513.22 [-534.28, -505.21] | -508.55 [-518.04, -496.31] |
| buffer | -100.84 [-103.00, -93.04] | -101.27 [-103.72, -95.75] |
| callback | -210.62 [-221.84, -203.66] | -205.21 [-217.00, -203.69] |
