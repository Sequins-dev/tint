# Node 26.13.1 crypto PoC validation

The [PoC selection](../design-node-crypto.md#validation-and-readiness) is
four upstream files from Node commit
`e9c277643b0249c50f6e6de5413be8a88ea11b6a`. The Node release source archive
and macOS arm64 binary archive matched the release's SHA-256 sums.

| Upstream file under `test/parallel/` | Node 26.13.1 | Tint native macOS arm64 |
| --- | --- | --- |
| `test-crypto-hash.js` | Pass | Reached entry, then exited 1 with an uncaught `ReferenceError` |
| `test-crypto-hmac.js` | Pass | Reached entry, then exited 1 with an uncaught `ReferenceError` |
| `test-crypto-pbkdf2.js` | Pass | Reached entry, then exited 1 with an uncaught `ReferenceError` |
| `test-crypto-random.js` | Pass | Reached entry, then stopped at an `EXC_BREAKPOINT` |
| **Total** | **4 / 4 pass** | **0 / 4 pass** |

For the native attempts, the hosted builder appended its entry export to each
unchanged test body. Its typed linker reported `unknown value name: require`
for each file, then emitted an image through the general pipeline. The images
were launched under LLDB. These runs established the missing CommonJS
harness dependency and the outcomes above. They did not reach assertions
about OpenSSL behavior. The four original Node files have no native Linux
results in this report.

## Bespoke native fixtures

The fixed-signature OpenSSL candidate passed the typed digest, HMAC and
random-byte fixture and the typed callback PBKDF2 fixture on macOS arm64
and Linux arm64. The macOS test runner verified both images twice.
The Linux runs used the shared `dev` machine and verified each inferior
exited with status 42 after reaching entry. Both fixtures cross-built for
Linux x86-64. The callback fixture uses the blocking pool, reactor wake
and event-loop pending callback. The macOS loader fixture supplied both
`/usr/lib/libcrypto.dylib` and a missing versioned dylib via the explicit
override. Both returned `ERR_NO_CRYPTO` with the expected diagnostic.

The draft exposes native byte arrays where Node exposes Buffer objects.
The standalone PBKDF2 fixture initializes its host pool explicitly.
The public Node realm adapter and the unchanged pinned test harness
remain incomplete. [Initial performance measurements](node-crypto-darwin-arm64-initial-v1.md)
