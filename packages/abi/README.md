# Native ABI contracts

`@tint/abi/function` exports numeric constants for the existing 48-byte native
function record and version-1 signature descriptor: field offsets, traced-edge
counts, signature header/parameter widths and scalar encoding codes.

The entry is data-only and has no dependencies. It owns wire facts, not IR type
mapping, serialization, signature interning, authorization, pointer identity,
publication, invocation or garbage collection. `nativeSignatureTypeCode` remains
the emitter's adapter from scalar IR types to these codes.

Function records trace only the environment at byte 24; code/signature addresses
are not collector-managed edges. Lifetime and ownership remain caller contracts.
These facts do not authorize
cross-image calls or expose addresses to JavaScript. Context and general managed
heap schemas remain separate future extraction slices.
