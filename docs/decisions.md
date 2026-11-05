# Decisions and open questions

Recorded from the design discussion on 2026-10-26. This file separates user-set
constraints from implementation proposals so tentative choices do not become
accidental requirements.

## Agreed direction

- The first target is the current macOS host: Apple silicon / AArch64 (arm64).
  Linux is an intended supported platform and the long-term primary target; Windows
  is a likely later addition. Implementation order does not imply product priority.
  Architecture, ABI, OS services and image publication remain separate from the
  beginning; see the [platform roadmap](platform-roadmap.md).
- Adopt the [logical call contract](call-contract.md): explicit context/environment
  where needed, typed and general entries, semantics-preserving argument/receiver
  handling, normal/throw outcomes, rooted result handoff, stable callable identity,
  versioned code dependencies, and conservative call effects. The physical ABI now
  has a concrete proposal in the target contract, pending implementation validation.
- Adopt the [shared lifetime baseline](memory-and-lifetimes.md): one precise
  non-moving collector per instance for both modes, allocation-pressure collection
  at explicit safepoints, compiler-managed shadow roots, rooted result handoff,
  independent collector storage, tracked code-version lifetime, and explicit
  external resource cleanup. Physical layouts, tuning, and target ABI remain open.
- ECMAScript is the baseline for observable behavior; TypeScript guides additional
  syntax and static types. Follow specified behavior first. Discuss implementation
  freedom and host/extension choices in the spirit of related spec operations,
  recording strict-profile restrictions explicitly. See [Semantic baseline](semantic-baseline.md).
- Live type violations can warn, deoptimize, and generalize storage/code to handle
  actual values rather than reject assignments. Declared expectations remain
  distinct from widened runtime domains. Strict/foreign boundaries retain explicit
  fixed-layout contracts.
- The compiler uses the same strict/native subset as other native code; bootstrap
  feature tracking is an implementation inventory, not a separate language profile.
- The first executable deliverable is the self-hosted compiler. Prioritize its
  native self-build, with a small file-I/O-oriented host surface, before live code
  execution, continuous optimization, or another tooling product.
- Live mode preserves ordinary JavaScript semantics, including type violations
  TypeScript permits. Retained types guide optimization and optional diagnostics;
  recovery repairs invalid specialization assumptions, not program logic. Preserve
  normal coercions, side effects, identity, and exceptions without new type-contract
  rejection. Strict/native mode rejects unsound patterns that live mode can handle.
- Wasm support is deferred: an optional output backend and, separately, a possible
  input frontend. Neither is a required intermediate stage or part of current
  native pipeline/bootstrap work.
- Tint owns a TypeScript-to-native pipeline and invests primarily in that pipeline.
- Live and AOT modes share TypeScript-owned infrastructure through native instruction
  generation. A bytecode IR or VM is permitted, but not selected; bytecode-to-native
  translation must integrate with the same pipeline.
- No C intermediate, external native compiler, or platform linker.
- Tint owns machine-code encoding, linking, executable-memory publication, and
  executable-file generation.
- AOT optimization and JIT-style continuous optimization use the same compiler
  machinery. Direct baseline translation comes first; advanced optimization follows.
- Bootstrap AOT output first: Node runs Tint's AOT compiler and writes a standalone
  executable containing the compiler and runtime. Dynamic compilation/execution
  runs inside that native build, not inside Node or a Node-driven compilation service.
- Standalone self-hosting is a destination, not a replacement for the Node module.
  Keep the Node-hosted AOT compiler as a first-class interface for native libraries
  consumable through Node FFI and standalone developer-tool executables. Executing
  generated code in Node is not a bootstrap prerequisite.
- A central product goal is performant tooling authored in TypeScript, retaining
  an accessible contribution path for JS/TS users instead of requiring a rewrite
  in another implementation language.
- QuickJS-NG is reference and inspiration only. TypeScript is a conformance guide;
  broad compatible-mode coverage remains a goal.
- A stricter native profile may reject unsound patterns, but exclusions should be
  minimized rather than replacing TypeScript with a substantially different language.
- Tagged unions are acceptable even with space/runtime overhead. Union variables
  can change variants; narrowed access is required for variant-specific operations.
- Internal link units need not use standard object-file formats. ESM semantics
  should be represented directly.
- Strict and compatible/live code should support different encodings: stronger
  shape contracts enable fixed layouts, while dynamic behavior needs more general
  values and object storage. Sharing the pipeline does not require identical storage.

## Provisional proposals

- The [strict-checking cases](strict-checking-cases.md) define initial writable-view,
  union-mutation, presence, effect/refinement and assertion rules, with no ordinary
  strict `any` escape hatch.
- The [build-input contract](build-inputs.md) selects explicit source catalogs and
  relative `.ts` imports, strict UTF-8 decoding, snapshot-based builds and a CLI entry
  convention. Package resolution is deferred.
- The [conformance baseline](conformance-baseline.md) pins TypeScript 6.0.3 and
  ECMAScript 2025 as initial references with separate coverage/strict-rejection reports.

- The [IR contract](ir-contract.md) specifies shared graph infrastructure with semantic,
  representation and machine operation sets; block-parameter SSA, explicit exceptional
  control flow, proof/effect tracking and root verification connect the stages.
- The [heap/root descriptor contract](heap-descriptors.md) records production
  object headers, compact reference/general-slot descriptors, linked shadow-root
  frames and explicit validation. Compiler emission and native-runtime scanning
  share realized storage contracts; the unused generic tracing prototypes are retired.

- The [trusted intrinsic contract](trusted-intrinsics.md) bounds raw storage, word
  arithmetic, roots and foreign calls with explicit capabilities/effects. Propose
  non-allocating fatal OOM handling for the first standalone compiler.
- The [compiler feature inventory](bootstrap-feature-inventory.md) defines required
  source/builtin coverage and deliberate source deferrals within the same strict
  profile. Descriptor-passing generics are the baseline; specialization is optional.

- The [macOS arm64 target contract](macos-arm64-target.md) defines libSystem host
  imports, a private typed/general register ABI with caller-owned result areas,
  a Mach-O PIE writer with chained fixups, and self-written ad-hoc signing. Initial
  support targets the current host; live memory publication follows self-build.
- The [self-hosting runtime map](self-hosting-runtime-map.md) proposes one managed
  heap, shadow roots, shared binding cells, completion-aware CFG lowering, standard
  byte-buffer views, and synchronous file-oriented host services. These mechanisms
  implement the semantic baseline rather than change it.
- Keep language profile, output destination, and optimization policy independent.
- Use tagged values and shape-described objects as the dynamic baseline, fixed
  layouts where proven in strict code, and explicit shared representation lowering.
  Exact tags and sizes remain open; a tagged value need not allocate a wrapper.
- Permit untagged values in proven/guarded regions and specialized call ABIs.
  Keep runtime evidence at dynamic boundaries; IR knowledge alone cannot classify
  arbitrary incoming values. Specialization misses need not immediately recompile.
- Explore ESM entrypoint exports as native library interfaces with generated C ABI
  adapters, headers/manifests, and explicit ownership/error/initialization contracts.
  This introduces no C intermediate or external linker into Tint's build pipeline.
- Use typed semantic IR, native SSA IR, and machine IR with explicit verifiers.
- Allow `as T` when already proven safe under strict structural assignability;
  reject unproven narrowing even between related classes.
- Initially exclude user-authored predicate/assertion signatures from strict mode.
- Use invariant writable views and effect-aware invalidation of refinements.
- Use direct baseline native compilation as the current working proposal, subject
  to evaluating bytecode as IR or a VM tier.
- Start code replacement by redirecting future calls; defer on-stack replacement
  and general deoptimization. Baseline native code is the proposed fallback;
  a VM fallback remains possible if a bytecode tier is adopted.

## Unresolved choices

- If Wasm work is resumed: feature baseline, linear-memory runtime versus WasmGC,
  host bindings, and scope of external Wasm validation/compilation support.
- Whether bytecode should represent an IR, provide a baseline VM tier, or be omitted;
  how it preserves type/effect metadata and shares lowering with the native pipeline.
- Implement and validate the initial strict rules, including generic/alias
  counterexamples; extend formal coverage as additional language features arrive.
- Whether verified user predicates should follow the initial exclusion, and which
  boolean-helper relationships can be inferred without explicit predicate syntax.
- Implement coverage reporting against the pinned baseline; select exact development
  host tooling and imported conformance-suite revisions during scaffolding.
- Runtime contract vocabulary, descriptor placement, alias-aware invalidation,
  live storage generalization, state recovery, and diagnostics. Warnings alone
  cannot justify retaining an invalid specialized representation.
- Validate the proposed macOS arm64 executable/signing/host-import contract against
  directly executed artifacts; specify serializer constants and intrinsic lowering.
- Physical heap/root layouts, collector tuning, numeric intrinsics and metadata
  encoding; validate the proposed target ABI lowering. The lifetime and logical
  call baselines are accepted.
- Cross-profile object identity and exposure contracts, shape transitions, structural
  view descriptors, and whether strict storage can ever be transparently promoted.
- Profiling granularity, recompilation budgets, dependency invalidation, and eventual
  deoptimization/on-stack-replacement mechanisms.
- Extend the initial source-catalog resolver to packaging when needed; validate
  native import trust and dynamic code lifetime as those capabilities arrive.
- Native library export selection/naming, supported ABI types, context/handle
  ownership, async initialization, callback/thread rules, and versioning.
- Supported Node FFI versions/builds, generated binding policy, native artifact
  packaging, and the initial developer-tool workloads used to validate the product.

## Superseded discussion proposals

- Generating C and invoking a system compiler or linker.
- Reusing the upstream TypeScript frontend as a required compiler component.
- Literal porting of QuickJS-NG or preserving its bytecode/C ABI compatibility.
- Prioritizing dynamic hosting before executable-file output, or requiring a Node
  native execution bridge/child-process compilation protocol for bootstrap.

These are explicitly superseded, not optional shortcuts for later milestones.

The earlier categorical prohibition on bytecode VMs and interpreter fallback is
also withdrawn. The clarified requirement is shared compilation infrastructure,
not a mandatory execution-tier design.
