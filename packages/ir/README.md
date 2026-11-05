# IR framework

Tint's existing scalar IR, semantic operation handles, analyses and optimization
passes, with independently reachable public entrypoints:

- `@tint/ir/scalar`: model, builder, verification and analyses.
- `@tint/ir/semantic`: semantic operation handles and caller-owned type knowledge.
- `@tint/ir/optimization`: existing bounded optimization pipeline.
- `@tint/ir/optimization/slots`: direct slot transformation API.
- `@tint/ir/optimization/reference-lists`: direct managed list adaptation API.

The framework depends only on foundation. Generic graph and bit operations remain
in foundation. It has no TypeScript frontend, execution runtime or codegen dependency.

The scalar vocabulary remains JavaScript-shaped, including managed strings and
general values. The reference-list optimization still adapts the managed SparseList
ABI under the compiler's explicit proofs. That adapter temporarily lives here; it
is not a language-neutral optimization or permission to reinterpret other layouts.

This consolidation preserves the existing APIs and pass order. It introduces no
new machine IR or pass manager.
