# Slice 3 fixed-arity adapter budgets

The inputs from `tools/build-slice3-budget-fixture.ts` matched byte for byte
between the candidate and whole-module fallback from archived main
`a282ba01dadcc3a04fa5a5bff81e7ef980a5b4a0`. These runs used Node 24.12.0,
macOS arm64, release images and `TZ=UTC`. The benchmark sampled the
inferior's `proc_pid_rusage` cycle and instruction fields under LLDB.
Each run confirmed an entry stop and exit 42. Nine rounds alternated the
case order under `tint-timing.lock`.

The initial unit adapter exceeded the image budget by 66,048 bytes. Its
boxed entry now specializes the primitive body directly. It keeps the
general-value calling convention at that entry and uses the typed calling
convention at the numeric import. Exact argument count follows from the
private, immutable binding and has no runtime argument list. The realm
installer and callable frame are absent from these images.

| Measure                                                          | Whole-module fallback | Fixed arity |
| ---------------------------------------------------------------- | --------------------: | ----------: |
| One-call image bytes                                             |            24,901,069 |     595,389 |
| One-call startup cycles                                          |            14,249,210 |   7,089,173 |
| One-call LLDB launch-to-exit-stop milliseconds                   |                 63.10 |       61.12 |
| One round-trip image bytes                                       |            24,901,075 |     595,395 |
| One round-trip startup cycles                                    |            14,354,001 |   7,374,067 |
| Cycles per additional typed-to-general call, including loop work |              3,496.12 |       33.67 |
| Cycles per additional round trip, including loop work            |              4,063.42 |       13.40 |

The hot workloads run 50,000 iterations. Each cycles-per-iteration value is
the median of the paired hot-minus-cold measurement divided by 49,999.
The whole-module second-call increment was 567.54 cycles. The optimized
round trip includes the general-to-typed call and bounds its cost by
13.40 cycles per iteration. Optimization and startup noise prevent a
separate marginal estimate for that call.

For allocation, the debugger armed Tint's heap counter at a one-byte
interval when the hosted context became live. At arities 0, 1 and 2, both
one and 2,000 round trips registered one managed allocation for the
whole hosted entry. The additional 1,999 round trips registered zero
managed allocations at each arity.

The final pre-merge dense replay check built and ran both modes of the same
144-function graph. Owned and replayed builds took 29.76 and 29.92 seconds
and reached 2,273,886,208 and 2,140,291,072 peak RSS bytes, respectively.
Wall time rose 0.54% and peak RSS fell 5.88%. The images compared equal
with SHA-256
`a1ced91c027a77860d9f3328d7241bc17241c03200ec78a3eaf8592c44447eda`.
Both LLDB runs on `dev` exited 42.
