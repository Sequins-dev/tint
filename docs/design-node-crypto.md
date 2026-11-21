# Node crypto over OpenSSL

**Phase 1 design for review · 21 November 2026**

Target Node **26.13.1** for JavaScript-observable behavior on macOS arm64,
Linux arm64 and Linux x86-64. Both typed and untyped imports use one trusted
adapter, with the same argument validation, objects, errors and callback
semantics. The caller's explicit TypeScript annotations continue to enforce
their own contracts. Use Tint's typed C FFI, as described in
[Native FFI](native-ffi.md), and the helper pool and inbox from
[the event-loop design](design-event-loop.md). Reuse the realm and Buffer
primitives identified in [the b3 design](design-node-ffi-b3.md). Public
`node:ffi`, its callback registration and libuv are outside this dependency
chain. [Node crypto API](https://nodejs.org/download/release/v26.13.1/docs/api/crypto.html)
· [Node CommonJS export definitions](https://github.com/nodejs/node/blob/v26.13.1/lib/crypto.js)

Tint has a SHA-256-only `createHash` fixture adapter with a subset of Node's
encodings and a byte-array result. Its 14 native vectors provide regression
inputs. Route public digests through the selected provider so enumeration,
aliases and provider policy agree with actual execution. The compiler and
image writers already use foundation SHA-256 for deterministic fingerprints
and image signing. Keep that primitive for those internal uses. Host-side
tools using Node crypto for reference digests do not make libcrypto a
self-hosting dependency. [Current hash adapter](native-ffi.md#cryptocreatehashsha256)
· [Compiler host surface](runtime-host-surface.md)

## Obtaining and linking OpenSSL

| Target | Pinned shared library shipped alongside a Tint distribution | System or user shared library | Vendored static build, if approved |
| --- | --- | --- | --- |
| macOS arm64 | Build an arm64 `libcrypto.3.dylib` as a release dependency. Open the signed packaged copy by a path resolved relative to the distribution. | Accept an explicit path to a managed OpenSSL 3 install, such as a versioned Homebrew keg. Apple's `/usr/lib/libcrypto` is not a stable public OpenSSL ABI. | Build a Darwin arm64 archive of Mach-O objects. Tint would have to resolve its symbols and relocations and include the resulting pages in its normal signing flow. |
| Linux arm64 | Build an AArch64 `libcrypto.so.3` against the supported glibc baseline and load it from the distribution. | Use an explicit install path or the distro's `libcrypto.so.3` via the system loader in system mode. Verify the library and provider capabilities. | Build an AArch64 ELF archive against the supported glibc baseline. Tint would have to resolve its relocations and dynamic libc imports. |
| Linux x86-64 | Build an x86-64 `libcrypto.so.3` against the supported glibc baseline. Test the exact package on native x86-64 CI. | Same system mode as Linux arm64 with the x86-64 ABI and its own capability tests. | Build an x86-64 ELF archive, with its own relocation and CPU dispatch validation. |

**Recommendation.** Use a pinned OpenSSL **3.5** shared library as the release
and conformance backend. Node 26.13.1 vendors a tree reporting **3.5.9**. Start
with that line and record the exact upstream source revision, archive digest,
build options and per-target artifact hashes. Compare the build and provider
behavior against the pinned Node binary. Advance the patch pin for upstream
security fixes with conformance reruns. Support an explicitly selected
system/user backend if approved. It keeps distro patching and deployment
options available, with a separate compatibility result because algorithms,
providers and error text can vary even with the same major ABI. The official
conformance run uses the pinned backend. Node's bundled build gives a useful
version and provider baseline. Its build also offers `--shared-openssl`.
[Node vendored version](https://github.com/nodejs/node/blob/v26.13.1/deps/openssl/openssl/VERSION.dat)
· [Node configure options](https://github.com/nodejs/node/blob/v26.13.1/configure.py)
· [OpenSSL build guide](https://github.com/openssl/openssl/blob/openssl-3.5/INSTALL.md)

Build or acquire libcrypto as an independently packaged upstream dependency.
Its release build can use upstream's C compiler, assembler and platform
linker. Tint consumes the resulting binary artifact. Tint generates and links
its own AOT images and publishes live code through its existing pipeline, with
typed calls to the selected libcrypto. Neither compiling an application nor
self-building Tint runs a C compiler or invokes a platform linker. The
platform's runtime library loader resolves the shared dependency at execution.
An AOT image using crypto needs the matching shared artifact at deployment,
including any explicitly enabled provider modules. AOT and live mode use the
same binding and backend selection.

Use the existing native loader primitives and fixed typed ABI declarations.
Resolve required symbols once before publishing the binding, then call them
through the existing indirect leaf path. Validate the major version, minimum
feature set, and provider availability. Use a handle-local lookup and keep
the handle and providers alive through all contexts and jobs. Use a single
binding for each profile and keep every opaque OpenSSL object with the
binding that created it, including when a helper frees it. Use a
controlled library, provider and configuration search policy for the pinned
profile so installed libraries or ambient config cannot silently change its
behavior. Optional features require explicit probes. A missing backend,
required symbol or incompatible version produces a diagnostic at the module
or embedding boundary before any call through an unresolved address.
Importing unrelated built-ins and running compiler self-builds must continue
to work without an OpenSSL installation. [Native library imports and optional
loading](native-ffi.md#libraries) · [OpenSSL environment and configuration](https://docs.openssl.org/3.5/man7/openssl-env/)

**Static alternative.** Build pinned upstream `libcrypto.a` artifacts outside
Tint, then teach Tint's linker to consume them. Before promising a static
image, prove archive member selection, symbol resolution, text and data
relocations, constructors, TLS and CPU dispatch, external imports, provider
behavior and reproducible output on each target. Validate the same design
for live mode or size its separate loading requirements. The current FFI
library manifest imports shared binaries and does not provide this archive
linking path. A C shim, C-generated application or a platform-linker pass for
a Tint image would violate the pipeline constraint. Static inclusion would
remove the base libcrypto deployment file, at the cost of linker work,
larger images and rebuilds of all affected images on security updates.
Provider modules still need a deliberate packaging policy.

**Licensing and FIPS.** Include the Apache 2.0 license and applicable upstream
notices with shipped libcrypto or provider binaries, including when embedded
statically. Retain attribution and mark any upstream source changes as
required by the license. Record provenance and patch ownership in the
distribution. Ordinary OpenSSL 3 builds make no FIPS validation claim.
Recommend an ordinary default profile with legacy providers disabled by
default. A later FIPS profile needs a validated module, a covered operating
environment, installation and configuration per its Security Policy, provider
self-tests, and verification of FIPS property selection. Its configuration
must fail closed and cover Node's `getFips`/`setFips` and worker restrictions.
The chosen validated provider can require a different source pin from the
base library. Test ordinary, legacy and FIPS behavior under distinct profiles
when supported. [OpenSSL license](https://github.com/openssl/openssl/blob/openssl-3.5/LICENSE.txt)
· [OpenSSL FIPS instructions](https://github.com/openssl/openssl/blob/openssl-3.5/README-FIPS.md)

## API inventory and implementation order

Prioritize content hashing, authentication and secure random values for
common application code. The compiler's current internal hash use makes
SHA-256 a strong fixture baseline. It does not require moving compiler
fingerprinting or signing into the public crypto adapter.

| Phase | Node 26.13.1 surface and expected behavior | Native mapping |
| --- | --- | --- |
| 2 · Hashes, MACs and random | `hash`, `createHash`/`Hash` including `copy`, XOF output lengths and stream behavior, `createHmac`/`Hmac`, `getHashes`. `randomBytes`, `randomFill`/`randomFillSync`, `randomInt`, `randomUUID`, `timingSafeEqual`. Accept the pinned BufferSource/encoding overloads and common HMAC key inputs. | EVP digests and MACs, OpenSSL CSPRNG and `CRYPTO_memcmp`. Match Node's length checks and reject unequal spans with `ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH`. Reuse unbiased integer sampling and UUID formatting rules at the adapter level. |
| 3 · Ciphers and KDFs | `createCipheriv`/`Cipheriv`, `createDecipheriv`/`Decipheriv`, `getCiphers`, `getCipherInfo`. Start with AES-GCM, ChaCha20-Poly1305, AES-CBC/CTR, then complete the provider-supported modes including CCM and OCB. Cover padding, AAD, tag lengths and order, output encodings and stream finalization. Deliver callback and sync forms of PBKDF2, scrypt and HKDF with Node bounds, scrypt option aliases and `maxmem`. | EVP cipher contexts and OpenSSL KDFs with operation-specific options. Preserve Node's `ArrayBuffer` HKDF return and Buffer results for PBKDF2/scrypt. |
| 4 · Keys, signatures and agreement | `KeyObject` with `from`, export, equality, metadata and key type checks. `createSecretKey`, `createPublicKey`, `createPrivateKey`, `generateKey[Sync]`, `generateKeyPair[Sync]`. Cover PEM/DER containers (PKCS#1, PKCS#8, SEC1, SPKI), passphrases, JWK and Node's raw formats. `createSign`/`Sign`, `createVerify`/`Verify`, one-shot `sign`/`verify`, public/private RSA operations, DH/groups, `diffieHellman`, `createECDH`/`ECDH` and `getCurves`. Start with RSA, EC, Ed25519 and X25519, then extend to remaining pinned key types. | EVP_PKEY, OSSL encoder/decoder, sign/verify and derive primitives. Preserve format and key-usage restrictions, RSA padding options and signature encodings. Share key material ownership across keys and jobs with independent operation contexts. |
| 5 · Certificates and Web Crypto | `X509Certificate`, `Certificate` SPKAC methods and `parsePKCS12`. `webcrypto`, module aliases `subtle` and `getRandomValues`, and realm `globalThis.crypto`. Match Crypto/CryptoKey brands, usages and extractability, algorithm normalization, key management, digest, sign/verify, encrypt/decrypt, derive, wrap/unwrap, and Node's modern algorithm and KEM extensions. | OpenSSL X.509/SPKAC and PKCS#12 plus existing operation kernels. Share the CSPRNG for synchronous `getRandomValues` and UUIDs. Use the pool for native `SubtleCrypto` work and realm Promise settlement. |
| 6 · Remaining pinned APIs and profiles | Complete `createMac`/`getMacs`, Argon2, UUIDv7, prime generation/checking, KEM `encapsulate`/`decapsulate`, remaining algorithms, constants, deprecated random aliases and FIPS/engine/secure-heap surfaces for the approved profiles. Bring forward KEM and secret-key support as Web Crypto and HMAC need them. | Provider-specific EVP operations, BN operations and explicit capability policy. Reproduce deprecated surface behavior where the pinned build exposes it. |

Compare the function and class inventory with the pinned exports as part of
the suite. Match ESM named/default exports, and CommonJS object identity and
descriptors through the host's module-loader support. Where a dependency
such as Buffer, streams, CommonJS or CryptoKey transfer is missing, track
the dependent tests as blocked. Publish working API slices and report
unsupported imports at build/link time where possible. For dynamically
reached unsupported options use the pinned Node operation's error contract
where it has one. If Node supports the operation and has no corresponding
error, disclose the precise Tint capability gap. Never substitute an
algorithm, fake a successful result or ship a placeholder export.
[Node classic API](https://nodejs.org/download/release/v26.13.1/docs/api/crypto.html)
· [Node Web Crypto API](https://nodejs.org/download/release/v26.13.1/docs/api/webcrypto.html)

## Calls, ownership and cancellation

### Synchronous entry points

Validate the arguments, perform observable JS property reads and normalize
encodings in the caller's realm. Brand-check views with the existing
byte-window helpers and use their actual byte offsets and lengths. Call
OpenSSL on that isolate's thread through direct leaf FFI, including sync
KDFs and stateful updates. No pool hop or managed callback. A leaf may
borrow movable bytes only for the duration of that call. Data OpenSSL
retains goes in stable owned storage. Use opaque context handles with
a single release transition on finalization, explicit operation completion
or isolate teardown as appropriate. Keep OpenSSL allocations and their
deleters paired. Allocate independent operation contexts for concurrent
jobs, retaining an immutable key handle with the required OpenSSL
reference or copying the key material where sharing is unsupported.
Use OpenSSL cleanup for secret-owned scratch before releasing it. Never
erase caller-owned input. Exercise both typed and general callers through
the same public entry. [FFI leaf-call invariants](native-ffi.md#call-classes-and-the-gc-invariant)

### Callback and Promise entry points

1. Validate and capture on the owner thread, including argument-read order,
   synchronous throws, promise rejections and overload-specific behavior.
   Node 26.13.1 calls the callback inline for zero-length `randomFill` and
   the zero-length `randomBytes` path using it. Preserve that behavior.
   Procedures with a cached result, such as `randomInt`, also need their
   pinned scheduling behavior. [Pinned random implementation](https://github.com/nodejs/node/blob/v26.13.1/lib/internal/crypto/random.js)
2. Submit native work to the existing bounded blocking pool. PR #2's pool
   currently carries string requests/results, tracks outstanding work and
   wakes the owner. Extend that transport with a typed operation tag, job
   id and a raw payload reference or byte range. Reuse its wake and inbox
   machinery. The helper sees only native data and can have its own
   operation-local scratch. Callback, Promise resolver and object roots
   stay in the owner's table. Snapshot inputs for operations where Node
   copies on submit, including KDF inputs and Web Crypto BufferSource data.
   Never serialize passwords, private keys or derived secrets as mailbox text.
   [Blocking pool](../packages/native-runtime/src/blocking-pool.ts)
   · [Pinned PBKDF2 implementation](https://github.com/nodejs/node/blob/v26.13.1/src/crypto/crypto_pbkdf2.cc)
3. Allocate private output for new results, with adoption or copy at delivery
   according to the Node result type. For in-place `randomFill`, validate
   element and byte units, retain the original receiver on the owner and
   capture a stable reference to the exact submitted backing window. Lease
   the backing for the whole job and preserve aliasing, including shared
   backing. An ordinary managed root cannot keep a movable address valid.
   Test transfer, detach and resize races against Node before enabling the
   relevant backing types. Keep backing physically valid until the worker
   releases it even if the JS view changes. A copy committed at callback
   time would change observable writes for aliased/shared buffers.
   [Pinned random job](https://github.com/nodejs/node/blob/v26.13.1/src/crypto/crypto_random.cc)
4. The helper posts one completion with its job id and native result or
   copied error data, then signals the owner's inbox. Release the job's
   liveness hold on completion or teardown. Deliver callbacks and settle
   Promise jobs from the matching event-loop phase on the owner, preserving
   Node callback arguments and receiver, and its next-tick/microtask
   checkpoints. Compare relative ordering with pinned oracle traces. Handle
   pool saturation through the existing scheduler with deferred admission
   where Node queues valid work. Report actual resource exhaustion at the
   operation's error boundary.
5. Use job ids and isolate generations to arbitrate cancel/complete races.
   Public callback APIs and `subtle` do not gain an AbortSignal. On isolate
   teardown, stop admission and cancel queued jobs before C entry where
   possible. Let a running leaf call return, then discard delivery to a
   retired isolate. Preserve resource ownership until the helper has stopped
   using it, even if the owner no longer wants the result. Exactly one path
   releases each hold, output, backing lease and key reference, including
   submission failure, stale reply and helper failure. Keep worker
   termination behavior tied to the event-loop lifecycle.

## Error mapping

Use the realm's existing coded errors for validation and adapter state,
with the pinned Node class, code, message and throw/callback/rejection
timing. Preserve exceptions raised by user input accessors as-is. Cases
include `ERR_INVALID_ARG_TYPE`, `ERR_OUT_OF_RANGE`,
`ERR_CRYPTO_HASH_FINALIZED`, `ERR_CRYPTO_UNKNOWN_CIPHER` and
`ERR_CRYPTO_INVALID_DIGEST` on paths such as PBKDF2 that use it. Treat a
verification mismatch as `false` on the relevant API, with actual errors
translated from its return status. Treat authentication failure at cipher
finalization according to Node's decipher behavior. Follow Web Crypto's
DOMException names and messages where the pinned API uses them.
[Node error catalog](https://nodejs.org/download/release/v26.13.1/docs/api/errors.html)
· [Pinned cipher implementation](https://github.com/nodejs/node/blob/v26.13.1/src/crypto/crypto_cipher.cc)

Scope the OpenSSL queue to the operation on the calling thread. At an
entry that owns the queue, clear stale entries before the operation.
Use marks to discard errors from speculative calls where Node does, and
drain the operation's entries before the thread handles another job.
For an embedding that shares the libcrypto instance, verify the queue
ownership contract before clearing or draining around calls by other
consumers.
Capture error codes and copied strings before cleanup can alter the queue.
The owner cannot read a helper's thread-local queue after delivery.
Translate with a per-operation table driven by Node's call sites. Match
its choice of primary error, message fallback on an empty queue, and
`opensslErrorStack` order and presence. For OpenSSL-decorated failures
replicate Node's library/reason normalization (for example
`ERR_OSSL_EVP_UNSUPPORTED`), and the presence of `library`, `function`
and `reason` where Node sets them. Some call sites supply an explicit
Node error and some failures are uncoded. Test these independently.
[Node error capture and decoration](https://github.com/nodejs/node/blob/v26.13.1/src/crypto/crypto_util.cc)
· [OpenSSL thread-local queue API](https://docs.openssl.org/3.5/man3/ERR_get_error/)

## Native validation

- **Pinned denominator.** Node tag `v26.13.1` resolves to
  `e9c277643b0249c50f6e6de5413be8a88ea11b6a`. The complete recursive tree
  contains **166** direct `test/parallel/test-crypto-*.js` files and no other
  files matching `test/parallel/test-crypto-*`. Record a sorted path manifest
  from that tree. Run the original files and their pinned harness and
  fixtures through Tint native output with each file's required flags and
  process isolation. One file is one denominator entry per platform and
  profile. Retain passes, Node-defined skips, unsupported host/harness
  capabilities, build and runtime failures, crashes and timeouts in the
  166, with the reason and first failure recorded. Run the separate **85**
  `test/parallel/test-webcrypto-*` files for the Web Crypto phase. Keep
  that total distinct, including when some Web Crypto tests already
  appear in the crypto selection. Use Node 26.13.1 oracle runs to
  establish expected behavior and provider-dependent skips.
  [Pinned test tree](https://github.com/nodejs/node/tree/e9c277643b0249c50f6e6de5413be8a88ea11b6a/test/parallel)
- **Fixtures and vectors.** Use `verifyHostedFixture` with
  `TINT_GENERAL_FALLBACK=0` to prove the typed path, an untyped equivalent
  and Node reference tests on common semantics. Return 42 on success and
  identify the first failed check otherwise. Add typed/untyped corpus cases
  and checker coverage as required. Cover empty input, block boundaries,
  Buffer identity and encodings, malformed keys, invalid tags, state and
  validation order, exceptions, queue isolation, aliasing across GC,
  helper saturation and completion versus termination. Pin Wycheproof
  cases for adversarial AEAD/key/signature inputs and NIST known-answer
  cases where the Node suite lacks coverage. Track vector counts separately.
  [Wycheproof](https://github.com/C2SP/wycheproof)
  · [NIST block-cipher vectors](https://csrc.nist.gov/projects/cryptographic-algorithm-validation-program/block-ciphers)
- **Evidence per phase.** Run the pinned crypto selection natively on all
  three targets and publish immutable reports with node pin, provider
  version/configuration, host target, selected manifest, exact outcomes and
  build manifests. Build fixtures with `TINT_BUILD_ONLY=1`, launch under
  LLDB and verify stop-at-entry and the expected inferior exit status.
  Preserve launch failures separately from failures after entry. Use UTC
  for comparable runs where the pinned harness permits it. Prove byte-identical
  self-build output against the matching baseline where crypto is unused,
  with frozen sources and stage-2/stage-3 comparisons. Run full macOS
  and Linux gates, both Test262 host smoke modes, and the convergence ledger
  before requesting final readiness. Use shared `dev` for local Linux
  validation and native Linux x86-64 CI as the authoritative x86-64 self-build
  gate. [Repository validation rules](validation-gate.md)
- **Performance.** Compare with Node 26.13.1 using the same algorithm,
  input bytes, chunk sizes, KDF parameters, CPU and provider profile.
  Record runtime and provider versions. Measure SHA-256/SHA-512, AES-GCM
  encrypt/decrypt and PBKDF2/scrypt/HKDF, with small-call latency and
  large-input or repeated-operation throughput as applicable. Cover sync
  and callback KDF latency, including queue delay under load and event-loop
  responsiveness. Report cycles and wall time and isolate startup, copying
  and queueing from the crypto work. Compare existing SHA-256 and the
  leaf-call microbenchmark before and after. Require no synchronous or
  leaf-call cost regression, with the timing lock for comparable native
  measurements. Reuse frozen workload timing if generated code changes.

## Schedule and decisions for review

Estimates total 12–20 engineering weeks for one engineer after approval.
They exclude gate queues and assume the shared byte, error and event-loop
primitives can be reused.

| Phase | Acceptance milestone | Estimate |
| --- | --- | --- |
| 2 | Pinned libcrypto artifact and typed loader work on all three targets. Ship hashing, core HMAC, randomness and timing-safe comparison with a native baseline and helper transport. | 2–3 weeks |
| 3 | Cipher/AEAD state and core KDF parity, with in-flight ownership and ordering proven under load. | 2–3 weeks |
| 4 | Key formats, asymmetric operations and lifetime management proven by interoperability and invalid-input tests. | 3–5 weeks |
| 5 | X.509 and Web Crypto with realm/worker integration and pinned Web Crypto runs. | 3–5 weeks |
| 6 | Finish remaining APIs and approved profiles. Close conformance gaps, rerun full gates and mark the draft ready after review. | 2–4 weeks |

Approve the dependency strategy before implementation starts. An archive
linker, unavailable harness/host capabilities or delivery of a validated FIPS
profile would need separate sizing. Land the stream as one PR. When the
event-loop PR merges, merge `origin/main` into this branch and retarget this
PR to `main`.

1. Approve pinned shared artifacts as the distribution and conformance
   baseline, or require a single-file static distribution up front?
2. Include an opt-in system/user backend in the first release? If so, which
   OpenSSL minor versions deserve an explicit support matrix?
3. Is validated FIPS required for this PR? If so, which operating
   environments, deployment policy and Node FIPS flags are required?
   Should the first release support explicit legacy-provider opt-in?
4. Confirm the API sequence, especially whether Web Crypto or asymmetric
   support should move ahead of the cipher and KDF milestones.
