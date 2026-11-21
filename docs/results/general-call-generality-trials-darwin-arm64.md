# Fixed argument lists, numeric array keys and property cache trials

Node 26.13.1, the existing Tint runtime, and three successive candidates
ran in 25 rotated rounds on Darwin arm64. Each row reports the median of
matched round differences from its immediate predecessor in ns per
iteration. Every timed process checked the same warmup and measured
checksum. All native processes reached entry and exited 42 under LLDB.

| Change                                                          | Kernel           | Paired median Δ ns | Paired IQR Δ ns |
| --------------------------------------------------------------- | ---------------- | -----------------: | --------------: |
| Size the fixed argument list once                               | 3 arguments      |              −15.0 |  −18.2 to −12.3 |
|                                                                 | 4 arguments      |              −11.9 |   −13.5 to −6.8 |
|                                                                 | 5 arguments      |              −16.0 |  −18.6 to −12.2 |
|                                                                 | 6 arguments      |              −20.4 |  −23.8 to −17.5 |
| Read packed array elements directly for present numeric indices | Object array     |              −27.1 |  −27.8 to −25.7 |
|                                                                 | Allocate objects |              −24.8 |  −27.6 to −17.9 |
|                                                                 | 2 shapes         |              −21.1 |  −22.1 to −17.6 |
|                                                                 | 4 shapes         |              −26.7 |  −28.2 to −23.0 |
|                                                                 | 8 shapes         |              −28.8 |  −32.9 to −26.8 |
| Four-state property cache                                       | 2 shapes         |               −6.1 |    −8.4 to −4.2 |
|                                                                 | 4 shapes         |              +13.1 |  +10.5 to +15.0 |
|                                                                 | 8 shapes         |              +47.1 |  +45.9 to +50.0 |
|                                                                 | Object array     |              +91.8 |  +87.9 to +94.6 |

The fixed-list change removes repeated backing-list growth. The packed-array
read runs only for a present, nonnegative integer index with ordinary get
semantics. Holes, indexed accessors and proxies continue through property-key
conversion and ordinary dispatch. On missed cache entries the four-state
trial performed additional probes before generic lookup. Its two-shape
gain came with four-shape, eight-shape and monomorphic regressions, so this
version of the cache was dropped.

All three candidates were slower than Node on all 15 workloads. The
[raw report](general-call-generality-trials-darwin-arm64.json) retains
untouched engine timings, paired IQRs, load, checksums and image identities.
