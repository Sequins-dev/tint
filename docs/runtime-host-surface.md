# Compiler runtime and host surface

The first native compiler uses standard language globals plus a deliberately small
`node:fs` module. This is an explicit compiler-host contract, not a promise of general
Node compatibility. Portable compiler packages continue to use injected host interfaces;
the thin file adapter imports `node:fs` in both hosting environments. Node supplies that
module during bootstrap; native Tint will supply its own platform implementation.

Globals are reserved for standard language and Web-platform facilities used by the
compiler, including TextEncoder/TextDecoder. Tint-specific algorithms remain ordinary
modules with explicit imports; moving an API into a global does not reduce the native
implementation work. OS capabilities remain behind injected host contracts. In
particular, path handling, hashing and module resolution should reuse Tint packages
rather than introduce new globals or broader Node compatibility modules.

## Current dependency audit

The portable `packages/*/src` graph imports only local files and `@tint/*` packages.
There are no Node-module or third-party runtime imports in that graph. Development
TypeScript is a build/check/conformance tool, not a library embedded in the compiler.

| Dependency in tools/tests         | Native compiler requirement                                                                                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node:fs`                         | The seven synchronous operations below, used by the file adapter.                                                                                                         |
| `node:fs/promises`                | Workspace checking only; no async filesystem surface needed for the first compiler.                                                                                       |
| `node:path`, `node:url`           | Development file discovery and artifact paths. Native module resolution uses the source catalog and Tint resolver; no Node resolution or URL implementation is implied.   |
| `node:os`                         | Temporary test directories; not a compiler-core dependency.                                                                                                               |
| `node:crypto`                     | Independent test/reference hashes. Tint already owns SHA-256 and signing. Temporary file creation no longer uses randomUUID or requires entropy.                          |
| `node:child_process`              | Native tests launch artifacts and validate signatures. Compiler output uses Tint's linker, Mach-O writer and signing code; it does not launch a platform linker/compiler. |
| `node:test`, `node:assert/strict` | Development verification only.                                                                                                                                            |
| `typescript`                      | Development checking, conformance oracles and source inspection only.                                                                                                     |

The current core uses ordinary arrays/strings and the standard globals `Array`,
`Boolean`, `String`, `Number`, `Math`, `Map`, `Set`, `Uint8Array`, `Uint32Array`, `Float64Array`,
`TextEncoder`, `TextDecoder` and `TypeError`. Numeric constant emission now uses the
portable `@tint/foundation/binary/bytes` binary64 encoder, so it no longer needs ArrayBuffer/DataView. Additional
view types occur in API contracts and supported source programs. These identify
families, not a requirement to implement every method: the feature inventory tracks
actual operations. Native Tint implements the required subset of these globals in TypeScript.

The core does not currently depend on `Buffer`, `process`, `console`, `URL`, Web Crypto,
Promise, JSON, RegExp, Date, weak collections or a Node event loop. Build tools using
some of these do not automatically add them to the native compiler's runtime budget.

## Initial node:fs contract

The exact type surface is [runtime-fs.d.ts](../types/runtime-fs.d.ts):

- `openSync(path, "r" | "wx", mode?)` returns a numeric descriptor.
- `readSync(fd, Uint8Array, offset, length, null)` reads at the descriptor cursor.
- `writeSync(fd, Uint8Array, offset, length, null)` writes at the descriptor cursor.
- `closeSync(fd)` closes a descriptor.
- `fchmodSync(fd, mode)` applies the output permissions used by the host contract.
- `renameSync(oldPath, newPath)` publishes the completed temporary file.
- `unlinkSync(path)` cleans up a temporary file.

Paths are strings and buffers are Uint8Array. No Buffer, URL-path overload, string
encoding overload, arbitrary flag set, asynchronous operation or watcher is required.
Node supports Uint8Array for synchronous reads/writes; the bootstrap therefore needs
no Buffer-specific implementation. See the [Node fs API](https://nodejs.org/docs/latest-v24.x/api/fs.html).

Errors must be thrown with a stable string `code` consumed by the adapter, including
EINTR and EEXIST where applicable. Short reads/writes, EOF, interruption retries and
no-progress detection remain in `@tint/platform/io/sync`. Bounded reads, cleanup and publication
policy remain in `@tint/platform/files/service`. Reuse those primitives instead of reproducing
whole-file algorithms in the compatibility facade.

Temporary names use a process-local counter with bounded exclusive-create retries.
Exclusivity, not unpredictability, prevents overwriting existing files. No randomness,
process ID, timestamp or global crypto API is required. Platform-specific operations
and error translation sit below this shared adapter; Linux/macOS/Windows do not need
to share raw OS flags or native handle representations.

`tsconfig.host.json` checks the actual file adapter against this finite declaration
with Node ambient types disabled. `pnpm typecheck` includes that check. Adding another
Node export therefore requires explicitly extending the contract. The declaration is
not a native implementation: connecting it to native platform bindings remains work.

## Startup and diagnostics

Arguments, diagnostic output and exit status still require a small host startup contract.
They need not imply a full `process` global: startup can pass arguments to the compiler
entrypoint, diagnostics can use the byte writer/stdout/stderr descriptors, and the driver
can return an exit status. Node's wrapper may use process.argv/exitCode, while native
startup supplies the equivalent values. Keep compiler-global state and environment
variable access out of the core unless an explicit build input requires them.

## Isolated native agents

Threaded hosted images opt in through `BuildRequest.threaded` and a one-number
application entry. `hostedThreadEntry` is an image-owned thunk that initializes a
private managed context before forwarding its raw argument. Optional platform
thread create/join and parking/wake symbols are declared in `HostRequest`; Darwin
uses pthread and ulock through Tint's direct ABI and linker, Linux pthread and
futex(2) (`linuxHostABI`, [Linux target](linux-aarch64-target.md)). The monotonic clock shares one
process-wide origin across those contexts.

`@tint/native-runtime/agents` exposes context-local lifecycle and mailbox facades.
Only scalar descriptors and copied UTF-16 travel through raw shared mappings.
Shared blocks, waiter records and mailbox registries outlive referencing workers.
Trusted raw memory and thread leaves are explicitly bound by the embedding and
are never installed as Script globals. See [Atomics](atomics.md) and
[async runtime](async-runtime.md) for job delivery and validation boundaries.
