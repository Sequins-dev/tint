# Native filesystem bindings

A finite synchronous filesystem surface for the native compiler. The public
functions match the supported `node:fs` call shapes: `openSync` (`r` and `wx`),
`readSync` and `writeSync` with a `Uint8Array` and `position: null`, `closeSync`,
`fchmodSync`, `renameSync`, `unlinkSync`, and UTF-8 `readlinkSync(path)`. `createNativeFileHost` exposes the
same implementation through the structured `FileHost<number>` contract.

The resolver permits `node:fs` only with an explicit package import mapping.
The native compiler caller must also authorize each leaf in `src/host.ts` using
`NativeHostBinding` and declare that module as a runtime. These leaves throw
when executed in Node; the Node bootstrap uses Node's own filesystem instead.
The compiler validates and replaces the leaf bodies with host-call IR. It does
not compile C or invoke a platform linker.

`createFileSystem` accepts an injected `RawFileHost`. Paths use the standard
`TextEncoder` global and reject embedded NULs and unpaired UTF-16 surrogates.
Raw calls return nonnegative successes or negative errno values captured before
managed allocation. The adapter preserves interruption information for retry
policy in `sync-io`. Close is never automatically retried. Temporary files use
exclusive creation and mode 0600, with bounded collision retries.

`readlinkSync` returns the link's target text without following it. The byte buffer
grows when the host reports a full buffer, preventing silent truncation. Growth is
bounded at 1 MiB; an unresolved full buffer throws `ENAMETOOLONG`. Target decoding
uses the standard TextDecoder replacement policy. Node's encoding/options
overloads are outside this finite facade.

The current exported instance uses Darwin errno names. OS ABI details belong to
the backend policy, not to the public filesystem contract. Linux and Windows
implementations remain future work. Thrown filesystem failures currently carry
`name`, `code`, `message`, and `syscall` fields; a full Node Error prototype and
Node's broader overload/coercion behavior are not implemented.

Tests exercise injected failures and selected buffer ranges. The native
construction fixture executes the actual adapter against macOS files, including
UTF-8 filenames and missing-file errors.
