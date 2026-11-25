# Extracted Node crypto conformance at 7f55de93f

Node 26.13.1 and native Tint ran the 41 case groups extracted from the four
checksum-verified upstream files at
`7f55de93ff077a31c5377e56eb48046f816f3c41`. This head includes the public
wrapper rewrite and the PR #9, #10 and #11 merges. Native runs observed
every inferior stop at entry and exit with status 42. The selection and the
39 excluded source ranges are unchanged from the
[first record](node-crypto-v26.13.1-extracted-v1.md).
[Extraction manifest](../../tools/node-crypto-cases.json)

| Runner                           |  Hash |  HMAC | PBKDF2 | Random | Total |
| -------------------------------- | ----: | ----: | -----: | -----: | ----: |
| Node 26.13.1, macOS arm64        | 16/16 | 13/13 |    9/9 |    3/3 | 41/41 |
| Native Tint, macOS arm64 (local) | 16/16 | 13/13 |    9/9 |    3/3 | 41/41 |
| Native Tint, Linux arm64 on dev  | 16/16 | 13/13 |    9/9 |    3/3 | 41/41 |
| Native Tint, macOS arm64 (CI)    | 16/16 | 13/13 |    9/9 |    3/3 | 41/41 |
| Native Tint, Linux arm64 (CI)    | 16/16 | 13/13 |    9/9 |    3/3 | 41/41 |
| Native Tint, Linux x86-64 (CI)   | 16/16 | 13/13 |    9/9 |    3/3 | 41/41 |

The `dev` machine loaded OpenSSL 3.0.20 and the local macOS runs loaded
Homebrew OpenSSL 3.6.4. CI ran on GitHub's `macos-26`, `ubuntu-24.04-arm` and `ubuntu-24.04`
runners in [run 45006825879](https://github.com/Sequins-dev/tint/actions/runs/45006825879).
A first `dev` attempt at `0eee92614` collided with an earlier attempt that
kept running after its host-side stop failed. Both wrote the same report
path, so neither is recorded here. A clean rerun at `0eee92614` also passed
41/41.

| Runner                           | Suite  | Exit | Image SHA-256                                                      |
| -------------------------------- | ------ | ---: | ------------------------------------------------------------------ |
| Native Tint, macOS arm64 (local) | hash   |   42 | `12401f299eac9ae3f9f358fa94d79c6cd5eb54ee57bc4465d288d2b96a4738ec` |
| Native Tint, macOS arm64 (local) | hmac   |   42 | `2cdc4f23469c00a75ed008dd4b53c549bfe94007d10d2f66886a25909ce5d461` |
| Native Tint, macOS arm64 (local) | pbkdf2 |   42 | `c94f82eedc8524ae99cde1a4af4b100544c2a00b5ee4b4625b3c3bcbcf16df6e` |
| Native Tint, macOS arm64 (local) | random |   42 | `d5959d1d913a964464a084cbc20dab34cc9e16a53f412a7abec950e027de13c9` |
| Native Tint, Linux arm64 on dev  | hash   |   42 | `2a823c6dd301b8e00a8cafd5feddb01753fac394ee07faa2f7cd019535493482` |
| Native Tint, Linux arm64 on dev  | hmac   |   42 | `79a5ba6d1be76c44b123d8c666a4d9d1f2da9260b871364a2269b9aaf4f8af26` |
| Native Tint, Linux arm64 on dev  | pbkdf2 |   42 | `2d419c92c76e9d5d85d3288c44ffd58d62abfe1ea1de6f020ab2a3b8bbcf2c43` |
| Native Tint, Linux arm64 on dev  | random |   42 | `e37dae4df1d217d776cd5f920d6b780a9b8181c880b9fba003ebee0d50146cd0` |
| Native Tint, macOS arm64 (CI)    | hash   |   42 | `12401f299eac9ae3f9f358fa94d79c6cd5eb54ee57bc4465d288d2b96a4738ec` |
| Native Tint, macOS arm64 (CI)    | hmac   |   42 | `2cdc4f23469c00a75ed008dd4b53c549bfe94007d10d2f66886a25909ce5d461` |
| Native Tint, macOS arm64 (CI)    | pbkdf2 |   42 | `c94f82eedc8524ae99cde1a4af4b100544c2a00b5ee4b4625b3c3bcbcf16df6e` |
| Native Tint, macOS arm64 (CI)    | random |   42 | `d5959d1d913a964464a084cbc20dab34cc9e16a53f412a7abec950e027de13c9` |
| Native Tint, Linux arm64 (CI)    | hash   |   42 | `2a823c6dd301b8e00a8cafd5feddb01753fac394ee07faa2f7cd019535493482` |
| Native Tint, Linux arm64 (CI)    | hmac   |   42 | `79a5ba6d1be76c44b123d8c666a4d9d1f2da9260b871364a2269b9aaf4f8af26` |
| Native Tint, Linux arm64 (CI)    | pbkdf2 |   42 | `2d419c92c76e9d5d85d3288c44ffd58d62abfe1ea1de6f020ab2a3b8bbcf2c43` |
| Native Tint, Linux arm64 (CI)    | random |   42 | `e37dae4df1d217d776cd5f920d6b780a9b8181c880b9fba003ebee0d50146cd0` |
| Native Tint, Linux x86-64 (CI)   | hash   |   42 | `05ee36f54ed4268a1d813ef6376b9063a185278eeab9150d8f8a00182d79b20c` |
| Native Tint, Linux x86-64 (CI)   | hmac   |   42 | `cb6fd5ac2d4d51125145f0d9a6afa82b0a6cd0f93f6d62f6b422518c79398b75` |
| Native Tint, Linux x86-64 (CI)   | pbkdf2 |   42 | `79aaae322c884b7213dc8a84c099c6157e64bdbb27459443fe5863e24774ee88` |
| Native Tint, Linux x86-64 (CI)   | random |   42 | `2313d3109a4c8e263b54cf9170d8610670f7d53051a217df605ed58eed5fcdd7` |
