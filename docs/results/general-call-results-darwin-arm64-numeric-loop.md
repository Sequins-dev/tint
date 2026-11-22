# Native call and loop results at 9b86718bb

The eight-kernel comparison used 16 rotated rounds on Darwin arm64.
All artifacts matched their build manifests. Each native inferior stopped
at entry under LLDB and exited with status 42. Every kernel returned its
expected checksum. Node was v26.13.1. The benchmark warmed each case with
20,000 iterations, or 2,000 for recursion. Native and Node times cover the
workload after warmup.

| Kernel         | Node ns/iteration | Tint before ns/iteration | Tint after ns/iteration | Tint paired change, median |          Paired IQR |
| -------------- | ----------------: | -----------------------: | ----------------------: | -------------------------: | ------------------: |
| array          |              4.05 |                   203.10 |                  199.88 |                      -8.55 |     -23.08 to 17.09 |
| closure        |              8.99 |                   303.49 |                  318.24 |                      17.70 |      -1.95 to 50.43 |
| control        |              6.99 |                   183.61 |                    2.05 |                    -181.61 |  -222.14 to -174.56 |
| method         |             10.07 |                   428.80 |                  434.96 |                     -13.29 |     -58.45 to 22.97 |
| property       |              3.71 |                   236.61 |                  239.77 |                       5.17 |     -16.10 to 21.46 |
| recursive      |            553.51 |                 28412.57 |                29742.95 |                      23.13 | -2907.36 to 4200.05 |
| rest           |             20.12 |                  1462.05 |                 1514.78 |                      -0.85 |   -200.57 to 164.06 |
| stringEquality |              4.35 |                   170.83 |                  179.10 |                       1.20 |     -13.22 to 20.01 |

The control's 100,000-iteration window includes V8 tiering. A separate
25,000,000-iteration control run is required to compare steady-state speed.
The other seven kernels remain above their paired Node medians.

Raw rounds and provenance appear in the
[benchmark report](general-call-benchmark-darwin-arm64-numeric-loop.json).

## Frozen v7 native self-compile

Three paired rounds compared matched compiler images from `206530edd`
and `9b86718bb`. Each image compiled the same immutable 760-file source
tree. Both images used the allocator configuration matched to the frozen
workload. The timing and native launch locks were held from admission
through completion. LLDB verified entry and exit status 0 on all six runs.
The six output images matched byte for byte.

| Round | Base wall s | Candidate wall s | Base peak RSS MiB | Candidate peak RSS MiB |
| ----- | ----------: | ---------------: | ----------------: | ---------------------: |
| 1     |     161.195 |          155.765 |          2127.891 |               2127.812 |
| 2     |     148.657 |          137.973 |          2128.375 |               2127.781 |
| 3     |     162.137 |          186.415 |          2128.172 |               2126.500 |

The median paired changes were -5.430 seconds and -0.594 MiB peak RSS. The [frozen comparison](general-call-frozen-v7-darwin-arm64-numeric-loop.json) records the source, input, sample and output digests.

## Native ledger

The Linux aarch64 development runner completed all 200 forms. The ledger
reported zero regressions against the 168-form slice 4a baseline. There
were seven runtime failures, one build failure and two unsupported forms
in the full inventory. A separate 198-form baseline used source validation,
source replay and function fallback, so its contract-sensitive results
require the same configuration for comparison. The typed primitive-contract
fixture passed a focused Darwin rerun with those three settings and a verified
LLDB exit of 42. [Native ledger](unified-pipeline-ledger-general-calls-numeric-loop-dev-v2.json)
