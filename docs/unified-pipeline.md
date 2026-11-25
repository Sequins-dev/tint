# Unified typed/untyped pipeline

Status: design, 2026-11-17. Purpose: Tint uses TypeScript type information
to produce faster code than pure JavaScript allows. Untyped code behaves
exactly like JavaScript; explicit types narrow behavior at build time, also
inside programs that mix typed and untyped code. Typed and untyped code go
through one build pipeline with identical feature coverage: plain JavaScript
is fully untyped TypeScript, and types only narrow behavior and select
specializations. A construct that compiles untyped must compile typed, and
typed-code performance is the product, so no convergence step may trade it
away. This note records how the split works today, the target, and the
migration slices.
[Progressive lowering](progressive-lowering.md) owns the HIR/pattern model this
converges onto; [value representations](representations.md) and
[runtime type contracts](runtime-types.md) own the representation and
mismatch policies used here.

## Current split

### Two front ends, one back end

There is already a single back end. Both front ends produce a TypeScript AST
that the same typed pipeline compiles:

| Stage                   | Typed (TypeScript application code)                                                                                                                                            | General (JavaScript; typed modules after fallback)                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Front end               | source modules as written                                                                                                                                                      | `eraseTypeSyntax` (`typescript/syntax/erase-types.ts`), then `lowerSourceTextModule` (`js-engine/lowering`) |
| Output of the front end | the program itself                                                                                                                                                             | TypeScript modules of `js-runtime` helper calls over `unknown` values, plus a generated typed host          |
| Shared from here        | `linkModules` → `bindModule` → `prepareNativeGlobals` → `specializeModule` → `checkClosureModule` → ts-native closure/scalar lowering → IR optimizer → AArch64 emitter → image | same                                                                                                        |

`compileTypedProgram` (`compiler/src/native/index.ts`) links every module into
one merged module before binding and checking, so a failure is attributed back
to a module through `locateSource`.

The typed checker (`typescript/src/checker/closures.ts`, `index.ts`,
`interfaces.ts`, `class-initialization.ts` and `binding/index.ts`, about 150
`UNSUPPORTED` sites) accepts only what ts-native can specialize, against a
closed set of built-in globals (`undefined`, `NaN`, `Infinity`, `Array`,
`Boolean`, `String`, `Number`, `Math`, `Map`, `Set`, four typed-array kinds,
`ArrayBuffer`, `DataView`, `TextEncoder`, `TextDecoder`, `TypeError`,
`RangeError`, `Error`, `console`) whose implementations are native-runtime strict
builtins. There is no `Error`, `Object`, `Reflect`, `Symbol`, `Promise`, `JSON`
or `RegExp` in the typed world; that is where gaps such as `new Error`,
`.message` on a caught value, `instanceof Uint8Array` and `toLowerCase` come
from. The general path instead targets a complete ECMAScript realm
(`js-runtime` intrinsics installed by the generated host).

So the split is not two back ends but two **front ends with two standard
libraries and two object models**:

- Typed values use type-directed representations: unboxed numbers and
  booleans, native strings, closed-world records with fixed layouts, typed
  lists, native Map/Set, native typed arrays, closures, and a two-word
  category/payload encoding for `unknown` and heterogeneous unions.
- General values are always the two-word encoding (`unknown`); objects are
  `js-runtime` ordinary/exotic objects (`ObjectValue` records with shapes,
  descriptors and prototypes). Resolved bindings use native frame or context
  slots. Environment records handle lookups that depend on `with`, `eval` or
  the global object.

The two-word general encoding and strings are physically shared: `js-runtime`
is itself typed TypeScript over `unknown` and `string`. Typed records, lists,
closures and Map/Set have no `js-runtime` object view.

### Where the decision is made

`compileArm64Program` first runs `compileTypedProgram`. Only when it fails and
the request carries a `GeneralLowering` (and a `start` export) does it fall
back:

1. `generalApplicationModules` collects application modules reachable from the
   entry; trusted runtime, host-bound, record-bound and service modules may not
   be imported by general code (this is the "general code cannot import
   runtime/FFI modules" gap).
2. The module the failure is attributed to seeds the general set
   (unattributed failures make the whole application general).
   `closeGeneralPartition` (`general-partition.ts`) closes it: every importer
   of a general module becomes general, because typed code consumes only typed
   values, and every typed module whose used exports cannot cross a checked
   boundary becomes general.
3. `createGeneralLowering` (`js-engine/src/program`) erases and lowers the
   general modules and generates a host whose `start` creates a realm,
   installs every intrinsic, loads, links and evaluates the module records,
   calls the start export and drains jobs.
4. The typed pipeline compiles the original modules plus the generated ones;
   retries grow the seed until it converges. The result is reported in
   `CompiledProgram.general` and `BuildRequest.onGeneralFallback`.
   `TINT_GENERAL_FALLBACK=0` (hosted fixtures) disables it.

Only `tools/hosted-fixture.ts` passes a `GeneralLowering`. The compiler CLI
(`compiler/src/cli.ts`, `project.ts`), library builds without a `start` export
and the compiler's own self-build have no fallback: there, a typed rejection is
a build failure. `@tint/compiler` cannot import `@tint/js-engine` (it depends
on the compiler), so the lowering is injected by a composition root.

### How values cross today

A typed module used by general code is presented as a synthetic module record.
`boundaryExport` admits only non-generic, non-async, non-generator functions
whose parameters and result are `number`/`string`/`boolean`/`undefined`/`null`
(or unions of them), and primitive-typed constants. Each argument is narrowed
by `checkedArgument`; a mismatch throws a TypeError. Because boundary
parameters are annotated, that TypeError is the enforced-contract behavior
below, not a deviation. Nothing crosses from general into typed code: a
typed importer of a general module is always made general.

The consequences:

- fallback is per module and contagious upward through importers;
- one rejected construct makes its whole module, and usually most of the
  application, general, losing all typed specialization there;
- typed and general code see different realms and standard libraries, so even
  primitives behave identically only because they are physically shared.

## Target architecture

### Principles

1. **One front end.** Parse → bind (the full-language binder, which already
   handles every construct, scopes, `var`, Annex B and direct eval) → collect
   type facts → lower. Annotations, inference and the checker supply facts;
   they never decide whether a program compiles. JavaScript sources are the
   case with no annotations.
2. **Every construct has a general lowering** with full ECMAScript semantics:
   the js-engine rewrite into `js-runtime` operations over two-word values.
   This is the semantic definition of the construct.
3. **Facts select specializations.** Where facts prove a representation
   (number, string, a record layout, a typed list, a closure signature), the
   ts-native lowering replaces the general form. A specialization exists only
   where it is equivalent to the general form under the proven facts.
4. **Representation follows facts, contracts and speculation.** A value whose
   type the typed world cannot model (`Promise`, a class with features
   the record planner cannot lay out, `any`, a union the encodings cannot hold)
   gets the general representation, and operations on it are general. This
   replaces checker rejections: "unsupported type" becomes "general
   representation". Annotations and inference play different roles; see
   [contracts and speculation](#contracts-and-speculation).
5. **One realm, one standard library.** Typed builtins (native Math, Map, Set,
   typed arrays, string methods) are specializations of the realm's intrinsics
   chosen when the receiver's representation is proven, not a separate
   library. Unmodelled globals resolve to realm intrinsics.
6. **Fallback is per construct.** The unit of generality is the smallest
   construct whose specialization is unavailable: an expression, a statement,
   a function (for suspension, direct eval and `arguments`), a class. The
   module fallback disappears.
7. **Untyped code does not degrade typed code.** An island or an untyped
   module changes representations only at its own edges. Typed code around
   it keeps its specializations: its explicitly typed slots stay specialized
   (foreign values are rejected at the contract, so no typed path has to
   widen), and values crossing into it are checked once at the crossing, not
   on every later use. Only open slots that an island actually writes become
   general. A design that makes typed code slower because untyped code is
   nearby is wrong.

### Contracts and speculation

A written type is a contract; an inferred type is a guess. The rule is per
slot (variable, parameter, field, element type):

- **Explicitly typed slots** carry a written annotation or declared type: a
  `let x: number` or parameter annotation, an interface or class property
  annotation, a declared record or tuple type. Assigning a value outside the
  declared type through _any_ path (typed code made unsound by a cast,
  untyped code, a JavaScript view, reflection, direct eval) throws a
  TypeError and leaves the slot unchanged. This is intended behavior, not a
  deviation from JavaScript; it applies in AOT and live/JIT compilation alike,
  and cast-free typed code needs no check because the checker proves its
  writes.
- **Open slots** have no annotation; their type comes only from inference: an
  unannotated `let y = 1` or `let y;`, an object literal `{ a: 1 }`, a class
  field initializer `x = 1`, `this.x = 1` without a declaration, an array
  literal's elements, a contextually typed callback parameter. An open slot
  accepts any value afterwards, exactly as in JavaScript. Inference never
  narrows what it may hold; TypeScript type errors that arise only from an
  inferred type are not compile errors (at most diagnostics).
- **Speculation for open slots.** The inferred or first-assigned type is the
  likely representation and selects a guarded fast path. When a value of
  another type arrives, the slot transitions to the general representation
  and execution continues: an inline-cache-like guard plus a representation
  transition, decided per slot, with no TypeError and no failure path. For a
  local or an unescaped field, the compiler sees every write and can decide
  statically (specialize when every write is proven to match, otherwise use
  the general representation); a field of an object that escapes to general
  code, views or reflection needs the runtime transition of its object's
  layout (slice 4b).

**Checked downcasts.** `x as T` where `x` is `unknown` is a checked downcast,
an explicit contract like an annotation: the value is tested at run time
against T (primitive categories, 1-byte typed arrays, the record layouts of
object types, and unions of these); a value outside T throws a TypeError, and
a passing value keeps its identity. Types without a run-time test yet (lists,
functions, object types with several layouts) are rejected at compile time.
Other `as` assertions keep their compile-time meaning (upcasts).

Today's typed checker does the opposite for open slots: it treats the
inferred type as a contract and rejects the program, which sends the module
to the general fallback. Probed on 2026-11-17: `let y = 1; y = ...` ("value
does not match its declared type"), `let y; y = 1; y = "s"` ("invalid binding
operation"), object literal field writes ("invalid property assignment"),
array literal elements (`push` of another type), contextually typed callback
parameters, `this.x = 1` without a declaration, and class field initializers
("class field requires annotation"). The slice-0 ledger pins each of these
(`open-*` constructs) and the enforced contracts (`explicit-*` constructs).

### Representation boundaries inside a function

A typed function containing a general construct (an _island_) stays one native
function. The island is the general lowering of that construct spliced inline,
so evaluation order and abrupt completion are the construct's own. Crossings
are explicit IR operations at the island's edges:

- **Reading** a typed binding inside an island boxes it at the read site
  (`toGeneral`). Primitives box without allocation (category/payload). Strings
  are shared. References use the value bridge below.
- **Writing** a typed binding from an island unboxes at the write site
  (`fromGeneral<T>`). For an explicitly typed binding this is the contract
  check: a value outside the declared type throws a TypeError and the binding
  keeps its value. For an open binding, when the checker cannot prove the
  written value has the speculated representation, the binding is given the
  general representation for its whole lifetime (all its writes are visible
  to the compiler); typed uses then read it through a cheap checked
  projection. An open write-back never fails.
- **Island results** flowing into a typed context use the same rule: a proven
  representation is projected (one tag check for primitives); otherwise the
  consumer is general.
- **Completions** (`return`, `break`, `continue`, `throw`) inside an island
  are the general lowering's completion handling, targeting the typed
  function's labels and exits. Exceptions are already one mechanism: typed
  `throw`/`catch` and `js-runtime` throws share the native unwinder; a caught
  value in typed code is general unless a fact proves otherwise.
- **Suspension** (`yield`, `await`), direct `eval`, `with` and `arguments`
  change the frame, so their unit is the enclosing function, which becomes a
  general function object with a typed calling adapter.

No snapshot or copy-back exists: islands read and write at the original program
points, so closures and aliases observe the same values in the same order.

### Integer storage for UTF-16 construction

On AArch64, `String.fromCharCode` can consume a bitwise result directly
from word-only storage. The representation analysis requires all
uses of that result to observe only its low bits. Double operands
follow the existing ToUint32 helper before the halfword store,
preserving truncation, wrapping and the zero result for non-finite
inputs. See the
[conversion-site audit](results/integer-uses-audit-v1.md).

### The value bridge

Boxing must preserve identity, so reference values need JavaScript object
views:

- **Typed records and class instances** box to a `js-runtime` exotic object
  (`createRecordView`) whose fields are live data properties over the
  record's own storage: reads see the current value, writes store through a
  checked setter, `readonly` fields refuse writes, fields cannot be deleted
  or reconfigured, and other keys are ordinary expandos. Identity is per
  record: a record type that crosses (the witness of a `view-slot` record
  binding) gets one hidden optional general field, `[[view]]`, at the end of
  its layout, holding its view after the first crossing, so `===`, WeakMap
  keys and repeated crossings agree. It is an ordinary traced field (every
  collector traces and forwards it, writes take the generational barrier,
  heap descriptors and DWARF name it); record types that never cross keep
  identical layouts and code. The slot is a strong reference: a crossing
  record keeps its JavaScript view alive as long as the record lives. That
  costs one view per crossed record (the view holds only the record and its
  accessor closures) and makes repeated crossings free; if retained views
  measurably matter, the slot can become a weak reference without changing
  the bridge. A record of the same type but another layout (an identical
  alias type) gets a fresh view per crossing until views carry a weak
  side table. A write to an explicitly typed field
  checks the declared type and throws a TypeError on a foreign value. A write
  to an open field never throws: until slice 4b provides layout transitions,
  a record that can reach a view gives its open fields the general
  representation (a closed-world decision); afterwards they are speculated
  and transition on a foreign write.
- **Typed lists, Map, Set and typed arrays** box to Array/Map/Set/TypedArray
  exotics over the same storage (typed arrays already back `js-runtime` byte
  storage with native `Uint8Array`, so views share bytes).
- **Closures** box to callable objects whose `[[Call]]` boxes arguments and
  projects the result; a typed function receiving a general callable calls it
  through `callObjectValue`.
- **Unboxing** a general value to a proven reference representation succeeds
  when it is a view of a compatible layout (the view's record is returned) and
  otherwise leaves the consumer general (principle 4), or, when the consumer
  is an explicitly typed slot, throws its contract TypeError.

The bridge is also what lets general code import typed, trusted runtime and
FFI modules: their exports cross as boxed values with typed adapters instead
of being refused.

### Numeric calls and loops in general code

General lowering can give a local source closure a native entry when its
result uses only numeric literals, parameters and primitive arithmetic. A
fixed-arity call reads the callee before evaluating its arguments. An immutable
binding proves the target. A writable binding compares the already-read
callee with the original closure. The native entry receives primitive numbers
in registers. It cannot observe the receiver, arguments, calling realm or
Script identity. If the callee or argument checks fail, the same evaluated
operands enter the general call path.

An AOT function whose loops and returns operate solely on numeric locals
and immutable numeric leaves can check its incoming operands once. The
success branch runs through the ordinary scalar pipeline with unboxed local
values. The proof excludes dynamic bindings, coercion hooks and escaping
locals. Non-number operands enter the original function body before any
source initialization or loop work. These internal types are guarded
representations for unannotated code. Written annotations still use the
source contract rules.

### Native errors and narrowing (slice 4a)

The typed path accepts the `Error` annotation and allocates a plain Error
descriptor only when constructing one. `instanceof Error` accepts all three
native kinds. Subtype checks still test the specific descriptor. Successful
guards narrow caught values without changing storage, and false branches
filter known union alternatives while retaining unrepresentable complements
such as unknown minus Error.

A native record with string `name` and `message` and an optional string
`stack` can satisfy a structural `Error` contract while preserving its
identity. Only native errors pass the native `instanceof` test.

Native `message` defaults to the empty string, `name` uses the intrinsic
kind, and `stack` is undefined. The native constructor diagnoses Error
options, whose getters and cause semantics belong to the realm constructor.

### Mixed native error views (slice 4a, B3)

Mixed images with typed boundaries use explicit record layouts for all three
native error kinds. The layouts carry a message, a presence flag and the
traced slice 2b `[[view]]` field. The generated host publishes an ordinary
error on first exposure, using the program realm's intrinsic prototype and
error brand. An omitted or undefined message inherits the prototype's
empty message. An explicit string, including the empty string, is an own
non-enumerable property.

The boundary reuses the cached view on returns, thrown values and record
fields. A reciprocal identity lets a view round-trip through a typed
argument. Typed property reads and intrinsic error predicates on a view
dispatch through realm operations supplied by the adapter. Structural Error
contracts check the realm object's members in order at the boundary.

The view's stack is captured at first exposure. Native-only construction
keeps the private native descriptors and an undefined stack. See the
[error view design](design-4a-narrowing-errors.md#native-errors-and-their-realm-views).

### Realm constructors and typed-array flow (slice 4a, B5)

The right operand's checked call, construct or `[Symbol.hasInstance]`
signature supplies the static refinement. Constructor aliases and properties
carry that signature. A guard updates facts for the original binding or
stable property path without changing its declared storage. The false branch
keeps values whose type may still occur outside the checked instance type.

The constructor table is generated from the workspace's pinned TypeScript
`lib.esnext.d.ts` and its transitive declarations. It records the realm
installer, library call and construct overloads, instance type and members.
Typed global reads and the general host share installation state, so later
reads see the current global binding. Library-backed instances use realm
Get and Call when the typed bridge can represent the library signature.

In realm-capable code, constructor reads use the shared global object and
the predicate uses the same `instanceOfValue` operation as general code.
The operation orders both operands and the hook lookup, uses actual
prototypes, and propagates failures from accessors, hooks and proxies. The
existing native error tests remain available in typed-only programs.

Narrowed typed-array values keep their general carrier. Each indexed read,
write, metadata read and supported method tests the native array header
before using the native operation. Realm arrays and prototype imitations use
ordinary realm property lookup, assignment and method calls. A successful
guard is independent of the brand checks inside typed-array methods.

A native typed-array ABI still requires matching native storage. The
projection checks the element layout and passes the same reference. A realm
value fails with TypeError and the message
`Passing a realm typed array to a native typed-array parameter requires the slice 2b buffer view`.

Evidence comes from `tools/build-typed-realm-instanceof-fixture.ts`, its Node
reference, and the two native projection fixtures. The mixed fixture uses a
general producer to supply objects to a trusted typed guard and asserts the
module partition.

### Coded Node errors and literal-key guards (slice 4a, B6)

A literal-key `in` test on a known object can introduce a property of type
`unknown` on the true branch. Primitive `typeof` and value comparisons
refine that fact. Each property read executes in source order, including
when a getter or proxy returns a different value on a repeated read.
In mixed code, an uncertain read and inferred locals that receive it keep
the general representation. Property reads, operators and template
conversions use the program realm when they consume those values. A local
snapshot such as `const code = e.code` keeps the value from that one read.
A written slot or parameter checks the value at the contract boundary.

Native crypto and zlib failures use dedicated records for coded Error and
RangeError. The zlib status is carried in `errno` and translated to its
`Z_*` code. The native SystemError record used by `os.userInfo` stores
platform details in `info` and reads `errno` and `syscall` from that record.
These native failures do not require a realm.

On first exposure, B3's traced slot caches a branded realm view with
Node's public own descriptors in producer order. The SystemError prototype
is shared within the realm. Its `errno` and `syscall` accessors reference
the same writable details object returned by its read-only `info` property.
Subsequent membership checks and reads use ordinary realm HasProperty and
Get, including inherited properties and proxy traps.

The focused evidence is `coded-error-guard`,
`tools/build-typed-node-errors-fixture.ts` and its Node 24.12.0 reference.
The typed profile requires a literal key for fixed-layout objects. Typed
dynamic keys remain available on realm-backed indexed objects.

### Typed BigInt (slice 4a)

A typed `bigint` is a reference to js-runtime's `BigIntValue` record, the
value general code already creates, so a BigInt crosses to and from
`unknown` without conversion: general values carry BigInts as objects whose
descriptor is that record's (`viewBigIntValue` tests it). The checker has a
`bigint` type kind; lowering calls the helpers in
`native-runtime/src/values/bigint.ts` (the `bigint` runtime namespace),
validated like the primitive runtime: every reference parameter and result
must be exactly `BigIntValue`. The helpers link only when an expression or
binding of the program mentions `bigint`; `bigint` is a primitive of every
checked type table, so the table itself says nothing.

- Arithmetic and bitwise operators need two BigInts (mixing with Number is a
  type error, as in TypeScript; `>>>` and unary `+` are rejected). RangeErrors
  follow V8's messages, except V8's malformed one for a negative exponent.
- Relational operators are exact, also against a Number, and NaN is
  unordered. `===`/`==` compare values, never references; a possibly absent
  BigInt may be compared only with `undefined`/`null`.
- Truthiness, `typeof`, `String`, templates and concatenation,
  `Number(bigint)`, `BigInt(number | boolean)`, `bigint | undefined` and
  BigInt list elements are supported.
- `typeof` of a general value tests the `BigIntValue` descriptor before
  `general-kind` (which reports `"object"` for it); `typeof x === "bigint"`
  narrows `unknown`, and `x as bigint` is a checked downcast through the
  same record test. The record is found through the `literal` helper's
  result type whenever the runtime is linked, even in programs that create
  no BigInt themselves.

Still rejected explicitly: `BigInt(string)` (invalid text throws a
SyntaxError, which typed code gains with realm errors in slice 4), and
BigInts as Set elements or Map keys (SameValueZero compares them by value;
the collection helpers compare references). Evidence:
`tools/build-typed-bigint-fixture.ts` (37 checks plus checked-downcast
failures, `TINT_GENERAL_FALLBACK=0`) and its Node reference
`tools/typed-bigint-fixture.test.ts`.

### Callable classification (slice 4a)

A typed `typeof` over a general value in a mixed program uses the same
classifier as general source code. It checks the object descriptor and
reads the internal call capability. Ordinary functions, bound functions,
classes and callable proxies, including revoked ones, report `"function"`.
The check does not look up any property or invoke user code. Symbol and
BigInt are recognized through their existing descriptor views.

The general host supplies the classifier only in a mixed build. Engine
internals continue to use raw `typeof` when testing representations, and
the raw path still recognizes native closures. The classifier itself takes
no realm pointer. `tools/build-typed-general-typeof-fixture.ts` exercises
the native path with general fallback disabled, and
`tools/build-mixed-general-typeof-fixture.ts` checks the same operation
on realm values across a trusted import.

See the [slice 4a design](design-4a-narrowing-errors.md) for callable
narrowing and the remaining slice 2b closure and typed-array projections.

### General direct calls (slice 4a, B4)

A `typeof value === "function"` guard on `unknown` supplies a callable flow
fact with general storage. The fact accepts arbitrary arguments and keeps a
general result, which an annotated consumer checks through the existing
downcast path. A guarded concrete signature keeps its parameter and result
contracts. Reassignment and calls use the existing flow invalidation.

After evaluating the callee and arguments, a mixed call dispatches through
the realm's ordinary `[[Call]]` implementation. A direct value call supplies
`undefined` as its receiver. A property call supplies the evaluated reference
base. The realm handles classes and delivers returned and thrown objects with
their original identity. Native closures passed as `Function` need a callable view. Slice 2b
projects unary numeric closures. Lowering diagnoses other known native
closure shapes. When only run time reveals an unprojected native closure,
the call throws a `TypeError` after evaluating its arguments.

The [B4 ledger](results/unified-pipeline-ledger-slice4a-b4-main-34187f4a8-dev-lldb-v1.json)
covers 74 constructs. Both new typed forms stay typed, both untyped forms
pass, and all 144 forms shared with the C2 and B3 baseline retain their paths
and outcomes.

### Binding slots in general lowering

The binder identifies references to parameters, locals, class names and
module bindings before code generation. General lowering gives uncaptured
locals native slots and uses the shared closure compiler for retained
values. A lexical declaration starts with an uninitialized flag until its
initializer finishes. Slot reads and writes enforce the temporal dead zone
until initialization dominates the reference.

Direct eval and with preserve the named heap cells visible from their
evaluation scopes. Mapped arguments continue to share cells with aliased
parameters. Closures and suspension steps retain their live bindings.
A closure can copy a general value after initialization when later source
writes cannot change it. Earlier closures retain the shared cell and
initialization flag. The native record layout traces both forms.

Classic loop headers carry fixed iteration fields when a closure can
observe a distinct mutable binding. An initializer closure retains the
pre-iteration binding. Each iteration creates its own retained fields
before the update, including after a continue that runs a finally block.
For-in and for-of retain the iterable's TDZ and initialize fresh slots for
the body. Annex B block functions update the variable binding when the block
declaration is evaluated.

Module and Script lexical references use the cells established by
declaration instantiation. Linked import aliases keep the exporting cell,
so updates and temporal dead zones remain visible through the alias.
Global object names use per-site caches when resolution reaches the
global record. Property changes and global lexical declarations
invalidate the cached property cell.

General addition and less-than can test both evaluated operands for the
number category. The numeric branch uses the shared native scalar
operations. Other operand pairs enter the general arithmetic helper with
the original values in evaluation order.

The [paired candidate results](results/general-call-benchmark-darwin-arm64-206530edd-candidates.md)
record the earlier slot and arithmetic experiments.

### Live native views (slice 2b)

An erased dynamic-key property can hold a canonical realm view of an existing
native value. The checker requests a view for explicitly typed numeric lists,
fixed records with primitive fields and unary numeric closures. The runtime is
linked only when a checked use requires it. Weak ephemerons key views on the
original native value, and a reachable view keeps that value alive.

The array view reads and updates the list backend's length, elements and
presence bits. Record views use generated field accessors over the source
record and check a write before publishing it. Repeated projection uses the
same view. The unary callable carries its original native entry and uses
ordinary realm call dispatch. A realm-origin callable projected through the
same signature gets a canonical native entry with a reciprocal realm view.
Checked numeric realm-array `map` can use a native unary callback.

`projectArrayBufferView` reads the TypedArray or DataView internal slot. It
returns the backing and the exact byte range for ordinary and shared storage.
Attached views outside the current buffer bounds expose a zero-length range
at offset zero. A detached result has its own status. The backing is borrowed
and must be reacquired after operations that can resize or detach it.

The gap table tracks remaining signatures, collection layouts and escaping
typed-array ABI crossings. A raw array header would retain stale storage
after a realm resize or detach. The byte-range interface supplies the
projection needed by a scoped lending consumer.

### Captured bindings across function fallback (slice 3)

When a nested function needs the realm, an eligible arithmetic sibling can
keep a typed entry. Its source-level wrapper keeps the original callable
identity. Bridge reads and writes resolve the original captured binding in
that activation, and the typed entry projects numeric reads before operating
on them. The lexical environment remains authoritative for all callers,
including escaped closures and separate loop iterations.

Written primitive binding annotations guard initialization and subsequent
writes in the validated general path. A write evaluates its right-hand side
before testing the binding's initialization and contract. Inferred bindings
stay open. A realm record with a supported written shape installs its
property contract over the actual object, covering writes through aliases.

The bridge selects arithmetic siblings with annotated number captures.
Other sibling signatures and typed-owned environments need more capture
layouts. Direct eval remains blocked in this composition with
`direct eval requires the hosted evaluator and shared binding contracts`.

### Typed rest parameters and void callbacks (slice 4a)

A rest signature stores one final array parameter and a rest flag. The minimum
arity counts only the required leading parameters. The checker contextually
checks each trailing argument against the array element type. A spread can
supply elements once the call reaches the rest position, using a typed list or
supported numeric typed array. Lowering evaluates the callee and leading
arguments, then appends each trailing value or spread element to a fresh list
in source order. Direct and indirect calls use the same packed ABI. Defaults
still run in the callee when a leading argument is omitted or undefined.

Rest and fixed signatures cannot be assigned to each other, and two rest
signatures must have the same parameter count. Those calls would otherwise
disagree about which argument holds the packed array. Tuple rest remains
outside the typed rest calling convention. Spreading a hole into a rest list whose
element contract excludes undefined throws a TypeError, following the typed
list iteration contract.

A value-returning function can satisfy a void callback signature. An
unannotated contextual callback retains its inferred result, and a
void-typed indirect call reads only the completion status from the common
completion buffer. When checking finds a value flow into a void signature,
lowering marks those calls in IR. The marks let a local void witness accept
a local identity with the same physical parameter layout in addition to its
exact signature identity. The function
object and callee ABI stay unchanged. Managed signature contracts at service
boundaries still require exact identities.

The native fixtures and their Node references share the source in
`tools/typed-rest-void-fixture-source.ts`.

### Typed dynamic-key objects (slice 4a, C1)

String index signatures and `Record<string, T>` use the program realm's
ordinary objects. The checked type retains its index and fixed property types
while values cross in the existing general representation. Finite
`Record<"a" | "b", T>` values can keep their fixed layout for closed field
access. A dynamic object and its aliases share descriptor and prototype storage
with general code.

An explicit dynamic annotation installs a property contract in that storage.
Admission validates own data descriptors before publishing any contract, even
for nested objects. Direct assignment and reflective definition reach the
same descriptor check. The runtime rejects covered accessors, protects required
fields from deletion, and invalidates cached property cells on enrollment.
Unannotated computed literals have open storage.

The typed path uses the realm's existing computed-property conversion,
membership, deletion, enumeration and spread operations. The general host and
typed runtime obtain the same realm through the module instance. A program with
no dynamic usage can prune the dynamic runtime namespace before linking.

C1 accepts primitive, BigInt, unknown and nested dynamic-object payloads.
Native lists and fixed records require slice 2b list/record views or C2
function-local realm allocation. In particular, `node:os.networkInterfaces()`
still needs C2. See the [design and implementation status](design-4a-dynamic-key-objects.md).
The [C1 gap ledger](results/unified-pipeline-ledger-slice4a-dynamic-objects-c1-final-gate.json)
records 130 variants and compares them with the slice 4a BigInt baseline.

#### Source discovery for the compiler's own build

The native CLI and Node bootstrap start with the compiler's ordinary project
roots. Successful typed compilation uses that graph alone. When the checker
reports that typed operations require the program realm, the source loader
resolves a fresh graph with the dynamic-object provider as a root. The same
realm helpers and record views then take part in the typed retry. An ordinary
import can still reach any of those sources through its dependencies.

### Function-local realm allocation (slice 4a, C2)

Array and data-record literals stored in dynamic-key objects can begin life as
realm values. The checker follows the literals through single-initializer local
bindings, alias reads, indexed access, identity comparisons and insertion into
a realm array. It changes a component's representation only when a dynamic
storage operation demands it and every use is modeled. C3 extends the proof
to direct calls, captures, assignments, typed fields and joins. Aggregates
outside a proven allocation flow retain their native layouts. Storing one of
those native values still reports
`UNSUPPORTED: native list values in dynamic-key objects need slice 2b list/record views`
or the corresponding `native record` diagnostic.

Selected literals allocate in the shared realm and keep identity when obtained
through either a local alias or a property read. Typed indexing, length,
`push`, and record field access use realm operations. Typed `push` gets the
live method from the receiver before evaluating its arguments. Written array
element and record field types use the C1 storage contract. When an Array
enrolls, the runtime validates its existing own indices before transferring
its packed contents to descriptor storage, where subsequent writes use the
same guard as ordinary objects. An inferred literal remains open unless it
enters explicitly contracted storage.

The `node:os` consumer uses `Object.hasOwn` to group entries and
`Object.defineProperty` with data descriptors for the first entry of each
interface. Its result has the realm Object prototype, real Arrays for groups,
and own enumerable, writable, configurable group properties. IPv6 entries
add an own `scopeid` field. Synthetic `__proto__` and `constructor` names
produce normal groups.

### Realm reference operations and value flow (slice 4a, C3)

Compound and logical assignment preserve the evaluated receiver and key.
The realm performs one Get before evaluating the right operand, and one
Set when the operator writes. Prefix and postfix updates share the
JavaScript ToNumeric operation and return the updated or converted old
value. The ordinary Set path enforces written property contracts.

Typed realm array methods look up the live method and call it with the
array as receiver. This covers mutators such as `unshift`, `splice`,
`fill` and `reverse`, and reads and copies such as `at`, `includes`,
`join` and `slice`. Existing array property guards validate writes,
including writes performed by a realm method through a wider alias.

Realm allocation now follows a closed set of local flows through direct
calls and their returns, captured cells, typed fields and branch joins.
Every allocation in a selected component starts in the realm, so the
original objects retain identity through those uses. Native aggregates
whose storage or callers are outside that component still require
slice 2b views.

A consumed `void` call result keeps its TypeScript checking restrictions
and carries the actual value as a general value. An indirect call selects
the callee's checked native signature before reading its result. Direct
forwarding propagates that result even through a function declared to
return `void`. Unused results retain the result-discarding ABI path.

A contextual `number[]` literal uses the numeric iteration element type
for a numeric list spread. Inferred spread results continue to include
`undefined` for possible holes. Elements and spread sources evaluate in
source order, and spreading a hole creates an explicit `undefined`
element. The typed fixture includes the original x64 stack-map list shape.

### Native binding patterns (slice 4a)

The closure checker projects the input's property and element types into an
ordered binding plan. Local declarations, parameters, and typed `for…of`
heads initialize the same checked leaf slots. Assignment plans reuse normal
assignment lowering, including reference evaluation before the projected
value and default. The assignment expression yields the original input.
Parameter patterns run at their position in the prologue, so subsequent
parameter defaults can refer to the initialized bindings.

Fixed-record reads reuse native member and index access. Rest uses the
record spread planner and requires known own enumerable fields. Native
lists and numeric typed arrays step their indexed storage because these
representations expose no custom iterator. The plan remembers exhaustion
across defaults, skips elisions, and creates a fresh list for array rest.
Defaults test only for `undefined`. An indexed read which can go past the
end includes `undefined` in its checked type.

Module instances initialize whole patterns in source order, and the linker
publishes each exported leaf. Realm object patterns and catch patterns
with an explicit `any` annotation check object coercibility and use realm
Get. Computed keys are converted before assignment target evaluation.
Realm rest passes those canonical keys to CopyDataProperties and creates
an ordinary realm object. Local native values thrown directly into a
patterned catch can select realm storage when local representation analysis
proves the conversion safe.

Realm strings, realm arrays and `Iterable<T>` sources use the realm
iterator helpers. Each nested iterator region closes on normal early exit
or abrupt completion. The runtime determines whether the cursor is done
and preserves a pending throw when IteratorClose also throws. Inferred
mutable union leaves with writes use general storage. Flow facts allow
specialized reads after proven writes. An explicit annotation retains the
binding's projected type contract.

The typed hosted fixture and the Node references live in
`tools/typed-binding-patterns-fixture-source.ts`. A fixture provider supplies
realm getters, symbol and non-enumerable properties, and custom iterators
to the same consumer used by the Node reference.
The [binding patterns ledger](results/unified-pipeline-ledger-slice4a-typed-binding-patterns-v4.json)
records 146 forms. The typed `destructuring` construct now stays typed, and
both forms of `destructuring-entry-points` pass.

### Isolate checkpoints and timed turns

The [event loop design](design-event-loop.md) describes the host policy for
typed and general callbacks. The portable
[turn driver](../packages/native-runtime/src/event-loop.ts) owns the timer heap,
phase queues and liveness counts. Its host supplies monotonic time, readiness
polling and the isolate's existing microtask checkpoint. A callback entry
services ticks before microtasks, while ESM entry finishes the current
microtask batch first.

The [typed hosted fixture](../tools/build-event-loop-fixture.ts) exercises the
driver without general fallback. [Node oracle traces](../tools/event-loop-oracle.test.ts)
pin the public ordering that the application hosts need to reproduce.

The [Darwin reactor](../packages/platform/src/darwin/reactor.ts) uses kqueue
with an `EVFILT_USER` wake. The
[Linux reactor](../packages/platform/src/linux/reactor.ts) uses epoll with
eventfd. [The reactor fixture](../tools/build-event-loop-reactor-fixture.ts)
exercises a pre-posted wake, a cross-thread wake and a nonblocking pipe
through the same phases on Darwin arm64, Linux arm64 and Linux x86-64.

The Node personality of the general AOT host can
[install scheduling globals](../packages/native-runtime/src/node/event-loop-globals.ts)
and drive their callbacks after module evaluation. The clock and reactor are
explicit capabilities. Immediate-only and synchronous programs can complete
without opening a reactor. The
[blocking pool](../packages/native-runtime/src/blocking-pool.ts) starts a
bounded set of helpers on its first submission. The
[pool fixture](../tools/build-event-loop-blocking-pool-fixture.ts) exercises
file reads, capacity enforcement and completion turns through the control wake.

Threaded images can opt in to the
[worker exit record ABI](../packages/abi/src/host.ts). A tagged startup
argument identifies a raw record. After managed teardown, the startup thunk
publishes the status and wakes the owner's nonblocking pipe. The
[worker exit fixture](../tools/build-worker-exit-fixture.ts) launches a detached
isolate from the same image and observes completion without joining it.
The [POSIX worker host](../packages/platform/src/workers.ts) supplies
nonblocking close-on-exec pipes and detached thread ownership on both backends.
The [native lifecycle](../packages/native-runtime/src/worker-lifecycle.ts)
uses that record for exit and error delivery, and holds the owner alive
through its referenced pipe watcher. A worker stop request updates its shared
record and signals a separate nonblocking pipe. The worker checks the request
between turns and after reactor polling, and reports status 1 through the same
teardown path. If a worker is parked on a registered Atomics waiter, the stop
request also wakes that ticket. The worker consumes its ticket before exiting.
Worker realms that attach shared memory with the worker wait control propagate
the interruption through the engine-abort boundary in `Atomics.wait`.
Hosted builds can designate worker application modules for interruption at
managed allocation and call safepoints. The native backends read the worker's
stop word and propagate a reserved completion through managed frames. Worker
application handlers bypass that completion. Trusted runtime handlers and C
callback boundaries use their existing cleanup paths. Worker-capable builds
keep the managed module boundaries through optimization so runtime helpers
retain that distinction. Allocation-free, call-free loops remain the gap
documented in the [event loop design](design-event-loop.md).

### What happens to each front end

- js-engine lowering becomes a library of construct lowerings callable for a
  subtree, with a binding resolver hook: names bound outside the island
  resolve to typed bindings through the bridge, not to environment records.
  Whole-module JavaScript is the degenerate case where everything is general.
- The typed checker becomes a fact provider: rejections become "general
  representation" or "island" decisions with the reason recorded.
- ts-native keeps its specialized lowerings. The [HIR migration](progressive-lowering.md#migration)
  later expresses each construct as an op with a general pattern (the island
  lowering) and higher-benefit typed patterns.

## Migration slices

Each slice is independently mergeable, removes a class of typed-only gaps or
contagion, and leaves the module fallback as the last resort until slice 6
removes it.

| #   | Slice                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Removes                                                                                                                                                                                  | Depends on |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 0   | **Ledger and guardrails.** A corpus of construct fixtures (`tools/unified-pipeline/corpus.ts`), each in typed and untyped form, including open-slot and enforced-contract constructs; the ledger (`tools/unified-pipeline/ledger.ts`) records which forms stay typed, which fall back and which fail natively, and compares against a baseline. `requireTyped` makes the compiler self-build, frozen workloads and feature-bench kernels fail instead of falling back.                                                                                                        | Silent typed-perf loss; establishes the gap count this work drives to 0.                                                                                                                 | —          |
| 1   | **Program realm and module pruning.** The compiler skips modules reached only through unused re-exports when their bodies are unobservable (barrel entrypoints no longer pull every implementation into an image; observable modules still run in order). The general host owns one lazily created program realm (`programRealm()`, for the host now and islands later) and installs only the intrinsic groups the program can reach.                                                                                                                                         | Barrel retention; realm installers for kinds the program cannot create.                                                                                                                  | 0          |
| 1c  | **Fine-grained intrinsic groups.** Split the coarse `js-runtime` installers (primitives also install Date, JSON, BigInt and locale formatting; arrays include `fromAsync`) so a program links only the intrinsics it names; needed before islands, whose realm otherwise costs a typed program about 27 MB.                                                                                                                                                                                                                                                                   | The fixed realm core.                                                                                                                                                                    | 1          |
| 2a  | **Trusted modules and identity crossings.** General code imports trusted runtime modules; they stay typed behind checked entries. Checked boundaries accept `unknown` parameters, results and constants, which cross unchanged (typed `unknown` and general values share one representation), so JavaScript values keep their identity. A trusted export whose type cannot cross is reported, never made general.                                                                                                                                                             | "General code cannot import the trusted module"; `node:ffi` need 1.                                                                                                                      | 1          |
| 2b  | **Complete for the scoped native views.** Numeric lists, primitive-field records, unary numeric closures and generic ArrayBufferView byte ranges cross the typed and general boundary. The gap table assigns broader ABI shapes and lifecycle work.                                                                                                                                                                                                                                                                                                                           | Upward contagion; record-shaped Node API results.                                                                                                                                        | 2a         |
| 4a  | **Typed code over general values (the `node:ffi` needs).** Typed code operates on `unknown` values through the program realm: typed BigInt (from and to two 32-bit halves, comparison, `typeof`), objects with dynamic keys (index signatures and `Record<string, T>` as general objects: create with computed keys, enumerate own keys, read by computed key), `typeof`/`instanceof` narrowing of general values including realm constructors and callables, realm `Error` and errors with `code`, and rest parameters in typed functions. **Complete.** Delivered before 3. | `node:ffi` needs 2 to 6; the `KNOWN DEFECT` workarounds in `node/{crypto,zlib,os}.ts`.                                                                                                   | 2a         |
| 3   | **Complete for the hosted fallback stream.** Pinned source validation rejects type errors. Replay selects source-backed units, ordinary calls and class and suspended-function evaluation use the selected entries, and nested numeric siblings share lexical cells with general closures. The gap table assigns broader boundary shapes and direct eval.                                                                                                                                                                                                                     | Module-wide loss for generators, async, `var`, inheritance, accessors, private elements, decorators, `arguments`, direct eval.                                                           | 2          |
| 4   | **General representation for unmodelled types; open slots.** The checker types unmodelled globals and types as general instead of rejecting; their operations are general; unmodelled globals resolve to realm intrinsics. Native builtins become specializations selected by proven receivers. Inferred types become speculation: open locals, parameters and unescaped fields whose writes are not all proven take the general representation; explicit annotations become checked contracts on every write path.                                                           | `new Error`, `.message`, `instanceof` on realm constructors, missing Math/String/DataView members, `Reflect`, `JSON`, `Object`, `Symbol`, `Promise`; inferred types acting as contracts. | 1, 2       |
| 4b  | **Open-field transitions.** Speculated open fields of escaping records keep their specialized representation behind guards and transition the object's layout to general storage on a foreign write (stable identity with replaceable backing or general slots), without a failure path. Coordinated with the GC/layout owner.                                                                                                                                                                                                                                                | General storage for every open field of an escaping record.                                                                                                                              | 2, 4       |
| 5   | **Expression/statement islands.** Remaining checker rejections become islands with the boundary rules above.                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Destructuring, spread, object spread, optional/computed members and the remaining `UNSUPPORTED` sites inside otherwise typed functions.                                                  | 2, 4       |
| 6   | **One entry.** JavaScript modules and Scripts enter the same front end with no facts (everything general) instead of the separate module fallback; `closeGeneralPartition` and the retry loop are deleted. The compiler CLI composes the general lowering, so native builds of untyped code work outside hosted fixtures.                                                                                                                                                                                                                                                     | The module fallback; the CLI gap.                                                                                                                                                        | 3, 5       |
| 7   | **Compiler sources.** The self-build may use any construct; an island report lists general units in compiler sources, and a self-build gate fails on new islands in measured hot paths. Then the HIR migration replaces island splicing with general patterns.                                                                                                                                                                                                                                                                                                                | The compiler-source language restriction.                                                                                                                                                | 6          |

Order (agreed 2026-11-18): 0, 1, 2a, 2b, 4a, 3, the rest of 4 and 4b, 1c,
5, 6, 7. Slice 4a moves ahead of 3 because `node:ffi` and the Node API modules
depend on it.

Orthogonal, schedulable at any point after slice 0: binder-resolved slots for
general code whose scopes cannot be observed dynamically (no direct eval or
`with`), replacing name-based `resolveBinding` per identifier. Untyped code
is only competitive once its locals are slots.

### SysV leaf FFI

Linux x86-64 uses the same foreign binding declarations, C layouts and leaf
`c-call` and `c-memory` IR as arm64. Its emitter assigns System V register
and stack locations and executes the shared leaf-call contract. Public
`foreignFunction` and wrappers that allocate managed records use the
x86-64 managed runtime. The target rejects callback signatures
pending F2. See [Linux x86-64 FFI](native-ffi.md#linux-x86-64).

### Known typed-only gaps and the slice that removes them

FFI phase 1 marks its workarounds `KNOWN DEFECT` (see the known-defects table
in `docs/native-ffi.md`); each is removed when its slice lands. Constructs in
the ledger corpus reproduce the ones expressible in a single application.

| Gap                                                                                                                                                                                                                                                                                                                                                    | Ledger construct                                                                                        | Removed by                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| (Removed by 2a) General code cannot import trusted runtime/FFI modules                                                                                                                                                                                                                                                                                 | (needs runtime modules)                                                                                 | 2                                        |
| Class fallback covers hosted evaluation of top-level classes. Direct native module-instance class lowering still needs scoped construction and class ABI support.                                                                                                                                                                                      | `class-basic`                                                                                           | Native class ABI                         |
| Direct eval in a checked hosted program requires an evaluator and shared binding contracts.                                                                                                                                                                                                                                                            | `explicit-binding-contract`                                                                             | Eval host composition                    |
| Nested arithmetic siblings share checked numeric bindings with general closures. Other signatures and typed-owned capture layouts require a broader cell projection.                                                                                                                                                                                   | `nested-shared-captures`                                                                                | Capture layout generalization            |
| (Removed by 4a: native errors) `new Error` and guarded reads of caught native errors                                                                                                                                                                                                                                                                   | `errors`, `caught-error-reads`, `native-error-flow`                                                     | 4a                                       |
| (Removed by 4a B5) Typed `instanceof Uint8Array`                                                                                                                                                                                                                                                                                                       | `typed-arrays`                                                                                          | 4a                                       |
| `stack` of a native error exposed to realm code names the frames at first exposure, not at creation (creation-site capture is deferred to native stack capture; needs allocation-time frame capture without realm access)                                                                                                                              | `exposed-native-error`                                                                                  | Native stack capture                     |
| Native Error options and stack capture                                                                                                                                                                                                                                                                                                                 | `Error options (cause) require the realm Error constructor`. Native `stack` is undefined.               | Realm constructor / native stack capture |
| `toLowerCase` and other unlisted String methods; `Math.pow`/`log2`/`fround`; `JSON`                                                                                                                                                                                                                                                                    | `string-methods`, `math`, `json`                                                                        | 4                                        |
| (Removed by 2b: checked downcasts) `x as Uint8Array` from a general value                                                                                                                                                                                                                                                                              | `general-value-casts`                                                                                   | 2 (projection), 4                        |
| Typed-array views over another buffer                                                                                                                                                                                                                                                                                                                  | `typed-array-buffer-views`                                                                              | 4                                        |
| Forward references to unannotated module constants can use hosted fallback with the original diagnostic location. Native specialization requires module binding inference.                                                                                                                                                                             | `forward-inferred-const`                                                                                | Open module binding inference            |
| (Removed by 4a) Typed rest parameters and spreads in the rest position                                                                                                                                                                                                                                                                                 | `rest-default-parameters`, `rest-spread`                                                                | 4a                                       |
| (Removed by 4a) Value-returning functions rejected in void callback slots                                                                                                                                                                                                                                                                              | `void-callbacks`                                                                                        | 4a                                       |
| (Removed by 4a C3) Consuming the value returned through a void-typed callback                                                                                                                                                                                                                                                                          | `void-callback-result`                                                                                  | 4a C3                                    |
| Native aggregate layouts outside slice 2b’s numeric lists and primitive-field records still need live views. Patterned catch and arbitrary ABI escapes need a checked reverse projection.                                                                                                                                                              | Binding pattern fixtures, `dynamic-object-aggregate-flow`                                               | Aggregate view layouts and projections   |
| Typed source construction of realm getters and custom symbol methods needs broader accessor and symbol support. Native Set and Map operands cannot use iterable binding patterns outside the Map-entry loop path.                                                                                                                                      | Binding pattern fixtures, `iterator-protocol`                                                           | Realm views and symbols                  |
| Closed native records require known own enumerable fields for rest. `typed object rest requires known own enumerable fields` identifies layouts that cannot use the record path.                                                                                                                                                                       | `destructuring`                                                                                         | Native record views                      |
| Defaults in empty sources use explicit context or a context inferred from simple literal defaults. More complex inferred defaults still require explicit typing.                                                                                                                                                                                       | Binding pattern fixtures                                                                                | Contextual checking                      |
| Inferred leaves backed by general storage need narrowing for specialized operations after an uncertain join.                                                                                                                                                                                                                                           | Binding pattern fixtures                                                                                | Open-slot flow                           |
| Module exports provide linked value bindings. Direct compiled-image export selection requires a concrete function.                                                                                                                                                                                                                                     | Binding pattern fixtures                                                                                | Native value export ABI                  |
| Tuple annotations parse. Typed lowering supports `[string, T]` entry pairs. Other tuple shapes need lowering, and `implements` clauses still fail to parse.                                                                                                                                                                                            | `tuple-types`, `spread`, `iterator-protocol`                                                            | tuple lowering, parser fix               |
| Nested type declarations; ternary over union discriminants in an object literal                                                                                                                                                                                                                                                                        | `nested-type-declarations`, `union-object-ternary`                                                      | 5                                        |
| `for (const x of list)` followed by a property read of `x` (in runtime modules)                                                                                                                                                                                                                                                                        | `for-of-record-reads`                                                                                   | 5                                        |
| (Removed by 4a: typed BigInt) Typed BigInt values (blocks FFI pointer/u64 values crossing into general code as BigInt)                                                                                                                                                                                                                                 | `bigint`                                                                                                | 4                                        |
| (Removed by 4a B6) Node API errors without `code` or `errno` (zlib, crypto)                                                                                                                                                                                                                                                                            | (runtime modules)                                                                                       | 4                                        |
| Top-level statements in typed modules ("module statement is outside the declaration checking slice")                                                                                                                                                                                                                                                   | `module-statements`                                                                                     | 5                                        |
| (Removed by slice 3 hosted validation) A genuine source type error confirmed by TypeScript 6.0.3 fails before fallback.                                                                                                                                                                                                                                | `typed-array-index`                                                                                     | Slice 3 source validation                |
| No per-program compiler options                                                                                                                                                                                                                                                                                                                        | `typed-array-index-unchecked`                                                                           | not yet scheduled                        |
| C struct views (`Ptr<Interface>` member access, FFI phase 2b) are typed-only; untyped code needs a real object whose accessor properties keep `v.member`'s meaning                                                                                                                                                                                     | (FFI view modules)                                                                                      | 2                                        |
| Map iteration in typed code (`for (const [k, v] of map)`, `map.keys()`: only get/has/set/delete/clear are typed)                                                                                                                                                                                                                                       | `map-set`                                                                                               | 4                                        |
| (Implemented in 4a C1 for indexed objects) Typed computed keys, ordinary reads and writes, `in`, `delete`, own enumeration, `for…in` and spread                                                                                                                                                                                                        | `dynamic-object-*`, `explicit-dynamic-property-contract`                                                | 4a C1                                    |
| Indexed spread requires a contextual indexed result and indexed sources. Open computed literals expose `unknown` reads pending guarded inference.                                                                                                                                                                                                      | (typed indexed object lowering)                                                                         | 4a follow-up                             |
| (Removed for slice 2b’s numeric lists and primitive-field records) Existing native storage can be put in erased dynamic-key properties while retaining typed aliases. Other layouts need matching view shapes.                                                                                                                                         | `dynamic-object-local-aggregate`, `dynamic-object-own-data-definition`, `dynamic-object-aggregate-flow` | Aggregate view layouts and projections   |
| (Removed by 4a C3) Compound assignment and update of dynamic-key properties, realm array reads and mutators, and numeric spreads mixed with elements                                                                                                                                                                                                   | `dynamic-object-update`, `dynamic-object-realm-methods`, `array-mixed-spread`                           | 4a C3                                    |
| Numeric realm-array map supports unary native callbacks. Other array methods need callback views for their receiver, arity and result contracts.                                                                                                                                                                                                       | `native callbacks passed to realm array methods need slice 2b closure views`                            | Callable ABI generalization              |
| Recursive fixed payload layouts, optional realm calls, and iterator- and spread-driven realm array methods need further lowering.                                                                                                                                                                                                                      | `realm array method is outside typed realm array checking`                                              | 4 follow-up                              |
| (Removed by 4a B6) `os.userInfo` failures without SystemError                                                                                                                                                                                                                                                                                          | (runtime modules)                                                                                       | 4                                        |
| (Removed by 4a: callable classification) Typed `typeof` on realm callables received as `unknown`                                                                                                                                                                                                                                                       | `unknown-typeof-callable`, `tools/build-mixed-general-typeof-fixture.ts`                                | 4a                                       |
| (Removed by 4a B4) Direct calls of realm values narrowed by `typeof` to `Function`                                                                                                                                                                                                                                                                     | `unknown-callable-direct`, `unknown-callable-arguments`                                                 | 4a B4                                    |
| Projected unary numeric properties can be narrowed and called as Function. Native closures erased outside this boundary and other signatures still need callable projection.                                                                                                                                                                           | `tools/build-typed-general-call-contracts-fixture.ts`                                                   | Callable ABI generalization              |
| Realm library member signatures with callbacks or non-scalar results, including `Promise.then`, `Map.get`, `RegExp.exec` and `Uint8Array.prototype`, require additional bridge lowering. Realm property writes, index signatures, optional chains and direct calls or construction through library constructor aliases also require separate lowering. | `build-typed-realm-instanceof-fixture.ts` and checker diagnostics                                       | 4                                        |
| WeakMap and WeakSet constructors are installed. Constructing their instances requires the realm's weak-storage service.                                                                                                                                                                                                                                | `weak-collections`                                                                                      | 2b, 4                                    |
| The slice 2b byte-range API projects ordinary and shared realm views. Passing an escaping view to the raw typed-array ABI needs a lifecycle-aware carrier for resizing and detachment.                                                                                                                                                                 | `build-realm-array-native-projection-failure-fixture.ts`                                                | Typed-array ABI lifecycle                |
| `for…of` elements are typed `T \| undefined` (array holes) instead of TypeScript's `T`: passing the element on or reading its properties fails (FFI phases 2 and 4)                                                                                                                                                                                    | `for-of-typed-array-list`, `for-of-object-list`, `for-of-record-reads`                                  | 4a                                       |
| Assignment does not narrow a `let` to the assigned type (`x = x === undefined ? v : x`); `??=` only on optional primitives (FFI phase 4)                                                                                                                                                                                                               | `reassignment-narrowing`                                                                                | 4a                                       |
| Module-level loops and non-literal initializers ("module evaluation is required for this statement"; `tint:ffi` runtime module, FFI phase 4)                                                                                                                                                                                                           | `module-initializers`, `module-statements`                                                              | 5                                        |
| An empty array literal without a type needs a contextual type (TypeScript infers an evolving array)                                                                                                                                                                                                                                                    | `evolving-empty-array`                                                                                  | 4                                        |
| Discriminant narrowing of a parameter whose discriminant is not `readonly` (`shape.kind === "square" ? shape.size : …`)                                                                                                                                                                                                                                | `discriminant-narrowing`                                                                                | 4                                        |
| General-path gap: the general host installs no WeakMap/WeakSet, WeakRef, FinalizationRegistry, Atomics, Intl or Temporal, so untyped code cannot use them (weak storage depends on the collector's weak cells)                                                                                                                                         | `weak-collections`                                                                                      | 1c (with the GC owner)                   |
| (Removed by loop narrowing) A guard on a mutable binding was dropped after a nested loop, `switch` or labelled statement that never assigns the binding                                                                                                                                                                                                | `loop-narrowing`                                                                                        | Loop entry facts                         |
| A write through a record union of a value some member's declared type excludes (TypeScript accepts the union's read type; the write needs a per-member run-time contract check, so it falls back). Writes that every member's type admits compile typed.                                                                                               | `union-field-write`; `union-field-write-shared` passes typed                                            | Per-member write contract checks         |
| (Removed by unknown-to-string) `String()` of a caught value: a catch binding is `unknown`, and typed `String` used to accept primitives only                                                                                                                                                                                                           | `caught-value-string`                                                                                   | Typed conversion of unknown values       |

Indexed reads follow TypeScript under the program's compiler options
(coordinator decision, 2026-11-17). With `noUncheckedIndexedAccess`, which
the workspace sets, an unproven `Uint8Array` element read has type
`number | undefined`. Assigning that read to a `number` slot produces
TS2322 in the hosted validator (`typed-array-index-unproven`). A preceding
write can prove the constant indexed read in TypeScript (`typed-array-index`).
The explicit `?? 0` guard stays on the typed native path
(`typed-array-index-checked`). Without the option the read is `number`, inferred and
therefore speculative; only a later write into an explicitly annotated slot
is a contract check (`typed-array-index-unchecked`). The compiler still
lacks per-program compiler options, so the unchecked setting is recorded as
unsupported.

### Hosted source validation (slice 3)

The hosted composition root can inject a pinned TypeScript 6.0.3 validator
with the captured source text, import edges, and checking policy. It checks
the original reachable graph before the compiler attempts either native
representation. Diagnostics use the original UTF-16 ranges. The validator
keeps a verdict per entry in the captured graph. A writable inferred local
or contextual parameter can accept an assignment that TypeScript rejects
solely because of inference. Explicit destinations still report type errors.

The corpus uses the validator for the two source-error contracts and for
every typed form built with function fallback. `TINT_SOURCE_VALIDATION=1`
also enables it across the full corpus. The open-slot policy covers inferred
fields, list elements and contextual parameters. Typed rejections on the
validated path carry an enumerated capability and the original owner into
fallback. A rejection without this information fails the build. The
standalone hosted harness can still run the legacy path for comparison.

The [focused ledger](results/unified-pipeline-ledger-slice3-source-validation-focused-v1.json)
has eight native passes and two expected TS2322 rejections. The
previously misclassified indexed read passes through general lowering.

### Source-backed module retry (slice 3)

The hosted corpus can pass a source-backed loader with
`TINT_SOURCE_REPLAY=1`. The loader captures resolved import edges and serves
fresh syntax with the original UTF-16 positions. The general engine
accumulates installer requirements as each erased module is lowered. The
legacy partition still selects whole modules. It replays the application
dependency closure for partitioning and loads the remaining graph when the
typed retry needs it. Imported leaves with an implicit-`arguments` binder
rejection enter the partition together before the retry.

The [focused Linux replay comparison](results/slice3-source-replay-open-variable.md)
produced identical images from owned syntax and replay. The hosted manifest
counts loader calls, returned modules and UTF-16 units. The
[dense replay comparison](results/slice3-source-replay-dense.md) produced
identical images and observed 4.1% higher compile wall time and 5.7% lower
peak RSS on the 144-function fixture.

### Hosted function and class fallback (slice 3)

`TINT_FUNCTION_FALLBACK=1` enables unit selection on the typed corpus
forms and requires successful source validation. Ordinary realm calls
preserve callable identity through module exports and imports, supply the
receiver, and evaluate defaults in the callee. Argument and result guards
apply written primitive contracts. Abrupt completions preserve the original
thrown value. Supported classes and suspended functions use the same
program realm. Promise fulfillment and generator yields, completion and
resumption are checked at their respective execution points.

A private fixed-arity primitive entry can use the boxed calling convention
without initializing the realm. A numeric rest entry and calls that
observe `arguments.length` use the count captured at entry. General
callable views handle escaping references and observable replacement.
The [fixed-arity budget report](results/slice3-primitive-budgets.md)
records image size, cold startup, both call directions, managed allocations
and dense replay results. Both platform gates and the 198-form ledger
passed. [Final validation](results/slice3-and-2b-final-validation.md)

## Status

Slice 0: `requireTyped` guards the compiler self-build, frozen workloads and
feature-bench kernels (all 13 kernels build typed). The ledger
([baseline v2](results/unified-pipeline-ledger-baseline-v2.json), 47
constructs; [v1](results/unified-pipeline-ledger-baseline-v1.json) had the
first 37) has 6 typed forms on the typed path, 34 falling back, 3 parse
failures and 2 native mismatches: the enforced contracts (`explicit-*`) are
not implemented, and direct `eval` fails in both forms (exit 70) because the
generated general host installs no direct-eval compiler, so
`rejectUnsupportedExecution` throws. Every untyped form falls back,
mostly because unannotated functions are rejected. Later ledgers record
progress; compare with `--baseline`.

Slice 2: general code imports trusted runtime modules (2a), and exported
interfaces cross as views (2b): untyped code reads and writes a typed
record's fields live, with identity, declared field types and `readonly`
enforced, while the record's module stays typed. `x as T` from `unknown` is
a checked downcast. On the frozen v5 workload the 2b toolchain produces a
byte-identical image to 2a's (no type crosses there). The
[2b ledger](results/unified-pipeline-ledger-slice2b-v1.json) (58
constructs) has 9 typed forms on the typed path; the six FFI phase 4 gap
constructs pass natively in both forms on the general path. Its one
difference from baseline v2, `typed-array-index` typed moving from pass to
`missed-type-error`, is the construct's own change in slice 1 (the read is
`number | undefined` under noUncheckedIndexedAccess, so it must be a
compile-time error) and appears unchanged in the slice 1 and 2a ledgers. It
exposes a real gap: hosted builds fall back to the general path on a
genuine type error instead of failing the build; type errors and
unsupported constructs need distinct outcomes (slice 3, where fallback
becomes per construct). Later ledgers should compare against slice2b-v1.

Slice 4a (in progress): typed BigInt. The
[4a BigInt ledger](results/unified-pipeline-ledger-slice4a-bigint-v1.json)
(58 constructs) moves `bigint` typed from the general path to the typed path
(10 typed forms on the typed path); every other form matches slice2b-v1. Its
four run failures (`reassignment-narrowing`, `module-initializers`, both
forms) are LLDB admission attach failures before execution, kept as
observed; the [recheck](results/unified-pipeline-ledger-slice4a-bigint-v1-recheck.json)
passes all four. The
[4a for-of ledger](results/unified-pipeline-ledger-slice4a-forof-v1.json)
adds `for…of` element typing (elements are `T`; a hole read as a `T`
excluding undefined throws a TypeError) and assignment narrowing with `??=`
on optional records: 14 typed forms stay typed (the three `for-of-*` gap
constructs and `reassignment-narrowing` moved), no regressions against the
BigInt ledger. The
[classifier ledger](results/unified-pipeline-ledger-slice4a-callable-classifier-v1.json)
(59 constructs) adds mixed callable classification: both new
`unknown-typeof-callable` forms pass, with the typed form staying typed. The
full run kept 18 first-launch LLDB attach failures as observed; the
[serial recheck](results/unified-pipeline-ledger-slice4a-callable-classifier-v1-recheck.json)
has zero regressions against the BigInt baseline (both `weak-collections`
forms still fail at execution, as before).

The [4a rest and void callback ledger](results/unified-pipeline-ledger-slice4a-rest-void-v4.json)
covers 60 constructs with no regressions against the for-of ledger.
`rest-default-parameters` moved to the typed path. The new `rest-spread`
and `void-callbacks` forms also stay typed, bringing the typed-path count to 17. Both untyped forms pass through the general path.

Slice 1: image sizes of hosted programs, measured before and after.
Importing one function through the `js-runtime/objects` entrypoint from a
typed program took 33.9 MB (2.2 MB when importing the defining module
directly); with module pruning it takes 4.2 MB. A plain untyped program
compiled through the general host took 34.9 MB; with pruning and realm
installers chosen by the program it takes 27.5 MB. The remaining realm
core (errors, arrays, objects, functions, primitives, symbols, iterators)
is about 27 MB because those installers are coarse; with only error,
object and function intrinsics the same program is 9.8 MB, which is what
slice 1c targets.

### Proof for every slice

- **Semantic tests** per construct: ordering, abrupt completion and boundary
  values in both typed and untyped form, compared with Node and run natively
  under LLDB (stopped-at-entry and exit state asserted). Divergences from Node
  are checked against the specification.
- **Typed path preserved.** This weighs as much as coverage. The
  `requireTyped` builds (self-build, frozen workloads, feature-bench kernels)
  and `TINT_GENERAL_FALLBACK=0` builds of the existing typed fixtures pass;
  the ledger's typed forms never move from typed to general
  (`--baseline`); frozen v3 and the feature-bench kernels show no cycles or
  wall regression. Mixed programs are measured too: a typed kernel next to an
  island must run as fast as the same kernel alone.
- **Self-build fixpoint.** Node bootstrap, native stage2 and stage3 under LLDB,
  `cmp` identical.
- **Workspace and conformance.** `env -u TZ pnpm check`; the
  [pre-merge host smoke](test262-runner.md) and a GC-heavy file;
  `node tools/verify-heap-tools.ts`; a TZ=UTC Test262 slice covering
  `language/expressions/object`, `built-ins/Array`, `built-ins/Map` and
  `built-ins/Error`.
- **Frozen v3.** Output byte-identical to `.tint-bootstrap/workload-v3/out-sdisp`
  and no cycles or wall regression beyond noise:
  `tools/gate/with-lock.sh both frozen-v3 node tools/frozen-workload.ts run v3 <base> <variant> --rounds 6`.
  Slices that must not change typed output (0, 1 for typed-only programs) also
  compare images byte for byte.

## Risks

- **Compiler-source performance.** Once the self-build may contain islands, a
  convenient construct in a hot path silently costs the self-compile. Mitigated
  by the slice-0 assertion (no general units in the self-build until slice 7),
  then by the island report and its hot-path gate.
- **Image size and startup.** Any island links `js-runtime` and the realm. The
  current host installs every intrinsic eagerly; slice 1 must make installation
  demand-driven and lazy, or every typed program with one island pays for the
  whole realm. Measured per slice as image bytes and startup time.
- **Bootstrap order.** The compiler cannot import js-engine. Islands in the
  compiler's own build need the general lowering injected by a composition root
  above both packages (the CLI entry moves there in slice 6), and the bootstrap
  must build that root first. The self-build is also the first program where
  islands and closed-world record layout meet at scale.
- **Two object models during migration.** Until views are complete for a
  representation, values of that representation cannot cross and their users
  stay at the coarser granularity. The ledger makes each remaining case
  visible.
- **Open-field cost before 4b.** Until layout transitions exist, open fields
  of records that can reach general code use general storage, which is slower
  than today's typed records for unannotated code. Annotating a field restores
  the specialized layout (as an enforced contract); the ledger and frozen v3
  show the cost. Explicit contracts add a check only on paths the checker
  cannot prove (casts, views, untyped callers).
- **Parallel work.** The bridge reads record layout metadata that the GC work
  may be reshaping (record layout/packing, heap header); slice 2 must
  coordinate with it. General code importing FFI modules (slice 2) touches the
  FFI work's `tint:c` bindings.
