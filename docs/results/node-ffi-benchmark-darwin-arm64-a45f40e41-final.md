# Final Node FFI performance on Darwin arm64

Apple M5 Max, Node 26.13.1, 15 rounds and 100,000 measured
calls per case after 20,000 warmup calls. Five workloads rotated through
all launch positions under the shared timing and native launch locks.
All 60 native launches reached LLDB entry and exited 42.
The runner verified 1,830 case and control checksums.
CPU idle was 86.78% to 95.09% (median 93.30%).
One-minute load was 1.62 to 2.78 (median 2.05).
Tint images were prepared at `a45f40e41a77b72d7e7a839dccbd36d87545e618` (main `3d10cb5c0` merged).
[Per-round evidence](node-ffi-benchmark-darwin-arm64-a45f40e41-final.json)

## Findings

- **Typed paths** cost less than Node in 8 of 9 cases, by FFI cost and by
  total call time. Zero arguments is the exception: the typed call took
  11.38 ns against Node's 10.08 ns, +1.35 ns [+1.15, +1.53] paired. The
  earlier integrated report ran under one-minute load near 23 and showed
  Node at 33.65 ns for this case. This run's load was near 2, and Node's
  times roughly halved. The typed zero-argument entry obtains the callee's
  view, calls its `typedRecord` closure and views the record before the
  static C call. Removing that dispatch needs a per-site cache in the
  compiler.
- **General callers against the JavaScript twin.** The untyped images cost
  less than Node for Buffer and four arguments. They cost more elsewhere:
  +61 to +64 ns at zero to two arguments, +27 to +39 ns at 8 to 24 (literal
  definitions), and +14 to +17 ns for the callback.
- **General callers against the built-in twin.** Untyped code pays the same
  call protocol for an FFI wrapper as for any built-in function. A
  zero-argument `Number()` costs 119 ns and an eight-argument `Math.max`
  costs 272 ns. Over that twin, the literal image's FFI cost is at or below
  Node's in 8 of 9 cases. Zero arguments is the exception, at +15.92 ns.
  The runtime-definition image is at or below Node's in 6 of 9; the
  exceptions are zero to two arguments, at +31.04, +8.17 and +2.30 ns.
  Untyped call time over Node's is the general runtime's call cost, which
  [PR #12](https://github.com/Sequins-dev/tint/pull/12) owns.

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
| arity-0  |    10.08 / 3.24 / 6.86 |  11.38 / 2.10 / 9.28 |  11.38 / 2.09 / 9.30 |   142.31 / 73.04 / 69.53 |   158.54 / 73.26 / 85.62 |
| arity-1  |   15.87 / 2.15 / 13.75 |  11.70 / 2.12 / 9.58 |  11.71 / 2.11 / 9.63 |   156.34 / 80.62 / 75.10 |   170.51 / 80.15 / 90.48 |
| arity-2  |   26.77 / 2.11 / 24.70 | 12.16 / 2.09 / 10.06 | 12.17 / 2.09 / 10.05 |   171.46 / 81.96 / 88.72 |  186.63 / 82.04 / 104.11 |
| arity-4  | 149.32 / 2.10 / 147.21 | 13.12 / 2.09 / 11.04 | 13.10 / 2.09 / 11.02 |  198.15 / 84.28 / 113.71 |  214.61 / 84.45 / 129.26 |
| arity-8  | 124.67 / 2.14 / 122.53 | 15.87 / 2.10 / 13.75 | 15.92 / 2.10 / 13.81 |  250.34 / 88.73 / 161.20 |  272.81 / 88.99 / 184.11 |
| arity-12 | 179.01 / 2.12 / 176.93 | 22.95 / 2.09 / 20.90 | 22.98 / 2.09 / 20.90 |  303.46 / 95.66 / 207.92 |  327.51 / 95.87 / 231.64 |
| arity-24 | 322.88 / 2.98 / 319.92 | 35.70 / 2.10 / 33.59 | 35.66 / 2.10 / 33.53 | 459.09 / 110.15 / 349.21 | 499.77 / 110.47 / 389.23 |
| buffer   |   82.64 / 2.07 / 80.57 | 34.21 / 5.11 / 29.08 | 33.70 / 5.13 / 28.54 |   158.07 / 149.94 / 7.64 |   157.01 / 149.75 / 6.87 |
| callback | 107.84 / 3.94 / 103.88 | 89.71 / 5.82 / 83.85 | 90.29 / 5.57 / 84.75 | 371.45 / 249.36 / 122.00 | 367.32 / 249.23 / 118.55 |

Median zero-argument controls in ns were Node 2.11, Typed literal 1.71, Typed runtime 1.73, Untyped literal 33.00, Untyped runtime 32.94.

## Paired FFI cost versus Node

Cells show the median [Q1, Q3] of Tint's FFI cost minus Node's in the
same round, in ns per call. Negative values favor Tint.

| Case     |              Typed literal |              Typed runtime |         Untyped literal |         Untyped runtime |
| -------- | -------------------------: | -------------------------: | ----------------------: | ----------------------: |
| arity-0  |       +2.37 [+2.25, +2.66] |       +2.49 [+2.27, +2.82] | +61.76 [+59.02, +63.09] | +77.98 [+76.43, +78.97] |
| arity-1  |       -4.21 [-4.84, -3.91] |       -4.16 [-4.82, -3.66] | +60.98 [+60.27, +62.47] | +76.23 [+75.55, +77.09] |
| arity-2  |    -14.68 [-15.17, -14.34] |    -14.53 [-15.14, -14.22] | +64.23 [+63.24, +65.75] | +79.39 [+78.61, +81.56] |
| arity-4  | -136.40 [-138.52, -134.78] | -136.26 [-138.36, -134.94] | -32.74 [-35.30, -31.67] | -18.40 [-19.72, -16.27] |
| arity-8  | -108.73 [-109.44, -108.14] | -108.69 [-109.26, -108.23] | +38.89 [+37.65, +39.96] | +60.81 [+60.23, +62.10] |
| arity-12 | -156.09 [-156.71, -154.95] | -155.87 [-156.90, -154.98] | +30.85 [+28.86, +32.47] | +55.49 [+52.13, +57.26] |
| arity-24 | -287.07 [-287.91, -286.05] | -286.83 [-287.59, -285.69] | +27.42 [+22.61, +30.45] | +68.14 [+63.09, +71.15] |
| buffer   |    -51.01 [-53.51, -50.20] |    -51.91 [-53.20, -50.46] | -72.51 [-74.81, -70.35] | -73.78 [-74.99, -72.25] |
| callback |    -20.51 [-33.12, -17.96] |    -21.16 [-28.10, -17.86] |  +16.75 [+8.55, +20.18] |  +13.90 [+3.10, +15.35] |

## Paired total call time versus Node

| Case     |              Typed literal |              Typed runtime |            Untyped literal |            Untyped runtime |
| -------- | -------------------------: | -------------------------: | -------------------------: | -------------------------: |
| arity-0  |       +1.35 [+1.15, +1.53] |       +1.36 [+1.17, +1.73] | +131.54 [+130.42, +133.28] | +148.27 [+147.13, +148.81] |
| arity-1  |       -4.31 [-4.88, -3.89] |       -4.31 [-4.88, -3.59] | +140.48 [+139.57, +140.73] | +154.43 [+152.61, +155.41] |
| arity-2  |    -14.64 [-15.17, -14.42] |    -14.56 [-15.07, -14.23] | +144.70 [+143.15, +145.32] | +159.95 [+158.88, +162.86] |
| arity-4  | -136.41 [-138.51, -134.76] | -136.31 [-138.30, -134.93] |    +49.29 [+46.85, +49.77] |    +65.13 [+62.05, +66.40] |
| arity-8  | -108.65 [-109.51, -108.20] | -108.68 [-109.26, -108.12] | +125.43 [+124.21, +127.81] | +148.10 [+147.31, +148.58] |
| arity-12 | -156.10 [-156.78, -154.95] | -155.96 [-156.82, -154.99] | +125.14 [+123.04, +125.72] | +149.28 [+146.39, +151.36] |
| arity-24 | -287.83 [-289.00, -286.96] | -287.78 [-288.47, -286.68] | +134.53 [+130.38, +137.55] | +175.27 [+170.76, +179.34] |
| buffer   |    -47.98 [-50.48, -47.21] |    -48.81 [-50.07, -47.34] |    +76.00 [+73.87, +77.08] |    +74.37 [+72.99, +75.12] |
| callback |    -18.11 [-30.60, -16.14] |    -19.56 [-26.24, -16.20] | +261.74 [+253.73, +265.41] | +258.78 [+247.19, +260.67] |

## Paired overhead over the zero-argument control versus Node

| Case     |              Typed literal |              Typed runtime |            Untyped literal |            Untyped runtime |
| -------- | -------------------------: | -------------------------: | -------------------------: | -------------------------: |
| arity-0  |       +1.76 [+1.54, +1.90] |       +1.73 [+1.56, +2.14] |  +101.21 [+98.80, +102.56] | +117.29 [+116.46, +118.08] |
| arity-1  |       -3.92 [-4.51, -3.51] |       -3.84 [-4.51, -3.23] | +109.29 [+108.53, +110.12] | +123.17 [+121.31, +124.82] |
| arity-2  |    -14.25 [-14.82, -14.05] |    -14.19 [-14.71, -13.85] | +113.30 [+112.28, +114.48] | +129.34 [+128.05, +131.55] |
| arity-4  | -136.01 [-138.14, -134.37] | -135.96 [-137.93, -134.57] |    +18.30 [+15.52, +18.97] |    +33.99 [+31.59, +35.92] |
| arity-8  | -108.26 [-109.14, -107.85] | -108.31 [-108.87, -107.73] |    +94.49 [+93.38, +96.81] | +117.15 [+116.14, +118.02] |
| arity-12 | -155.69 [-156.37, -154.53] | -155.55 [-156.43, -154.64] |    +94.04 [+91.99, +94.97] | +118.46 [+115.32, +120.24] |
| arity-24 | -287.48 [-288.56, -286.58] | -287.44 [-288.09, -286.29] |  +104.31 [+99.61, +106.46] | +144.95 [+139.49, +148.50] |
| buffer   |    -47.57 [-50.04, -46.83] |    -48.45 [-49.70, -46.97] |    +45.04 [+42.59, +46.64] |    +43.22 [+42.08, +44.45] |
| callback |    -17.77 [-30.17, -15.77] |    -19.18 [-25.83, -15.78] | +230.53 [+222.22, +234.68] | +228.28 [+216.45, +229.88] |

## FFI cost over the built-in twin

Cells show median built-in twin time / FFI cost over it in ns per call.

| Case     |          Node | Untyped literal | Untyped runtime |
| -------- | ------------: | --------------: | --------------: |
| arity-0  |   2.96 / 7.12 |  119.26 / 23.55 |  118.77 / 39.47 |
| arity-1  |  2.09 / 13.74 |   148.07 / 8.42 |  147.72 / 22.50 |
| arity-2  |  2.09 / 24.72 |  159.17 / 12.18 |  158.96 / 27.39 |
| arity-4  | 2.03 / 147.31 |   196.62 / 2.06 |  196.25 / 18.01 |
| arity-8  | 2.03 / 122.61 | 271.91 / -21.75 |   272.47 / 0.49 |
| arity-12 | 2.02 / 177.01 | 343.19 / -38.77 | 341.45 / -13.16 |
| arity-24 | 2.03 / 320.79 | 552.91 / -94.88 | 552.32 / -52.98 |
| buffer   |  4.25 / 78.39 |  130.56 / 27.19 |  130.93 / 26.54 |
| callback | 5.65 / 102.19 |  324.09 / 47.07 |  321.46 / 46.23 |

Paired against Node, as median [Q1, Q3] in ns per call:

| Case     |            Untyped literal |            Untyped runtime |
| -------- | -------------------------: | -------------------------: |
| arity-0  |    +15.92 [+14.23, +16.94] |    +31.04 [+29.96, +33.01] |
| arity-1  |       -5.95 [-7.51, -5.15] |       +8.17 [+6.36, +9.25] |
| arity-2  |    -12.50 [-13.96, -11.45] |       +2.30 [+1.05, +4.06] |
| arity-4  | -145.48 [-146.90, -144.79] | -129.49 [-131.87, -128.11] |
| arity-8  | -144.61 [-145.46, -142.26] | -121.76 [-123.58, -120.52] |
| arity-12 | -215.70 [-217.50, -214.67] | -190.64 [-192.43, -189.10] |
| arity-24 | -417.32 [-419.35, -412.77] | -374.08 [-384.10, -370.05] |
| buffer   |    -51.38 [-53.46, -48.80] |    -52.57 [-52.95, -50.70] |
| callback |    -57.17 [-65.03, -53.23] |    -58.54 [-66.70, -55.72] |

## Landing criteria

- Typed literal: FFI cost at or below Node's in 8 of 9 cases (above in arity-0); total call time at or below Node's in 8 of 9 (above in arity-0).
- Typed runtime: FFI cost at or below Node's in 8 of 9 cases (above in arity-0); total call time at or below Node's in 8 of 9 (above in arity-0).
- Untyped literal: FFI cost at or below Node's in 2 of 9 cases (above in arity-0, arity-1, arity-2, arity-8, arity-12, arity-24, callback); FFI cost over the built-in twin at or below Node's in 8 of 9 (above in arity-0).
- Untyped runtime: FFI cost at or below Node's in 2 of 9 cases (above in arity-0, arity-1, arity-2, arity-8, arity-12, arity-24, callback); FFI cost over the built-in twin at or below Node's in 6 of 9 (above in arity-0, arity-1, arity-2).
