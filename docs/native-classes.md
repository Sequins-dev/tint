# Native class emission

Typed class checking exists, but typed class declarations still fail explicitly in
native lowering. This document records the representation work needed to remove
that boundary; it is not a claim that class emission is implemented. The existing
Script class runtime continues to use ordinary-object operations.
Module-instance preparation also rejects classes explicitly: moving a declaration
into its initializer requires scoped contract resolution and native construction
lowering. Internal runtime helpers currently use supported record/closure state
until those paths can preserve per-instance capture, initialization order and GC
roots in native execution.

## Three distinct objects

Keep the constructor value, prototype and instance separate. Constructor values
own static fields/methods and reference their prototype and construction entry.
Prototypes own methods and the constructor back-reference. Instances own fields
and reference their prototype. An instance's structural compatibility must not
depend on unrelated static properties of its constructor.

The strict checker now gives prototypes a separate type without instance fields.
Consequently `C.prototype.x` cannot be treated as an initialized numeric field,
and a method requiring instance fields cannot be called with the prototype as its
receiver. Borrowing that method onto a valid instance remains supported. This is
an intentional tightening of TypeScript's unsound prototype-as-instance view.
The general inherited `Function`/`Object` surface, including instance `.constructor`
typing, remains incomplete; do not couple it to the precise static class type.

Generic instantiation may produce different checked types and native entrypoints,
but erased TypeScript arguments must not create distinct observable constructor or
prototype identities for one class definition. Specialization needs to preserve
shared static state and method identity, with dispatch or proven direct entrypoints
where representations differ. Generic class bodies remain unsupported until that
contract is implemented.

## Reuse record and closure storage

Existing record layouts provide typed fields, optional-property presence and
initialization state. Existing closures separate the function entry from its
receiver. Extend those contracts rather than inventing another heap allocator or
binding every method to an instance.

An inherited member read needs an own-property check followed by a prototype read
when absent. An assignment creates or updates the instance's own property; it must
not modify the prototype. Prototype method mutation must remain visible to other
instances without own overrides. Structural interface views must preserve this
lookup through the existing concrete-layout dispatch, not flatten inherited methods
into ordinary own fields. Instances with the same physical field layout can share
a descriptor while retaining distinct prototype pointers.

Test property presence, not whether its value is undefined: an own property holding
undefined still shadows the prototype. Record layouts retain a separate presence
offset, and the existing `record-has` instruction checks both the descriptor and
that presence byte. Scalar lowering now accepts a prototype field and nested read
contract for each concrete record choice. It guards the layout before loading the
prototype pointer, branches on own presence, and follows the nested contract only
when absent. Writes continue to target the own field. This reuses ordinary control
flow, record guards and managed reference slots; no new IR operation is needed.
The class storage planner now supplies these contracts. This mechanism
describes statically bounded typed prototype paths, not arbitrary dynamic prototype
mutation or cyclic prototype graphs.

`CheckedClosures` retains canonical class contracts for storage planning. Each
class gets separate prototype and instance descriptors, independent of the plain
record layout for its structural type. Instance data fields carry initialization
state; method-shadow slots carry own-presence state and optional reference payloads.
A hidden, immutable prototype pointer has no source property name. Prototype
methods are shared references, and the constructor back-reference has initialization
state to support cyclic class setup. Its reference slot does not yet supply a
constructor representation or authorize general function conversions.

Reads and writes of initialization-tracked fields use existing `record-cell`
operations. Construction must initialize fields in JavaScript order, including
the undefined defaults of fields without initializers; allocating a layout is not
itself class initialization. Constructor emission and module evaluation remain
unimplemented, and typed class declarations still fail explicitly in lowering.

Spread and future reflection must distinguish own/inherited and enumerable/non-
enumerable properties. Class methods and the prototype constructor property are
non-enumerable; public fields and ordinary assignment overrides are enumerable.
The optional-field machinery can represent absence, but presence alone does not
encode every descriptor attribute. Do not silently certify reflection until the
corresponding metadata and operations exist.

Constructor objects need a construction entry distinct from ordinary calling.
They must retain JavaScript's function category under `typeof` and generalized
value conversion. Class calls must not become ordinary factory calls when a value
passes through a structural view. Keep unsupported conversions explicit until the
representation preserves those distinctions.

The scalar IR now provides `function-environment`: it validates the function
brand and reads the existing managed environment slot without invoking the value.
The result is an optional managed reference, since noncapturing functions have no
environment. Consumers must explicitly extract a present reference and guard its
record layout before accessing state. The operation is a heap read, does not allocate,
and uses the existing function descriptor and GC edge; it introduces no second
function representation. Captured and empty environments execute in direct and
optimized native construction fixtures. This is constructor-state access groundwork,
not yet source class construction.

Class storage now also plans a constructor environment record containing the
prototype pointer, static fields/methods and a hidden construction-closure slot.
Static fields and the construction slot carry initialization state; the latter is
immutable after initialization. The function itself remains a managed function
value. Constructor environments are not registered as ordinary structural object
layouts, so reading state does not change the constructor's observable category.

A `RecordAccess` can explicitly request function-environment extraction before its
normal guarded field dispatch. The class planner supplies this access for known
constructor shapes compatible with a construct-signature receiver. Reads and writes
then use the existing field initialization checks. Multiple constructor shapes can
participate in this dispatch. Native fixtures exercise structural constructor aliases,
including a nonmatching first descriptor and reading back static writes. This is
validated property-lowering infrastructure; class-definition evaluation and general
function/object view conversion remain separate, unfinished integration work.

`RecordOperations.constructors` now connects each checked `new` expression to a
construction-entry access and an indirect-call signature witness. The class planner
builds this access from the compatible constructor-state layouts and their hidden
initialized fields. Scalar lowering saves the callee before evaluating arguments,
then resolves the entry and invokes it through the existing indirect-call ABI.
Ordinary calls and construction share argument preparation, including omitted
optional arguments, conversions and exception propagation. The construction entry
returns a managed object reference; it is responsible for allocation, initialization
and constructor-return semantics. Class-definition emission must create these entries
and their environments before enabling source class execution. Representation adapters
for otherwise assignable but ABI-different constructor signatures remain necessary.

`buildClassConstruction` now generates the base construction entry from explicit
instance/environment layouts, initializer closures and a constructor-body closure.
It allocates a fresh instance with the shared prototype pointer, invokes field
initializers in supplied source order with that instance as receiver, and initializes
the corresponding guarded fields. Explicit undefined initializations support optional
number, boolean, string/reference and general encodings. A primitive-union default
still needs a runtime-backed initializer rather than an invented raw encoding.
Required fields with no initializer remain guarded for a checked constructor body
to initialize; the source adapter must preserve the existing definite-initialization
and early-receiver-use restrictions.

Only after field initialization does the generator invoke the constructor body,
allowing its parameter defaults to observe initialized fields. Both initializer and
body calls use managed closures and the ordinary receiver/exception ABI. A throwing
initializer or body propagates without returning the partially initialized instance.
The current body contract is void; object-return overrides, derived construction and
source class-definition wiring remain unfinished. The generic block/slot builder
previously private to scalar optimization now lives in `scalar-ir`, shared with this
generator; optimization-specific helper policies remain in their original package.

`buildClassStaticInitialization` now generates the ordered static-field phase
against an existing constructor. It loads the constructor from its managed closure
environment, extracts the constructor's state through the branded function-environment
operation, and initializes fields without allocating another instance. Initializer
closures receive the constructor function as `this`, not its backing state record.
The instance and static paths share field initialization, closure calls, undefined
encodings and exception propagation. The class-definition caller must install methods,
prototype links and the inner binding first, and publish the outer binding only after
this void-returning entry succeeds. That caller is still pending; this generator alone
does not enable typed source class declarations or add Test262 passes.

`buildClassDefinition` now composes prototype allocation, constructor state and
managed call/construction/static entries. Its input environment supplies lexical
method/initializer closures and optional inner/outer binding cells. Prototype
methods retain one shared closure identity. The generator connects the
`prototype.constructor` back-reference and the hidden construction closure, then
initializes the inner cell before calling the static phase. It initializes the outer
cell only after successful completion. Exceptions therefore preserve the outer TDZ
without rolling back side effects or the already-created inner identity.

The source adapter still must prepare lexical captures, supply the class [[Call]]
TypeError entry, and schedule this definition at the correct module/source position.
Computed keys and heritage evaluation need their own source-order integration;
this generator does not independently implement those features. The typed source
class lowering guard remains until that adapter is connected.

## Initialization and calls

Evaluate the callee once, then arguments, retaining that constructor value even if
an argument changes its source binding. Construction allocates the instance,
initializes base fields in source order, evaluates constructor parameter defaults,
then executes the constructor body. Required typed fields can use initialization
state until assigned; reference slots must be safe for tracing before any safepoint.
Every new object/reference involved must use the existing managed-root protocol.

Class definition initializes the inner name before static fields execute and the
outer binding only after definition completes. Method closures are created once
per class definition and receive `this` at call time. Computed keys, inheritance,
constructor object-return overrides and remaining class features must extend this
sequence with their own checked semantics, not be approximated by reordered work.

The next implementation steps are checked member/capture and module-instance
integration, followed by source-level native semantic fixtures
for method identity, overrides, prototype mutation, receiver borrowing, field order
and GC survival. Only after those pass should a compiler helper adopt typed classes.

## Current module-export limitation

Native compilation still rejects exported instance classes requiring scoped
contract and construction lowering. Engine code-storage probes encountered this
restriction before execution; the production publisher uses an opaque interface
and factory with private closure state. This is a native module-lowering gap,
not a restriction on JavaScript class syntax or live-mode semantics.
