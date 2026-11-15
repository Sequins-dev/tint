# Heap and root descriptors

The production AArch64 emitter writes compact descriptors consumed by
`@tint/native-runtime/tracing`. Descriptors describe realized storage; they do not
execute TypeScript types or the retired generic trace-plan prototype.

## Realized storage contract

- Managed allocations have a two-word header. Exact extents and specialized
  string/array/view headers are validated by the native runtime before scanning.
- A record descriptor contains its byte length, reference count and offsets,
  then general-value count and offsets. Offsets are relative to the object header.
- Stack frames have no root header: each safepoint's map (see
  [GC stack maps](gc-stack-maps.md)) contains the frame size and reference and
  general-value counts/offsets relative to the frame's stack pointer. Scalar
  machine words are not inferred to be roots.
- General values occupy two words: category and payload. Only string, object,
  symbol and bigint categories authorize tracing the payload as a reference.
  Numeric payload bits never become pointers merely because they resemble one.
- A function record has an explicitly branded physical layout and a managed
  environment field. Its signature and brand authority are separate from an
  ordinary record with coincidentally matching fields; see `@tint/abi/function`.

Readers authorize descriptor/object access. Scanners validate extents, offsets,
category tags, references and traversal limits, and report failure instead of
letting incomplete scans authorize reclamation. Verified compiler descriptors
can avoid repeated static checks; they do not waive dynamic validation.

## Producers, consumers and verification

The physical record planner is in `@tint/ts-native/closure/lowering`; codegen
emits record and root metadata with machine code. Native-runtime owns scanning,
marking, evacuation and reference fixups. Shared realized wire contracts belong
to `@tint/abi`; remaining duplicated constants should be centralized there as
those contracts are clarified, rather than reviving a parallel tracing language.

[Production descriptor integration tests](../tools/production-descriptor-contract.test.ts)
feed emitted closure/record/root metadata directly to the real scanner. The
native-runtime suites additionally cover invalid metadata, cycles, exact roots,
backing/view relocation, failed collection and allocation reuse. These Node tests
complement native fixture execution and self-build verification.

The earlier proposed generic descriptor vocabulary is retained in the
[historical design](archive/heap-descriptors-prototype.md). Its four prototype
packages had no production consumers and are retired; the
[retirement audit](framework-prototype-retirement.md) records replacement checks.
