# UTF-8 hash input on macOS arm64

Tint's native strings use UTF-16 storage. The shared encoder reads code
units directly. An ASCII prefix copies to the destination with halfword
loads and byte stores on AArch64. The UTF-16 path emits UTF-8 directly
into the same destination, replacing unpaired surrogates. Hash and HMAC
reuse 4 KiB of isolate-local scratch and submit each written byte window
through the existing OpenSSL leaf routine. Chunk boundaries preserve
surrogate pairs. Owned Buffer and TextEncoder outputs use the same writer
after sizing their result.

## Paired time

Apple M5 Max with Homebrew OpenSSL 3.6.4 for Tint and Node 26.13.1 with
OpenSSL 3.5.9. The typed `branded-slots` driver ran five
pairs, alternating which runtime ran first under `tools/gate/with-lock.sh both`.
Each new case hashes a preallocated string with an exact UTF-8
payload of 64 or 1,024 bytes. Unicode inputs include Latin-1, BMP and
supplementary code points. The driver checks the digest before timing.
The ratio is the median of the individual Node/Tint ratios.

| Input | Tint before ns/op | Tint after ns/op | Node after ns/op | After paired Node/Tint |
| --- | ---: | ---: | ---: | ---: |
| 64-byte ASCII | 876 | 335 | 373 | 1.090× |
| 64-byte Unicode | 671 | 426 | 365 | 0.878× |
| 1 KiB ASCII | 10066 | 1769 | 941 | 0.545× |
| 1 KiB Unicode | 5856 | 3227 | 1287 | 0.415× |

| Typed case | Before paired Node/Tint | After paired Node/Tint |
| --- | ---: | ---: |
| `sha256-64` | 1.426× | 1.480× |
| `sha512-64` | 1.283× | 1.259× |
| `sha512-string-ascii-64` | 0.484× | 1.090× |
| `sha512-string-unicode-64` | 0.640× | 0.878× |
| `sha512-string-ascii-1024` | 0.104× | 0.545× |
| `sha512-string-unicode-1024` | 0.241× | 0.415× |
| `hmac-sha256-64` | 2.350× | 2.403× |
| `hmac-sha512-64` | 1.720× | 1.762× |
| `sha256-1MiB` | 1.021× | 1.015× |
| `sha512-1MiB` | 1.001× | 0.994× |
| `random-32` | 1.262× | 1.161× |
| `random-4096` | 1.536× | 1.384× |

All four string inputs improved. The 64-byte ASCII case won against Node.
Tint won 8/12 overall, including 7/8 byte-input and random cases.
The paired SHA-512 1 MiB ratio was 0.994× in this run.
Both captures contain 828 workspace source files.
Baseline SHA-256 `4b4b1b81bfde173af2a72eccc9754770a1326cbe859adc32d4c6eb4d36595e89`.
Final SHA-256 `3ada0451754ade0a08a5011435a491bbcce23e5265e08790e3acce5c1e5b82f4`.

## Native conformance

All 41 extracted groups passed on macOS arm64, Linux arm64 and Linux
x86-64. Linux arm64 used the shared dev machine. The focused x86-64 run
used the existing Debian VM under LLDB 19.1.7, with the pinned extractor
and case bodies unchanged. The shared native encoder fixture verified
resumption across surrogate pairs. Hash and HMAC also matched Node on a
string spanning three scratch windows with a supplementary character at
a boundary, embedded NUL, and unpaired surrogates.

The public-path timing remains pending PR #7.
