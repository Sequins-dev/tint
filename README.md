# Tint

Tint is a self-hosted TypeScript compiler and runtime that compiles directly to
native machine instructions using its own code generation, linking and executable
publication machinery. Node.js hosts the bootstrap build; the resulting native
compiler can rebuild itself on macOS arm64.

The shared pipeline supports ahead-of-time compilation and native runtime code
generation. Portable TypeScript implementations provide managed allocation and
collection, JavaScript object semantics, and standard text-encoding globals.
Language and API coverage are still expanding; see the current
[bootstrap evidence](docs/bootstrap.md) and [Test262 dashboard](docs/test262.md).

The source framework supplies immutable text/position views, logical catalogs and
explicit package-scoped import resolution through independent public entrypoints.
The TypeScript frontend parses those views into spanned ASTs; checking, lowering,
optimization and native emission remain separate compiler stages.

Use Node 24.12+ (24.x), run `pnpm install --frozen-lockfile`, then `pnpm check`.
See [workspace contracts](docs/workspace.md), [closure lowering](packages/ts-native/README.md), and the package contracts:
[foundation binary algorithms](packages/foundation/README.md),
[generic linked sets](packages/foundation/README.md), [generic linked maps](packages/foundation/README.md),
[image layout, debug information and Darwin images](packages/image/README.md),
[AArch64](packages/codegen/README.md),
[synchronous I/O](packages/sync-io/README.md), [file services](packages/file-service/README.md),
[source text, catalogs and resolution](packages/source/README.md),
[source module linking](packages/ts-native/README.md),
[text scanner](packages/text-scanner/README.md), [TypeScript understanding](packages/typescript/README.md),
[scalar IR](packages/ir/README.md),
[scalar lowering](packages/ts-native/README.md),
[scalar AArch64](packages/codegen/README.md),
[storage layout](packages/storage-layout/README.md), [trace plans](packages/trace-plan/README.md),
[GC tracing](packages/gc-tracing/README.md), and
[region allocation](packages/region-allocator/README.md), and
[numeric list storage](packages/foundation/README.md), and
[generic sparse lists](packages/foundation/README.md).
Run `pnpm verify:macos`, `pnpm verify:files`, `pnpm verify:regions`, and `pnpm verify:scalar-native`
on macOS arm64 for native execution gates. `pnpm verify:construction` additionally
executes source objects and the composed bytes/word64 dependencies with the compiled
allocator. These are dependency gates, not a self-hosted compiler build.

The long-term goal is native developer tooling that remains authored and
maintainable in TypeScript. Tint's Node module will remain a first-class AOT build
interface for FFI-compatible libraries and standalone executables after self-hosting.

macOS arm64 is the first bootstrap target. Linux is the intended long-term primary
platform; Windows support is a likely later addition. The core is designed for
multiple hosts and architectures from the outset.

## Design documents

- [Semantic baseline](docs/semantic-baseline.md): specification-first behavior,
  implementation freedom, and explicit host/strict-profile extensions.
- [Self-hosting runtime map](docs/self-hosting-runtime-map.md): semantic obligations,
  proposed mechanisms, source dependencies, IR operations, and acceptance cases.
- [Memory and lifetimes](docs/memory-and-lifetimes.md): shared collector baseline,
  safepoints, root handoff, live-code reclamation, and external resource cleanup.
- [Call contract](docs/call-contract.md): accepted logical ABI, typed/general entries,
  receivers, rooted results, exceptions, and four worked lowering traces.
- [Platform roadmap](docs/platform-roadmap.md): macOS first, Linux as the intended
  primary platform, likely later Windows support, and portable/host-specific boundaries.
- [macOS arm64 target](docs/macos-arm64-target.md): proposed host bindings, physical
  call ABI, Mach-O startup/linking, self-written signing, and validation gates.
- [Native Number semantics](docs/native-number-semantics.md): conversion/remainder
  algorithms, numeric helper contracts and native differential evidence.
- [IR and verifier](docs/ir-contract.md): shared graph structure, semantic and
  representation operations, effects, proof tracking, safepoints and verification gates.
- [Heap and root descriptors](docs/heap-descriptors.md): target-derived headers,
  bounded trace plans, initialization, shadow roots and collector traversal.
- [Trusted intrinsics](docs/trusted-intrinsics.md): machine words, raw regions,
  managed roots, foreign calls, effects and Node/native execution boundaries.
- [Compiler source inventory](docs/bootstrap-feature-inventory.md): required language
  and builtin coverage, generic lowering, source discipline and self-build gates.
- [Strict checking cases](docs/strict-checking-cases.md): initial acceptance/rejection
  rules for aliases, unions, presence, refinements and assertions.
- [Build inputs](docs/build-inputs.md): source catalog, explicit imports, decoding,
  executable entrypoint and deterministic build requests.
- [Conformance baseline](docs/conformance-baseline.md): pinned references, development
  checking options and coverage reporting.
- [Implementation readiness](docs/implementation-readiness.md): contracts to clarify
  before substantial implementation, proposed defaults, and safe deferrals.
- [Product direction](docs/product-direction.md): TypeScript tooling, durable Node
  integration, incremental adoption, and performance/contribution goals.
- [Architecture](docs/architecture.md): compilation, optimization, runtime,
  linking, and output formats.
- [Language profiles](docs/language-profiles.md): TypeScript compatibility,
  strict native soundness, unions, assertions, and dynamic boundaries.
- [Runtime type contracts](docs/runtime-types.md): retained type expectations,
  speculative optimization, transparent recovery, and optional diagnostics.
- [Value representations](docs/representations.md): fixed strict layouts, dynamic
  tagged values and objects, boundary adapters, and shared representation lowering.
- [Native libraries](docs/native-libraries.md): proposed ESM export projection to
  C-compatible interfaces, ownership, initialization, and ABI adapters.
- [WebAssembly](docs/webassembly.md): deferred, optional output backend and input
  frontend; neither is a required intermediate stage.
- [Bootstrap and validation](docs/bootstrap.md): Node bootstrap, native hosting,
  self-hosting, milestones, and correctness evidence.
- [Decisions and open questions](docs/decisions.md): agreed constraints,
  provisional proposals, and unresolved choices.

## Fundamental constraints

- Live and AOT modes share TypeScript-owned compilation infrastructure through
  native instruction generation. Bytecode as IR or a VM execution tier remains an
  open option; it must integrate with that pipeline rather than replace it with
  an unrelated compiler backend.
- Tint owns instruction generation and linking. There is no C intermediate,
  external native compiler, LLVM dependency, or platform linker in the pipeline.
- The compiler and runtime are authored in TypeScript. Node initially hosts only
  the AOT compiler, which produces a standalone executable containing the compiler
  and runtime. Dynamic compilation/execution is hosted inside that native build.
- QuickJS-NG supplies reference material and inspiration, not an embedded engine.
  TypeScript supplies a conformance target, not a required upstream frontend.
- Dynamic compatibility should approach complete TypeScript capability coverage.
  A strict profile may reject specific unsound patterns while preserving as much
  ordinary TypeScript as possible.
- Live mode retains type information for optimization and optional diagnostics
  while preserving ordinary JavaScript semantics through deoptimization/recovery.
  The first executable deliverable is Tint compiling itself in the same strict
  profile available to native applications; there is no separate bootstrap dialect.
- Correct, direct code generation comes first. The architecture must support
  increasingly powerful shared AOT and JIT optimization without a second compiler.
