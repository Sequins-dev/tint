# Optimized untyped Octane programs on Darwin arm64

All four unmodified programs passed their upstream checks in Tint and Node 26.13.1. Tint took **109× to 565×** as long by the ratio of medians.

| Program      | Warm operations | Timed operations | Node ms/op | Tint ms/op | Paired Δ IQR ms/op | Ratio of medians |
| ------------ | --------------: | ---------------: | ---------: | ---------: | -----------------: | ---------------: |
| Richards     |              48 |               48 |     0.0821 |     21.146 |   19.866 to 22.773 |             258× |
| DeltaBlue    |              32 |               32 |     0.1087 |     52.374 |   49.125 to 57.350 |             482× |
| NavierStokes |              15 |                4 |     3.0194 |    329.104 | 308.261 to 337.644 |             109× |
| RayTrace     |              12 |               12 |     0.9110 |    514.728 | 488.865 to 545.679 |             565× |

Sixteen rotated fresh-process pairs ran on Apple M5 Max under the shared launch and timing lock wrapper. Both engines loaded the same classic Scripts. The separate timing driver resets the RNG, calls upstream setup, warms the program, times upstream `run` invocations, then calls teardown. NavierStokes checks its built-in frame-15 checksum during warmup. Every native inferior reached its entry breakpoint and exited 42. The raw data include all paired samples and load observations.

The optimized image was built from the staged production changes that became commit `8344df237`. The native source snapshot is `9dcc7f06d4819c7c910b5d515a49cc45164a45fa95a6ee0a3a80a153713e3bb6`. The raw report gives the executable and manifest identities. The pinned upstream files retain their original copyright and licence notices. The earlier Octane report lists the source hashes and reproduce commands.
[Paired timings](general-call-octane-optimized-darwin-arm64.json), [pinned inputs and licences](general-call-octane-trial-darwin-arm64.md)

## Native CPU profiles

A separate pprofessor run for each program sampled the main thread at 997 Hz, beginning just before the timed loop after warmup. LLDB verified the native entry and the final exit. Values below are flat shares of sampled CPU time. Samples mapping to the same native function are grouped across PCs.

| Program      | Sampled CPU | Largest measured work                                                                                                                                                           |
| ------------ | ----------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Richards     |      616 ms | `lookupCachedScriptProperty` 20.34%, sparse-list `findLeaf` 13.18%, `looselyEqual` 11.38%, `leafValue` 4.55%.                                                                   |
| DeltaBlue    |    1,388 ms | `lookupCachedScriptProperty` 13.86%, sparse-list `findLeaf` 6.72%, `exitSourceCall` 3.90%, property key ordering 3.76%.                                                         |
| NavierStokes |    2,005 ms | `readObjectValuePropertyKey` 18.16%, upstream `lin_solve` 14.95%, `decimalInteger` 9.85%, `readArrayElement` 7.85%, `setObjectValuePropertyWithReceiver` 4.70%.                 |
| RayTrace     |    6,060 ms | `lookupCachedScriptProperty` 9.08%, `findMap` 4.85%, `hashString` 4.12%, `readList` 3.28%, `applyDescriptor` 3.18%, `propertyLayout` 2.45%. Collector copying was also sampled. |

The remaining gaps include repeated property cache work, array index conversion and sparse storage, call frames, and generic equality. The discarded four-state inline cache did not remove the costly parts of lookup and regressed the eight-shape and object-array kernels in paired trials. The wide positional path and primitive fast paths improve their covered cases, but these programs spend much of their time outside those cases.
[Grouped CPU profiles](general-call-octane-optimized-profiles-darwin-arm64.json), [cache trials](general-call-generality-trials-darwin-arm64.md)

| Profile      | SHA-256                                                            |
| ------------ | ------------------------------------------------------------------ |
| Richards     | `6d97d2c0a5d72bb91f08a87d3bd90d4c7575fbc631f58836cd700bdd412b1095` |
| DeltaBlue    | `f684fa59f50a28b7300780d3927daf83d1c836a068dbdbee32ad87889661869f` |
| NavierStokes | `c0ce2c6a983ddb589be37ca787b1e46f04c22bedff6cc4f6e00628a88077e223` |
| RayTrace     | `b6f4424c7f0b528adb503d54af586a79d49e00c71144fda3f7428a3209dfdc58` |
