# Node crypto over system OpenSSL

This proof of concept demonstrates a Node built-in implemented in typed Tint
over its native C FFI. The compatibility oracle is Node **26.13.1**. The
supported targets are macOS arm64, Linux arm64 and Linux x86-64. Both typed
and untyped applications use the same implementation and JavaScript
validation rules. [Native FFI](native-ffi.md) ·
[Event loop and workers](design-event-loop.md) ·
[Node crypto API](https://nodejs.org/download/release/v26.13.1/docs/api/crypto.html)

## Approved scope

| API           | Supported behavior                                                                                                                                                                                               | Native implementation                            |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `createHash`  | Incremental `update` and `digest`, including Node byte and string inputs, result encodings and finalized-state errors. Cover MD5, SHA-1, SHA-224/256/384/512 and SHA3-224/256/384/512 with their common aliases. | EVP digest operations in the default provider.   |
| `createHmac`  | Incremental `update` and `digest`, with string and byte keys and the same digest families. Match Node's HMAC-specific behavior after finalization.                                                               | OpenSSL HMAC operations in the default provider. |
| `randomBytes` | Synchronous overload with Node size validation and a Buffer result.                                                                                                                                              | OpenSSL CSPRNG.                                  |
| `pbkdf2`      | Callback overload, including synchronous validation and asynchronous completion.                                                                                                                                 | PBKDF2 on the blocking helper pool.              |

Use the same Buffer and byte-window primitives for typed and untyped callers.
Expose the supported operations through the built-in resolver. Report
unsupported named imports at the module boundary. Report any unsupported
overload or method explicitly when requested at runtime, using Node's error
contract where applicable. The PoC excludes streaming, hash copying, XOFs,
KeyObject, sync PBKDF2, callback randomBytes and the rest of the crypto
surface. It supplies no placeholder exports. Compiler image signing and
fingerprints continue to use foundation SHA-256 and require no libcrypto.

## System library selection

Select and validate the shared library when the crypto module is used.
AOT and live code call through Tint's existing C ABI. Tint still produces
its own images without a C compiler or platform linker.

1. On macOS arm64, an absolute path supplied via `TINT_OPENSSL_LIBRARY`
   takes precedence. To use the exact prefix reported by Homebrew, set
   `TINT_OPENSSL_LIBRARY="$(brew --prefix openssl@3)/lib/libcrypto.3.dylib"`.
   Require an OpenSSL 3 versioned library filename,
   `libcrypto.3.dylib`, and reject Apple's system library paths. The
   override is authoritative, so an invalid override produces an error.
2. Without an override, try the formula under a custom
   `HOMEBREW_PREFIX` from `brew shellenv`
   (`$HOMEBREW_PREFIX/opt/openssl@3/lib/libcrypto.3.dylib`), then
   `/opt/homebrew/opt/openssl@3/lib/libcrypto.3.dylib`, then
   `/usr/local/opt/openssl@3/lib/libcrypto.3.dylib`. Use absolute
   paths. Never probe Apple's unversioned `/usr/lib/libcrypto.dylib`.
   It is LibreSSL and loading it unversioned can abort.
3. On Linux arm64 and x86-64, use the system loader with the distro
   soname `libcrypto.so.3`.

Require OpenSSL major version 3 and every symbol needed for the supported
operations before publishing the binding. Report the attempted library and
the cause at the module boundary, with install or override guidance. Keep
the selected library alive while operations can use its symbols. Resolve
from the selected handle and keep contexts and their deleters with that
binding. Use the OpenSSL default provider. FIPS and the legacy provider
are outside the approved scope.

CI records the loaded OpenSSL version. On Ubuntu, use the distro runtime
package that provides `libcrypto.so.3` (`libssl3` or `libssl3t64`,
depending on the distro release). On macOS, use the runner's Homebrew
`openssl@3` and install it when absent. Distribution and security updates
follow the system package. [OpenSSL provider documentation](https://docs.openssl.org/3.5/man7/provider/)

## Execution and errors

Synchronous calls borrow byte windows during direct leaf FFI calls on the
isolate's thread. Give OpenSSL contexts explicit lifetime ownership,
including normal completion, failure and abandoned state. Any address
held after a leaf returns must refer to stable owned storage. Validate
actual byte offsets and lengths, including subviews, and preserve Node's
result brands and input encodings.

For PBKDF2, validate digest, iterations, length, callback and input types
on the isolate. Snapshot password and salt into job-owned native storage.
Submit work through the existing bounded blocking pool and post completion
to the owner inbox. Callbacks and other managed references stay in the
owner's job table. Pass native payload references through the pool and
erase temporary secret bytes before release. A completion keeps the
isolate alive and runs in the event loop's pending phase with the usual
checkpoints. On teardown cancel work that has yet to enter C, let running
calls return safely and discard stale results. Each job releases its
resources exactly once.

Build realm errors with the pinned Node class, code and message, keeping
validation throws separate from operation failures delivered in callbacks.
Scope OpenSSL error handling to the operation on its executing thread.
Drain or capture errors there, copying any data needed to reproduce Node's
message and metadata before reporting to the caller. Preserve Node's
operation-specific behavior for unsupported digests, including validation
in PBKDF2 and provider failure in digest initialization.
[Node crypto error mapping](https://github.com/nodejs/node/blob/v26.13.1/src/crypto/crypto_util.cc)

## Validation and readiness

- Pin the Node source to `v26.13.1`
  (`e9c277643b0249c50f6e6de5413be8a88ea11b6a`). Its full
  `test/parallel/test-crypto-*` population is 166 files. The PoC selection
  uses four direct API suites under `test/parallel/`:
  `test-crypto-hash.js`, `test-crypto-hmac.js`,
  `test-crypto-pbkdf2.js`, and `test-crypto-random.js`. Each exercises
  a public entry point in the PoC. Extract every case or assertion that
  exercises only the approved API slice verbatim. Record the source file
  and line for each extraction and reuse the same extracted bodies under
  Node and native Tint. The readiness denominator is the extracted case
  count per target. Publish the rest of the pinned files' cases separately,
  with source locations and the APIs that put them outside the PoC.
  Out-of-scope cases earn no passes. The original whole-file attempts
  remain historical evidence.
  [Extraction manifest](../tools/node-crypto-cases.json) ·
  [Whole-file attempt](results/node-crypto-v26.13.1-poc-v1.md)
  The manifest currently selects 41 case groups and lists 39 exclusion
  ranges. A case group can contain a loop over several upstream inputs.
  Run the Node reference extraction with
  `node tools/node-crypto-conformance.ts <node-source> <node-oracle>`.
- Exercise the real built-in import with typed and untyped native fixtures.
  Cover digest and HMAC vectors, output and error behavior, GC across
  updates, missing/incompatible library selection and callback ordering.
  Run native fixtures under LLDB with stop-at-entry and inferior exit
  assertions. Preserve Node oracle results separately from Tint results.
- Run the macOS and Linux gates, frozen native self-build comparisons,
  both Test262 host smoke modes and the convergence ledger. Use the shared
  `dev` machine for local Linux work and native Linux x86-64 CI for the
  authoritative x86-64 self-build. [Validation gates](validation-gate.md)
- Compare small hash and HMAC inputs, large hash inputs, and synchronous
  `randomBytes` against Node 26.13.1 with matched parameters and equivalent
  output. Warm each implementation, record system OpenSSL and Node's
  OpenSSL versions, rotate execution order in paired rounds under
  `tint-timing.lock` and report per-case paired results. Use native cycles
  and wall time where available. Keep the PR in draft until Tint wins most
  cases and all required checks pass. The module's implementation remains
  typed and independent of the `perf/general-calls` stream.
