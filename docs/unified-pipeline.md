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
`RangeError`, `console`) whose implementations are native-runtime strict
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
  descriptors and prototypes). Identifiers resolve by name through environment
  records (`resolveBinding`/`getIdentifierValue`), not slots.

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
   type the typed world cannot model (`Error`, `Promise`, a class with features
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
outside the parser's type subset. Spreading a hole into a rest list whose
element contract excludes undefined throws a TypeError, following the typed
list iteration contract.

A value-returning function can satisfy a void callback signature. An
unannotated contextual callback retains its inferred result, and a
void-typed indirect call reads only the completion status from the common
completion buffer. When the type checker may have discarded a result,
lowering marks those calls in IR. The marks let a local void witness accept
a local identity with the same physical parameter layout in addition to its
exact signature identity. The function
object and callee ABI stay unchanged. Managed signature contracts at service
boundaries still require exact identities.

The native fixtures and their Node references share the source in
`tools/typed-rest-void-fixture-source.ts`.

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

| #   | Slice                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Removes                                                                                                                                                                                  | Depends on |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 0   | **Ledger and guardrails.** A corpus of construct fixtures (`tools/unified-pipeline/corpus.ts`), each in typed and untyped form, including open-slot and enforced-contract constructs; the ledger (`tools/unified-pipeline/ledger.ts`) records which forms stay typed, which fall back and which fail natively, and compares against a baseline. `requireTyped` makes the compiler self-build, frozen workloads and feature-bench kernels fail instead of falling back.                                                                                                  | Silent typed-perf loss; establishes the gap count this work drives to 0.                                                                                                                 | —          |
| 1   | **Program realm and module pruning.** The compiler skips modules reached only through unused re-exports when their bodies are unobservable (barrel entrypoints no longer pull every implementation into an image; observable modules still run in order). The general host owns one lazily created program realm (`programRealm()`, for the host now and islands later) and installs only the intrinsic groups the program can reach.                                                                                                                                   | Barrel retention; realm installers for kinds the program cannot create.                                                                                                                  | 0          |
| 1c  | **Fine-grained intrinsic groups.** Split the coarse `js-runtime` installers (primitives also install Date, JSON, BigInt and locale formatting; arrays include `fromAsync`) so a program links only the intrinsics it names; needed before islands, whose realm otherwise costs a typed program about 27 MB.                                                                                                                                                                                                                                                             | The fixed realm core.                                                                                                                                                                    | 1          |
| 2a  | **Trusted modules and identity crossings.** General code imports trusted runtime modules; they stay typed behind checked entries. Checked boundaries accept `unknown` parameters, results and constants, which cross unchanged (typed `unknown` and general values share one representation), so JavaScript values keep their identity. A trusted export whose type cannot cross is reported, never made general.                                                                                                                                                       | "General code cannot import the trusted module"; `node:ffi` need 1.                                                                                                                      | 1          |
| 2b  | **Views for references** (records, class instances, lists, Map/Set, typed arrays, closures): identity-preserving JavaScript objects over typed storage (data aliases for fields), and projection back to typed values. First users: module boundaries accept any export, and typed importers of general modules project declared types or stay general.                                                                                                                                                                                                                 | Upward contagion; record-shaped Node API results.                                                                                                                                        | 2a         |
| 4a  | **Typed code over general values (the `node:ffi` needs).** Typed code operates on `unknown` values through the program realm: typed BigInt (from and to two 32-bit halves, comparison, `typeof`), objects with dynamic keys (index signatures and `Record<string, T>` as general objects: create with computed keys, enumerate own keys, read by computed key), `typeof`/`instanceof` narrowing of general values including realm constructors and callables, realm `Error` and errors with `code`, and rest parameters in typed functions. Delivered before 3.         | `node:ffi` needs 2 to 6; the `KNOWN DEFECT` workarounds in `node/{crypto,zlib,os}.ts`.                                                                                                   | 2a         |
| 3   | **Function and class granularity.** A rejected top-level function or class lowers through js-engine as a general function/class object inside the typed module; typed callers use an adapter (box arguments, project the result). Nested functions follow, with captured typed bindings shared through closure cells and bridge reads/writes. Requirement (agreed with compiler bounded-memory slice 5): the fallback must not depend on resident input ASTs; it re-parses what it needs from source text, so the front end can drop each module's syntax once lowered. | Module-wide loss for generators, async, `var`, inheritance, accessors, private elements, decorators, `arguments`, direct eval.                                                           | 2          |
| 4   | **General representation for unmodelled types; open slots.** The checker types unmodelled globals and types as general instead of rejecting; their operations are general; unmodelled globals resolve to realm intrinsics. Native builtins become specializations selected by proven receivers. Inferred types become speculation: open locals, parameters and unescaped fields whose writes are not all proven take the general representation; explicit annotations become checked contracts on every write path.                                                     | `new Error`, `.message`, `instanceof` on realm constructors, missing Math/String/DataView members, `Reflect`, `JSON`, `Object`, `Symbol`, `Promise`; inferred types acting as contracts. | 1, 2       |
| 4b  | **Open-field transitions.** Speculated open fields of escaping records keep their specialized representation behind guards and transition the object's layout to general storage on a foreign write (stable identity with replaceable backing or general slots), without a failure path. Coordinated with the GC/layout owner.                                                                                                                                                                                                                                          | General storage for every open field of an escaping record.                                                                                                                              | 2, 4       |
| 5   | **Expression/statement islands.** Remaining checker rejections become islands with the boundary rules above.                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Destructuring, spread, object spread, optional/computed members and the remaining `UNSUPPORTED` sites inside otherwise typed functions.                                                  | 2, 4       |
| 6   | **One entry.** JavaScript modules and Scripts enter the same front end with no facts (everything general) instead of the separate module fallback; `closeGeneralPartition` and the retry loop are deleted. The compiler CLI composes the general lowering, so native builds of untyped code work outside hosted fixtures.                                                                                                                                                                                                                                               | The module fallback; the CLI gap.                                                                                                                                                        | 3, 5       |
| 7   | **Compiler sources.** The self-build may use any construct; an island report lists general units in compiler sources, and a self-build gate fails on new islands in measured hot paths. Then the HIR migration replaces island splicing with general patterns.                                                                                                                                                                                                                                                                                                          | The compiler-source language restriction.                                                                                                                                                | 6          |

Order (agreed 2026-11-18): 0, 1, 2a, 2b, 4a, 3, the rest of 4 and 4b, 1c,
5, 6, 7. Slice 4a moves ahead of 3 because `node:ffi` and the Node API modules
depend on it.

Orthogonal, schedulable at any point after slice 0: binder-resolved slots for
general code whose scopes cannot be observed dynamically (no direct eval or
`with`), replacing name-based `resolveBinding` per identifier. Untyped code
is only competitive once its locals are slots.

### Known typed-only gaps and the slice that removes them

FFI phase 1 marks its workarounds `KNOWN DEFECT` (see the known-defects table
in `docs/native-ffi.md`); each is removed when its slice lands. Constructs in
the ledger corpus reproduce the ones expressible in a single application.

| Gap                                                                                                                                                                                                            | Ledger construct                                                       | Removed by                          |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------- |
| (Removed by 2a) General code cannot import trusted runtime/FFI modules                                                                                                                                         | (needs runtime modules)                                                | 2                                   |
| Classes rejected in module-instance (runtime) contexts                                                                                                                                                         | `class-basic`                                                          | 3                                   |
| `new Error`, `.message` and untyped reads of caught values, `instanceof Uint8Array`                                                                                                                            | `errors`, `caught-error-reads`, `typed-arrays`                         | 4                                   |
| `toLowerCase` and other unlisted String methods; `Math.pow`/`log2`/`fround`; `JSON`                                                                                                                            | `string-methods`, `math`, `json`                                       | 4                                   |
| (Removed by 2b: checked downcasts) `x as Uint8Array` from a general value                                                                                                                                      | `general-value-casts`                                                  | 2 (projection), 4                   |
| Typed-array views over another buffer                                                                                                                                                                          | `typed-array-buffer-views`                                             | 4                                   |
| Forward reference to an unannotated module const (inferred binding treated as a contract; the runtime-stage error also lacks a location)                                                                       | `forward-inferred-const`                                               | 4 (open slots); location separately |
| (Removed by 4a) Typed rest parameters and spreads in the rest position                                                                                                                                         | `rest-default-parameters`, `rest-spread`                               | 4a                                  |
| (Removed by 4a) Value-returning functions rejected in void callback slots                                                                                                                                      | `void-callbacks`                                                       | 4a                                  |
| Rest and fixed-arity signatures are incompatible, and rest signatures require matching parameter counts                                                                                                        | Packed and fixed calls need ABI adapters                               | Not yet scheduled                   |
| Typed call spreads before the rest position require positional expansion                                                                                                                                       | `spread`                                                               | Not yet scheduled                   |
| Tuple types and `implements` clauses fail to parse                                                                                                                                                             | `tuple-types`, `spread`, `iterator-protocol`                           | parser fix (both forms parse first) |
| Nested type declarations; ternary over union discriminants in an object literal                                                                                                                                | `nested-type-declarations`, `union-object-ternary`                     | 5                                   |
| `for (const x of list)` followed by a property read of `x` (in runtime modules)                                                                                                                                | `for-of-record-reads`                                                  | 5                                   |
| (Removed by 4a: typed BigInt) Typed BigInt values (blocks FFI pointer/u64 values crossing into general code as BigInt)                                                                                         | `bigint`                                                               | 4                                   |
| Node API errors without `code`/`errno` (no plain `Error` in typed runtime code: zlib, crypto)                                                                                                                  | (runtime modules)                                                      | 4                                   |
| Top-level statements in typed modules ("module statement is outside the declaration checking slice")                                                                                                           | `module-statements`                                                    | 5                                   |
| A compile-time type error (`noUncheckedIndexedAccess`) becomes a general fallback instead of a diagnostic                                                                                                      | `typed-array-index`                                                    | 4                                   |
| No per-program compiler options                                                                                                                                                                                | `typed-array-index-unchecked`                                          | not yet scheduled                   |
| C struct views (`Ptr<Interface>` member access, FFI phase 2b) are typed-only; untyped code needs a real object whose accessor properties keep `v.member`'s meaning                                             | (FFI view modules)                                                     | 2                                   |
| Map iteration in typed code (`for (const [k, v] of map)`, `map.keys()`: only get/has/set/delete/clear are typed)                                                                                               | `map-set`                                                              | 4                                   |
| No objects with dynamic keys in typed code: `os.networkInterfaces()` returns a Map instead of Node's plain object (API-shape deviation, FFI phase 3)                                                           | (runtime modules)                                                      | 2 (record views), 4                 |
| No `SystemError` or plain `Error` in typed runtime code: node:os failures are TypeErrors                                                                                                                       | (runtime modules)                                                      | 4                                   |
| `typeof` in typed code reports `"object"` for a JavaScript function received as `unknown` (the general encoding does not mark callables; found through the slice 2a boundary)                                  | `tools/verify-hosted-general-trusted-import.ts`                        | 4a                                  |
| `for…of` elements are typed `T \| undefined` (array holes) instead of TypeScript's `T`: passing the element on or reading its properties fails (FFI phases 2 and 4)                                            | `for-of-typed-array-list`, `for-of-object-list`, `for-of-record-reads` | 4a                                  |
| Assignment does not narrow a `let` to the assigned type (`x = x === undefined ? v : x`); `??=` only on optional primitives (FFI phase 4)                                                                       | `reassignment-narrowing`                                               | 4a                                  |
| Module-level loops and non-literal initializers ("module evaluation is required for this statement"; `tint:ffi` runtime module, FFI phase 4)                                                                   | `module-initializers`, `module-statements`                             | 5                                   |
| An empty array literal without a type needs a contextual type (TypeScript infers an evolving array)                                                                                                            | `evolving-empty-array`                                                 | 4                                   |
| Discriminant narrowing of a parameter whose discriminant is not `readonly` (`shape.kind === "square" ? shape.size : …`)                                                                                        | `discriminant-narrowing`                                               | 4                                   |
| General-path gap: the general host installs no WeakMap/WeakSet, WeakRef, FinalizationRegistry, Atomics, Intl or Temporal, so untyped code cannot use them (weak storage depends on the collector's weak cells) | `weak-collections`                                                     | 1c (with the GC owner)              |

Indexed reads follow TypeScript under the program's compiler options
(coordinator decision, 2026-11-17). With `noUncheckedIndexedAccess`, which
the workspace sets, a `Uint8Array` element read has type
`number | undefined`, and `const value: number = bytes[1]` is a compile-time
type error exactly as tsc reports it, not a runtime TypeError
(`typed-array-index`; `?? 0` is the checked form,
`typed-array-index-checked`). Without it the read is `number`, inferred and
therefore speculative; only a later write into an explicitly annotated slot
is a contract check (`typed-array-index-unchecked`). Two gaps follow: the
typed path turns this type error into a general fallback instead of a
diagnostic (genuine type errors must stay errors when slice 4 turns
rejections into general representations), and Tint has no per-program
compiler options yet, so the unchecked setting is recorded as unsupported.

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
BigInt ledger.

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
  `lockf /Users/stephenbelanger/.t3/tint-timing.lock node tools/frozen-workload.ts run v3 <base> <variant> --rounds 6`.
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
