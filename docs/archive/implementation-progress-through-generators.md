# Historical implementation notes

Archived from `docs/implementation-goal.md` on 2026-11-01. These are
chronological observations, not current instructions or a current coverage claim.
Later entries may supersede earlier gaps, next steps, and measurements. Artifact
paths in prose retain their original repository-relative context. Do not append
new progress here.

Use the [active goal](../implementation-goal.md) for priorities and the
[Test262 dashboard](../test262.md) for measured conformance. Consult this archive
only when investigating a specific historical implementation or validation result.

---

# Active implementation goal

The active goal is broad JavaScript and TypeScript language coverage, with an
explicit eventual target of **over 90% of the Test262 suite passing natively**.
Test262 is the guide for feature selection. Prioritize completing syntax and its
execution semantics, then missing standard APIs; APIs required by the test harness
may be implemented earlier. Parser acceptance is an inventory signal, not a pass.
Measure the target on a pinned complete suite and recorded variant policy, retaining
unsupported variants, failures, harness errors, crashes and timeouts in the
denominator. A selected feature slice cannot establish the overall target.
Test262 is a JavaScript compatibility guide, not a performance target. Untyped
programs may use slower generalized representations and runtime checks. Evaluate
performance separately on typed compiler/tooling workloads and subsystem benchmarks;
strict-profile type proofs and guarded live-mode specialization justify optimization.
Do not trade JavaScript correctness for benchmark parity on untyped tests. The previous
self-build performance goal is complete: the accepted threshold was two minutes,
with one minute as a stretch target, as clarified by the user. Preserve correctness and native
self-hosting throughout; compilation speed is not the completion criterion.

Use the sequence below as an architectural dependency guide, while Test262 syntax
gaps determine the next implementation slice. Include Script modes and early errors
in that inventory; do not prioritize typed-only refactors over missing JavaScript
syntax semantics merely because their infrastructure is available. Progress in
independently verifiable slices:

1. **Object foundation and Test262 setup.** Complete property-descriptor validation,
   ordinary object storage/prototypes, accessors and receiver-aware calls. Establish
   genuine Script/global environments and the native Tint Test262 adapter. Preserve
   original harness/test semantics, realm isolation, source goals, includes/module
   fixtures, asynchronous completion and phase-correct negative results. Report
   unsupported features, timeouts, failures and crashes without counting them as passes.
   **Gate before classes:** run an unchanged synchronous Test262 selection through
   Tint's native pipeline, with original harness files and honest per-variant
   outcomes. Prioritize Script/global environments and dynamic object/callable
   integration until this is working. Async, agents, and advanced harness support
   can expand with their corresponding language features; complete suite coverage
   is not required to begin classes.
2. **Classes.** Constructors, instance/static fields and methods, `this`, initialization
   and encapsulation first; then inheritance/`super`, accessors, private brands and
   remaining JavaScript class semantics. Add TypeScript modifiers, parameter properties,
   generic classes and interfaces with explicit strict/live profile boundaries.
   Once classes work in compiler source, actively review existing stateful code for
   suitable class-based refactors. Adopt classes in a small stateful helper before
   reorganizing parser/checker/lowering state. Keep independent algorithms and immutable syntax data separate from stateful
   owners; avoid turning each existing large closure into an equally large class.
3. **Destructuring, rest and inference.** Declaration/assignment/parameter patterns,
   defaults, nested patterns and rest; strengthen generic inference and the tuple/type
   relationships needed to give reusable compiler APIs precise contracts.
4. **Iteration and generators.** General iterator protocols, symbols required by those
   protocols, IteratorClose, generator suspension/resumption, delegation and abrupt
   completion through `finally`. Lower suspension through the shared native pipeline
   and retain correct GC roots for suspended frames.
5. **Asynchronous language support.** Promise/job infrastructure, async functions,
   async iteration and async generators. Reuse the suspension machinery and preserve
   JavaScript scheduling, exception and iterator-cleanup behavior.

For every slice, add focused semantic tests, use the pinned TypeScript checker and
JavaScript reference behavior where appropriate, verify native execution under LLDB,
and adopt the new constructs in compiler source where they improve structure. Keep
small refactors continuous. Validate meaningful compiler changes with native
self-builds and byte comparisons.

Measure Test262 results on a recorded suite revision and selection/variant policy.
Compare runtimes only on matching populations, and disclose adapter limitations.
Parser acceptance, typed native fixtures and Node reference-adapter results are
separate evidence; none is a Tint runtime-conformance pass.

Current progress and evidence live in [language coverage](../language-coverage.md) and
[Test262 integration](../test262.md). The goal remains open until these capabilities
are implemented and validated; reaching a convenient progress-report boundary is
not a reason to stop implementation.

Immediate class integration: base classes and public accessors execute through
the native Script pipeline. The type graph and type syntax now preserve separate
call/construct signatures. Class linking now preserves both value/type namespaces
and lexical class identities, with native fixture and byte-identical self-build
validation. Annotated base-class instance/static contracts now resolve with
contextual receivers and canonical generic instances. Top-level nongeneric annotated
base classes now have executable method/initializer checks and conservative definite
field initialization analysis. Next extend that analysis to remaining control flow,
retain type-only declarations without executing their class bodies, and lower typed
construction and member access before adopting a compiler helper.
The representation constraints and implementation sequence are recorded in
[native class emission](../native-classes.md).
Prototype-aware scalar reads now reuse record presence and guarded dispatch, with
native direct/optimized mutation tests and a byte-identical compiler self-build.
Class layout planning now supplies those contracts and initialization-tracked
fields, with native planner and field-access fixtures. Next implement constructor
representation and ordered class/module initialization. Function-environment
inspection now reuses managed function storage and guarded record access, with
direct/optimized native fixtures. Constructor environments now have planned static
state and a hidden construction slot, with function-environment property dispatch.
Checked `new` contracts now select hidden construction entries; scalar lowering
preserves callee/argument ordering and shares optional-argument and exception handling
with ordinary calls. Base construction bodies now allocate instances, initialize
fields in source order and then invoke constructor bodies through the managed closure
ABI. Static initialization now reuses that field/call machinery against existing
constructor state, preserving the constructor receiver and abrupt completion.
Class-definition generation now connects constructor/prototype state and publishes
inner/outer binding cells around the static phase. Next wire that generator and
checked member/body entries into the source adapter; the typed class lowering boundary remains explicit.
Keep shared prototype method identity and borrowed/detached receivers: do not
implement methods by binding them permanently to individual instances. Inheritance,
private brands and the remaining class semantics stay within the overall goal.
Keep unsupported execution explicit until each path is complete. Use Node only as
an independently labelled comparison baseline.

Test262-led Script-mode progress: directive-sensitive parsing, mode-aware binding
and synchronous strict/sloppy/raw native preparation now work for supported forms.
Selected unchanged continuation, duplicate-parameter, raw-hashbang and class-accessor
tests pass natively. Next continue the syntax/semantics inventory, including remaining
Annex B binding rules and callable contexts; primitive receiver boxing, arguments
objects and module/async execution remain explicit gaps. Preserve this genuine
execution evidence separately from syntax-inventory acceptance and typed benchmarks.

Named function expressions now have native Script self-name environments, recursion,
shadowing and strict/sloppy assignment behavior; ordinary functions and arrows expose
name/length metadata. Four selected unchanged Test262 cases pass, and the full syntax
inventory gains 285 positive accepted variants. The unchanged propertyHelper.js
harness exposes `delete` as the next useful syntax/runtime dependency for descriptor
coverage. Implement deletion through existing property/environment primitives,
preserving reference evaluation and strictness, before revisiting those harness tests.
Typed named-expression closure lowering remains explicitly unsupported.

Deletion is now connected through native Script property and binding references,
with strict/sloppy behavior, TDZ-safe binding deletion and primitive wrapper own
property checks. The unchanged descriptor harness advances to `for…in`. Next build
ordinary-object enumeration on the existing ordered-key/descriptor operations,
including inherited enumerable keys, non-enumerable shadowing and deletion during
iteration, then connect the loop syntax/lowering. Object reflection APIs are also
needed by the harness; keep their failures visible until installed with full contracts.


The shared ordinary-object enumerator and declaration-head for-in execution are
now native-verified, including inherited/shadowed/deleted keys, head TDZ, fresh
iteration bindings and abrupt control flow. Six unchanged Test262 variants pass;
the descriptor harness now stops at arguments objects. Continue with assignment
heads and the remaining loop forms, plus arguments and Object reflection needed by
the harness. Typed-profile for-in and primitive wrappers are not yet implemented.
Self-hosting remains byte-identical for the for-in-declarations-v1 snapshot.


For-in reference-assignment heads are now native-verified, including per-iteration
reference capture, empty-source behavior and setters. Continue arguments-object and
Object reflection infrastructure for the unchanged descriptor harness. Do not model
mapped arguments as ordinary accessor properties: their parameter aliasing must
preserve data descriptors and disconnect correctly on deletion/redefinition. Remaining
iteration patterns, primitive wrappers and Annex B forms stay in the coverage scope.

Internal data-property aliases are now native-verified: parameter storage can remain
linked to a data descriptor, with successful deletion, accessor conversion or a
read-only redefinition disconnecting the alias. Sealing preserves the link; freezing
captures its current value. The existing 632 native Script fixtures still pass.
The shared arguments constructor now builds mapped and unmapped objects, including
duplicate-parameter selection, length/index descriptors, iterator identity and
callee data/poison descriptors. It accepts embedding-owned key/value representations;
no string substitutes for symbols are introduced. Arguments branding and the
realm-local ThrowTypeError intrinsic are implemented as well.
Source-level arguments bindings now execute natively, including parameter defaults,
strict/unmapped and sloppy/mapped values, declaration shadowing, escaping arrows and
class methods/constructors. Source callbacks receive their own function identity
independently of this, a reassigned source binding or construction newTarget.
The Script adapter still lacks symbol keys and the iterator intrinsic; it omits
that capability explicitly rather than using a string substitute. The generic
constructor preserves the supplied iterator identity in embeddings that support it.
The unchanged descriptor harness now advances to array-expression lowering. Build
ordinary array semantics and the Object/Array/Function APIs that harness requires;
keep each missing capability visible in native conformance reports.

The array-object foundation now shares descriptor storage with ordinary objects and
overrides property definition through an explicit internal capability. Native checks
cover index-driven length growth, read-only boundaries, sparse shrinking and partial
deletion failure. Semantic tests also cover double coercion, reentrancy and abrupt
conversion. Dense array literals and elisions now execute through this foundation. The Array
constructor, Array.isArray and realm-local array prototype identity are installed
in Script/Test262 embeddings; empty, nested and elided literals pass six unchanged suite
variants. Spread, iteration and prototype algorithms (including join and
push required by the descriptor harness) remain to be implemented. Number-hint
object coercion for length shares the ordinary conversion machinery with string
conversion. The original arguments-family report remains a pre-array baseline.

Object construction and reflection are installed in Script/Test262 embeddings:
create, defineProperty, defineProperties, getOwnPropertyDescriptor,
getOwnPropertyNames and keys, plus hasOwnProperty and propertyIsEnumerable.
Descriptor conversion precedes updates and preserves inherited fields and user
coercion order; existing array and mapped-arguments semantics handle redefinition.
Primitive boxing and symbol-key reflection remain unsupported. The unchanged
descriptor harness still needs additional builtins; retain its harness-error
outcomes until those capabilities work without source rewriting.

Function call/bind now use explicit internal call/construct capabilities. Bound
functions preserve the target prototype, captured receiver and argument prefix,
construction newTarget substitution, and instanceof delegation. Native fixtures
cover nested binding, classes, arrows, metadata getter order and misleading own
prototype properties. Dynamic Function construction remains explicitly unsupported.
The complete bind Test262 baseline records 105/200 passing variants, separately
from custom fixtures. Its missing restricted caller/arguments accessors have since
been installed on Function.prototype using the realm's shared thrower; both
unchanged variants of BoundFunction_restricted-properties.js now pass. Other
failures and unsupported results remain recorded in the original report.

Array.prototype.push now uses ordinary Get/Set and length coercion, preserving
setters, read-only failures, partial writes and the distinct array/array-like length
limits. The unchanged basic push test passes both native variants in
`results/test262-array-push-native-v1.json`. Primitive wrapper receivers remain
unsupported. Array.prototype.join also executes with a snapshotted length,
separator coercion before element access, inherited elements, holes and abrupt
completion. The unchanged empty-array join test passes both native variants in
`results/test262-array-join-native-v1.json`. Array.prototype.toString (and therefore
nested-array coercion) still requires implementation. The descriptor harness also
uses Math.pow and String, neither of which is installed yet.

Two compiler coverage gaps encountered during this work remain open: generic
for-of argument copying can fail native lowering with an optional-number/general
representation mismatch (the bound-function helper uses indexed copying), and
object-literal getter/setter syntax is not yet parsed (descriptor-defined accessors
and class accessors work). These are language gaps, not Test262 passes.

Object integrity and prototype reflection now expose the shared ordinary-object
operations: getPrototypeOf, setPrototypeOf, preventExtensions, isExtensible, seal,
freeze, isSealed and isFrozen. Immutable prototype identity is distinct from
extensibility, preserving Object.prototype's required behavior. Native checks cover
cycles, unchanged prototypes on non-extensible objects, primitive-target validation,
accessors, frozen arrays and mapped-argument alias disconnection. Primitive boxing
for getPrototypeOf and proxy-specific internal methods remain unsupported.
The bound-function prototype Test262 case now passes both variants in
`results/test262-bind-prototype-native-v1.json`; this recheck does not replace the
earlier complete-family run. Another native representation gap was exposed by a
conditional expression joining null and an object; separate returns through the
existing unknown encoding are used until that union expression can be lowered.

Script in, == and != now execute with captured operands and shared ordinary-object
coercion. Membership rejects primitive right operands before key conversion and
does not read accessor values. Loose equality handles ordinary object conversion,
nullish values, booleans, strings and numbers; Symbol, BigInt, @@toPrimitive and
legacy host-object cases still require their own capabilities. The in Test262 family
records 21/69 passing variants, with private-field membership and missing builtins
remaining significant gaps. Targeted unchanged numeric/string equality and bound
prototype-presence cases pass both variants.

This work exposed and fixed the native bridge from general unknown values to
narrowed primitive unions. Conversion dispatches by the runtime category, preserves
null separately from object references, and retains managed roots while boxing.
A compiler regression fixture and a native typed round-trip fixture cover the
bridge; the Script corpus now contains 809 passing native cases. Equality guards
against null/undefined still do not fully narrow unknown in the checker; the
dedicated fixture checks those branches separately using their known literal values.
Fresh self-hosting validation succeeds: stage1-operator-coercion-v1 rebuilds its
frozen snapshot into byte-identical stage2-operator-coercion-v1 (45,529,338 bytes,
SHA-256 ec3673b2d76f8dbb6e9dd8d906bce9a1a7a29fd7d265e4f80638c8bbf9f4acdc).
The native compiler exits zero and both images pass DWARF verification.

Arithmetic, relational comparisons, compound arithmetic assignments and numeric
updates now coerce ordinary objects through shared ToPrimitive/ToNumber helpers.
Operands are evaluated before conversion, conversion remains left-to-right, and
postfix updates preserve the converted old value. Native checks cover conversion
fallback, lexical comparison of converted strings, NaN ordering, throwing hooks
and accessor read/convert/write order. Date/default-hint special behavior,
Symbol/BigInt and exotic conversion hooks remain separate capabilities.

Primitive wrapper storage and Number/Boolean/String constructors now execute
natively, with branded prototype methods, immutable UTF-16 String indices,
Object boxing and boxed receivers in Array push/join. The native Script corpus
passes 1,009 cases; the workspace suite passes 1,696 tests. An unchanged Test262
wrapper-equality case passes both variants in its own recorded report. Symbol/BigInt
wrappers and most
String/Number APIs remain gaps. Non-decimal finite nonzero Number formatting is
explicitly unsupported. These semantic checks do not impose an untyped performance
target; typed workloads remain the optimization guide.

Object.prototype.valueOf, hasOwnProperty and propertyIsEnumerable now share
realm-local ToObject. Their native regressions verify identity, primitive wrapper
payloads, string properties and key-before-receiver conversion order.

Primitive source property reads/writes now use shared ToObject for the lookup
base while preserving the primitive receiver. Strict/sloppy failed writes and
inherited accessor receivers pass native regression checks. The full unchanged
Object.prototype.valueOf directory records 36/40 passing variants and four harness
ReferenceErrors, separately from the custom native corpus and whole-suite target.

Sloppy receiver binding and primitive for-in enumeration now use the same boxing
helper. Native cases verify fresh wrapper identities, strict receiver preservation,
arrow inheritance, bound calls, inherited accessors/properties, string index
shadowing and nullish handling. Symbol/BigInt wrappers and cross-realm host facilities
remain incomplete; this is not complete ECMAScript call or enumeration coverage.

Object-literal accessors now parse and execute in Scripts through the descriptor
core, with arity validation, getter/setter merging, data replacement and function
metadata. Both variants of an unchanged literal-computed accessor Test262 test pass.
The typed checker explicitly rejects accessors until accessor layout support is
implemented. Dynamic computed names and method super properties are now covered
in the Script profile as described below.
Fresh stage1-object-accessors-v1 rebuilt source-object-accessors-v1 natively with
exit zero. Stage2 is byte-identical (45,562,458 bytes, SHA-256
20cf8300a9c80df6e211af23436491843344f8dd32c4f3a9501ccffc8108637b), and
both images pass DWARF verification.

Object-literal prototype setters now parse and execute in Scripts, with duplicate
early errors, null/object handling, ignored primitive values and correct separation
from computed/shorthand/method/accessor properties. The typed checker rejects them
until its prototype layout is implemented. Fresh object-literals-v1 self-hosting
passes: native exit zero, byte-identical 45,579,066-byte stage1/stage2 binaries,
SHA-256 76145358a5ce20188f6e3c984eaadc5fe083801746cbbb81f1c07186cb12afc9,
and both images pass DWARF verification.

Script object spread delegates to the existing generic CopyDataProperties core:
snapshot own keys, recheck each current descriptor, invoke enumerable getters with
the source receiver, and define fresh target data properties. Nullish inputs are
empty and other primitives use ToObject. Symbol keys and Proxy hooks remain gaps.
All fourteen added native regressions pass, including after removing the duplicate
copying loop in favor of the generic core. Both variants of an unchanged Test262
getter-side-effect spread case pass. Workspace checks pass. The object-literals-v1
self-build above verifies the current parser/checker changes; subsequent spread
adapter cleanup does not change the compiler's self-build source catalog.

Function.call baseline completed: 90 variants, 26 pass, three runtime
ReferenceErrors, 43 unsupported, two harness ReferenceErrors and 16 LLDB attach
failures. Launch diagnostics confirm the spread binary's embedded signature is
valid, and a previously passing binary still runs at its original path but fails
after byte-identical copying. Re-signing a diagnostic copy did not resolve launch.
No compiler signing changes or OS security changes were made. The original spread
binary later ran successfully unchanged after the baseline finished; the precise
launch-failure cause remains unproven. Do not retry a still-live debugger process.

Full pinned syntax inventory v8 accepts 53,976 of 103,264 variants across 53,751
files, 740 more than v7. This executes zero tests and is not a runtime conformance
percentage. Preserve explicit unsupported and negative-unverified outcomes.

Property-reference key conversion now accepts ordinary objects using shared
string-hint coercion. Reads, writes, deletes and computed class elements share the
helper; native checks preserve nullish-base checks, throwing hooks, fallback and
assignment ordering. The native fixture now formats diagnostics only on failure, avoiding eager
JSON serialization of large successful binary results.

Dynamic computed object-literal keys now preserve their expressions through AST
parsing, binding, linking and rewriting. Native evaluation converts keys before
values and resolves method/accessor/inferred function names from the resulting
string. Unchanged key-order and accessor-conversion-error Test262 tests each pass
both variants. Typed dynamic object layouts and Symbol keys remain unsupported.
Method super property support is described below. The frozen computed-object-keys-v1 compiler self-build exits
zero and produces byte-identical 45,595,658-byte images (SHA-256
6717a2cb18c8dc09d0ce1049ea5d56c1c0ecebaed30d37d96087f4b87aff61e4).
Both images pass DWARF verification; syntax inventory v8 includes this addition.

Object-method early-error auditing found and fixed sloppy duplicate parameters.
Ordinary sloppy functions, including functions nested in methods, retain allowed
duplicates. Node-hosted parser regressions and the native Script-modes parser
fixture pass. The unchanged Test262 negative is rejected with the intended
diagnostic in the inventory, but remains negative-rejected-unverified rather than
being counted as native conformance. This small parser fix postdates the frozen
computed-object-keys-v1 snapshot; its native parser fixture is separate evidence.

Method home-object infrastructure now records definition identity separately from
call receivers. Class methods/accessors and object-literal methods/accessors
capture their home; ordinary function-valued properties do not. `getSuperBase`
reads the home's current prototype for each new reference. Existing receiver-aware
Get/Set operations supply accessor and data-write behavior without a second
property engine. Computed super references must capture this base after key
expression evaluation, with ToPropertyKey deferred until GetValue/PutValue as in
[MakeSuperPropertyReference](https://tc39.es/ecma262/multipage/ecmascript-language-expressions.html#sec-makesuperpropertyreference).

The home-object slice passes 1,685 workspace tests and the complete 953-case
native Script fixture twice under LLDB. The generic native object fixture also
verifies base capture across prototype changes and accessor receiver preservation.
The method-home-v1 compiler self-build exited zero with byte-identical
45,595,658-byte outputs, SHA-256
d08e60fe373174840758e0a839b3fce93457e687b3a8a2d0241e975e0c840cfb.
Both pass DWARF verification. This frozen snapshot predates the super syntax and
reference lowering below.

Super property syntax and native lowering now preserve method/lexical-arrow
contexts, actual receivers, current home-object prototypes, computed-key ordering,
strict/sloppy writes and deletion ReferenceErrors. Lookup-base and receiver-aware
runtime adapters share the existing ordinary Get/Set implementation. Class instance
and static methods/accessors and field initializers use their own homes. Base
constructor bodies and defaults also capture the prepared class prototype; derived
super() construction remains incomplete. Typed super references
remain explicitly unsupported pending strict-profile class receiver support.

The 979-case native Script corpus passes twice under LLDB, including 26 new super
cases. All 1,687 workspace tests pass and the 21-case native Script parser fixture
passes twice. Both native variants of unchanged Test262 prop-dot-obj-ref-this.js
pass in test262-super-receiver-native-v1.json. This selected result is not a
whole-suite percentage. The frozen super-properties-v1 compiler self-build exited zero and produced
byte-identical 45,612,170-byte outputs (SHA-256
83ee9fe9cb064b9a1f69e316d58f9fe32bc33100dfbe2c45ba762bc95da00613). Both
outputs pass DWARF verification; this snapshot predates the constructor refactor.

The unchanged strict-reference Test262 case also passes its one strict-only variant
in test262-super-strict-native-v1.json. Full syntax inventory v9 accepts 54,119 of
103,264 variants, 143 more than v8, with zero previously accepted inputs lost.
It executes no tests and does not change whole-suite native conformance figures.

Base constructor super support prepares the prototype before compiling the callback
and passes that same identity to createBaseClass. This removes the generated
prototype readback and narrowing block. The verified frozen super-properties-v1
self-build predates this constructor refactor. The super-constructors-v1 native
self-build exited zero with byte-identical 45,612,170-byte outputs, SHA-256
64cc0f8cbe1e29d01e596ef326098b876893bc250838ebdf32f4dd49a3d97a7f. Both
outputs pass DWARF verification. These snapshots predate derived runtime helpers. The complete 94-file super Test262
selection finished against its pre-constructor-refactor snapshot: 184 variants,
20 passes, four runtime failures, 134 unsupported and 26 crashes. Every crash
diagnostic reports LLDB attach/pause failure before execution. Three failures
use missing eval; the poisoned-__proto__ test also depends on missing String
toLowerCase. Preserve the full report and denominator without merging retries.

Derived-constructor runtime primitives now share function-this lifecycle state from
@tint/environment-record. An uninitialized read and repeated binding produce
ReferenceError results. constructSuper delegates to the existing constructObject,
preserves newTarget, binds after construction and initializes fields after binding.
finishDerivedConstruction distinguishes object returns, forbidden primitive returns
and undefined returns requiring initialized this. Native environment and derived
construction fixtures each pass twice under LLDB; all 1,693 workspace tests pass.
These are runtime contracts, not source-level derived class support or new Test262
passes. Heritage and explicit-derived source integration are described below;
new.target and iterator-based argument spreading remain separate gaps.

The derived-class factory now composes those contracts, with distinct constructor
and instance prototype chains, implicit argument forwarding, explicit callback
contexts and shared base/derived metadata installation. Workspace tests total
1,694; type, formatting and dependency checks pass. Its expanded native class
fixture initially encountered LLDB attach/pause failures. The unchanged retained
classes-Pgqcff/classes binary later executed successfully with native exit 42.
Explicit derived constructor and super-call source lowering is described below. The completed self-build proofs above predate this work.

Class heritage now executes once in the class-name TDZ environment, validates
constructibility before observable prototype lookup and handles extends null.
Implicit derived constructors forward arguments and preserve newTarget. Native
Script coverage is 991 cases (12 inheritance additions); the retained full fixture
exits 42. The lowerer itself also compiled and executed inherited-class input
natively. Its callable flags now use named options; explicit local captures and
argument arrays keep its narrowed types valid through native checking. Workspace
checks pass 1,695 tests. The inheritance-v1 native self-build exited zero and
produced byte-identical 45,612,170-byte outputs, SHA-256
f5b192ebe8b607bddf4ebf52ac4fe4f696d71af0d3246230471cd4d3047feaff. Both
outputs pass DWARF verification. This snapshot predates explicit super calls.

Both variants of unchanged Test262 prop-dot-cls-val.js pass in
[test262-super-inheritance-native-v1.json](../results/test262-super-inheritance-native-v1.json).
Keep this result separate from the completed earlier directory baseline.

Explicit derived constructors now receive their per-invocation construction state.
This reads are deferred until expression evaluation; lexical arrows retain the
state, while ordinary functions create their own receiver context. Super calls
capture the current constructor parent before argument evaluation, construct with
the original newTarget, then bind this and initialize fields. Parser permissions
include constructor defaults and arrows and reject calls from ordinary functions,
methods, base constructors and field initializers. Argument spread remains explicitly
unsupported until iterator support is available.

All 1,009 native Script cases pass, including 18 explicit-derived additions. The
native lowerer also executes this syntax successfully. All 1,696 workspace tests,
type checks, boundaries and formatting pass. The new native parser-mode binary
initially hit LLDB attach failure; the unchanged retained binary then exited 42. The
super-calls-v1 frozen native self-build completed with native exit 0. Stage 1 and
stage 2 are byte-identical (45,645,194 bytes), SHA-256
851fd121fcb535543ee106604a650247a037ea06d5458eed5276a48781cbd140.
Both outputs pass DWARF verification.

The superclass-mutation argument fixture follows ECMA-262 13.3.7.1, which captures
GetSuperConstructor before evaluating arguments. Node 24.12 returns 99 where the
spec and Tint return 1. The fixture records and asserts Node's different result
separately; the native expected value stays 1 and neither assertion is skipped.

Selected unchanged Test262 this-binding and repeated-binding tests each report one
native pass and one LLDB attach/pause crash, with no runtime failures. Keep both
reports intact. Full syntax inventory v10 accepts 54,391 of 103,264 variants, 272
more than v9, with zero previously accepted inputs lost. It executes zero tests.

The complete super directory rerun is recorded in test262-super-native-v2.json
against the frozen explicit-super-call snapshot: 184 variants, 67 passes, 11
runtime failures, 46 unsupported, 3 harness errors and 57 crashes. Every crash
reports LLDB attach/pause failure before execution. Keep v1 unchanged; neither
snapshot includes the later new.target or private-element implementation.


### new.target execution slice

Script parsing accepts new.target in ordinary functions, constructor defaults,
methods and field initializers; arrows inherit the surrounding permission.
Top-level uses, invalid meta-properties and escaped target spelling are rejected.
Lowering preserves each invocation's actual newTarget independently of callee
identity and this initialization. Ordinary calls, methods and field initializers
receive undefined; derived construction forwards the original target and lexical
arrows retain it. The strict typed profile still rejects new.target explicitly
until its constructor-context contract is implemented.

All 1,021 native Script cases and the native class-runtime fixture pass, including
12 source-level new.target cases and direct constructor-target forwarding checks.
All 1,698 workspace tests, type checks, dependency boundaries and formatting pass.
The native parser (34 cases) and native lowerer validations pass. The frozen
newtarget-v1 bootstrap binary was generated (45,661,706 bytes). Two LLDB launches
of its self-build failed before execution with the existing attach/pause failure;
self-build verification remains pending. The unchanged Test262 new.target directory
run is in progress. No conformance total is claimed
from these custom fixtures.

Full syntax inventory v11 accepts 54449 of 103,264 variants, with 0 previously accepted inputs lost compared with v10. See
[the v11 summary](../results/test262-full-syntax-summary-v11.json).


### Class static blocks

Static blocks now parse, bind and lower to native Script execution. Each block
owns its var and lexical environment; closures retain those locals, arguments is
forbidden through lexical arrows, and nested ordinary functions keep their own
arguments. Control flow cannot escape to an enclosing function/loop. Static blocks
reserve await while nested function bodies restore their own grammar context.

Lowering prepares static steps alongside field initializers, installs all methods
and evaluates computed keys first, then runs the steps in source order with the
class constructor as this and the static super home. Abrupt completion skips later
steps. No synthetic object properties represent static blocks. The typed class
pipeline diagnoses static blocks explicitly until its initialization lowering is
implemented.

All 1,035 native Script cases pass, including 14 static-block additions. All 1,702
workspace tests pass, including native compiler dependency checking. Formatting
and dependency boundaries pass. The 45-case native parser fixture passes. The native lowerer also passes after
retrying its unchanged retained binary following an LLDB attach failure. The frozen
staticblocks-v1 native self-build completed with exit 0. Stage 1 and stage 2 are
byte-identical (45,892,874 bytes), SHA-256
6992f7f05fd8e7a94ce46df9daf9e1d562a6faaf52e16bec7d3089d6f9f799c6.
Both images pass DWARF verification.

[Syntax inventory v12](../results/test262-full-syntax-summary-v12.json) accepts 54,503
of 103,264 variants, up 54 from v11 with no previously accepted input lost. Six
additional negative variants now parse and are rejected by binding (arguments,
duplicate lexical names, lexical/var conflicts); the native Test262 adapter
currently reports these early errors conservatively as unsupported. Retain the
arguments and binding reports rather than treating them as native passes.

The completed [new.target directory report](../results/test262-new-target-native-v1.json)
contains 28 variants: 3 passes, 2 runtime failures, 8 unsupported and 15 crashes.
Every crash reports an LLDB attach/pause failure. The two runtime failures exercise
Function.prototype.apply and Reflect.apply, which remain missing APIs. The separate
[static initialization-order selection](../results/test262-static-block-sequence-native-v1.json)
passes in strict mode; its sloppy variant encountered an LLDB attach/pause crash.
The two outcomes are retained together, without merging retries.

### Private-element foundation in progress

The ordinary-object runtime now has fresh private-name identities and lazily
allocated own private-element storage, separate from named properties and
prototype lookup. Field updates, read-only methods, accessor receiver dispatch,
missing-brand errors, duplicate installation and non-extensible receivers have
focused coverage. A native fixture passes these operations and retains private
names/values across allocation pressure. The scanner recognizes private identifiers,
including Unicode and escaped spelling. Source private declarations, lexical
name resolution, private member/in expressions and class initialization lowering
remain to be connected; this foundation is not a private-class conformance claim.

The 1,706-test workspace suite passes; the four focused private-element tests
also include undefined field presence and unchanged accessor exceptions.
Native private-token scanning passes on the unchanged retained binary after an
initial LLDB launch failure. Type checks, dependency boundaries and formatting pass.


### Private fields and lexical private names

Private declarations and references now have distinct AST markers. Binding collects
class private names before visiting elements, supports forward references and nested
shadowing, permits exactly one matching getter/setter pair, and rejects undeclared
names or conflicting declarations. Heritage resolves in the enclosing private
environment. The parser rejects private deletion and super-private access and
recognizes private brand-check expressions.

Script lowering allocates fresh private-name identities on every class evaluation.
Instance/static private fields initialize through the existing class-field order,
using own private storage; reads, writes, compound updates, captured references and
brand checks use the shared runtime primitives. Brand checks reject primitive
receivers. Returned-object stamping rejects duplicate installation. Public static
field records now explicitly use the ClassField contract, including optional private
metadata. Private methods/accessors parse and bind but their initialization remains
explicitly unsupported, as do optional chains and strict-profile private layouts.

All 1,052 native Script cases pass, including 17 private-field additions. All 1,711
workspace tests, type checks, formatting and dependency boundaries pass. The native
private scanner/parser/binder fixture passes after retrying its retained binary.
The frozen private-fields-v1 bootstrap binary is 46,191,770 bytes; its native
self-build completed with exit 0 and byte-identical stages, SHA-256
7aac5b9ccd947e305e7d68befeac99654a007a879907bce603e03939568a4b0a.
Both stages pass DWARF verification. The native lowerer passes after retrying its
unchanged retained binary following a pre-execution LLDB attach/pause failure.

[Syntax inventory v13](../results/test262-full-syntax-summary-v13.json) accepts 56,549
of 103,264 variants: 2,046 more than v12, with no formerly accepted input lost.
All 289 newly parsed negative variants are rejected by binding. The unchanged
[private-field usage test](../results/test262-private-field-native-v1.json) passes in
sloppy mode; strict mode reports an LLDB attach/pause crash. Preserve both outcomes.


### Private methods and accessors

Private methods and paired accessors now initialize before fields on base and
derived instances and before static fields/blocks on class constructors. Callable
creation is shared with public methods, retaining home objects, source names,
parameter lengths and non-constructibility. Accessor halves are paired while
preserving first-declaration order. Method identity is shared by instances of one
class evaluation, while separate class evaluations have fresh identities.

Native fixtures cover early field use, static/derived initialization, borrowed
receivers, super lookup, accessor exceptions, missing accessor halves, immutable
private method slots, method names/lengths and brand checks. The shared callable
refactor also fixes public setter length when its parameter has a default.

All 1,073 native Script cases and 1,714 workspace tests pass. The native lowerer
also executes the new method/accessor source, and the existing class-runtime
fixture passes with default constructor/accessor arguments. Type checks, dependency boundaries
and formatting pass. The frozen private-methods-v1 native self-build completed with exit 0 and
byte-identical stages (46,191,770 bytes), SHA-256
a4f512e649ebef18b49d64e26e83f7eb031b538c5a232b5202087261fe4e3fd7.
Both stages pass DWARF verification.
The unchanged [private-method test](../results/test262-private-method-native-v1.json)
and [private-getter test](../results/test262-private-getter-native-v1.json) both pass
in sloppy and strict modes (four variants total). These are separate selected reports.

Remaining class-related work includes optional-chain execution, strict-profile
class/private layouts and broader construction edge cases; generators and async
class methods depend on the corresponding language machinery.


### Optional-chain execution

Script lowering now preserves references across optional member/index/call chains,
including grouped method calls, private access and super method calls. Nullish
guards enclose all subsequent keys, arguments and calls in the same chain.
Deletion skips final getters and returns true for a short-circuited chain.
A shared syntax helper identifies chain boundaries for the parser, checker and
Script lowerer; parentheses terminate the chain without discarding live receivers.

All 1,108 native Script cases pass, including 35 new cases. The lowerer itself also
passes as native code. All 1,716 workspace tests and TypeScript checks pass.
[The full optional-chaining selection](../results/test262-optional-chaining-native-v1.json)
records 76 variants: 28 passes, 4 runtime failures, 44 unsupported, no crashes or
timeouts. Failures require missing eval or Reflect.construct; unsupported cases
include async/generators, spread, templates and conservatively classified negative
tests. This is a complete selection report, not a whole-suite pass rate.
The optional-chains-v2 self-build completed with native exit 0 and byte-identical
46,175,178-byte stages, SHA-256
6f8981ea2f04d70aef211e8c17e6786cd24efd7ec04b36ac5934d7ee1039fa68.
Both stages pass DWARF verification.


### Identifier rest parameters

Functions, arrows, constructors and methods now accept a final identifier rest
parameter. Each call creates a fresh dense ordinary Array from the remaining
arguments, using a shared internal-list array constructor. The ordinary Array
constructor reuses the same helper. Rest parameters disable mapped arguments but
do not alone introduce the separate body environment required by default
expressions. Callable lengths stop before a default or rest parameter, with one
shared calculation for functions and public/private class methods/constructors.

The parser rejects trailing commas, defaults, optional markers, duplicate names,
setter rest parameters and own use-strict directives with non-simple parameters.
Typed rest layouts and destructuring rest bindings remain explicitly unsupported.

All 1,131 native Script cases pass, including 23 new cases. The lowerer itself
executes rest-parameter source natively. All 1,721 workspace tests, type checks,
dependency boundaries and formatting pass.
[The complete rest-parameter selection](../results/test262-rest-parameters-native-v1.json)
records 22 variants: 14 passes, two failures from missing Function.prototype.apply,
and six unsupported variants (array/object patterns and the conservatively
classified invalid-position test); no crashes or timeouts.
[Syntax inventory v14](../results/test262-full-syntax-summary-v14.json) accepts 56,599
variants, 50 more than v13, with no formerly accepted input lost and no newly
accepted negative variants. The frozen rest-parameters-v1 self-build completed with exit 0 and byte-identical
46,191,850-byte stages, SHA-256
cc1b00587b98f4829fb3c91453f477f0b83f3b9ec2ad1661c023ac717d6c8d8c.
Both stages pass DWARF verification. The subsequent shared argument-count refactor
passes the same 1,131 native Script cases. The separate
[unmapped rest-arguments test](../results/test262-rest-arguments-native-v1.json) passes
both native variants.


### Debugger statements

The parser retains debugger statements as distinct AST nodes through binding,
rewriting, linking and checking. Native lowering treats them as empty completion
under the current host policy, which does not enable source debugger actions.
Ordinary LLDB symbols/line mappings remain independent of this statement policy.
The typed native fixture and all 1,140 then-current Script cases pass, including
nine completion/control-flow cases. All 1,722 then-current workspace tests pass.
[The debugger selection](../results/test262-debugger-native-v1.json) records two native
passes and two conservatively unsupported parse-negative variants.
The debugger-v1 self-build exits 0 with byte-identical 46,208,362-byte stages,
SHA-256 781fc79f2416a98eb5d1319f65949c990b92b68e2a99cc77a5e80529aeca34a9;
both stages pass DWARF verification.

### Template substitutions

The scanner now emits template heads, middles and tails while tracking nested
substitution braces. Quoted strings, comments and nested templates do not disturb
that nesting. The parser preserves ordered cooked parts and substitution expressions;
binding, rewriting and linking traverse those expressions. Script lowering performs
string-hint conversion for each substitution before evaluating the following one,
sharing ordinary value coercion and preserving its exceptions. Source bindings named
String do not affect implicit template conversion.

A native case exposed missing Array.prototype.toString. It now obtains and calls
join with the array receiver and no arguments, falling back to the shared intrinsic
object-tag operation when join is not callable. Object.prototype.toString uses the
same tag operation. Symbol.toStringTag and exotic coercion hooks remain future work.

All 1,167 native Script cases pass, including 20 template cases and seven array
stringification cases. The lowerer itself executes template source natively.
All 1,725 workspace tests, type checks, formatting and dependency boundaries pass.
[The full template-literal selection](../results/test262-template-literal-native-v1.json)
records 114 variants: 52 passes, two failures requiring eval, 60 unsupported, no
crashes or timeouts. That report predates the array-stringification prerequisite
fix; its outcomes are preserved. Tagged templates, raw/template-object identity,
invalid tagged escapes and non-primitive typed-profile substitutions remain unsupported.
[Syntax inventory v15](../results/test262-full-syntax-summary-v15.json) accepts 59,360
variants, up 2,761 from v14, without losing any accepted input or newly accepting
negative variants. The template-substitutions-v1 self-build exits 0 with byte-identical 46,406,506-byte
stages, SHA-256
9039fc3fef754f98046fd304a3aff4b33fb9473f11bd0af0aae8c0d175212ea8.
Both stages pass DWARF verification.


### Typed primitive templates and compiler adoption

Typed templates now accept fixed string, number, boolean, undefined and null
substitutions. Lowering reuses rooted string concatenation and the exact numeric
formatter contract; each substitution is evaluated once in order. Unresolved
object coercion and mixed primitive unions remain explicitly unsupported in this
profile. Dynamic Scripts continue to use runtime string-hint coercion.

The native typed-template fixture passes, covering all five primitive types,
negative zero, captures, update ordering and a shadowed String binding. Binder
name-conflict/private-name diagnostics now use templates as a compiler source
exercise. Their native scanner/parser/binder fixture also passes. All 1,727
workspace tests, type checks, formatting and dependency boundaries pass; 57
binding/self-host dependency checks pass after adoption. The frozen typed-templates-v1
self-build completed with byte-identical 46,472,746-byte stage 1/stage 2 binaries
(SHA-256 `b904280c9892341ef8558585af2da56db9970dd1d5776499fda9d26a7b65d51c`);
both pass DWARF verification. The earlier Script template and Test262 reports remain
separate evidence from this typed-profile extension.


### Tagged template expressions

Script lowering now preserves tagged-call receivers and evaluation order, passes
substitutions without string coercion, and caches a frozen cooked/raw template
object per syntactic site and realm. Invalid escapes produce undefined cooked
segments for tags while remaining syntax errors in untagged templates. The cache
belongs to the realm rather than a process-global table.

The native Script fixture passes all 1,190 cases, including 23 tagged-template
cases; the separate native template-object fixture covers descriptors, identity,
realm isolation and allocation pressure. All 1,732 workspace tests pass.
The full syntax inventory v16 accepts 59,449 variants, 89 more than v15, with no
formerly accepted variants lost and no additional accepted negative tests.
The refreshed native lowerer passes for valid tags and invalid cooked escapes.
The tagged-templates-v1 self-build produces byte-identical 46,720,682-byte binaries
(SHA-256 `efcad8698e1816e359fbb241a89efcf5ea0cb9fb1e7888fffca46c580d8cd76c`),
both with verified DWARF. Initial lowerer/self-build launches failed before execution
with LLDB attach/pause errors; retained binaries passed on retry. The full tagged-template Test262 report records 48 variants: 25 pass,
3 fail (missing eval/realm host support), 2 unsupported (Function source compilation),
2 harness errors and 16 crashes. Fourteen crashes are pre-execution LLDB attach/pause
failures; two execute and fault in the deep tail-call tests. Proper tail calls remain
unimplemented. These outcomes are preserved in
`docs/results/test262-tagged-template-native-v1.json`. Typed-profile tag calls remain
unsupported.

The harness errors exposed missing Math.pow during propertyHelper.js initialization.
A realm-local Math object now provides pow with ordered numeric coercion, integral
exponents and the specified NaN/infinity/signed-zero cases. General finite fractional
powers of positive bases remain an explicit unsupported runtime operation; this is
not a complete Math implementation. The unchanged template-object descriptor test
now passes both variants in `docs/results/test262-template-object-native-v1.json`.
All 1,733 workspace tests and type checks pass. The expanded 1,201-case native
Script fixture also passes.


### Exponentiation syntax and Script execution

The parser supports right-associative ** and **= with the required unary-base
restriction. Script lowering reuses captured assignment references, ordered
numeric coercion and the shared integral/special-value power implementation.
General positive-base fractional powers and typed-profile exponentiation remain
unsupported. The power core is shared with Math.pow, separate from intrinsic
installation. Standard Math constants have immutable, non-enumerable properties.

All 1,735 workspace tests pass. The 1,215-case native Script fixture and native
parser/lowerer pass. Full syntax inventory v17 accepts 59,641 variants (+192),
with no lost accepted variants or newly accepted negative tests. The first full exponentiation report records 88 variants: 50 pass, 10 fail,
28 unsupported, and no crashes, timeouts or harness errors. Eight failures depend
on missing Math constants; all eight pass in the separate A14/A16/A20/A22 reports
after adding constants. The other failing test uses Symbols. Unsupported variants
cover BigInt and conservatively unverified parse-negative tests. The fresh full v2 report with constants records 53 passes, 2 Symbol-dependent
failures, 28 unsupported variants and 5 pre-execution LLDB attach/pause failures.
Original reports and focused reruns remain separate.
The frozen exponentiation-v1 self-build exits 0 with byte-identical
46,720,682-byte stage 1/stage 2 binaries (SHA-256
`c696f3111e57c73e7112b978de6ec21e2ca546ba5e46c3da80bfca9bd2ea69ae`);
both pass DWARF verification.

### Object binding declarations and catch parameters

Object patterns now share AST traversal, rewriting, binding-name collection and
Script initialization. Declarations support nested patterns, aliases, computed
keys, undefined-only defaults and rest. Catch parameters reuse those operations;
all names are created before initialization, preserving TDZ and closure captures.
Only simple catch identifiers retain the special var-redeclaration exception.
CopyDataProperties is shared by object spread and rest, with converted exclusion
keys and own enumerable property reads. Symbol keys remain a runtime gap.

The declaration slice passed 1,246 native Script cases and the native
parser/lowerer fixture. Syntax inventory v18 accepts 60,070 variants (+429).
The unchanged const/dstr selection records 51 passes, 130 unsupported variants
and five pre-execution debugger attach failures out of 186 variants; there are
no test-body failures, harness errors or timeouts. Arrays, generator defaults,
parameter patterns, assignment patterns and object for-in/of heads remain gaps.
Strict typed-profile destructuring is explicitly unsupported.

Catch patterns add another 62 accepted variants in syntax inventory v19, bringing
acceptance to 60,132, with no previously accepted cases lost or newly accepted
negative cases. All 1,744 workspace tests pass. The expanded 1,260-case native Script fixture
and native parser/lowerer both exit 42. Type checks, formatting and the 73-package
dependency check pass. The complete catch/dstr selection and refreshed self-build
are being validated independently. The native lowerer exposed excessive record-guard proof
queries during IR verification: read validation now requests only read proofs,
while optimization retains guard proofs. Emission diagnostics preserve source spans.

The frozen object-bindings-v2 self-build exits 0 and produces byte-identical
47,271,482-byte stage 1/stage 2 binaries (SHA-256
`97fb298edfd5701decef8a4c4a88b62227ab13997acd2ef567f0ecb18341a48a`). Both
pass DWARF verification. The first launch failed before execution; the retained
binary passed on retry. This snapshot includes the source diagnostic and record
proof changes; catch bindings have a separate frozen self-build still running.

### Object patterns in loop declarations

Object patterns now parse in for-in and for-of declaration heads. Parsing shares
ordinary declaration validation with classic for initializers, preserving required
initializers and rejecting initializers in iteration heads. BoundNames collection
is shared across identifier, object and the existing restricted array patterns.

Script for-in executes object initialization for each enumerated string key,
including fresh lexical bindings, var writes, computed keys, defaults and rest.
Generic Script for-of and typed-profile object iteration patterns remain explicitly
unsupported pending their execution contracts. Arrays continue to require the
iterator foundation rather than indexed destructuring shortcuts.

All 1,746 workspace tests pass; type checks and the 73-package dependency check
pass. The 1,270-case native Script fixture and native parser/lowerer both exit 42.
Syntax inventory v20 accepts 60,456 variants (+324), with no formerly accepted
cases lost and no additional negative tests accepted. This is a syntax gain;
for-of execution is not included in the runtime claim. A separate frozen
loop-bindings-v1 self-build snapshot is being prepared.

The frozen catch-bindings-v1 self-build has now exited 0 with byte-identical
47,288,090-byte stage 1/stage 2 binaries (SHA-256
`9854f80a39b0ea031398cc674d80e6c41eda554df09a9227a1418f261b2431e2`). Both
pass DWARF verification. The loop-bindings-v1 bootstrap emitted 47,321,290 bytes;
its independent native self-build is now running.

The full catch/dstr report is complete: 186 variants, 51 passes, 130 unsupported,
five pre-execution LLDB attach/pause failures, no test-body failures, harness errors
or timeouts. Original outcomes are preserved in
`docs/results/test262-catch-destructuring-native-v1.json`.

### Object binding parameters

Functions, arrows, methods and constructors now accept object binding parameters,
including nested patterns, defaults, computed keys, rest properties and an object
pattern over a rest-argument array. Parameter attributes and the underlying object
pattern are separate AST contracts, so parameter rest does not collide with object
rest. Shared visitors collect bound names and parameter expressions.

Script function instantiation declares all parameter names before evaluating
initializers. Computed keys and nested defaults trigger the separate parameter/body
variable environments; closures, var copies and TDZ use the existing environment
contracts. Non-simple parameters disable mapped arguments. Function length counts
patterns as one parameter and stops at the first outer default or rest parameter.
Strict typed-profile parameter destructuring remains explicitly unsupported.

All 1,749 workspace tests and all type checks pass. The expanded 1,292-case native
Script fixture and native parser/lowerer exit 42; formatting and 73-package
boundaries pass. Syntax inventory v21 accepts 61,716 variants (+1,260), with no
previously accepted cases lost or additional negative tests accepted. The complete
function/dstr native selection and a frozen parameter-bindings-v1 self-build are
running. The Node bootstrap produced a 47,702,746-byte stage 1 binary.

The frozen loop-bindings-v1 self-build exits 0 with byte-identical 47,321,290-byte
stage 1/stage 2 binaries (SHA-256
`a6690d7a1f5c42453ca557db4b6fc9c39a14833ad078f40bc114df3b8c152f6f`). Both
pass DWARF verification. This closes the loop-pattern self-hosting check above;
parameter-pattern validation remains separate and in progress.

The frozen parameter-bindings-v1 self-build exits 0 with byte-identical
47,702,746-byte stage 1/stage 2 images (SHA-256
`721616aeadb63d516cbc78a2e496f0e5b90052f12f4d7f146ba0157c1e0d45a8`). Both
pass DWARF verification. The completed function/dstr selection records 97 passes,
260 unsupported variants and 15 debugger failures before execution (372 total),
with no test-body failures, timeouts or harness errors. The original report is
`results/test262-function-destructuring-native-v1.json`.

### Object assignment patterns

The parser now validates object assignment patterns through cover grammar. It
retains initialized shorthand and duplicate-prototype diagnostics until it knows
whether an object is used as a pattern, restores pending diagnostics after
speculative parsing, and rejects invalid methods, rest placement, optional-chain
targets and parenthesized patterns. Ordinary object literals retain their errors.

Script lowering captures each assignment reference before reading its source
property, evaluates defaults only for undefined, writes through existing references
and returns the original right-hand value. Object rest captures its destination
before copying properties. Destructuring in for-in assignment heads uses the same
operation. Default evaluation, property reads and rest copying share helpers with
binding initialization. See ECMA-262 KeyedDestructuringAssignmentEvaluation:
https://tc39.es/ecma262/multipage/ecmascript-language-expressions.html#sec-runtime-semantics-keyeddestructuringassignmentevaluation

Syntax inventory v22 accepts 61,965 variants (+249), with no accepted-input
regressions or additional accepted negatives. Unit/native fixtures, the full
assignment/destructuring Test262 selection and an independent frozen self-build
are being validated. Array assignment patterns and typed-profile destructuring
remain gaps.

The complete assignment-pattern validation now passes 1,752 workspace tests,
all type checks, formatting and dependency boundaries. The 1,315-case native
Script fixture and native parser/lowerer both exit 42. The first full fixture
mismatch depended on the missing legacy Object.prototype.__proto__ accessor;
its duplicate-property test now defines an own property, matching the unchanged
passing Test262 case. No runtime workaround was introduced. The 15-variant
assignment/destructuring report records four passes and 11 unsupported with no
failures, crashes, harness errors or timeouts. The larger assignment/dstr report records 206 passes, 421 unsupported,
six failures and seven pre-execution debugger attach failures out of 640 variants.
All six failures reference the absent Symbol intrinsic (three tests in both modes).
There are no harness errors or timeouts. The frozen assignment-patterns-v1 self-build exits 0 with
byte-identical 47,820,042-byte stage 1/stage 2 images (SHA-256
`eb1718eafcb1bfa1dfb228b48c18c02865b38505db14002500cd22e25b90142f`).
Both images pass DWARF verification.


### Symbol-key foundations

The ordinary-object package now provides distinct symbol identities, an explicit
host-owned symbol registry, separate well-known identities, and a mixed
string/symbol property-key contract. Generic object operations retain symbol
identity, order symbols after string keys, exclude them from for-in enumeration,
and include them in property copying unless explicitly excluded. Fresh symbols
are not retained by the registry.

This is internal infrastructure, not yet an exposed Script Symbol intrinsic.
Script property conversion, reflection, coercion and primitive boxing still need
to adopt it before symbol-dependent Test262 cases can run.

Native lowering now represents supported mixed primitive/reference collection
unions as general values while retaining their checked source variants. Map.get,
array iteration and array search preserve that encoding; includes uses
SameValueZero, including NaN, while indexOf uses strict equality. Shared equality
lowering avoids separate expression and generated-loop implementations.
The mixed-collection and symbol-key native fixtures both exit 42, including
identity preservation after 30,000 intervening allocations. Parameter AST test
helpers now explicitly narrow identifier parameters rather than assuming all
parameters have names.

The symbol-core validation passes all 1,756 workspace tests, test/host type
checks, formatting and the 73-package boundary check. The complete native Script
fixture also exits 42. The shared unary emitter now accepts an IR span, matching
its actual contract; this keeps the extracted equality helper self-hostable
without requiring parser-only metadata. The frozen symbol-core-v1 self-build exits 0 with byte-identical
47,919,114-byte images (SHA-256
`2fe705eb5a4988305513a4514d85c3b5ba4c752fa659bb7fdb831098f8150760`),
with both images passing DWARF verification. This snapshot precedes the Script
property-key migration below.


### Script property-key contracts and symbol reflection

Script object APIs, generated entrypoints, global-environment adapters and their
fixtures now share ScriptPropertyKey. Generic ordinary-object implementations
remain reusable with other key types. Object.getOwnPropertySymbols returns symbol
keys in insertion order; getOwnPropertyNames and keys exclude them. The native
symbol fixture validates reflection identity/order and deleting symbol-named
properties from string primitives. Source-level Symbol creation and coercion
remain the next integration step.

The complete native Script fixture passes after the migration. All 1,756 tests
pass. LLDB exposed a native closure signature mismatch when an adapter declared a
string return for a general-key callback; the global-name and arguments-index
adapters now explicitly declare their shared key contract. Automatic native ABI
adaptation for covariant function returns remains a compiler gap; the runtime
signature guard was preserved. No source Symbol support is claimed from these
internal-key tests.


A concrete record-view capability can now derive its managed layout from a single
optional record return type, without a witness parameter. Validation still checks
the input representation, module-function contract, result union and exact layout;
ambiguous record unions are rejected. The symbol view uses this capability to
recognize symbol identities without allocating a dummy object. Its native fixture
rejects strings, undefined and unrelated records, retains symbol identity across
allocation pressure, and exits 42.

The first Object.getOwnPropertySymbols Test262 selection records eight passes and
16 failures out of 24 variants, with no unsupported outcomes, crashes, harness
errors or timeouts. The failures are ReferenceErrors in tests requiring the absent
Symbol or Proxy globals. Report: `results/test262-symbol-reflection-native-v1.json`.
The complete native parser/lowerer fixture also exits 42 with ScriptPropertyKey
entrypoints. The first symbol-keys-v1 bootstrap was rejected by self-host checking: a mutable
selected type lost narrowing across validation calls. Selecting an immutable
final type fixes the contract, and all 16 self-host source-graph tests pass. A
new frozen symbol-keys-v2 compiler snapshot is being built; do not
conflate that pending check with the completed symbol-core-v1 snapshot.

With the validator fixes, all 1,757 workspace tests and test/host type checks pass;
the 73-package boundary check also passes. Both complete native Script and
parser/lowerer fixtures pass with the shared key contract. The native symbol
view/reflection fixture passes independently. Script-visible Symbol installation,
primitive coercion, boxing and iterator hooks remain outstanding.


### Script-visible Symbols and coercion hooks

Script hosts now install Symbol as a callable, nonconstructible intrinsic with
Symbol.for/keyFor, description, valueOf, toString and well-known identities.
Boxing stores SymbolData separately from public properties. ToPropertyKey retains
symbol identity; class/object method naming uses SetFunctionName's symbol spelling.
ToPrimitive invokes the well-known hook with default, number or string hints;
implicit string/numeric conversions reject symbols while String(symbol) produces
the descriptive form. Loose equality handles boxed symbols and object conversion.
Object.prototype.toString reads Symbol.toStringTag with ordinary getter semantics.
Realm construction accepts an explicitly shared registry; prototypes stay distinct.

All 1,759 workspace tests pass, along with type checks, formatting, dependency
boundaries, the 1,352-case native Script fixture and native parser/lowerer fixture.
The six previously failing Symbol-dependent assignment/dstr variants pass in new
isolated reports. Symbol reflection now records 16/24 passes with eight remaining
Proxy-dependent failures. The broader built-ins/Symbol report is running.

The earlier frozen symbol-keys-v2 self-build also completed: stage 1 and stage 2
are byte-identical at 47,935,626 bytes (SHA-256
`457745769ddf6541517c9d8fb93f07bedcaacf0c485253f6097d0a6bd8ec52bd`) and both
pass DWARF verification. That snapshot predates Script-visible Symbol integration;
the latter is validated by the native fixtures above.

Remaining protocol work includes iterator acquisition and closing, array/string
iterators, generic for-of, array patterns and spread. Other well-known consumers
such as @@hasInstance and @@unscopables need their own implementation and coverage;
exposing their symbol identities does not imply protocol support. Cross-realm host
APIs, Proxy and BigInt remain separate gaps.


### Iterator protocol and synchronous for-of

The portable `@tint/iterator-protocol` package supplies iterator acquisition,
cached next methods, stepping, value extraction and IteratorClose through explicit
host hooks. The Script adapter uses ordinary property access and calls, preserving
receiver identity and abrupt-completion precedence. Next/done/value failures mark
the iterator done; early exit closes it, while normal exhaustion does not.

Script arrays expose values/keys/entries and their default iterator; strings iterate
Unicode code points. Iterator prototypes, brands, result objects and toStringTag
properties are installed per realm. Arguments objects retain the original array
values intrinsic as their default iterator. Array-like length conversion and array
creation now live in shared helpers.

Synchronous for-of declaration heads execute through this protocol, including
per-iteration lexical environments, object binding patterns and cleanup on break,
return or throw. The 1,386-case native Script fixture, native parser/lowerer and
standalone iterator adapter fixture pass under LLDB. All 1,766 workspace tests and
type checks pass at this checkpoint. Assignment heads now also execute, including repeatedly evaluated property targets
and object assignment patterns. The expanded 1,390-case native fixture and native
parser/lowerer pass; all 1,767 workspace tests pass. Parser regression tests reject
invalid leading async/let tokens and preserve escaped/parenthesized alternatives.
Array binding patterns, iterator-based spread, generators, async iteration and
iterator helpers remain outstanding.


The full syntax inventory v23 accepts 62,176 variants, an increase of 211 from
v22, with no previously accepted inputs lost and no newly accepted negative tests.
The 542 accepted negative variants remain unresolved. This inventory covers the
same pinned 53,751 files / 103,264 variants; see
`results/test262-full-syntax-summary-v23.json`.


Flat array bindings in iteration heads now use the shared iterator protocol.
Elisions do not access value getters; empty patterns close without stepping;
defaults run only for undefined and observe the per-iteration lexical environment.
The nested iterator closes on early completion, and a failure propagating to the
outer loop closes that iterator according to the same completion rules. A shared
lowering helper now generates both cleanup paths. All 1,400 native Script fixture
cases and the native parser/lowerer pass under LLDB. Both Test262 variants of
`for-of/head-let-destructuring.js` pass in
`results/test262-for-of-array-head-native-v1.json`.

This slice does not add nested/rest array patterns or array declarations outside
iteration heads. The typed profile explicitly rejects array iteration defaults
until its lowering supports them; it must not silently ignore the initializer.


The subsequent array-default syntax inventory v24 accepts 62,294 variants
(+118 from v23), with no previously accepted inputs lost and no newly accepted
negatives. See `results/test262-full-syntax-summary-v24.json`.
All 1,769 workspace tests and both host/test type checks pass.


Frozen self-hosting checkpoint `iteration-v1` completed with identical stage 1
and stage 2 images (47,952,138 bytes; SHA-256
`0ec107c1fe79bea3dc9565c0d4e2a0780f3351bf2ea203f7e59300ae1c3899e6`).
Both images pass DWARF verification. This snapshot includes iteration assignment
heads and precedes the later flat array-binding/default changes, whose native
parser/lowerer and Script fixtures pass independently.


The frozen `iteration-v2` checkpoint includes flat array bindings and defaults.
Stage 1 and stage 2 are identical (47,968,650 bytes; SHA-256
`a94bfdcc4836d40fa911a7531f85f9780cf83d320fd0d92c3904c1e3f83306ab`),
and both pass DWARF verification. Rest-element support follows this snapshot.


Array rest bindings in iteration heads now collect remaining iterator values into
a fresh Script array, preserving elisions, defaults, lexical scope and exhaustion.
The shared syntax traversal/rewriting/linking contracts retain the rest binding.
The typed profile rejects rest heads explicitly until its lowering implements
them. The native fixture passes all 1,405 cases; the native parser/lowerer passes
after one recorded LLDB attach failure and a successful same-binary retry.
Both variants of `for-of/dstr/const-ary-ptrn-rest-id-direct.js` pass in
`results/test262-for-of-array-rest-native-v1.json`.

Full syntax inventory v25 accepts 62,698 variants (+404), with no accepted-input
regressions or newly accepted negatives. General/nested array binding patterns
and array assignment patterns remain the next syntax expansion.


Final validation for the iteration/rest slice: all 1,771 workspace tests pass;
production, test and host type checks pass; formatting and dependency boundaries
pass across 74 portable packages. The 1,405-case native Script fixture and native
parser/lowerer pass. The latest frozen self-build remains the byte-identical
`iteration-v2` checkpoint described above.


### Completed broad Symbol run

The restarted `built-ins/Symbol` native run completed with 192 variants:
135 passed, 42 failed and 15 reported crashes. Every crash is an LLDB attach/pause
failure before execution; none is evidence of a target-code fault. There were no
unsupported outcomes, timeouts or harness errors.
Report: `results/test262-symbol-native-v2.json`. The interrupted v1 artifacts
remain separate.

The failures comprise 34 cross-realm variants requiring missing host facilities,
two constructor-capability checks, two removed-ToPrimitive coercion cases and four
species getter/subclassing cases. The constructor check also requires
Reflect.construct, but inspection exposed a separate implementation defect:
Symbol was marked nonconstructible instead of having a throwing [[Construct]].
The removed-ToPrimitive cases throw TypeError and require further isolation;
they are not attributed solely to their later Date dependency. Species tests need
missing intrinsic getters and built-ins.


The Symbol constructor-capability defect is now corrected: Symbol has a throwing
[[Construct]], allowing a class to extend it while rejecting a super call before
description conversion. A derived constructor can return its own object without
calling super. All 1,409 native Script fixture cases, 1,771 workspace tests, type
checks, formatting and dependency checks pass. The broad Symbol v2 report predates
this correction and remains unchanged; its Reflect.construct-dependent test is
not claimed to pass.
Reference: https://tc39.es/ecma262/multipage/fundamental-objects.html#sec-symbol-constructor


### Iterator-based array literal spread

Script array literals now consume arbitrary synchronous iterables for spread
elements through the shared iterator adapter. Index tracking preserves ordinary
elements, elisions and trailing holes around spreads. Unicode strings use their
code-point iterator. Iterator stepping failures propagate without an extra close.
The same lowering supports multiple spreads and evaluates each operand in order.

All 1,772 workspace tests, host/test type checks, formatting and package boundaries
pass. The expanded 1,413-case native Script fixture and the native parser/lowerer
fixture both exit with the expected status under LLDB. This does not yet implement
call/constructor spread or nested/general array binding patterns, and does not
change the previously recorded Test262 runtime counts.


### Call, constructor and super argument spread

Argument-list parsing now accepts spread expressions. Script lowering shares one
argument collector across ordinary calls, method calls, construction and super
calls. The collector consumes the existing synchronous iterator adapter into an
internal argument list. Callees/receivers and the super constructor are captured
before argument evaluation; optional-call short-circuiting skips collection.
Prepared argument lists used by other lowering paths retain their explicit
contract.

All 1,773 workspace tests, host/test type checks, formatting and package boundary
checks pass. The native Script fixture passes 1,418 cases, and the native
parser/lowerer fixture passes with call and constructor spread syntax. Nested and
general array binding/assignment patterns remain outstanding.


### Recursive array assignment patterns

Script array assignments now support elisions, defaults, rest and recursively
nested object/array targets, including for-of assignment heads. Reference targets
are captured before stepping the iterator; nested patterns begin after extraction.
The existing shared cleanup helper handles early completion and assignment errors.
The binder now propagates write access through array and spread targets.
Rest trailing commas, misplaced rest and non-reference targets are rejected.

All 1,775 workspace tests, host/test type checks, formatting and package boundaries
pass. The 1,426-case native Script fixture and native parser/lowerer pass after
preserved pre-execution LLDB attach failures and successful same-binary retries.
The targeted Test262 for-of array-assignment report records one strict-mode pass
and one sloppy-mode LLDB attach failure, with no semantic failures:
`results/test262-for-of-array-assignment-native-v1.json`.
Nested/general array declaration bindings and parameters remain outstanding.


Syntax inventory v26, after call spread and recursive array assignments, accepts
63,674 variants (+976 from v25). No previously accepted inputs were lost and no
new negative tests were accepted; 542 accepted negative variants remain.
See `results/test262-full-syntax-summary-v26.json`. The broad assignment/dstr
native rerun is in progress in `results/test262-assignment-dstr-native-v2.json`;
an unfinished report must not be treated as final conformance evidence.


The binding-expression visitor now accepts array loop patterns and visits their
defaults in source order. The binder delegates to that shared traversal while
retaining explicit typed-profile guards for unsupported defaults/rest. This
removes a duplicate traversal before extending the recursive binding model.
All 1,776 tests, type checks, formatting, package boundaries and the native
parser/lowerer fixture pass.

Frozen self-build `iteration-v3` includes call spread and recursive array
assignments, preceding the visitor cleanup. Stage 1 is built; stage 2 is running
after a preserved initial LLDB attach failure. Do not claim binary parity until
the native process exits successfully and comparison/DWARF checks complete.


### Shared recursive binding patterns

Array and object patterns now share VariableBinding across declarations, loop
heads, parameters and catch bindings. Arrays carry recursive elements/rest,
annotations and outer defaults. Parsing uses the common recursive binding parser;
name/expression traversal, rewriting, linking and Script initialization follow the
same structure. Rewrites retain hashes and source origins. Typed-profile paths
explicitly reject unsupported nested patterns rather than silently lowering them.

Native validation passes 1,435 Script cases and the parser/lowerer fixture
(after a recorded pre-execution attach failure and same-binary retry). All 1,778
workspace tests, type checks, formatting and package boundaries pass. Additional
catch-array early-error checks confirm duplicate names and conflicting var names
are rejected by the binder.

The enlarged fixture exposed the export resolver's graph-wide name cross product.
Resolution now enumerates each module's own and star-reachable export names,
preserving explicit-export validation, cycles, ambiguity and depth/work guards.
A 710-module regression reproduces the former budget failure and now passes.

Syntax inventory v27 accepts 67,237 variants (+3,563), with no lost accepted
positives. Two newly parsed negative variants are duplicate catch bindings;
binder rejection is independently verified, while the parse-only inventory
honestly retains them in its accepted-negative count (544).
See `results/test262-full-syntax-summary-v27.json`.


Frozen `iteration-v3` self-hosting completed with byte-identical 48,117,258-byte
images, SHA-256
`e71e6aa4be668c068614824614b0667a97d40c0c579576fd310942a6e03b22f7`.
Both pass DWARF verification. That snapshot precedes the recursive binding model.
The newer `bindings-v1` snapshot has a built stage 1 and a running native stage 2;
its parity is not yet verified.


### Symbol.hasInstance and ordinary fallback

Script instanceof now obtains Symbol.hasInstance before requiring a callable
fallback, invokes custom hooks with the right-hand object as receiver and the
left-hand value as its sole argument, and converts the result to Boolean.
Function.prototype installs its non-writable/non-configurable ordinary hook.
OrdinaryHasInstance returns false for non-callable receivers and delegates bound
targets through InstanceofOperator, so target overrides remain observable.
The former combined ordinaryInstanceOf API is replaced by explicit operator and
ordinary-operation contracts, and all callers are migrated.

All 1,779 workspace tests, type checks, formatting and boundaries pass. The native
Script fixture passes 1,445 cases, and the native parser/lowerer passes.
Both variants of the focused Test262 hook-invocation case pass in
`results/test262-hasinstance-invocation-native-v1.json`.


The frozen `bindings-v1` native self-build completed successfully. Stage 1 and
stage 2 are byte-identical (48,216,010 bytes; SHA-256
`9305000b0958dba5c11671d50540fb0f48a368a57f5cc0fea0b1e0796dd1b6f1`).
Both images pass DWARF verification. This checkpoint includes recursive binding
patterns and the export-resolution work fix; it precedes Symbol.hasInstance.

Labelled statements and targeted break/continue are implemented through native
execution, including nested finally and iterator cleanup. The native Script
fixture passes 1,463 cases, the native parser/lowerer passes, and all 1,781 unit
tests pass. Focused Test262 labelled-continue and iterator-close-via-continue
cases each pass both variants. Full syntax inventory v28 accepts 67,362 variants
(+125), with no acceptance regressions or newly accepted negative tests.
Typed named-target assignment/completion analysis remains conservative; Annex B
labelled functions remain unsupported. The frozen labels-v1 self-build verifies parity after this compiler change.

The `verify-hosted-labels.ts` native fixture executes a labelled-loop program and
then parses, checks, lowers and emits that program natively. Its machine-code
bytes exactly match the Node bootstrap output; the fixture exits 42. This also
exercises mutable label-target registration in the native compiler itself.

The broader labelled-statement Test262 run completed with 37 variants: 8 passed,
4 failed, 24 unsupported, and one genuine native crash. The four runtime failures
are the completion tests requiring missing eval. The crash is the proper-tail-call
stress test (EXC_BAD_ACCESS after execution began), not an LLDB attach failure.
Twenty-two unsupported variants are unverified parse negatives or module negatives;
the other two exposed sloppy `let`-expression ASI in Statement-only positions.
See `results/test262-labelled-statements-native-v1.json`.

That ASI gap is now fixed, preserving the `let [` expression restriction.
The two previously unsupported labelled-let tests each pass natively in focused
reports `results/test262-labelled-let-block-native-v1.json` and
`results/test262-labelled-let-identifier-native-v1.json`. Syntax inventory v29
accepts 67,374 variants (+12 from v28), also covering the corresponding if/while/
for/for-in/for-of cases, with no accepted-input losses or new negative acceptance.
All 1,782 unit tests pass. The frozen labels-v1 self-build precedes this ASI fix.

The final labelled-control-flow native fixture passes 1,465 cases, including the
ASI fix. The frozen labels-v1 self-build completed successfully: both images are
48,716,234 bytes and have SHA-256
`de0610c1d2f55be9df1ddf6f0c35270e7fc7d50554f224962321929ab76c14a5`.
Both pass DWARF verification. This snapshot validates the compiler changes for labelled control flow; it
precedes the subsequent sloppy-let ASI adjustment and does not execute Script
intrinsics.


The completed assignment/destructuring native run v2 has 640 variants: 439 passes,
zero semantic failures, 189 unsupported and 12 LLDB attach/pause failures before
execution. Its runtime graph was captured before the subsequent recursive-binding
and labelled-control-flow changes, so it does not certify those later changes.
See `results/test262-assignment-dstr-native-v2.json`. The function/destructuring v2
run completed against the expanded recursive binding implementation: 292 of 372
variants passed (78.5% of that selection), 80 were unsupported, with no semantic
failures, crashes, timeouts or harness errors. Of the unsupported cases, 56 use
generators and 24 are parse-negative variants whose rejections are not yet
certified by the native adapter. See
`results/test262-function-destructuring-native-v2.json`.

Synchronous generators execute through native continuation segments, including
blocks, branches, loops, labels, switch, delegation, catch/finally and IteratorClose.
Pending completions survive suspended finalizers. Async generators and dynamic
GeneratorFunction construction remain unavailable. See [generator architecture and
verification](../generators.md) and [current Test262 measurements](../test262.md#current-coverage).

Syntax inventory v31 accepts 74,262 of 103,264 variants (71.9%, not a native pass
rate), adding 6,888 accepted positives over v29 without acceptance losses. Of 63
newly parsed negatives, binding rejects 59 and reports four unsupported Annex B
block-function cases. See [syntax report](../results/test262-full-syntax-summary-v31.json)
and [negative binding audit](../results/test262-generator-negative-binding-v1.json).
