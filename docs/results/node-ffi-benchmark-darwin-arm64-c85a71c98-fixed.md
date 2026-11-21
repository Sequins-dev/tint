# Guarded Node FFI call overhead on Darwin arm64

The benchmark compared Node 26.13.1 with untyped and typed Tint, using
both literal and runtime `node:ffi` definitions. All variants used the
same C library, iteration count, warmup count, and case checksums. The
runner required typed compilation for both typed variants. The previous
FFI revision and a numeric-only candidate ran in the same rounds as the
final fixed-arity candidate.

The runner held the shared timing lock for 22 rounds and rotated start
order across all eleven workloads. Each case used 100,000 calls after
20,000 warmup calls. An observation is the case time minus that workload's
own JavaScript-only control in the same round. To compare two workloads,
subtract those observations within each round, then take the median and
quartiles of the differences. All timings below are nanoseconds per call
with interquartile range `[Q1, Q3]`. All 2,420 case and control checksums
matched, and all 220 native launches reached entry and exited 42 under
LLDB. [Per-round timings and host telemetry](node-ffi-benchmark-darwin-arm64-c85a71c98-fixed.json)

The pre-change arity-zero probe measured a 42.44 ns paired gap to Node
with the C call and all FFI validation stubbed out. That kept the
argument list, realm dispatch and generic-result path in the measurement.
[Pre-change boundary probe](node-ffi-benchmark-darwin-arm64-1a6f003e6-boundary.md)

## Compiler and runtime paths

The numeric literal entry checks the bound function's private witness
and live library, validates numeric inputs and calls the C symbol with
its native signature. The fixed-arity runtime entry reuses the ABI plan
classified during binding. For mixed arguments it uses positional frame
writes and lends Buffer backing under the existing lifetime rules.
Guard misses use the original general call with the callee, receiver
and arguments already evaluated. Wider and void results still use the
existing adapter.

A strong callback with an eligible typed unary Number signature resolves
the callable view at registration or ref. The trampoline reads the
argument directly from the saved register capture and returns a checked
Number. Other callback shapes keep the existing dispatch. LLDB hit the
literal C symbol immediately under `tryFixedFfi0` and the runtime C
symbol via the classified ABI frame under `tryFixedFfi0`. It also hit
the typed unary branch in `ffi-callbacks.ts` during the callback case.

## Overhead over each workload's control

CPU idle ranged from 0.00% to 60.63%, with a median of 41.80%.
One-minute load ranged from 9.44 to 30.39, with a median of 15.65.
The runner included every round. The telemetry covers launches,
including time waiting for native admission. Median controls were
4.36 ns for Node, 361.08 and 352.54 ns for untyped
Tint literal and runtime, and 2.52 and 2.55 ns for typed
Tint literal and runtime.

| Case     |                    Node |            Untyped literal |            Untyped runtime |           Typed literal |           Typed runtime |
| -------- | ----------------------: | -------------------------: | -------------------------: | ----------------------: | ----------------------: |
| arity-0  |    15.61 [11.71, 43.55] |    168.92 [143.83, 198.52] |    177.23 [160.62, 231.40] |    32.70 [30.03, 36.04] |    70.79 [63.79, 75.55] |
| arity-1  |    26.43 [23.75, 29.59] |    245.11 [221.38, 272.78] |    274.45 [256.20, 325.92] |    48.71 [44.25, 51.68] |  101.19 [94.12, 105.50] |
| arity-2  |    35.36 [32.18, 40.69] |    314.94 [288.43, 365.65] |    368.93 [342.65, 425.86] |    60.45 [57.49, 65.03] | 124.06 [115.51, 131.02] |
| arity-4  | 238.50 [220.32, 251.94] |    392.07 [366.46, 443.10] |    486.21 [444.43, 592.58] |    83.76 [78.97, 93.44] | 177.91 [169.70, 187.28] |
| arity-8  | 198.83 [183.51, 209.68] |    597.18 [530.21, 640.18] |    753.35 [679.98, 845.95] | 131.65 [125.31, 142.29] | 286.47 [261.32, 298.77] |
| arity-12 | 286.92 [269.90, 306.48] |    772.81 [674.03, 823.12] |  1007.91 [933.45, 1086.68] | 182.24 [175.43, 198.18] | 395.16 [369.66, 410.44] |
| arity-24 | 542.45 [493.31, 570.24] | 1315.52 [1174.10, 1411.09] | 1755.91 [1650.26, 1855.00] | 340.39 [323.43, 364.89] | 728.40 [670.46, 750.16] |
| buffer   | 119.62 [107.87, 128.96] |    331.82 [292.75, 383.00] |    323.43 [297.91, 354.41] | 149.96 [138.83, 163.08] | 154.78 [146.58, 164.88] |
| callback | 158.48 [142.34, 174.76] |    787.17 [701.73, 866.16] |    743.08 [706.32, 810.42] | 275.17 [257.72, 295.39] | 290.45 [266.01, 302.76] |

## Paired differences from Node

Negative medians favor Tint. Typed literal arities 4, 8, 12 and 24
and typed runtime arity 4 reached parity. The same five cases reached
parity on total call time. Both untyped variants were slower than Node
in every case under both measures. The general call and loop stream was
open when this run finished.
[General call and loop PR](https://github.com/Sequins-dev/tint/pull/7)

| Case     |            Untyped literal |               Untyped runtime |              Typed literal |              Typed runtime |
| -------- | -------------------------: | ----------------------------: | -------------------------: | -------------------------: |
| arity-0  | +145.51 [+121.41, +179.29] |    +164.52 [+146.73, +195.47] |     +14.82 [-9.23, +20.55] |    +51.24 [+25.96, +61.26] |
| arity-1  | +216.11 [+198.68, +244.23] |    +247.29 [+230.71, +295.90] |    +22.20 [+18.72, +24.23] |    +72.51 [+67.46, +78.99] |
| arity-2  | +257.81 [+252.50, +309.28] |    +315.89 [+293.36, +368.69] |    +24.36 [+21.00, +27.63] |    +85.09 [+78.68, +92.78] |
| arity-4  | +153.66 [+143.09, +194.86] |    +269.51 [+212.07, +320.89] | -150.82 [-165.47, -143.27] |    -60.96 [-69.34, -51.94] |
| arity-8  | +398.60 [+345.76, +441.64] |    +569.14 [+486.40, +637.03] |    -65.49 [-71.21, -54.08] |    +83.68 [+75.84, +99.56] |
| arity-12 | +488.46 [+423.07, +528.96] |    +721.88 [+641.92, +787.56] |  -100.91 [-113.38, -88.36] |  +111.28 [+89.74, +117.17] |
| arity-24 | +753.89 [+670.62, +843.82] | +1229.60 [+1095.11, +1287.01] | -201.19 [-210.66, -172.86] | +183.57 [+156.97, +208.38] |
| buffer   | +216.35 [+186.83, +266.58] |    +203.54 [+183.36, +223.44] |    +31.22 [+21.95, +41.76] |    +39.34 [+24.94, +48.50] |
| callback | +611.51 [+552.77, +681.60] |    +584.10 [+546.56, +650.69] | +118.86 [+101.47, +130.00] | +124.94 [+106.80, +131.83] |

## Paired differences from the previous FFI revision

The guarded candidate reduced typed overhead in all 18 combinations.
The mixed path lowered Buffer overhead by 44.60 ns for the typed literal
case and 33.13 ns for the typed runtime case. The callback path saved
122.77 ns and 105.24 ns respectively. The remaining Buffer and callback
gaps include the plan guard, pointer marshaling, and the native ABI
transition. Their individual costs in the new path remain unmeasured.

Untyped runtime arity 24 regressed by 122.48 ns [44.24, 267.04]. The
other untyped interquartile ranges cross zero. The numeric-only candidate
saved more on typed runtime arities 0–2 and used the general boundary
for Buffer and callback. The results identify the per-argument runtime
refactor and extra numeric-leaf frame management as follow-up candidates.
The generic call entrypoints are unchanged.

| Case     |      Untyped literal Δ |      Untyped runtime Δ |            Typed literal Δ |            Typed runtime Δ |
| -------- | ---------------------: | ---------------------: | -------------------------: | -------------------------: |
| arity-0  |  -7.88 [-18.75, 21.39] |  -3.41 [-21.27, 28.73] |    -67.09 [-73.96, -61.86] |    -52.13 [-62.11, -45.63] |
| arity-1  |   7.80 [-19.35, 35.80] |  15.79 [-17.72, 48.85] |    -67.15 [-73.20, -59.71] |    -44.50 [-54.33, -39.45] |
| arity-2  |   25.15 [-1.22, 66.50] |  19.16 [-22.84, 55.97] |    -81.99 [-87.87, -71.10] |    -62.76 [-83.89, -50.54] |
| arity-4  |  15.41 [-36.60, 58.65] | 23.21 [-19.97, 126.43] |  -105.81 [-113.09, -93.52] |   -98.77 [-117.97, -74.51] |
| arity-8  |  18.16 [-32.28, 79.26] |  30.25 [-6.49, 118.48] | -169.61 [-189.77, -149.58] | -154.07 [-189.83, -123.23] |
| arity-12 |   6.43 [-53.66, 50.56] | 55.48 [-24.85, 153.95] | -227.41 [-252.01, -196.11] | -242.28 [-261.78, -191.03] |
| arity-24 | 49.73 [-44.18, 118.78] | 122.48 [44.24, 267.04] | -384.08 [-431.61, -332.60] | -364.62 [-448.57, -325.92] |
| buffer   |  -9.40 [-84.93, 16.19] |  12.13 [-27.64, 57.05] |    -44.60 [-48.54, -29.65] |    -33.13 [-41.65, -17.50] |
| callback |  34.16 [-21.48, 78.07] |   38.39 [-8.06, 88.65] | -122.77 [-144.36, -102.53] |  -105.24 [-140.61, -74.50] |

### Numeric-only candidate

| Case     |     Numeric-only literal Δ |     Numeric-only runtime Δ |
| -------- | -------------------------: | -------------------------: |
| arity-0  |    -68.57 [-73.09, -63.33] |    -68.54 [-77.17, -62.85] |
| arity-1  |    -68.80 [-73.86, -65.31] |    -66.09 [-72.48, -55.95] |
| arity-2  |    -81.66 [-84.92, -76.27] |    -81.61 [-90.21, -66.63] |
| arity-4  |  -107.97 [-115.22, -91.86] |  -110.89 [-130.19, -96.33] |
| arity-8  | -169.31 [-174.98, -144.28] | -172.77 [-185.79, -140.96] |
| arity-12 | -229.22 [-237.20, -192.19] | -242.10 [-268.35, -209.47] |
| arity-24 | -365.38 [-394.95, -316.96] | -369.82 [-439.69, -303.19] |
| buffer   |       30.29 [17.45, 39.13] |       29.59 [10.45, 50.58] |
| callback |        21.07 [7.20, 39.61] |        20.26 [7.07, 67.96] |

## Provenance and focused validation

The previous-revision artifacts contain the FFI runtime in `1a6f003e6`.
The guarded candidate was built with base `1074a14cd` and a package patch
with normalized SHA-256
`776707cecebbe0e643a81db6fb06350b4cbd3f06c7bdc99b789a51f36c15f6fb`.
The package sources match `c85a71c98`. The per-round data includes all
native image and build-manifest checksums. The runner's raw report had
SHA-256
`b7e592e0212a0c8d316a4161bd74f9f446757bab0cb75056900246f44f6e0744`.

The direct leaf executable matched main byte for byte at SHA-256
`9100616df7d3978a91d1dd21f89b562aa261b4faca907d59588461fcb8868753`.
The frozen v7 executable reached entry and exited 0 under LLDB, and its
output matched byte for byte at SHA-256
`68c11052966f4a851b875c23b6a3413abc74262cec1460532dba09c624d17846`.
The typed binding bridge, both targeted SysV fixtures, and the compiler
subset check passed. A focused native selection from four Node FFI files
matched all 28 prior test records with 26 passes, one limit, and one skip.
