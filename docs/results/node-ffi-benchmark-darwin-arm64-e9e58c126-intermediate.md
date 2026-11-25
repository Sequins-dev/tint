# Intermediate Node FFI performance at e9e58c126 on Darwin arm64

Apple M5 Max, Node 26.13.1, 15 rounds and 100,000 measured
calls per case after 20,000 warmup calls. Five workloads rotated through
all launch positions under the shared timing and native launch locks.
All 60 native launches reached LLDB entry and exited 42.
The runner verified 1,830 case and control checksums.
CPU idle was 40.68% to 87.33% (median 74.95%).
One-minute load was 3.86 to 8.69 (median 5.50).
Tint images were prepared at `e9e58c1265cf59199959c21493d3c5f5c2a699f4` (superseded by the ca6306f2d report).
[Per-round evidence](node-ffi-benchmark-darwin-arm64-e9e58c126-intermediate.json)

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
| arity-0  |   34.12 / 6.29 / 27.38 |   9.47 / 2.22 / 7.10 |   9.30 / 2.10 / 7.20 |   135.86 / 81.46 / 54.32 |   130.25 / 79.55 / 49.80 |
| arity-1  |   20.58 / 2.43 / 18.14 |  10.49 / 2.11 / 8.27 |   9.83 / 2.10 / 7.76 |   149.10 / 84.94 / 63.30 |   141.82 / 86.54 / 59.76 |
| arity-2  |   27.73 / 2.21 / 25.54 |  10.46 / 2.13 / 8.31 |  10.26 / 2.11 / 8.15 |   156.49 / 89.88 / 71.22 |   161.37 / 88.10 / 70.46 |
| arity-4  | 163.51 / 2.34 / 161.27 |  11.45 / 2.15 / 9.27 |  11.15 / 2.11 / 9.05 |  192.46 / 91.94 / 100.52 |  196.25 / 89.78 / 102.21 |
| arity-8  | 132.44 / 2.26 / 130.09 | 14.45 / 2.17 / 12.28 | 14.16 / 2.13 / 12.00 |  253.20 / 98.48 / 152.16 |  253.64 / 98.07 / 153.01 |
| arity-12 | 192.65 / 2.47 / 190.19 | 22.79 / 2.10 / 20.64 | 22.30 / 2.14 / 19.85 | 303.09 / 102.32 / 199.16 | 317.37 / 105.45 / 210.25 |
| arity-24 | 344.59 / 3.41 / 340.79 | 37.56 / 2.15 / 35.18 | 35.35 / 2.12 / 33.20 | 490.68 / 121.57 / 368.79 | 494.54 / 121.96 / 372.58 |
| buffer   |   86.83 / 2.31 / 84.49 | 31.14 / 5.34 / 25.98 | 28.87 / 5.26 / 23.65 | 151.50 / 163.24 / -16.09 | 151.23 / 163.01 / -10.76 |
| callback | 110.52 / 4.02 / 106.83 | 94.08 / 5.81 / 88.27 | 88.11 / 5.73 / 82.29 |  358.54 / 272.60 / 89.67 |  358.29 / 272.21 / 80.97 |

Median zero-argument controls in ns were Node 2.43, Typed literal 1.77, Typed runtime 1.72, Untyped literal 36.99, Untyped runtime 35.65.

## Paired FFI cost versus Node

Cells show the median [Q1, Q3] of Tint's FFI cost minus Node's in the
same round, in ns per call. Negative values favor Tint.

| Case     |              Typed literal |              Typed runtime |          Untyped literal |          Untyped runtime |
| -------- | -------------------------: | -------------------------: | -----------------------: | -----------------------: |
| arity-0  |    -20.54 [-21.42, -17.70] |    -20.37 [-22.82, -17.64] |  +27.16 [+24.65, +32.37] |  +23.05 [+17.25, +34.65] |
| arity-1  |      -9.90 [-11.37, -7.66] |     -10.13 [-11.74, -9.75] |  +37.99 [+37.14, +49.21] |  +39.55 [+36.77, +42.24] |
| arity-2  |    -16.99 [-19.91, -14.65] |    -17.48 [-20.12, -16.61] |  +45.23 [+41.40, +49.52] |  +45.58 [+41.39, +52.77] |
| arity-4  | -146.79 [-162.65, -140.72] | -152.34 [-162.75, -141.44] |  -64.75 [-71.50, -51.99] |  -58.88 [-71.29, -46.68] |
| arity-8  | -117.68 [-123.14, -112.44] | -118.31 [-122.50, -113.80] |  +16.67 [+12.20, +33.39] |   +18.38 [+9.41, +31.53] |
| arity-12 | -169.46 [-182.81, -162.21] | -169.46 [-182.91, -162.80] |    +9.82 [+2.86, +20.37] |   +13.14 [-5.42, +23.07] |
| arity-24 | -303.70 [-328.39, -292.62] | -306.63 [-329.41, -299.20] |   +20.83 [+6.62, +69.74] |   +23.82 [+3.86, +37.37] |
| buffer   |    -59.02 [-62.10, -55.64] |    -61.14 [-64.10, -58.25] | -98.89 [-116.88, -94.67] | -97.84 [-101.77, -89.94] |
| callback |    -18.39 [-22.00, -11.49] |    -24.45 [-28.87, -21.25] |  -16.47 [-23.24, +11.58] |  -25.04 [-41.93, -18.39] |

## Paired total call time versus Node

| Case     |              Typed literal |              Typed runtime |            Untyped literal |            Untyped runtime |
| -------- | -------------------------: | -------------------------: | -------------------------: | -------------------------: |
| arity-0  |    -24.93 [-25.53, -21.39] |    -24.98 [-26.49, -21.72] |  +102.25 [+97.67, +109.49] |  +101.30 [+89.07, +113.72] |
| arity-1  |      -9.94 [-11.59, -7.99] |    -10.36 [-11.95, -10.04] | +129.12 [+118.08, +133.58] | +120.35 [+116.79, +135.72] |
| arity-2  |    -17.08 [-20.36, -14.90] |    -17.58 [-20.47, -16.71] | +128.02 [+124.79, +143.40] | +131.46 [+123.03, +143.75] |
| arity-4  | -147.09 [-162.78, -140.89] | -152.48 [-162.84, -141.67] |    +26.02 [+15.98, +42.84] |    +32.39 [+14.16, +47.89] |
| arity-8  | -117.83 [-123.40, -112.43] | -118.56 [-122.73, -114.24] | +119.55 [+105.14, +131.96] | +108.44 [+100.37, +129.14] |
| arity-12 | -170.00 [-184.16, -162.35] | -169.63 [-184.30, -163.00] |  +107.98 [+99.17, +127.89] |  +110.40 [+98.05, +126.19] |
| arity-24 | -304.83 [-329.77, -293.65] | -307.74 [-330.96, -300.51] | +136.80 [+123.45, +190.58] | +137.49 [+116.91, +158.76] |
| buffer   |    -55.42 [-59.06, -52.84] |    -58.19 [-61.49, -55.27] |    +64.75 [+59.78, +74.59] |    +60.52 [+56.40, +73.98] |
| callback |     -16.27 [-20.14, -9.32] |    -22.85 [-27.17, -19.83] | +246.27 [+239.41, +291.63] | +244.84 [+221.98, +256.41] |

## Paired overhead over the zero-argument control versus Node

| Case     |              Typed literal |              Typed runtime |            Untyped literal |            Untyped runtime |
| -------- | -------------------------: | -------------------------: | -------------------------: | -------------------------: |
| arity-0  |    -23.92 [-24.91, -20.76] |    -24.12 [-25.76, -20.95] |    +67.93 [+61.39, +75.00] |    +65.25 [+56.80, +79.07] |
| arity-1  |      -9.46 [-10.67, -7.54] |      -9.91 [-10.55, -9.24] |    +91.28 [+85.25, +97.10] |   +87.59 [+84.28, +100.41] |
| arity-2  |    -16.65 [-19.53, -14.99] |    -16.76 [-20.14, -15.92] |   +94.08 [+90.72, +106.11] |   +96.27 [+87.50, +109.08] |
| arity-4  | -145.87 [-161.16, -140.86] | -151.97 [-161.60, -141.26] |      -8.20 [-20.68, +7.48] |     -3.09 [-19.20, +15.00] |
| arity-8  | -115.93 [-122.64, -112.10] | -117.48 [-122.46, -113.50] |    +84.23 [+71.33, +96.39] |    +71.13 [+68.91, +94.51] |
| arity-12 | -169.42 [-183.43, -161.28] | -169.50 [-183.57, -162.26] |    +75.56 [+68.24, +93.35] |    +76.02 [+62.86, +92.19] |
| arity-24 | -303.61 [-329.13, -293.55] | -306.49 [-330.07, -299.11] |  +101.53 [+90.94, +155.31] |  +105.16 [+81.75, +121.12] |
| buffer   |    -53.39 [-58.30, -52.01] |    -57.40 [-61.30, -54.28] |    +30.89 [+22.25, +36.39] |    +27.95 [+21.63, +39.86] |
| callback |     -15.40 [-19.31, -8.84] |    -20.95 [-26.65, -19.03] | +212.33 [+207.79, +256.30] | +209.66 [+190.09, +221.31] |

## FFI cost over the built-in twin

Cells show median built-in twin time / FFI cost over it in ns per call.

| Case     |          Node |  Untyped literal |  Untyped runtime |
| -------- | ------------: | ---------------: | ---------------: |
| arity-0  |  7.25 / 26.84 |    131.27 / 8.46 |    124.06 / 6.36 |
| arity-1  |  2.19 / 18.02 |  158.01 / -11.11 |  163.70 / -12.73 |
| arity-2  |  2.23 / 25.60 |  179.28 / -11.92 |  173.19 / -12.81 |
| arity-4  | 2.13 / 161.48 |  212.66 / -18.49 |  206.46 / -19.47 |
| arity-8  | 2.17 / 130.27 |  290.63 / -44.20 |  313.02 / -50.72 |
| arity-12 | 2.22 / 190.32 |  369.02 / -65.79 |  377.84 / -72.12 |
| arity-24 | 2.14 / 342.42 | 610.09 / -128.03 | 618.34 / -123.81 |
| buffer   |  4.88 / 81.33 |   139.39 / 13.70 |   138.43 / 13.01 |
| callback | 5.93 / 104.76 |   348.53 / 10.50 |    352.94 / 3.43 |

Paired against Node, as median [Q1, Q3] in ns per call:

| Case     |            Untyped literal |            Untyped runtime |
| -------- | -------------------------: | -------------------------: |
| arity-0  |    -18.04 [-22.39, -12.94] |    -20.80 [-27.46, -10.11] |
| arity-1  |    -30.66 [-35.72, -27.04] |    -30.48 [-39.51, -26.14] |
| arity-2  |    -37.96 [-39.85, -34.66] |    -39.36 [-46.62, -37.36] |
| arity-4  | -177.90 [-196.39, -168.08] | -178.23 [-191.53, -171.21] |
| arity-8  | -175.33 [-179.92, -169.77] | -185.66 [-212.15, -173.36] |
| arity-12 | -257.74 [-266.47, -247.30] | -262.43 [-284.20, -251.49] |
| arity-24 | -470.77 [-488.15, -455.28] | -479.16 [-488.30, -454.08] |
| buffer   |    -69.69 [-81.14, -65.98] |    -70.31 [-74.00, -65.10] |
| callback |    -92.13 [-99.44, -65.97] |   -99.84 [-112.35, -95.00] |

## Landing criteria

- Typed literal: FFI cost at or below Node's in 9 of 9 cases; total call time at or below Node's in 9 of 9.
- Typed runtime: FFI cost at or below Node's in 9 of 9 cases; total call time at or below Node's in 9 of 9.
- Untyped literal: FFI cost at or below Node's in 3 of 9 cases (above in arity-0, arity-1, arity-2, arity-8, arity-12, arity-24); FFI cost over the built-in twin at or below Node's in 9 of 9.
- Untyped runtime: FFI cost at or below Node's in 3 of 9 cases (above in arity-0, arity-1, arity-2, arity-8, arity-12, arity-24); FFI cost over the built-in twin at or below Node's in 9 of 9.
