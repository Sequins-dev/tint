# Word-at-a-time UTF-8 hash input on macOS arm64

The shared native encoder copies eight ASCII code units per block. NEON
checks the maximum lane and narrows the lanes to bytes. SSE2 checks the
high bits of every lane before packing the bytes. A block containing
Unicode returns to the scalar path, which can resume block copies in the
next ASCII run. Hash and HMAC feed OpenSSL one encoded 4 KiB scratch window
at a time. Buffer and TextEncoder use the same bounded writer.

## Paired timing

Apple M5 Max, Tint with Homebrew OpenSSL 3.6.4, and Node 26.13.1 with
OpenSSL 3.5.9. The typed `branded-slots` driver ran five pairs under
`tools/gate/with-lock.sh both`, alternating the runtime that ran first.
String cases used preallocated inputs of 64 or 1,024 UTF-8 bytes and
checked the digest before timing. Unicode inputs mixed Latin-1, BMP and
supplementary characters. The time columns are separate medians in
nanoseconds per operation. The final two columns use the median of the
individual Node/Tint ratios. [Scalar encoder results](node-crypto-darwin-arm64-utf8.md) ·
[Five paired rounds](node-crypto-darwin-arm64-utf8-simd-paired.json)

| Case | Tint ns/op | Node ns/op | Scalar paired Node/Tint | SIMD paired Node/Tint |
| --- | ---: | ---: | ---: | ---: |
| `sha256-64` | 273.7 | 402.6 | 1.480× | 1.479× |
| `sha512-64` | 262.2 | 318.5 | 1.259× | 1.252× |
| `sha512-string-ascii-64` | 277.2 | 348.3 | 1.090× | 1.256× |
| `sha512-string-unicode-64` | 295.1 | 353.5 | 0.878× | 1.198× |
| `sha512-string-ascii-1024` | 854.3 | 962.9 | 0.545× | 1.093× |
| `sha512-string-unicode-1024` | 1139.2 | 1257.9 | 0.415× | 1.100× |
| `hmac-sha256-64` | 403.1 | 946.3 | 2.403× | 2.385× |
| `hmac-sha512-64` | 556.2 | 979.4 | 1.762× | 1.776× |
| `sha256-1MiB` | 325079.4 | 330838.1 | 1.015× | 1.022× |
| `sha512-1MiB` | 576627.1 | 592031.2 | 0.994× | 1.026× |
| `random-32` | 246.8 | 309.2 | 1.161× | 1.253× |
| `random-4096` | 643.4 | 975.8 | 1.384× | 1.513× |

Tint won 12/12 on paired medians, and each string case won in all five
pairs. The measured image SHA-256 is
`30c4e7fc6bd17eed852face9369a1e7687d9a312617ed84585286cbb7fea04a8`.
The `98eb7af4b` sources produced a byte-identical image from an 831-file
snapshot with SHA-256
`7548c9f3dbc12ac6aa0629e566d79ceac6dcb09f29b38c018158d0dc237d5a1a`.

## Validation

Node and all three native targets passed 41/41 extracted case groups
with the same source ranges and exclusions. The ISA encoding tests
passed for NEON and SSE2, and native fixtures executed the generated
instructions on macOS arm64 and Linux x86-64. The fixtures checked
lengths 0–17, exact output around eight-unit and 4 KiB boundaries,
unpaired surrogates, and writes into guarded byte subviews.
[Extracted cases and exclusions](node-crypto-v26.13.1-extracted-v1.md)

The Linux arm64 gate passed with byte-identical stage 1, 2 and 3 images
at SHA-256
`017619d29ea708775aca3b057b68ca2cac78804bfdd8de786c7183027b6ecc21`.
The public timing comparison awaits PR #7.
