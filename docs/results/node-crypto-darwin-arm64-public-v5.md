# Public and typed `node:crypto` on top of PRs #12, #18 and #42 (macOS arm64)

This report re-measures the typed and public (`node:crypto`) crypto benchmarks
and the `TextEncoder` / `Buffer.from(string)` no-regression check at
`b95deece5` on an Apple M5 Max after merging `origin/main` (`c0d6fe1d1`), which
brought in:

- **PR #42** (generational-only GC — copying collector removed for arm64
  images),
- **PR #18** (canonical one-byte / sliced strings and native UTF-8/Latin-1 bulk
  primitives), and
- **PR #12** (compact ordinary objects with lazy exotic/rare slots, inline
  property caches, and register-argument calls).

Tint loaded Homebrew OpenSSL 3.6.4 (`/opt/homebrew/opt/openssl@3/lib/libcrypto.3.dylib`).
The reference was Node 26.13.1 (`/opt/homebrew/bin/node`) with OpenSSL 4.1.0.
Each of 15 crypto rounds ran every variant once in rotated order under
`tools/gate/with-lock.sh both` (`TZ=UTC`). Every native run asserted the LLDB
entry stop and exit status 42. Host 1-minute load was 6.3–22.1 at round starts
and is recorded per round.
[Raw crypto rounds](node-crypto-darwin-arm64-public-v5.json) ·
[Control patch](node-crypto-darwin-arm64-public-v5-control.patch) ·
[Raw encoding rounds](node-crypto-darwin-arm64-encoding-v2.json)

## Image digests

- **Typed (`branded-slots`):** `53f579bd5a8010c69e6b8b7a601bda95589284bc098e6578fd2501aae270ab79`
- **Public (`node:crypto`):** `4cc081a13ae42947b742e4dfa6ff14566631ba93cb7eabb656872af8f392f103`
- **Tint control:** `dde4209e40efd65e9dc011380bc6da132b6d259bec5d769acd2aa921c46ccd21`
- **TextEncoder (`encodeUTF8`):** `d526ffad2e74a14761f1bc1537588ba713c479b8866646186ddf8fe77bedc962`
- **Buffer (`Buffer.from(string)`):** `2675157afcf370873e043f6d04c45b7ccfcc0c58221466b4723b71a790325b72`

## `node:crypto` results (15 rotated rounds)

Times are medians in nanoseconds per operation. Ratios are paired medians of
Node/Tint with the interquartile range (Q1–Q3). The adjusted ratio is
`(Node − Node control) / (Public − Tint control)` within each round.

| Case | Node | Typed | Public | Tint control | Node control | Typed Node/Tint | Public Node/Tint | Adjusted Node/Tint |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `sha256-64` | 367.5 | 208.8 | 504.8 | 194.4 | 12.3 | 1.59× (1.51–1.83) | 0.70× (0.65–0.74) | 1.04× (0.96–1.23) |
| `sha512-64` | 452.7 | 336.8 | 643.5 | 179.2 | 11.2 | 1.30× (1.18–1.41) | 0.65× (0.61–0.70) | 0.87× (0.78–0.95) |
| `sha512-string-ascii-64` | 470.8 | 351.8 | 645.7 | 177.6 | 10.9 | 1.25× (1.20–1.41) | 0.69× (0.64–0.72) | 0.95× (0.83–0.98) |
| `sha512-string-unicode-64` | 478.9 | 356.3 | 702.5 | 176.6 | 10.9 | 1.24× (1.16–1.32) | 0.68× (0.65–0.72) | 0.90× (0.84–0.96) |
| `sha512-string-ascii-1024` | 1266.3 | 1006.4 | 1361.6 | 184.4 | 24.0 | 1.18× (1.10–1.32) | 0.88× (0.86–0.94) | 1.00× (0.96–1.07) |
| `sha512-string-unicode-1024` | 1665.9 | 1326.2 | 1700.4 | 179.0 | 23.5 | 1.27× (1.16–1.31) | 0.96× (0.92–1.01) | 1.05× (1.00–1.12) |
| `hmac-sha256-64` | 881.1 | 411.7 | 740.2 | 195.6 | 9.2 | 2.01× (1.89–2.14) | 1.09× (1.03–1.22) | 1.46× (1.35–1.58) |
| `hmac-sha512-64` | 1068.9 | 694.7 | 1023.9 | 192.2 | 10.9 | 1.44× (1.38–1.61) | 0.97× (0.94–1.05) | 1.16× (1.13–1.27) |
| `sha256-1MiB` | 409126.0 | 377348.0 | 407024.6 | 196.6 | 31.7 | 1.00× (0.96–1.11) | 0.97× (0.95–1.03) | 0.97× (0.95–1.03) |
| `sha512-1MiB` | 718344.1 | 666678.7 | 694385.4 | 189.1 | 26.5 | 1.00× (0.98–1.10) | 0.98× (0.93–1.05) | 0.98× (0.93–1.05) |
| `random-32` | 342.1 | 253.9 | 672.4 | 363.3 | 7.3 | 1.26× (1.23–1.44) | 0.50× (0.48–0.55) | 1.04× (0.91–1.20) |
| `random-4096` | 1004.5 | 717.6 | 1166.6 | 362.8 | 14.4 | 1.25× (1.21–1.36) | 0.78× (0.74–0.84) | 1.13× (1.05–1.23) |

### Summary vs v4 (`ad18eb3f8`)

- **Typed module:** 12/12 at or faster than Node 26.13.1 (1.18–2.01× on the 10
  non-1MiB cases; 1.00× paired median with lower raw medians on 1 MiB OpenSSL
  streaming, against Node's OpenSSL 4.1.0).
- **Public (`node:crypto`) raw time:** 1.7–2.4× faster than v4 on every short
  case (`sha256-64`: 1,184 → 505 ns; `sha512-64`: 1,154 → 644 ns;
  `sha512-string-ascii-64`: 1,179 → 646 ns; `sha512-string-unicode-64`:
  1,222 → 703 ns; `hmac-sha256-64`: 1,311 → 740 ns, beating Node end-to-end at
  1.09×; `random-32`: 1,073 → 672 ns).
- **Tint control:** dropped from 372–628 ns (v4) to 177–363 ns (v5).
- **Control-adjusted ratios:** improved from 0.52–0.61× (v4) on 64-byte hashes
  to **0.87–1.04×** (`sha256-64`: **1.04×**, `sha512-string-ascii-64`: **0.95×**,
  `sha512-string-unicode-64`: **0.90×**, `sha512-64`: **0.87×**), and from
  0.83–0.86× on 1 KiB strings to **1.00–1.05×** (`sha512-string-ascii-1024`:
  **1.00×**, `sha512-string-unicode-1024`: **1.05×**). HMAC and `randomBytes`
  improved further (**1.04–1.46×**).

### What changed on top of PRs #12, #18 and #42

1. Replaced PR #6's pre-#18 `utf8-window` host operation (which assumed flat
   2-byte UTF-16 strings) with PR #18's canonical one-byte/sliced string UTF-8
   and Latin-1 primitives (`asciiEndOfText`, `copyLatin1`, `writeUTF8Bytes`).
2. Added `written?: true` on IR `string-write-utf8` (`writeUTF8Bytes`, flag bit
   2 on opcode 95, implemented on both AArch64 and x86-64) so `updateString`
   encodes mixed Unicode strings in a single native pass without a second
   `utf8ByteLength` scan, and avoided re-entering the 8-unit vector check after
   every non-ASCII scalar in `aarch64/scalar/strings.ts`. This cut typed
   `sha512-string-unicode-1024` from ~1.60 µs (0.82×) to 1.33 µs (1.27× Node).
3. Attached `builtinRegisterFunction` (`internalRegisterCall`) to the hot 0–2
   argument `node:crypto` builtins (`createHash`, `createHmac`, `randomBytes`,
   `Hash.prototype.update`, `Hash.prototype.digest`, `Hmac.prototype.digest`)
   and stored `DigestLifetime` directly on `OrdinaryRareSlots.internalCryptoDigest`
   instead of allocating a `PrivateElement[]` array and element record per hash.

## `TextEncoder` and `Buffer.from(string)` no-regression check (10 rotated rounds)

| Case | Branch (ns) | Node (ns) | Node/Branch (IQR) |
| --- | ---: | ---: | ---: |
| `text-ascii-16` | 12.5 | 172.6 | 13.47× (12.48–16.87) |
| `text-unicode-16` | 25.9 | 185.2 | 7.83× (7.24–8.76) |
| `text-ascii-64` | 11.8 | 168.2 | 14.79× (13.27–17.66) |
| `text-unicode-64` | 61.9 | 193.6 | 3.48× (3.00–3.59) |
| `text-ascii-1024` | 75.1 | 273.3 | 3.35× (2.99–4.28) |
| `text-unicode-1024` | 730.0 | 683.7 | 0.97× (0.88–1.12) |
| `buffer-ascii-16` | 480.9 | 55.0 | 0.11× (0.10–0.13) |
| `buffer-unicode-16` | 501.8 | 89.7 | 0.17× (0.16–0.20) |
| `buffer-ascii-64` | 472.7 | 67.8 | 0.14× (0.14–0.15) |
| `buffer-unicode-64` | 545.1 | 118.0 | 0.21× (0.20–0.23) |
| `buffer-ascii-1024` | 521.6 | 192.9 | 0.36× (0.34–0.40) |
| `buffer-unicode-1024` | 1254.1 | 623.2 | 0.51× (0.50–0.55) |

`TextEncoder` improved dramatically vs v4 (12.5–75.1 ns for 16–1024 B ASCII,
3.35–14.79× Node; 25.9–730 ns for Unicode, 0.97–7.83× Node). `Buffer.from(string)`
also improved 2.7–8.7× vs v4 (473–1,254 ns vs v4's 1,654–4,546 ns).
