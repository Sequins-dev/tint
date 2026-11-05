# Implementation readiness

Status: original design checklist, now accompanied by implemented compiler slices.
The [workspace ledger](workspace.md) is the current implementation/evidence record.
Native factory/closure lowering compiles the unchanged region allocator, but the
compiler does not yet rebuild itself. Managed graphs, strings/collections, broader
frontend coverage and CLI composition remain required.

The broad architecture is sufficient to begin specifications and small experiments.
Before substantial implementation, settle a few contracts that cross subsystem
boundaries. Do not treat every open question as a blocker.

Apply the [specification-first baseline](semantic-baseline.md) throughout: establish
required language behavior before selecting implementation mechanisms. The questions
below concern gaps and concrete mechanisms, not permission to redefine specified
JavaScript behavior.

The [self-hosting runtime map](self-hosting-runtime-map.md) records the first concrete
pass through these questions, with semantic obligations, proposed mechanisms, and
acceptance cases. Its mechanism choices remain proposals to validate.

## 1. Inventory native-profile features required for self-hosting

The [compiler source inventory](bootstrap-feature-inventory.md) now supplies a
concrete proposed language/builtin budget, generic strategy and evidence ledger.
It must be checked against actual source as implementation begins.

Create a concrete feature inventory for the TypeScript used to implement Tint:
functions/recursion, records, unions, arrays, strings, modules, closures, generics,
exceptions, and the collections/builtins it depends on. Mark each as initially
supported, deliberately avoided in implementation source, or needed before self-build.

This is an implementation inventory within the same native/strict profile, not a
separate bootstrap language. Keep it separate from eventual live-profile coverage.
Unsupported constructs must fail with diagnostics, not silently erase semantics.

Define the initial frontend's type inference/checking scope as well as its parser
scope. Test programs that parse but cannot be checked or lowered must not count as
working features. Avoid unconsciously implementing the compiler using a collection,
closure pattern, or metaprogramming feature it cannot compile.

## 2. Specify foundational intrinsics and host services

The [trusted intrinsic contract](trusted-intrinsics.md) now defines the operation
families, capability/effect rules and Node/native boundary. Exact declarations and
verifier/lowering implementations remain work to do.

Identify the finite operations that ordinary TypeScript cannot implement by itself:
raw memory access/allocation, machine-width operations, host calls, and later
executable-memory publication. Define their source API, typing, effects, and native
lowering. Restrict unsafe operations to explicit trusted implementation modules.

For Node-hosted build execution, provide semantically equivalent implementations
where needed, such as byte-buffer access. Native address operations do not have to
be available in the Node host when they are only used by the emitted runtime.
Make compilation-stage dependencies explicit rather than equating host and target.

Choose the initial OS service boundary and permitted system-library imports.
The [macOS arm64 target proposal](macos-arm64-target.md) selects libSystem imports
and specifies the host operations, private ABI, image layout and signing path.
Self-contained code generation/linking does not by itself decide whether file I/O
uses system libraries or direct syscalls. This affects startup, image generation,
error handling, and embedding.

## 3. Freeze a minimal internal runtime contract

The [IR/verifier](ir-contract.md) and [heap/root descriptors](heap-descriptors.md) now
provide concrete proposals for these boundaries. Physical encoding fixtures and
implementation validation remain required.

Decide the first concrete layouts and conventions before implementing independent
frontend, codegen, and runtime components:

- Scalars, references, strings, record headers, and union payloads.
- Function arguments/results, closure environments, and general entry adapters.
- Allocation and GC roots at calls/safepoints, including foreign boundaries.
- Exception propagation and cleanup, including failure of allocation/host calls.
- Runtime contexts, module state, and the initial threading model.

Preserve specified Number, String, identity, and completion behavior. Proposed
mechanisms include direct binary64 storage, heap-backed identity-bearing objects,
a simple non-moving tracing collector with explicit roots, explicit exception-result
propagation, and an initially single-threaded runtime. These mechanisms are proposals,
not substitutes for the specified semantics or settled implementation decisions.

Keep public C ABI layouts separate from this internal contract. Internal layouts
may change with coordinated caller migration; avoid freezing an external ABI early.

## 4. Make strict soundness executable as tests

Specify acceptance/rejection and runtime behavior for writable aliasing, union
mutation, downcasts, optional fields, indexing, predicates, and narrowing across
effects. Separate compile-time rejection from ordinary runtime checks/errors.

Use small positive/negative program pairs with expected diagnostics and results.
This is more actionable than a broad promise that types are sound. General
structural views should have a stated representation strategy when layouts differ.

Settle the initial strict/dynamic boundary behavior: copies, checked handles, or
controlled native-owned objects. Avoid promising transparent generalization of
arbitrary strict objects until its alias invalidation mechanism is designed.

## 5. Define compatibility and the initial host/module surface

Version the TypeScript conformance reference and track four independent dimensions:
syntax, checker behavior, emitted runtime semantics, and host/library APIs.
Broad TypeScript compatibility is not equivalent to Node compatibility.

Live mode preserves JavaScript behavior while retaining types for speculative
optimization and diagnostics. Specify recovery and diagnostic policies as described
in [Runtime type contracts](runtime-types.md).
Expected types guide guarded specialization; a mismatch can warn and trigger
deoptimization/generalization rather than rejection. Define how code, storage, and
aliases transition together; warnings alone cannot keep stale specialized code valid.
Validate results/effects against type-erased execution; report optional diagnostics
separately. Do not add new runtime rejection solely because of an annotation.

Define profile selection per module/build and propagation through dependencies.
Specify initial import resolution, source loading, and builtin modules; do not
accidentally commit to complete npm, CommonJS, DOM, or Node API compatibility.
Missing supported features should be distinguished from intentional strict-profile
differences in the conformance report.

Proposed first slice: explicit local ESM imports and a small host interface for
arguments, output, and file I/O. Full async module evaluation can be an explicit
later milestone while preserving its architectural place.

## 6. Specify the first complete native vertical slice

Use the current macOS arm64 host. Define host imports and the executable writer's startup,
load-address, relocation, and signing responsibilities. Choose enough source/IR
features needed to compile Tint itself. The first executable deliverable is the
self-hosted compiler, with file I/O as its principal application-level host service.

The [target contract](macos-arm64-target.md) supplies these physical defaults and
their validation gates. The remaining work here is implementation and evidence,
not another platform-selection discussion.

Focused fixtures exercise numeric functions, strings, allocation, records/unions,
modules, and file processing on the way to self-build. They are tests, not separate
tool products or competing milestones. Prove self-build before requiring live
code generation or advanced optimization.

For the first IR contract, specify operations, types, control flow/block arguments,
effects, source locations, and verification. Begin with direct native baseline
lowering; retain bytecode as an open later choice without making it an early
prerequisite. Reserve stable function identity and representation boundaries, but
do not require a production deoptimizer before compiling correct baseline code.

## Evidence and deferrals

Use Tint's own compiler as the first realistic tooling workload. Require
behavioral agreement across Node-hosted source and native execution where their
semantics overlap, direct artifact execution, and useful native failure diagnostics.
Require self-build reproducibility at the first deliverable; later add memory/file
output agreement and FFI
integration tests. Use independent disassembly and target specifications to check
instruction encoding; external tools may validate artifacts without building them.

Defer Wasm, implementation of additional targets, sophisticated tag packing, advanced GC, speculative
optimization policy, OSR, and complete foreign ABI coverage. Native library packaging
and bindings remain product goals, not prerequisites for the first executable.
Linux is nevertheless the intended primary platform, with Windows likely later;
[portability boundaries](platform-roadmap.md) are design requirements now, not deferred
until those backends are implemented.

The [strict cases](strict-checking-cases.md), [build inputs](build-inputs.md) and
[conformance baseline](conformance-baseline.md) now complete the initial design
contracts. Begin implementation fixtures and scaffolding next; no additional broad
architecture round is required. Tool versions, physical encodings and implementation
choices must still be recorded and validated as code is introduced.
Compatibility and host-surface tracking should begin alongside these, before claims
of language coverage accumulate.
