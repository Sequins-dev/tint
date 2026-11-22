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

The C binding generator selects the leaf ABI from installed OpenSSL 3
headers. Its checked-in facts cover Darwin arm64 and Linux LP64. Use
`TINT_OPENSSL_INCLUDE` to refresh the facts with headers in a custom
location. Application compilation consumes the generated declarations.

## Execution and errors

The Node host registers `node:crypto` and `node:buffer` in the realm's
module loader. Static imports, runtime imports and CommonJS `require`
share the same crypto exports and Buffer constructor. The host uses the
existing 16 MiB Node isolate stack budget. The x86-64 realm initializer
exceeds the compact 1 MiB stack used by small typed fixtures.

Synchronous calls borrow byte windows during direct leaf FFI calls on the
isolate's thread. Hash and HMAC retain one fetched digest per algorithm and
cache aliases to that handle. Retain one idle context each for hash and HMAC
operations in the isolate. Reinitialize the hash context in place so the
provider allocation can serve another hash. Reset the HMAC context to clear
its key state. Release active and spare contexts with the cached digest
references at isolate exit. Encoded hexadecimal digests borrow scratch
storage within one synchronous operation. A 64-byte digest uses a packed
integer lookup table and writes directly into one final string. Buffer
results own their bytes and reuse the realm's integer-indexed typed-array
methods.
Any address
held after a leaf returns must refer to stable owned storage. Validate
actual byte offsets and lengths, including subviews, and preserve Node's
result brands and input encodings.

Each public Hash or Hmac is one ordinary realm object on a prototype the
isolate caches. A private field holds the typed digest lifetime itself.
The shared methods recover it through a compiler-bound record view, walking
the receiver's prototype chain so borrowed methods keep working, and the
lifetime's weak owner is the realm object. Ordinary, fixed-length,
in-bounds typed arrays lend their bytes without a range projection; other
views take the general projection. Algorithm-name checks compare ASCII
case-insensitively without lowercase copies, and SHA-256-sized digests use
a fixed-arity hexadecimal encoder like SHA-512's.

Hash and HMAC pass existing byte windows straight to OpenSSL. Tint stores
native strings as UTF-16. For UTF-8 updates, the shared encoder writes into a
4 KiB isolate-local scratch window in one pass. OpenSSL consumes each window
synchronously before the next window is encoded. The native encoder checks
eight UTF-16 code units at a time with NEON on arm64 and SSE2 on x86-64,
narrowing ASCII blocks directly into the destination. It transcodes Unicode
scalars, replaces unpaired surrogates with U+FFFD, and resumes block copies
when it reaches another ASCII run. Buffer and TextEncoder use the same
encoder for their owned byte results.

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
  `node tools/node-crypto-conformance.ts <node-source> <node-oracle>`
  and the native extraction with
  `node tools/node-crypto-native-conformance.ts <node-source> <report-path>`.
  Build the workspace first. For macOS native runs, point
  `TINT_GATE_EXCLUSIVE_LOCK` to the shared `~/.t3/tint-gate.lock`.
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
  `tools/gate/with-lock.sh both` and report per-case paired results. Use native cycles
  and wall time where available. Keep the PR in draft until Tint wins most
  cases and all required checks pass. The module's implementation remains
  typed and independent of the `perf/general-calls` stream.
  [Performance comparison](results/node-crypto-darwin-arm64-performance.md) ·
  [Profile captures](results/node-crypto-darwin-arm64-profiles-v1.md) ·
  [Public profile](results/node-crypto-darwin-arm64-public-profile-v1.md) ·
  [Public API baseline](results/node-crypto-darwin-arm64-public-v1.json) ·
  [Typed hexadecimal conversion experiment](results/node-crypto-darwin-arm64-hex-v1.json) ·
  [Typed digest context experiment](results/node-crypto-darwin-arm64-contexts-v1.json) ·
  [Typed Buffer comparison](results/node-crypto-darwin-arm64-branded-shared-methods-v1.json) ·
  [Typed byte lookup and Buffer length controls](results/node-crypto-darwin-arm64-typed-byte-hex-v1.md) ·
  [General method-call control](results/node-crypto-darwin-arm64-call-control-v1.md) ·
  [Short SHA-512 call and allocation breakdown](results/node-crypto-darwin-arm64-sha512-breakdown.md) ·
  [Scalar UTF-8 comparison](results/node-crypto-darwin-arm64-utf8.md) ·
  [Word-at-a-time UTF-8 comparison](results/node-crypto-darwin-arm64-utf8-simd.md)

## PoC phases

1. Validate system-library discovery and typed leaf calls with native hashes,
   HMAC and random bytes.
2. Connect callback PBKDF2 to the blocking pool and verify callback ordering
   and the ownership of inputs and results.
3. Register the built-in in the Node host, adopt results as realm Buffers and
   run the exact upstream extraction on Node and all three Tint targets.
4. Profile the native cases, measure the public calls and typed controls,
   and apply the performance and validation gates above.
