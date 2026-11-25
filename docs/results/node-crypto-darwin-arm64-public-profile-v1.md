# Public crypto profile on macOS arm64

PProfessor launched a symbolized native image of the public `node:crypto`
benchmark with the system OpenSSL 3.6.4. It sampled the main thread at
299 Hz and recorded 425 wall samples in 2.84 seconds. The profile includes
warmup, all eight cases and process startup. The build manifest records 828
files with source snapshot SHA-256
`7aeb42cbd7f4374e88485a47a19cded902837cf1c01b2c357c42eb29b0fa9f2f`.
The image SHA-256 was
`4c0b460c25ce38ce6db0a963536ef41585ccc8c979f234bea60099a2d8c9b50f`.

- The original general hexadecimal encoder appeared on 18.59% of sampled
  stacks. String concatenation and slicing were among the leading Tint
  leaf costs.
- The original per-instance method installation in `digestView` appeared on
  8.47% of sampled stacks at its largest recorded call site. The shared
  digest prototypes avoid installing `update` and `digest` separately on
  every hash or HMAC object.
- `callObjectValue` appeared on 97.88% of sampled stacks, including the
  call to the fixture entry and stacks spending their time inside OpenSSL.
  A separate paired control measured 353.52 ns for one property lookup and
  general method call. [Native call control](node-crypto-darwin-arm64-call-control-v1.md)
- Buffer adoption and typed-array construction appeared in random-byte
  stacks. Most large-input hash samples reached the OpenSSL SHA blocks.
  [Per-case typed profiles](node-crypto-darwin-arm64-profiles-v1.md)

The capture at `/tmp/tint-crypto-public-profiles.Opcqht/public.retry.pb.gz`
has SHA-256 `c88003c13ddfc3b6acd7474cc6cadce091014613ff8e063bdcc9fd3ef111f84e`.
The separate paired run establishes the timing baseline.
[Public benchmark](node-crypto-darwin-arm64-public-v1.json)
