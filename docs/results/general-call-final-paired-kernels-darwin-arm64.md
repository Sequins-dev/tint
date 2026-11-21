# Untyped call and loop performance on Darwin arm64

All eight kernels ran faster than Node 26.13.1 in the final 24 rotated pairs.
Every paired IQR was below zero. Node and Tint ran the same input and
produced the same checksums. LLDB verified exit 42 for each native inferior.
The reference and candidate typed images were byte-identical.
[Raw paired rounds](general-call-final-paired-kernels-darwin-arm64.json),
[branch image provenance](general-call-final-benchmark-image-provenance.json)

| Kernel          | Node median (ns) | Tint untyped median (ns) | Paired change (ns) |      Paired IQR (ns) |
| --------------- | ---------------: | -----------------------: | -----------------: | -------------------: |
| Array           |            4.452 |                    3.808 |             -0.943 |     -5.248 to -0.107 |
| Closure         |            8.719 |                    3.846 |             -5.410 |     -8.042 to -4.178 |
| Control         |            6.391 |                    0.335 |             -6.077 |     -7.393 to -5.080 |
| Method          |            8.566 |                    4.644 |             -3.865 |     -9.449 to -2.719 |
| Property        |            3.836 |                    1.927 |             -1.884 |     -3.659 to -1.514 |
| Recursive       |          519.604 |                  220.167 |           -299.344 | -659.062 to -252.854 |
| Rest            |           20.572 |                    1.419 |            -19.153 |   -38.900 to -17.145 |
| String equality |            4.256 |                    2.230 |             -2.005 |     -2.335 to -1.693 |

The main suite warms each kernel, then times 100,000 iterations or 2,000
recursive calls. In a separate 24-round run with 25 million iterations per
round, the control took **0.325 ns** in untyped Tint and **0.725 ns** in
Node. The paired median was **−0.386 ns**, with an IQR of **−0.494 to
−0.329 ns**. The earlier numeric loop took 2.202 ns and the typed image
2.167 ns in those same rounds.
[Steady-state control rounds](general-call-final-steady-control-darwin-arm64.json)

## Results by change

- Static scope resolution and fixed binding slots removed repeated name lookup.
  Inline primitive operations removed numeric result records and collapsed scalar tag checks.
  [Scope rounds](general-call-static-scopes-darwin-arm64.json),
  [primitive-operation rounds](general-call-inline-value-operations-darwin-arm64.json)
- The native positional path sped up recursive, method and closure calls. The
  managed-compatible trial measured a 5.159 ns string-equality slowdown before
  the later string specialization. The runtime path covers zero, one or two
  positional arguments and retains general dispatch on guard misses.
  [Managed-compatible positional rounds](general-call-positional-calls-managed-compatible-darwin-arm64.json)
- Per-site shape checks reduced property and method dispatch costs. Live
  prototypes, accessors and proxies retain their observable lookup behavior.
  [Property-cache rounds](general-call-property-caches-darwin-arm64.json)
- Closed recursive calls reduced the paired median by 8,134 ns per outer
  benchmark iteration. The `fib(2)` call tree retired 65 instructions and
  allocated no managed objects.
  [Closed-call rounds and instruction trace](general-call-closed-calls-darwin-arm64.md)
- Ordered int32 lanes saved 1.247 ns per short control iteration. The early
  counted-loop trial increased the rest median by 280.741 ns. The following
  rest clone guards proved arity and materializes present elements in
  positional slots, saving 1,782 ns per rest iteration.
  [Counted-loop rounds](general-call-counted-loops-darwin-arm64.json),
  [Rest clone rounds](general-call-rest-clones-darwin-arm64.json)
- Closed numeric arrays and records saved 171.016 ns, 141.125 ns and 67.834 ns
  on array, method and property respectively. Closed factories saved another
  88.199 ns on the closure kernel. Proved string cases saved 61.797 ns on
  string equality.
  [Aggregate rounds](general-call-closed-aggregates-darwin-arm64.json),
  [Factory and string rounds](general-call-closed-factories-darwin-arm64.json)
- Exact signed accumulation saved another 0.885 ns on the short control.
  The guard proves the entire integer reduction stays in range. The
  continuation preserves sequential floating-point additions for other bounds.
  [Signed reduction rounds](general-call-integer-reductions-darwin-arm64.json),
  [Final instruction traces](general-call-final-kernel-traces-darwin-arm64.md)

## Native validation

The baseline and branch frozen v7 images executed byte-identical code and
emitted identical compiler outputs in all six runs. The observed paired
median was 17.677 s lower wall time and 262,144 B higher peak RSS.
[Frozen v7 comparison](general-call-frozen-v7-darwin-arm64-final.md)

The final 200-form Linux dev ledger had zero regressions against the
198-form reference. It recorded 193 passes. All seven other outcomes matched
the reference. The measured candidate and final source produced identical
paths and outcomes across the ledger. Both native Test262 smoke modes on the
final source passed 2/2.
[Final ledger](unified-pipeline-ledger-general-integrated-replay-verified-dev-v1.json),
[Measured candidate ledger](unified-pipeline-ledger-general-final-candidate-replay-verified-dev-v1.json),
[Linked-unit smoke](general-call-final-test262-units.json),
[Whole-program smoke](general-call-final-test262-program.json)
