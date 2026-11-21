# Typed Node FFI transition costs on Darwin arm64

Node 26.13.1 and Tint ran in rotated order under the shared timing lock
on Apple M5 Max. Each overhead subtracts the same workload's JavaScript-only
control in the same round. All 310
native processes reached LLDB entry and exited 42. The runner verified
3,620 case and control checksums.
The per-round data includes the launch order, source and build provenance,
case times, controls, CPU idle, and one-, five-, and fifteen-minute load.
[Per-round results](node-ffi-benchmark-darwin-arm64-23624bc11-transitions.json)

| Comparison                                | Rounds | CPU idle %, min / median / max | 1-minute load, min / median / max |
| ----------------------------------------- | -----: | -----------------------------: | --------------------------------: |
| Fixed-call frames and realm context reuse |     15 |           0.02 / 14.06 / 26.59 |             16.51 / 18.33 / 30.55 |
| C callback control                        |     15 |          10.30 / 28.32 / 36.03 |             13.33 / 14.59 / 16.36 |
| Typed adapter and trampoline candidates   |     22 |           0.00 / 19.05 / 36.43 |             13.51 / 16.96 / 31.64 |

## Adapter and callback costs

- Separating the cold workspace cleanup and reusing the realm context
  reduced typed runtime arity-0 overhead by 2.30 ns [1.00, 5.73] against
  the previous adapter in its dedicated 15-round run.
- In the timed main-thread callback profile, `writeScalarArgument`
  accounted for 2.37% of self cost. A stack containing
  `callScalarForeignCallbacks` accounted for 24.22% of cumulative cost.
  The capture contains 929 samples and reached inferior exit 42. The
  raw profile SHA-256 is
  `74261dda551084867d9c22e145adb4a6ad41878a8e2b9bc682e2a149fb365450`.
- The C callback control kept the same outbound Tint transition and
  called an equivalent C increment function. It cut 76.85 ns
  [68.98, 83.99] relative to the typed runtime callback and remained
  48.12 ns [37.03, 54.10] above the Node JavaScript callback in overhead.
  This measures two parts of the callback path with a diagnostic workload.
- Reading library and callback liveness in the fixed scalar entry cut
  arity-0 overhead by 15.47 ns [12.79, 16.89] for literal definitions and
  14.91 ns [13.81, 18.30] for runtime definitions. Inlining the callable
  projection cut another 4.31 ns [3.63, 6.33] and 4.89 ns [2.70, 6.12].
- The guarded pointer and signed i32 outbound writer cut callback overhead
  by 125.26 ns [118.24, 144.28] for literal definitions and 126.21 ns
  [116.89, 142.73] for runtime definitions. The precompiled signed i32
  trampoline then cut another 22.04 ns [12.88, 28.04] and 22.48 ns
  [10.26, 26.40] against the inlined projection stage.

## Typed comparison with Node

The precompiled trampoline candidate matches or beats Node's paired medians
in both measures for 16 of 18 combinations. Buffer remains slower in both
signature modes at this stage. Untyped variants are tracked separately with
the general-call stream and will run again on the merged main revision.

Each cell is median [Q1, Q3] in nanoseconds per call. Negative differences
favor Tint.

| Case     |           Literal overhead |              Literal total |           Runtime overhead |              Runtime total |
| -------- | -------------------------: | -------------------------: | -------------------------: | -------------------------: |
| arity-0  |     -28.91 [-33.03, +1.10] |     -31.25 [-37.79, -1.37] |     -27.26 [-33.61, +0.49] |     -29.51 [-36.98, -2.49] |
| arity-1  |     -14.57 [-21.97, -9.63] |    -16.73 [-24.66, -11.47] |    -13.42 [-22.79, -11.16] |    -15.23 [-26.55, -13.06] |
| arity-2  |    -24.10 [-33.63, -20.30] |    -26.10 [-35.45, -22.68] |    -23.80 [-30.08, -20.83] |    -27.23 [-32.59, -22.80] |
| arity-4  | -256.35 [-277.46, -251.84] | -258.39 [-280.85, -253.44] | -255.88 [-276.84, -247.50] | -258.39 [-280.56, -249.23] |
| arity-8  | -204.11 [-221.44, -194.91] | -206.01 [-225.30, -197.08] | -202.59 [-219.23, -193.96] | -204.85 [-221.59, -195.77] |
| arity-12 | -296.35 [-316.68, -281.55] | -298.40 [-318.87, -283.68] | -299.17 [-319.56, -280.96] | -300.81 [-321.86, -282.91] |
| arity-24 | -554.57 [-604.45, -531.78] | -556.61 [-606.60, -533.47] | -554.53 [-609.97, -532.88] | -556.42 [-612.09, -535.42] |
| buffer   |    +20.88 [+16.19, +32.75] |    +19.11 [+13.47, +30.34] |    +23.67 [+22.36, +32.45] |    +21.04 [+20.21, +29.57] |
| callback |    -21.71 [-35.28, -12.14] |    -23.73 [-37.34, -14.40] |    -19.77 [-34.52, -13.65] |    -21.50 [-36.79, -16.02] |
