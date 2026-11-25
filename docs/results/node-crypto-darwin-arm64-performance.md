# Node crypto performance on macOS arm64

These measurements compare Node 26.13.1 with Tint using Homebrew OpenSSL
3.6.4. Node reports OpenSSL 3.5.9. Each comparison ran five paired rounds
under both shared locks and alternated implementation order. The driver
checked every iteration count and result length through its checksum.
The values below are medians of the per-round Node time divided by Tint
time. A value above 1 favors Tint.

| Case             | Public baseline | Public with shared methods | Typed with shared methods and Buffer results |
| ---------------- | --------------: | -------------------------: | -------------------------------------------: |
| `sha256-64`      |            0.08 |                       0.20 |                                         1.12 |
| `sha512-64`      |            0.05 |                       0.13 |                                         0.58 |
| `hmac-sha256-64` |            0.20 |                       0.43 |                                         2.00 |
| `hmac-sha512-64` |            0.15 |                       0.38 |                                         1.25 |
| `sha256-1MiB`    |            0.95 |                       0.99 |                                         1.03 |
| `sha512-1MiB`    |            0.96 |                       0.97 |                                         1.03 |
| `random-32`      |            0.22 |                       0.26 |                                         0.66 |
| `random-4096`    |            0.63 |                       0.68 |                                         1.15 |
| Cases won        |             0/8 |                        0/8 |                                          6/8 |

[Public baseline](node-crypto-darwin-arm64-public-v1.json) ·
[Public shared-method comparison](node-crypto-darwin-arm64-public-shared-methods-v1.json) ·
[Typed shared-method comparison](node-crypto-darwin-arm64-branded-shared-methods-v1.json)

The shared-method variant includes grouped hexadecimal conversion, reset
OpenSSL context reuse and shared integer-indexed methods for typed-array
objects. Synchronous random output uses the canonical Node Buffer adopter.
Public median time for `random-32` fell from 2,533 to 2,074 ns across the
two reset-context runs. The `random-4096` median fell from 3,532 to 2,500
ns. The typed comparator won 4/8 cases before sharing those methods.
[Public reset-context run](node-crypto-darwin-arm64-public-v3.json) ·
[Typed reset-context run](node-crypto-darwin-arm64-branded-v2.json)

One property lookup and method call added a median of 353.52 ns in the
independent general-call control. Public small-input crypto still takes
several microseconds per operation. The public benchmark remains below the
required majority. [Call control](node-crypto-darwin-arm64-call-control-v1.md) ·
[Public profile](node-crypto-darwin-arm64-public-profile-v1.md)
