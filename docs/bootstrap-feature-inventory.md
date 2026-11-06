# Compiler source feature inventory

This is a historical bootstrap feature ledger. Current ownership and production
contracts are recorded in [framework consolidation](framework-consolidation.md)
and [heap descriptors](heap-descriptors.md); retired prototype references below
are historical observations.

Status: historical source-budget ledger with incremental implementation notes.
The native compiler has completed byte-identical self-builds and stage-two smoke
execution; the early milestones below must not be read as current coverage limits.
See [language coverage](language-coverage.md) for the current family-level audit.

## Current self-build verification boundary

The window-record-v1 verification records a byte-identical 30,735,002-byte
self-build and a stage-two smoke executable exiting 42. Evidence is retained in
`.tint-bootstrap/window-record-v1-verification.json`. This proves the compiler's
source subset, not full TypeScript or JavaScript coverage. Subsequent plan-record
changes passed portable checks/bootstrap but have no completed native self-build
measurement. Performance tuning was paused for the language coverage review.

## One strict profile, staged coverage

Tint's source uses the same strict/native profile as applications. A feature omitted
from the first compiler source is not thereby banned from native code. Distinguish:

- Required before self-build: implement and validate every operation used by Tint.
- Avoid in first source: deliberately keep a dependency out until its value warrants
  implementation; diagnose it as unsupported if encountered.
- Rejected by strict soundness: a separate rule with a positive/negative test pair,
  independent of how early the parser/backend implements the syntax.

There is no unchecked bootstrap exception. The trusted runtime uses the explicit
[intrinsic boundary](trusted-intrinsics.md), not arbitrary assertions. Node executes
the ordinary compiler core with a host adapter; native Tint compiles that same core
and its target runtime.

## Required language inventory

Implement in dependency order, with small native fixtures at each step. The stages
below order work; none is a separate language mode or alternative product milestone.

### 1. Scalar control flow and calls

Required: lexical declarations, explicit type annotations, Number/Boolean/String,
null/undefined, literal types, arithmetic/comparison/bitwise operators, assignment,
short-circuit expressions, if/switch, loops, break/continue, return, direct functions,
recursion and mutually recursive functions. Check expression types and definite
initialization, not merely syntax.

Preserve binary64 and JavaScript bitwise conversion behavior. First implement the
operators actually used; exponentiation and every Math method are not implied by
supporting Number. Runtime diagnostics/source loading require strings early.

Initially annotate exported functions, record fields, recursive declarations and
generic boundaries explicitly. Still support local inference, contextual object/
array literals and call-site type arguments needed by the source. Avoid requiring
inference of complex recursive signatures before the checker can compile itself.

### 2. Records, unions and graph storage

Required: object literals, type aliases/interfaces, recursive types, named property
reads/writes, readonly views, literal discriminated unions, optional fields, arrays,
indexed access, type narrowing and generic containers. AST, scope, type, IR and
relocation graphs use records and stable references. Prefer literal discriminants
to requiring runtime enums in the first source.

Narrow directly with equality, null/undefined checks, typeof, property-presence
checks and switches. Preserve effect-aware invalidation. Use local snapshots when
an alias or call can mutate a previously narrowed property. Do not implement unsafe
assertions merely to make Tint's own source pass checking.

For recursive graph construction, explicit `T | undefined` fields or valid empty
collections establish safe intermediate states. Construct complete union variants
and replace the containing value; do not change a discriminant before updating its
correlated payload through separately observable writes.

Writable aliases require compatible read/write types. Readonly structural views
may use layout descriptors or adapters rather than assuming identical field offsets.
Indexed reads initially include undefined unless bounds/presence are established.
A real checked helper can return a value or throw; postfix `!` is not that helper.
Optional property absence remains distinct from a present undefined value.
These source choices align with TypeScript's [narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html)
and [exact optional properties](https://www.typescriptlang.org/tsconfig/exactOptionalPropertyTypes.html),
while Tint adds the soundness obligations in [language profiles](language-profiles.md).

### 3. Closures, cleanup and modules

Required before self-build: function expressions/arrows, mutable captures, lexical
receiver semantics where used, callbacks, normal/throw completion, try/catch/finally,
ESM imports/exports and live bindings. Declaration-level type-only imports/exports have no runtime
initialization effects. Inline type specifiers retain ordinary dependency side effects
under the pinned verbatimModuleSyntax baseline. The [build-input contract](build-inputs.md) defines the
source catalog, exact imports and decoding. Module cycles and premature reads must follow the existing
semantic contract even if first-source module organization avoids problematic cycles.

Use explicit local relative imports first. Shared compiler code must not import
Node-specific services; only the Node host adapter does. No top-level await or
runtime module discovery is needed to rebuild the compiler. Exact extension/path
resolution follows that build-interface contract rather than Node package heuristics.

Catch values are unknown/general values; do not assume every throw is an Error.
The source may prefer structured result unions for anticipated diagnostics and use
exceptions for exceptional paths, but the runtime cannot restrict thrown values
to that preference. Cleanup/root handoff must work before native file processing.

### 4. Runtime, buffers and native output

Required: builtin construction/calls for the finite inventory below, exact byte
access, collection growth, heap tracing, host operations and trusted machine-word
operations. Builtin `new Map`, `new Set` and buffer construction require their own
supported construction semantics; they do not require general user class lowering.

Compile startup, allocator, collector and host adapters from TypeScript through the
same pipeline, with trusted lowering for the irreducible operations. Include the
compiler's parser/checker/backend and writer in the produced executable. Building
only a runtime cannot count as self-hosting.

## Initial builtin budget

This is a concrete proposed minimum to guide source authoring. Add methods when a
real source use justifies them, with semantic fixtures. Support for one method does
not imply complete support for its builtin family.

- Strings: length, indexed code-unit access, charCodeAt, slice, concatenation,
  equality and String.fromCharCode. Scanner logic avoids RegExp. Ordinary strings
  preserve UTF-16 code units, including lone surrogates; file UTF-8 codecs are separate.
- Arrays: construction/literals, length, indexed read/write, push, pop and slice.
  Implement growth/truncation and holes where reachable through these operations.
  Prefer explicit loops to requiring map/filter/reduce/sort for first-source code.
- Map: construction, size, get, has, set, delete and clear. Set: construction, size,
  has, add, delete and clear. Preserve identity/value key semantics and insertion
  order. Initially keep an explicit array for ordered compiler worklists instead
  of requiring collection iteration in the compiler source. This does not authorize
  dropping ordering from the collection implementation.
- Binary storage: ArrayBuffer construction and byteLength; Uint8Array construction
  over lengths or existing buffers, length/byteLength/byteOffset/buffer and indexed
  access; DataView construction and endian-explicit get/set for 8/16/32-bit integers
  and binary64. Read/write wide words through two halves initially. No resizable or
  shared buffers are required by first source.
- Numeric helpers: Math.floor, Math.ceil, Math.trunc, Math.imul, Number.isFinite,
  Number.isInteger and Number.isNaN. Implement output formatting needed by diagnostics
  explicitly or add the corresponding standard formatting operation to the ledger;
  implicit conversion must not silently substitute an incomplete formatter.
- Errors: construction and name/message access for Error, TypeError and RangeError
  where supported operations require them. A richer stack-string format is optional;
  useful source diagnostics do not depend on matching a particular engine's format.

A builtin substitution requires verified receiver/binding and mutation assumptions.
A property named `push` is not intrinsically an Array operation. If first-source
code does not patch prototypes, record and enforce the restriction needed by a fast
path rather than treating arbitrary user code as if it followed that discipline.

Standard arrays/views retain their specified invalid-access/conversion behavior;
strict checking can require more proof without changing accepted executions.
The raw-region API is intentionally separate from standard DataView exceptions.

## Generic checking and representation

Required: generic records/functions, basic constraints, explicit instantiation and
ordinary inference at calls. Examples are worklists, tables, result unions and graph
walkers. Do not require advanced mapped/conditional/template-literal types to author
the first compiler. Their deferral is not a permanent strict-profile exclusion.

Choose descriptor-passing generic bodies as the terminating baseline: a type argument
supplies layout/trace/copy/equality operations as needed, and values travel in typed
indirect slots when their layout is unknown to the body. Descriptor operations must
preserve semantics and carry effects; they do not imply that every type supports
every operation. A constrained field access requires the corresponding structural
view contract, not just a byte size. Do not erase `T` to unchecked `any`.

Known instances may specialize later through the shared optimizer. Self-build must
not depend on unbounded monomorphization. Recursive descriptors use stable interned
identities with references resolved before use; recursive type expansion must not
recursively expand physical reference fields forever. Programs requiring unsupported
polymorphic recursion receive an explicit coverage diagnostic, not compiler divergence.

The type checker validates a generic body against its constraints. Instantiation
must not add writable covariance, invent a layout proof or evade trusted-capability
checks. Node executes the ordinary erased source while native lowering supplies the
representation metadata; source code does not manually pass descriptors everywhere.

## Logical module input primitives

Source catalogs and explicit resolution now use standard string split/slice,
startsWith/endsWith, ASCII-constrained toLowerCase, and array join. These are concrete
self-build dependencies, in addition to the existing Map/Set and sorting operations.
The resolver consumes supplied import requests; it does not add a regex-based or
upstream-compiler-based import scanner to the native compiler source budget.

## Standard encoding globals required by source loading

The source-text module uses TextEncoder and TextDecoder globals, supplied by Node
for bootstrap. Native Tint must implement those standard APIs in its TypeScript
runtime. Do not introduce a parallel compiler-specific UTF-8 codec. Initial required
behavior is UTF-8 encoding, fatal decoding, BOM preservation, streaming decode state,
final EOF flushing and TypeError for invalid input. Constructor calls to these
standard globals and TypeError instanceof checks are now concrete source uses;
this does not require arbitrary user-defined classes as the first implementation step.
The narrow development declarations live in `types/text-encoding.d.ts`.

## Avoid in first compiler source

Defer user-defined classes/inheritance, decorators, runtime enums, namespaces,
destructuring/spread/rest convenience syntax, user-authored predicates/assertion
signatures, advanced type-level programming, arbitrary getters/setters and reflection.
Add each when it simplifies enough real source to justify implementation.

Also avoid async/await/promises, generators, for-of and custom iterators, dynamic
import/eval, proxies, weak APIs, shared memory/atomics, RegExp and broad host libraries.
If iteration is introduced, implement its protocol and abrupt-completion cleanup;
do not lower arbitrary for-of as an array-index loop. These are first-source choices,
not a decision to drop their eventual compatible-mode semantics.

No unsafe casts, definite-assignment escape hatches, unchecked `any`, fabricated
ambient implementations or prototype mutation in the ordinary compiler core.
Safe assertions and `as const` may be added when needed; no assertion substitutes
for a runtime check or a verified static fact.

## Source ledger and evidence

As code appears, maintain a machine-readable ledger with feature ID, source use
(file/symbol), checker rule, required semantic operations, runtime/builtin dependency,
native lowering, positive/negative fixtures and implementation status. Initially mark
all features unimplemented. A source scan is useful for syntax, but inferred types,
indirect calls and method semantics require checker-derived dependency information.

A self-build report must show that every source dependency has a complete path:
parse, bind, check, lower, execute, and validate. It must separately identify trusted
kernel operations and Node-only adapter dependencies. Unsupported syntax, unsupported
lowering and intentional strict rejection are different diagnostics.

Recommended implementation sequence:

1. Word/byte libraries and target encoder/writer fixtures under Node; establish
   exact-byte, overflow and deterministic-layout tests before relying on native output.
2. Small source frontend plus typed IR/verifier and scalar native calls; execute
   Tint-produced fixtures using its own writer/signing path.
3. Records/unions/arrays, strings, roots and allocator/collector; force collection
   across calls and completion handoffs before using large graphs.
4. Expand the checker, generics, collections, closures, cleanup and modules to cover
   actual compiler source. Bring up native host I/O and the compiler CLI.
5. Node emits stage 1; stage 1 emits stage 2; stage 2 emits stage 3. Compare stage 2/3
   artifacts under fixed inputs/options and run independent semantic fixtures.

Write compiler modules to this inventory from their first implementation; do not
build a larger Node-only compiler and later discover its source cannot self-host.
Self-build agreement is evidence of closure and reproducibility, not proof of correct
language semantics. Preserve differential tests and strict rejection tests alongside it.

The [IR/verifier contract](ir-contract.md) and [heap/root descriptors](heap-descriptors.md)
now provide concrete schemas for this inventory. Implementing their verifiers and
fixtures is what turns these obligations into executable checks.

## Initial scanner/parser source obligations

The text-scanner and ts-syntax modules add concrete uses of nested closures, default
parameters, recursive expression/statement parsing, `never`-returning failure helpers,
identity-based exception unwinding, Set lookup, array/string includes, Math.min/max,
ordinary Number string conversion and String.fromCharCode/fromCodePoint. Native
implementations must preserve string code units, numeric rounding and lone-surrogate
escapes. Standard TextEncoder/TextDecoder remain the only source byte codecs.

The implemented grammar is documented in ts-syntax; it is an incremental frontend
slice, not a new bootstrap dialect or a claim that the parser can parse itself yet.
The upstream TypeScript scanner/parser is used only as a development test oracle.

## Scalar checking and IR source obligations

The checker uses nested mutable scopes, object-identity AST map keys and ordered
Map.values iteration. The IR verifier uses Set construction/copying, iteration,
delete during iteration, array map/pop and Number.isSafeInteger. These standard
operations need native implementations before self-build; they are not intrinsic
escape hatches. The production source now also uses object/array spread and destructured iteration;
these are concrete frontend and runtime obligations despite the earlier preference
to avoid them. No upstream checker is embedded in the production implementation.
The test-only evaluator is outside the self-hosting source graph.

The initial IR uses typed slots and block-local values to avoid depending on SSA
promotion for correctness. Cross-block SSA/block parameters can be introduced with
a dominance verifier later. This is an implementation step within the shared pipeline,
not a new bootstrap profile or a decision to use an interpreter in production.

## Native scalar emission obligations

The scalar-aarch64 backend uses standard ArrayBuffer/DataView construction,
setFloat64 and getUint32 to obtain binary64 constant bits. Native Tint must implement
these standard operations; a custom floating-point text or byte codec is not added.
The first native subset preserves the documented typed ABI and binary64 semantics.
Remainder and bitwise native lowering now use shared, TypeScript-authored AArch64
kernels, with the full current scalar IR operation set implemented. Native fixture verification is distinct
from complete frontend coverage or the ability to compile Tint's own source.

## Managed-layout and tracing source obligations

The storage-layout, trace-plan and gc-tracing modules use ordinary records, arrays,
Map/Set identity and bounded iterative worklists. Map.keys/entry iteration is now a
concrete dependency. No new unsafe pointers or user tracing predicates are introduced.
Pointer values cross the tracing contracts as opaque canonical reference identities;
wide-address tests use BigInt only in the test adapter, not the production core.

Before executing these algorithms during native GC, provide noncollecting metadata
and worklist storage. Compiling their ordinary host arrays/maps into allocations on
the heap being collected would create a recursive-collection bug. The current modules
prove layout/scan/root/marking contracts; native allocator and rooting integration
must discharge that separate obligation before managed source fixtures can run.

### Bounded allocation and indexed marking

region-allocator uses Uint32Array indexing/fill, integer arithmetic, Math.ceil and
closure-held control state. Its operational methods create no objects. gc-tracing's
indexed marker uses Uint8Array/Uint32Array indexing/fill, byteOffset/byteLength/buffer
identity for overlap validation, scalar status strings, callbacks, and try/finally
to invalidate provisional marks on reader failure. Native scalar statuses must lower
to static values, callbacks must be proven noGC/noReentry, and control state plus
borrowed buffers must live outside managed storage. Node tests do not establish
those lowering properties. Neither primitive requires a new language feature beyond
the broader bootstrap inventory, and the indexed marker now emits and executes natively. Heap integration is separate.

### Bounded descriptor traversal

trace-plan's catalog now exposes a bounded reference-offset walker. Catalog setup
uses Array.from(Map.values()) and an immutable lookup map; traversal uses a borrowed
Uint32Array stack, scalar statuses and callbacks. No task/reference arrays or result
objects are created while walking. Native catalog placement and callback effects
still require lowering/verification; this does not establish native GC execution.

The [runtime host surface](runtime-host-surface.md) records the current dependency audit
and the finite `node:fs` facade. The compiler core imports no external runtime modules;
standard globals and compiler-owned packages define its remaining runtime budget.

### Current source audit

The latest per-file audit parses 45 of 58 source files, checks 7 and emits 6.
The latest parsing increase is source-text, after adding instanceof syntax.
These figures are coverage diagnostics, not a working compiler build: the audit
neither links imports nor executes emitted artifacts. No native stage-one compiler
has been produced. `pnpm selfhost:coverage` regenerates the report against the
current source tree.

Exception syntax now survives parsing, binding, rewriting, linking and generic
specialization; completion-flow checking is implemented, while native catch/finally
execution remains required. Generic-call lookahead now respects actual type syntax and restores split
shift tokens after failed speculation. Array/object spread now survives parsing, binding, linking and specialization,
including capture tracking and ordered operands. Numeric typed-array and numeric/string/object array operands now
have checking and native array-spread lowering. The numeric and generic list representations
distinguish holes from present undefined; spreading arrays preserves this semantic
distinction and includes undefined in inferred result elements. String iteration,
custom iterables and native object-spread execution remain unsupported. Optional-chain syntax now preserves short-circuit sites through
linking and specialization. The closure checker supports fixed-property/index/function
chains, preserving grouped boundaries and independent property absence; the scalar
checker and native lowering still reject optional chains.
Do-while now has parsing, checking and native lowering, including continue/test
ordering and unconditional body returns. Source parsing still needs destructured
iteration, generic function types and other forms reported by the audit.

Comma expressions now preserve left-to-right evaluation and the final value through
checking and native lowering. The parser source itself parses unchanged; its first
current per-file diagnostic is the unresolved imported SourceText type. Linking its
dependencies is needed to expose subsequent semantic blockers. This does not establish a self-hosted
frontend or a native compiler executable.

Fixed-object spread now has checker support for ordered overwrites, writable inferred
result shapes and optional presence. The generic object-construction contract rejects
possibly absent inputs for required fields. Native spread still requires ordered
property-copy planning, including optional-presence transfer and structural-view
layout handling. This work has not produced a native compiler executable.

Completion analysis now distinguishes returns from throws and implements handler
and finalizer composition for try/finally and catch clauses. Catch bindings now
have checked unknown types, explicit initialization operations and capture support. Native
exception routing and pending-completion storage are still required; checking
these paths does not establish their execution support.

Set construction now infers element contracts from supported array inputs and checks
explicit/contextual contracts. Ordinary arrays retain possible undefined elements;
numeric typed arrays infer number. Native numeric typed-array constructors evaluate
the input once, then populate the set through the existing add helper. Array spread
and constructor population share traversal lowering. The native construction gate
now passes 147 modes, including NaN/signed-zero deduplication, independent source
mutation, empty input and exact 304-byte accounting for the new fixture. Nullable
set encodings, general iterable construction and Map inference remain work.

### Linked graph audit

Run `pnpm selfhost:coverage --entry packages/ts-syntax/src/parser.ts` to audit a
reachable source graph instead of isolated files. The Node wrapper builds a source
catalog and package mappings from workspace manifests. Tint's resolver follows both
runtime and type-only imports/re-exports, and Tint's linker preserves runtime
initializers with instance evaluation enabled. Diagnostics map back to original
files and source positions. Reports distinguish parse, resolve, link and check
failures; a checked graph is still not a native executable or a self-hosted compiler.
Generic specialization and native emission/execution are not performed by this mode.

The parser's five-file graph now parses, links and passes contextual checking. This audit does not yet lower or execute that graph natively.
String.fromCharCode now has numeric checking, shared IR and native emission,
including variadic/empty calls and ToUint16 conversion. The source-text dependency uses instanceof in its decoder error
handling; its syntax now parses, but runtime constructor identity/prototype checking
is not implemented. Both checker entrypoints continue to reject unsupported instanceof
operations. The regular per-file mode remains available without arguments.

Never now has bottom-type assignment rules and completion checking for standalone or
returned never calls. Native nonreturning signatures and general expression effects
remain unsupported. The linked graph also exposed and fixed contextual numeric default
parameters retaining undefined in their local body type. A native fixture verifies
omission, an explicit number and explicit undefined through the same callback.

Uncontextualized object literals now infer fixed writable field shapes, including
empty sentinel objects and nested records. They lower through existing record
allocation and access contracts. Native verification proves distinct empty-object
identity, preserved aliases and checked nested mutation; the fixture allocates
exactly 112 bytes per invocation. Dynamic property addition remains prohibited.

String default parameters now have checking and native entry initialization, including
literal-union contracts and contextually typed callbacks. Omitted arguments and
explicit undefined select the fallback; empty strings do not. Arguments retain their
actual optional encoding in incoming ABI slots, and the existing string presence/value
IR handles initialization. Native verification includes observable lazy defaults and
callback calls. Concrete boolean defaults are now also supported, as described below.

Math.min/max now have numeric checking and native execution through existing scalar
IR. Zero arguments, infinities, NaN, signed-zero ties and argument evaluation are
covered by the native construction fixture. The linked lexer subsequently reached string +=, now supported for local/captured
string bindings through the existing concatenation and cell operations.

String += now checks and executes natively for local/captured bindings, preserving
old-value-before-RHS evaluation and the assignment expression result. Its native
fixture covers RHS mutation and narrowed optional strings with exact 176-byte
allocation accounting. Property/index compound targets remain unsupported. That change exposed String.fromCodePoint, which now has baseline native lowering.

String.fromCodePoint now checks numeric operands and constructs UTF-16 through reused
code-unit and concatenation instructions. Native tests cover valid Unicode boundaries,
surrogates, zero/negative zero, empty calls and six invalid-input classes. Invalid
inputs currently trap, not throw catchable RangeError; general exception completion
and error-object construction are still mandatory work. The next linked lexer blocker
is its typed, initially unassigned kind/value locals.

Typed noncaptured locals can now defer assignment until after declaration, with
path-sensitive checks before reads and native lowering verified for stores on all
incoming paths. Nullable declarations initialize to undefined. Captured/module deferred
bindings and more precise loop/exception exit proofs remain work. The linked lexer
now proceeds to its operator-array loop: possible array holes make the iteration
value string-or-undefined, which cannot be passed to s.match without a proof or guard.

The lexer now explicitly guards the operator-table entry before passing it to the
scanner's string match contract, retaining strict handling of potentially sparse
arrays. Its existing TypeScript token-oracle tests still pass. String.includes now
checks and executes natively using shared UTF-16 prefix matching. The linked graph
advances to the parser's reserved-word split call; this does not establish a native
lexer or parser executable.

String.split now checks and executes natively for string/undefined separators and
numeric/undefined limits, using the explicit string-list runtime and shared string
operations. Twelve native fixtures compare results against Node, including runtime
optional arguments, UTF-16 splitting, empty fields and ToUint32 limits. Regex/custom
split behavior remains unsupported. The linked graph next encounters the parser's
`token: Token = current()` default. Reference-valued defaults now pass this point;
the subsequent boolean default is also supported.

Object defaults reuse optional-reference inputs, with lazy construction and preserved
supplied-object identity. Portable verification covers captured defaults; native execution
checks omission, explicit undefined, allocation counts and identity. The native filesystem
facade, full compiler graph and stage-one/stage-two self-build remain unfinished.

Boolean defaults and boolean-or-undefined values now use a dedicated 16-byte
optional-boolean ABI: a canonical 0/1 payload and a separate presence word. Native
verification covers true, false, omission, explicit undefined, lazy initialization,
optional fields, and parameter/result transfers. Equality compares boolean payloads
as integers; no source-level numeric conversion is introduced.

Conditional expressions now infer unions when neither branch is assignable to the
other, reusing the checked type graph. Undefined guards remain required before reading
an inferred optional object. This advances the linked parser graph past its inferred
TypeNode-or-undefined local to tokens.splice at line 173. This audit checks sources;
it still does not emit or execute the complete compiler graph.

Splice prerequisites now exist in both list storage implementations: presence checks
and indexed deletion distinguish holes from stored undefined without changing length.
Generic sparse storage also supports validated resizing, walking populated map entries
instead of the logical sparse range. Native fixtures compile these helpers from their
TypeScript source and verify high sparse indices, truncation, expansion and deletion.
The source Array.splice intrinsic and lowering now use those helpers; the parser graph's
object-spread insertion argument at line 176 now checks against its optional object context.

Array.splice now checks mutable supported arrays and lowers through shared list
operations. Receiver and arguments are evaluated once before reading length. It handles
omitted arguments, explicit undefined, clamped numeric indices/counts, both tail-shift
directions, holes and reference identity. Native fixtures cover numeric, string and
object arrays with exact allocation accounting. The algorithm follows the
[ECMAScript splice steps](https://tc39.es/ecma262/multipage/indexed-collections.html#sec-array.prototype.splice)
within the supported strict-array profile. This strict ordinary-array slice does
not support proxies, accessors, custom species or coercible object arguments; oversized
results currently trap rather than throw a catchable RangeError.

Object spread now selects the present fixed-object type when the context is an object
or undefined. The expression itself remains present, while field compatibility and
required-field checks still apply. This handles the parser's Token copies inserted
into the array inferred from spreading the scanner result. General multi-object union
contexts and native ordered property-copy lowering remain unfinished.

The linked parser audit now reaches Number(tokenText.split("_").join("")) at line 272.
Number conversion and array join require runtime implementations, including numeric
text conversion semantics; the current checker rejects the Number global call. This is
not proof that the earlier source graph can be emitted: native spread, exception
routing and other representation work still block a complete compiler build.

String-array join now checks and executes natively through existing list/string IR.
The parser's split("_").join("") operation no longer needs a new join runtime path.
Native cases cover comma defaults, direct omission, optional/empty separators, holes,
stored undefined, UTF-16 and receiver/argument effects. The supported string-array
behavior follows [Array.prototype.join](https://tc39.es/ecma262/multipage/indexed-collections.html#sec-array.prototype.join).
General element-to-string conversion remains pending. The linked parser audit still
stops at Number(...) at line 272; implementing join does not remove that independent
numeric-text conversion blocker. Native object spread and complete compiler hosting
also remain unfinished.

The new dependency-free @tint/number-text package implements the string portion of
Number conversion with exact base-2^16 integer arithmetic and ties-to-even binary64
rounding. Portable differential tests and six native fixtures cover grammar, long
significands, radix inputs, signed zero, subnormals and overflow boundaries. All its
functions pass Tint checking, lowering and instruction emission. The initial exact
algorithm allocates many temporary integers; it is not yet an optimized conversion
path. Wiring the helper into the Number(...) intrinsic remains the next parser task;
the linked parser graph still stops at that call at line 272.

Number(string) now checks and lowers to the explicit numberFromString runtime binding.
The six native numeric conversion fixtures invoke Number(...) through this path rather
than directly calling the implementation. Helper signature validation, absent-helper
rejection, entry relocation and source shadowing are covered. The linked parser graph
advances to line 341, where a narrowed array TypeNode is spread into a TypeNode union
assignment. Multi-variant spread context selection and native property-copy lowering
remain unfinished, as does the complete native compiler/self-build.

Object-spread checking now selects one compatible object variant after ordered field
merging, with contextual explicit properties drawn from candidate fields. Ambiguous or
incompatible results remain rejected. Readonly discriminants can themselves contain
finite literal unions; each possible tag retains the original variant, and refinement
subsets are deduplicated. Alternative logical paths union their proven variant sets
only when both paths establish a refinement for the same binding. A path with no such
proof cannot inherit the other path's narrower type.

These changes advance parser checking through its readonly TypeNode copy and optional
chain loop to splits.pop() at line 433. Native ordered object-spread copying remains
unfinished; checker progress is not proof of full graph emission or self-hosting.

Array.pop now lowers through list reads and resizing, returning an optional element
and preserving empty/hole behavior and object identity. The array includes intrinsic
uses SameValueZero comparisons and clamped integer positions with a captured length.
It supports numeric, string and object arrays, including undefined/hole searches,
NaN and signed zero. Native fixtures exercise each representation. Both operations
reuse existing list/runtime and scalar IR contracts; no backend-specific kernel was
introduced. Pop requires a resize helper, while includes only needs reads and length.
The linked parser graph now reaches the empty-array branch at line 560. Native object
spread, full host integration and the complete self-build remain unfinished.

An empty array branch in a conditional can now infer its array context from the other
branch, in either branch order, without leaking branch-local presence facts. Readonly
array restrictions remain intact. Native execution verifies lazy branch evaluation,
source-array identity and distinct fresh empty arrays. The parser now reaches its
update-expression object at line 572; the preceding token.value guard must narrow a
readonly string property to the allowed update-operator literals. Native object spread
and complete self-hosted compiler execution remain unfinished.

The complete linked parser graph now passes Tint contextual checking. Readonly primitive
field equality guards support literal refinements and OR joins. Calls invalidate these
observations because a writable alias can change the field; property writes and binding
reassignment also clear proofs. A native fixture verifies guarded string fields passed
to a literal-union parameter, including allocator exhaustion accounting.

The parser snapshots its update operator before recursive calls, guards ordinary-array
iteration values and explicitly annotates declaration-mode literal unions. Definite
assignment now merges normal try/catch continuations and assignments guaranteed by
finally. Finally reads retain entry facts because exceptions may precede an assignment.
Native exception routing, object-spread lowering, runtime integration and the actual
stage-one/stage-two compiler builds remain unfinished.

The next broader graph audit (`--entry packages/closure-lowering/src/index.ts`)
now parses its `for (const [binding, id] of direct)` loop and runtime-helper
factory, and stops at destructured callback parameters in environment planning. The parser graph's successful
check therefore does not establish that the complete compiler graph is accepted.

Flat array for-of patterns now have explicit syntax, per-name binding identities,
source origins and linker rewriting. Contextual checking accepts Map entry patterns
with separate key/value contracts, elisions and undefined for positions beyond the
pair. Native lowering explicitly rejects these patterns until an ordered live Map
iterator is implemented. Current linked-map storage prepends entries; traversing its
head/next fields would give the wrong iteration order and mutation behavior. Defaults,
rest and nested binding patterns remain outside this slice.

The runtime-helper factory now uses a named local function declaration and returns
that function. It captures a validated type-system value directly, avoiding a captured
Result narrowing assumption. General named function expressions remain unsupported.
Relational `in` syntax is parsed; both checker paths reject it rather than treating it
as a numeric binary operation. Strict presence narrowing cannot assume a property
absent from a structural type is absent from the actual object. The broader compiler
graph next needs callback parameter patterns (first seen in environment planning).

The closure-lowering entry graph now discovers 23 source modules, parses all of them
and links successfully. Environment planning uses explicit ordered loops and named
hoisted-function/cell/constructor contracts instead of destructured flatMap callbacks.
The factory return projection uses a typed statement array instead of satisfies; other
bootstrap-only syntax reductions remove a local object destructure, logical assignments
and keyof ListRuntime. ListOperation explicitly names that runtime operation surface.
Named helpers now expose their return types.

Literal intersections now select tagged object variants, including the compiler's
Statement & {kind:"function"} alias. Incompatible literal tags reduce to never and are
removed from union alternatives. Compatible primitive/literal fields narrow to the
literal; conflicting optional literal fields still allow absence. General disjoint
primitive/object intersections and recursive unresolved intersections remain restricted.
The next linked checking diagnostic is Number.isFinite in value-types. Successful
parsing/linking is not successful native lowering or a self-hosted compiler build.

Number.isFinite is now checked and lowered in both scalar and closure entry paths.
Native validation covers finite fractions, signed zero, subnormals, the largest finite
value, NaN/infinities, absent optional numbers and nonnumeric arguments with effects.
The compiler graph advances through that operation and object-property validation to
Array.map in value-types. For-of no longer discards enclosing immutable discriminant
proofs before evaluating its iterable; mutable field observations remain invalidated.
Sparse input property tables now produce INVALID_TYPE instead of a host TypeError.
The 23-module graph still has checking and native-lowering work before stage one.

Array.map now has contextual callback checking, expression-result inference and native
list/indirect-call lowering. Input presence checks distinguish holes from stored undefined;
length is snapshotted after receiver/argument evaluation. Tests cover callback indices and
source arguments, mutable source updates and appends, readonly string inputs, captured
state and object identity. Callback defaults/optional parameters and thisArg remain outside
the inline callback slice. The linked compiler audit now passes the property-table maps
and stops at an optional minimumArguments property used as a required numeric operand
in value-types. Complete graph lowering and stage-one/stage-two builds remain unproven.

Readonly optional-field presence proofs now pass checking and native lowering for
number/string/reference fields. Literal comparisons also refine optional readonly
fields. Defined reads unwrap their physical tagged storage; proven-absent reads produce
undefined after receiver evaluation. Effectful calls/arguments and writes cannot retain
stale proofs. Native fixtures exercise omitted and present fields with exact allocation
and exhaustion accounting. The compiler graph now reaches function parameter-array
spread in value-types: spreading an ordinary array can copy holes as undefined, so the
strict element contract requires a dense-copy proof or explicit validation before use.

Function parameter and union-member snapshots in value-types now validate entries while
copying into explicit dense arrays. They retain input snapshot isolation and invalid-table
rejection without relying on spreading a potentially sparse numeric array. The compiler
graph next exposed repeated exclusions of union-valued tags; these now track remaining
literal values as well as object variants. Const local presence facts survive switch/loop
completion. A native fixture validates multi-tag switch defaults and immutable presence.
The linked audit now reaches Array.some in value-types; complete compiler checking,
native graph lowering and self-hosted stage-one/stage-two builds remain unfinished.

Array.some now shares callback checking and native sparse iteration with map. Native
fixtures cover early exit, source mutation, appended elements, holes versus stored
undefined, empty input and numeric/string truthiness. Switch assignment joins now collect
break facts at the actual target, preserving assignments across exhaustive cases without
accepting conditional uninitialized exits. The broader compiler graph reaches edges.push
in value-types; that table stores nested readonly numeric arrays, whose reference-element
collection contract still needs implementation. Complete native compiler execution and
stage-one/stage-two self-build remain unverified.

## Nested arrays in source checking

The closure checker accepts arrays of supported arrays, including readonly inner
views, sparse outer reads, inferred nested literals and callback inputs. Writable
and readonly contracts remain distinct at each level. Recursive array-only shapes
remain outside this finite collection check. Native collection bindings now accept array references when their inner runtime
is registered. Native fixtures verify nested string-array identity, holes and stored
undefined, plus numeric arrays stored through readonly inner views. Optional unions
from generic specialization retain reference presence encoding. Recursive array-only
shapes and arbitrary mixed collection unions are not established by these fixtures.

An empty array on the right of `??` can obtain its contextual type from the present
left operand, matching the existing empty-array conditional handling. Iteration
still includes possible undefined elements; the type graph traversal explicitly
checks those before recursive calls. The closure-lowering graph audit now reaches
the mixed string cache-key expression in `value-types` (`a + ":" + b + ":" + exact`).

## Primitive string concatenation and numeric formatting

The closure pipeline now accepts string `+` with number or boolean operands in either
order. It evaluates operands once, left to right, and calls an included exact
`(number) => string` runtime helper for numeric operands. Boolean text uses native
branches and static literals. General object coercion, optional primitive coercion
and mixed `+=` are not included in this slice.

`numberToString` in `@tint/number-text` owns decimal conversion in TypeScript. It
constructs an exact decimal expansion using existing integer limbs, considers
successively longer decimal candidates, and uses the compiled exact parser to
select the shortest round-tripping candidate, preferring nearest and ties-to-even.
This is deliberately a correctness-first, allocation-heavy baseline. Native tests
cover integer/fraction/negative formatting, zero and special values, mixed concatenation
order, and the shortest representation of 0.1; portable differential tests exercise
boundary values and 2,000 deterministic binary64 values. This is not an exhaustive
binary64 test or a claim of optimized formatting.

## Stable captured narrowing and finite tag comparisons

Record writes now discard observed field facts while preserving const-binding
variant facts, matching the existing call-invalidation policy. Arrow expressions
inherit stable facts at creation, including const optional-value presence and const
object variants. Mutable captures, field observations and hoisted declarations do
not gain these facts. Native fixtures verify both a captured variant whose payload
changes after closure creation and a captured optional number used after a guard.

Strict equality between readonly finite discriminants intersects their possible
values at that comparison. Inequality excludes an opposing singleton; it does not
exclude a whole multi-value set. The checker does not retain a relational equality
constraint to propagate future narrowing between the operands. Native tag tests
cover matching, mismatching and singleton exclusion paths.

The value-type union relation builder now uses checked loops to construct its dense
clause arrays, avoiding a spread whose static element type included holes. The next
front-end blocker is Array.find in object-property matching.

## Array.find

The shared array callback pipeline now supports `find` for ordinary strict-profile
arrays. The input length is captured once; every index in that range is read, including
holes and deleted elements. Callback inputs therefore include undefined. The first
truthy result returns the element read before the callback, not a reread of a possibly
mutated position. No match returns undefined in the element's optional encoding.

Native tests cover early termination, mutation of the matching slot, deleted elements,
holes, ignoring appended positions, empty inputs, false/NaN/negative-zero predicates,
string matches and object identity. Numeric, string and object absence encodings are
exercised. This uses ordinary compiled callbacks and existing IR, with no new backend
instruction. ThisArg, proxies, inherited indexed properties and predicate type assertions
remain outside this strict array slice. See the [specification](https://tc39.es/ecma262/multipage/indexed-collections.html#sec-array.prototype.find).

The type-system property matcher now explicitly checks potentially sparse iteration
and find-callback values. The next source-checking blocker is arrays of Set values.

## Arrays of sets

Supported numeric/string sets may now be array elements, including readonly set
views. The array stores managed references, preserving identity and mutations through
aliases. Native lowering requires registration of both the array runtime and the set's
element runtime. An outer-array registration alone is rejected. Portable tests cover
inference, map output, element-type rejection and readonly restrictions; native tests
exercise shared set mutation/deletion/reinsertion and a readonly string-set view.

The relation worklist checks each possibly missing clause, reference and parent set
before use. Its next unsupported operation is Set for-of iteration. This requires
insertion-order and live mutation behavior, not direct traversal of the current
prepend-linked set representation.

## Ordered set cursor foundation

The linked-set runtime now provides create/advance/read cursor operations. Monotonic
entry sequence numbers preserve live insertion order while deletion and clear still
unlink nodes immediately. Cursor advance scans only live entries and allocates no
result object; exhausted cursors release references and cannot resume. This baseline
has linear advancement and quadratic complete traversal. Sequence overflow fails
before insertion, preserving state.

Portable differential tests compare concurrent cursors and interleaved mutations with
JavaScript Set. A native fixture exercises deletion, reinsertion, clear, insertion and
permanent exhaustion with exact allocation accounting. Set and entry layouts gained
sequence fields; descriptor checks and affected native allocation budgets were updated.
Source for-of integration and numeric-zero canonicalization at the Set syntax boundary
remain required. The self-hosting audit still stops at Set for-of.

## Native Set for-of integration

Set<number> and Set<string>, including readonly views, now lower for-of through the
registered cursor helpers. The receiver is evaluated once. Each iteration advances
the live cursor, reads a present element, and initializes the loop binding; continue
advances and break exits. Existing per-iteration capture cells preserve closures.
Missing, excluded, mismatched and incorrectly typed iterator helpers are rejected.

Set syntax canonicalizes numeric zero before insertion, including typed-array
constructor inputs. Generic linked-set storage retains its original value contract.
Native fixtures cover mutation/reinsertion/clear, string order, break/continue,
per-iteration closures, direct and constructor negative-zero insertion, and empty
iteration with a side-effecting readonly receiver. No new machine instruction or
separate iteration engine was introduced. The next source-checking blocker is
Array.every in the relation worklist.

## Array.every and optional discriminant narrowing

Array.every uses the shared native callback loop, snapshots the receiver length,
skips absent elements, accepts truthy/falsy callback values, and stops on the first
falsy result. Empty arrays return true. Native fixtures cover short-circuiting,
mutation and holes, empty input, and string callback results.

The contextual checker now recognizes optional readonly discriminant comparisons
such as `item?.kind === "a"`. A matching branch narrows the receiver to the selected
object variants. A branch that can still contain an absent receiver remains
conservative; inequality does not incorrectly establish presence. Focused positive
and negative checks cover both branches and reversed comparison operands. This is
checker coverage, not a claim of complete native optional-chain lowering.

The value-types property lookup guards its Array.find callback element against
undefined, consistent with hole-visiting semantics. The 23-module source audit now
advances to Array.findIndex at that lookup; it still reports selfHosted false.

## Additional entry-point audits

These independent front-end audits expose first failures outside the closure-lowering
graph. They do not enumerate all blockers and do not attempt native emission:

| Entry (`packages/<name>/src/index.ts`) | First observed boundary                                                                                               |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `scalar-aarch64`                       | Parser rejects exponentiation in string-literal byte emission (`2 ** (b * 8)`).                                       |
| `macho`                                | Checking rejects the `integer(r, 0, 30)` call behind a `typeof r === "number"` guard in the AArch64 register encoder. |
| `file-service`                         | Checking reports that generic `readFile<H>` requires specialization.                                                  |

Reproduce each with `pnpm selfhost:coverage --entry packages/<name>/src/index.ts`.
The file-service result describes this unspecialized audit entry, not evidence that
all generic calls are unsupported; generic runtime helpers already have native tests.

## Array.findIndex and value-types source acceptance

Array.findIndex shares the native find callback loop. It snapshots length, visits
holes and deleted indexes as undefined, observes mutations at later indexes, and
returns the first matching index or -1. Callback signatures include possible
undefined elements and preserve readonly receiver restrictions. Numeric, string,
and object fixtures exercise short-circuiting, mutation, holes, no match and empty
input, using the existing list runtimes and machine-code pipeline.

The value-types source now guards find/findIndex callback elements and for-of
reads explicitly where the strict profile permits holes. Its property relation,
lookup, write, construction and call logic pass the contextual-checking stage in
the linked closure-lowering audit. The audit next stops in storage-layout's
fieldsValid loop at an unchecked field element. This is source-checking progress,
not native compilation of value-types or a self-hosted compiler.

## Layout source guards

Storage-layout now explicitly rejects holes in field and variant lists with
INVALID_STORAGE, and retains presence guards when placing validated entries.
Closure-layout similarly rejects holes in the representation list with
INVALID_REPRESENTATIONS and guards binder-produced binding and scope entries.
Regression tests demonstrate that sparse inputs return their documented error
results instead of throwing JavaScript property-access exceptions.

The linked closure-lowering source audit now passes storage-layout and reaches
Array.filter in closure-layout environment planning. Native self-build remains
unverified; these guards do not establish complete native layout-module coverage.

The standalone storage-layout audit (`--entry packages/storage-layout/src/index.ts`)
reports `stage: checked` for storage-layout, bytes and word64. This validates the
three-module front-end graph only; it still reports `selfHosted: false`.

## Native Array.filter

Array.filter now uses the shared native callback loop. It snapshots input length,
skips absent entries, calls the callback with element/index/receiver, and writes
accepted original values densely into a new mutable array. Callback mutation does
not substitute a new value for the already-read element. The checker retains the
input element type, including explicitly declared undefined values; this slice does
not infer a narrower result from a predicate.

Native fixtures cover deleted entries, mutation of the current value, empty input,
all-falsy results, stored undefined, strings and object identity. Closure-layout now
annotates its field array and guards further binder-produced entries. The linked
source audit reaches Set spread (`[...scopes]`) in capture planning, which requires
iterable array construction support. This remains front-end progress rather than a
native self-build.

## Native Set spread

Array literals accept spreads of Set<number> and Set<string>, including readonly
views. Each spread expression is evaluated once and traversed through the registered
Set cursor helpers already used by for-of. Values append in live insertion order;
the array remains independent of the source Set. Missing iterator registrations are
rejected at the adapter boundary. Arbitrary iterable protocols remain unsupported.

Native fixtures exercise numeric spreads with surrounding array elements, deletion
and reinsertion order, string duplicate suppression, readonly views, and empty
Sets with side-effecting receiver evaluation. The closure-lowering source audit now
reaches Array.sort in closure-layout capture planning, after accepting Set spread.

## Sorting runtime foundation

`@tint/indexed-sort` supplies stable comparator sorting without a storage-specific
implementation. Its finite indexed access contract separates collection, comparison,
and writeback. Portable coverage includes sparse differential tests, undefined ordering,
comparison exceptions and receiver mutations. The unchanged generic implementation
also runs as native code through a numeric record-backed fixture with exact allocation
and exhaustion checks. Array.sort compiler registration remains outstanding; the linked
source audit still stops at that operation in closure-layout.

## Comparator-sort contextual checking

The contextual checker accepts Array.sort with one explicit numeric comparator on
mutable ordinary arrays. It supplies two defined element inputs, permits fewer
callback parameters, preserves the original array type as the result, and rejects
readonly receivers, incompatible callback arguments and nonnumeric results. Block
comparators get a numeric return context. Comparator-free sorting and broader
coercing comparator returns remain unsupported in this native slice.

This advances the linked source audit through closure-layout to an unchecked binding
read in closure-lowering/planning.ts. The native indexed-sort primitive is already
verified, but Array.sort runtime registration and native call lowering remain pending.
The source audit's progress must not be interpreted as native sort syntax support.

## Native comparator-sort registration

List runtimes can register a comparator-sorting helper. The adapter validates its
receiver, returned representation, numeric comparator result and exact two-element
input contract, and relocates included helper IDs. Sort calls evaluate receiver and
comparator once and invoke the helper through the normal managed native ABI.

`@tint/list-sort` provides thin numeric and sparse adapters to the unchanged generic
indexed-sort core. Native fixtures cover receiver identity, number/string ordering,
stable object identity, explicit undefined and holes, comparator mutation beyond the
original extent, empty input and NaN comparisons. Comparator-free sorting remains
unsupported. Indirect calls still require an included native signature witness.
The previous Array.sort native-registration gap is closed for these verified paths;
the current source audit remains at closure-lowering/planning.ts and self-build is
still unverified.

## Stable facts in effectful logical guards

Logical AND/OR/negation refinement now preserves const-binding presence and declared
variant facts across effectful operands. It discards newly reconstructed mutable
binding and observed-field facts that a call could invalidate, while retaining facts
already proven valid after evaluation. Positive/negative tests cover nested guards,
mutable captures, alternative OR paths, observed fields and safe existing facts.
A native fixture verifies short-circuit calls and both continuing branch directions.

Closure planning now guards sparse reads and explicitly types its representation
array. Record type lookup guards findIndex candidates and uses a const snapshot for
a nested callback. The linked audit advances to array-valued default parameters in
records.ts. This is still not a complete compiler-source check or native self-build.

## Supported array default parameters

Default parameters now accept the ordinary array encodings already supported by the
runtime: numeric, string and reference elements, including readonly views. They use
the existing optional-reference argument ABI. Omitted and explicit undefined arguments
initialize a fresh default; supplied arrays retain identity and skip initialization.
Later defaults can reference earlier initialized parameters. The checker preserves
element and readonly contracts and rejects references to later parameters.

Native fixtures cover fresh numeric/string/object arrays, supplied aliases, readonly
views, and dependent defaults. The compiler-source audit remains at CollectionElement[]
in records.ts because that element type mixes strings and numbers. Supporting array
defaults does not itself supply a heterogeneous primitive-union array encoding.

## Semantic primitive-union arrays

Explicit array element contracts can now combine number, string, boolean, undefined
and existing reference types. Array defaults, callback input types, readonly views,
mutation checks and hole-aware reads use those semantic contracts rather than requiring
a homogeneous native encoding at checking time. Existing first-element inference is
unchanged; this does not infer arbitrary heterogeneous literals without a context.

A negative lowering test proves a mixed string/number array cannot silently use the
numeric-only list runtime. The tagged-union plans in value-layout remain to be connected
to executable values and collection storage; native mixed-array execution is not yet
implemented. This is a remaining self-build requirement, despite front-end acceptance.

Record-source callbacks now provide a return annotation and explicit presence guards.
The linked source audit advances to the global String(i) conversion used for field IDs.

## Primitive String conversion

String() and String(value) accept no argument or a supported number, boolean, string
or undefined input. Local bindings named String retain ordinary call semantics. Objects,
heterogeneous input unions and extra arguments are explicitly unsupported in this slice.

Numeric conversion shares the existing exact formatter contract with concatenation;
missing, excluded and incompatible helpers are rejected. Native lowering shares the
primitive conversion routine, evaluates arguments once, distinguishes no argument from
undefined, and preserves string values. Native fixtures cover effectful number and
undefined producers, boolean values, zero, NaN and infinity. The linked source audit
now reaches names[shape]?.indexOf(name) in record access planning. Tagged-union native
storage and self-build remain outstanding.

## Native Array.indexOf

Array.indexOf shares includes' index normalization and traversal infrastructure, with
strict equality, hole skipping and a numeric result (-1 when absent). Registration
requires a presence helper so holes cannot be confused with stored undefined. Native
fixtures cover NaN, signed zero, infinities/fractional start positions, stored undefined,
strings, object identity, empty input and receiver/argument evaluation order.

Record planning snapshots its optional field-name array and explicitly guards it before
calling indexOf. This preserves one receiver read without claiming general optional
builtin-method dispatch. The linked audit passes records.ts and next stops at
Number.isSafeInteger in the scalar IR verifier. Native tagged-union support and the
complete native self-build are still outstanding.

## Latest verifier-source progress

Number.isSafeInteger now lowers through the existing integer predicate and inclusive
safe-integer bounds. It does not coerce strings, booleans, objects or undefined.
Grouped switch clauses and if merges retain the union of reachable refinements;
strict literal comparisons narrow finite primitive unions, including undefined.
These checks reuse the existing type facts and native scalar operations.

Set construction accepts mutable and readonly Set inputs and preserves their element
type without adding array-hole undefined. The adapter shares the iterator contract
used by Set spread, and the scalar constructor reuses its existing iteration loop.
Native tests cover copy independence, order, NaN, positive-zero normalization, empty
inputs and one-time argument evaluation.

The scalar IR verifier now explicitly rejects missing records, fields, slots,
parameters, environment cells and graph entries; local snapshots preserve narrowed
metadata across calls. Its dataflow sets are built from numeric slot indices and
copied through Set iteration, avoiding a potentially hole-bearing array constructor.
This is a source-checking milestone, not native execution of the complete verifier.

Validation for this checkpoint: `pnpm check` passes 699 portable tests plus type,
package-boundary and formatting checks. `pnpm verify:construction` passes 296 native
modes, each successful and exhausted image executed twice with test-only trap handling.
The source audit reports `unsupported binary operator: in` at the boundary above.

## Continued bootstrap validation

The closure-lowering source graph now checks through its owned and borrowed closure
adapters and factory construction. The checker preserves primitive `typeof` guards,
optional discriminants, and narrowed variant joins through logical/conditional
expressions. Calls retain whole-binding refinements for uncaptured locals; observed
property refinements and captured mutable bindings remain effect-sensitive. Optional
object fields use their write type when contextualizing supplied values.

Array binding patterns now carry an explicit `array-binding` discriminator. Scalar
IR provides `instructionResult` for the result identity of its closed instruction
union, including effect-only operations and void calls.

`Array.prototype.slice` uses the common list runtime contracts and scalar IR in native
code. Thirteen native cases cover omitted/undefined bounds, negative/fractional/NaN/
infinite bounds, sparse holes versus present undefined, independent arrays with shared
object identities, and receiver/argument evaluation order. All passed with allocator
success/exhaustion checks. The prior complete native run passed 299 modes; the current
suite includes 312 modes and awaits its next complete run. The latest portable check
passed 708 tests plus package boundaries, typechecking, and formatting before backend
source adaptations.

The scalar-aarch64 (12 modules) and Mach-O (8 modules) entry graphs now also pass
front-end checking. These and closure-lowering are regression gates. A later full
native run passed 314 modes after the emitter source adaptations; nested generic
helper coverage adds a further passing native mode. Portable validation passed 712
tests before the nested-specialization additions.

The remaining module-linking graph now parses. Its diagnostic audit can run explicit
generic specialization with `--specialize`, reporting the number of concrete instances
and retaining `selfHosted: false`. Uninstantiated generic templates are not verified by
that pass; it is not a substitute for a complete compiler entrypoint and build proof.
Native source loading still needs the standards-based TextEncoder/TextDecoder globals.

### Executable checker and linker audits

The runtime graphs for `ts-checker/src/index.ts` and `ts-linking/src/index.ts`
now pass Tint's contextual checker (200 and 169 functions respectively in this
snapshot; linker preparation instantiates 11 generic helpers). These are source
acceptance gates, not native builds. Type-only dependencies still contribute
only declarations. `pnpm selfhost:coverage --entry <path> --specialize --emit`
now separately attempts linked native lowering and instruction emission. The
checker graph currently stops on an array representation because its collection
runtime bindings have not been registered automatically.

`@tint/type-syntax` converts reachable finite checked type graphs into recursive
named type syntax. It is intended to supply exact specialization arguments for
runtime collection implementations without hand-maintained fixture type lists.
It does not itself select or link runtime helpers. Native emission of the whole
compiler, the native filesystem/standard-global integration, the compiler CLI,
and the stage-one to stage-two same-source rebuild remain unproven.

Runtime specialization now has a native integration fixture using reified
anonymous object contracts and unchanged sparse-list/map helpers. Native
object-valued Set operations and iteration also pass identity, mutation and
exhaustion checks. `collectRuntimeRequirements` discovers helper requirements
from executable checked contracts, including recursive fields; automated helper
registration is still being integrated. The checker graph currently needs 44
list and 19 map encoding bindings; several mixed-primitive Set/array contracts
still lack native representations. These counts are a diagnostic snapshot, not
a self-hosting percentage.

### Automatic runtime registration

`@tint/ts-native/runtime` now prepares numeric lists, string/reference lists,
primitive/reference Sets, and Maps from checked program demands. A native
integration fixture composes all four collection kinds, verifies the result and
exact allocation accounting, and verifies exhaustion. The composed runtime
preparation source graph passes contextual checking (675 functions in this
snapshot). `--runtime` on the linked audit loads and registers the collection
source templates before emission; the bytes package graph reaches native
emission through this path. The whole checker graph now stops explicitly on
mixed-primitive collection representations, rather than missing manual runtime
bindings. Sorting/conversion adapters and the remaining native language and
host support still need integration. There is still no stage-one compiler.

Finite type tables have no fixed node-count ceiling. The initial 4,096-node
limit and its temporary 65,536-node replacement were defensive implementation
choices, not representation constraints, and have been removed. Available
memory bounds storage; future compilation resource budgets belong to caller
policy. Independent recursive-depth and intersection-expansion guards remain.

### Managed mixed-primitive values

`@tint/native-runtime/values` supplies ordinary TypeScript constructors, checked payload
extraction, strict equality, SameValueZero, truthiness, and collection-key
normalization. Its baseline managed record occupies 48 bytes on the current
64-bit target. The scalar IR records the primitive-box distinction explicitly;
root maps trace the box and its optional string payload through existing
machinery. Raw pointer equality and truthiness on this representation are rejected.

The native pipeline uses inline tag/payload storage at mixed-primitive function
boundaries and extracts payloads after narrowing. Homogeneous scalar and optional
scalar/string encodings remain specialized; explicit primitive runtime bindings
retain their managed box contract. Native fixtures verify `typeof`, strict comparisons,
truthiness, nullish coalescing, arrays, Sets, and Maps using the same runtime
functions. Set tests include distinct NaN boxes and negative-zero iteration.
Runtime helper registration checks both scalar signatures and shared box-shape
contracts, including relocated function IDs. These fixtures include exact
allocation accounting and exhaustion runs.

Mixed primitive collection support has advanced beyond the earlier blocker
snapshot above. Optional numeric and string Sets also have native coverage; other remaining source
features still need coverage; there is still no stage-one compiler or same-source
stage-two rebuild. This baseline leaves room for later unboxed representations
and allocation elimination without changing source semantics.

### Current native lowering and unknown-value storage

The complete construction gate passed 344 modes after native exception handling,
finally cleanup, Map iteration, and general-value transfers were added. Subsequent
focused native gates cover optional member/index chains and automatic numeric/string
sorting. Exact allocation accounting and exhaustion checks remain enabled, with
process-local trap handling to avoid macOS crash-report windows.

Unknown values have a 16-byte general representation: a 64-bit category followed by
a 64-bit payload. Native calls, records, returns, throws, catch bindings, narrowing,
typeof and strict equality carry this representation. Catch/finally support includes
rethrows, cleanup overriding a pending completion, and cleanup on return/break/continue.
Null, symbol and bigint source construction remain outside this implemented slice.

Portable trace plans select only reference-bearing general payloads. Native record
and root descriptors now include general-slot offsets separately from unconditional
reference offsets. The native tracing collector consumes these conditional entries; hosted stress
tests exercise live references across collection and allocation retries.

Map cursors preserve insertion order under mutation, including delete/reinsert and
clear/add. Optional member/index chains evaluate their receiver once and skip later
index expressions and property reads when short-circuited. Optional calls remain a
separate lowering gap. Fixed-record spreads snapshot values, preserve presence, omit
overwritten stored-field reads, and restrict conditional literal operands to their
actual constructed shapes.

Automatic runtime preparation now registers demanded sorting adapters. Indirect calls
intern missing ABI signature contracts rather than requiring a concrete matching
function in the module. Numeric conversion helpers are registered and have native automatic-binding fixtures.
The full compiler graph passes contextual checking, runtime specialization, native
lowering and machine-code emission under Node. A native stage-one compiler exists
and reaches source parsing with its native host bindings and collector. The
same-source stage-two rebuild remains outstanding. Current scaling work replaces
linear generic-array storage with balanced indexed storage and the verifier's
per-block heap sets with compact bit vectors. These improvements do not substitute
for the actual native rebuild proof.
