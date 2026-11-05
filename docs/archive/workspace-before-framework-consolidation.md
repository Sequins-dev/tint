# Workspace and module contracts

The implemented workspace includes portable binary layout, AArch64 encoding, hashing,
ad-hoc signing and a minimal macOS executable publisher, all hosted under Node.
Tint compiles a growing TypeScript subset to native arm64 fixtures. The compiler
itself still runs under Node and has not yet rebuilt itself natively.

## Tooling

Use pnpm workspaces, TypeScript project-reference builds, and Node's built-in test
runner. Pin pnpm 10.34.8, TypeScript 6.0.3, Node types 24.12.0 and formatter versions;
commit the workspace lockfile. Node 24.12.0 is the tested development host, also
recorded in `.node-version`. The engine range allows later Node 24 patches.

pnpm's [workspace protocol](https://pnpm.io/workspaces) keeps internal dependencies
local and explicit. A separate task orchestrator is not warranted for these portable
packages. The installed pnpm 10 launcher failed to initialize the pnpm 12 native
launcher during setup, so this workspace pins a working maintained 10.x release.
No global tooling repair is required.

Node runs test/tool TypeScript through its [type stripping](https://nodejs.org/docs/latest-v24.x/api/typescript.html).
Package imports resolve compiled JS/declarations through explicit exports. Type checking
is a separate required step; executing a test does not type-check it. Upstream tsc
emits development JS only; it is not Tint's future frontend or a native compiler step.

```sh
pnpm install --frozen-lockfile
pnpm check
```

`pnpm build` builds the reference graph. `pnpm typecheck` also checks tools/tests.
`pnpm test` builds then runs package/tool tests. `pnpm boundaries` checks architecture
contracts. `pnpm format` formats implementation/configuration; `pnpm format:check`
checks those files. `pnpm check` runs all required checks.

The packages are private/unpublished while their APIs settle, but have independent
compiled ESM entrypoints and declarations. No publishing scope or license is assumed.

## Dependency direction

- `@tint/word64`: exact data arithmetic, no dependencies.
- `@tint/bytes`: byte writes/alignment, depends on word64.
- `@tint/layout`: fragments/symbols/integer fixups, depends on bytes and word64.
- `@tint/aarch64`: typed A64 instructions/resolved branch patches, depends on bytes.
  It does not import layout, and layout does not import it. Root development
  dependencies allow integration tests to compose their public contracts.

- `@tint/sha256`: one-shot portable hashing, no dependencies.
- `@tint/apple-signature`: embedded ad-hoc signature serialization, depends on bytes
  and sha256; knows nothing about Mach-O layout.
- `@tint/dyld-fixups`: eager import slots and chained-fixup metadata, depends on bytes.
- `@tint/macho`: macOS arm64 executable publication, depends on layout for fragment
  placement, bytes for headers, sha256 for build identity, apple-signature for signing,
  aarch64 for address patches and dyld-fixups for import binding metadata.

- `@tint/sync-io`: bounded byte-transfer loops and I/O errors, no dependencies.
- `@tint/file-service`: handle lifetimes and staged publication, depends on sync-io.
  A development Node host adapter lives in tools, outside the portable graph.

- `@tint/source-text`: source snapshots and position indexes, no package dependencies.
  Uses standard encoding globals through the explicit type contract in types.

- `@tint/source-catalog`: canonical module IDs and deterministic generic value lookup,
  no dependencies; retained values follow caller-owned immutability contracts.
- `@tint/module-resolver`: explicit package-scoped import resolution, depends on
  source-catalog for identities and source-text for diagnostic positions.

- `@tint/text-scanner`: reusable UTF-16 cursor, no dependencies; adapted from Fino.
- `@tint/ts-syntax`: tokens and initial TypeScript ASTs, depends on text-scanner and
  source-text. Resolver composition stays in the caller, avoiding a graph dependency.

- `@tint/ts-binding`: value scopes, binding identities and transitive closure captures;
  depends only on the ts-syntax AST, with explicit external names and no runtime policy.
- `@tint/ts-checker`: scalar binding and checking, depends on ts-syntax's AST contract.
- `@tint/scalar-ir`: frontend/target-independent semantic scalar IR and verifier,
  no dependencies. Typed slots cross block boundaries in the initial operation set.
- `@tint/scalar-lowering`: composes checked source and scalar IR. Depends on ts-checker
  and scalar-ir; neither provider imports the adapter or the other provider.

- `@tint/scalar-aarch64`: scalar storage/ABI planning and native emission, depends
  on scalar-ir for verification, aarch64 for instruction encoding and resolved branch
  patches, cell-aarch64 for lexical-cell access, and bytes for binary64 constants
  and literal-pool encoding.
  It has no executable-publisher or host dependency.

- `@tint/region-allocator`: bounded reusable blocks with caller-provided metadata; no dependencies.
- `@tint/storage-layout`: target-aware field/tagged/object/root-header placement;
  depends on bytes for checked alignment, with no tracing or allocator policy.
- `@tint/trace-plan`: copied/validated descriptor graphs and bounded iterative scans;
  no package dependencies. Memory readers provide opaque canonical references.
- `@tint/gc-tracing`: root stack and complete-mark reclamation planning; depends only
  on trace-plan. Layout/byte-reader composition lives in integration tests.

Each package's README specifies its API, ownership, error behavior and limitations.
There is no shared catch-all utilities package. A common-looking result union is not
sufficient reason to introduce another dependency; errors stay owned by their module.
The AArch64 encoder uses bytes/fixup contracts without depending on a platform
publisher. A platform publisher composes lower-level modules; those modules never
import it back.

`workspace-contracts.json` is the explicit allowed graph. Package dependencies and
TypeScript project references must agree with it. Add a new edge only after documenting
what the consumer needs and what the provider promises. Avoid root path aliases and
cross-package source-relative imports. The sole package export is `.`; implementation
files are not public APIs. Changes to private contracts migrate consumers together.

The AST-based boundary check rejects undeclared/deep imports, cross-package relative
imports, cycles, dynamic imports/require and ambient reference escapes. Portable source
has no Node ambient types. Source-text includes a narrow, separately reviewed
TextEncoder/TextDecoder declaration file in `types/`; the implementations are host
globals now and native runtime globals later. The check rejects explicit any, casts, non-null assertions
and typechecking suppressions. These checks enforce source discipline, not Tint's future
soundness model; writable variance and effect analysis still require Tint's checker.
Tools/tests may use Node, TypeScript's API and BigInt as independent development oracles.
They are not dependencies of the portable packages or native runtime.

## Self-hosting source ledger

The implemented packages establish these concrete requirements:

- Readonly records/interfaces, type aliases, literal unions, generic result records,
  intersection types for shared fixup fields, imports/type-only imports, narrowing.
- Ordinary functions, callbacks, arithmetic/comparison/bitwise operations, loops,
  try/catch/finally, arrays, Map and Set. Standard TextEncoder/TextDecoder construction,
  fatal/streaming decoding, UTF-8 encoding and TypeError instanceof checks.
- Array slice/push/pop/map/sort; Map get/set/has/values/keys and entry iteration; Set add/has/delete; Uint8Array construction, indexed
  writes, length, set, slice and subarray; Math.floor/ceil; Number.isInteger/isSafeInteger/MAX_SAFE_INTEGER;
  string length and charCodeAt for bounded ASCII metadata; split, slice, startsWith,
  endsWith and toLowerCase for logical paths; array join for normalized IDs; includes, Math.min/max, Number conversion and
  String.fromCharCode/fromCodePoint for lexical values; ArrayBuffer/DataView
  setFloat64/getUint32 for exact native constant bits.
- Array `for-of` in layout and Map/Set iteration in the checker/verifier. This deliberately expands the initial source budget:
  its iterator semantics must be implemented or proved equivalent by lowering before
  self-build. Source discipline is not permission to silently assume indexed loops.
- No BigInt, casts, classes, Node APIs, async functions or direct OS calls in portable
  implementation source. Wide integers use ordinary halves.

Array.sort uses explicit pure comparators and works on copies; this is a concrete
source use justifying its addition to the inventory. Uint8Array.set is similarly a
required standard operation, not an unchecked native-memory intrinsic.

For native self-hosting, a build adapter must turn package manifests/contracts into
explicit catalog import mappings; it may not add npm resolution inside the core.
That adapter and the full native checker remain unimplemented. The scalar checker
only covers a small part of this source inventory; passing upstream tsc does not
claim that Tint can compile these packages yet.

## Verification and next slice

Tests compare hand-calculated bytes, carry/borrow results and deterministic layouts;
a test-only BigInt oracle checks sampled word arithmetic. Failure tests cover bounds,
ranges, unresolved/duplicate symbols, overlap, size budgets and unchanged input bytes.
Boundary-policy tests intentionally construct invalid dependency/import graphs.

The AArch64 encoder now has committed independent instruction fixtures and an optional
`pnpm verify:aarch64` LLVM oracle. Its integration test composes with layout using
resolved offsets. No assembler participates in package builds or production code.

The macOS publisher now composes these contracts into signed PIE executables.
`pnpm verify:macos` verifies signatures and executes six fixtures on macOS arm64;
it requires that host and fails explicitly elsewhere. It is separate from the
portable `pnpm check` gate. Host tools inspect output but never build or sign it.

The publisher supports explicit libSystem imports, mutable data and checked ADR
references. Portable file services now own transfer and publication lifecycle policy;
`pnpm verify:files` checks native file ABI fixtures and error paths. These fixtures
are hand-authored instructions, not native compilation of the service modules.

Source snapshots now use standard encoding globals with exact byte/UTF-16 mappings
and ECMAScript line indexing. A real-file test composes source-text and file-service
through their public APIs. Catalogs and explicit package-scoped resolution now compose source snapshots.
A parsed-import integration fixture produces identical results across physical
roots and registration orders. The scanner/parser now covers a documented scalar
syntax slice and compares token spans and expression trees with upstream TypeScript.
Scalar binding/checking and verified semantic lowering now compose with that parser.
The IR verifier independently checks control flow, scalar types, calls and slot
initialization across branches/loops. Test-only execution compares lowered behavior
with JavaScript for evaluation order, short circuiting, recursion and Number cases.
Scalar AArch64 emission now implements binary64/boolean storage and the typed ABI's
register banks, stack overflow arguments, framed calls and result publication. The
`verify:scalar-native` gate composes actual source through that path and the Mach-O
publisher, then checks 526 native fixtures, each executed twice, including 8,904
Number conversion/remainder/bitwise cases.
Its small process-entry/_write adapter is test-only. Shared numeric kernels now
complete native lowering of every currently verified scalar IR operation. Larger
frames, general source coverage and the runtime remain unimplemented.
Storage layouts, descriptor validation/evaluation, root lifetime and precise marking
now have independent modules and host-side integration evidence. Tests cover alternate
pointer widths, initialized backing replacement, completion roots, descriptor-depth
limits, and deep/cyclic object graphs. A failed mark never produces a dead list.
The next substantial slice is native allocator/noncollecting metadata storage and
compiler-emitted managed operations/root handoffs; these policies are not yet a
running native collector or managed TypeScript source support. Keep Linux's primary-target goal and likely later
Windows support in view: macOS policy stays in macho, dyld-fixups and apple-signature, not the portable core.

The region allocator now supplies bounded free-block metadata and coalescing without
per-operation allocation. gc-tracing also offers a caller-storage indexed marking
kernel alongside its allocating descriptor-based reference implementation. Neither
creates OS regions; native descriptor streaming and inventory lowering remain needed.

`pnpm verify:regions` now checks native raw-region acquisition/release in two
Tint-produced signed macOS arm64 executables, each run eight times. It covers runtime
page sizes, read/write mapping boundaries, zero-fill and immediate errno capture for
failed mmap/munmap calls. These are hand-emitted ABI fixtures. Allocator/collector
TypeScript lowering and compiler root integration remain unimplemented.

Classic for loops now pass parsing, scalar checking, lowering and native emission,
including scope and continue-through-update semantics. This is a compiler prerequisite
for region-allocator, not native compilation of that package. Remaining blockers
include typed-array access, closures, object returns, unions, library operations,
imports and increment/decrement syntax. Native collector compilation remains pending.

Borrowed Uint32Array handles now pass through checking, IR, calls and native emission.
The initial slice includes length, numeric stores and element reads with explicit
numeric nullish fallback. Native fixtures use externally owned descriptors/buffers;
this does not add managed array construction or native collector execution. The
region allocator still needs additional language/library coverage and closure lowering.

Numeric-local prefix/postfix updates and arithmetic/bitwise compound assignments now
compile through existing IR operations. Six additional native fixtures run twice
cover snapshot ordering, right-associativity, signed zero, continue/update behavior
and arithmetic/bitwise forms. This removes the allocator's local-update syntax gap;
closures, object results, optional values and library operations still block compiling
the complete allocator source.

The allocator's Number.isInteger, Math.ceil and Uint32Array.fill dependencies now
compile under the documented primitive/borrowed-array subset. Built-in recognition
respects lexical and module-function shadowing. Optional values, interfaces/structural
objects, closures and module integration remain required before compiling the full
allocator; this library slice does not establish allocator or collector self-hosting.

Optional-number is now a tagged value through checking, IR, native slots, arguments
and returns. Bare Uint32Array reads preserve undefined, and general number/optional
nullish fallback replaces the previous index-specific lowering. No numeric sentinel
is used. General flow narrowing beyond local numbers, other union shapes, throws, object results and
closure environments remain required for full allocator compilation.

Optional-local control-flow narrowing now supports undefined/truthiness guards,
short-circuit RHS checking, branch joins and early exits. Writes update presence facts
and lowering preserves the declared tagged storage with numeric read snapshots.
Loops deliberately discard incoming/exit facts until a fixed-point analysis exists.
Object results, closures/captures, other unions and throws remain unimplemented.

### Allocator object and closure syntax

The syntax package now parses `packages/region-allocator/src/index.ts` unchanged:
property-only exported interfaces, readonly function properties, function types,
object literals, arrow functions and `throw` join the existing nested-function syntax.
ASTs retain ordered properties, shorthand flags, parameter/return annotations and
expression-versus-block arrow bodies. Recursive types share the parser nesting budget.
TypeScript oracle tests compare expression structure and allocator declaration spans.

This is a syntax milestone only. The scalar checker rejects these forms before
lowering; no object allocation, closure capture, native exception propagation or native
allocator execution is claimed. The next independent module slice is lexical binding
and capture analysis, with explicit contracts for shared mutable captures and escaping
closures. Native environment/object storage must respect those lifetimes before the
allocator can be compiled.

### Lexical binding and closure captures

`@tint/ts-binding` now resolves the unchanged region allocator's eight functions,
including shared mutable `count`/`used`, captured metadata, and nested helper bindings.
It reports stable declaration identities and direct read/write versus forwarded
captures through intermediate functions. Module references, block shadowing and loop
scopes remain explicit. The graph is independently tested; native scalar compilation
has not yet migrated to it.

Binding success is not a TDZ, type-safety or non-escape proof. Captured bindings must
retain their dynamic lexical instances, with shared mutable cells and separate loop
iteration instances. No closure is yet declared safe to stack-allocate. The next slice
can define environment layouts and initialization contracts using this graph, followed
by object/function typing and managed allocation before native closure execution.

### Closure environment storage

`@tint/closure-layout` composes binding graphs with the existing target-aware storage
planner. One environment per captured lexical scope stores initialization flags and
caller-sized values; each closure capture table retains one pointer per required
scope. Sibling and forwarded captures address the same dynamic lexical instance.
No type representations are inferred by this package.

The contract distinguishes argument, hoisted-function and declaration initialization,
and requires TDZ/immutable-write checks until separately proven unnecessary. Classic
for-let captures copy to new instances before the first test and before subsequent
updates; const headers do not. Layouts are verified for 32/64-bit pointer targets,
but do not allocate, trace, root or execute closures. Next integration needs typed
object/function representations and initialized-state operations, followed by managed
allocation and native execution. Borrowed array handles cannot simply be assumed safe
to retain in escaping closures.

### Structural value types and captured-cell checks

`@tint/value-types` supplies finite structural object/function/union contracts and
checked requirements for calls, object construction, field access and cell operations.
Mutable properties are invariant; readonly views and function returns are covariant;
function arguments are contravariant. Initialization, read and write retain explicit
state guards. Initializing a const differs from assigning it. Successful assignability
does not imply representation compatibility or eliminate initialization checks.

`resolveInterfaceTypes` in ts-checker resolves the allocator's actual interface through
these contracts. It does not yet check its arrow implementations or executable body.
The native scalar checker and backend are unchanged. Next, contextual arrow/object
body checking must connect lexical bindings to these types, invalidate narrowed capture
facts across effectful calls, and emit operations with the declared cell guards.
Managed allocation, tracing and native closure execution remain separate requirements.

### Contextual closure source checking

`checkClosureModule` now composes the existing binder, annotation resolver and structural
type system. Counter factories returning interface-shaped objects can contextually type
their arrow parameters/returns and share captured mutable state. Checked source records
binding types, expression types and explicit initialization/read/write requirements,
including guards for annotated forward references. Wrong returns, missing/readonly
properties, invalid calls and immutable writes are rejected.

This entrypoint is deliberately separate from the scalar lowering input contract.
Its operation records are source-attached requirements, not a linear instruction stream.
It does not eliminate runtime TDZ checks or narrow captures across calls. Loops, builtins,
array operations, void and other allocator body requirements still need source checking;
managed storage, operation lowering and native closure execution remain future work.

### Closure loop and void-helper checking

The contextual source checker now accepts classic for/while bodies, break/continue,
numeric local updates and compounds, and void-returning helpers. Captured numeric
operations retain guarded reads/writes and loop-scope identities. Void is a return-only
contract; misuse as storage, a condition or an operand is rejected. Loop completion
analysis remains conservative and contextual return-discard adapters are deferred.
This extends source checking only; native closure instruction generation is unchanged.
The next allocator gaps are typed-array/builtin operations and safe optional-number
narrowing in the presence of captured writes and calls.

### Unchanged allocator body checking and layout composition

The contextual checker now checks the complete region allocator source unchanged,
including typed-array accesses/fill/length, Number.isInteger, Math.ceil, optional numeric
reads, logical guards and invariant throws. Intrinsic metadata records the operations
for future lowering. Ordinary calls invalidate mutable captured flow facts; function
bodies do not inherit creation-site narrowing. Declared cell types and TDZ guards are
preserved even where individual expression reads narrow to number.

An integration test composes checked allocator bindings with closure environment layout
using explicit 64-bit fixture representations. All eight functions are represented;
the three consumers of `used` address the same lexical cell layout. This demonstrates
source-to-layout composition, not allocation or execution. The next backend work must
lower these typed operations, provide trace/root/initialization protocols, and resolve
the lifetime of captured array storage before running native allocator closures.

### Native guarded cell access

`@tint/cell-aarch64` emits leaf machine-code helpers for initialize/read/write operations
on pointer-free captured-cell payloads. It consumes explicit layout offsets, checks the
0/1 state before touching payload/transfer memory, reports uninitialized/reinitialized/
immutable/corrupt-state failures, and publishes initialization only after the copy.
It reuses the shared AArch64 encoder, including new byte load/store forms.

`pnpm verify:cells` executes 24 internally signed helper fixtures twice each on macOS
arm64. Full canary checks and null transfer pointers on failure paths verify copies and
guard behavior. This is actual native helper execution, with hand-emitted fixture
wrappers; no source-level closure lowering is claimed. Managed-reference cells still
need GC barriers/tracing, and callers must provide valid storage and translate failure
statuses. Full allocator closure lowering, allocation and borrowed-buffer lifetime
checks remain outstanding.

### Initialized closure tracing

`@tint/closure-tracing` now derives environment and capture-table descriptors from
closure layouts plus explicit value trace plans. It reuses trace-plan's selection,
inline and reference operations: state-0 cells skip even stale pointer/tag bytes,
state-1 cells trace their valid values, and invalid states fail traversal. Capture
tables strongly retain their referenced environment instances.

Portable tests compose these descriptors with the existing collection planner. A
recursive environment/table cycle stays live while rooted and becomes a dead candidate
when roots disappear; partial initialization hides invalid stale references, and corrupt
state prevents a collection plan from being returned. The bounded walker uses the same
descriptors. These are Node-side tracing/planning tests, not native collection or freeing.
Allocation/root publication, reference-write barriers and full closure lowering remain
outstanding; native cell-copy helpers are still restricted to pointer-free payloads.

### Scalar IR to native environment cells

Scalar IR now has explicit environment extents/cell layouts and guarded cell
terminators with success/failure CFG edges. Transfer slots require definite
initialization and exact scalar types. The backend preserves incoming environment
pointers across ordinary calls, emits calls to deduplicated native cell helpers, and
relocates branches within the same code image. Normal return ABI behavior is unchanged.

`pnpm verify:environments` exercises six emitted IR modules twice each with shared
caller-provided storage, including numeric/boolean/optional values, exact NaN bits,
immutable and failed guards, and ordinary-call clobbering. This is production IR-to-code
environment access with fixture-owned storage. Source closure conversion, environment
allocation, reference cells, environment-aware calls and exception lowering remain
outstanding. Direct IR calls to environment functions are rejected until their
selection/forwarding contract is represented explicitly.

### Source closure entries to native code

`@tint/closure-lowering` now adapts selected checked closure bodies through the
existing scalar lowerer, then turns captured accesses into guarded environment-cell
terminators. The checker exposes checked bodies by source function ID; code generation
uses explicit caller-selected layouts and entry IDs. Splitting blocks preserves
expression snapshots through typed spill slots. The verifier checks the transformed IR.

`pnpm verify:closure-source` executes four internally signed source-derived native
fixtures twice each: shared numeric closures, mutation ordering and loops, boolean
captures, and optional-number capture reads/writes. Factories and object construction
are not compiled; fixture adapters supply initialized environment storage and call
entries. Guard failures trap as internal entry-contract violations, not JavaScript
exceptions. Multiple captured scopes, environment-aware calls, closure construction,
managed allocation and language completion lowering remain outstanding.

### Source factory initialization and native allocator execution

Closure lowering now projects one-scope factories into an initializer, named member
entries and direct helper entries. It initializes captured parameters/declarations in
source order, preserves mutable shared cells and independent activations, and supports
recursive/mutually recursive helper calls with explicit environment forwarding.
Function declarations are statically selected only after proving direct-call-only use
and absence of reassignment. First-class function identity is not erased by this path.

Factory initialization returns true on construction and false on source undefined exits.
Borrowed Uint32Array captures explicitly retain a caller lifetime obligation. Literal
string throws use normal/throw result storage and propagate before subsequent effects;
immutable UTF-16 literals belong to the native module. Catch/finally/general throw values
and managed string lifetime remain future work. Block-local temporary frame storage is
reused safely; read-cell initialization is tracked on the success edge.

`pnpm verify:closure-factory` executes nine native source fixtures twice each.
`pnpm verify:native-allocator` compiles the **unchanged** region-allocator source, using
its factory, four exported operations and nested helpers. Two metadata capacities and
two independent instances run 118 calls per fixture, comparing exact results and both
metadata buffers against Node after every call. Each executable runs twice. This proves
native allocator policy execution, including splitting/coalescing and capacity failure.
The fixture still provides environment/metadata memory and entry invocation; managed
object allocation, root publication, collection, native compiler I/O composition and
self-build remain outstanding.

### Shared unsigned typed-array lowering

The typed-array operation family now supports Uint8Array, Uint16Array and Uint32Array
through one set of `array-length/valid/read/write` IR operations and one fill lowering.
Checked array types remain distinct; element width selects address scaling and native
byte/halfword/word access. Array captures retain the explicit borrowing requirement.
The encoder adds scaled halfword load/store forms. Eleven source factory fixtures now
cover native wrapping, narrow-element reads/writes and out-of-bounds canaries; the
LLVM oracle independently checks 997 encodings. This enables byte and UTF-16 storage
primitives without claiming standard string, buffer construction or managed allocation.

### Finite aliases and structural type annotations

The parser represents type alias declarations and inline object type annotations.
The type resolver handles top-level finite aliases, forward references, function
contracts and structural properties through the same type graph as interfaces.
Duplicate declarations/properties and recursive alias cycles fail explicitly. Local
type declarations are diagnosed until scoped type-name resolution exists, rather than
silently using an unrelated global type. A twelfth native factory fixture verifies
alias-based parameter/result/object contracts through checking, lowering and execution.
This does not yet cover the generic/recursive/literal type graphs used across Tint.

### Literal type contracts

String, finite numeric and boolean literal types now parse and resolve, including
negative numeric literals and leading union bars. The type relation preserves exact
values, permits safe primitive widening, and retains invariance for mutable fields.
Contextual checking rejects wrong literal assignments/returns/object discriminants
without changing ordinary primitive widening or optional-number flow facts.

Numeric/boolean literal captures and homogeneous literal unions use existing scalar
encodings after checking. A thirteenth native factory fixture verifies literal-domain
mutation, boolean results and independent captures. Runtime string storage, general
union normalization, discriminated-object narrowing and recursive types remain work
required for the compiler's AST/type graphs; this is not a self-build result.

### Recursive structural type graphs

Type tables now allow forward references and productive recursion through objects,
arrays and functions. Named resolution reserves identities before resolving bodies,
then canonicalizes references; aliases preserve shared identities. Direct alias cycles
and union-only cycles are rejected. Graph size/depth remain explicitly bounded.

Structural assignability uses a finite greatest-fixed-point relation graph, propagating
failed requirements through recursive cycles and alternative candidates. Tests cover
recursive compatibility, mismatches behind cycles, forward-reference validation and
snapshot isolation. Mutable ordinary arrays are invariant; readonly views allow safe
covariance. The parser/resolver now handles recursive readonly array annotations used
by AST child lists. This establishes type relationships only: generic instantiation,
discriminated-union flow analysis and native managed graph storage remain outstanding.

### Inherited and intersected structural contracts

Interfaces can extend named object contracts, including forward declarations. Derived
contracts are checked against every base; readonly covariance is permitted, while
mutable narrowing and removal of write access are rejected. Inheritance cycles and
bases whose shape is still unresolved are diagnosed rather than treated as empty.

Intersection syntax has its own precedence above unions. Structural intersections
combine fields and distribute across union alternatives, allowing the recursive
`Span & (Leaf | Branch)` pattern used by compiler ASTs. Overlapping fields currently
require the same resolved type identity; broader type intersections are explicitly
unsupported. Expansion has depth and work limits. A fourteenth native factory fixture
checks inherited/intersected contracts through initialization and isolated mutation.

### Generic structural type declarations

Aliases and interfaces now accept type parameters and explicit type arguments. The
resolver substitutes each instantiation in its own type-name scope, caches recursive
instances and preserves distinct argument contracts. Generic base interfaces use the
same resolution path. Nested closing brackets are split in the parser's type context,
leaving expression shifts unchanged. Wrong arity, duplicate parameters, direct alias
cycles and indefinitely expanding instantiations fail with diagnostics and limits.

This is concrete instantiation of unconstrained type declarations, not general generic
function inference. Constraints/defaults, generic functions, imported type resolution,
and validation of uninstantiated template bodies remain outstanding. A fifteenth native
factory fixture verifies a generic inherited counter contract instantiated with numbers.
The source parse inventory now accepts all of word64, bytes and region-allocator; that
is syntax coverage, not native compilation of word64/bytes or a self-hosted compiler.

Tagged object literals now select a concrete contextual union member by their fields
and literal discriminants before checking member values. This permits nested generic
result construction and gives callbacks the selected variant's parameter types.
Ambiguous variants, wrong discriminants, missing fields and mismatched payloads remain
errors. This is construction checking only; discriminated property flow and native
object allocation are separate remaining slices.

### Checking the word64 source module

The unchanged `word64` source now parses and passes contextual checking, including
module variable declarations, shared constant capture, generic result variants and
nested object construction. Module declarations use the existing binding/cell contract;
native module initialization and managed result allocation are not yet implemented.

Both scalar and contextual source paths recognize unshadowed `Math.floor` and
`Number.MAX_SAFE_INTEGER`. Floor currently lowers as `-ceil(-x)` through existing
numeric IR, preserving signed zero. The sixteenth native factory fixture verifies
flooring, signed zeros, a negative subnormal, infinities, NaN classification and the
maximum safe integer constant. An independent semantic IR test compares against Node's
`Math.floor` on the same edge cases. Full native word64 execution still requires object
storage and module environment lowering; this is not yet a self-build.

Run `pnpm selfhost:coverage` to audit every portable package source file. The Node
adapter reports per-file parsing/contextual-checking status and the first diagnostic,
with source positions. The current baseline is 3 of 42 files parsed and 2 of 42 checked
(`word64` and `region-allocator`). This deliberately does not measure ESM linking,
native emission, executable hosting or compiler self-reproduction. The acceptance
criterion remains a native compiler built by Node compiling its own source into a
working second native compiler.

### Discriminated union checking

Property reads on structural unions require the property on every alternative. The
checker reuses an existing common field type or widens literal tags to a compatible
primitive/union contract. Writes through an unresolved union remain rejected.

Readonly literal discriminants now refine binding types for truthiness, strict equality
and inequality, boolean combinations, conditionals and continuing branches after early
returns. Narrowed subsets are interned and validated in the type graph, so chained tests
can reduce three or more alternatives. This extends the existing flow-fact joins rather
than adding a separate control-flow traversal. Assignment invalidates binding facts;
calls and property writes conservatively invalidate discriminant facts, and function
entry does not inherit the caller's facts. Loops retain their conservative clearing.

Tests cover generic result payloads, string/boolean/numeric tags, multi-variant subsets,
wrong-branch access, joins, stale facts and mutable tags. Loose equality, mutable-tag
refinement, impossible-branch elimination and general union writes are not implemented.
These are source-level type proofs; native object/union payload storage remains required.

### Semantic value storage and managed record descriptors

`@tint/value-layout` bridges checked type graphs to the existing storage and trace
planners. It produces target-sized managed references, fixed record fields with managed
headers, explicit union tags/payloads and validated precise trace plans. Recursive
object fields stop at references; only active union payloads are scanned. Record field
offsets remain descriptor-specific, so structural assignability does not authorize
using one object's offsets on a different shape.

The actual checked word64 graph now has concrete representations and record layouts.
An integration test composes these plans with closure layouts and the existing
collection planner: rooted cycles survive and disconnected cycles become reclaimable.
Reference widths are tested for 32/64-bit layouts. These are layout/tracing proofs under
Node, not native allocation or collection. Native root publication, allocation,
object operations and representation conversion remain the next dependencies.

### Native managed-reference transport and root publication

The shared IR now distinguishes managed references from numbers and borrowed array
handles. Native calls transport reference parameters/results and publish precise stack
roots. Module-owned descriptors list only reference locations; scalar storage never
becomes a root. Reference-bearing frames use distinct temporary locations across blocks
to prevent scalar reuse from corrupting the root map. Slots are zeroed before parameter
spill/publication, and both return and propagated throw restore the prior context head.

`pnpm verify:roots` inspects live nested frames from a native probe, covering register
and stack reference arguments, descriptor offsets, zeroed result temporaries, repeated
calls and both completion paths. This establishes root publication and transport, not
managed allocation, native collection or source object lowering. The runtime context
root-head/descriptor contract is recorded in the scalar backend README.

### Descriptor-checked native record access

The IR now verifies fixed managed-record extents, field offsets/types/mutability and
read/write guards. Success-edge initialization reuses the existing cell dataflow rule;
failed reads preserve prior state. The arm64 backend checks null and descriptor identity
before payload access, and emits fixed-record descriptors with precise reference offsets.

`pnpm verify:records` runs numeric, boolean and reference field accesses natively,
including exact NaN payloads, null/wrong-shape failures, unchanged failed writes, header
canaries and root restoration. Storage is owned by the verification adapter. Source
object lowering, constructor publication and native allocation/collection remain work
required before word64 or the compiler can execute as a whole.

### Record construction through native TypeScript allocation policy

`record-new` now validates complete constructor fields and lowers to a rooted native
allocation call. The kernel callback returns a checked region-relative offset; the
backend validates numeric range/alignment/bounds, initializes header and fields, then
publishes the object reference without an intervening safepoint. Immutable fields can
be initialized by construction but remain protected from ordinary record writes.

`pnpm verify:construction` links constructors with the unchanged TypeScript region
allocator compiled through Tint. It inspects roots at the callback, verifies chains of
distinct initialized objects and exact accounting, and tests the exhaustion trap. Both
executables run twice. This supplies native construction/allocation mechanics, not a
complete collector or a source object-literal frontend. Raw region setup is still a
verification adapter, and self-hosting remains unachieved.

### Source objects through the shared native pipeline

The module-entry adapter now lowers checked object literals and properties using the
existing function lowerer, record IR, rooted arm64 backend and compiled TypeScript
allocator. It supports nested objects, direct helper returns, alias mutation and
structural subtype dispatch with different physical field offsets. Property value
expressions retain source evaluation order. Module numeric/boolean literal constants
are statically encoded; mutable state and effectful initializers are rejected until
module initialization is implemented.

The native construction gate now additionally runs source success/exhaustion binaries
twice each. The source fixture uses a wider object through a narrower interface,
side-effecting property values, nested allocation, an alias write, and helper reads.
The prior IR fixture still inspects roots at the allocator callback. This is native
source-object execution, not a self-hosted compiler: string values, general collections,
module linking/evaluation, managed closure allocation and native collection remain.

### Whole word64 module execution

All seven functions in the unchanged word64 source now lower and emit natively.
Finite string error unions use a module-local code table with correct equality and
empty-string truthiness; general string operations still require native string storage.
The construction gate runs word64 with the unchanged compiled allocator, checking
carry, borrow, conversion, INVALID_WORD, INVALID_NUMBER, OVERFLOW and UNDERFLOW paths.
Success and exhaustion binaries each run twice, alongside the existing record gates.
This proves another actual reusable compiler dependency executes natively. It does
not establish the compiler's own native build or ESM linking.

### Contextual array construction frontend

The parser and binder now preserve dense array literals, nested values, trailing
commas and references/captures inside element expressions. The contextual checker
validates element types, including nested records, arrays and callback functions.
Empty arrays require an explicit/contextual array type; elisions, spread and inferred
array representations remain outside this slice. Native array allocation is not yet
implemented. The source audit now distinguishes successful arm64 module emission
from syntax/type checking and from native execution.

### Resolved module composition and native bytes execution

`@tint/ts-linking` composes explicitly resolved declaration modules by binding identity,
with separate type names, import aliases, lexical shadowing and generic parameter
scopes. Export lookup and source origin/range maps remain explicit outputs. Mutable
module state and effectful initializers are rejected until ESM evaluation is available.
This composes source declarations, rather than treating JavaScript modules as C symbols.

The unchanged bytes and word64 modules now type-check and emit together. The native
construction gate imports bytes from a separate entry module and runs all three with
the compiled allocator. It verifies endian writes, sign encoding, 64-bit words, bounds
and value errors, optional-result fields, exact allocation accounting and exhaustion.
Optional numeric record fields now support construction, mutation and reads, including
readonly covariance from a narrower numeric layout. Success/exhaustion executables
for each gate mode run twice. Self-hosting and a general native ESM runtime remain
unimplemented.

Constructor syntax now parses separately from ordinary calls, including the generic
Map/Set constructor forms common in compiler sources. Binding visits argument/callee
references and module composition rewrites type arguments using the correct namespace.
Expression precedence is compared with the pinned TypeScript parser. This expands
source coverage without claiming native Map/Set/array construction.

### Native switch control flow

Switch syntax, shared clause binding scopes, contextual flow checking and native
lowering now compose through the existing pipeline. Completion tracking distinguishes
break and continue from return/throw, so unreachable trailing returns cannot hide a
missing return path. Readonly discriminants narrow by case, fallthrough merges facts
conservatively, and finite unions/booleans can prove exhaustive dispatch.

The native construction fixtures exercise discriminant evaluation once, ordered
side-effecting case tests, a middle default, fallthrough, break/continue targets and
finite string/boolean dispatch. Unchanged word64 results drive those tag switches.
No switch-specific VM or code generator was introduced. Parser coverage increased,
but native collections, general strings, module evaluation and the compiler host still
stand between these dependency gates and a real self-build.

### General native UTF-16 values

The shared IR/backend now transports immutable string values through roots, calls,
returns and record fields. Source module lowering uses that representation for both
literal unions and general `string`, replacing the earlier numeric string-code table.
String length, truthiness, content equality and numeric `charCodeAt` reads execute
natively. Literal Throw now shares the same flat UTF-16 object format, and its native
verification adapters were migrated. Numeric and string leaf kernels share one label
assembler and the existing AArch64 encoder.

The standalone string gate compares 81 cases with JavaScript and runs twice. It covers
empty strings, NUL and lone surrogates, equality at distinct addresses, fractional and
NaN/infinite indices, bounds and root restoration. Source string operations also run
in the object/word64/linked-bytes gate. Strings are currently immutable module-owned
literals; allocating string operations, native collections and collection remain
required for the actual compiler self-build.

### Allocating native UTF-16 concatenation

String-to-string source `+` now checks, lowers to an explicit allocating IR instruction,
and executes through the same private allocation callback as record construction.
The backend shares allocator invocation, exception propagation, offset/alignment/bounds
validation and failure behavior. Dynamic size metadata remains untraced; both string
operands and the completed result participate in ordinary root publication. The copy
kernel preserves UTF-16 units and distinguishes managed strings (flags 0) from pinned
module literals (flags 1). Overflowing extents trap before invoking the allocator.

`pnpm verify:construction` adds concatenation success/exhaustion executables, run twice,
using the unchanged compiled TypeScript region allocator. It checks empty strings,
NUL/lone surrogates, surrogate pairs, nested calls, left-to-right effects, immutable
inputs, string fields, headers, exact 400-byte allocation accounting and root restoration.
The portable gate checks operand contracts and trace maps. This does not yet provide
slicing, numeric-to-string coercion, GC or a self-hosted compiler executable.

### Allocating native string slices

Source `.slice()` now supports zero to two optional numeric bounds through explicit
`string-slice` IR. The native backend normalizes arbitrary numeric inputs before integer
conversion and memory access, sharing the checked string extent calculation, allocator
path and UTF-16 copy loop with concatenation. Omitted end differs from present NaN.
Bounds and allocation size remain untraced; source and result remain rooted.

The construction gate compares 15 cases against Node, including omitted bounds, empty
source/ranges, reversed bounds, negative/fractional indices, NaN/infinities and UTF-16
surrogates. Exact accounting is 560 bytes; managed headers, root restoration and region
exhaustion are verified, twice per executable. The case functions avoid the existing
4080-byte frame limit, which still needs attention for large compiler functions.
This remains dependency-level native execution, not a compiler self-build.

### Native string prefix matching for scanner and lexer dependencies

Source `startsWith` now checks and lowers to a typed nonallocating IR operation.
The backend reuses the string equality comparison loop after clamping position and
checking the remaining source extent. Missing/undefined positions share numeric-input
lowering with character reads and slice starts. Strict native calls require a string
search rather than introducing implicit conversions.

`pnpm verify:strings` now runs 531 native cases twice, including 450 prefix cases against
Node with empty strings, NUL, surrogate halves, NaN/infinities and negative/fractional/
large positions. `pnpm verify:construction` checks source calls on managed strings and
omitted/undefined positions. The latest per-file audit sees 46 files, 8 parsed, 2 checked
and 1 emitted; it still does not resolve imports and is not a self-hosting measurement.
The scanner/lexer now have their required primitive string operations, but managed
closures, optional/default parameters, collection construction and broader syntax still
prevent compiling those unchanged packages into a self-hosted compiler.

### Native typed-array for-of

Declaration-form for-of now spans syntax, binding, both checkers, module composition
and native lowering. Header identities carry lexical scope/TDZ and const/let mutability.
The iterable is evaluated once; ordinary array length/read IR implements iteration,
including writes observed by subsequent iterations. Captured header bindings fail
rather than incorrectly sharing one runtime cell; generic iterators and ordinary
managed arrays remain pending their runtime support.

The native scalar gate adds 18 JavaScript-compared fixtures, each executed twice,
covering empty arrays, nested loops, break/continue/return, binding mutation, body
writes, shadowing, one-time iterable evaluation and Uint16Array/Uint32Array reads.
The construction gate additionally iterates the linked bytes dependency's Uint8Array
and verifies its checksum. Portable checks include scope, TDZ, return completeness,
composition origins and rejection of captured iteration cells. The audit now parses
11 of 46 compiler source files (still 2 checked and 1 emitted per-file without imports).
There is still no stage-one self-hosted compiler executable.

### Typed-array ownership ABI and root-safe scalar temporary reuse

The temporary two-word typed-array descriptor has been replaced with a 32-byte object
header: kind marker (2/3/4 for unsigned 8/16/32-bit arrays), flags, element length and
data pointer. Existing caller-owned buffers use borrowed flag 1; allocator-owned flag
0 is reserved for the next construction slice. Array handles now publish roots through
parameters, slots, SSA values and calls. Native adapters supply matching headers and
initialized contexts. Borrowed closure cells retain their existing lifetime restriction;
this is not yet native array construction or collection.

Adding array roots exposed excessive frame growth in the unchanged allocator initializer.
The emitter now retains unique reference SSA locations but reuses a disjoint block-local
region for scalar SSA values. This preserves conservative roots without retaining every
numeric temporary across blocks. A 100-block regression fits below 256 bytes, and the
unchanged native allocator and construction/root gates verify actual execution under
the updated layout. Larger root/local frames remain subject to the 4080-byte limit.

### Owned typed-array allocation primitive

`array-new` now creates owned unsigned 8/16/32-bit arrays through the same allocation
callback as records and strings. Numeric counts must already be normalized exact
uint32 integers; checked 64-bit extent arithmetic prevents wrapping a large request
into a small allocation. Header initialization and zeroing finish before publication.
Source constructor coercion/lowering is the next slice, so this does not yet make
`new Uint8Array(n)` usable from compiler source.

The construction gate allocates all widths and an empty buffer, verifies initial
zeroes, typed stores, inline data pointers, owned flags, padding, retained earlier
objects and exact 176-byte accounting per call, then checks exhaustion; both images
run twice. The preceding ABI migration passed 544 scalar/native fixtures, 16 factory
fixtures and 531 string cases, each twice, plus unchanged allocator and root gates.
The self-hosted compiler executable remains unbuilt.

### Source typed-array constructors and traced array fields

Both checking paths now recognize unshadowed unsigned typed-array constructors with
optional numeric length arguments. The shared lowerer applies integer conversion and
NaN-to-zero normalization before `array-new`. Constructor arguments evaluate once.
Source arrays can cross calls and enter fixed record fields; field trace descriptors
carry array object handles. Borrowed closure-entry allocation is rejected until managed
environment ownership is integrated. Copy/iterable/ArrayBuffer overloads remain pending,
and invalid length errors still take the native allocation trap rather than a catchable
RangeError; full JavaScript constructor compatibility is not claimed.

The native construction gate verifies omitted/undefined/NaN/fractional/negative-fraction
lengths, all three widths, zero initialization, returned buffers, fill, iteration, traced
records and alias mutation, exact 352-byte accounting and exhaustion. Both executables
run twice. Portable checks cover shadowing, unsupported overloads, scalar/contextual
pipeline agreement and trace offsets. The per-file audit now sees 47 files, 12 parsed,
2 checked and 1 emitted without import linking; no native compiler self-build exists yet.

### Native owner-retaining typed-array views

Both checking paths and the common lowerer now support `subarray` with optional numeric
bounds. Relative-index conversion reuses fill's normalization and preserves undefined
end versus NaN. The `array-subarray` primitive validates normalized bounds, allocates a
48-byte view, shares the parent's backing and records a traced parent handle at +32.
Flag 2 distinguishes this owner-retaining header from owned buffers (0) and borrowed
storage (1). A future native collector must follow that parent edge; no native collector
is claimed by this slice.

Native byte/halfword/word fixtures each compare nine bound cases against Node, check
nested views and bidirectional alias mutation, inspect every header/data offset/parent
link and verify exact 576/592-byte accounting plus exhaustion. Success/exhaustion images
run twice. Portable tests verify operand types, width preservation and root maps. Typed
array copy/set operations, general collections, managed closures and the native compiler
host still need implementation before self-reproduction can be verified.

### Overlap-safe unsigned typed-array set

Both checking paths and shared lowering now support typed-array `set` with an optional
numeric offset and void result. Bounds checks precede mutation. A source-width managed
snapshot preserves overlapping copies, including self-copy, before destination-width
conversion. Empty copies skip allocation. This uses existing array IR and allocation
machinery; no separate copy backend or ABI was introduced.

The native construction gate compares all nine source/destination width combinations
against Node, exercises both overlap directions, self-copy, empty copies at the end,
optional/fractional offsets and receiver/argument evaluation order. It verifies exact
allocation accounting and exhaustion, plus invalid offsets and extents. Every image
runs twice. Invalid ranges still trap; catchable RangeError and general array-like
sources are pending. These are dependency fixtures, not a self-hosted compiler build.

### Typed-array copy constructors

The unsigned typed-array constructors now accept any supported unsigned typed-array
source as well as numeric/undefined lengths. Shared lowering allocates a fresh output
and reuses the element-copy loop directly; source views retain their visible offset and
length and destination width controls conversion. No new IR/backend operation was needed.
Portable tests cover both checking paths and all nine width combinations. Native fixtures
check view copies, once-only input evaluation, independent mutation in both directions,
empty copies and exact allocation accounting/exhaustion for all nine combinations.
General iterables and ArrayBuffer constructor overloads remain unsupported.

### Parameter syntax and binding groundwork

Optional/default parameter syntax now preserves expressions and spans. Binding visits
initializers before body declarations and captures referenced parameters; source linking
maps imported references inside defaults. Function-type initializers and combined optional
plus default syntax are rejected. Both checking paths explicitly reject unimplemented
optional/default call contracts, avoiding silent compilation as required parameters.

All 409 portable tests, type checks, package boundaries and formatting checks pass. The
per-file compiler audit now parses 16 of 47 files (previously 12), checks two and emits one
without import linking. This is frontend coverage only; native self-reproduction remains
unverified. The preceding native typed-array copy/set gate passed all signed images twice.

### Optional numeric call contracts

Function type contracts now carry a validated minimum argument count, separately from
parameter value types. Assignment checks preserve the accepted arity range. Both source
checking paths support trailing optional numeric parameters and require narrowing before
numeric use; required undefined unions remain required arguments. Shared scalar lowering
materializes omitted arguments as tagged undefined values using the existing ABI.

All 413 portable tests pass with type checks, boundaries and formatting. Seventeen native
optional-value fixtures execute twice, including five optional parameters spilling onto
the stack, zero/partial/full calls, explicit undefined and recursive forwarding. Default
initializers still require callee-entry semantics; native self-hosting is not yet achieved.

### Numeric default parameter initialization

Annotated numeric defaults now compile through both checking paths and common lowering.
Calls carry tagged optional numeric inputs, while callee entry initializes separate local
slots in parameter order. This preserves declared number-only local assignment rules and
runs defaults only for omitted/undefined arguments. Strict checking rejects direct reads
or writes of self/later uninitialized parameters. Required parameters after defaults remain
required; a default is distinct from a `?` parameter for ordering/arity purposes.

Eighteen native fixtures (nine through each checking path) execute twice: ordered mutation
of earlier parameters, explicit undefined, required tails, undefined-union defaults, lazy
initializers, recursion, six-argument stack traffic, zero, NaN and negative zero. All 417
portable tests pass with type checks, package boundaries and formatting. Borrowed closure
entries reject defaults until captured-cell initialization is integrated; inferred default
annotations and nonnumeric optional representations are still pending. No stage-one native
compiler or verified compiler self-build exists yet.

### Ordinary numeric array contracts and SHA-256 dependency audit

Contextual checking now distinguishes ordinary numeric lists from unsigned typed arrays.
Numeric lists support length, optional indexed reads, checked mutable writes, numeric push
arguments and for-of. Readonly arrays reject writes and push. Nonempty numeric literals
infer numeric array types; empty literals require context. Separate list intrinsics keep
these operations from silently adopting fixed typed-array storage or conversion rules.

The unchanged SHA-256 package now passes checking. The per-file audit reports 47 sources,
16 parsed, three checked and one emitted. SHA-256 still stops at module-array initialization
and needs native growable array storage before execution can be tested. A lowering regression
asserts ordinary arrays remain rejected until that representation exists. All 420 portable
tests pass, with type checks, boundaries and formatting. Self-reproduction remains unverified.

The next collection implementation should reuse the existing managed allocator, roots and
record/call pipeline. Floating-point backing storage must preserve Number values, including
NaN and signed zero; unsigned typed-array storage is not a correct replacement. A reusable
Float64Array primitive would let TypeScript runtime helpers implement growth and indexing,
keeping collection policy in TypeScript while reusing the existing native allocation and
load/store backend. Holes and out-of-range writes need explicit presence/length handling.

### Float64 storage and addressable larger native frames

Float64Array now shares the existing typed-array pipeline while retaining its own managed
handle kind (marker 5), eight-byte element scale and IEEE-754 payload reads/writes. Numeric
construction, copy construction, fill, set, views, iteration, calls and traced record fields
reuse the existing IR. Native fixtures preserve NaN, signed zero, infinities and subnormals,
check overlapping copies and conversions with every unsigned kind, inspect headers/parent
links/raw payloads/padding and verify exact allocator accounting and exhaustion twice.

The integrated fixture exposed the old 4080-byte stack-frame cap. Stack adjustment and
address materialization now split offsets into 4-KB units and low immediates, supporting
frames through 32752 bytes within direct eight-byte load/store addressing. Larger frames
remain explicitly rejected. A native optional-argument fixture exercises addresses above
4 KB. All 565 scalar native fixtures and four root-chain fixtures pass twice; this does
not establish stack-probing support for future platform ABIs.

### TypeScript numeric-list storage primitive

The dependency-free `@tint/number-list` package implements logical length, Float64 values,
presence flags, geometric backing growth, reads, writes, single-value push, pop and resize.
Growth publishes buffers only after allocation and copying, and shrinking clears presence
so later expansion cannot reveal removed elements. Logical expansion does not allocate.
Negative-zero length normalizes to positive zero, matching JavaScript arrays. It exposes
an internal representation contract rather than the full Array prototype.

Portable tests compare 500 deterministic mutations against JavaScript arrays and check
invalid indices/lengths/capacities. The construction gate compiles the unchanged package
source and runs growth, holes, shrinking/re-expansion, special Number values and exhaustion
natively twice, checking exact 400-byte accounting and the updated backing pointers in its
traced record. These helpers use the same compiler and allocator as earlier dependency gates.

All 426 portable tests, type checks, formatting and boundaries for 32 packages pass. The
per-file audit now sees 48 sources: 17 parsed, four checked and two emitted. This audit is
not execution evidence; the separate native gate supplies that evidence for number-list.
Ordinary source `number[]` still needs lowering to these helpers, and module-array constants
still need initialization before unchanged SHA-256 can run natively. Native compiler
self-reproduction remains incomplete and unverified.

### Ordinary numeric-array lowering through explicit runtime bindings

Module-entry lowering now accepts explicit checked function identities for the numeric
list create/read/write/push/length helpers. It verifies signatures and a shared receiver
representation, maps source IDs to emitted function IDs and uses ordinary shared-IR calls.
The caller owns module loading/resolution. Tests reverse entry order and reject missing
helpers, wrong signatures and incompatible receiver shapes.

Numeric literals, indexing, assignment, length, push and for-of now compile with that
runtime contract. Array values are managed references, including inside traced record
fields. Assignment preserves receiver/index snapshots before its right side; push snapshots
all arguments before insertion. For-of evaluates its iterable once and reloads length at
each iteration. Ordinary numeric iteration retains undefined for holes, requiring a guard
or fallback in the strict profile; typed-array bindings remain numeric.

All 431 portable tests, type checks, 32-package boundaries and formatting pass. Four native
source-array fixtures execute twice with exact accounting and exhaustion: holes/NaN/signed
zero, growth during iteration with once-only iterable evaluation, receiver aliasing across
assignment, and nested push evaluation order. The 18 existing typed-array iteration fixtures
also execute twice. No new backend list instruction or parallel compiler was introduced.

The unchanged SHA-256 source still needs module-level array initialization for its round
constants. Those constants require persistent rooted storage shared across calls; recreating
them per access would not preserve module identity/lifetime semantics. Native compiler
self-reproduction remains incomplete.

### Explicit module instances and native SHA-256/signature composition

An immutable postorder value-syntax rewriter now supports module preparation without
mutating parsed ASTs. The linker accepts pure numeric-array constants; a separate
preparation pass moves them into a generated state factory and threads state through
transitively dependent direct functions. Binding identities preserve imported aliases,
shadowing, defaults and recursion. Callers initialize once per graph instance and root
that state. Stateful function escapes, nested closures and effectful initializers remain
explicitly unsupported; this is not general ESM evaluation.

The native construction gate executes unchanged SHA-256 at input lengths 0, 3, 55, 56,
64, 65 and 1000 against Node crypto. Independent module instances retain separate arrays,
while calls and imported aliases within one instance share them. The unchanged Apple
signature writer now links through the real SHA-256, bytes and word64 imports and emits
byte-identical signatures at lengths 0, 3, 4096 and 4097. Every success/exhaustion image
runs twice with exact allocation accounting. The page-boundary cases cover one full page
and a second partial page. This is native dependency execution, not a self-build.

That composition required typeof lowering and retention of readonly-discriminant facts
for const bindings across calls. Typeof evaluates its operand even when its result is
statically known; optional numeric values test their presence tag. Native tests cover
side effects, void results, missing/zero/NaN numbers, strings, booleans and managed objects.
Reassignable bindings still lose discriminant facts across calls; strict readonly property
assignment rules prevent a writable widened alias to the const object's discriminant.

All 438 portable tests, type checks and 32-package boundaries pass. The broad construction
gate passes 58 modes, with two additional signature page-boundary modes verified separately.
The per-file audit sees 51 sources, 18 parsed, four checked and two emitted; it deliberately
does not link imports or execute code. Native compiler self-reproduction remains incomplete.

### Optional property syntax for compiler-owned contracts

Property signatures now retain optionality separately from readonly and explicit
undefined unions. The parser handles both the readonly modifier and properties named
readonly, and module linking retains the flag. Oracle tests compare flags and spans
against pinned TypeScript. Regression tests parse the unchanged syntax model, IR model
and Mach-O writer; the per-file audit advances from 18 to 21 parsed sources out of 51.

Checking intentionally returns an unsupported diagnostic for optional properties until
presence-aware semantics exist. Required `T | undefined`, optional `T`, and optional
`T | undefined` must retain their different construction, read and write contracts;
absence cannot silently become a required field containing undefined. Native field
presence and structural assignment remain subsequent work. All 443 portable tests,
type checks, formatting and 32-package boundary checks pass. Self-hosting is not achieved.

### Exact optional-property contracts and presence-aware layouts

Optional properties now check through the ordinary finite type graph. Construction may
omit them, reads include undefined, and writes use the exact declared type. Generic
instantiation, intersections and inherited contracts retain optionality. Writable fields
preserve type and optionality invariantly; readonly required fields may project into
readonly optional views. A structural view cannot acquire a property absent from its
source contract, since an erased view could hide an incompatible field at runtime.
Optional discriminants do not yet participate in narrowing.

The generic value-layout planner gives each optional field a one-byte presence tag
separate from its aligned value payload. Existing tagged-layout and trace-selection
primitives distinguish absence, present undefined, and present references. Invalid tags
fail tracing, and stale absent payloads are not scanned. Native record lowering still
rejects optional contracts until its own IR preserves presence; no encoding is silently
substituted. The source resolver interns read unions without widening declared writes.
Property lookup selects the narrowest available common read contract.

All 450 portable tests, type checks, formatting and 32-package boundaries pass. Native
self-compilation remains incomplete; presence-aware native records and the compiler's
remaining collections/language features are still required.

The four linked native signing modes also pass again after these type-system changes,
with each success/exhaustion image executed twice, including 4096/4097-byte page boundaries.

### Native numeric optional-property presence

Record IR now carries a separate one-byte presence offset for numeric optional properties.
Constructor argument positions distinguish omission from an explicit undefined SSA value.
Omission zeroes the payload and presence; supplied values and writes set presence after
storing the payload. The source adapter reserves an aligned presence area plus the existing
sixteen-byte optional-number encoding. Required fields containing undefined retain their
existing representation. Verifier checks reject header/payload/presence overlap, omitted
required fields and unsupported managed optional payloads.

Descriptor dispatch supports required numeric fields projected through readonly optional
views. Native fixtures check absent reads, explicit undefined, mutable writes, NaN, signed
zero and required/optional projections. Host checks inspect separate presence bytes and
zeroed absent payloads. Allocation accounting and exhaustion are verified twice per image.

All 452 portable tests, type checks, formatting and 32-package boundary checks pass.
The full construction gate passes 61 modes, and the additional readonly-projection mode
passes separately; every success/exhaustion image runs twice. General optional managed
payloads, deletion/presence operators, and the remaining compiler dependencies are still
required before native self-compilation is possible.

### Optional managed-reference IR and native roots

The shared IR now supports pointer-sized optional references, with zero representing
undefined. Explicit none, wrap and checked extraction operations preserve this encoding;
wrap and extraction trap on zero rather than silently constructing a required reference.
The verifier distinguishes optional from required references and permits optional-reference
payloads with separate property-presence bytes. Equality and truthiness use pointer bits.

The backend includes optional reference slots and SSA values in root descriptors and
transports them through integer registers, overflow stack arguments and result areas.
Record descriptors trace optional pointer offsets; absent payloads are initialized to
zero, while present undefined retains a distinct property-presence byte. This is a native
representation contract, not validation of foreign pointers or an encoding for JS null.

Twelve native root-chain fixtures pass twice across required/present-optional/undefined
references, register and stack arguments, nested calls, repeated calls, normal return and
throw unwinding. Construction fixtures inspect payload/presence bytes, check round-trip
identity and truthiness, and exercise absent extraction and allocator exhaustion traps.
All 454 portable tests, type checks, formatting and 32-package boundaries pass. Source-level
optional-object refinement/lowering remains the next connection; self-hosting is incomplete.
The complete construction gate also passes all 64 modes after this representation change,
with every success/exhaustion image executed twice.

### Source optional objects through the shared native pipeline

Undefined and truthy local guards now refine recursive object-or-undefined contracts.
Source module entries lower these values through optional-reference slots, arguments,
results and traced record fields. Proven-present locals use checked extraction. Undefined
construction/conversion retains an explicit checker proof on expression temporaries;
mutable numeric union values cannot accidentally become empty references because a prior
branch stored undefined. Captured mutation continues to invalidate affected guard facts.

Nullish fallback is lazy and preserves operand effects, including functions returning only
undefined. Runtime typeof distinguishes undefined from present objects. Explicitly required
object-or-undefined parameters support register and stack transport; optional/default
parameter syntax remains numeric-only. Optional strings, arrays, function values and broader
property-path/logical narrowing still require their own lowering contracts.

Native source fixtures create recursive node links, inspect pointer/presence bytes after
clearing links, round-trip optional values through six-argument calls, test identity/typeof,
and check lazy fallback and undefined-returning side effects. All 457 portable tests, type
checks, formatting and 32-package boundaries pass. The complete 66-mode native construction
gate and 18 optional-number regressions execute twice successfully. The compiler still
cannot compile its own full source; general collections and remaining language coverage
remain required before the stage-one/stage-two self-build can be verified.

### TypeScript string membership storage

The dependency-free `@tint/string-set` package supplies create/has/add/delete/clear/size
operations over managed linked entries. New insertion allocates one initialized entry;
duplicates do not allocate. Deletion and clearing remove links, leaving reclamation to
the host collector. Membership compares UTF-16 content. Lookup/insertion/deletion are
linear; this initial primitive has no iterator or insertion-order API and is not yet the
language's full Set implementation.

Portable tests compare 500 deterministic mutations against JavaScript Set and cover NUL,
lone surrogates, non-BMP strings and special property-name spellings. The native gate
compiles the unchanged package source and exercises all operations, deletion at each link
position, clearing/reuse and a separately allocated equal string. It validates traced
reference offsets, the final head/next links, exact 320-byte allocation accounting and
exhaustion; successful and exhausted images each run twice. Native reclamation remains
pending, so removed entries still count against this fixture's allocator budget.

All 459 portable tests, type checks, formatting and boundaries for 33 packages pass.
The per-file audit now reports 52 sources, 22 parsed, six checked and four emitted; this
still neither links imports nor executes those outputs. The separate native fixture is
the execution evidence for string-set. Connecting ordinary Set<string> syntax to explicit
runtime helper bindings is the next collection step. Native compiler self-reproduction
remains incomplete.

### Source string-set runtime binding

The strict checker now represents Set/ReadonlySet element contracts explicitly, with
invariant mutable sets and covariant readonly views. Set and array contracts remain
distinct. Empty explicit-generic construction, has/add/delete/clear/size, readonly
projection, calls and record fields are supported; lexical/type shadowing is respected.
Constructor iterables, iteration, method values and general native element encodings
remain pending.

`ModuleEntryOptions.stringSets` supplies checked function IDs for create/has/add/delete/
clear/size. The adapter validates a shared object representation, signatures and broad
primitive input acceptance, then relocates IDs into selected entry order. The same
validation primitive now serves numeric lists. No compiler package discovers runtime
files implicitly. Native set values are managed references and fields are traced.
The shared lowerer uses ordinary calls; add discards the storage insertion boolean and
returns the original receiver. Receivers/arguments retain evaluation order and identity.

All 464 portable tests, type checks, formatting and 33-package boundaries pass. The
68-mode native construction gate executes each success/exhaustion image twice. Its new
source-string-set fixture checks chaining/identity, readonly aliases, receiver/argument
side effects, duplicate insertion, deletion, clearing and reuse with exactly 192 bytes
per invocation. The per-file compiler audit still reports 52 sources, 22 parsed, six
checked and four emitted: source syntax/runtime coverage remains substantially incomplete.
There is still no native compiler stage one or self-reproduction evidence. Generic
collections, compiler syntax/checking and the native host driver remain work toward that
required stage-one-to-stage-two build.

### Explicit generic function specialization

The parser retains generic function parameters and explicit call type arguments; oracle
cases compare nested angle closers, function-type arguments, chained calls and relational
ambiguity with the pinned TypeScript parser. Linking maintains lexical type-parameter
scope through signatures, body annotations and imported call arguments. Syntax rewriting
now optionally visits types; its default continues to retain existing type nodes.

`specializeModule` in `@tint/ts-linking` takes a bound, import-free module and emits
concrete instances of top-level generic functions. It substitutes annotations and nested
call/constructor type arguments, uses original binding identities for direct calls,
deduplicates syntactically equal argument lists, and queues recursive instances. It
bounds both instance count and expanding type depth. Generated names avoid value bindings
and referenced globals. Each instance receives fresh value nodes to avoid sharing binding
or expression-type map entries across concrete types. Callers rebind and check the output.
Templates are removed and returned metadata identifies each concrete name and source.

This is a native specialization mechanism, not full generic declaration checking or
inference. Concrete instances use ordinary strict checking; unsupported generic function
values, nested generic declarations, missing arguments, constraints and defaults remain
explicit errors. A generic public export needs an explicitly selected concrete instance
before it becomes a native/FFI entrypoint. Type alias equivalence is not canonicalized for
instance deduplication. The ordinary checker rejects unspecialized generic syntax.

The native generic-collections fixture specializes four functions eight ways for string
and numeric linked collections. It verifies duplicate membership, NaN, signed-zero
membership, generic identity calls, recursive generic record layouts, shared allocation
and roots, and exact 224-byte accounting. Each success/exhaustion image runs twice.
All 473 portable tests, type checking, formatting and 33-package boundaries pass; the
complete native gate passes 69 modes. The per-file audit reports 53 sources, 23 parsed,
six checked and four emitted. Native stage one and stage-two self-reproduction still do
not exist. This pass enables a shared generic collection implementation as the next
runtime step rather than separate algorithms for every element encoding.

### Shared generic set storage and concrete runtime roots

`@tint/linked-set` replaces the unreleased string-only package. One generic implementation
now supplies create/has/add/delete/clear/size, using SameValueZero membership for strings,
numbers and object identities. There is no compatibility wrapper or second storage
algorithm. Workspace dependencies, tests and native fixtures use the new package.
Its linked structure remains linear and exposes no iteration-order API; deletion clears
links but native collector integration is still required for reclamation.

`specializeModule` now takes an options object with `maxSpecializations` and optional
explicit roots. Each root identifies a generic function in the supplied binding graph
and concrete type arguments; returned root names preserve request order and deduplicate
instances. The runtime loader can request helpers without inserting synthetic calls.
It rebinds/checks the transformed module before resolving those names to concrete IDs.

`ModuleEntryOptions.sets` replaces the string-only binding with an array of explicit
`{element, runtime}` contracts for string and number encodings. The adapter validates
receiver representations, primitive input contracts and signatures, rejects duplicate
encodings, and relocates IDs. Each source operation chooses the binding for its checked
element type. String/numeric sets can coexist in one module with distinct precise record
tracing. The shared scalar lowerer continues to emit ordinary calls and preserve source
add chaining. Public Set<object>, iteration and iterable construction remain unsupported;
the underlying generic storage is already usable through explicitly specialized calls.

All 476 portable tests, type checks, formatting and 33-package boundaries pass. The full
native construction gate passes 71 modes, each success/exhaustion image twice. Mixed
source sets verify NaN, signed zero, deletion/clearing/reuse and exact 288-byte accounting;
a separate generic object-set fixture verifies identity and 224-byte accounting. The
older string and generic collection fixtures now compile the shared package unchanged.
Numeric entry descriptors trace only next links; string/object entries trace elements too.

The per-file audit reports 53 sources, 23 parsed, five checked and three emitted. Its
standalone checker intentionally rejects generic templates without specialization, so
the generic package is no longer counted as an independently emitted nongeneric file.
The executed native fixtures are its concrete specialization evidence. No native stage-one
compiler or self-reproducing stage two exists yet; remaining compiler language features,
collections, host integration and complete source compilation still need implementation.

### Generic map storage and source map operations

The new dependency-free `@tint/linked-map` package supplies generic create/has/get/set/
delete/clear/size operations. Lookup, has, get and replacement share one search routine.
SameValueZero keys support content equality, NaN/signed-zero equivalence and object
identity. Stored undefined remains present. Replacement updates the existing entry without
allocation; insertion initializes a new entry before publication. Deletion and clearing
remove links; native collector integration is still pending. Iteration/order enumeration
is not exposed by this primitive.

The finite type graph and contextual checker now represent Map key/value contracts,
including invariant mutable maps and covariant readonly views. Construction requires
explicit key/value types and no iterable. Get adds undefined to the value contract;
readonly views reject mutation. Source operations preserve key/value checking and lexical
constructor shadowing. `ModuleEntryOptions.maps` binds string/number keys and numeric
values to concrete specialized helper IDs. It validates receiver/signature/input contracts,
relocates IDs, and rejects duplicate or incompatible encodings. Shared lowering emits
ordinary calls, returns the receiver for source set, and evaluates receiver/key/value once
in order. Writable collection fields now retain the configured runtime storage contract.

All 483 portable tests, type checks, formatting and 34-package boundaries pass. The full
76-mode native construction gate passes each success/exhaustion image twice. The unchanged
map source executes with string keys/numeric values (224 bytes), numeric keys/object values
(288 bytes), and stored undefined (80 bytes). Native source maps exercise both key encodings,
NaN/signed zero, replacement, chaining, readonly views and ordered side effects (336 bytes).
A separate 192-byte fixture replaces a map-valued record field while preserving its older
alias. Descriptors distinguish key/value/next reference offsets from numeric payloads.

The per-file audit reports 54 sources, 24 parsed, five checked and three emitted; generic
storage execution is verified by specialization fixtures, not that standalone audit.
Source Map adapters for other key/value representations, iterable construction and
iteration remain pending, as do broader compiler syntax, managed closures, native host
integration and complete compiler-source builds. Native stage one and its self-built copy
remain unimplemented and unverified.

### Optional strings and string-valued native maps

The IR now has a distinct `optional-string` managed encoding with explicit none, wrap,
value and presence operations. Zero represents undefined; nonzero is a string pointer.
Presence differs from truthiness: empty strings are present for typeof/nullish fallback
but false in conditions. Equality handles absent operands without dereferencing them and
uses the shared content comparator when both are present. Extracting absence traps.
The verifier rejects cross-use of optional object, number and string representations.
Native roots, record descriptors and register/stack/result transport include optional
strings through the existing managed-value machinery.

Source string-or-undefined unions now compose across calls, returns, locals, guards,
exact optional fields, typeof, lazy nullish fallback and equality. Required strings wrap
when entering an optional representation, and proven undefined becomes the zero sentinel.
Optional/default parameter syntax remains numeric-only; explicit string-or-undefined
annotations already use the normal native ABI. Heterogeneous logical-expression joins
and other unsupported encodings remain separate work.

Map runtime bindings now select by both key and value encoding. String and numeric values
can coexist under the same key encoding without reusing the wrong helper specialization.
String get helpers return optional strings. The unchanged linked-map source supplies the
concrete string-valued helpers without another storage implementation.

All 487 portable tests, type checks, formatting and 34-package boundaries pass. The full
native construction gate passes 79 modes, each success/exhaustion image twice. Source
optional-string fixtures verify distinct owned/literal content equality, empty versus
absent behavior, lazy fallback, six-argument transport and optional field clearing with
64-byte accounting. Mixed numeric/string-valued maps verify lookup and replacement with
288-byte accounting. An absent-string extraction fixture confirms the native trap. The
expanded 20-case root-chain gate verifies present/absent string roots, overflow arguments,
zeroed temporaries and normal/throw restoration twice each.

The per-file compiler audit remains 54 sources, 24 parsed, five checked and three emitted.
These are dependency/runtime fixtures, not a native compiler self-build. Stage-one compiler
construction, stage-two reproduction, remaining language coverage and native host/runtime
integration remain outstanding under the active self-hosting objective.

## Generic list bindings and native string arrays

The list lowering contract now selects a number or string element encoding and explicit
TypeScript helper identities. It validates each helper signature and rejects duplicate
encodings. String arrays support literals, indexed reads/writes, length, push, traced
writable fields and hole-preserving iteration. Nonempty literals infer their element
encoding without checking the first expression twice. Read and iteration contracts include
undefined; empty literals require context and mixed encodings remain unsupported.

The new `@tint/sparse-list` composes `@tint/linked-map` for generic sparse indexed storage.
Its unchanged source supplies specialized string-array helpers. Numeric arrays retain their
dense storage under the same compiler contract. Sparse storage uses linear lookup and
allocates only written entries; native collection and optimized dense generic storage are
still future work.

All 492 portable tests, type checks, formatting and 35-package boundaries passed for this
slice. The full native construction gate passed 83 modes, each success/exhaustion image
twice. Four new modes verify holes, growth during iteration, push argument ordering,
receiver mutation, writable traced fields and direct generic push/pop with exact allocation
accounting. The verification harness selects linked fixture entrypoints through export
metadata, avoiding accidental selection of private helper functions.

The per-file audit is 55 sources, 25 parsed, five checked and three emitted. It does not
link or execute those files. These dependency gates are not a stage-one compiler, and
native compiler construction and self-reproduction remain outstanding.

## Indexed-access type annotations

Type syntax, rewrites, module linking and generic specialization now preserve both
operands of indexed-access types. Resolution supports known object properties, numeric
array element contracts, optional-property absence and unions of valid receivers/keys.
Invalid keys and unresolved recursive operands fail explicitly. This is concrete type
resolution, not keyof, index signatures or generic constraint checking.

All 497 portable tests and 35-package boundary checks pass. The full native construction
gate passes 84 modes, with each success/exhaustion image executed twice. The new fixture
uses indexed types in generic calls, optional string parameters and record fields, with
48-byte allocation accounting. The audit remains 55 sources, 25 parsed, five checked and
three emitted: indexed annotations expose subsequent syntax gaps in several files rather
than making those whole files compilable. No stage-one compiler exists yet.

## Declaration-module re-exports

The parser and rewrite traversal now retain named local export clauses, named forwarding
clauses, star re-exports and type-only forms. Source re-exports appear in the dependency
list without introducing local bindings. Linking resolves original value/type identities
through aliases, shared export paths and cycles. Explicit exports override stars, shared
origins remain unambiguous, conflicting star names are omitted, and importing an omitted
name fails. Stars exclude default; named clauses may export a binding as default.
Explicit missing or duplicate exports fail even when unused. Namespace objects/default
expression exports/general runtime module evaluation remain separate work.

The resolver lives in a focused internal module with bounded resolution work/depth.
All 502 portable tests, type checking, formatting and 35-package boundaries pass.
The full native construction gate passes 85 modes, each success/exhaustion image twice.
The new barrel fixture follows a re-exported function and interface into native record
construction with exact 32-byte accounting. It also exposed and corrected a verification
harness bug: explicit entrypoint names must be honored without generic specialization,
not just when that preparation pass runs.

The per-file audit now covers 56 sources: 27 parsed, five checked and three emitted.
Re-export support makes the syntax/IR package entrypoints parseable; other files still
hit later unsupported syntax. These are component tests, not evidence of a native
compiler self-build. Native compiler construction and stage-two reproduction remain
outstanding under the active self-hosting objective.

## Object-valued native arrays

List runtime bindings now accept checked object/object-union type IDs as element keys,
in addition to primitive number/string encodings. Scalar lowering treats numeric keys as
opaque identities; the module adapter validates their semantic contracts. Write/push
helpers must accept the complete element type, read helpers may return only that type or
undefined, and receiver representation/signature checks still apply. Distinct object
shapes sharing a pointer encoding do not accidentally select the same runtime binding.
IDs belong to the checked module and must be resolved again after rebinding.

Contextually typed object literals, reads/writes, push, readonly views, traced fields and
iteration use the unchanged generic sparse-list/map source. Elements remain managed
references, preserving identity and aliases. Holes read as undefined. Presence and
readonly-discriminant facts now compose: guarding absence no longer prevents narrowing
a subsequent object-union discriminant, and a presence fact no longer overrides a more
specific variant fact. Automatic inference of object-array element shapes remains pending.

All 506 portable tests, type checks, formatting and 35-package boundaries pass. The full
native construction gate passes 88 modes, each success/exhaustion image twice. Three new
modes verify alias mutation, holes, writable traced fields, readonly views, distinct object
element bindings and discriminated unions, with 368-, 288- and 224-byte accounting.
Portable negative cases reject narrowed helper writes and widened helper reads even when
their native pointer signatures match.

The audit remains 56 sources, 27 parsed, five checked and three emitted. Inspecting the
source catalog confirms further dependencies on object-valued maps, escaping closure
values, array slicing/sorting and string case conversion. General syntax coverage and
native host/compiler-driver integration also remain. This is compiler data-structure
progress, not a stage-one compiler or stage-two self-build; the self-hosting goal stays active.

## Typed object keys and values in native maps

Map bindings now use the same collection-element identity contract as object arrays:
number/string encodings or checked object/object-union type IDs. Shared validation checks
all object key inputs, value writes and optional read results against the declared
semantic type, in addition to receiver and physical-signature validation. Contextual Map
arguments allow object literals and union variants without losing shape checks. Object
keys use identity through the unchanged generic linked-map implementation.

All 509 portable tests, type checks, formatting and 35-package boundaries pass. The full
native construction gate passes 91 modes, each success/exhaustion image twice. New source
fixtures verify equal-shaped distinct keys, missing-key lookup, alias mutation, replacement,
readonly calls, deletion/clearing, union narrowing and multiple object value contracts in
one program, with 320-, 224- and 224-byte accounting. Negative helper tests reject narrowed
object keys and widened read results despite matching native pointer signatures.

The source audit remains 56 sources, 27 parsed, five checked and three emitted. This adds
native representation support required by compiler tables, but does not compile the full
compiler. Escaping function values/captures, collection iteration/callback operations,
remaining syntax and native host integration still block stage-one compiler construction.
No stage-one-to-stage-two self-build has been produced; the goal remains active.

## Managed function-value IR and native indirect calls

The shared IR now supports function-new and call-indirect. Construction allocates a fresh
managed identity for a noncapturing target. Indirect calls use an included function as an
ABI signature witness, validate arguments/results, and permit a different actual function
with the same physical signature. Native guards reject a non-function descriptor or
incompatible signature before loading/calling code. Capturing construction remains an
explicit verifier error until owned environments are connected.

The 48-byte function representation contains the ordinary descriptor/flags header, code
address at 16, environment reference at 24, module-local signature ID at 32 and zero padding.
Its descriptor traces the environment only. Entrypoint addresses use the existing native
relocation path. BLR calls reuse direct-call argument placement, result areas, completion
handling and root restoration, including managed and overflow arguments. No interpreter,
external compiler or platform linker was introduced.

All 511 portable tests, type checking, formatting and 35-package boundaries pass. The full
native construction gate passes 98 modes, each success/exhaustion image twice. New cases
exercise ten numeric arguments, six strings/references/optional numbers, distinct function
IDs with equivalent signatures, wrong-signature/descriptor traps, exact allocation,
exception tag/string payload propagation and root-chain restoration. The throw fixture
reads the existing tagged completion correctly: tag at 16 and string pointer at 24.

The source audit remains 56 sources, 27 parsed, five checked and three emitted. This is
native function-value infrastructure, not source-level escaping closure support or a
self-hosted compiler. The next source connection should reuse managed record layouts for
captured cells (state byte plus traced payload) and environments containing cell references,
so independently escaping closures can share mutations without retaining stack storage.
Function initialization/identity, lexical and loop lifetime, source callback lowering and
compiler host integration still require implementation. The self-hosting goal remains active.

## Owned closure environments and shared captured cells

FunctionIR now distinguishes a managed closureEnvironment record contract from borrowed
environment cells. Function construction accepts an explicit managed environment and
checks its descriptor; closure-environment loads that pointer from a dedicated rooted
frame slot. Borrowed storage still cannot escape through function construction. Direct
calls cannot omit a required owned environment. Indirect calls retain the existing ABI.

Captured cells reuse ordinary record allocation/descriptors and the existing cell helper
generator. A separate stateOffset byte records initialization; it is not an optional
property presence flag. Ordinary record access cannot bypass the cell guard. Guarded
record-cell initialize/read/write operations enforce initialization, single initialization
and mutability, with success-edge-only transfer-slot initialization. Environments contain
shared cell references, and cell descriptors trace managed payloads. This supports sibling
closures sharing a variable while different factory activations retain independent cells.

All 514 portable tests, type checks, formatting and 35-package boundaries pass. The full
native construction gate passes 107 modes, each success/exhaustion image twice. New IR
fixtures verify returned counters, shared sibling captures, independent activations,
string/object payload replacement, allocation before the first environment load, and
initialization after closure creation. Failure fixtures cover uninitialized reads,
reinitialization, immutable writes and wrong environment descriptors. Exact accounting is
224 bytes for two returned counters, 384 for two sibling pairs, and 176/240 for managed
string/object replacement cases. The owned environment root is published at root-frame
offset 16 before any body allocation.

The audit remains 56 sources, 27 parsed, five checked and three emitted. These are owned
closure IR/runtime gates. Source closure conversion, function identity/hoisting, lexical
and per-iteration cell allocation, callback integration and compiler host plumbing remain
unimplemented. Native collection/reclamation is also pending. There is still no native
stage-one compiler or stage-two self-build; the original self-hosting goal remains active.

### Source function values

The managed module adapter now lowers noncapturing source arrows, callback parameters,
returned functions and indirect calls. Descendant functions are appended after selected
roots so existing entry indices and runtime helper relocation remain stable. Each arrow
evaluation allocates a traced native function object; calls evaluate the callee before
arguments, preserve callback exceptions, and use the existing register/stack ABI.
`typeof` returns `"function"` while preserving operand effects.

Source fixtures verify factory returns, distinct identities, callback results, mutation
of the callee during argument evaluation, block-bodied arrows, effectful typeof and
exception propagation. Native tests check allocator accounting and root restoration on
both success and exhaustion. Portable negative cases cover missing signature witnesses,
unsupported captured arrows, named function values and duplicate roots.

The current indirect-call contract uses an included function as a physical ABI signature
witness. Source owned captures and hoisted named function values remain the next work.
Their integration must allocate one shared cell per captured lexical binding, preserve
TDZ and immutable-write guards, and distinguish each activation and loop iteration.
The existing owned-environment IR supplies the storage, tracing and native cell guards;
source lowering must supply scope allocation and initialization placement. This work
has not yet produced a native compiler stage one or a self-hosted stage two.

Validation for this slice: `pnpm check` passes 518 portable tests and all 35 package
boundaries; `pnpm verify:construction` passes 110 native modes, each success/exhaustion
image twice. The source coverage audit remains 56 files, 27 parsed, 5 checked, 3 emitted.
Function/object unions remain explicitly unsupported until their runtime discrimination
is implemented; pointer compatibility alone does not establish correct typeof behavior.

### Source owned captures

Source arrows now capture parameters and local bindings into owned heap cells. The
adapter supplies an explicit owned-environment plan to scalar lowering: cell layouts,
source scope/declaration identities, incoming environment fields and constructor captures.
Function, block and switch scope entry allocate cells; declarations and ordered parameter
initialization set their state. Loads and updates use the shared record-cell guards.

Verified source cases include returned mutable counters, sibling sharing, multi-level
forwarding, local updates after closure creation, postfix/prefix updates, default and
optional parameters, string payload replacement, switch scopes, recursive arrows and
independent cells across repeated block entries. A native negative fixture traps when a
callback reads its captured binding before declaration initialization. The same source
pipeline handles all these cases without an interpreter or external native compiler.

Captured loop-header bindings still need per-iteration copying/allocation. Named function
values still need hoisted initialization; direct calls to captured named functions need
explicit environment forwarding. These remain lowering errors. No self-hosted compiler
has been built yet; stage-one and stage-two compilation remain the required final proof.

Validation: `pnpm check` passes 519 portable tests and all 35 package boundaries.
`pnpm verify:construction` passes 121 native modes, each success/exhaustion image twice;
11 modes exercise source captures, including the uninitialized-cell negative case.
The per-file audit remains 56 sources, 27 parsed, 5 checked and 3 emitted. It does not
link or execute a compiler and is not evidence of self-hosting.

### Hoisted named closures and iteration cells

Nested named functions now compose with owned source captures. Functions requiring a
value or environment are initialized at scope entry and read through stable local/cell
identities. Native source fixtures verify calls before declarations, identity across reads,
recursive and mutually recursive functions, block lifetimes, and reassignment visible
through another closure. Direct-only noncapturing function-body declarations retain direct
calls. Module-level function values still require managed module initialization.

Captured classic-for let bindings now copy their cells before the first test and before
each update. This preserves initializer closures as well as closures retained from earlier
iterations; continue passes through the copy/update path. For-of has a fresh initialized
cell per element, with a separate uninitialized header cell during iterable evaluation.
Native fixtures retain closures beyond both loop forms and verify their independent values.
This replaces the previous managed-loop rejection; borrowed-environment restrictions remain.

These source features use the existing managed records, function values, ABI, root frames
and cell guards. No interpreter, C intermediary or platform linker has been introduced.
The full compiler still has not built a stage-one or stage-two compiler binary.

### Native failure-path tests without crash-report dialogs

The construction gate retains its deliberate CPU traps for exhaustion and invalid-input
fixtures. Test executables now use `tools/native-test-traps.ts` to append an entry wrapper
and a process-local SIGTRAP handler. The wrapper installs the handler with Darwin signal;
the handler calls the async-signal-safe _exit with status 133. Setup failure returns 126.
The harness requires a normal process exit with status 133 for trap cases and 0 for success.

The original compiled fixture bytes and BRK instructions are preserved. This changes only
the test process's handling of the resulting signal; production compiler/runtime emission
and macOS-wide crash-reporting preferences are unchanged. The helper uses Tint's existing
Mach-O import writer for libSystem functions, without C source or a platform linker.
A native success/exhaustion smoke run passed twice each with no new diagnostic reports.

Validation after the signal-handler change: all 522 portable tests and 35 package
boundaries pass; all 131 native construction modes pass, with each success/exhaustion
image run twice. Comparing DiagnosticReports before the smoke run and after the full
suite found no new or changed crash reports. The compiler source audit now emits 4 of
56 files independently (27 parsed, 5 checked), including the region allocator through
the managed module-entry path. This remains component evidence, not a self-hosted build.

### Explicit managed module instances

The linking package now exposes `prepareModuleInstance(module, bound, exports)`. It
prepares a single resolved, specialized module as an explicit initializer returning a
readonly interface of selected function values. Value declarations and expression
statements retain source order; type declarations remain outside the initializer. The
existing owned closure path provides hoisting, shared mutable state, initialization
guards, roots and retained lifetime. No separate module-state execution engine was added.

Native source fixtures verify two independent instances, stable function identities,
shared state within an instance, object-valued initializers, top-level side effects,
function aliases, default parameters, initialization throws and early-read traps. A
reassigned selected export is rejected because a snapshot field would violate live-binding
semantics. This API does not claim to implement namespace objects or module caching.

Next integration is dependency evaluation order and general linked-program initialization.
The declaration-only linker's existing initializer restrictions still apply. The full
compiler has not yet been emitted as a native stage one, and self-hosting remains unproven.

### Linked-program initialization and host surface

Instance linking now retains runtime declarations and expression statements and computes
an explicit dependency-first evaluation order. Iterative traversal visits shared runtime
dependencies once and handles cycle back-edges. Type-only declarations contribute types
without evaluation; inline type specifiers retain side effects under verbatimModuleSyntax,
verified against the pinned TypeScript implementation. Public instance-interface names map
to resolved internal function bindings through explicit `{name, local}` selections.

All 140 native construction modes pass, including linked dependency order, diamonds,
inline-type side effects, successful cycles and a cyclic TDZ trap. Expected traps use the
process-local handler established above. This is closed synchronous program instantiation,
not module-cache/namespace/dynamic-import/top-level-await support or a self-hosted compiler.

The runtime dependency audit found no external runtime imports in portable compiler
packages. The [runtime host surface](runtime-host-surface.md) now specifies a seven-function
synchronous `node:fs` facade and standard globals. The Node file adapter no longer imports
crypto for temporary names; it uses a bounded counter and exclusive creation. A collision
test verifies preservation of an existing file. A separate host type-check configuration
exposes only the finite fs contract and rejects broader Node exports, modules and globals.
Native platform implementation of that facade remains an explicit integration task.

Validation after the host-surface audit: `pnpm check` passes 530 portable tests, the
finite host-adapter type check and all 35 package boundaries. The native file ABI gate
passes binary-copy, missing-input, exclusive-create, read-error and rename-error cases,
including cleanup and executable permissions. The latest complete construction gate
passes all 140 modes with handled expected traps; no Problem Reporter process remains.

## Indexed sorting runtime

The dependency-free `@tint/indexed-sort` package implements stable comparator sorting
through explicit length/has/read/write/remove callbacks. It collects input before
comparing, keeps undefined out of comparator calls, preserves holes during writeback,
and uses iterative linked merge sort. A native fixture specializes the unchanged
source for numeric record storage and verifies captured callbacks and exact allocation.
Array.sort syntax is not yet connected to this runtime helper.

## List sorting integration

`@tint/list-sort` depends on indexed-sort, number-list and sparse-list. Its two thin
adapters supply indexed access and return the original receiver; the dependency-free
sorting core retains the algorithm. ListRuntime.sort registration validates both
storage and comparator contracts. Numeric and sparse source entry modules allow
native builds to select the required adapter and comparator signatures.

`@tint/type-syntax` depends only on `@tint/value-types` and `@tint/ts-syntax`.
It reifies reachable structural contracts into named syntax for runtime generic
specialization, preserving cycles without depending on checking or codegen.

`@tint/runtime-linking` composes collection requirement discovery, structural
contract reification, generic specialization, and checking. Its result is a
checked module plus lowering runtime bindings; it has no file or platform
access. The source loader supplies linked runtime templates and export names.

`@tint/primitive-value` is a dependency-free baseline runtime for managed mixed
number/boolean/string/undefined values. It provides checked extraction, truthiness,
strict equality, SameValueZero and key normalization. Runtime-linking supplies its
helpers to lowering through explicit validated contracts. It does not implement
unknown object values or the general exception ABI.

## Shared native compiler pipeline

`@tint/native-compiler` depends on the syntax, binding, checking, linking,
runtime-linking, closure-lowering and AArch64 emission contracts. It composes
those stages without filesystem or process dependencies. Parsed/resolved source
modules and runtime templates are explicit inputs. It returns native code and a
module initializer, optionally with a one-shot invocation entrypoint.

`prepareModuleInvocation` in ts-linking forwards a selected export's annotated
signature after initializing a fresh module instance. Native execution verifies
that this adapter passes arguments through the same function-value ABI. The
compiler pipeline is shared orchestration, not yet a self-hosted executable.

## Scaling the native compiler's own collections and verifier

A Node bootstrap now produces a macOS arm64 stage-one compiler containing the
file adapter, source loader, native pipeline, allocator and tracing collector.
Executing it under LLDB reaches real source parsing. A same-source stage-two
rebuild has not yet completed; that remains the acceptance criterion.

Sampling the native parser identified linear token-array lookup in linked-map
storage as the dominant cost. `@tint/sparse-list` now owns an AVL tree of present
indices, removing its dependency on linked-map. Reads, writes and deletions are
O(log n); truncation visits populated entries instead of ranges of holes.
Rotations preserve managed object identities and allocate no additional nodes.
Native stress coverage retains 8,192 indexed objects across mutation, truncation
and repeated garbage collection. The linked-map implementation remains separate
and still has linear lookup; this change does not claim to optimize all maps.

The IR verifier's greatest-fixed-point initialization analysis now stores compact
bit vectors instead of duplicating a heap Set for every block-slot pair.
`@tint/bit-vector` is an independent word-storage module with bounds, copy,
intersection and equality contracts. Entry, predecessor, guarded-read and
exception-edge initialization semantics are unchanged. A deterministic cost
regression catches the old full-set duplication without relying on timing.

The stage-one compiler has also completed a real native build of a small entrypoint
with the complete runtime dependency graph. Its Mach-O output matches the Node-built
reference byte for byte and executes with the expected result under LLDB. This is
pipeline evidence, not the full compiler self-build. `tools/prepare-compiler-smoke.ts`
prepares that target and reference; the native compiler accepts its generated project
directory and output path through the ordinary CLI.

Sampling that native compilation identified integer-to-string conversion in type
relation keys as substantial work. `@tint/number-text` now formats safe integers with
its existing exact digit routine, avoiding arbitrary-precision expansion and repeated
candidate parsing. Floating-point conversion retains the existing round-trip algorithm.

The region allocator also retains independent first-fit search hints for request
sizes in a bounded direct-mapped table. This avoids rescanning small holes when
common object sizes alternate. Hints occupy 96 trailing metadata words supplied
by the host; descriptor capacity is preserved. Exact fits repair cached links,
and both release paths invalidate hints. Differential churn, cache collisions,
metadata exhaustion and native exact-state checks cover the revised contract.

Whole-program linking exposed another quadratic path: syntax-node identity maps.
`@tint/key-index` now composes sparse-list buckets with linked-map collision
handling and an insertion-order entry chain. Compiler adapters hash immutable
source offsets while preserving identity comparisons inside collisions. Linking,
checking and lowering share its explicit read-only lookup/traversal contract.
Ordinary JavaScript Map semantics remain the responsibility of linked-map.
Native stress covers collision lookup, identity, ordered traversal and retention
across collection. The project also explicitly supplies its generic specialization
budget through the shared compiler request instead of relying on a hidden cap.

The indexed native compiler passes the small-target byte comparison and execution
check and reaches full-program specialization. A debugger inventory exposed
descriptor exhaustion after a successful collection: roughly 1.88 million live
objects plus free extents consumed all 2,097,152 slots, with about 105 MB of
managed payload used. The compiler project now supplies 16,777,216 descriptors
while retaining its 1 GiB payload budget. Its native run passes that point and
reaches type checking; a complete same-source self-build remains unverified.

Type-graph validation now uses byte arrays for dense-ID cycle/depth state. This
removes quadratic linked-map scans without changing the validation rules. A
deterministic cost regression, the portable type-system suite, and native
2,048-type validation cover the change.

Function-level native profiling now uses optional Mach-O symbols produced by Tint.
`docs/profiling.md` documents the bootstrap flag and the validated local pprofessor
capture workflow. Profiles exposed GC object rescanning and inventory heap sorting.
The collector now streams each object's edges once through reusable control state;
its exact native setup footprint increased by 400 bytes. Large inventory snapshots
can radix-sort descriptor indices using temporarily borrowed collector workspaces,
without new managed allocations. A full self-build is still required to establish
end-to-end performance and self-hosting.

Native debug builds now carry DWARF v4 function and source-line information through
`@tint/dwarf`, a reusable encoder independent of the image format and frontend.
The A64 emitter records source-span instruction ranges; the compiler resolves them
through original module positions, and the driver relocates them into the final
image. Apple DWARF verification, LLDB, and a local pprofessor capture resolve the
result to TypeScript files and lines. Native emission of the runtime smoke image
matches Node byte-for-byte, including its debug sections.

Those profiles identified repeated literal/union-table scans and linked-map reads
of dense narrowing-fact IDs. Literal resolution now retains existing IDs in a
lookup, union lookup uses an append-aware collision-checked index, and narrowing
facts use dense indexed storage. Property widening resumes at newly appended type
candidates while preserving the existing ordered result. These changes have unit,
differential, and native smoke coverage; complete self-hosting is still pending.

`@tint/property-descriptor` is a dependency-free, representation-independent
implementation of property-descriptor update validation. Presence bits distinguish
missing fields from supplied undefined values. Complete immutable descriptors
retain data/accessor kind and attributes. Callers supply the runtime's undefined
value and SameValue operation, and validate accessor callability while converting
source descriptors. Updates return accepted/rejected/invalid without mutating
storage; this separates semantic validation from object layout and API-specific
exception behavior. Differential tests compare attribute and kind transitions
against `Reflect.defineProperty`; a native fixture exercises the same implementation.

`@tint/ordinary-object` depends on `@tint/property-descriptor` and
`@tint/environment-record`. The latter supplies generic function-this lifecycle
operations for derived construction; it has no dependency on objects, realms or
source syntax. Object construction maps the returned error codes to realm errors.
It owns ordinary
property storage and acyclic prototype links, exposing descriptor-based definition,
lookup, deletion, extension prevention, receiver-aware assignment and own-key
ordering. Keys are already canonical; runtime values, SameValue, callable handles
and invocation remain injected contracts. Accessors receive the original receiver.
Descriptor conversion preserves inherited-field lookup, observable read order,
callability validation and fresh descriptor-object attributes. Exotic object hooks,
property-key coercion and JavaScript builtin bindings remain separate boundaries;
these primitives do not by themselves claim general JavaScript object
syntax or Test262 harness execution support.
