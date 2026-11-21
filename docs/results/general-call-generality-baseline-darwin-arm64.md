# Untyped call and loop generality on Darwin arm64

All 15 broader kernels were slower than Node 26.13.1 at Tint revision
`6ee7418e1fb1e409fb76b92bcf9ad444c00a3b0d`. Every paired IQR was above zero.
The gap was 10.2× to 73.7× by the ratio of medians. The previously measured
closed numeric kernels exercise a separate fast path.

## Paired timings and instruction traces

The Apple M5 Max runs used 24 rotated pairs. Each fresh process verified the
20,000-iteration warmup and the 100,000-iteration measured result. The timing
lock covered the comparison. Every native timing launch reached entry and
exited 42 under LLDB. The timed region covers only the kernel call. CPU idle
and load measurements are retained for each launch.

LLDB instruction stepping used the same Tint debug image as the timing run
(`193194678d1bbd9452ec9bf652c57c90c59e4e72a28cdc8c10e4af615639f32d`).
Each window starts at the loop comparison and ends at its next execution at
the same stack pointer. The debugger verified the induction variable and
bound in the floating-point compare operands. Allocation counts and bytes
come from executed managed bump-pointer updates, including those in called
functions. The receiver traces cover every shape, `mixedCall` covers all
three value tags, `buildString` includes the flush iteration, and
`catchInLoop` includes a throw and a normal return.

| Kernel               | Node ns | Tint ns |  Paired IQR Δ ns | Retired instructions | Allocations |   Bytes |
| -------------------- | ------: | ------: | ---------------: | -------------------: | ----------: | ------: |
| `allocateObjects`    |    8.69 |  609.70 | 567.55 to 714.49 |                13646 |          30 |    2104 |
| `arguments3`         |    3.05 |  184.00 | 172.54 to 216.11 |                 4614 |          11 |     360 |
| `arguments4`         |    2.97 |  202.69 | 188.29 to 228.59 |                 5173 |          12 |     384 |
| `arguments5`         |    3.24 |  230.36 | 207.26 to 269.06 |                 5926 |          14 |     496 |
| `arguments6`         |    3.53 |  260.20 | 233.94 to 310.33 |                 6485 |          15 |     520 |
| `buildString`        |   13.35 |  136.00 | 108.10 to 141.77 |            2916–8580 |        9–24 | 328–808 |
| `catchInLoop`        |    4.37 |   72.82 |   59.64 to 78.07 |            1986–2811 |         0–1 |    0–40 |
| `concatenateStrings` |    9.54 |  154.31 | 130.01 to 166.93 |            4061–4065 |          11 |     376 |
| `mixedCall`          |    5.01 |  138.51 | 118.57 to 156.63 |            2627–4241 |         1–3 |  40–120 |
| `mutableCapture`     |    7.98 |  100.12 |  82.57 to 106.90 |            2614–2615 |           1 |      40 |
| `objectArray`        |    3.12 |  113.71 |  96.22 to 128.37 |                 2551 |           1 |      40 |
| `objectRoundTrip`    |    2.81 |  120.79 | 106.94 to 139.45 |                 3414 |           1 |      40 |
| `receivers2`         |    6.73 |  199.19 | 164.48 to 217.31 |            4572–4843 |         3–5 |  96–144 |
| `receivers4`         |    6.85 |  212.40 | 171.40 to 223.77 |            4570–4841 |         3–5 |  96–144 |
| `receivers8`         |    7.81 |  218.86 | 176.90 to 228.54 |            4563–4838 |         3–5 |  96–144 |

[Raw paired rounds](general-call-generality-baseline-darwin-arm64.json),
[per-window allocation PCs and executed function counts](general-call-generality-baseline-traces-darwin-arm64.jsonl),
[kernel sources](../../tools/general-call-bench/generality.ts).

The first debugger run targeted an unused comparison branch. The successor
run collected the three receiver kernels and then encountered an earlier
kernel's breakpoint after the inferior had exited. The final run collected
the other 12 kernels, verified all checksums, and verified exit 42.

## What the misses cost

- The 2-, 4-, and 8-shape sites retain ordinary positional method dispatch.
  The receiver field and method reads together retire 677–733 instructions
  inside `lookupCachedScriptProperty` in the 2-shape sample. Changing the
  receiver layout replaces the site's sole cache entry and allocates a new
  shape chain. Array element selection also formats the numeric key, parses
  it back, and walks ordinary get dispatch to reach packed backing storage.
- At three arguments, seven allocations totaling 224 B build and grow the
  list, and four more totaling 136 B enter through `callObject`. At six
  arguments, append/write machinery alone retires 1,622 instructions. The
  call target remains an ordinary known receiver property in each lane.
- The 600 B ordinary object is only one of 30 allocations in the retained
  allocation kernel. Property-table creation, two descriptor installation
  sequences, cache/layout population and numeric array keys add 1,504 B.
  The existing object identity round trip avoids these constructions but
  still pays the source-call wrapper, property-cache accesses, and one 40 B
  allocation while comparing the returned identity.
- The mutable closure uses the positional entry and updates its capture.
  `enterSourceCall`, `exitSourceCall`, and the named frame remain. String
  length lookup goes through the general value/property path. The mixed
  site also stays on the positional entry for all three tags. Its string
  and undefined lanes execute additional value-category dispatch.
- Both string kernels go through `coercedBinaryOperation` and
  `primitiveValue` twice before concatenation. Building a string also calls
  `charAt` every 16 iterations. The trace counts the 2,916-instruction
  append-only lane and the 8,580-instruction append-and-flush lane separately.
- The ordinary catch-loop lane takes the positional source-call path with
  zero allocations. The thrown-number lane allocates 40 B and retires 825
  more instructions. Even the normal lane still enters and exits the source
  call context.
- The object-array site uses two property caches. The observed 40 B
  allocation occurs on the numeric-to-string property-key path. This trace
  exhibits the cost of the steady-state lookup without a shape change.
