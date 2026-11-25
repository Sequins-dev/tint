# Direct Buffer backing and typed Node FFI parity on Darwin arm64

All 18 typed case and signature combinations beat Node 26.13.1 on the
paired medians for FFI overhead and total time. The comparison ran on
Apple M5 Max for 15 rounds under the shared timing lock, with each
workload rotating through each launch position. All 60 native launches
reached LLDB entry and exited 42. The runner verified
750 case and control checksums.

Each overhead subtracts the same workload's JavaScript-only control
from the same round. CPU idle ranged from 0.09% to 22.60%
with a median of 6.90%. One-minute load ranged from
17.03 to 23.15 with a median of 19.77.
The data records all launch orders, case times, controls, load, and
build manifests. [Per-round results](node-ffi-benchmark-darwin-arm64-b989737b0-buffer.json)

The candidate calls the validated C symbol with the stable backing of
an eligible zero-offset byte view. Offset views, movable backing, and
other pointer values continue through the existing lending path. Against
the previous typed adapter in the same rounds, Buffer overhead fell by
100.76 ns [92.03, 105.81] for literal definitions and 104.61 ns
[92.22, 111.58] for runtime definitions.

## Paired differences from Node

Values are median [Q1, Q3] in nanoseconds per call. Negative differences
favor Tint. The arity-0 overhead intervals cross zero for both signature
modes.

| Case     |           Literal overhead |              Literal total |           Runtime overhead |              Runtime total |
| -------- | -------------------------: | -------------------------: | -------------------------: | -------------------------: |
| arity-0  |      -4.40 [-27.73, +0.57] |      -5.60 [-29.17, -1.69] |      -1.98 [-30.27, +0.99] |      -4.06 [-31.87, -0.62] |
| arity-1  |    -36.53 [-61.32, -23.34] |    -38.54 [-65.63, -25.16] |    -38.19 [-63.22, -26.39] |    -39.66 [-67.20, -28.15] |
| arity-2  |    -30.99 [-47.25, -21.38] |    -34.89 [-50.32, -23.36] |    -31.22 [-43.04, -24.22] |    -32.51 [-45.47, -26.13] |
| arity-4  | -277.43 [-286.65, -255.36] | -279.28 [-292.12, -256.82] | -276.59 [-287.84, -248.47] | -278.00 [-291.62, -249.91] |
| arity-8  | -215.31 [-220.45, -201.33] | -218.88 [-223.51, -203.08] | -216.15 [-220.88, -202.28] | -220.48 [-225.84, -203.61] |
| arity-12 | -309.59 [-315.63, -287.96] | -312.60 [-318.18, -289.73] | -307.83 [-322.23, -285.53] | -309.92 [-325.74, -286.84] |
| arity-24 | -586.02 [-623.34, -544.42] | -587.44 [-626.42, -546.19] | -583.42 [-618.92, -543.39] | -586.21 [-621.12, -545.08] |
| buffer   |    -83.85 [-98.96, -70.66] |   -85.86 [-102.02, -72.41] |    -75.71 [-97.09, -69.45] |   -77.58 [-102.78, -71.23] |
| callback |    -28.07 [-34.88, -19.63] |    -29.66 [-38.45, -23.26] |     -21.78 [-31.69, -0.96] |     -27.80 [-34.31, -3.90] |

## Validation

- The typed Node FFI fixture agreed with the pinned Node reference. Both
  native runs reached LLDB entry and exited 42. The fixture checked array
  aliases, a Buffer slice with a nonzero offset, and mutation of a Buffer
  between calls.
- The leaf-call binary matched byte-for-byte with SHA-256
  `9100616df7d3978a91d1dd21f89b562aa261b4faca907d59588461fcb8868753`. The emitted frozen v7 workload matched byte-for-byte with
  SHA-256 `68c11052966f4a851b875c23b6a3413abc74262cec1460532dba09c624d17846` after the native compiler reached LLDB entry and
  exited 0.
- The complete pinned suite on the earlier split-frame snapshot recorded
  94 passes, 25 diagnosed limits, and three skips across 26 fixtures.
  [Pinned native results](node-ffi-v26.13.1-darwin-arm64-0c52020ee-split-frame.json)

The untyped comparison depends on the general-call stream. The integrated
branch still needs the paired comparison across both variants and the end
gates before review readiness. [General-call stream](https://github.com/Sequins-dev/tint/pull/7)
