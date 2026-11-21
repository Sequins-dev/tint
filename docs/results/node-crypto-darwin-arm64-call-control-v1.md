# General method-call control on macOS arm64

A native untyped fixture compared `counter.advance(i)` with the same
addition written inline as `i + 1`. `counter.advance` has one argument
and returns `i + 1`. Both loops ran 100,000 iterations, checked the same
arithmetic-series checksum and used Tint's monotonic clock. After warmup,
seven pairs alternated the order under the timing and gate locks. LLDB
observed the entry stop and exit 42.

| Pair | Inline (ns) | Method (ns) | Difference (ns) |
| ---: | ----------: | ----------: | --------------: |
|    1 |      330.26 |      658.74 |          328.48 |
|    2 |      342.82 |      650.66 |          307.85 |
|    3 |      336.94 |      754.19 |          417.25 |
|    4 |      343.24 |      665.03 |          321.79 |
|    5 |      369.70 |      723.23 |          353.52 |
|    6 |      356.85 |      725.05 |          368.20 |
|    7 |      361.63 |      766.48 |          404.85 |

The median paired difference was **353.52 ns per iteration**. This
control includes property lookup and invocation. Three times this
difference is about 1.06 μs. The baseline public 64-byte hash and HMAC
operations took roughly 9–12 μs per operation in the first pair, so the
control leaves most of the observed cost to investigate.
[Public benchmark baseline](node-crypto-darwin-arm64-public-v1.json)

The build manifest records 828 files with source snapshot SHA-256
`942f7440943fdd1a2a4b3cb175614d8b065c5fe9a627ccecdd1a805b02d74c23`.
The native image SHA-256 was
`a9900eb3ff0b2c0e7576619fa58682eb9cb87978b77db166ea85facb6c764e79`.
