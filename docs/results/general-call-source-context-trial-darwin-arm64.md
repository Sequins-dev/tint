# Source-context dispatch trial on Darwin arm64

The trial skipped the bound invocation callback and generic result record
when an ordinary source function received an already materialized argument
list. It reused the active context for the same Script and restored the
caller on return or throw. The paired comparison gave no clear gain on the
23 call and loop kernels, and NavierStokes slowed. The trial was removed.

The original set ran 16 rotated rounds. The generality and Octane sets ran
18 rounds each. Each round used Node 26.13.1, the scoped-tag baseline and the
trial build under the shared timing and launch lock. All workload checksums
matched. The original set also included the typed image.

- The six-argument generality kernel changed by −0.26 ns per operation.
  The paired IQR was −0.88 to +0.56 ns.
- The original recursive kernel changed by +1.27 ns per operation.
  The paired IQR was +0.35 to +3.92 ns.

| Octane program | Node median ms | Baseline median ms | Trial median ms | Paired change ms |     Paired IQR ms |
| -------------- | -------------: | -----------------: | --------------: | ---------------: | ----------------: |
| Richards       |          0.051 |             13.082 |          13.928 |           +0.562 |  −0.072 to +1.105 |
| DeltaBlue      |          0.073 |             33.573 |          34.701 |           +1.290 |  −0.741 to +2.686 |
| NavierStokes   |          1.979 |            206.929 |         212.073 |           +7.972 | +2.570 to +18.635 |
| RayTrace       |          0.555 |            327.861 |         334.815 |           +5.857 | −3.703 to +16.730 |

The frozen v7 trial had the same executable sections as the baseline. All
six inferiors reached entry, exited successfully and produced the same
compiler image. Paired wall-time differences were +1.241, −11.683 and
+4.095 seconds. The median RSS difference was +688,128 bytes. These are
observations from identical executable code.

[Exact artifacts, paired rounds and frozen v7 checksums](general-call-source-context-trial-darwin-arm64.json)
