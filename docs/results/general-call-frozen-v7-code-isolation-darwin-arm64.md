# Frozen v7 code isolation on Darwin arm64

The scoped literal-tag lowering emits the baseline's executable sections byte
for byte for the frozen v7 compiler. The source input and runtime overlay were
matched. The compiled output of each measured run had SHA-256
`68c11052966f4a851b875c23b6a3413abc74262cec1460532dba09c624d17846`.

The earlier six-pair comparison had a +25.604 s median wall-time difference
and +417,792 B peak RSS. A one-file diagnostic swap pinned the generated-code
difference to the literal `null` and `typeof` tag tests in the shared scalar
lowerer. The diagnostic build used the same checked Node toolchain and
changed only `packages/ts-native/dist/scalar.js` to its byte-verified emit
from the preceding revision. The baseline's native text, unwind information
and initialized data all matched. The actual scoped build emitted those same
executable sections. It keeps the tag tests in modules that authorize a
checked general record view.

| Executable                           | Native text bytes | Native text SHA-256                                                |
| ------------------------------------ | ----------------: | ------------------------------------------------------------------ |
| Baseline                             |        33,919,888 | `bba7c0999174197a90559575f4f969973f825024df4fc3f82448ceabfec084fa` |
| Shared tag tests                     |        33,885,264 | `d8b381edf08b24fc5db25309ce5e8ecc2edb4f41ccaba4e96bd000049fe500bb` |
| Diagnostic swap and scoped tag tests |        33,919,888 | `bba7c0999174197a90559575f4f969973f825024df4fc3f82448ceabfec084fa` |

[Earlier six-pair comparison](general-call-generality-frozen-v7-darwin-arm64.md)

## Matched executable control

The two compiler binaries in this control have identical executable sections
and different debug metadata. All three pairs ran under the shared timing
and launch lock wrapper. LLDB verified entry and exit 0 in all six runs.

| Pair | Baseline wall s | Diagnostic wall s | Paired wall Δ s | Paired cycles Δ |
| ---: | --------------: | ----------------: | --------------: | --------------: |
|    1 |         115.589 |           148.241 |         +32.652 |    −236,703,761 |
|    2 |          87.750 |            84.480 |          −3.270 |  −2,735,771,918 |
|    3 |          71.893 |            75.609 |          +3.716 |  +5,308,609,979 |

The control's median changes were +3.716 s wall time, −589,824 B peak RSS,
and −236,703,761 cycles. The +32.652 s change with identical executable code
exceeds the previously observed +25.604 s median. The wall-time result alone
cannot assign the earlier difference to a compiler change.

The paired verification of the actual scoped candidate measured 111.113 s
for the baseline and 102.519 s for the scoped compiler. Peak RSS was 114,688 B
lower and cycles were 3,294,889,420 lower in that pair. Each inferior reached
entry and exited 0. The run used the same locked protocol and output checksum.
[Executable hashes and raw paired measurements](general-call-frozen-v7-code-isolation-darwin-arm64.json)

The original eight-kernel typed and untyped binaries and the 15-kernel
generality debug image were byte-identical after rebuilding with the scoped
lowering. Their previous paired comparisons therefore use the same images.
[Original kernels](general-call-original-kernels-regate-darwin-arm64.json),
[Generality kernels](general-call-generality-merged-darwin-arm64.json)
