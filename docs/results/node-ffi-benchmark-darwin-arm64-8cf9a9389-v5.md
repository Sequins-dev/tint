# Node FFI timing after merged-head validation

The replay used the same Node 26.13.1 binary, DSO, source, and two
manifest-verified Tint images from `8cf9a9389a59a4a59f2d02e7c7219635636a687f`.
Nine rounds rotated order under the shared timing lock. Each case
verified its checksum after 20,000 warmups and 100,000 measured calls.
All 270 samples were complete. LLDB confirmed entry and exit 42
for all 18 Tint launches.

| Case | Node | Tint literal | Tint runtime |
| --- | ---: | ---: | ---: |
| arity-0 | 10.5 | 315.3 | 337.0 |
| arity-1 | 17.0 | 353.7 | 377.0 |
| arity-2 | 26.9 | 388.7 | 418.4 |
| arity-4 | 139.4 | 442.0 | 492.9 |
| arity-8 | 117.3 | 545.2 | 629.8 |
| arity-12 | 172.1 | 649.1 | 776.1 |
| arity-24 | 314.3 | 957.3 | 1195.9 |
| buffer | 69.7 | 403.8 | 415.5 |
| callback | 95.0 | 623.2 | 634.1 |

Values are median nanoseconds per call. Node led every case in
both modes. The parity check exited 2. The JavaScript-only control
measured 2.4 ns in Node,
214.2 ns in Tint literal, and
215.9 ns in Tint runtime.

The Tint validation runs had completed. Other local work remained active.
Sampled CPU idle was 82.45–84.44% immediately before the replay and
58.90–89.92% during it, including the replay workload, with a median
of 84.71%. One-minute load moved from 5.38 to
4.14. This replay does not establish quiet-machine
parity. The relative gap also remains in the earlier controlled runs.

The loop and dispatch control, the separate inline-call control, and
the [main-thread profiles](node-ffi-benchmark-darwin-arm64-cf6faaf6b-v3.md)
attribute much of the residual cost to the general JavaScript path.
Argument-list and loop prototypes improved some measurements. The
results do not establish an irreducible cost for any of the gaps.

The 25 pinned upstream files and the missing-build control yielded
94 passes, 25 diagnosed limits, and 3 upstream skips. The three
previous SharedArrayBuffer limits were the sole outcome changes.
Frozen v7 and the original FFI leaf binary matched the merged main
byte for byte. The 200-form Linux arm64 ledger found no regressions
against main. macOS stage images matched for all three stages,
and each Test262 smoke mode passed 2/2 with LLDB case and admission
launches. The standalone macOS gate timed out in the native test
batch. The self-build and smokes ran independently afterward.

[Raw replay](node-ffi-benchmark-darwin-arm64-8cf9a9389-v5.json) has
SHA-256 `c8534b425aa95ea6168c1f0856fe8c6ccfcef23fd0baad8392a7b3aa95c8656c`.
[Full pinned suite](node-ffi-v26.13.1-darwin-arm64-8cf9a9389-v5.json).
