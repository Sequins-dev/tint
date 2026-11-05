# @tint/compiler/native

`compileArm64Program(request)` composes the shared compiler stages into one pure
operation: closed ESM linking, generic specialization, checking, runtime helper
registration, module initialization, scalar IR lowering and AArch64 emission.
It accepts parsed `SourceModule` inputs whose imports resolve to module IDs.
Runtime template modules are explicit inputs. Each `RuntimeSource` declares its
provider `module` and stable helper `namespace`, independent of source package
ownership. Helper keys remain `namespace:export`; a provider can move between
packages without changing its contract label. Namespaces are nonempty ASCII
letters, digits, dots or hyphens. Duplicate namespaces/providers and invalid IDs
are rejected before linking. No namespace is inferred from a module path or grants
host/record capabilities. By default, runtime modules and their transitive
dependencies remain outside the application instance factory. Supply `RuntimeSource.retainedExports` to retain
only named value exports, allowing the remaining declarations and dependency state
to initialize normally per instance. This supports native binding stubs alongside
runtime tables that require initialization. Retained functions must not depend on
instance-local state; retention does not grant host or record-view capabilities.

The result contains machine code and native function metadata. `initializer` is
the native function index that creates a fresh module instance and returns its
export record. If `start` names a selected function export, `entry` identifies a
one-shot wrapper with that export's parameter/result signature: each invocation
initializes an instance and then calls the export. Persistent embedding should
retain the instance returned by `initializer` instead of repeatedly using `entry`.

Source loading, filesystem operations, executable image construction, memory
management and process startup belong to host/runtime adapters. This package
performs no I/O and does not execute generated code. AArch64 is the first backend;
this API does not make macOS the only eventual operating-system target.

Successful compilation is not proof of self-hosting. That requires the native
compiler to rebuild the complete same-source compiler and execute the next stage.

Host capabilities are explicit `hostBindings` naming an exported leaf function,
its module, and a supported operation. The module must be a declared runtime.
After source checking and lowering, `bindHostOperations` verifies the exact IR
signature and replaces the leaf body. Emission returns import references for the
image writer. Ordinary source names do not confer filesystem capabilities.

Native `TextEncoder` and `TextDecoder` construction is normalized through the
registered text-encoding runtime factories, respecting lexical shadowing. The
Node bootstrap continues to use the host's standards-based implementations.

`maxSpecializations` bounds generated instances independently in the application
and runtime specialization passes. It defaults to 4,096; callers compiling larger
generic programs can supply a nonnegative safe integer. Exhaustion returns a
stage-specific diagnostic instead of silently omitting instances. The compiler's
own project explicitly requests 16,384 instances per pass.

`debugSymbols: true` adds a separate code-offset/name table to the compilation
result; it does not change emitted instructions. Names identify the original source
module and named function through specialization. Anonymous functions use source
span offsets; generated functions retain their generated identity. Each specialized
instance keeps a distinct suffix. With `SourceModule.sourcePosition`, the result also includes disjoint native
instruction ranges mapped to original files and one-based lines/UTF-16 columns.
Generated instructions without source spans are omitted. This metadata does not
include variable locations or inline call stacks.

`CompileRequest.optimization` selects `"basic"` (default) or `"none"` for
baseline comparisons. `CompiledProgram.optimization` contains per-pass visit and
rewrite counts. The architecture-neutral transforms preserve surviving source
spans and run before native emission's verifier. See
[the phase design](../../docs/optimization.md) for proof requirements and the
planned range, escape, loop and machine optimization stages.

## Managed pointer relocation

`resolveManagedPointers(native, bindings, readWord)` validates symbolic managed
imports against explicit loader-owned permanent identity capabilities. Names,
roles, semantic contracts and ordered scalar signatures must match. The resolver
checks the function GC layout and versioned signature bytes, rejects occupied or
initialized slots, then patches full-width pointers into a fresh byte array.
Failure leaves the original image untouched.

The result is unpublished code bytes, not a hosted AOT module. The trusted caller
owns permanent readable metadata, context compatibility, executable publication,
collector registration and rooted calls. Descriptor equality alone grants no
semantic contract or invocation capability.

Managed function/signature descriptor validation shares numeric wire facts with
the emitter through `@tint/abi/function`; trusted windows, exact contracts and
transactional relocation remain compiler responsibilities.
