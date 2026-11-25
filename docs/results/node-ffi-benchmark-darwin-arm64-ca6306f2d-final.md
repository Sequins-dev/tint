# Node FFI performance at ca6306f2d on Darwin arm64

Apple M5 Max, Node 26.13.1, 15 rounds and 100,000 measured
calls per case after 20,000 warmup calls. Five workloads rotated through
all launch positions under the shared timing and native launch locks.
All 60 native launches reached LLDB entry and exited 42.
The runner verified 1,830 case and control checksums.
CPU idle was 44.10% to 94.38% (median 81.03%).
One-minute load was 2.96 to 6.07 (median 4.86).
Tint images were prepared at `ca6306f2d6db355913bb4a99f530e6ab3f1f3dd7` (main `3d10cb5c0` merged).
[Per-round evidence](node-ffi-benchmark-darwin-arm64-ca6306f2d-final.json)

## Acceptance method

These comparisons, from the orchestrator's decisions on 2026-11-22, judge
landing:

- **Typed paths** must cost no more than Node in every case, both in total
  call time and in FFI cost over the same-shape JavaScript twin.
- **General (untyped) paths** are judged by FFI cost over the **built-in
  twin**: the case minus a trivial built-in of the same shape, in the same
  round and engine, compared with Node's same difference. An FFI wrapper
  is a built-in function, so this separates the binding from the engine's
  call protocol for built-ins. Untyped time over the JavaScript twin is
  that call protocol, which [PR #12](https://github.com/Sequins-dev/tint/pull/12)
  owns, and is reported but not judged here.

## Findings

- **Typed:** 9 of 9 cases at or below Node for each definition form,
  in total call time and FFI cost. A zero-argument typed call takes 9.08
  ns.
- **General, over the built-in twin:** 9 of 9 cases at or below Node for
  both literal and runtime definitions. At zero arguments the FFI cost
  over the twin is 4.06 ns (literal) and 5.23 ns (runtime).
- **Host load:** Node is far more sensitive to host load than Tint. In
  this run (load median 4.9) Node's zero-argument call took 33.60 ns. In
  the quiet run at `a45f40e41` (load median 2.05) it took 10.08 ns, with
  7.12 ns of FFI cost over its built-in twin. Today's typed 9.08 ns and
  general 4.06 and 5.23 ns are also below those quiet-host figures.
  [Quiet-host report](node-ffi-benchmark-darwin-arm64-a45f40e41-final.md)

## Changes measured

Relative to `a45f40e41`:

- The IR inliner inlines bound record views.
- Typed fixed-arity entries read the wrapper's typed view without calls.
- General calls use the wrapper's call step and maintained callback
  activity flags.
- Typed-only prototype entries serve runtime definitions with the same
  signature key.
- Exact int32 arguments take a fast check.

## Method

Each case has a JavaScript twin with the same call shape. The arity
twins take the same integer arguments and return their sum. The Buffer
twin takes the Buffer and returns a constant, so the C read stays in the
FFI cost. The callback twin passes the same JavaScript function to a
JavaScript caller. **FFI cost** subtracts the twin from its case in the
same round and engine. It isolates the module's own boundary from the
engine's general call cost. **Overhead** subtracts the zero-argument
`js-only-control` closure, as earlier reports did.

Node and the untyped images also call a **built-in twin** of each shape:
`Number()`, `Math.max` over the same arguments, `ArrayBuffer.isView` on
the Buffer and `Reflect.apply` of the callback. An FFI wrapper is a
built-in function, so its cost over this twin separates the binding
from the engine's call protocol for built-ins.

## Call time, twin time and FFI cost

Cells show median call time / twin time / FFI cost in ns per call.

| Case     |                   Node |        Typed literal |        Typed runtime |          Untyped literal |          Untyped runtime |
| -------- | ---------------------: | -------------------: | -------------------: | -----------------------: | -----------------------: |
| arity-0  |   33.60 / 6.22 / 26.74 |   9.08 / 2.09 / 7.01 |   9.07 / 2.10 / 6.97 |   120.91 / 73.55 / 47.72 |   122.28 / 74.13 / 48.12 |
| arity-1  |   19.48 / 2.29 / 17.24 |   9.76 / 2.10 / 7.63 |   9.75 / 2.08 / 7.61 |   135.00 / 80.73 / 53.98 |   133.76 / 80.39 / 53.07 |
| arity-2  |   26.96 / 2.17 / 24.79 |  10.23 / 2.09 / 8.11 |  10.16 / 2.08 / 8.09 |   147.15 / 82.21 / 65.32 |   146.57 / 82.19 / 63.87 |
| arity-4  | 156.62 / 2.20 / 154.53 |  11.15 / 2.09 / 9.07 |  11.05 / 2.07 / 8.97 |   175.45 / 84.84 / 91.13 |   175.64 / 84.99 / 89.84 |
| arity-8  | 126.48 / 2.18 / 124.42 | 13.89 / 2.08 / 11.80 | 13.82 / 2.10 / 11.71 |  226.77 / 91.56 / 134.70 |  227.07 / 91.60 / 135.48 |
| arity-12 | 180.85 / 2.26 / 178.55 | 21.58 / 2.08 / 19.50 | 21.39 / 2.11 / 19.28 |  278.45 / 95.21 / 183.19 |  278.76 / 95.30 / 183.47 |
| arity-24 | 328.93 / 3.27 / 325.40 | 34.25 / 2.13 / 32.14 | 34.09 / 2.09 / 31.97 | 436.79 / 110.94 / 324.97 | 441.14 / 111.65 / 329.72 |
| buffer   |   82.84 / 2.23 / 80.67 | 28.34 / 5.22 / 23.04 | 28.72 / 5.16 / 23.57 | 138.46 / 153.04 / -14.34 | 137.94 / 151.93 / -14.13 |
| callback | 106.86 / 3.94 / 103.00 | 90.83 / 5.68 / 85.33 | 88.73 / 5.52 / 83.12 |  327.18 / 248.97 / 78.90 |  327.19 / 249.05 / 78.47 |

Median zero-argument controls in ns were Node 2.17, Typed literal 1.72, Typed runtime 1.73, Untyped literal 33.39, Untyped runtime 33.15.

## Paired FFI cost versus Node

Cells show the median [Q1, Q3] of Tint's FFI cost minus Node's in the
same round, in ns per call. Negative values favor Tint.

| Case     |              Typed literal |              Typed runtime |          Untyped literal |         Untyped runtime |
| -------- | -------------------------: | -------------------------: | -----------------------: | ----------------------: |
| arity-0  |    -19.49 [-21.76, -12.77] |    -19.80 [-21.74, -12.73] |  +20.62 [+19.40, +29.15] | +26.39 [+19.78, +36.13] |
| arity-1  |      -9.55 [-10.67, -8.13] |      -9.75 [-10.94, -8.06] |  +36.67 [+34.05, +40.13] | +35.67 [+34.10, +37.42] |
| arity-2  |    -16.68 [-17.37, -15.24] |    -16.71 [-17.60, -15.18] |  +40.36 [+38.32, +43.97] | +39.86 [+37.98, +42.69] |
| arity-4  | -142.66 [-150.67, -138.85] | -145.56 [-150.46, -138.89] |  -59.62 [-68.48, -55.99] | -59.29 [-65.81, -57.00] |
| arity-8  | -112.34 [-117.57, -111.24] | -112.59 [-118.18, -111.13] |    +9.98 [+8.13, +11.75] |  +10.33 [+7.26, +12.82] |
| arity-12 | -157.97 [-167.45, -156.86] | -158.47 [-167.53, -156.88] |     +5.30 [+2.16, +7.52] |    +5.11 [+1.74, +7.20] |
| arity-24 | -292.94 [-312.84, -289.01] | -292.50 [-312.23, -289.33] |    +0.50 [-9.58, +10.80] |    +2.75 [-1.05, +5.41] |
| buffer   |    -57.98 [-60.69, -56.69] |    -56.80 [-60.89, -55.90] | -97.12 [-100.98, -94.80] | -94.72 [-98.33, -94.19] |
| callback |    -18.61 [-22.51, -16.54] |    -21.15 [-23.74, -17.61] |  -26.10 [-35.62, -22.95] | -25.98 [-32.08, -20.92] |

## Paired total call time versus Node

| Case     |              Typed literal |              Typed runtime |            Untyped literal |            Untyped runtime |
| -------- | -------------------------: | -------------------------: | -------------------------: | -------------------------: |
| arity-0  |    -24.25 [-26.11, -15.49] |    -24.55 [-26.45, -15.26] |   +87.55 [+85.59, +101.11] |   +93.01 [+87.20, +108.38] |
| arity-1  |     -10.04 [-10.96, -8.17] |      -9.73 [-10.98, -8.14] | +115.50 [+112.80, +118.23] | +113.43 [+111.88, +116.68] |
| arity-2  |    -16.69 [-17.46, -15.25] |    -16.55 [-17.60, -15.31] | +120.80 [+118.01, +123.79] | +120.15 [+117.82, +123.69] |
| arity-4  | -142.81 [-150.56, -138.94] | -145.59 [-150.62, -138.93] |    +22.93 [+13.86, +26.46] |    +22.48 [+19.43, +25.78] |
| arity-8  | -112.39 [-117.72, -111.39] | -112.61 [-118.33, -111.22] |   +99.82 [+97.64, +101.29] |  +101.12 [+98.26, +104.90] |
| arity-12 | -158.10 [-168.09, -157.01] | -158.63 [-168.15, -157.02] |   +98.76 [+94.88, +100.93] |   +99.89 [+93.07, +100.61] |
| arity-24 | -294.33 [-314.03, -289.90] | -293.80 [-313.42, -290.25] | +107.86 [+102.20, +119.96] | +110.53 [+106.12, +114.33] |
| buffer   |    -54.81 [-57.63, -53.52] |    -53.68 [-57.94, -52.68] |    +56.06 [+50.27, +56.84] |    +54.68 [+52.86, +56.60] |
| callback |    -16.06 [-20.81, -14.91] |    -19.47 [-22.38, -15.88] | +220.23 [+213.18, +223.79] | +219.70 [+213.68, +223.80] |

## Paired overhead over the zero-argument control versus Node

| Case     |              Typed literal |              Typed runtime |            Untyped literal |            Untyped runtime |
| -------- | -------------------------: | -------------------------: | -------------------------: | -------------------------: |
| arity-0  |    -23.94 [-25.71, -15.03] |    -24.16 [-25.99, -14.82] |    +56.39 [+54.47, +66.87] |    +61.98 [+56.18, +78.06] |
| arity-1  |      -9.61 [-10.10, -7.79] |      -9.31 [-10.31, -7.73] |    +83.79 [+79.77, +86.98] |    +83.16 [+81.19, +85.51] |
| arity-2  |    -16.30 [-17.05, -13.94] |    -16.26 [-17.28, -13.91] |    +88.12 [+86.64, +91.32] |    +90.39 [+87.23, +92.59] |
| arity-4  | -142.38 [-150.10, -138.41] | -145.06 [-149.97, -138.41] |      -8.87 [-16.96, -4.32] |      -7.89 [-11.53, -5.20] |
| arity-8  | -111.58 [-117.17, -110.67] | -111.46 [-117.71, -110.56] |    +68.63 [+65.97, +69.89] |    +70.57 [+67.91, +72.94] |
| arity-12 | -157.45 [-167.62, -156.63] | -158.23 [-167.66, -156.55] |    +68.18 [+63.95, +69.63] |    +68.66 [+62.35, +69.97] |
| arity-24 | -293.90 [-313.55, -289.56] | -293.55 [-312.93, -289.84] |    +76.61 [+71.30, +89.15] |    +79.61 [+75.59, +83.37] |
| buffer   |    -54.46 [-57.15, -52.79] |    -53.33 [-57.52, -52.28] |    +24.63 [+19.00, +26.10] |    +23.30 [+21.13, +25.95] |
| callback |    -15.69 [-20.31, -14.35] |    -19.21 [-21.89, -15.48] | +188.98 [+182.23, +192.26] | +188.64 [+183.18, +192.52] |

## FFI cost over the built-in twin

Cells show median built-in twin time / FFI cost over it in ns per call.

| Case     |          Node |  Untyped literal |  Untyped runtime |
| -------- | ------------: | ---------------: | ---------------: |
| arity-0  |  7.56 / 25.91 |    117.00 / 4.06 |    116.91 / 5.23 |
| arity-1  |  2.20 / 17.29 |  148.59 / -14.25 |  147.22 / -14.18 |
| arity-2  |  2.17 / 24.88 |  160.00 / -13.16 |  159.15 / -12.24 |
| arity-4  | 2.04 / 154.67 |  196.25 / -20.35 |  197.02 / -21.38 |
| arity-8  | 2.05 / 124.53 |  274.18 / -48.56 |  273.76 / -45.77 |
| arity-12 | 2.05 / 178.83 |  343.61 / -64.37 |  344.25 / -64.00 |
| arity-24 | 2.09 / 326.85 | 557.02 / -120.27 | 559.52 / -119.57 |
| buffer   |  4.68 / 78.44 |    129.95 / 8.22 |    129.61 / 8.25 |
| callback | 5.67 / 101.20 |    323.51 / 3.47 |    321.80 / 3.87 |

Paired against Node, as median [Q1, Q3] in ns per call:

| Case     |            Untyped literal |            Untyped runtime |
| -------- | -------------------------: | -------------------------: |
| arity-0  |    -20.70 [-25.34, -16.72] |     -19.29 [-22.05, -9.55] |
| arity-1  |    -31.09 [-35.73, -28.73] |    -31.46 [-35.34, -29.63] |
| arity-2  |    -38.31 [-39.78, -35.94] |    -37.25 [-40.75, -34.64] |
| arity-4  | -173.28 [-182.34, -167.41] | -175.27 [-179.80, -168.89] |
| arity-8  | -173.49 [-181.93, -171.41] | -172.27 [-175.40, -167.51] |
| arity-12 | -244.00 [-254.96, -242.70] | -243.03 [-248.86, -241.29] |
| arity-24 | -446.05 [-480.71, -442.29] | -445.26 [-463.89, -439.77] |
| buffer   |    -71.30 [-78.65, -67.86] |    -69.88 [-73.58, -68.41] |
| callback |   -98.34 [-102.67, -94.04] |   -96.55 [-104.96, -93.08] |

## Landing criteria

- Typed literal: FFI cost at or below Node's in 9 of 9 cases; total call time at or below Node's in 9 of 9.
- Typed runtime: FFI cost at or below Node's in 9 of 9 cases; total call time at or below Node's in 9 of 9.
- Untyped literal: FFI cost at or below Node's in 3 of 9 cases (above in arity-0, arity-1, arity-2, arity-8, arity-12, arity-24); FFI cost over the built-in twin at or below Node's in 9 of 9.
- Untyped runtime: FFI cost at or below Node's in 3 of 9 cases (above in arity-0, arity-1, arity-2, arity-8, arity-12, arity-24); FFI cost over the built-in twin at or below Node's in 9 of 9.
