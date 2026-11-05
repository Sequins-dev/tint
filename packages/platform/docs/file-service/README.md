# @tint/platform/files/service

Synchronous file lifetimes and staged output publication. Depends only on
`@tint/platform/io/sync` for transfer loops and their error contract. No filesystem API,
path syntax, descriptor representation or executable format is built into this package.

`readFile(host, path, maxByteLength)` opens a file, reads bounded bytes to EOF, and
attempts close once. `publishFile(host, destination, bytes, executable)` creates a
new temporary file, writes all bytes, sets permissions, closes it, then replaces
the destination. Input bytes are borrowed synchronously and never modified.

Both return `{ ok: true, value }` on success. Failure is
`{ ok: false, error: { operation, cause }, cleanup, temporaryPath? }`.
`cause` is an IOError; `cleanup` preserves subsequent close/remove failures in order.
If publication acquired a temporary file, its path is included on failure even if
cleanup succeeded. This allows reporting or recovering leftovers when removal fails.
Read success owns its byte array; publication success has an undefined value.

## Host contract

`FileHost<H>` uses an opaque handle type and synchronous function properties:

- `openRead(path)` returns an owned handle or a failure with no acquired resource.
- `createTemporary(destination)` exclusively creates a fresh file on the destination
  filesystem and returns `{ path, handle }`. Failure leaves no acquired resource.
- `read(handle, destination)` and `write(handle, source)` follow sync-io's count and
  interruption rules; the host advances its file position by successful counts.
- `setPermissions(handle, executable)` sets the requested output permission policy.
- `close(handle)` attempts release. The service never reuses or retries that handle,
  even on interruption. A failed close does not prove that the OS resource is closed;
  each platform adapter must document its handling of ambiguous close outcomes.
- `replace(temporary, destination)` atomically replaces the destination on success.
  On failure it must leave the previous destination intact and the temporary path
  available for cleanup. Hosts unable to provide this guarantee must reject it.
- `remove(path)` attempts to remove only the temporary path acquired by this operation.

Paths are opaque to the core. The adapter is responsible for path encoding, temporary
name selection, permission policy and platform error capture. Callbacks return errors
for expected failures. They do not throw. Allocation/programming exceptions propagate;
finally blocks still attempt resource cleanup, but exceptions are outside the structured
error envelope and a cleanup callback that itself throws can supersede an exception.

Only transfer interruptions are automatically retried. Open/create/permissions/close/
replace/remove errors are returned. No original destination is opened for truncation.
A failed operation can leave a temporary file if removal fails; that failure is reported.
This is atomic visibility under the host contract, not crash durability: no fsync,
directory sync, multi-file transaction, hostile-directory protection or cancellation
is provided. Calls require exclusive logical ownership of handles and temporary paths.

## Evidence and remaining work

Portable tests model short transfers and failures at every lifecycle stage, including
simultaneous primary/cleanup errors, exact limits, close-once behavior and exceptions.
[The development Node adapter](../../tools/node-file-host.ts) implements the contract
with Node 24 synchronous filesystem APIs. It creates random exclusive sibling files
with initial mode 0600, sets final permissions to 0644 or 0755, and uses rename for
replacement. Real-file tests verify binary round trips, limits, permissions, failed
writes/replacement and temporary cleanup. Tested on macOS; other hosts remain unverified.

`pnpm verify:files` separately emits and signs hand-authored arm64 file-copy fixtures
through Tint's encoder/publisher. It checks empty and binary files, seven-byte read
requests, stack-passed variadic `open` mode (without a later chmod masking the result),
executable permissions, immediate errno capture, exclusive-create collisions, read
and rename failures, and temporary removal. No external compiler/linker/signer is used.

Those fixtures exercise native bindings, **not native compilation of this TypeScript
package**. Native EINTR/short-write injection and cleanup-failure reporting are not
verified by these fixtures; they are covered by portable stateful tests. The frontend
and managed runtime must exist before the same service source runs natively.

References: [Node 24 fs](https://nodejs.org/docs/latest-v24.x/api/fs.html),
[Apple open(2)](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/open.2.html),
[Apple arm64 ABI](https://developer.apple.com/documentation/xcode/writing-arm64-code-for-apple-platforms),
and [Darwin open flags](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/fcntl.h).
