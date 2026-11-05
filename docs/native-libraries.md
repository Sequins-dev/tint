# ESM exports as native library interfaces

Status: proposed extension, not an implemented ABI or an accepted concrete syntax.

## Design

An ESM entrypoint can define the public surface of a native library. Tint resolves
the entrypoint's exports, checks their suitability for foreign calls, generates
adapters, and emits a library with a platform C-compatible ABI. Exported functions
can then be called from C or other systems supporting that ABI.

This fits the strict profile: its checked contracts make scalar and record
conversions predictable. Strict typing alone does not define a public binary ABI,
ownership policy, or host calling convention, so a separate ABI lowering step is
required. Dynamic implementation details can remain behind strict exported wrappers.

The adapters are compiler-generated IR lowered by Tint's existing backend. No C
source intermediate, external compiler, or platform linker is introduced. A C
header and machine-readable ABI manifest can describe the resulting library;
the header is an interface artifact, not implementation code.

Node is an intended long-term consumer: the Node-hosted AOT compiler can produce
a library that Node then loads through built-in FFI on supported builds. Generate
typed Node bindings from the same export/ABI model as headers and manifests, with
capability checks and explicit lifetimes. See [Product direction](product-direction.md)
for this workflow and its separation from bootstrap dynamic hosting.

## Entrypoint export projection

For example, an entrypoint may export `distance(x: number, y: number): number`.
The library boundary can use C doubles, while a managed adapter additionally
handles context, initialization, and errors. Its exact signature is not yet fixed.

Build configuration selects the FFI entrypoint. Its resolved public exports form
the candidate interface; an unsupported export produces a diagnostic rather than
silently disappearing. Internal modules need not restrict all their own exports.
Re-exports are resolved before ABI generation. Type-only exports may describe
records or declarations but do not create runtime symbols by themselves.

Map source export names to deterministic, collision-checked external names with a
library prefix. Default exports, aliases, and names not legal in C need an explicit
mapping policy. Expose either named entry symbols or a versioned module API table;
the latter can present a module-like interface but is an open design choice.

## Initial ABI surface

Prefer a deliberately bounded initial surface:

- Numeric scalar arguments/results: `number` maps to binary64, not an inferred C
  integer. Explicit integer types/conversions can extend this later.
- Boolean values: a specified integer encoding and validation policy.
- Selected plain records: copied through a documented C layout or pointer-based
  adapter. Specify field order, alignment, padding, and aggregate calling rules;
  an internal strict record layout is not automatically the external layout.
- Strings/buffers: pointer and length or opaque handles with explicit ownership.
  String encoding and treatment of unpaired UTF-16 surrogates must be defined;
  ordinary UTF-8 conversion is not automatically lossless for all JS strings.
- Objects/classes: opaque rooted handles with generated operations rather than
  exposed GC heap pointers or a foreign-language class ABI.
- Unions/optionals, when supported: explicit ABI discriminants and payload layouts,
  with checked input tags; do not expose optimizer-private tag values.

Generics require selected concrete instantiations or an explicit erased/handle
interface. Overloads require an unambiguous ABI projection. Arbitrary structural
interfaces, callable objects, mapped types, and conditional types must resolve to
a supported ABI contract or produce a diagnostic; they cannot become unspecified
C signatures. Type expressiveness inside the library remains unrestricted by this
export-surface limitation.

## State, ownership, and errors

Proposed baseline: explicit library-instance/context creation and destruction,
status results, output parameters, and a defined error-retrieval mechanism. A thin
direct scalar entry can be an optional specialization when no runtime context or
failure translation is required, not the universal assumption.

Exceptions must be caught by the export adapter and translated to the error
contract. They must not unwind foreign frames using an undocumented Tint ABI.
Callbacks need the inverse adapter, explicit user data, and documented failure
translation. Async exports require task handles and completion/polling or callback
operations; do not expose a Promise as an unexplained C pointer.

Opaque handles root objects until released and identify their owning context.
Specify whether retain/release is available and how invalid handles are diagnosed.
Borrowed memory must not outlive the documented call/lifetime. Results allocated
by Tint must be released through its API, or be copied into caller-owned buffers;
do not assume another allocator's `free` is compatible.

Specify thread affinity, reentrancy, callback lifetime, and context ownership.
A conservative first contract can be single-thread-affine. Foreign memory safety
still depends on callers obeying the ABI's pointer/length/lifetime preconditions;
strict TypeScript does not make arbitrary invalid C pointers safe to dereference.

Destroying a context or unloading a library requires no remaining active calls,
callbacks, handles, or dependent code. Initial designs can forbid unloading while
these exist rather than implement complex concurrent reclamation.

## Preserve ESM semantics

Initialize and evaluate the module graph before exposing ready-to-call operations.
Use an explicit initialization API rather than relying on arbitrary work in loader
constructors. Cycles and initialization failures retain their language semantics.
Top-level await requires asynchronous initialization or an explicit first-version
restriction; it cannot be silently ignored.

Mutable exported bindings are live. Project them as access operations, not copied
native globals. Imported bindings are read-only views, so do not automatically
generate foreign setters; mutation can be exposed by an explicit exported function.
Module namespace access and ordinary exported object values are distinct contracts.

## Stable boundary, evolving implementation

External entry addresses and public layouts must remain stable for the lifetime of
the loaded ABI. Stubs can redirect to new optimized code versions through the same
function-entry mechanism used for runtime compilation. Internal specialized ABIs,
object layouts, and tags remain private behind adapters.

ABI versioning and manifests must detect incompatible changes to signatures,
layouts, ownership, or error conventions. TypeScript structural compatibility by
itself is not evidence of binary compatibility.

## Linking and output

Library emission is another artifact kind using the same layout, relocation, and
code-generation machinery. Tint's private link units can remain language-oriented.
An externally loadable library must still implement its platform's library format,
export metadata, loader fixups/imports, and applicable signing rules. A macOS dylib,
for example, requires appropriate Mach-O output rather than an arbitrary Tint blob.

Static-library distribution would additionally require formats/link behavior the
consumer's toolchain accepts, or a dedicated Tint integration path. Shared-library
output is the simpler initial interoperability target to evaluate. Consumer build
tools are separate from Tint's requirement to generate its library without an
external compiler or linker.

## Initial validation

Build a strict module exporting a numeric operation, then extend it with a copied
record, a rooted object handle, a throwing operation, and a callback. Validate from
an independent C-ABI caller: actual calling conventions, error translation,
ownership, initialization, and repeated calls after internal code replacement.
Caller compilation may be a test tool; it must not be necessary to build Tint's
library. Header review alone cannot establish ABI correctness.
