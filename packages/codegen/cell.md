# @tint/codegen/aarch64/cell

Direct AArch64 code generation for guarded, pointer-free lexical-cell access. Reuses
`@tint/codegen/aarch64/isa` for instruction encoding and branch relocation. No parser, source type
checker, allocator, C compiler, object linker or platform dependency.

`emitCellAccess({operation, stateOffset, valueOffset, byteLength, mutable}, maxByteLength=1024)`
returns a complete leaf helper's machine code or an explicit layout/budget/encoding
failure. Offsets are relative to the environment **payload**, as in closure-layout's
cell records. A caller holding an object-base pointer must add its payload offset
before calling. State and payload byte ranges must not overlap. Offsets are bounded
at 4095 and payload length at 4096 bytes; zero-length payloads are supported. No bytes
are returned on failure. Outputs are deterministic for identical inputs.

## ABI and state protocol

- x0: valid environment payload base, with a readable state byte and the required
  readable/writable cell payload for successful operations.
- x1: transfer buffer, writable for reads and readable for initialize/write.
- w0 result: 0 success, 1 uninitialized access, 2 repeated initialization,
  3 immutable write, 4 invalid state byte.
- Clobbers x0–x5 and NZCV. Preserves SP, LR and all other registers. No calls,
  safepoints, stack frame, FP instructions or hidden host services.

State is exactly 0 (uninitialized) or 1 (initialized). Guards execute before payload
or transfer-buffer access. Reads/writes require state 1. Initialize requires state 0
and permits immutable cells. Ordinary writes check initialization before immutability,
so writing an uninitialized const reports uninitialized access. Any other state byte
fails explicitly. Failed operations leave cell and transfer storage unchanged.

A successful read copies payload bytes into the transfer buffer. Initialize/write
copy in the other direction. Initialize publishes state 1 only after the complete
copy. Writes retain state 1. Copying preserves arbitrary bits,
including floating-point payloads and union tags; unaligned payloads are permitted.
Payloads up to 32 bytes use unrolled 64-bit copies followed by exact byte tails;
larger payloads retain the bounded byte loop. There is no overlap handling: transfer and cell/state ranges must be disjoint, and
all relevant pointers/ranges must be valid without address wrap. Transfer buffers may
be inaccessible on failing paths because the guard must prevent their use.

This is a synchronous, single-mutator, pointer-free primitive. It is not atomic,
concurrently readable, or transactional on hardware faults. No allocation/GC may
interrupt the copy. State initialization, valid object descriptors and rooting belong
to the caller. Do not use this helper to update managed-reference payloads before
tracing and barrier requirements have been integrated. The emitter has byte-layout
inputs and cannot establish that a source type is pointer-free or safely borrowed.
Status-to-language-exception conversion remains the caller's responsibility.

## Verification and integration boundary

`TINT_NATIVE_LLDB=1 pnpm verify:cells` runs under LLDB to suppress crash reports.
`pnpm verify:cells` builds internally linked/signed macOS arm64 executables around
these generated helpers. Forty-two fixtures run twice each and compare every byte
of cell, transfer storage and surrounding canaries. Failed guards receive a null
transfer pointer to detect accidental access. Cases include zero-length payloads, word boundaries, the 32-byte unrolling boundary,
and larger payloads, unaligned copying, immutable initialization/writes and corrupt
states. The adapter is hand-emitted test scaffolding; the helpers themselves come from
this package. This does not demonstrate source-to-native closures or native GC.

The shared encoder now provides byte load/store instructions; its independent LLVM
oracle covers register roles and boundary offsets. Portable emitter tests cover
repeatability, rejection and byte budgets. Other hosts can consume the same arm64
bytes, but this native execution gate currently verifies macOS arm64 only.
