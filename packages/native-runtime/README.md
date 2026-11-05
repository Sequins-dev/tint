# Native runtime

Portable allocation, tracing, relocation and strict-value support, together with
compiler-authorized native operation declarations. Runtime initialization remains
at `@tint/native-runtime`; algorithms and trusted leaves have narrow entries.

- `/heap`, `/tracing`, `/graph`, `/relocation`: collection and relocation machinery.
- `/allocators/region`, `/allocators/linear`: allocation algorithms.
- `/values`: strict-profile primitive-value helpers.
- `/intrinsics/memory`, `/intrinsics/shared-atomics`: finite memory operation declarations.
- `/intrinsics/clock`, `/intrinsics/random`, `/intrinsics/process`, `/intrinsics/spin-hint`, `/intrinsics/fs`: finite host declarations.
- `/shared-blocks`: bounded shared-storage service and explicit host adapters.

A public export does not authorize a host operation. The compiler's explicit
`NativeHostBinding` contracts verify and replace selected declarations; direct
Node invocation retains the unavailable-host behavior. Filesystem policy and
error translation belong to platform adapters. Runtime helper namespaces remain
independent of package ownership.

Shared function/signature and shared-block wire contracts live in `@tint/abi`.
Byte-storage entrypoints remain independent of the JavaScript object model.
