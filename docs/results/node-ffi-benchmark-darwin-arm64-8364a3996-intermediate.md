# Intermediate Node FFI performance at 8364a3996 on Darwin arm64

Apple M5 Max, Node 26.13.1, 15 rounds and 100,000 measured
calls per case after 20,000 warmup calls. Five workloads rotated through
all launch positions under the shared timing and native launch locks.
All 60 native launches reached LLDB entry and exited 42.
The runner verified 1,830 case and control checksums.
CPU idle was 22.01% to 88.70% (median 75.71%).
One-minute load was 3.54 to 10.01 (median 6.51).
Tint images were prepared at `8364a39961f8410f87f9f0169e075d505ed9939d` (superseded by the ca6306f2d report).
[Per-round evidence](node-ffi-benchmark-darwin-arm64-8364a3996-intermediate.json)

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
| arity-0  |   36.25 / 6.85 / 29.12 |  11.08 / 2.23 / 8.86 |  10.83 / 2.18 / 8.67 |   131.09 / 77.97 / 54.68 |   132.67 / 77.39 / 51.01 |
| arity-1  |   20.90 / 2.45 / 18.22 |  11.59 / 2.22 / 9.36 |  11.56 / 2.16 / 9.15 |   141.08 / 83.89 / 56.16 |   146.59 / 86.40 / 57.64 |
| arity-2  |   29.12 / 2.44 / 26.80 | 12.40 / 2.18 / 10.16 |  11.97 / 2.17 / 9.80 |   154.08 / 86.14 / 67.93 |   159.55 / 90.40 / 67.19 |
| arity-4  | 162.09 / 2.38 / 159.81 | 13.28 / 2.16 / 10.85 | 12.53 / 2.17 / 10.37 |  192.76 / 87.92 / 100.49 |  196.50 / 89.71 / 102.01 |
| arity-8  | 137.58 / 2.36 / 135.17 | 16.41 / 2.20 / 14.15 | 15.79 / 2.18 / 13.59 |  239.32 / 95.07 / 141.83 |  244.96 / 95.86 / 151.26 |
| arity-12 | 194.29 / 2.26 / 192.06 | 24.43 / 2.15 / 22.23 | 23.93 / 2.20 / 21.73 |  297.94 / 98.54 / 196.70 |  297.84 / 98.45 / 196.06 |
| arity-24 | 345.42 / 3.38 / 342.55 | 37.58 / 2.22 / 35.26 | 36.66 / 2.18 / 34.48 | 466.14 / 116.19 / 344.84 | 461.19 / 114.05 / 345.24 |
| buffer   |   87.02 / 2.29 / 84.79 | 32.38 / 5.41 / 26.98 | 30.97 / 5.29 / 25.68 | 143.86 / 159.80 / -13.96 | 145.57 / 162.43 / -12.58 |
| callback | 118.09 / 4.09 / 114.67 | 99.95 / 5.96 / 93.79 | 92.70 / 5.73 / 86.79 |  347.72 / 265.86 / 85.70 |  339.15 / 266.20 / 79.77 |

Median zero-argument controls in ns were Node 2.37, Typed literal 1.83, Typed runtime 1.77, Untyped literal 34.91, Untyped runtime 34.49.

## Paired FFI cost versus Node

Cells show the median [Q1, Q3] of Tint's FFI cost minus Node's in the
same round, in ns per call. Negative values favor Tint.

| Case     |              Typed literal |              Typed runtime |           Untyped literal |           Untyped runtime |
| -------- | -------------------------: | -------------------------: | ------------------------: | ------------------------: |
| arity-0  |     -20.80 [-21.62, -6.31] |     -20.74 [-21.76, -6.20] |   +29.46 [+22.96, +40.78] |   +27.14 [+18.67, +35.83] |
| arity-1  |       -8.38 [-9.88, -8.00] |      -9.65 [-10.06, -8.19] |   +40.62 [+37.11, +43.93] |   +40.22 [+38.19, +42.70] |
| arity-2  |    -16.70 [-17.85, -15.03] |    -16.76 [-18.41, -15.86] |   +41.62 [+38.23, +45.55] |   +41.52 [+39.17, +45.83] |
| arity-4  | -149.07 [-160.97, -139.98] | -149.27 [-161.45, -141.02] |   -61.18 [-69.84, -56.38] |   -59.30 [-64.33, -54.83] |
| arity-8  | -120.64 [-125.56, -111.40] | -121.50 [-124.45, -111.76] |    +10.44 [+5.48, +16.63] |   +13.34 [+12.33, +20.75] |
| arity-12 | -169.63 [-180.43, -156.99] | -170.48 [-180.95, -156.94] |     +6.88 [-0.81, +14.70] |     +7.41 [-0.70, +11.47] |
| arity-24 | -306.14 [-317.62, -294.70] | -309.27 [-318.36, -293.31] |      +2.92 [-8.41, +7.84] |    +6.40 [-14.45, +15.98] |
| buffer   |    -60.00 [-65.06, -54.81] |    -59.09 [-64.60, -55.40] | -103.51 [-106.83, -95.61] | -100.10 [-107.16, -93.38] |
| callback |    -20.10 [-23.75, -16.77] |    -24.83 [-28.95, -19.65] |   -26.34 [-36.75, -20.68] |   -28.90 [-38.79, -23.27] |

## Paired total call time versus Node

| Case     |              Typed literal |              Typed runtime |            Untyped literal |            Untyped runtime |
| -------- | -------------------------: | -------------------------: | -------------------------: | -------------------------: |
| arity-0  |     -25.72 [-27.15, -7.69] |     -25.60 [-27.32, -7.96] |  +100.45 [+92.19, +111.99] |  +100.50 [+93.36, +108.28] |
| arity-1  |      -8.86 [-10.27, -8.25] |      -9.30 [-10.71, -7.93] | +120.44 [+118.91, +131.22] | +126.30 [+118.47, +132.65] |
| arity-2  |    -16.60 [-18.39, -15.28] |    -16.93 [-19.35, -15.76] | +122.25 [+120.60, +127.80] | +124.06 [+120.43, +136.85] |
| arity-4  | -148.80 [-161.15, -140.05] | -149.30 [-161.70, -141.10] |    +25.34 [+18.67, +28.67] |    +27.78 [+23.07, +34.41] |
| arity-8  | -120.90 [-125.75, -111.47] | -121.51 [-124.72, -111.81] | +104.29 [+100.17, +105.89] | +107.01 [+102.87, +118.47] |
| arity-12 | -170.12 [-180.77, -156.99] | -170.51 [-181.07, -156.87] |  +101.03 [+98.45, +112.16] |  +103.45 [+99.41, +107.22] |
| arity-24 | -307.80 [-318.71, -295.56] | -310.05 [-319.64, -294.14] | +112.27 [+108.05, +119.52] |  +113.69 [+96.35, +127.82] |
| buffer   |    -57.24 [-61.91, -51.83] |    -56.13 [-61.51, -52.37] |    +56.88 [+52.96, +57.73] |    +58.19 [+54.09, +62.94] |
| callback |    -18.08 [-22.05, -14.94] |    -23.36 [-27.33, -18.04] | +230.51 [+224.83, +241.28] | +230.41 [+221.21, +238.30] |

## Paired overhead over the zero-argument control versus Node

| Case     |              Typed literal |              Typed runtime |            Untyped literal |            Untyped runtime |
| -------- | -------------------------: | -------------------------: | -------------------------: | -------------------------: |
| arity-0  |     -25.23 [-26.37, -7.19] |     -25.02 [-26.44, -7.30] |    +67.67 [+59.13, +79.91] |    +67.54 [+60.45, +76.84] |
| arity-1  |       -8.27 [-9.47, -7.84] |       -8.68 [-9.81, -7.38] |    +89.20 [+85.47, +97.33] |    +89.67 [+85.17, +98.91] |
| arity-2  |    -16.16 [-17.94, -14.59] |    -16.24 [-18.49, -15.35] |    +90.34 [+87.79, +95.11] |   +93.18 [+88.64, +102.66] |
| arity-4  | -148.30 [-160.42, -139.44] | -148.67 [-161.04, -140.44] |      -7.90 [-14.12, -3.30] |      -5.72 [-10.84, +0.90] |
| arity-8  | -120.51 [-125.07, -110.86] | -120.88 [-123.87, -111.29] |    +70.39 [+68.64, +73.87] |    +73.02 [+70.89, +84.96] |
| arity-12 | -169.35 [-180.03, -156.59] | -169.81 [-180.19, -156.52] |    +68.72 [+64.98, +78.83] |    +71.85 [+66.68, +75.73] |
| arity-24 | -306.70 [-317.84, -295.13] | -309.49 [-318.72, -293.73] |    +79.72 [+74.27, +87.13] |    +81.76 [+64.28, +95.71] |
| buffer   |    -56.67 [-61.33, -51.41] |    -55.76 [-60.88, -51.57] |    +23.23 [+20.18, +26.45] |    +27.21 [+20.74, +31.11] |
| callback |    -17.64 [-21.08, -14.51] |    -22.61 [-26.70, -17.49] | +197.02 [+192.28, +208.59] | +195.67 [+189.76, +205.08] |

## FFI cost over the built-in twin

Cells show median built-in twin time / FFI cost over it in ns per call.

| Case     |          Node |  Untyped literal |  Untyped runtime |
| -------- | ------------: | ---------------: | ---------------: |
| arity-0  |  7.43 / 28.31 |    122.15 / 8.20 |    123.73 / 5.49 |
| arity-1  |  2.26 / 18.58 |  156.50 / -11.69 |  156.36 / -13.06 |
| arity-2  |  2.25 / 26.81 |  167.62 / -12.00 |  176.55 / -14.62 |
| arity-4  | 2.30 / 159.87 |  203.03 / -17.36 |  211.90 / -17.40 |
| arity-8  | 2.21 / 135.30 |  291.25 / -49.27 |  283.43 / -42.48 |
| arity-12 | 2.16 / 192.13 |  361.62 / -68.11 |  370.37 / -63.26 |
| arity-24 | 2.17 / 343.35 | 586.15 / -123.39 | 598.97 / -124.38 |
| buffer   |  4.90 / 82.39 |    133.73 / 9.43 |   137.84 / 11.97 |
| callback | 6.15 / 111.70 |    347.64 / 5.25 |    334.70 / 3.52 |

Paired against Node, as median [Q1, Q3] in ns per call:

| Case     |            Untyped literal |            Untyped runtime |
| -------- | -------------------------: | -------------------------: |
| arity-0  |    -20.39 [-23.72, -11.16] |    -20.95 [-24.88, -10.30] |
| arity-1  |    -29.76 [-33.85, -25.79] |    -33.65 [-38.10, -27.17] |
| arity-2  |    -39.25 [-44.79, -37.06] |    -42.87 [-49.55, -38.77] |
| arity-4  | -178.54 [-188.34, -171.03] | -177.52 [-183.61, -169.23] |
| arity-8  | -178.75 [-197.65, -172.77] | -170.50 [-186.51, -165.93] |
| arity-12 | -258.29 [-267.16, -241.99] | -253.19 [-277.45, -241.29] |
| arity-24 | -470.86 [-492.26, -448.55] | -480.07 [-494.58, -442.63] |
| buffer   |    -71.89 [-78.96, -69.26] |    -70.73 [-79.21, -66.64] |
| callback |  -106.44 [-112.66, -94.29] |  -109.91 [-113.32, -95.91] |

## Landing criteria

- Typed literal: FFI cost at or below Node's in 9 of 9 cases; total call time at or below Node's in 9 of 9.
- Typed runtime: FFI cost at or below Node's in 9 of 9 cases; total call time at or below Node's in 9 of 9.
- Untyped literal: FFI cost at or below Node's in 3 of 9 cases (above in arity-0, arity-1, arity-2, arity-8, arity-12, arity-24); FFI cost over the built-in twin at or below Node's in 9 of 9.
- Untyped runtime: FFI cost at or below Node's in 3 of 9 cases (above in arity-0, arity-1, arity-2, arity-8, arity-12, arity-24); FFI cost over the built-in twin at or below Node's in 9 of 9.
