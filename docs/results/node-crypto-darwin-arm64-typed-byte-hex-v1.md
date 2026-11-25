# Typed Node crypto timings with byte hex lookup

On macOS arm64, typed Tint won seven of eight cases against Node 26.13.1.
Both ran five paired rounds with alternating order. Tint used system
OpenSSL 3.6.4 and Node used OpenSSL 3.5.9. Each random result was a canonical
Buffer. The typed driver read its length from typed storage, and the
public benchmark continues to use JavaScript property access. Tint's
checksum matched Node's in every round. [Raw timing pairs](node-crypto-darwin-arm64-typed-byte-hex-v1.json)

The numbers are medians of the five per-pair Node/Tint ratios. Values
above 1 favor Tint.

| Case             | Packed hex lookup | Byte hex lookup |
| ---------------- | ----------------: | --------------: |
| `sha256-64`      |              1.40 |            1.73 |
| `sha512-64`      |              0.78 |            0.88 |
| `hmac-sha256-64` |              2.20 |            2.62 |
| `hmac-sha512-64` |              1.35 |            1.47 |
| `sha256-1MiB`    |             1.001 |           1.026 |
| `sha512-1MiB`    |             1.000 |           1.003 |
| `random-32`      |              1.19 |            1.28 |
| `random-4096`    |              1.45 |            1.53 |
| Cases won        |               7/8 |             7/8 |

The packed-lookup run used source snapshot
`6c0600a64edf4c5fd80e0900b06fdef50e0af322253e2f1d06fb6d8c5bd54c6f`
and image SHA-256
`f2d03a0a1ea47fd88d4968b0620280c0660c753a0703e46addfd1e0621b0db82`.
The byte-lookup run used source snapshot
`d05573d0abc144a15605cee60d4e65b07ab4fc1a05853050887a1891cb646e56`
and image SHA-256
`52b9555c5d8ad71e636b9ee00d330ebd740783204c813ae5bd174ace9d8d2c66`.
Each snapshot contained 828 files. The byte-lookup run used
`tools/gate/with-lock.sh both`.

Reinitializing a provider context in place lowered the isolated SHA-512
operation from about 120 to 88 ns in a control with four batches of
250,000 iterations.
For a freshly produced 32-byte Buffer, the same control measured about
476 ns with the JavaScript length accessor and about 267 ns with a typed
length read. Among the 1,029 samples in the packed-lookup SHA-512 profile,
integer conversion and string copying were the largest sampled leaf costs.
Byte lookup removes the per-digit shifts and masks. In the follow-up
experiments, deferring weak tracking combined with byte lookup measured
0.82 for short SHA-512. Widening the hex groups measured 0.55. The branch
keeps the eight-byte groups and existing weak tracking.

Build the typed driver with
`node tools/node-crypto-microbench.ts build branded-slots`. Set `NODE26`
to the Node 26.13.1 executable and run the printed image with
`tools/gate/with-lock.sh both crypto-typed node tools/node-crypto-microbench.ts run <image>`.
