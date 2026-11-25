# Public node:crypto after PRs #9–#11 on macOS arm64

This report times the public `node:crypto` path and the typed crypto
module at `ad18eb3f8b3322d567d40eeff913375495af2bc7` on an Apple M5 Max.
Tint loaded Homebrew OpenSSL 3.6.4. The reference was Node 26.13.1 with
OpenSSL 3.5.9. Each of 15 rounds ran every variant once, in an order that
rotated each round, under `tools/gate/with-lock.sh both`. Every native run
asserted the LLDB entry stop and exit status 42. The host's 1-minute load
was 9.7–12.0 at round starts and is recorded per round.
[Raw rounds and image digests](node-crypto-darwin-arm64-public-v4.json)

## Variants

- **Public:** the stock `node:crypto` import in an untyped program
  (`node tools/node-crypto-microbench.ts build public`).
- **Typed:** the typed crypto module with canonical Buffer results read
  through typed storage (`build branded-slots`).
- **Tint control:** the public image with `createHash`, `createHmac` and
  `randomBytes` returning prebuilt results. It keeps the synthetic module
  exports, the builtin wrappers, prototype `update` and `digest` builtins
  and the result length read. [Control patch](node-crypto-darwin-arm64-public-v4-control.patch)
- **Node control:** a plain class with the same call shapes and prebuilt
  results.

Short cases run 100,000 iterations (20,000 for 1 KiB strings, 250,000 and
50,000 for random bytes) after a quarter-length warmup. At the previous
20,000-iteration counts, a copying collection could land in one case and
not the next. At `7f55de93f` the four 64-byte public cases ranged from 1,129
to 1,588 ns, and ASCII strings measured 220 ns slower than mixed Unicode.
With the longer cases, the four agree within 70 ns.

## Results

Times are medians in nanoseconds per operation. Ratios are paired medians
of Node/Tint with the interquartile range. The adjusted ratio is
(Node − Node control) / (public − Tint control) within each round.

| Case                         |     Node |    Typed |   Public | Tint control | Node control |   Typed Node/Tint | Adjusted Node/Tint |
| ---------------------------- | -------: | -------: | -------: | -----------: | -----------: | ----------------: | -----------------: |
| `sha256-64`                  |    414.1 |    242.2 |   1184.1 |        442.4 |         14.9 | 1.72× (1.60–1.83) |  0.52× (0.49–0.58) |
| `sha512-64`                  |    451.9 |    358.4 |   1153.7 |        438.3 |         13.2 | 1.32× (1.18–1.36) |  0.61× (0.57–0.69) |
| `sha512-string-ascii-64`     |    481.1 |    373.3 |   1179.1 |        372.4 |         11.9 | 1.30× (1.17–1.41) |  0.59× (0.53–0.65) |
| `sha512-string-unicode-64`   |    505.6 |    409.5 |   1221.9 |        380.5 |         12.3 | 1.23× (1.17–1.40) |  0.58× (0.55–0.63) |
| `sha512-string-ascii-1024`   |   1274.6 |   1083.3 |   2064.9 |        546.2 |         27.3 | 1.18× (1.04–1.23) |  0.83× (0.76–0.90) |
| `sha512-string-unicode-1024` |   1801.3 |   1586.3 |   2388.9 |        372.3 |         25.9 | 1.09× (1.06–1.15) |  0.86× (0.81–0.94) |
| `hmac-sha256-64`             |   1245.7 |    493.2 |   1311.1 |        425.4 |          9.4 | 2.62× (2.39–2.87) |  1.39× (1.30–1.48) |
| `hmac-sha512-64`             |   1449.9 |    791.3 |   1641.8 |        436.3 |         11.0 | 1.90× (1.75–1.98) |  1.19× (1.08–1.24) |
| `sha256-1MiB`                | 449210.4 | 416457.0 | 452939.5 |        428.2 |         32.4 | 1.07× (0.98–1.15) |  0.96× (0.93–1.04) |
| `sha512-1MiB`                | 772723.0 | 721904.0 | 771720.7 |        411.0 |         31.1 | 1.07× (1.00–1.13) |  1.01× (0.94–1.04) |
| `random-32`                  |    451.7 |    313.5 |   1072.5 |        628.5 |          8.1 | 1.50× (1.35–1.56) |  1.02× (0.88–1.14) |
| `random-4096`                |   1307.1 |    872.7 |   1758.0 |        625.0 |         16.4 | 1.49× (1.37–1.64) |  1.09× (1.01–1.25) |

The typed module beat Node in **12/12** cases. The public path beat Node
end to end only for SHA-512 at 1 MiB (1/12). After subtracting each runtime's control, it won
**5/12**: both HMAC cases, both random sizes and SHA-512 at 1 MiB. The
64-byte hashes measured 0.52–0.61× and the 1 KiB strings 0.83–0.86×.
SHA-256 at 1 MiB was at parity on its quartiles.

The untyped control itself cost 372–628 ns, against 8–32 ns for Node's
control. That is the general path's cost for the builtin calls and the
result length read, which is outside crypto. The adjusted residual is crypto's own public cost:
about 740 ns for SHA-256 at 64 bytes, against Node's 400 ns. The typed
module does the same digest work in 242 ns, including its loop.

## Changes measured since the post-#7 rerun

An unfinished five-round rerun after the PR #7 merge measured the adjusted
short-hash ratios at 0.29–0.36×. It is superseded by this report and was
not recorded. Since then:

- Hash and Hmac objects hold their `DigestLifetime` in a private field read
  through a compiler-bound record view. This replaces a callable state
  object and closure per hash.
- Digest prototypes are cached per isolate, and algorithm names are
  checked in place instead of being lowercased one character at a time.
- SHA-256-sized digests use a fixed-arity hexadecimal encoder. Typed
  SHA-256 at 64 bytes moved from 1.48× Node in the
  [UTF-8 report](node-crypto-darwin-arm64-utf8-simd.md) to 1.72×.
- Ordinary in-bounds typed arrays lend their bytes without a range record.
- Weak owner slots are created only for digests still open when the next
  digest starts. Finished digests no longer leave weak slots for later
  collections.

A diagnostic stage driver ran nine rotated rounds of 20,000 iterations
per stage. The variants were: all of the above with the Buffer prototype
cache but before deferral, the same without the cache, with deferral, and
with deferral plus a one-step branded-object factory. Medians in
nanoseconds:

| Stage         | Before deferral | Deferred weak slots | Without Buffer cache | Branded factory | Tint control | Node |
| ------------- | --------------: | ------------------: | -------------------: | --------------: | -----------: | ---: |
| `full-hex`    |             958 |                 814 |                  886 |             805 |          346 |  662 |
| `full-buffer` |            1810 |                1668 |                 1788 |            1576 |          314 |  519 |
| `string-64`   |            1017 |                 918 |                 1008 |             945 |          344 |  426 |
| `random-32`   |            1138 |                 860 |                 1153 |             873 |          478 |  403 |
| `hmac-full`   |             964 |                 944 |                  971 |             942 |          348 | 1190 |

Deferral cut 99–278 ns from the hash, Buffer-result, string and random
stages and 20 ns from HMAC. The Buffer prototype cache won
7 of 9 `random-32` pairs, with a paired median of 1.05×. The branded
factory's paired medians were 0.97–1.01×, so it was reverted.
[Stage rounds](node-crypto-darwin-arm64-wrapper-ab-v1.json)

## Where the public cost remains

PProfessor sampled the main thread at 999 Hz while a symbolized public
image ran 3,000,000 SHA-256 64-byte operations. That image predates weak
slot deferral but otherwise matches this wrapper. It ran at 1,340 ns per
operation under sampling and collected 2,610 samples. Inclusive shares
of sampled time:

| Frames                                                                       | Share |
| ---------------------------------------------------------------------------- | ----: |
| `digest` builtin, including OpenSSL finalization and hexadecimal output      | 21.3% |
| `createHash` builtin, including validation, `openDigest` and the Hash object | 18.2% |
| `update` builtin, including the borrowed input and `EVP_DigestUpdate`        |  9.2% |
| Builtin argument lists, including collections triggered there                |  9.1% |
| Copying collection (inclusive, across allocation sites)                      |  8.2% |

Within these, the Hash object's ordinary-object allocation and private
field took 6.4%, and the SHA-256 hexadecimal string took 8.1%. OpenSSL's
final block and context reset took 4.4%. The remaining time was the
general call path that the control also pays.

Two structural costs sit outside the crypto module. Every ordinary realm
object, including each Hash, allocates a record of about 70 internal
slots plus a property map. The arm64 crypto images run the copying
collector, because the generational mutator rejects their raw memory
capabilities (`generational mutator requires tracked managed writes`).
Each collection there copies the whole live realm. Linux x86-64 crypto
images already use the generational collector. The typed module allocates
no realm objects for a digest.

## TextEncoder and Buffer.from

TextEncoder runs in typed code. The main image was built from
`3d10cb5c0`. The branch images were built from `0eee92614` with the Buffer
prototype cache, whose encoder and Buffer sources match `ad18eb3f8`.
`Buffer.from(string)` exists only on this branch, so Node is its
reference. Fifteen rotated rounds ran under both locks.
[Raw rounds](node-crypto-darwin-arm64-encoding-v1.json)

| Case                | Main ns | Branch ns | Node ns | Main/branch (IQR) | Node/branch (IQR) |
| ------------------- | ------: | --------: | ------: | ----------------: | ----------------: |
| `text-ascii-16`     |   233.3 |      46.5 |   334.4 | 4.75× (4.26–5.15) | 6.83× (6.55–8.10) |
| `text-unicode-16`   |   169.8 |      51.8 |   327.8 | 3.11× (2.89–3.56) | 7.00× (5.51–7.37) |
| `text-ascii-64`     |   847.5 |     126.1 |   328.3 | 6.72× (6.09–7.44) | 2.91× (2.42–3.24) |
| `text-unicode-64`   |   581.7 |     148.7 |   357.2 | 3.71× (3.52–4.22) | 2.31× (2.15–2.61) |
| `text-ascii-1024`   | 13036.8 |    1750.3 |   395.7 | 7.38× (6.29–7.86) | 0.22× (0.20–0.25) |
| `text-unicode-1024` |  7482.4 |    1624.8 |   887.2 | 4.46× (4.29–4.85) | 0.53× (0.50–0.65) |

| Case                  | Branch ns | Node ns |    Node/branch (IQR) |
| --------------------- | --------: | ------: | -------------------: |
| `buffer-ascii-16`     |    1654.1 |   174.4 | 0.100× (0.096–0.107) |
| `buffer-unicode-16`   |    1693.3 |   156.9 | 0.087× (0.081–0.095) |
| `buffer-ascii-64`     |    1850.0 |   109.3 | 0.059× (0.054–0.068) |
| `buffer-unicode-64`   |    1786.0 |   165.8 | 0.096× (0.081–0.098) |
| `buffer-ascii-1024`   |    4545.5 |   246.8 | 0.057× (0.051–0.064) |
| `buffer-unicode-1024` |    3330.1 |   791.1 | 0.229× (0.215–0.243) |

TextEncoder is 3.1–7.4× faster than on main, with no regression.
`Buffer.from(string)` costs 1.65–4.5 μs against Node's 0.11–0.79 μs. Most of
that cost is outside the encoder: the untyped builtin call and the
ArrayBuffer and Buffer objects each result adopts.

## Frozen v7 workload

The frozen v7 compiler source, with the matched runtime tree used for the
post-#7 comparison, compiled to byte-identical images with main's
`3d10cb5c0` toolchain and with `ad18eb3f8`. Both images had SHA-256
`57e419f660bd9efccbf3ebee6fa6354fe92976a7f09525568800ddf7a41943f4`, the
same digest the post-#7 comparison recorded. The branch therefore changes
no generated code in that workload.
