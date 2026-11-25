# Typed arity-zero FFI callable boundary on Darwin arm64

The probe uses the typed literal arity-zero case from the selected FFI
revision `1a6f003e6`. It installs a constant-return function body when
creating the benchmark callable. The typed call site, callable object,
realm context, and JavaScript-only control are the same as in the selected
workload. The probe skips the library and binding checks, scalar handling,
and the C call. The probe patch is local to the measurement image.
[Paired benchmark report](node-ffi-benchmark-darwin-arm64-1a6f003e6-paired.md)

Node 26.13.1, all four retained Tint workloads, and the probe ran in 18
rotated rounds under the shared timing lock. All 90 native launches
reached LLDB exit 42. Each timing used the case minus its own control in
the same round. The medians and quartiles below are ns per call.

| Workload               | Overhead median [Q1, Q3] | Paired difference vs Node median [Q1, Q3] |
| ---------------------- | -----------------------: | ----------------------------------------: |
| Node                   |        7.29 [7.07, 7.82] |                                         — |
| Selected typed literal |     63.26 [62.71, 64.61] |                      55.76 [55.24, 57.20] |
| Constant-return probe  |     50.08 [48.81, 50.72] |                      42.44 [41.51, 43.14] |

The constant-return body changed overhead by -13.88 [-14.63, -12.28] ns per
call. The current callable boundary with that body remained
42.44 [41.51, 43.14] ns per call above Node. Typed arity-zero calls
through that boundary still materialize an argument list, project the
callable, enter the realm context, and read the generic result.
[`generalCall`](../../packages/ts-native/src/scalar.ts#L5135),
[`callGeneralValue`](../../packages/js-runtime/src/objects/values.ts#L214),
[`callObject`](../../packages/js-runtime/src/objects/call.ts#L11)

Each cell below shows paired overhead in ns per call, CPU idle percentage,
and one-minute load after the launch. Every round contributed to the
quartiles.

| Round | Node ns / idle / load | Selected typed literal ns / idle / load | Constant-return probe ns / idle / load |
| ----: | --------------------: | --------------------------------------: | -------------------------------------: |
|     1 | 21.38 / 81.23% / 4.45 |                   67.62 / 78.53% / 4.10 |                  53.16 / 84.88% / 4.31 |
|     2 |  7.21 / 63.32% / 4.69 |                   62.50 / 71.64% / 4.58 |                  49.95 / 72.93% / 4.69 |
|     3 |  7.39 / 71.59% / 4.73 |                   66.14 / 70.26% / 4.88 |                  49.06 / 78.17% / 4.73 |
|     4 |  7.03 / 78.63% / 4.31 |                   63.30 / 84.59% / 4.51 |                  50.21 / 86.07% / 4.31 |
|     5 |  7.23 / 82.44% / 4.48 |                   62.74 / 84.39% / 4.41 |                  48.69 / 85.38% / 4.48 |
|     6 |  7.28 / 85.61% / 4.41 |                   64.71 / 83.88% / 3.88 |                  51.84 / 87.13% / 4.41 |
|     7 |  7.67 / 80.07% / 3.66 |                   63.22 / 85.23% / 3.97 |                  48.10 / 83.47% / 4.05 |
|     8 |  8.09 / 82.51% / 4.43 |                   64.32 / 71.60% / 4.25 |                  50.28 / 79.17% / 4.43 |
|     9 |  5.92 / 80.76% / 3.72 |                   63.43 / 84.43% / 3.75 |                  48.96 / 80.22% / 3.72 |
|    10 |  6.99 / 72.32% / 3.78 |                   65.38 / 84.96% / 3.84 |                  48.98 / 83.58% / 3.78 |
|    11 |  7.76 / 80.07% / 3.35 |                   62.98 / 85.40% / 3.43 |                  50.79 / 84.47% / 3.35 |
|    12 |  6.88 / 80.69% / 3.43 |                   62.77 / 84.45% / 3.44 |                  48.09 / 85.26% / 3.43 |
|    13 |  7.19 / 79.92% / 3.48 |                   62.10 / 85.10% / 3.69 |                  50.46 / 82.83% / 3.47 |
|    14 |  6.86 / 80.83% / 3.68 |                   62.49 / 79.87% / 3.32 |                  48.76 / 79.94% / 3.68 |
|    15 |  7.30 / 79.47% / 3.80 |                   63.81 / 84.57% / 3.95 |                  48.66 / 85.50% / 3.80 |
|    16 | 9.64 / 32.54% / 12.23 |                   98.12 / 56.79% / 4.79 |                  88.75 / 9.15% / 12.23 |
|    17 | 11.68 / 0.75% / 10.53 |                  62.70 / 85.14% / 11.13 |                 57.39 / 64.30% / 10.53 |
|    18 | 7.83 / 80.60% / 10.64 |                   62.53 / 85.46% / 8.87 |                 50.52 / 85.23% / 10.64 |

The raw run has SHA-256 `a24ea13999af74881d54c7f06fdee782a5764dd93e5b7840b48af482e778f2d1`.
The probe patch has normalized SHA-256 `db7371f76e7bb1e2d34849d1559b0f6ffe2b2a2fe0bddcbe60a2f3c960b085d3`.
