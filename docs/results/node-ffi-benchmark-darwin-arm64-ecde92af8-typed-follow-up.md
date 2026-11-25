# Scalar and typed Node FFI follow-up on Darwin arm64

The runs used Node 26.13.1 and Apple M5 Max. A shared timing lock
covered each complete set of rotated rounds. Native execution used the
shared launch lock and LLDB. All 228 native launches reached entry and
exited 42. The runner verified 2,890 case and control checksums.

Each overhead is the case time minus that workload's own JavaScript-only
control in the same round. Differences also pair within each round.
Values are nanoseconds per call and show median `[Q1, Q3]`. All rounds
contribute to the quartiles. The raw artifact includes the controls,
Node and Tint case samples, start order, the image manifests, idle and
one-, five- and fifteen-minute load.
[Per-round data](node-ffi-benchmark-darwin-arm64-ecde92af8-typed-follow-up.json)

| Comparison                                      | Rounds | Native exits 42 | CPU idle min / median / max | One-minute load min / median / max |
| ----------------------------------------------- | -----: | --------------: | --------------------------: | ---------------------------------: |
| Restored and guarded scalar adapters            |     15 |              60 |     2.16% / 67.39% / 76.84% |                5.00 / 7.71 / 17.89 |
| Original, guarded and restored runtime adapters |     16 |              48 |     0.00% / 20.23% / 61.88% |              14.07 / 18.25 / 47.12 |
| Typed direct i32                                |     15 |              60 |     0.56% / 39.77% / 65.19% |              10.76 / 16.95 / 29.36 |
| Unary pointer and callback candidate            |     15 |              60 |    33.91% / 56.22% / 84.06% |                4.60 / 8.50 / 11.09 |

## Generic scalar adapter

The guarded implementation extracted the per-parameter work from the
scalar loop and added a second validator call in the generic Number
path. Restoring the inline marshaler reduced runtime arity-24 overhead
by 136.32 ns [104.23, 267.57] in the 15-round comparison. Literal arity 24
improved by 102.09 ns [60.12, 200.64]. The three-way run below rechecked
the original adapter in the same rounds. All nine restored runtime
medians were below the original. Their IQRs crossed zero under the
recorded load. The generic entry uses the inline loop, and the typed
positional path uses its separate argument writer.

| Case     |    Guarded minus original |    Restored minus original |
| -------- | ------------------------: | -------------------------: |
| arity-0  |   -24.51 [-66.66, +28.10] |    -4.21 [-113.03, +43.85] |
| arity-1  |    +8.80 [-84.73, +45.29] |   -17.34 [-131.84, +52.78] |
| arity-2  |   +18.18 [-29.27, +61.34] |   -39.29 [-116.99, +38.53] |
| arity-4  |   +47.83 [-42.73, +81.66] |    -84.43 [-184.06, +4.30] |
| arity-8  |   +81.71 [-7.14, +137.33] |  -115.62 [-257.45, +26.60] |
| arity-12 |   +60.28 [+5.39, +143.09] |   -93.07 [-231.53, +77.39] |
| arity-24 | +172.15 [+60.29, +248.12] | -111.67 [-350.76, +114.84] |
| buffer   |    +6.06 [-48.50, +31.89] |    -11.78 [-42.66, +25.27] |
| callback |   +23.69 [-55.80, +93.19] |   -32.11 [-151.33, +13.99] |

## Typed i32 plans

A runtime definition whose validated signature is i32 throughout can
select a generated typed C prototype. The plan lookup occurs at binding.
Other runtime shapes retain the classified frame. The i32 entry checks
its exact signed integer range before calling C. Out-of-range values
reach the existing converter for the same coded error and argument index.

The direct i32 candidate lowered runtime arity-24 overhead by 715.30 ns
[613.35, 801.29] against the guarded adapter. The direct candidate has
nine of 18 case and signature combinations at or below Node in both
measures, using the paired medians. The emitter's saved stack frame and
per-call binding projection remain costs at low arities.

| Case     | Literal FFI overhead minus Node | Runtime FFI overhead minus Node |
| -------- | ------------------------------: | ------------------------------: |
| arity-0  |          +19.00 [+3.91, +26.52] |          +19.32 [+3.45, +22.14] |
| arity-1  |          +13.10 [+7.48, +15.07] |           +8.01 [+7.20, +10.50] |
| arity-2  |            -0.98 [-3.21, +0.85] |            +0.23 [-8.95, +1.14] |
| arity-4  |      -208.17 [-233.16, -194.94] |      -212.16 [-233.93, -202.02] |
| arity-8  |      -158.97 [-174.07, -150.07] |      -162.22 [-179.70, -153.73] |
| arity-12 |      -241.84 [-261.16, -219.02] |      -258.95 [-266.46, -237.67] |
| arity-24 |      -474.78 [-527.64, -451.15] |      -483.35 [-523.27, -462.79] |
| buffer   |         +42.75 [+31.23, +64.96] |         +39.31 [+32.17, +43.33] |
| callback |      +159.08 [+109.24, +174.84] |      +124.02 [+111.57, +133.75] |

| Case     | Literal total time minus Node | Runtime total time minus Node |
| -------- | ----------------------------: | ----------------------------: |
| arity-0  |        +16.98 [+2.43, +25.84] |        +17.01 [+1.81, +20.54] |
| arity-1  |        +11.68 [+5.75, +13.99] |          +6.48 [+5.70, +9.03] |
| arity-2  |          -1.75 [-5.03, -0.56] |         -2.08 [-10.46, -0.50] |
| arity-4  |    -209.55 [-235.02, -195.91] |    -213.55 [-235.49, -203.95] |
| arity-8  |    -160.46 [-175.81, -151.30] |    -163.61 [-181.26, -155.63] |
| arity-12 |    -243.46 [-262.92, -220.11] |    -260.37 [-268.02, -239.14] |
| arity-24 |    -476.40 [-529.21, -451.77] |    -485.21 [-524.72, -464.31] |
| buffer   |       +40.72 [+29.04, +63.81] |       +37.01 [+30.34, +41.82] |
| callback |    +157.71 [+107.58, +173.99] |    +122.38 [+109.52, +132.23] |

## Pointer lending and callback candidate

The unary pointer entry combines the positional write, stable backing
loan and frame dispatch. It reduced Buffer overhead by 9.94 ns
[3.64, 15.98] for typed literal definitions and 15.62 ns [7.87, 27.09]
for typed runtime definitions. The same experiment included a callback
candidate that caches the last registration and retargets only the
needed cell on the typed unary path. Its callback median improvements
were 12.52 and 7.36 ns, respectively, with IQRs crossing zero.

## Focused validation

The typed binding fixture agreed with Node 26.13.1 and reached LLDB
exit 42. It exercised an indirect callable, signed i32 validation,
closed-library ordering, string conversion and a Buffer slice with a
nonzero offset. The compiler's native subset, gate-lock checks and
benchmark harness tests passed. The pinned suite and final budget checks
are tracked separately for the source revision selected by the follow-up.
