# Codegen framework

AArch64 instruction encoding and existing native emission through direct entrypoints:

- `@tint/codegen/aarch64/isa`: instruction encoder and address/branch patching.
- `@tint/codegen/aarch64/cell`: independently callable cell access helpers.
- `@tint/codegen/aarch64/scalar`: scalar IR emission, current ABI adapters and native metadata.
- `@tint/codegen/aarch64/barrier`: remembered-set barrier instruction generation.

See [ISA](isa.md), [cells](cell.md) and [scalar emission](scalar.md) for API contracts.

Codegen depends only on foundation, IR and the data-only ABI package. Image
construction consumes the ISA encoder; codegen does not depend on image writers.
Darwin host policy and context/signature register assignment retain their current
scalar implementation ownership pending separate contract extractions. This move
preserves the existing instruction generation and introduces no new machine IR.
