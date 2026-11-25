# Node FFI overhead in rotated paired rounds on Darwin arm64

This run used Node 26.13.1 and the code selected in `1a6f003e6` on
Apple M5 Max. Node and all Tint variants used the same C library and case
checksums. Each round ran Node, typed Tint and untyped Tint. Tint ran
literal and runtime signature definitions in each mode. Typed compilation
was required for both typed workloads.

The runner held the shared timing lock and rotated launch order through
complete rotations. Each case used 100,000 calls after 20,000 warmups.
For every round the reported overhead is its case time minus its own
workload's JavaScript-only control. Each table cell reports median and
interquartile range `[Q1, Q3]` in nanoseconds per call. The raw launches
recorded CPU idle and 1-, 5-, and 15-minute load. Every round was used.
[Numerical evidence with per-round samples](node-ffi-benchmark-darwin-arm64-1a6f003e6-paired.json)

| Run                                            | Rounds | LLDB exits 42 |  Idle min / median / max | 1-minute load min / median / max |
| ---------------------------------------------- | -----: | ------------: | -----------------------: | -------------------------------: |
| Isolated candidates                            |     20 |           180 |  0.22% / 83.78% / 93.46% |              2.39 / 4.29 / 14.40 |
| Retained changes and direct callback candidate |     18 |           144 | 63.51% / 84.88% / 91.14% |              3.28 / 4.14 / 11.47 |

## Selected revision

The JavaScript-only controls were 2.22 ns in Node, 208.09 and 209.43 ns in
the Tint untyped variants, and 1.72 and 1.70 ns in the Tint typed variants.
Typed literal arity 4 reached parity. Typed runtime signatures and the
other typed literal cases remained above Node.

| Case     |                    Node |    Tint untyped literal |    Tint untyped runtime |      Tint typed literal |      Tint typed runtime |
| -------- | ----------------------: | ----------------------: | ----------------------: | ----------------------: | ----------------------: |
| arity-0  |       7.36 [7.27, 7.60] | 168.15 [117.52, 178.79] | 195.11 [139.77, 197.96] |    79.79 [66.47, 87.53] |  106.90 [89.33, 110.57] |
| arity-1  |    14.49 [13.95, 15.00] | 155.04 [153.24, 156.29] | 174.40 [171.32, 176.07] |    87.92 [73.68, 94.05] | 118.57 [101.50, 121.28] |
| arity-2  |    24.89 [24.51, 25.54] | 184.81 [183.82, 188.78] | 215.27 [212.78, 217.63] |   99.85 [89.60, 105.15] | 135.17 [124.97, 137.73] |
| arity-4  | 134.67 [133.50, 135.84] | 232.33 [231.32, 235.66] | 290.28 [286.25, 292.05] | 127.90 [119.91, 131.42] | 184.33 [179.67, 185.78] |
| arity-8  | 114.61 [113.88, 115.34] | 333.35 [331.26, 336.20] | 427.62 [423.33, 429.62] | 185.89 [184.50, 188.75] | 274.41 [273.77, 275.46] |
| arity-12 | 167.49 [166.45, 169.28] | 422.62 [421.22, 430.79] | 573.04 [568.27, 577.59] | 250.81 [249.67, 251.33] | 394.87 [392.08, 397.45] |
| arity-24 | 310.02 [308.41, 311.87] | 711.65 [709.22, 717.72] | 978.79 [971.53, 989.28] | 438.23 [437.12, 439.30] | 685.67 [680.15, 694.25] |
| buffer   |    67.85 [67.06, 69.06] | 191.62 [190.21, 193.34] | 187.51 [184.77, 188.60] | 120.38 [119.51, 121.35] | 118.76 [118.31, 119.22] |
| callback |    90.25 [89.77, 91.86] | 422.75 [420.92, 424.75] | 415.34 [412.72, 418.23] | 246.49 [244.47, 247.48] | 245.49 [243.75, 247.33] |

| Case     |    Typed literal − Node |    Typed runtime − Node |
| -------- | ----------------------: | ----------------------: |
| arity-0  |    72.60 [57.74, 80.28] |   99.33 [76.78, 103.26] |
| arity-1  |    73.59 [59.45, 80.19] |  103.94 [85.51, 106.89] |
| arity-2  |    74.44 [65.26, 79.61] | 109.58 [101.75, 112.95] |
| arity-4  |   -6.63 [-15.61, -2.82] |    48.26 [41.83, 52.28] |
| arity-8  |    70.52 [69.51, 74.72] | 160.30 [159.61, 160.83] |
| arity-12 |    83.04 [80.58, 84.21] | 227.34 [217.75, 229.66] |
| arity-24 | 128.59 [125.42, 131.18] | 375.47 [361.98, 381.71] |
| buffer   |    52.63 [51.96, 54.12] |    51.02 [49.05, 52.13] |
| callback | 153.79 [152.60, 157.48] | 153.93 [152.15, 156.72] |

## Candidate decisions

Each difference is candidate overhead minus the matching baseline workload's
overhead from the same round. Negative medians favor the candidate.

| Change and case                                                                                               | Median [Q1, Q3] ns per call | Result           |
| ------------------------------------------------------------------------------------------------------------- | --------------------------: | ---------------- |
| Reuse the realm context, typed runtime arity 0                                                                |        −3.52 [−4.74, −2.10] | Retained         |
| Reuse the realm context, typed literal arity 1                                                                |        −4.65 [−5.13, −3.15] | Retained         |
| Project Buffer before primitive type tests, typed runtime Buffer                                              |        −3.29 [−5.15, −0.79] | Retained         |
| Resolve the scalar codec when generating the literal adapter, typed literal arity 24                          |     −46.77 [−50.77, −39.34] | Retained         |
| Initialize the callback argument list with its first value and cache the result codec, typed runtime callback |       +9.22 [+4.53, +12.91] | Dropped          |
| Read and write the captured register frame directly, typed literal callback                                   |       −8.23 [−10.77, −5.52] | Retained         |
| Read and write the captured register frame directly, typed runtime callback                                   |      −11.35 [−13.13, −7.94] | Retained         |
| Read and write the captured register frame directly, untyped literal callback                                 |        −3.89 [−8.30, +1.51] | IQR crosses zero |
| Read and write the captured register frame directly, untyped runtime callback                                 |     −15.60 [−18.56, −10.00] | Retained         |

The direct callback trial also moved the typed runtime arity-24 median
by +6.68 ns and the untyped literal Buffer median by +3.32 ns. Those cases use the scalar
dispatch path. The direct callback patch was retained
for the measured reduction on callback calls. Realm-context reuse preserves
the original cross-realm path. Buffer projection lends the existing backing
and offset. Direct callback access uses a retargetable view per reentry depth
and a scratch copy for a narrow argument at the end of the captured window.

## Remaining call costs

The typed loop reaches the JS-callable FFI wrapper via `generalCall`.
The list created by `packCallArguments` and `callGeneralValue`'s two
object projections occur before the FFI adapter. Untyped source builds
its list in `argumentList` and invokes via `invokeList`. `callObject`
creates the action passed to the callable's execution context and an
error/value record. These sites belong to the general-path stream.
[`generalCall`](../../packages/ts-native/src/scalar.ts#L5135),
[`argumentList`](../../packages/js-engine/src/lowering/index.ts#L1509),
[`callGeneralValue`](../../packages/js-runtime/src/objects/values.ts#L214),
[`callObject`](../../packages/js-runtime/src/objects/call.ts#L11)

Main-thread profiles captured those frames along with scalar conversion,
Buffer projection, and the callback dispatcher. The callback list belongs
inside the FFI adapter. The tried replacement raised its paired cost, so
the callback change instead removes the per-byte copies on the capture path.
[Profiles before the measured changes](node-ffi-benchmark-darwin-arm64-3e9330045-typed.md)

## Provenance

The finalist images used `5621b6da6` and the direct-callback patch whose
normalized SHA-256 is
`5f0de73bc4b44b2169ba07d3a5ca5e8c9287366621b2ea82f928dfadd7339b29`.
The branch subsequently merged main at `206530edd`, which changed the
fixture preparation wrapper and diagnostics tooling. The compiler and
runtime sources in `1a6f003e6` match the selected images' sources.

## Validation

The pinned suite used three disjoint shards. All 25 upstream files and the
missing-build control reached entry and exited 42 under LLDB. The 122
case records match the previous run, with 94 passes, 25 diagnosed limits,
and 3 upstream skips. This includes passes in the three former
SharedArrayBuffer cases. [Complete pinned suite](node-ffi-v26.13.1-darwin-arm64-1a6f003e6-paired.json)

The leaf executable matched main byte for byte at SHA-256
`9100616df7d3978a91d1dd21f89b562aa261b4faca907d59588461fcb8868753`.
The frozen v7 executable reached entry under LLDB, exited 0, and produced
byte-identical output at SHA-256
`68c11052966f4a851b875c23b6a3413abc74262cec1460532dba09c624d17846`.
Both SysV focused fixtures passed, with two native launches per fixture.
The merged LLDB JIT registration test, native compiler subset, and
benchmark and resource classification tests passed.
