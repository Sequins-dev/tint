# Initial macOS arm64 crypto measurements

The typed OpenSSL adapter won **0 of 8** cases against Node 26.13.1.
This was an exploratory run before the digest lifetime change and before
returning Node-branded Buffer objects. It establishes a baseline and does
not satisfy the readiness gate.

Both implementations used the same inputs and output encodings. Every
measurement warmed the call sequence before starting the monotonic timer.
Five paired rounds alternated the process launch order under
`tint-timing.lock`. The Tint image ran under LLDB, stopped at entry and
exited with status 42 in each round. Tint loaded Homebrew OpenSSL 3.6.4.
[Raw rounds and build provenance](node-crypto-darwin-arm64-initial-v1.json)

| Case | Median Tint time per call | Median Node time per call | Median paired Node/Tint time |
| --- | ---: | ---: | ---: |
| SHA-256, 64 B | 7.70 µs | 0.70 µs | 0.091 |
| SHA-512, 64 B | 9.05 µs | 0.54 µs | 0.057 |
| HMAC-SHA-256, 64 B | 8.26 µs | 1.49 µs | 0.168 |
| HMAC-SHA-512, 64 B | 10.19 µs | 1.53 µs | 0.147 |
| SHA-256, 1 MiB | 474.74 µs | 462.44 µs | 0.906 |
| SHA-512, 1 MiB | 922.98 µs | 855.01 µs | 0.984 |
| `randomBytes(32)` | 1.76 µs | 0.47 µs | 0.263 |
| `randomBytes(4096)` | 2.42 µs | 1.49 µs | 0.651 |
