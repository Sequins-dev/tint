# @tint/platform/io/sync

Dependency-free synchronous byte transfer loops, independent of files, descriptors,
platforms and compilers.

- `readAll(reader, maxByteLength)` reads to EOF and returns newly owned bytes.
- `writeAll(writer, bytes)` writes the entire borrowed view and returns its length.

A reader receives a writable `Uint8Array` view; a writer receives a read-only borrow
of a `Uint8Array` view. Both return `IOResult<number>`: `{ ok: true, value: count }`
or `{ ok: false, error }`. A reader fills exactly the first `count` bytes. Callbacks
must not retain the view or change its backing buffer, and writers must not mutate
input. Ordinary TypeScript cannot enforce that borrowing contract yet.

A host error is `{ kind: "host", code: string, interrupted: boolean }`. Adapters
capture the error before any further host calls; the core treats its code as opaque.
Only an interrupted read/write is retried. An interrupted result must imply zero
transfer; partial progress must be returned as a successful count. Other errors,
including would-block, terminate. No cancellation, scheduling or retry budget exists.

Successful read count zero means EOF. Successful write count zero for nonempty input
is `no-progress`, preventing an infinite stalled loop. Fractional, negative, nonfinite
or over-request counts produce `invalid-count`. Empty writes never call the writer.
A failed transfer may already have consumed or written a prefix; there is no rollback.

Read limits are integers from zero through `0xffffffff`, validated before callbacks.
A read may consume **one byte beyond the limit** to distinguish exact-size EOF from
oversize input; oversize input returns `limit`, without a partial result. Empty input
with a zero limit succeeds. Reads use a reusable buffer of at most 64 KiB and retain
copies of successful chunks, then assemble the owned result. The limit bounds result
bytes, not peak allocation or per-chunk overhead. Allocation failures may throw.

These functions never close resources. Callers own their lifetime. Tests use actual
stateful readers/writers to cover short transfers, interruptions, EOF, size boundaries,
invalid counts, stalled writes, errors and input/output ownership.
