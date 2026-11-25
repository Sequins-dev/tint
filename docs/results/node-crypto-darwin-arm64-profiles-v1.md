# Node crypto profiles on macOS arm64

The typed-driver baseline used system OpenSSL 3.6.4 and sampled each case
separately with PProfessor at 299 Hz. The small-input cases use 64-byte
messages. The hash and HMAC cases return hexadecimal strings. The random
cases return byte arrays. These samples diagnose the baseline. Paired
timing runs establish the performance result.

The build manifest records source snapshot
`f32f4ebb4d1bf860aa9cc31653041f39dfe100aa279e7739481f28f88f4a8b37`
with 825 files. The replacement `random-4096` image has SHA-256
`ee36e730138caaad4d363cdfdacfe01b8b210be70d60f13843e7474667210423`.

| Case             | Wall samples | Sampled leaf costs                                                                          |
| ---------------- | -----------: | ------------------------------------------------------------------------------------------- |
| `sha256-64`      |        1,026 | Record allocation 6.53%, array writes 5.65%.                                                |
| `sha512-64`      |        1,027 | Record allocation 8.86%, array writes 7.21%.                                                |
| `hmac-sha256-64` |        1,023 | Record allocation 6.65%, array writes 5.28%, OpenSSL SHA-256 blocks 3.91%.                  |
| `hmac-sha512-64` |        1,027 | Record allocation 8.67%, array writes 5.45%, OpenSSL SHA-512 blocks 6.91%.                  |
| `sha256-1MiB`    |        1,002 | OpenSSL SHA-256 blocks 97.41%.                                                              |
| `sha512-1MiB`    |        1,017 | OpenSSL SHA-512 blocks 97.94%.                                                              |
| `random-32`      |        1,007 | OpenSSL AES key expansion 7.45%, CTR updates 6.85%, cipher initialization 5.56%.            |
| `random-4096`    |        1,394 | OpenSSL AES CTR blocks were the largest leaf family. The largest single address was 16.36%. |

The small cases' allocation and write aggregates use operation offsets from
byte-identical stripped images. The symbolized `sha256-64` rerecord has
1,433 samples and shows the hexadecimal conversion's string concatenation,
character slicing and string builder among the leading leaf costs.

The first `random-4096` attempt stopped at dyld's debugger load notification
while LLDB and PProfessor observed the same process. The hang sample and
initial capture are retained under `/tmp/tint-crypto-profiles.FjEacn`. The
table uses the replacement 7.01-second capture. PProfessor launched the
inferior as the sole debugger. Each case acquires the shared locks separately
and then starts a 25-second watchdog that kills the inferior's process group
on timeout. Lock acquisition itself waits. A synthetic blocked process
verified that both lock scopes became available after cleanup.

The hashes below identify the profile files from
`/tmp/tint-crypto-profiles.FjEacn`, with the symbolized SHA-256 rerecord from
`/tmp/tint-crypto-symbols.FEeuM1`.

| Capture                   | SHA-256                                                            |
| ------------------------- | ------------------------------------------------------------------ |
| `sha256-64.pb.gz`         | `9c23484cbeaef11a33453b9b50ef935ca2477d90ac4f6d6be4cb930e601aad7e` |
| `sha512-64.pb.gz`         | `009ed9523dbb3ef04ca81d0e7fb1a1c4fd5b3a10e0075641436007ab30a7e043` |
| `hmac-sha256-64.pb.gz`    | `91c5cd734f84f0b468c72d8c91a1e78f5468d047f2bf278927daa7af1b7f6`    |
| `hmac-sha512-64.pb.gz`    | `78252428e3dc4f344ad2a851bd9491870381fb09a324f5108f4291deb8d6d41e` |
| `sha256-1MiB.pb.gz`       | `406b9fe3d411d46b5e3410d3a654056a2cd016d63632d8917e63ffeb9d28cd21` |
| `sha512-1MiB.pb.gz`       | `052e320ee99c09b79a2406fb32ce75455070acd8ba647a3264a7085070557295` |
| `random-32.pb.gz`         | `e4333ee752ec9d6d9e362bde2147e913292bffcd1ee5ace0e2baa51dcf11ed59` |
| `random-4096.retry.pb.gz` | `497a66f2eef9e84493b6280fc279a3f7e530af2ea1fdcd63970ab245043faa26` |
| `sha256-64.retry.pb.gz`   | `fed6f9fea12f477fd5f0f0af83d274a25e1fa31e00c4d643cdf5c621e11cb9b4` |
