# Node FFI interleaved performance investigation

Node 26.13.1 and Tint ran the public FFI workload against the same C
library within each run on an Apple M5 Max. The baseline is
`a9fce4073`, the cached-frame intermediate is `037c5857c`, and the
candidate with direct numeric entries is `cf6faaf6b`. Each run used
100,000 calls per case after 20,000 warmups, with nine rounds rotating
the order of the three engines. The shared timing lock serialized
the measurements. LLDB confirmed exit 42 for all 18 candidate
native launches. All 270 candidate measurements verified their
checksums, including the JavaScript-only control.

| Case | Node | Literal baseline | Literal candidate | Runtime baseline | Runtime candidate |
| --- | ---: | ---: | ---: | ---: | ---: |
| arity-0 | 9.4 | 345.7 | 322.5 | 620.6 | 387.6 |
| arity-1 | 16.2 | 402.6 | 348.8 | 710.8 | 372.5 |
| arity-2 | 26.9 | 466.9 | 383.4 | 809.5 | 409.7 |
| arity-4 | 140.0 | 579.8 | 432.9 | 1002.5 | 484.7 |
| arity-8 | 116.3 | 782.7 | 538.1 | 1342.6 | 618.3 |
| arity-12 | 168.3 | 996.8 | 638.0 | 1685.2 | 769.3 |
| arity-24 | 311.9 | 1635.7 | 937.6 | 2604.9 | 1176.7 |
| buffer | 70.3 | 2301.8 | 398.0 | 1154.9 | 395.6 |
| callback | 92.9 | 4658.1 | 616.4 | 4393.6 | 616.7 |

All entries are median nanoseconds per call. Node leads all nine FFI
cases in both modes. The candidate's JavaScript-only control uses
the same loop, accumulator, and indirect closure call with a constant
return value. It took 211.7 ns in the literal image,
209.0 ns in the runtime image, and 2.1 ns in
Node. The general compiler path has measurable overhead before the
FFI adapter runs. The parity test returned 2 for all three revisions.

## Main-thread profiles

PProfessor captured every engine and case at 997 Hz with 1.5 million
iterations per case. The raw captures were analyzed with
`pprofessor analyze --view summary`, `cumulative`, and `stacks`.
Inclusive frame groups overlap. Scalar captures include startup.
The Buffer and callback captures start at the first C call and stop
at `dlclose`. The initial literal Buffer capture stalled in dyld's
debugger notification during `dlopen`. Its profile is recorded
separately from the workload samples.

- At arity 0, the baseline runtime frame path appeared on 294 of 705
  sampled stacks. The literal path showed 92 of 434 stacks in general
  lexical lookup and just one at the C benchmark entry. The direct
  numeric adapter still runs inside public JavaScript call dispatch.
- The literal Buffer baseline had BigInt routines on 812 of 2,244
  stacks and pointer extraction on 413. The candidate writes exact
  address words and offsets into the frame, retains the backing, and
  reuses stable storage. Owned movable storage still promotes once
  under the existing lending policy.
- In the literal callback baseline, BigInt routines appeared on
  2,523 of 4,490 stacks. The rooted transition appeared on 2,095
  stacks and callback dispatch on 2,036. The candidate uses the
  registered native trampoline, cached capture views, and
  per-depth workspaces. Callback dispatch still checks registration
  and thread state and enters the realm with the actual arguments.

The measured gap leaves the parity target open. The JavaScript-only
control shows the cost of the current general call and loop lowering.
Further compiler and runtime work is needed to reach parity.

[Rounds, checksums, and profile counts](node-ffi-benchmark-darwin-arm64-cf6faaf6b-v3.json)
