# Integrated Node FFI performance on Darwin arm64

Apple M5 Max, Node 26.13.1, 15 rounds and 100,000 measured
calls per case. Five workloads rotated through all launch positions.
The outer gate held the shared timing and native launch locks.
All 60 native launches reached LLDB entry and exited 42.
The runner verified 750 case and control checksums.
CPU idle was 0.00% to 39.06% (median 8.97%).
One-minute load was 19.94 to 34.83 (median 23.36).
Tint images were prepared at `ea5d7e9d1a0f7bd8c1ca57c187916841d52501be` after integrating main `8a0f59ff0`.
[Per-round evidence](node-ffi-benchmark-darwin-arm64-ea5d7e9d1-integrated.json)

## Call time and control-subtracted FFI overhead

Cells show median call time / median overhead in ns per call. Each
overhead subtracts the same workload's control from that round. Negative
overhead occurs when the measured call case takes less time than its control.

Median controls in ns were Node 5.22, Typed literal 3.02, Typed runtime 2.80, Untyped literal 66.39, Untyped runtime 65.08.

| Case     |            Node |   Typed literal |   Typed runtime |   Untyped literal |   Untyped runtime |
| -------- | --------------: | --------------: | --------------: | ----------------: | ----------------: |
| arity-0  |   33.65 / 26.99 |   22.21 / 19.51 |   22.82 / 20.03 |   348.70 / 285.18 |   339.59 / 278.76 |
| arity-1  |   56.95 / 51.42 |   23.23 / 19.86 |   23.23 / 19.87 |   415.35 / 352.84 |   387.76 / 322.76 |
| arity-2  |   61.75 / 56.60 |   24.15 / 21.30 |   24.68 / 21.07 |   479.37 / 412.35 |   452.06 / 385.72 |
| arity-4  | 318.36 / 313.28 |   27.86 / 24.49 |   26.38 / 23.58 |   575.01 / 506.03 |   569.00 / 509.66 |
| arity-8  | 254.68 / 242.59 |   31.06 / 28.10 |   34.25 / 30.81 |  1013.44 / 940.40 |   816.04 / 751.04 |
| arity-12 | 368.92 / 363.85 |   39.25 / 36.55 |   43.24 / 38.52 |   957.27 / 890.75 | 1063.62 / 1004.28 |
| arity-24 | 666.99 / 655.25 |   67.52 / 64.82 |   73.09 / 65.16 | 1730.88 / 1669.97 | 1874.15 / 1809.07 |
| buffer   | 147.72 / 142.64 |   65.72 / 62.35 |   71.43 / 67.57 |   606.61 / 540.21 |   444.08 / 384.73 |
| callback | 211.34 / 205.02 | 163.02 / 160.01 | 169.18 / 166.16 |   927.87 / 861.70 |   841.60 / 775.74 |

## Paired total call time versus Node

Cells show the median [Q1, Q3] of Tint minus Node in ns per call.
Negative values favor Tint.

| Case     |              Typed literal |              Typed runtime |              Untyped literal |               Untyped runtime |
| -------- | -------------------------: | -------------------------: | ---------------------------: | ----------------------------: |
| arity-0  |     -11.31 [-35.31, -0.95] |      -9.52 [-32.99, +3.64] |   +323.56 [+298.11, +484.28] |    +310.58 [+292.36, +408.62] |
| arity-1  |    -34.38 [-53.65, -14.91] |    -31.29 [-52.72, -15.53] |   +381.09 [+325.53, +547.28] |    +350.69 [+332.72, +618.22] |
| arity-2  |    -37.49 [-51.07, -27.45] |    -32.22 [-45.70, -20.45] |   +415.40 [+361.55, +562.41] |    +396.42 [+366.25, +515.97] |
| arity-4  | -292.70 [-345.09, -248.99] | -280.18 [-333.29, -245.04] |   +274.15 [+214.22, +531.30] |    +295.96 [+246.11, +464.27] |
| arity-8  | -219.52 [-242.00, -195.09] | -212.34 [-240.09, -191.74] |   +674.64 [+463.84, +802.82] |    +603.05 [+543.67, +842.36] |
| arity-12 | -316.02 [-383.53, -275.15] | -315.96 [-379.22, -269.96] |  +615.87 [+526.08, +1284.41] |   +687.37 [+637.87, +1015.84] |
| arity-24 | -593.23 [-663.71, -515.10] | -555.52 [-653.48, -507.07] | +1021.19 [+904.95, +1809.92] | +1197.94 [+1019.73, +1864.52] |
| buffer   |    -83.90 [-93.71, -76.01] |    -75.19 [-93.87, -64.36] |   +458.89 [+334.41, +611.83] |    +307.54 [+259.56, +484.16] |
| callback |    -36.56 [-76.45, -25.20] |    -30.44 [-64.90, -18.22] |  +747.23 [+638.48, +1393.18] |    +610.30 [+551.15, +890.96] |

## Paired FFI overhead versus Node

| Case     |              Typed literal |              Typed runtime |             Untyped literal |              Untyped runtime |
| -------- | -------------------------: | -------------------------: | --------------------------: | ---------------------------: |
| arity-0  |      -8.57 [-27.28, +6.43] |      -6.01 [-28.33, +8.15] |  +266.18 [+235.09, +420.35] |   +257.09 [+235.37, +301.49] |
| arity-1  |    -29.50 [-49.34, -11.84] |    -27.79 [-56.18, -11.39] |  +324.67 [+265.63, +485.71] |   +295.38 [+278.00, +512.96] |
| arity-2  |    -35.11 [-45.69, -19.43] |    -29.57 [-45.19, -14.71] |  +345.01 [+299.79, +498.93] |   +341.81 [+313.59, +450.19] |
| arity-4  | -290.33 [-338.30, -246.56] | -275.19 [-336.88, -242.88] |  +208.72 [+161.09, +466.04] |   +240.56 [+189.41, +409.85] |
| arity-8  | -212.27 [-237.61, -189.35] | -209.42 [-234.20, -189.59] |  +616.37 [+408.57, +737.81] |   +548.05 [+488.71, +766.09] |
| arity-12 | -306.62 [-374.88, -269.65] | -306.60 [-370.30, -267.91] | +558.49 [+466.90, +1223.62] |   +629.81 [+582.92, +958.24] |
| arity-24 | -584.51 [-659.90, -512.48] | -546.16 [-648.00, -505.26] | +963.82 [+844.84, +1745.69] | +1136.60 [+970.48, +1798.73] |
| buffer   |    -76.43 [-87.30, -71.95] |    -71.72 [-90.11, -62.55] |  +397.57 [+268.56, +557.50] |   +252.06 [+202.21, +418.38] |
| callback |    -32.46 [-69.13, -23.05] |    -25.88 [-61.56, -15.87] | +685.27 [+581.14, +1332.39] |   +556.81 [+495.74, +827.04] |

## Landing criteria

- Typed literal passed 9 of 9 comparisons.
- Typed runtime passed 9 of 9 comparisons.
- Untyped literal passed 0 of 9 comparisons (slower in arity-0, arity-1, arity-2, arity-4, arity-8, arity-12, arity-24, buffer, callback).
- Untyped runtime passed 0 of 9 comparisons (slower in arity-0, arity-1, arity-2, arity-4, arity-8, arity-12, arity-24, buffer, callback).
