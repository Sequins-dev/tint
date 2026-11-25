# Node FFI benchmark after call frame reuse

Tint `1fa3e29bbc5f61b9cc8d635d7711a840eba6657c` and Node v26.13.1 ran the same C library and call
workload on an Apple M5 Max. The cases used five rounds of 5,000 calls after
1,000 warmup calls. All 135 measurements verified their result checksums.
LLDB confirmed entry and exit 42 for both Tint images.

Node used the default public `node:ffi` API. Tint literal definitions
selected specialized calls. Tint runtime definitions selected dynamically
classified calls. Other builds ran on the shared Mac during this comparison.

| Case     | Node ns/call | Tint literal ns/call | Tint runtime ns/call |
| -------- | -----------: | -------------------: | -------------------: |
| arity-0  |           73 |                  774 |                 1209 |
| arity-1  |          253 |                  831 |                 1432 |
| arity-2  |          206 |                 1044 |                 1691 |
| arity-4  |          307 |                 1327 |                 2019 |
| arity-8  |          349 |                 2124 |                 2746 |
| arity-12 |          429 |                 2681 |                 3410 |
| arity-24 |          750 |                 3647 |                 5224 |
| buffer   |          151 |                 5160 |                 2493 |
| callback |          267 |                10382 |                 8651 |

The specialized Tint call had lower median latency at all seven scalar
arities. The retained frame lowered the median callback time from 20.9 to
10.4 µs in the literal image and from 18.8 to 8.7 µs in the runtime image.
Node had the lowest median for every case. The separate rounds and timing
checksums are in the [first report](node-ffi-benchmark-darwin-arm64-f40ca39a0-v1.md)
and the [current observations](node-ffi-benchmark-darwin-arm64-1fa3e29bb-v2.json).

## Existing leaf and typed compiler output

The leaf microbenchmark compared the main baseline `b99b1e3f0` with the
stream's new implementation. LLDB confirmed entry and exit 42 for the two
byte-identical images. Both images had SHA-256
`9100616df7d3978a91d1dd21f89b562aa261b4faca907d59588461fcb8868753`.
Each did 10 million direct `getpid` calls. The measured rates were 2.46 and
2.10 ns/call. The 64-byte CommonCrypto calls measured 37.43 and 37.12
ns/call with matching checksums.

The frozen v7 toolchain comparison used main `b99b1e3f0` and the stream's
static FFI code. Both `--runtime-tree` builds initially failed with
`missing export: nativeAllocatorShutdownRequest`. Adding the same
`--tree packages/abi/src/host.ts` overlay to both builds provided the
current runtime ABI. The baseline and stream copies of that ABI file were
byte-identical. The benchmark compiler images had identical executable
sections and differed in debug path data. Their emitted v7 images compared
byte for byte and shared SHA-256
`68c11052966f4a851b875c23b6a3413abc74262cec1460532dba09c624d17846`.

| Round |     Main cycles |   Stream cycles | Main s | Stream s |
| ----- | --------------: | --------------: | -----: | -------: |
| 1     | 404,613,102,496 | 396,258,726,462 | 261.50 |   158.06 |
| 2     | 397,499,874,529 | 396,092,120,867 | 175.18 |   152.62 |
| 3     | 393,451,789,953 | 394,053,600,234 | 150.06 |   152.71 |
