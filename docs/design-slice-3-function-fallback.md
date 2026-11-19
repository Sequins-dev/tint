# Slice 3 design — function and class fallback

Status: proposal against main `e93aacded`. The
[convergence plan](unified-pipeline.md#migration-slices) owns slice scope.
A typed module should keep its native functions when a sibling needs the
general engine. Both bodies still compile to native code. The compiler must
validate the original program before it can erase a body, and the fallback
must reconstruct that body from the same source snapshot.

## Current behavior and evidence

`compileArm64Program` in
[the native compiler](../packages/compiler/src/native/index.ts) tries the
linked typed pipeline first. The dynamic-object realm retry happens within
that attempt. A returned error can then seed module fallback whenever a
`GeneralLowering` and `start` are supplied, `requireTyped` is off, and the
error lacks `preventsFallback`. There is no general check-stage allowlist.
A check error can carry a module mapped through the linked source ranges.
Bind, specialize, runtime and emitter failures often lack a usable source
owner. Lowering sometimes recovers the module by parsing a message suffix.
A missing, repeated or ineligible owner seeds the entire eligible
application. Parser or source-load failures that occur before this entry
point bypass it.

[The partition](../packages/compiler/src/native/general-partition.ts) makes
importers of general modules general and follows dependencies in the other
direction when their used exports lack adapters. Trusted modules remain
typed, and an unsupported trusted export blocks the build. The current
[program adapter](../packages/js-engine/src/program/index.ts) erases types,
lowers whole modules, and emits a host with module records, a lazy realm and
a job drain. Synthetic exports cover eligible annotated non-generic
functions and constants. They use primitive/unknown, selected record, dynamic
object and native error conversions. The callable adapter calls a fixed typed
export and ignores the JS receiver. It cannot serve as a general call,
construct or mutable-binding adapter without additional work.

The [Linux native ledger](results/unified-pipeline-ledger-slice4a-c2-b3-dev-lldb-v1.json)
contains 72 paired constructs. Typed forms recorded 31 native passes on the
typed path and 35 native passes on the whole-module path. Another three built
through module fallback and failed execution, one built through module fallback
despite a required type error, one failed parsing, and one required an
unavailable option. Untyped forms recorded 69 general passes, two general run
failures and one unavailable option. These are execution results from that
ledger's frozen source snapshot. The [current-main probe](results/slice-3-function-fallback-corpus-e93aacded.json)
covers 72 typed corpus forms plus three probes. Of the corpus forms, 31
emitted on the typed path, 39 rejected during typed compilation (25 check,
11 link, two runtime, one specialization), one failed parsing and one
required an unavailable option. Its typed-path emission agrees with the
ledger for all 72 forms. The probe records first rejections, pinned TypeScript
diagnostics and selected
retries through the present module fallback.
It stops at AArch64 program emission and measures neither hosted exit status
nor runtime performance.

| Corpus witness | First rejection in the native ledger | Significance for slice 3 |
| --- | --- | --- |
| `generators` | Check: generator suspension lowering is not implemented | Eligible function. Its callers need general iterator values. |
| `async-await` | Link: unknown value name: Promise | The first error can be in a caller. Record actual owner and capability. An async body and Promise operations may require separate decisions. |
| `arguments-object` | Link: unknown value name: arguments | Resolve the implicit binding with the full binder before classifying. The function frame owns it. |
| `class-basic`, `class-inheritance`, `class-private-static` | Runtime: module-instance classes need construction lowering. Check: accessor contracts and static blocks | Plan a whole class before constructing any part. A first failure can mask later heritage/private-element gaps. |
| `var-hoisting` | Typed native pass | Preserve supported var. Exercise unsupported combinations such as eval or suspension with var, hoisting and redeclarations. |
| `explicit-binding-contract` | Link: unknown value name: eval | Its existing whole-module image fails execution. Standalone eval needs a host compiler hook and contract-aware binding access. |
| `accessors-object-literal`, `generic-functions`, `tuple-types`, `regexp` | Check: accessor layout and entry-pair-only tuples. Specialize: explicit type arguments. Link: typed RegExp values | Valid constructs can be rejected at different stages. A local expression may temporarily select its enclosing function until slices 4 and 5. |
| `typed-array-index` | Check: invalid binding operation | The ledger labels an emitted fallback as a missed type error. Pinned TypeScript accepts this exact source. The preceding write narrows the later indexed read. Use an unproven indexed read for the type-error fixture. |
| `probe-error-after-generator` (current probe) | Check: generator suspension lowering is not implemented | Pinned TypeScript reports TS2322 in the sibling entry function. Module fallback still emits. This is a confirmed masked type error. |
| `open-callback-parameter` | Check: invalid binding operation | Same Tint message as the array case. The assignment targets an open parameter under Tint's profile. |
| `iterator-protocol`, `typed-array-index-unchecked` | Parse: expected `{`. Unsupported compiler option | Parser and option prerequisites. |
| `module-statements`, `module-initializers` | Link: module evaluation is required for this statement | Module evaluation work for slice 5. |

TypeScript also reports TS4114 for the ledger's `class-inheritance` source
under the workspace's `noImplicitOverride`. Use an explicit override for the
valid inheritance witness. The additional decorator probe using
`typeof Example` in an annotation hit a Tint parser gap before fallback.
See the [focused oracle probe](results/slice-3-function-fallback-oracle-e93aacded.json)
for the unproven index (TS2322), simple decorator signature (typed class
replacement capability), and corrected override (accessor capability). All
three still emit through the current module retry.

On the compiler sources, the linked check of `compiler/src/native/index.ts`
reached **242 modules and 3,870 checked functions**, with 64 specializations
and zero rejections. The actual macOS compiler build used the production
roots and `requireTyped: true`, completed through image writing, and emitted
a 41,792,378-byte stage 1. The build stayed typed. The source snapshot,
commands, timings,
and probe limitations are in [measurement notes](results/slice-3-function-fallback-e93aacded.md).

## Classify original-source diagnostics before changing representation

Use the pinned **TypeScript 6.0.3** checker against the original graph and
the program's compiler options, including module resolution, standard-library
declarations and declared host surfaces. Use full ECMAScript binding and
early-error validation under the original source goal. Treat Tint's
[open-slot policy](unified-pipeline.md#contracts-and-speculation) as an
explicit profile rule layered on the oracle. TypeScript's default inference
may diagnose a write even when Tint deliberately leaves the target open.
Resolve the diagnostic's binding and role before applying that exception.
A subsequent use at an explicit slot or checked operation still requires its
own proof or runtime contract. In particular, TS2322 on `const v: number =
bytes[1]` remains an error when the read can produce undefined and
`noUncheckedIndexedAccess` is on. A read narrowed by a previous write may
be valid. The same code on a write against an inferred
variable or contextual parameter can be advisory. An implicit-any diagnostic
from an intentionally unchecked module follows that module's checking policy.

For the initial hosted slice, pass a Node-hosted pinned TypeScript validation
provider from the composition root and test the decision against the workspace
compiler. Use project declarations for Tint host modules and explicitly
unchecked dependency inputs. Cache the **verdict and compact type facts**
against the source snapshot, source goals and options. Collect semantic
diagnostics across the original graph, including sibling functions,
initializers, imports and fallback bodies. The first unsupported function
must never conceal an independent type error. For builds that enable the
new hosted route, validate before selecting any representation, including
a successful typed attempt and the legacy module retry. Opt-in typed-only
and self-build requests retain their existing path. Later CLI/live
enablement needs equivalent original-source validation from Tint's portable checker
or another approved composition provider. The pinned checker remains the
differential oracle. The compiler core has no dependency on Node or the npm
TypeScript implementation.

The existing error code and `preventsFallback` cannot decide admission.
For example, the flag covers both incompatible string-index properties and
valid unimplemented updates on realm aggregates. Instead require a structured
diagnostic with phase, stable reason, original owner and span, and disposition.
Apply these rules exhaustively across the binding/checking/lowering surfaces.

| Rejection source or family | If original program is invalid | If original program is valid under the profile |
| --- | --- | --- |
| Full parser and early-error binder, including invalid strict syntax, duplicate lexicals, private-name and context errors | Language error. Fail the build with original position. | A Tint parser gap needs a parser fix first. Legacy typed binder restrictions can select the owning function/class. |
| Resolution and link: imports, exports, `UNKNOWN_NAME`, `UNKNOWN_TYPE`, `DUPLICATE_NAME`, `DUPLICATE_TYPE`, `INVALID_CONTEXT` | Unresolved required dependency, conflicting declaration or invalid reference fails. | Full-binder implicit names, lib globals, declaration merges, valid type syntax and unsupported linking constructs are capabilities. Local owner selects a function/class. A genuine top-level link/evaluation requirement remains module work. |
| Semantic checker and type store: `INVALID_BINDING`, `IMMUTABLE`, `UNINITIALIZED`, `TYPE_MISMATCH`, `ARITY`, `MISSING_RETURN`, `INVALID_TYPE`, `PROPERTY`, and relationship/property/call errors returned as strings or other codes | Fail for disallowed assignment, operation, return, access, arity, initialization or type declaration confirmed by the oracle and profile. | Unsupported native representations, narrowing, inferred signatures, legal early reads requiring JS behavior, call shapes, and open-slot widening select a general owner when they prevent specialization. `readonly` and binding immutability remain language/contract facts. |
| Class initialization and interface checks (`checker/class-initialization.ts`, `checker/interfaces.ts`) | Fail for real initialization, heritage, index-signature or member errors under the same compiler options. | Instance/static initialization, supported decorator mode, accessor pairs, layout, private brands and annotation forms become whole-class capability decisions. Preserve write contracts in general class storage. |
| `UNSUPPORTED`, including current vetoes, from typed binder, scalar and closure checkers, specialization, runtime preparation or typed lowering | Fail when independent source validation finds an error. | Explicitly identified semantic capabilities become function/class fallback candidates. Generic inference/rest/tuple ABI limits, unsupported literals, patterns, builtins, reflection and member semantics follow this rule. A valid contract with missing runtime machinery is an unsupported capability. A candidate is admitted once that machinery exists. |
| Valid syntax without a general implementation, unsupported host/ABI boundary, unavailable compiler option, or trusted source requirement | Report the applicable source error first. | Unsupported build with the specific missing prerequisite, or explicit legacy module fallback where the same semantics and contracts are representable and allowed. Trusted/host-bound/service modules remain typed. |
| `LIMIT`, specialization/resource budgets, invalid IR or type tables, missing runtime helpers/identity, generated wrapper check failure, host/service/FFI/emit/linker failures and unattributed internal exceptions | Fail the build. | Fail with an actionable resource, capability or compiler diagnostic. A specialization budget can use a separately designed deterministic representation policy. Never infer eligibility from an internal failure, codegen string or lack of location. |

The third column covers mixed-purpose codes by rule. During implementation,
give every site that can request fallback an enumerated capability and owner.
Route all other rejections through source validation and a hard failure
until an explicit capability exists. Cover the typed binder, both checkers,
interface and class initialization checks, type relations, linker,
specialization, runtime preparation and ts-native lowering. Treat current
string-only errors as unclassified during this migration. Test ambiguous
pairs with the same Tint message. Record code, capability, span, suppressed
oracle reason if any, chosen unit and any blocked dependency. An unsupported
capability and an actual source error are distinct outcomes even when each
fails the build.

Maintain two conformance cases for indexed access. Reading a just-written
constant index can carry a proof for native specialization. An indexed read
through an unproven key under `noUncheckedIndexedAccess` requires a guard,
coalescing or a destination that admits `undefined`. The option-off case
remains an options prerequisite. For other open-slot diagnostics, determine
whether the diagnostic depends on an inferred type or on an independent
constraint such as a readonly import, an explicit contract, or a disjoint
assertion. Pin those decisions against representative TypeScript diagnostics.

## Plan before lowering

1. Discover candidates once on original module syntax in source/dependency
   order. Use full binding to attribute read/write/declaration roles.
   Key each unit by source snapshot, module ID, original UTF-16 range,
   syntactic kind and lexical owner path. A specialized clone carries the
   declaration key and substitution facts. Choose fallback for the source
   declaration and reuse its general identity across instantiations. Retain
   typed specialization at unaffected sites.
2. Keep callable/class headers and lexical declarations in the typed module.
   A unit summary records selected representation, binding IDs and modes,
   captures, declared contract IDs, call/construct signatures and proven facts,
   plus required realm and bridge operations. Use headers for linking/checking
   without traversing a general body in the typed specialization pass.
   Prepare a mixed plan from structured capability decisions. If one
   replacement exposes another required general value, widen that use or
   mark its smallest enclosing eligible function. Stabilize a finite
   source-ordered worklist of newly general units and crossing edges before
   generating adapters. A class owns constructor, heritage, elements,
   decorators and initialization. Before nested support, a rejected local
   unit selects the nearest supported enclosing unit.
3. Lower each selected unit with a new subtree entry in
   `js-engine/lowering` that reuses source-function and class generation.
   The compiler injects this capability beside `GeneralLowering.lower`
   through the composition root. It supplies a binding resolver for
   references outside the unit and receives ordinary TS helper bodies,
   initialization actions and runtime requirements. Keep generated modules
   and trusted runtime bindings outside fallback eligibility. Preserve
   original source ranges for diagnostics, backtraces and debug symbols.
4. Attach the resulting function value to the existing module instance.
   Retain the original export identity and the one authoritative slot
   for each binding. Re-exports and imported aliases resolve to that slot.
   Allocate module bindings and publish hoisted functions before module
   evaluation, including across cycles. A class's slot stays uninitialized
   until ordered evaluation of its declaration succeeds. Preserve failed
   evaluation, pre-initialization reads, side-effect imports and live writes.
   Use a single lazy program realm per program instance shared with mixed
   module and dynamic-object facilities. Feed its installer selection from
   the unit requirements. Schedule jobs at existing host boundaries.
   A retained whole-module fallback remains available where the unit planner
   reaches a supported module-only boundary. Its diagnostics name that cause.
   The first host uses the existing `start` composition. The unit factory
   takes the module-instance state so a later library or live composition can
   supply equivalent state and job scheduling. Slice 6 removes the legacy
   module path.

### Call and construction boundaries

- **Typed to general.** Evaluate callee/reference, receiver and arguments in
  source order, retaining exact argument count and spread results. Box
  primitives in the existing category/payload encoding, share strings and
  use live views for native references with a bridge. Reuse realm call and
  construct helpers (including their throw-aware variants). Select a typed
  result projection only with an executable representation witness.
  A failed speculative projection keeps the value general and takes the
  general consumer path. Explicit destinations perform their usual contract
  checks. Promise, iterator and general-class values stay general at this
  boundary. Typed consumers keep specialization elsewhere.
- **General to typed.** A canonical callable view dispatches through a typed
  entry adapter. Use checked projections for explicit argument and receiver
  contracts. Share call completion handling and default/rest parameter
  initialization with the target entry. An open parameter that can receive
  a different value uses the general representation or a guarded entry with
  an executable general path. Use the declared receiver and the physical
  signature only where supported. Host-bound exports keep their existing
  capability checks.
- **Parameter execution.** Ordinary JS evaluates all caller arguments before
  callee binding. Defaults, patterns, destructuring, and rest allocation
  belong to callee initialization. Enforce each explicit constraint at its
  actual initialization/write point, including reassignments and writes
  through mapped arguments where admitted. Preserve duplicate binding and
  implicit parameter rules using the general binder. Optional/default
  parameters receive omitted/undefined values according to their declarations.
  A void context may discard a returned value at the typed use. The
  callable still returns the underlying JS result to observers.
- **Contracts inside the unit.** Erase types only after extracting contract
  metadata for explicit local, parameter, field, element and return
  annotations and checked downcasts. Emit guard operations at stores,
  initialization and genuine result contracts, using existing bridge and
  descriptor machinery where applicable. A failed write leaves storage
  unchanged. Aliases, reflection and eval route through the same checks.
  Apply result enforcement at the semantic production point (for example
  an explicitly constrained async fulfillment or generator yield where the
  declared contract requires it), during the original completion protocol.
  Preserve the original Promise/iterator identity, thenable ordering,
  rejection timing and `finally`. Stage these crossings only once the
  corresponding contract checks are expressible. A generic or structural
  reference without a faithful runtime check needs explicit admission
  rules before fallback can erase it.
- **Receiver and construction.** A call supplies the actual ECMAScript receiver.
  The object's own call logic handles strictness, bound receivers, proxy
  traps and lexical arrow state. A construct passes the original `new.target`
  through the real construct path, including `Reflect.construct` and
  subclassing. Class identity, prototype, home object, `super`, derived
  receiver initialization, private environment and constructor replacement
  follow the engine's existing semantics. Preserve class-call errors,
  arrows' lack of construction and capabilities of bound functions.
  General class instances stay realm objects. A typed fast path into a
  native base class requires a compatible construct/prototype bridge.
- **Exceptions.** Use existing native completion/unwind machinery and engine
  throw-aware helpers. On a thrown completion branch, propagate the original
  value through the appropriate representation view, including `undefined`,
  primitives, arbitrary objects and existing native Error views. Preserve
  throw identity on round trips, avoid rewrapping an ordinary class or Error
  and keep engine abort distinct from user exceptions. A typed caller's
  `catch` receives a general value until narrowed. A general caller's handler
  receives the canonical realm value. Projection/contract errors originate
  at the failing boundary and obey the normal `finally` precedence. Async
  jobs preserve rejected completions within the originating realm.
- **Identity.** One realm object per general declaration and module instance,
  or per evaluation of a nested function expression/class. A typed function
  that escapes gets one cached callable view per closure instance, even
  through different slots, exports and call/construct signatures. A
  reciprocal identity projects a compatible view to its typed closure.
  Mutable function bindings always load the current function from their
  slot. Adapters are code, never additional visible callable objects.
  Preserve `===`, prototype and expando operations, bound/proxy distinctions,
  `name`, `length` and observable function source when the existing engine
  supports it. Prefer allocating realm closures from the start when a
  native view cannot faithfully expose those semantics. Reuse traced
  storage patterns for cached views. Collector/layout changes need
  the relevant owner's agreement.

### Nested functions and shared cells

Plan capture edges after class/function eligibility stabilizes. Use the
native closure-cell/environment machinery with one authoritative cell per
binding and activation. A write by either side updates that one cell. A
statically resolved external reference in general code lowers to a bridge
read, initialize or set using the bound ID. On a read, box directly from the
typed cell or return the existing general value. On a write to an explicit
cell, test the contract before storing. An open cell with an unproven general
writer has general storage for its lifetime. Typed reads take guarded
projections if useful, with general behavior on failure. Read-only escapes
need only a read bridge. Escaping native closures, suspended generators and
queued async jobs root the same cell via existing traced representations.

Preserve separate uninitialized state, mutability and per-iteration let
cells, distinct parameter/body environments, self-binding for named
expressions, shadowing, recursion, and shared environments of sibling
closures. A nested general arrow captures lexical `this`, `arguments`,
`new.target`, private environment and method home as applicable. When the
typed owner lacks a faithful carrier for this context, select the enclosing
function or class with that capability. Avoid global name lookup for such
captures.

Direct eval uses the existing `createDirectEvaluator` and exact caller-site
metadata from the general engine. Install it only with the necessary
executable-code host capability. Include eval-visible outer bindings even when
the source has no static reference to them. Extend the existing environment
record operations to address bridged cells for dynamic lookup, assignment and
initialization. Keep strict eval's own declarations and scope checks, so
shadowing during eval cannot intercept outer writes incorrectly. General
function locals with contracts and bridged typed cells share this path.
Until the host capability and bridge are available, report the missing
capability at build time for statically detected direct-eval sites in the
new path. Reusing an AOT body reparse for arbitrary runtime strings would
change eval semantics.

## Source replay and working-set budget

Use the source-backed `SourceModuleLoader` concept already in
[the module package](../packages/typescript/src/modules/index.ts). Its selective
`load(ids)` returns fresh syntax today. Give the mixed path a source/recipe
provider, including normalized text or bytes, original parse goal and flags,
resolved dependency edges, content identity, captured edit/snapshot version
and UTF-16 position mapping. Include the preparation recipe for synthetic
inputs and the host's graph resolution. Replace AST-owning caches and
callback closures that retain `SourceModule.module` on this route. Use stable
IDs and serialized headers/contracts that hold no syntax references across
phases. Keep original source or a frozen backing store available until
diagnostics and source-sensitive operations have completed.

At the source discovery boundary, release a module's original syntax after
extracting needed summaries and lowering its typed work. For fallback,
group selected units by module. Load and parse that module once in a
short-lived frame, recover strict/directive context, private names and
binding IDs, verify the unit keys against the snapshot, and lower the
selected units in source order. Parsing the whole selected module once is
the conservative first implementation. Parsing isolated text ranges requires
proof that all parse and binding context can be reconstructed. A retry
replays its selected module from source and replaces prior generated work.
It should never repeat whole-program typed compilation once per candidate.
Discard original and erased trees and generated syntax as each lowering
frame returns. Use compact generated source/IR or the function store for
further work, retaining lightweight span maps. Installer discovery consumes
incremental unit summaries. A source snapshot mismatch fails explicitly.

The current whole-module retry calls `requestModules` again, then stores
both available input ASTs and erased modules through host generation.
Its existence also means a retained legacy module plan must use replay by ID
when the original caller relinquishes AST ownership. The merged typed
checker and module-global analyses still need their own memory work.
Slice 3's invariant is that selecting a fallback adds no dependency on a
resident input graph. Per-module typed syntax release depends on the
front-end ownership work in [bounded-memory slice 5](compiler-memory.md#input-syntax).

- Additional replay cost is proportional to the total selected module bytes
  parsed per pass. Live replay syntax is bounded by the largest selected
  module at the chosen concurrency, plus one unit's generated lowering and
  compact graph summaries. Keep concurrency at one initially and count
  reparse attempts, byte totals, generated bytes and retries. A module with
  many selected functions should still incur a single replay.
- The historical object-suite probe held about 2.8 GB of input ASTs during
  optimization, with earlier heap snapshots attributing 1.25–1.9 MB to input
  syntax per variant. Using 1.9 MB as a planning average, an eight-variant
  serial replay would churn about 15 MB of parsed syntax in total and have
  one variant's syntax live at a time if each is a separate module. The
  actual cap is the largest selected module's measured syntax size,
  especially for generated aggregations. The figures predate later memory
  work, including the reported 1,967 MiB second check preparation. They
  give an illustrative replay cost.
- The captured current compiler catalog contains 781 sources and 21.1 MB
  of source bytes. A one-pass serial parse of that catalog took about
  0.52 s of measured parser time on Node, excluding file reads and decode.
  That is about 0.33% of the observed 157 s stage-1 elapsed time for a
  whole-catalog replay at the same throughput. Selected replay should
  parse a subset. Check, binding, helper lowering, native host parse and
  optimization cost more work and need separate counters. Inspect peak
  RSS and retained trees on both hosts, with matched source/module plans
  and debug positions enabled, before assuming a net memory saving.

## Ordered implementation and admission checks

Use separately switchable capabilities or an explicit mixed-build
prototype until all admission requirements of each step hold. Native
fixtures return 42 and report unit IDs, reasons and typed siblings.
Build fixtures with `TINT_BUILD_ONLY=1` and run under LLDB with stopped-at-entry
and final exited-42 assertions under the project gate policy. Use Node
references for ECMAScript semantics and pinned TypeScript references for
source validity. Give Tint-only contract checks a separate native fixture.
Keep both typed and untyped corpus forms and record whether a mixed result
uses any legacy module fallback.

| Step | Independent fixture/check | Expected ledger change |
| --- | --- | --- |
| 1. Source validation and structured capability taxonomy | Check paired annotated/open assignment, invalid call after a generator, invalid return inside a fallback unit, strict early errors, valid realm update currently vetoed, unsupported parser and unknown host import. Assert original spans and zero general lowering on a source error. | Add a genuinely unproven indexed read as a source-error case. The current `typed-array-index` is valid under the pinned oracle, so record its typed specialization gap. `typed-array-index-checked` stays typed. Existing mixed admissions remain at module granularity. Record any strict-profile changes before enabling validation globally. |
| 2. Source replay and unit accounting, initially without finer admission | Compare legacy fallback using owned syntax against replay from a deliberately emptied AST cache. Use multi-unit/module, Unicode offsets, type-only re-exports, source-map/manifest and snapshot-mismatch fixtures. Probe forced store policies. | Same outcomes and executable bytes when using the same legacy strategy. New report fields show replay and owner IDs. |
| 3. Top-level ordinary functions and bidirectional calls | Put a general helper containing `arguments` and var hoisting beside a typed numeric kernel. Verify nested same-module calls in both directions, hoisting before evaluation, exact receiver/arity, identity through import/re-export, default side effects, throws and contracts. Include one import cycle and shadowed globals. | `arguments-object`, selected `regexp`/valid local capability cases move to mixed when all crossing types are supported. `var-hoisting` remains typed. Add a fixture that proves mixed typed siblings instead of inferring this from the single-function corpus. |
| 4. Top-level classes and suspended functions | General class with inheritance, accessors, private and static elements, decorators and typed siblings. Assert class TDZ, constructor/heritage/decorator order, `new.target`, reflection, failed initialization and instance/constructor identity. Pair generator/async returns with caller-visible iteration, job ordering and abrupt completion. Gate the class and suspension capabilities separately. | `class-basic`, `class-inheritance` with the override modifier, `class-private-static`, `generators` and `async-await` move to mixed where their consumers have usable general representations. Add decorator ordering and Promise/iterator crossings. Typed array/record/callable reference gaps remain explicit prerequisites. |
| 5. Nested functions, closure bridge and eval | Escaped and sibling closures share actual typed and open cells across calls, GC, recursion and per-iteration scopes. Assert uninitialized bindings, shadowing, lexical receiver/arguments/`new.target`, exception identity and no partial writes. Enable direct eval separately with host capability and the bridged environment. | Add nested read/write/throw/identity cases. `explicit-binding-contract` passes when eval has the host and cell guards. `explicit-field-contract` passes when the relevant reference write is guarded and all edges are admitted. Retain any existing blocked cases with precise reasons. |

A milestone is eligible to land with its specified capability independently
enabled and checked. Report `typed`, `mixed` with per-unit details, legacy
`general`, source error, and explicit unsupported separately in the ledger.
The current checker-stage-only test for expected type errors must use the
structured classification. Compare to the latest ledger on the same corpus
population, preserving native failures as observed. `requireTyped` and
`TINT_GENERAL_FALLBACK=0` must reject every mixed application admission.
Keep self-build typed until slice 7 and CLI composition under slice 6.

## Risks and measurements

- **Hot bridge cost.** Benchmark an unchanged typed numeric/record kernel
  alone, beside a cold fallback, and repeatedly calling across both
  directions. Include primitive fixed arity, default/rest + spread, cached
  callable/reference views, cold wrapper/view creation, and throws. Measure
  wall time, cycles, adapter calls, allocations and retention. Use identical
  inputs and native harness, interleaved locked timings and a separate cold
  startup run. For common small arities prefer a shared helper or a proven
  allocation-free entry where the engine ABI permits. Deduplicate adapter
  code by compatible direction, physical signature, contracts and completion
  shape. Preserve a per-identity environment and per-instance caches.
- **Image growth.** Measure complete executable, native program code, cold
  realm installers, per-unit helper and adapter code, debug/relocation
  payload and startup separately. Compare one fallback, many fallbacks with
  shared signatures, and the equivalent whole-module fallback. Existing
  convergence evidence put the general host in the tens of MB. One isolated
  fallback may initially pull a similar realm footprint. Keep installer
  dependencies visible and coordinate with fine-grained slice 1c.
- **Typed-only identity.** A successful original typed request must take
  the exact existing code generation path, preserving root set, check/specialization
  order, function/type IDs, layouts, realm absence where previously absent,
  optimizer ordering and image/debug bytes. Allocate mixed planning state on
  the first eligible rejection. Measure validation cost separately when the
  host enables validation for a typed-only success. Use frozen v7 with the
  same runtime tree, the code-size report, debug/non-debug image hashes, spilling identity, and
  macOS and Linux gates. Compare stage 1/2/3 fixpoint and the baseline/candidate
  images from the same frozen compiler **source** input, since changing the
  compiler's own sources can intentionally change its rebuilt executable.
  Passing tests alone cannot establish byte identity.
- **Memory and semantics at scale.** Measure parse/bind/check/lower wall
  time and RSS, retained syntax after front-end stages, cache hit rates,
  largest module and retained views/cells. Exercise a frozen compiler
  snapshot, sparse mixed graphs, a dense fallback stress graph and a
  representative Test262 suite image on matching toolchains. Test
  identity/aliasing and moving GC through nested suspension, and preserve
  failed native launch observations independently of program outcomes.

## Coordinator decisions

1. Approve the first hosted validation provider and how Tint's open-slot and
   unchecked-dependency profile maps to pinned TypeScript diagnostics.
   Before expanding to CLI/live, choose the delivery point for equivalent
   portable validation and agree on handling pre-existing accepted inputs.
2. Confirm bridge prerequisites and ownership. For initial mixed support,
   admit the existing identity-safe representations and add each reference
   kind with its own evidence. Confirm expected runtime contract behavior
   for annotated async/generator payloads and decorated/replaced members.
3. Choose the host milestone for direct eval. Reuse the general engine's
   evaluator with explicit capability, or land other nested fallback first
   and track eval as blocked by host composition. Coordinate any changes to
   resource loading, collector/layout, image or service ABI with their owners.
4. Set acceptable cold image/startup growth and hot crossing budgets from the
   matched probes. Set a replay budget alongside input-syntax ownership,
   using current matched RSS profiles. Typed-only output identity remains
   a hard gate.
