# Four-unit UTF-16 native kernels

Equality, startsWith, concatenation and slicing process four UTF-16 units per
64-bit load/store while at least four units remain, then use the existing
one-unit tail. The full-word guard prevents overreading even for two-byte-offset
startsWith sources. NUL and lone surrogates remain ordinary code units. Copies
write only into fresh allocations. No allocation or call is added; register
clobbers and destination/count preservation match the existing helper contract.

| Four alternating pairs | Before CPU ms: median (range) | After CPU ms: median (range) | CPU ratio | Fewer instructions | Fewer cycles |
| --- | ---: | ---: | ---: | ---: | ---: |
| short | 14.420 (12.641–15.290) | 12.688 (11.799–14.076) | 1.136x | 1.46% | -5.51% |
| long | 139.150 (121.935–144.509) | 29.974 (29.015–31.234) | 4.642x | 71.09% | 80.43% |
| copy | 46.606 (43.914–50.886) | 17.869 (16.760–19.890) | 2.608x | 67.87% | 63.09% |

The short workload's cycle median regresses despite its lower CPU median; its
small duration and final unobserved CPU bound prevent claiming a strong short
string win. The long equality workload compares separate 128-unit allocations
2M times; copying does 100K concatenation/slice iterations and verifies content.
[Raw evidence](native-string-word-kernels-throughput-v1.json) retains every CPU/instruction/cycle observation,
wall time, range, load and missing-CPU bound. CPU excludes LLDB launch. All 32
isolated fixture/benchmark inferiors stop initially and exit 42. The stronger
current-main fixture also checks each copied unit against its source and again
after allocation churn; it is retained in the integration report.

The before/after native compiler CPU medians across both execution orders are
293.419 s (288.352–298.485)
and 253.811 s (246.564–261.058),
ratio 1.156x. Retired instructions change
-0.136%; cycle medians change
-6.181%. Frequency/phase effects
remain possible; operation instruction reductions provide independent evidence.
All four native executions exit 0, and stage 2 matches candidate stage 1:
53,745,666 bytes, SHA-256
`7345e5df39459e764fbf6acf0632d89e468674c112b71c9f0bfd748569fa3fae`.
Signature/DWARF checks pass. Source68 is identical for both compilers; sealed
control69 reproduces the complete baseline image byte for byte.

Static disassembly changes the steady equality loop from 32 instructions per
four units to nine, and copying from 24 to seven. Larger static helper bodies
retain scalar tails: equality 24→35 instructions, startsWith 37→48,
slice-copy 18→26, concat-copy 33→49. All remain leaf helpers with zero calls.
The 313 focused codegen tests pass. The fresh full gate, current-main frozen
self-build and canonical nine-case equivalence are recorded separately in the
[current-main integration](native-generated-code-integration-v1.md), which
includes both this code and reference-helper inlining in the same READY range.

No whole-suite speedup or hours saving is extrapolated from these selected
workloads. Batch compilation is Node-hosted; historical journal projections
measure a different path. All raw source/toolchain identities, adapters,
benchmark sources, failed/preparation observations and counters are immutable
compressed assets with an uncompressed SHA-256 index in the JSON report.
