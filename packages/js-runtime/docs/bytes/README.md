# @tint/js-runtime/bytes

Owned, zero-initialized byte storage with resize, detach and transfer operations.
It has no JavaScript object model or platform dependencies. The embedding chooses
an allocation limit separately from each buffer's logical maximum length.

Resize preserves the surviving prefix and clears newly exposed bytes. Transfer
allocates and copies before detaching the source; validation failures leave the
source untouched. Detached storage is distinct from a live zero-length buffer.

`byteStorageData` borrows the current bytes. Reacquire that view after any operation
that can resize, transfer or detach; do not retain a borrowed view as a lifetime-safe
reference. Mutate lifecycle state only through the package's public functions.

`byteStorageWindow` borrows a fixed-length or length-tracking element view. It
reports the number of complete elements and rejects detached or out-of-bounds
views. A fixed view can become valid again after regrowth; callers must reacquire
the window after observable code that may change storage.

`@tint/js-runtime/bytes/shared` provides a separate shared-block storage contract.
Embeddings explicitly inject a trusted service owning stable, zeroed block
reservations and authoritative ordered logical lengths. Aliases use primitive
engine/block identities; growth publishes length without moving or copying bytes.
Fixed and tracking view witnesses capture one length read after observable hooks.
Byte access remains separate from aligned integer access, and 64-bit payloads use
exact `Word64` halves.

This contract does not install a Script `SharedArrayBuffer` constructor or provide
a native block service. The Node-only reference adapter in tools uses real host
shared memory; it is not a portable fallback or a proof of native concurrency.
