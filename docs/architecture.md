# Architecture

Status: design baseline, with provisional implementation choices identified below.

All layers follow the [semantic baseline](semantic-baseline.md): specification-defined
behavior comes first; layouts, IRs, runtime mechanisms, and optimizations implement
it. Host choices and additional strict-profile restrictions are explicit.

## One TypeScript-to-native pipeline

The compiler is the primary investment and organizing component of Tint. Runtime
compilation and AOT compilation use the same frontend, IRs, optimization machinery,
instruction selector, register allocator, encoder, and linker mechanisms.

The logical sequence is:

1. Resolve TypeScript modules and parse source.
2. Bind names and check types under the selected language profile.
3. Produce typed semantic IR.
4. Analyze effects and choose representations; lower into native SSA IR.
5. Apply the selected shared optimization passes.
6. Lower to machine IR, allocate registers, and encode native instructions.
7. Link code, data, binding cells, and runtime metadata.
8. Publish an executable-memory image or serialize an executable-file image.

These are conceptual layers, not a requirement to build a generic pass framework
or independently serialized format for every layer at the outset.

Direct baseline native compilation is the current working proposal, not a ban on
bytecode or a bytecode VM. Fully dynamic operations can call native runtime helpers
or use native dispatch sequences; compatible TypeScript annotations do not justify
unchecked raw-memory access.

### Bytecode remains an option

The requirement is shared TypeScript-owned infrastructure through instruction
generation in live and AOT modes. Bytecode could be an executable or serialized
form of an IR, an input to native lowering, or a baseline VM tier. No such choice
has been made.

If selected, bytecode-to-machine-code translation must use the same compiler
pipeline and backend as AOT compilation. A TypeScript-authored interpreter could
itself be compiled by Tint, but that alone would not satisfy the requirement to
share the guest program's bytecode-to-native lowering. Bytecode operations must
map to shared semantics and IR rather than require a second independent compiler.

Evaluate a bytecode design against startup cost, representation fidelity, retained
type/effect information, profiling, debugging, and optimization state recovery.
A compact serialization need not be the optimizer's in-memory representation.
Do not commit to an interpreter, a stack VM, or a register VM merely because
bytecode is permitted.

## Independent policy choices

Bootstrap hosting is explicit: Node runs the AOT compiler and writes the first
standalone executable. That native build contains the compiler/runtime and hosts
dynamic compilation, executable-memory publication, and execution itself. Node
does not need a generated-code execution bridge. See [Bootstrap](bootstrap.md).

Keep three axes independent:

- Language profile: compatible TypeScript or strict TypeScript.
- Destination: executable memory or executable file.
- Optimization policy: baseline, offline optimization, or adaptive optimization.

Common combinations are compatible runtime compilation and strict AOT builds, but
strict modules can be compiled at runtime, compatible modules can be packaged in
an executable, and an AOT executable can include the compiler for later evaluation
and optimization. The implementation must not equate JIT with unsound typing or
AOT with a necessarily closed program.

Configuration selects policies and output adapters. It does not erase real
differences between memory publication and file loading.

Executable files and native libraries are distinct artifact kinds within file
output. The proposed [native library interface](native-libraries.md) projects an
ESM entrypoint's exports into stable C ABI adapters using the shared backend/linker.

[WebAssembly output/input](webassembly.md) is deferred. A future alternative Wasm
backend could share frontend analyses; independently, a Wasm frontend could feed
the native backend through semantics-preserving lowering. Neither is a required
intermediary stage or a prerequisite for the native pipeline and bootstrap.

## IR responsibilities

The implemented analysis/SSA/semantic boundaries and their current limitations
are described in [IR evolution](ir-evolution.md). The broader architecture below
also includes planned live-runtime and language-coverage work.

The [initial IR contract](ir-contract.md) specifies graph structure, operations,
effects, facts, root lowering and verifier gates. The [descriptor contract](heap-descriptors.md)
supplies physical tracing schemas parameterized by target data layout.

The pipeline supports distinct strict and dynamic value encodings. Shared semantic
IR lowers into fixed fields/scalars or general tagged values and runtime operations
according to proven facts and the language contract. Both use the same backend.
See [Value representations](representations.md) for storage, interop, and GC rules.

Typed semantic IR retains source locations, source types, control flow, property
operations, calls, closures, exceptions, module operations, and async behavior.
It distinguishes declared types from facts established by checks and analysis.

Native SSA IR expresses actual representations and effects: numeric primitives,
references, tagged payloads, layout descriptors, loads/stores, allocations,
runtime calls, guards, and GC safepoints. Language semantics must be lowered
explicitly rather than accidentally inherited from machine arithmetic.

Machine IR expresses target instructions and constraints: virtual registers,
register classes, call clobbers, stack slots, branches, fixups, and relocations.

Each boundary needs a verifier. Invalid operand types, missing definitions,
incorrect control flow, inconsistent calling conventions, or untracked live
references should fail before machine code is published.

The initial backend may favor straightforward translation and conservative
representations. The IR must leave room for inlining, specialization, escape
analysis, scalar replacement, loop optimization, and vectorization later.

## Shared AOT and continuous optimization

Optimization passes operate on the same IR regardless of when compilation occurs.
A compilation request supplies target information, a budget, optional profiles,
and an explicit set of assumptions. AOT may spend more time on global analysis;
runtime compilation may favor low latency and recompile hot functions later.
Offline profile-guided optimization can consume the same kind of feedback.

Distinguish two kinds of assumptions:

- Proven facts, valid under the language and module contracts.
- Speculative facts, valid only while guarded conditions and dependencies hold.

The optimizer must record dependencies for speculative code. Unchecked annotations
are not substitutes for guards. Live expectations guide specialization; violations
can warn and trigger deoptimization/generalization of dependent code and storage.
Guards or invalidation protect assumptions until the transition. Warnings alone
do not make stale specialized code safe. See
[Runtime type contracts](runtime-types.md).

Representation facts in IR need not appear as physical tags on every value.
Specialized native entries can use unboxed arguments; dynamic dispatch requires
runtime evidence before selecting those entries. Cache misses, general fallback,
profiling, and optimization scheduling are separate mechanisms. See
[Value representations](representations.md#runtime-evidence-versus-compiler-knowledge).

Reserve the following architectural concepts from the start, without requiring
an advanced tiering implementation in the first milestone:

- Stable function identity separate from a particular machine-code version.
- Code-version records owning instructions, relocations, metadata, and assumptions.
- Call indirection or patch points that permit later version replacement.
- Profiles associated with source/IR operations and code versions.
- Safepoints and source/value mappings adequate for GC and later state recovery.
- Lifetime tracking so replaced code remains alive while frames or references use it.
- Dependency tracking for inlining and direct calls that bypass stable entries.

The first replacement mechanism can redirect future calls while existing frames
finish in their original versions. This needs no on-stack replacement or general
deoptimization. In-place mutation of executing instructions is not the default.

Later speculative optimization may require deoptimization into baseline native
code, including reconstruction of locals, inlined frames, and materialized
objects. A VM fallback is also an open option if a bytecode tier is adopted;
it would need explicit state mappings and the same runtime contracts.
On-stack replacement for long-running
loops is a separate later capability. Neither feature should be promised merely
because code-entry replacement exists.

Keep an internal baseline ABI at stable call entries. Specialized internal ABIs
may use adapters or verified direct calls; callers must not accidentally enter a
new version with an incompatible argument representation.

## Runtime

The accepted [logical call contract](call-contract.md) connects typed/general
entries, closure environments, effects, result/exception handoff, and code-version
dependencies. The [macOS arm64 target](macos-arm64-target.md) proposes the first
physical mapping, with validation still required.

Generated code shares native semantic operations for strings, objects, closures,
exceptions, allocation, module bindings, and host operations. Shared semantics do
not require a uniform object or value encoding: layout descriptors and explicit
adapters connect strict and dynamic storage. Specialized code may replace a helper
with direct operations when its preconditions are proven.

Compiler algorithms and runtime algorithms remain TypeScript-authored. A small,
explicit intrinsic boundary implements raw memory, host calls, and other
operations that cannot bottom out in ordinary high-level allocation or dispatch.
The allocator and collector cannot recursively depend on their own services.
The [trusted intrinsic contract](trusted-intrinsics.md) defines operation families,
capabilities, effects and host/target execution separation. The [source inventory](bootstrap-feature-inventory.md)
keeps the compiler core inside implemented strict-profile coverage.

Accepted memory-management baseline: a precise non-moving mark-and-sweep collector
with compiler-managed shadow roots and layout metadata. Physical details and tuning
remain open. All code versions, including baseline code, obey the same GC contract.

The [shared lifetime baseline](memory-and-lifetimes.md) specifies collection triggers,
root/result handoff, raw collector storage, live-layout transitions, code-version
ownership, and external resource cleanup. Strict and live code share a collector
within one runtime instance, using representation-specific tracing descriptors.

## Linking TypeScript modules

Tint owns both language-level module linking and machine-code relocation. They
are related layers with different contracts:

- Module linking resolves imports/exports and creates live binding cells, module
  environments, namespace objects, and dependency/evaluation state.
- Native linking lays out code/data, resolves symbols and runtime entries, applies
  relocations, and handles target branch ranges and address materialization.

ESM live bindings, initialization checks, cycles, re-exports, evaluation order,
top-level await, and dynamic import must be represented explicitly. Resolving an
import is not equivalent to copying a value or linking a C-style function symbol.
Asynchronous module evaluation is distinct from address resolution.

An internal link unit can contain native code/data fragments, typed relocations,
function identities, layout and GC descriptors, module binding definitions,
initializers, dependencies, and versioned compiler metadata. It need not use a
standard object-file format or a C-oriented symbol model.

Executable memory and executable files share layout/relocation mechanisms but use
different placement and publication adapters. File images must not embed process
heap pointers. Startup constructs runtime state and binding cells; load-address
dependent references need position-independent code or supported fixups.

## Platform boundary

Owning the linker removes an external build-tool dependency. It does not remove
the operating system's executable format, loading rules, ABI, memory-protection
requirements, or signing requirements.

A standalone macOS executable still needs a valid Mach-O image. Tint must emit
the necessary headers, segments, startup code, loader/import information, fixups,
and applicable signing data itself. Native OS libraries remain possible host
dependencies; self-contained compilation does not imply reimplementing the OS.

The memory publisher must support executable allocation, writable/executable
transitions, instruction-cache synchronization, and safe publication. On Apple
silicon, JIT memory and hardened-runtime policies require specific handling.
Those are host-adapter obligations, not optimization-pass concerns.

Accepted first target: the current AArch64/macOS host. Linux is the intended long-term
primary platform, with Windows a likely later addition. Complete one native path
first while preserving architecture, ABI, OS-service and image-publication boundaries
from the beginning. The [platform roadmap](platform-roadmap.md) defines these boundaries
and separates build host, output target and execution coverage.

## References

- [ECMAScript module semantics](https://tc39.es/ecma262/2025/multipage/ecmascript-language-scripts-and-modules.html)
- [Apple: porting JIT compilers to Apple silicon](https://developer.apple.com/documentation/apple-silicon/porting-just-in-time-compilers-to-apple-silicon)
- [QuickJS-NG internals, as reference only](https://quickjs-ng.github.io/quickjs/developer-guide/internals/)

The initial compiler host surface is specified in [runtime host surface](runtime-host-surface.md):
standard globals plus a finite synchronous `node:fs` facade, backed by the existing
file-service and byte-I/O contracts. Development-tool imports do not expand that surface.

The concrete rollout of shared passes, type-proof requirements, validation and
compile-time budgets is described in [Optimization](optimization.md).
