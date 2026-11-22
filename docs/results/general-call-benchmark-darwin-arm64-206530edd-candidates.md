# General JavaScript lowering candidates on Darwin arm64

These trials used the same eight kernels and Node 26.13.1 as the
[original baseline](general-call-benchmark-darwin-arm64-206530edd-baseline.md).
All 16 rounds ran under the shared timing lock and rotated eight workloads
through every launch position twice. All 112 native launches stopped at entry
and exited 42 under LLDB. The runner used one measured launch per image per
round and included every sample. One-minute load before launch ranged from
8.86 to 25.27. Idle samples ranged from 1.75% to 67.70%.

The first comparison measured reusing for-let environments when no iteration
binding can escape. Across 15 rounds that change reduced the control by a
paired median of 33.51 ns per iteration, with an IQR of 29.03–43.43 ns saved.
The paired IQRs also favored it for closure calls, method calls, and array
reads. All 60 native launches exited 42.
[First comparison samples](general-call-benchmark-darwin-arm64-206530edd-loop1.json)

## Incremental changes

Each column shows the median paired difference from the immediately preceding
variant, with IQR in square brackets, in ns per outer iteration. Negative
values favor the change. The preceding variant for the first column is the
image with environment reuse.

| Kernel              |      Call-context shortcut |                Loop slots |        Function-body slots |        Guarded arithmetic |        Fixed argument list |
| ------------------- | -------------------------: | ------------------------: | -------------------------: | ------------------------: | -------------------------: |
| FFI control         |      -23.78 [-39.92, 5.73] |   -40.69 [-56.50, -27.12] |    -64.40 [-79.95, -47.91] |   -29.26 [-35.47, -15.43] |       -5.22 [-11.03, 7.97] |
| Closure             |      -28.68 [-52.41, 7.35] |   -36.30 [-75.25, -10.43] |   -70.93 [-120.85, -52.28] |    -25.49 [-41.94, -0.37] |     -10.94 [-19.44, 22.45] |
| Method              |      -31.37 [-72.58, 9.41] |    -36.69 [-64.79, -4.73] |   -54.25 [-108.83, -39.63] |    -24.64 [-48.92, -0.14] |     -12.07 [-39.63, 24.32] |
| Property read/write |      -4.72 [-35.54, 25.66] |   -45.16 [-61.37, -27.58] |   -95.08 [-112.19, -69.54] |    -25.70 [-38.39, -6.60] |       1.02 [-16.03, 16.17] |
| Array read          |     -22.03 [-39.34, 29.42] |   -46.27 [-64.77, -28.89] |    -72.08 [-75.97, -43.05] |    -23.18 [-35.96, -5.74] |       7.72 [-13.55, 19.33] |
| String equality     |       0.65 [-30.52, 14.30] |   -54.23 [-75.07, -44.22] |    -26.64 [-39.63, -11.98] |      -3.70 [-29.36, 1.84] |       -4.30 [-17.50, 9.62] |
| Rest                |   -12.02 [-182.63, 100.71] |    -31.85 [-76.64, 99.77] |    -24.64 [-121.07, 48.26] |    41.47 [-79.58, 172.81] |    -64.54 [-253.78, 33.03] |
| Recursive Fibonacci | -805.05 [-3021.89, 448.10] | 939.32 [-625.04, 1710.09] | 440.81 [-1183.90, 2316.54] | 343.82 [-995.29, 1952.82] | 815.34 [-1813.05, 2485.57] |

The loop slots, function-body slots, and guarded arithmetic each improved the
control and several other kernels across their IQRs. All IQRs for the
call-context entry and fixed argument-list trials crossed zero. The final
tree drops those two trials. The raw samples identify each build by its
base commit, package patch SHA-256, image SHA-256, and manifest SHA-256.

The typed workload has SHA-256
`247254d48165ba82726246b998d7d5f782887049e6f7733cfe0c7038099c7648`
in every candidate. The comparison runs one copy of that identical image
per round. Recursive Fibonacci and rest showed no clear gain from an individual
change at this load.
[Candidate samples](general-call-benchmark-darwin-arm64-206530edd-candidates.json)
