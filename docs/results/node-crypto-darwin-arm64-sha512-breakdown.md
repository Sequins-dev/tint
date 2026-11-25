# Short SHA-512 on macOS arm64

Measured on an Apple M5 Max. Each timing run held the launch and timing
locks through `tools/gate/with-lock.sh both`.

The operation is `createHash("sha512").update(input).digest("hex")` with
one already allocated 64-byte Uint8Array. The main comparison uses Tint's
typed crypto entry point and Node 26.13.1's JavaScript API. Tint loads Homebrew
OpenSSL 3.6.4. The Node binary links OpenSSL 3.5.9. The baseline is
`89fd88387f16655755c2a66b13b7a869ca69ec50`.

## OpenSSL calls

An LLDB trace counted calls after one identical operation and before explicit
cleanup. The per-call figures below are median deltas across five rotated
pairs of 64-call batches with matching empty indirect call controls.
Calibration exercises the same OpenSSL libraries with the same SHA-512
inputs and context states. Cycles and retired instructions are from macOS
process counters. The calibration measures the native C entries and their
descendants. It excludes Tint's FFI and Node's V8 binding at the call site.
Getter costs near zero fall below the resolution of the subtraction.

| OpenSSL API | Tint calls | Tint cycles / instructions | Node calls | Node cycles / instructions |
| --- | ---: | ---: | ---: | ---: |
| `EVP_MD_CTX_new` | 0 | — | 1 | 26 / 195 |
| `EVP_DigestInit_ex` | 0 | — | 1 | 56 / 403 |
| `EVP_DigestInit_ex2(ctx, NULL, NULL)` | 1 | 24 / 179 | 0 | — |
| `EVP_DigestUpdate` | 1 | 10 / 78 | 1 | 12 / 75 |
| `EVP_DigestFinal_ex` | 1 | 233 / 759 | 1 | 228 / 735 |
| `EVP_MD_CTX_get0_md` | 0 | — | 2 | <1 cycle |
| `EVP_MD_get_size` | 1 inside final | Included in final | 1 in hash init | <1 cycle |
| `EVP_MD_get_flags` | 0 | — | 1 in hash init | <1 cycle |
| `EVP_MD_free(NULL)` | 0 | — | 1 inside init | Included in init |
| `EVP_MD_CTX_reset` | 0 | — | 0 | — |
| `EVP_MD_CTX_free` | 0 | — | 1 at reclamation | 109 / 626 |
| `EVP_MD_fetch` | 0 | — | 0 | — |
| `EVP_get_digestbyname` | 0 | — | 0 | — |
| `OSSL_PROVIDER_load` | 0 | — | 0 | — |

Both traces observed one fetch on first use. Tint selected the system library
and loaded its default provider once. Node queried the name registry once
and supplied the cached ID on the subsequent invocation. Calibration against
an already warm provider measured 307 cycles for Tint's library and 299 for
Node's for a fetch call, and 87 and 83 cycles for a registry lookup. These
figures exclude cold provider and dynamic loader startup. Tint retained its
one context through both operations and freed it during explicit cleanup.
Node retained the two contexts until the two hash wrappers were reclaimed.
Supported aliases share the fetched handle. Tint checks the provider's
alias list first and consults the historical registry if needed. It records
the alias in the isolate cache and uses the default provider for any fetch.
[OpenSSL 3 digest API](https://docs.openssl.org/3.0/man3/EVP_DigestInit/)

## Managed heap

The interval-one Tint heap trace records the allocation size of every object
during the second operation. Node's allocation profile sampled 512 retained
operations with a one-byte sampling interval after warmup. The repeated
sites total 400 V8 bytes per operation. Occasional one-off allocations are
excluded from that estimate. A separate V8 heap snapshot confirmed the
48-byte public Hash receiver, 48-byte managed native handle wrapper and
144-byte sequential one-byte string.

| Allocation site | Tint baseline bytes/op | Tint packed bytes/op | Node bytes/op |
| --- | ---: | ---: | ---: |
| Hash receiver and lifetime record | 24 + 48 | 24 + 48 | See constructor sites |
| Weak lifetime slot | 40 | 40 | 0 |
| Lifetime vector growth during the observed operation | 40 | 0 | 0 |
| Reference captures | 24 + 24 | 24 | 0 |
| Method environments | 48 + 40 | 48 + 40 | 0 |
| Method function objects | 40 + 40 | 40 + 40 | 0 |
| Node constructor sites attributed to `Hash` | 0 | 0 | 72 + 48 |
| Node site attributed to the calling phase | 0 | 0 | 48 |
| Node constructor utility wrapper | 0 | 0 | 24 |
| Node constructor `internal/errors` wrapper | 0 | 0 | 32 + 32 |
| Intermediate hex strings | 8 × 48 | 0 | 0 |
| Intermediate concatenation results | 48 + 80 + 112 + 144 + 176 + 208 + 240 | 0 | 0 |
| Final hex string | 272 | 272 | 144 |
| **Total** | **2,032** | **576** | **400** |

Node's native OpenSSL context, digest output allocation and C++ wrapper are
outside the managed counts. Its hex path writes 128 ASCII digits into a stack
buffer and copies them to a V8 one-byte string. Tint's baseline wrote 16 UTF-16
code units into each of eight strings and repeatedly copied their contents.
The packed path reads a 16-bit table entry per byte, splits it with a mask
and shift, and stores the 128 UTF-16 digits into the final string. The
AArch64 encoder has 64 byte loads, 64 halfword table loads and 128 halfword
stores. The disassembly contains no integer-to-double conversion or
number-to-string helper for those digits. It uses one string allocation.

## Runtime boundaries

Both runtimes borrow the existing Uint8Array data during the leaf call.
There is no input buffer allocation or copy. Node's preallocated Buffer
control uses the same backing-byte path. Tint's public adapter projects
an already normalized full-width Buffer to its existing typed byte storage.
A sliced Buffer can require a new view header and still borrows the data.

Tint's typed entry point validates context liveness, dispatches on string vs
view and tests return status. Node's constructor validates the algorithm and
options, looks up the cached algorithm ID and constructs the lazy stream
wrapper. Its update checks finalized state and validates the string encoding
or ArrayBuffer view before invoking C++. Digest checks finalized state and
coerces the output encoding before crossing that boundary. The direct Node
binding control preserves the cached ID, OpenSSL operations, and hex output
while removing public JS validation, wrapper allocations and dispatch as a
group.

An additional diagnostic built the packed byte path before the cold alias
lookup changes. For each of five pairs, process hardware counters bracketed
400,000 operations after 20,000 warmup operations in each runtime. The
Node measurements rotated controls as well as alternating which runtime
ran first. These are cycles and retired instructions per operation.
The difference rows are medians of within-round differences.

| Diagnostic | Packed Tint cycles / instructions | Node cycles / instructions |
| --- | ---: | ---: |
| Full Uint8Array operation | 1,229 / 6,327 | 1,406 / 7,194 |
| Hex-only control minus its loop control | 458 / 3,054 | 194 / 1,164 |
| String instead of Uint8Array | +2,493 / +18,480 | +111 / +660 |
| Preallocated Buffer instead of Uint8Array | Same backing byte storage | +10 / +75 |
| Public wrapper above direct native binding | — | +147 / +832 |

The hex-only control uses the typed digest encoder in Tint and Buffer's
hex conversion in Node. Node's control includes Buffer's dispatch. The
string delta includes the input type and encoding checks as well as UTF-8
conversion. Tint's encoder sizes the UTF-8 bytes before allocating and
writing them. The Node wrapper row includes validation, JS allocation, and
dispatch together. These controls preserve normal execution and do not give
standalone timings for individual validation branches.

Source locations in the pinned Node release cover hash validation and
construction, context allocation and digest finalization, and the
stack-backed hex path.
[JavaScript hash wrapper](https://github.com/nodejs/node/blob/v26.13.1/lib/internal/crypto/hash.js#L102-L207)
[Native hash implementation](https://github.com/nodejs/node/blob/v26.13.1/src/crypto/crypto_hash.cc#L642-L761)
[One-byte string creation](https://github.com/nodejs/node/blob/v26.13.1/src/string_bytes.cc#L153-L172)
[Hex encoding](https://github.com/nodejs/node/blob/v26.13.1/src/string_bytes.cc#L728-L735)

## Paired wall time

The `branded-slots` driver passes a 64-byte Uint8Array through the typed hash
entry point and checks lengths on real Buffer results for the random cases.
Five pairs alternate Tint-first and Node-first order. The result for each
case is the median of the five per-pair Node/Tint time ratios.

| 64-byte SHA-512 | Tint median ns/op | Node median ns/op | Median paired ratio |
| --- | ---: | ---: | ---: |
| Baseline | 422.281 | 330.877 | 0.780× |
| Packed | 265.931 | 324.958 | 1.222× |

| Typed case | Baseline Node/Tint | Packed Node/Tint |
| --- | ---: | ---: |
| `sha256-64` | 1.423× | 1.497× |
| `sha512-64` | 0.780× | 1.222× |
| `hmac-sha256-64` | 2.319× | 2.281× |
| `hmac-sha512-64` | 1.284× | 1.729× |
| `sha256-1MiB` | 1.004× | 1.031× |
| `sha512-1MiB` | 1.003× | 1.012× |
| `random-32` | 1.192× | 1.226× |
| `random-4096` | 1.467× | 1.536× |

The packed build won all eight cases. Its SHA-512 pairs in ns/op were
260.471/319.748, 265.931/324.958, 271.669/331.833, 269.169/325.775, 257.487/322.650
(Tint/Node). The fixture captured 828 source
files under SHA-256 `4b4b1b81bfde173af2a72eccc9754770a1326cbe859adc32d4c6eb4d36595e89`.
The packed code is in commit `abb995de8220c1ab9dfdd652e34206dc8c3dd6c6`.
The 41 extracted case groups passed on native macOS arm64 and Linux arm64
with this revision. Node 26.13.1 also passed all 41 groups.
The public path awaits the general-call rerun after PR #7.
