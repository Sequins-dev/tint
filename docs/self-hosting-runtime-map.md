# Self-hosting: semantics to implementation

Status: the original semantic design map below is now backed by a Node-bootstrapped
native compiler, native file adapter and tracing runtime. The native executable
loads and parses compiler sources. Same-source native rebuilding is still under
verification; a stage-one executable alone is not a self-hosting proof.
Specification obligations below remain distinct from implementation coverage.

## Scope

The first executable deliverable is Tint rebuilding its own TypeScript source in
the same strict/native profile available to applications. This inventory comes
from expected compiler structures, not an audit of existing compiler source.
Update it against actual source as that source is written.

Pinned ECMAScript 2025 links provide reproducible references for this map, not a
decision to cap long-term coverage at that edition. TypeScript checker/version
conformance remains separate. No additional bootstrap dialect is introduced.

In the table below, semantic obligations are specification-driven. Mechanisms and
initial implementation scope are proposals. Missing features must be diagnosed as
unsupported rather than compiled with silently altered behavior.

## Semantic map

| Compiler need                           | Required behavior and reference                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Proposed mechanism                                                                                                         | First evidence                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Indices, arithmetic, instruction fields | Number operations preserve rounding, NaN, infinities, signed zero, and operation-specific integer conversions. [Numbers](https://tc39.es/ecma262/2025/multipage/ecmascript-data-types-and-values.html#sec-ecmascript-language-types), [conversions](https://tc39.es/ecma262/2025/multipage/abstract-operations.html)                                                                                                                                                                                                                             | Binary64 ordinary numbers; explicit bit-operation/buffer-write conversions. Raw address arithmetic is internal.            | Division by zero, signed zero, large-integer rounding, and shifts agree with Node.                   |
| Source text, names, diagnostics         | Strings preserve code-unit length/indexing and unpaired surrogates. [Strings](https://tc39.es/ecma262/2025/multipage/ecmascript-data-types-and-values.html#sec-ecmascript-language-types)                                                                                                                                                                                                                                                                                                                                                        | Immutable flat UTF-16 storage initially, value comparison, cached hashes. File decoding is separate.                       | Supplementary characters occupy two code units; lone-surrogate slicing is preserved.                 |
| Optional fields and AST variants        | Missing properties, undefined, null, and uninitialized bindings remain observably distinct. [Values](https://tc39.es/ecma262/2025/multipage/ecmascript-data-types-and-values.html), [objects](https://tc39.es/ecma262/2025/multipage/ordinary-and-exotic-objects-behaviours.html)                                                                                                                                                                                                                                                                | Internal sentinels/presence bits; finite union tags/payloads. TypeScript narrowing controls legal strict accesses.         | Absent and present-undefined properties differ; referenced union payloads retain identity.           |
| AST nodes, symbols, IR instructions     | Objects have identity; properties preserve descriptors, prototypes, and key ordering. [Ordinary object operations](https://tc39.es/ecma262/2025/multipage/ordinary-and-exotic-objects-behaviours.html#sec-ordinaryownpropertykeys)                                                                                                                                                                                                                                                                                                               | Managed references, layout descriptors, fixed fields where proven. Creation order is distinct from field-offset order.     | Aliases share writes; equal-shaped objects remain distinct; enumeration is correct.                  |
| Scopes and captured state               | Bindings distinguish initialization/assignment; premature reads fail. Captures share bindings, with fresh per-iteration bindings where specified. [Environment records](https://tc39.es/ecma262/2025/multipage/executable-code-and-execution-contexts.html#sec-environment-records)                                                                                                                                                                                                                                                              | SSA/stack locals; captured cells and environment descriptors; initialization state.                                        | Shared closure counter, loop captures, and temporal-dead-zone behavior.                              |
| Functions and callbacks                 | Preserve receiver/environment behavior, argument evaluation, and return/throw results. [Calls](https://tc39.es/ecma262/2025/multipage/ordinary-and-exotic-objects-behaviours.html#sec-ecmascript-function-objects-call-thisargument-argumentslist), [expressions](https://tc39.es/ecma262/2025/multipage/ecmascript-language-expressions.html)                                                                                                                                                                                                   | Stable function identity, native entry, environment, receiver where needed, normal/throw channels.                         | Recursion, captured mutation, receiver behavior, and exactly-once argument effects.                  |
| Traversal worklists                     | Array length, indexed properties, holes, and supported methods retain their standard behavior. [Arrays](https://tc39.es/ecma262/2025/multipage/indexed-collections.html), [array objects](https://tc39.es/ecma262/2025/multipage/ordinary-and-exotic-objects-behaviours.html#sec-array-exotic-objects)                                                                                                                                                                                                                                           | Capacity-backed array with separate logical length and presence information. Typed slots require a sound storage contract. | Growth, truncation, out-of-range access, holes versus undefined.                                     |
| Symbol tables, deduplication            | Map/Set key equality and insertion ordering, including NaN and signed zero. [Keyed collections](https://tc39.es/ecma262/2025/multipage/keyed-collections.html)                                                                                                                                                                                                                                                                                                                                                                                   | Shared hash-table machinery with ordered entries and stable identity hashing.                                              | Overwrite preserves order; delete/reinsert changes it; special numeric keys match.                   |
| Binary output, relocations              | Buffer/views preserve bounds, conversions, shared storage, and endianness behavior. [Structured data](https://tc39.es/ecma262/2025/multipage/structured-data.html#sec-getviewvalue)                                                                                                                                                                                                                                                                                                                                                              | Byte buffers and Uint8Array/DataView-compatible access; explicit endian writes.                                            | Aliasing views, exact byte fixtures, appropriate invalid-access errors.                              |
| Errors and cleanup                      | Completion propagation distinguishes return/throw/break/continue; finally can replace a pending completion. Iterator closing has defined precedence. [Completions](https://tc39.es/ecma262/2025/multipage/ecmascript-data-types-and-values.html#sec-completion-record-specification-type), [try](https://tc39.es/ecma262/2025/multipage/ecmascript-language-statements-and-declarations.html#sec-try-statement-runtime-semantics-evaluation), [IteratorClose](https://tc39.es/ecma262/2025/multipage/abstract-operations.html#sec-iteratorclose) | Exceptional CFG edges and completion-aware cleanup; native normal/throw status.                                            | Finally runs once and can override a return; iterator-close conflicts preserve the right completion. |
| Compiler modules                        | Live imports, linking, initialization, cycles, and evaluation are distinct. [Modules](https://tc39.es/ecma262/2025/multipage/ecmascript-language-scripts-and-modules.html), [module environments](https://tc39.es/ecma262/2025/multipage/executable-code-and-execution-contexts.html#sec-module-environment-records)                                                                                                                                                                                                                             | Module records, shared binding cells, dependency resolution, evaluation state. Local paths first.                          | Cyclic initialized function calls work; premature binding reads fail; updated exports are observed.  |
| Compiler graph lifetime                 | Preserve reachable references and identities; weak APIs add liveness rules when supported. The spec does not select a collector. [Memory management](https://tc39.es/ecma262/2025/multipage/managing-memory.html)                                                                                                                                                                                                                                                                                                                                | Proposed single-threaded non-moving mark/sweep, explicit roots, layout-driven tracing.                                     | Forced collections retain temporaries, modules, and closures; unreachable cycles are reclaimed.      |

## Proposed shared mechanisms

See [Memory and lifetimes](memory-and-lifetimes.md) for the proposed concrete
safepoint, handoff, and reclamation protocol shared with later live execution.

### Managed heap and layout descriptors

Use one managed-heap contract for objects, strings, environments, binding cells,
arrays, collection storage, and runtime-owned metadata. Layout descriptors record
size, reference fields, and tag-dependent payload scans. They are distinct from
complete TypeScript semantic types.

Proposed initial object header: descriptor reference plus collector metadata.
Non-moving allocation addresses can support internal identity hashing without
exposing addresses as language identity. Variable-sized storage has checked lengths
and capacities; raw byte blocks explicitly contain no managed references.

Roots are precise, not inferred from arbitrary numeric bit patterns. Do not add a
separate ownership model or compiler-phase arena API initially. Revisit arenas if
measurement justifies them, preserving all escaping values. Ordinary compiler
source should use normal managed objects, including cyclic graphs.

### Root publication and allocation safepoints

Proposed baseline: compiler-generated shadow root frames. Publish all live managed
references before any operation that may allocate or reenter allocating code.
Frame descriptors distinguish references/tagged values from scalar-only slots.
Module cells, globals, and runtime-context state are also roots.

Allocation protocol:

1. Publish live inputs and temporaries.
2. Allocate; collection can happen before storage is returned.
3. Initialize headers/reference fields to a traceable state before any further
   safepoint, then complete initialization under that invariant.
4. Root the result before the next possibly collecting operation.

In `f(makeNode(), makeNode())`, the first result must survive the second allocation.
The callee, receiver, and environments must survive too. Return/throw results must
remain rooted until the receiver publishes them, with no allocating gap in handoff.
Every normal and exceptional exit restores the root chain. These are generated-code
obligations, not manual application duties.

Collector worklists and allocator metadata use separate raw storage that cannot
recursively trigger managed collection. Array growth and formatted diagnostics
cannot accidentally reenter the collector. OOM needs a non-allocating failure path;
the [intrinsic contract](trusted-intrinsics.md) proposes fatal standalone termination
without allocation; embedding policy remains separate.

Shadow frames are a simple initial mechanism, not a permanent restriction against
precise stack maps or better allocation techniques.

### Binding cells, closure environments, and calls

Share a binding-cell primitive between mutable captures and module bindings, with
policy for read-only imports, mutability, and initialization. Proven locals can
remain in SSA; not every binding requires allocation.

Closures carry stable function identity plus an environment reference. Captures
that share a mutable variable refer to the same cell rather than copying its value.
Generated environment descriptors reuse the heap tracing machinery.

The baseline logical call contract carries a runtime context, environment,
receiver/argument metadata where needed, typed arguments, and a normal or thrown
result. This is not yet a register-level ABI. Missing arguments must not expose
uninitialized machine registers; adapters preserve supported argument semantics.
Proven direct calls may simplify these adapters.

Map this logical contract onto target registers/stack locations in one backend
component. OS/foreign calls use distinct adapters. Stable function identity leaves
room for future replacement without requiring a JIT before self-build.

### Completion-aware control flow

IR distinguishes normal results, exceptional edges, and pending nonlocal completion
through cleanup. Break/continue normally become local branches. Return/throw crossing
finally retain the pending completion until cleanup determines the outcome; abstract
Completion Records do not need to be literal heap objects.

Proposed native baseline: status plus typed normal result or arbitrary thrown value
through a defined logical result channel. Thrown values need not be Error objects;
thrown references are roots. Root cleanup covers every exit without changing user
completion values or executing user cleanup twice.

IteratorClose remains a semantic operation with its own error-precedence rules,
not a universal finally template that assumes cleanup errors always win.

### Buffers and the trusted substrate

Use standard buffer/view abstractions for ordinary binary emission where possible.
They execute under Node and lower to native operations under Tint. Writing an
executable file does not require exposing raw executable-memory pointers to the
compiler's ordinary source.

Keep the trusted substrate finite: raw regions, address-sized arithmetic, runtime
loads/stores, and host calls. Intrinsics specify overflow/alignment behavior;
ordinary numeric expressions retain their language semantics.

Allocator/collector/bootstrap routines form a small trusted kernel with explicit
allocation restrictions. They bottom out in raw storage rather than recursively
invoking the managed allocation they implement. High-level code above this layer
uses normal objects.

Node implementations can use byte storage and opaque host-managed handles. Do not
represent arbitrary native addresses as JavaScript numbers. Target-only operations
need not execute inside the Node build host.

### Module state and file-oriented host services

Load source bytes, decode them under an explicit policy, resolve local imports,
and construct module/binding records. Keep linking and evaluation separate even in
whole-program AOT builds. Only replace live bindings with constants when proven safe.

Proposed initial host operations: read/write file bytes, obtain build arguments and
current directory, report diagnostics, finish with an exit status, and set output
permissions where needed. Add other filesystem operations only as resolution or
output handling actually needs them. Synchronous operations avoid requiring an
event loop for self-hosting.

Source decoding, path/case behavior, file failures, and output handling need shared
Node/native contracts. File UTF-8 decoding is distinct from runtime string storage.
Both compiler hosts must interpret identical input bytes equivalently.

Tint generates executable headers, relocations, imports, and required signing data.
OS memory/file services remain host functions under the proposed
[macOS arm64 target contract](macos-arm64-target.md).

## Source feature inventory

This is proposed implementation ordering within the native profile, not a new subset.
The [compiler source inventory](bootstrap-feature-inventory.md) expands this outline
into required language features, builtin methods, generic lowering and source deferrals.
The [trusted intrinsic contract](trusted-intrinsics.md) specifies the kernel boundary.

| Compiler structure | Likely dependencies                                                                            | First-source discipline                                                                  |
| ------------------ | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Scanner/parser     | Strings/code-unit access, indices, loops, branches, recursion, arrays, records                 | Handwritten scanning avoids requiring a complete RegExp engine for self-build.           |
| AST/types/symbols  | Discriminated unions, optional fields, structural records, arrays, maps/sets, recursive graphs | Ordinary functions and records; classes are not required merely to describe nodes.       |
| Binder/checker     | Lexical scopes, mutable bindings, generic collections, equality/hash operations                | Track actual source constructs; diagnose unsupported constructs instead of miscompiling. |
| IR/backend         | Typed records/unions, graphs, bit operations, buffers, deterministic iteration                 | Encode instructions/files directly, without external native build tools.                 |
| Runtime/host       | Calls, captures, allocation, throw/cleanup, modules, trusted intrinsics                        | Confine raw memory and host imports to bounded implementation modules.                   |
| CLI/self-build     | ESM graph, files/paths, arguments, diagnostics, output bytes                                   | No network, GUI, package installation, or async I/O needed.                              |

Generics affect checking and representation selection, not necessarily runtime
type reification. Initially share general representations when necessary and use
known layouts where available. Decide generic lowering on concrete collections;
avoid requiring unbounded monomorphization to compile Tint.

Maintain an exact builtin-method inventory as source is written. Map iteration
requires iterator behavior, not just get/set. A builtin fast path requires proven
receiver/prototype assumptions; a method name alone cannot authorize substitution.
Otherwise retain the supported general behavior or diagnose unsupported usage.

Features absent from first-source requirements can be deferred: async/promises,
generators, arbitrary eval, proxies, full reflection, weak references/finalization,
shared-memory concurrency, and broad Node APIs. These are coverage milestones, not
permanent native-profile bans. Symbols/builtins required by iteration cannot be
omitted merely because unrelated uses are deferred.

## IR contract implied by the map

Initial semantic operations cover:

- Constants, conversions, arithmetic/comparison, and short-circuit control flow.
- Binding initialization/read/write, closure capture, module binding access.
- Allocation, field/element access, optional presence, union injection/projection.
- Calls with environment/receiver, exceptional edges, and completion-aware cleanup.
- Buffer/views, host operations, and explicit trusted intrinsics.

Record source locations and conservative effects: may allocate, throw, read/write
state, or invoke user code. These drive roots and correct evaluation order before
they enable optimization. Unknown calls conservatively carry possible effects.

Verify operand definitions, representations, branch/merge values, initialization
checks where not proven, union projections, exceptional successors, and root
publication at collecting calls. Do not move/eliminate effectful operations without
proof. The map does not require an advanced optimizer before baseline execution.

## Acceptance ledger

No cases below have been implemented or run; these are requirements for validation.

| ID   | Case                                                                      | Evidence                                                                                                                          |
| ---- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| N01  | Numeric edges and instruction-word conversion                             | Node/native agreement, distinguishing NaN and negative zero correctly.                                                            |
| S01  | Surrogate pairs, lone surrogates, source decoding                         | Code-unit behavior matches; file decoding tested separately.                                                                      |
| O01  | Aliases, optional presence, union variants                                | Shared mutation, stable identity, compatible payload access.                                                                      |
| B01  | Captures, loop bindings, premature reads                                  | Shared cells/fresh iterations and correct initialization failures.                                                                |
| C01  | Recursion, receiver and argument effects                                  | Exactly-once evaluation in order; compatible argument/result layouts.                                                             |
| A01  | Array growth/truncation and hole-sensitive operations                     | Length/presence distinct from capacity and stored undefined.                                                                      |
| M01  | Ordered collection updates and key equality                               | Standard ordering and special numeric key behavior.                                                                               |
| D01  | Aliasing buffer views, endian writes, invalid ranges                      | Exact bytes and specified errors, no unchecked accesses.                                                                          |
| X01  | Nested finally and iterator-close conflicts                               | Correct completion wins; root chain restored on all exits.                                                                        |
| G01  | Collection forced at allocation boundaries                                | Temporaries, thrown values, modules, escaped closures survive; unreachable cycles reclaimed.                                      |
| E01  | Cyclic modules and live bindings                                          | Correct initialization and subsequent observed updates.                                                                           |
| H01  | File failures, decoding, executable permissions                           | Equivalent Node/native host behavior and useful failure reporting.                                                                |
| SH01 | Node compiler emits stage 1; stage 1 emits stage 2; stage 2 emits stage 3 | Native builds need no Node/external compiler/linker. Deterministic stage 2/3 artifact comparison plus independent behavior tests. |

Use relevant conformance fixtures and Node as independent evidence for supported
semantics. Keep strict-profile rejection cases separate. Do not infer correctness
solely from self-build agreement or count unimplemented features as passing. Tiny
executables are test fixtures, not alternative product milestones.

## Remaining selections

1. Validate the proposed macOS arm64 host imports and physical call ABI.
2. Specify heap/root descriptor encoding beneath the accepted mark/sweep and
   shadow-root lifetime baseline.
3. Define typed IR operations and verifier rules implementing these contracts.
4. Implement the proposed trusted intrinsics against one allocator/buffer design.
5. Fix source decoding/module resolution and audit the builtin inventory against code.

Header byte sizes, registers, and metadata encodings follow these choices; they are
not dictated by ECMAScript. The map supplies coherent defaults to validate without
treating implementation proposals as specification requirements.
