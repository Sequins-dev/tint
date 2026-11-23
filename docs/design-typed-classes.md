# Typed classes

Status: design, PR #17 (typed code generation). This document covers the
"Native class ABI" row of the [gap table](unified-pipeline.md#known-typed-only-gaps-and-the-slice-that-removes-them).
It builds on the representation work recorded in
[native classes](native-classes.md) and replaces its open-ended next steps with
a phased plan.

## Why

A class in typed code today does not compile as typed code at all:

- module-instance preparation rejects every class declaration ("module
  instance classes require scoped contract and construction lowering");
- the checker rejects `extends` ("class inheritance contracts require heritage
  checking");
- a class instance assigned to a structural interface fails ("value does not
  match its declared type");
- a method call on a union of classes fails, even after `instanceof` or
  discriminant narrowing ("invalid method call").

So the whole module falls back to the general path, and the typed benchmark's
`classes` kernel runs 98–100× slower than Node 26
([baseline](results/typed-codegen-baseline-v1.md)). By the project rules this
is a typed-only gap, and so a bug.

## What already exists

These pieces were built and tested without source classes using them:

- class storage planning (`closure/lowering/class-records.ts`): separate
  instance, prototype and constructor-state layouts per class, own-presence
  slots for methods an instance may shadow, a hidden prototype pointer, and
  initialization state for fields;
- guarded record reads that follow a prototype contract when the own property
  is absent (scalar lowering, `record-has` plus nested contracts);
- generators for the base construction entry (`buildClassConstruction`), the
  static phase (`buildClassStaticInitialization`) and class definition
  (`buildClassDefinition`), with JavaScript evaluation order, TDZ of the inner
  and outer bindings, and exception propagation;
- `function-environment` (the constructor-state record behind a constructor
  value) and construction through the indirect-call ABI.

The missing parts are the source adapter that connects a class declaration to
these generators inside a module instance, heritage, member dispatch, and the
checker relations.

## Representation

**Instances** are native records with one fixed layout per class. The
layout's fields are:

- the hidden prototype pointer;
- own data fields in declaration order;
- private fields (`#x`);
- one presence byte per method name an instance may shadow.

Because the layout is fixed, a field read is one load at a constant offset
once the descriptor is known.

**Derived layouts are prefixes.** A subclass instance layout starts with its
base class's layout and appends the derived class's fields, so base-class
code, including inherited methods, reads base fields at the same offsets on
every subclass instance. The descriptors differ, but each records its base
chain, so "instance of C or a subclass" is a bounded family test.

**Field contracts follow the project rules:**

- **Explicitly annotated fields** (`x: number`) are contracts. They use the
  annotated representation (`number` in an FP word), and a write of another
  type throws a `TypeError` from any path: typed code checks statically, and
  record views check before publishing.
- **Unannotated fields** take the general two-word representation, because an
  inferred type is not a contract. Typed reads add a guarded fast path for the
  inferred type, which falls back to the general value.
- **`declare` fields** and fields without an initializer start `undefined`,
  tracked by initialization state, as the storage planner already does.

**Prototypes** are records holding method closures. Each method has one
closure, created once per class definition, so identity is shared across
instances. Prototypes also hold accessor pairs, the `constructor`
back-reference and a hidden link to the base prototype. A prototype holds only
its own class's members. Inherited members are found through the base link,
so mutating a base prototype is visible to subclasses.

**Constructors** are managed function values. Their constructor-state
environment holds the prototype, static fields and methods, and the
construction closure. `typeof C === "function"`, and calling `C()` without
`new` throws the class `TypeError`.

## Construction

`new C(args)` evaluates the callee once, then the arguments. It then invokes
the construction entry, which:

1. allocates the instance layout of `new.target`, with the prototype taken
   from `new.target`;
2. for a base class, runs field initializers in source order, then the
   constructor body;
3. for a derived class, runs the derived constructor body until `super(...)`.
   That call invokes the base construction entry on the already-allocated
   instance, with `new.target` forwarded. The derived field initializers run
   when `super` returns. `this` before `super` is a `ReferenceError`, and a
   second `super` call throws, as JavaScript specifies;
4. rejects a constructor returning an object other than `this`, explicitly at
   build time, in the first phases.

Allocating the most-derived layout up front, rather than letting the base
constructor allocate, is what keeps layouts fixed. It is observable only
through `new.target`, which stays exact.

## Member access and calls

A method call `x.m(args)` has three steps:

1. check that `x` has no own `m`, using the presence byte;
2. load the method closure from the prototype slot;
3. call it with `x` as the receiver.

The typed fast path layers on that:

- **Exact class, closed world.** No subclass of `C` exists in the program
  and `x`'s static type is `C`. The call checks that the receiver's
  prototype pointer is `C.prototype`, that its own-shadow byte is clear, and
  that `C`'s prototype validity cell is valid. It then calls the method
  resolved at definition time directly, which makes the call inlinable. On a
  miss it does the full JavaScript lookup and call. Prototype mutation and
  own overrides keep JavaScript semantics.
- **Class hierarchy.** The receiver's prototype pointer selects the class.
  For each class the call site expects, the method was resolved when the
  class was defined, guarded by validity cells (see "JavaScript object
  semantics"). The call dispatches on the prototype pointer to those direct
  entries, with a full lookup otherwise. Closed-world devirtualization
  applies when only one implementation exists for the receiver's possible
  classes.
- **Union of classes**, and narrowing by `instanceof` or by a discriminant
  field. This uses the existing layout-dispatch machinery for unions over
  instance descriptors, then the per-class path above. `instanceof C` for a
  typed class is a descriptor family test, with a guarded fallback to the
  general prototype-chain walk when `C.prototype` or
  `Symbol.hasInstance` changes.
- **Structural interfaces.** A class instance is assignable to an interface
  whose members its fields and methods satisfy, as TypeScript says.
  Interface reads dispatch over the concrete layouts that flow in. Class
  layouts take the own-field path or the prototype contract, both already
  implemented for records.
  - Data-only interfaces work today. Methods do not yet: a class method's
    type requires its class as receiver, and an interface method signature
    (`m(): T`) constrains no receiver, so the relation rejects it. With an
    explicit `m(this: R): T` the assignment already checks and calls pass
    the receiver.
  - Open decision: give method signatures an implicit receiver (the
    interface itself), related bivariantly as TypeScript's method
    bivariance does. Receivers travel in the general receiver slot, so the
    calling convention is unchanged. Two costs need measuring first. Every
    call through an interface method would box and pass a receiver, also
    in the compiler's own interface-heavy code (frozen v7). And mutable
    method properties relate exactly today, so receiver-less
    implementations (arrow functions) would need method properties
    related covariantly, as TypeScript does. The alternative is to pass
    receivers only at call sites whose possible targets use them, using
    the closed-world call-target analysis.

**Other members:**

- **Accessors** (`get`/`set`) are prototype slots holding the getter and
  setter closures. A read or write calls them, guarded the same way as
  methods.
- **Static members** live in the constructor-state record.
- **`super.m()`** loads from the base prototype at its fixed slot and calls
  with the current receiver.

## JavaScript object semantics

Typed classes are still JavaScript classes. Each behaviour below holds from
typed and untyped code alike, and C1's fixtures check each one against Node.

**Prototype mutation never breaks a fast path.** Code can change behaviour
at any time with `Foo.prototype.m = f`, `Object.defineProperty` or `delete`
on a prototype, `Object.setPrototypeOf` on a prototype or an instance, or
`Foo.prototype.__proto__ = …`, from either side. Two rules keep the fast
paths correct:

- **Derived prototypes hold only their own members.** An inherited method is
  absent from a derived prototype, and lookup follows the hidden base link,
  so a later change to a base prototype is visible through every subclass.
  This replaces the "vtable slot" wording above: the fixed slot is the
  class's own slot, not a copy of the base's.
- **Each class has a prototype validity cell**, one word in its
  constructor-state record. Any mutation of a prototype on the class's chain
  invalidates the cells of every class whose chain contains it: assignment,
  `defineProperty`, `delete`, a prototype change, or an accessor installed in
  place of a method. Mutations from untyped code reach the prototype through
  its record view, whose write, define, delete and set-prototype hooks
  invalidate the cells. Typed code invalidates them in the same lowering.

  A method call site then checks three things: the receiver's prototype
  pointer is `C.prototype`, the own-shadow byte is clear, and `C`'s cell is
  valid. If all hold, it calls the method resolved at definition time
  directly. Otherwise it does the full lookup: own property, then the chain
  with accessors and exotic objects, then a call. The check is three loads
  and three compares. Nothing assumes a prototype is unchanged without
  checking it.

**Instances accept expandos and deletes as JavaScript objects do.**

- **Expandos.** A record view keeps properties outside the layout
  (`inst.extra = 1`) as ordinary own properties, as views already do.
  Typed code reaches them only through general access, since TypeScript
  rejects unknown names on a class type.
- **Method-named writes.** Writing a method's name on an instance
  (`inst.m = f`) goes to the layout's own-shadow slot, not to a view-only
  property, so typed call sites see the override.
- **Deletes of open fields.** Unannotated and optional fields carry
  presence state. `delete inst.field` clears it, and later reads, typed or
  untyped, fall through to the prototype chain. This extends record views,
  which today refuse to delete fields.
- **Deleting fields follows TypeScript** (user decision, 2026-11-23). The
  pinned TypeScript (6.0.3, strict) rejects `delete p.x` with TS2790 when
  `x` is neither optional (`x?: T`) nor typed to admit `undefined`, and with
  TS2704 when `x` is `readonly`. Tint's checker reports the same codes and
  spans as build-failing type errors, so a native build without the hosted
  validator fails as `tsc` does. Optional and unannotated fields stay
  deletable. Deletes that bypass the checker (`as any` reaching the realm,
  untyped code) see an annotated required field as `configurable: false`:
  `delete` returns `false` in sloppy code and throws a `TypeError` in strict
  code. One policy function in the class-view layer reports the descriptor
  and answers `delete`. Defining such a field as an accessor through
  `defineProperty` throws for the same reason. A write of the wrong type
  throws a `TypeError`. These are the deliberate departures from JavaScript,
  where class fields are configurable, and they follow from treating the
  annotation as a contract.
- **Fields are defined before initializers run.** JavaScript defines every
  field as `undefined` before its initializer. The typed path keeps
  `undefined`-less storage for fields the checker proves assigned before
  any read. Calls of the class's own methods on `this` during construction
  are analyzed in place: the method may read assigned fields, and its
  definite assignments count after the call. When no code writes through a
  `prototype`, those calls reach the defined methods. Step 4 adds the
  validity-cell guard to such calls.
- **Fields read before their first assignment** (unproven fields) stay
  typed. A required instance field is unproven when some code may observe
  it before its assignment: a read in the constructor, a field initializer
  or a method analyzed in place, or `this` escaping (to another function, a
  closure, a call the analysis does not follow, a recursive or replaced
  method) while the field is unassigned.
  - Only those fields change representation: an `undefined`-capable one
    (`optional-number`, `optional-string`, `optional-boolean`) with a
    presence byte. Construction defines them in field order, so an earlier
    initializer sees them absent (`in` is `false`).
  - Every read of an unproven field, through the class or any type sharing
    its layout, is a speculative general value. Operators, string
    conversion, `typeof` and comparisons on it follow JavaScript, so a read
    before the assignment gives `undefined` exactly. Where the value reaches
    a written type (a parameter, an annotated result or binding, a typed
    field), the speculative contract check applies: `undefined` there is a
    `TypeError`, as for any value outside a written type.
  - A numeric update (`+=`, `++`, `|=` and the like) works on the storage
    directly, since unwrapping `undefined` gives NaN, as `ToNumeric` does.
  - Still interim, to be removed before #17 is ready:
    - unproven fields of other types (references, lists, object unions);
    - other updates of unproven fields (`??=`, logical assignments of
      booleans) and indexed reads (`this["x"]`);
    - static fields read before their initializer;
    - a base constructor dispatching to a subclass override (C2).

    Each fails explicitly, so the module takes the general path.

  - Every read of an unproven field pays the speculative path, also after
    construction. Reads proven to follow construction (no escape of `this`)
    can use the storage directly; not done yet.
  - The pinned TypeScript reports a direct early read in the constructor
    (TS2565) or a field initializer (TS2729). This checker does not
    reproduce those diagnostics yet; such programs read `undefined` as
    JavaScript does.

  `tools/native-typed-classes.test.ts` covers the typed cases, the contract
  `TypeError`, and the general-path case.

- **Deleting fields that admit `undefined`** (`x?: T`, `x: T | undefined`,
  `unknown`, and optional interface properties) is lowered on the typed
  path. Such a field carries a presence byte: construction defines it
  (present, value `undefined` unless initialized), `delete` stores the
  field's absent value and clears the byte, so `in` is `false` and reads
  give `undefined` until the next write marks it present again.
- **Object literals typed as a class** (`const b: Box = {...}`) are plain
  records. Accesses through the class type dispatch on the class layout
  first, then on the plain layout, which exists only when such a literal is
  constructed.

**Observable order is JavaScript's:**

- the callee and arguments of `new` are evaluated first;
- a base class runs its field initializers in source order with `this` the
  new instance, then its constructor body;
- a derived class evaluates its constructor body until `super(...)`, and the
  base construction runs there;
- the derived field initializers run when `super` returns;
- `this` before `super` throws a `ReferenceError`, and so does reading it
  after a constructor that never called `super`;
- a second `super` throws a `ReferenceError` after the base constructor has
  run again, as specified;
- `new.target` is the constructor `new` was applied to, also inside base
  constructors and field initializers;
- static fields initialize in source order after the inner class binding
  exists.

**Other class semantics:**

- **`instanceof C`** calls `C[Symbol.hasInstance]` when it isn't
  `Function.prototype`'s. Otherwise it walks the instance's prototype chain,
  native links first, comparing with `C.prototype`. That is
  OrdinaryHasInstance itself, so it stays correct under any mutation and
  needs no guard. A typed class that declares `static [Symbol.hasInstance]`
  needs a computed key, which C1 rejects explicitly.
- **`[[IsClassConstructor]]`:** `C()` without `new` throws a `TypeError`.
- **`Function.prototype.toString`** returns the class's source text, which
  is retained like other functions' source.
- **`typeof C`** is `"function"`.
- **Class bodies are strict**, including methods, accessors, initializers
  and static blocks, whether they appear in a script or a module: `this` is
  not coerced, and assignments to undeclared names throw.

## Untyped code and PR #12

Typed instances must remain ordinary JavaScript objects to untyped code. When
one reaches a realm value, it is projected through the existing record views:

- generated accessors over the native record;
- writes checked against field contracts before publishing;
- one view per object, so identity is preserved.

Methods appear as functions on the prototype view.

PR #12 is giving untyped objects shared shapes with fixed in-object offsets
and inline caches keyed by shape. For typed instances the plan is to treat the
instance descriptor as a shape. The descriptor gets a metadata table of
`(name → offset, representation, writable, contract)`, published once per
class. #12's IC miss handler can then install a handler keyed by the
descriptor that reads at the offset directly, converting the representation,
and checks the contract on writes. That gives untyped code over typed
instances the same one-compare access as over its own shapes, without a
second object model. Prototype entries are described the same way, with the
validity dependency #12 uses for prototype changes.

This is the coordination point with #12. Its descriptor metadata format comes
from #12; typed classes only publish into it. Until #12 lands, the record
views are the interop path.

## Phases

| Phase | Scope                                                                                                                                                                                                                            | Exit                                                                                                                |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| C1    | Classes without heritage in module instances: fields (annotated contracts, unannotated open), constructor, methods, accessors, statics, `instanceof`; exact-class guarded direct calls; class instance → interface assignability | `classes`-style kernels without `extends` compile with `TINT_GENERAL_FALLBACK=0`; ledger `class-basic` passes typed |
| C2    | Single inheritance among typed classes: prefix layouts, `super(...)`, `super.m()`, overrides, hierarchy dispatch, unions of classes and narrowing                                                                                | the benchmark's `classes` kernel compiles typed and is at or under Node                                             |
| C3    | Private elements and brand checks, static blocks, class expressions, `extends` of a general (untyped) constructor through the general path at the boundary                                                                       | Test262 `language/statements/class` typed subset                                                                    |
| C4    | Descriptor metadata for PR #12's inline caches                                                                                                                                                                                   | untyped access to typed instances at #12's IC cost                                                                  |

**Order of work inside C1.** Each step lands with its own tests:

1. **Scoped contract resolution.** Module-instance preparation moves
   top-level statements into the module's initializer function, so a
   top-level class becomes a class statement inside a function. The checker
   rejects those today ("local classes require scoped contract resolution").
   This step resolves the class contract in the scope where the class
   appears, with captured module bindings as closures, and removes the
   module-instance rejection.
2. **Class statements in closure lowering.** Method and initializer
   closures are created once, then `buildClassDefinition` runs at the
   statement's position, with TDZ on the class binding.
3. **Member reads, writes and method calls.** Own fields, prototype
   contracts, own-shadow slots, prototype validity cells and the guarded
   direct calls.
4. **Record views of instances and prototypes.** Presence-backed deletes,
   method-named writes into shadow slots, non-configurable annotated fields,
   and invalidation hooks for mutation from untyped code.
5. **Fixtures**, one per behaviour in "JavaScript object semantics".

**Status of steps 1 and 2** (landed together):

- Contracts resolve for classes declared directly in the body of a
  non-generic module-level function, which is where module instances put
  module classes. Nested classes, classes in generic functions and body
  classes that shadow another declaration still fail as unsupported local
  classes. Generic classes still fall back.
- A class statement creates one closure per member, then calls generated
  definition, construction and `[[Call]]` entries
  (`closure/lowering/class-statements.ts`). The class-scope binding is
  initialized before static fields run, and the statement binding after
  them. Static methods live in the constructor-state record. Static fields
  initialize in source order through a generated static entry.
- Calling a class without `new` throws the TypeError V8 reports.
- `readonly` fields and methods are writable in storage. `readonly` is
  checked by TypeScript only, and untyped code may write those properties.
- Constructor bodies may assign a field more than once (see step 3 for
  the field storage).
- `x instanceof C` for a typed class compares `C.prototype` with the
  operand's prototype pointer after testing for `C`'s instance layout
  (OrdinaryHasInstance). It needs no `Symbol.hasInstance` check while typed
  constructors have no realm view. Step 4 adds that check with the views.
- `typeof` of a callable or constructible object type is `"function"`.

**Status of step 3** (in progress):

- Own data fields are `deferred` record fields: construction leaves them
  zero-filled with no initialization state, and the checker proves each is
  assigned before it is read, so accesses are plain loads and stores.
- Values of a class instance or prototype type dispatch only on the class
  layouts (also for structurally identical types the checker interned
  separately), and on the plain layout only when an object literal has the
  class type.
- A method converts its receiver once on entry, without trapping, so record
  facts prove the layout for later `this` accesses.
- A method call reads an inherited method into a slot that only prototype
  reads write and calls through it. An own override takes the ordinary
  call. With closed records the optimizer then knows the closure's target
  whenever no code writes another closure into that prototype field. It
  calls a twin that takes the receiver and environment as parameters, and
  the inliner inlines it. This is the closed-world form of the guarded direct
  call. Step 4's record views write prototype fields from untyped code, and
  such a write makes the field's target unknown. Step 4 therefore adds the
  prototype validity cell as the run-time guard on the same direct call.
- `basicClasses` in the typed benchmark (`tools/typed-bench/classes-basic.ts`)
  went from 76.8 ms to 35.4 ms steady on macOS arm64; Node 26.13.1 takes
  21.1 ms. The frozen v7 workload is unchanged, with identical output.

**Plan for step 4** (views on PR #12's object model; the validity cell lands
in the same push that exposes prototypes):

PR #12 (`origin/perf/general-runtime`, at 6517de298 when read) replaces the
realm's property storage with shapes and inline caches:

- A shape lists keys and attribute kinds.
- A key's slot is its position: 8 in-object general slots, then a list.
- Every slot is a two-word general value.
- Caches key on the shape word at offset 8 of an `OrdinaryObject`.
- Objects with overridden internal methods are dictionary mode and always
  miss. Today's `createRecordView` views are such objects.

Typed instances must be both correct and cache-fast to untyped code, so
their views are **record-backed fast objects**:

- **Instance views.** Each instance has one view, cached in the record's
  `[[view]]` slot. The view is a fast-mode `OrdinaryObject` whose shape is
  created once per class layout. That shape's keys are the own data fields
  and method shadow slots. Each key's slot lives in the instance record at a
  word offset with a representation: float64, boolean, string, reference,
  general, or optional with a presence byte or `undefined` encoding.
  Expandos transition from that shape like any other object.
- **Cache hits.** A hit compares the shape, loads the view's record
  pointer, loads the field and tags it. That is free for numbers, booleans
  and strings. A reference field yields the target's view, and misses until
  one exists.
- **Prototype and constructor views.** A prototype view is a fast object
  with a private shape whose method slots hold callable views of the method
  closures, plus a non-enumerable `constructor`. The constructor view is a
  callable view with `prototype` and the statics.
- **Compiler side (this stream).**
  - The checker records erasure points, where a class-typed value becomes a
    general value. Lowering calls the class's publish entry there, the one
    seam into the runtime.
  - A view coming back is unwrapped to its record: in downcasts, in
    `instanceof`, and in parameters typed as the class.
  - Prototype method fields and shadow slots switch to the general
    representation.
  - Each prototype record gets the validity word, and method calls get the
    guard described in "JavaScript object semantics".
  - Until the runtime part exists, erasure of class values fails explicitly
    at compile time instead of passing a raw pointer.
- **Runtime interface needed from #12** (to be built in #12 or on top of it
  after it merges):
  1. `createRecordShape(prototypeView, keys, kinds, fieldWords,
representations, recordDescriptor)`: an immutable fixed-layout shape,
     registered as the prototype view's child root, from which expando
     transitions proceed.
  2. Kind bits:
     - `recordField`: the value lives in the backing record.
     - `checked`: stores validate the representation or annotation and
       throw a `TypeError`, while the descriptor still reports writable.
     - `maybeAbsent`: a presence byte or shadow slot, so an absent key
       continues the lookup to the prototype.
  3. A view object layout with a record pointer at a fixed offset. Each
     cache site records a representation word, and IR and codegen get
     per-representation hit sequences for loads and checked stores.
     Record-flow treats their results as general values with no facts.
  4. A prototype validity hook. A prototype view points at its record's
     validity word, and the runtime clears it on:
     - a store, define or delete of a method key on the prototype view;
     - `setPrototypeOf` of the prototype view;
     - an accessor replacing a method.

     `setPrototypeOf` of an instance view swaps the view's shape and
     updates the record's prototype link.

  5. Non-configurable record fields for annotated required fields:
     - their descriptor reports `configurable: false`;
     - `delete` returns `false`, or throws a `TypeError` in strict code;
     - redefining them as accessors throws.
  6. Dictionary-mode demotion keeps record fields live as alias
     descriptors instead of copying their values out.

Untyped code does not yet see typed instances, prototypes or constructors
through record views (step 4). Accessors and
unannotated fields and method results still fail at check time. Evidence:
`tools/native-typed-classes.test.ts`.

**TypeScript-only class syntax.** The parser keeps heritage type arguments
(`extends Base<T>`) and `implements` types on the class definition, and
records overload signatures, index signatures and optional methods as
type-only members; erasure drops them as TypeScript's emit does, so the
general path compiles such classes.

- The checker requires the instance type to be assignable to each
  `implements` type. Methods relate only through their receivers, which is
  stricter than TypeScript (method bivariance), so a mismatch is an
  explicit general-path fallback rather than TS2420 until instance →
  interface assignability covers methods.
- Classes with type-only members fail typed checking explicitly.

Each phase fails explicitly for what it does not cover:

- decorators, already rejected;
- computed member keys;
- constructors that return another object;
- mixins (`extends` of an expression);
- `extends null`.

None of these is dropped silently.

## Validation

**Semantic native fixtures, each checked against Node:**

- field initialization order;
- method identity across instances;
- own overrides of methods, from typed code and through the record view;
- prototype mutation after construction, from typed and untyped code, with
  a direct-call site before and after (`m = …`, `defineProperty`, `delete`,
  `setPrototypeOf` on the prototype and on an instance);
- expandos and deletes of open and optional fields from untyped code, and
  deleting an annotated field failing;
- receiver borrowing (`C.prototype.m.call(other)`);
- getters and setters;
- statics;
- `super` ordering, including `this` before `super`;
- `new.target`;
- `instanceof` with and without `Symbol.hasInstance` and with changed
  prototypes;
- calling a class without `new`;
- `Function.prototype.toString`;
- strict-mode behaviour inside class bodies;
- exceptions thrown from initializers and constructors;
- GC survival of instances and prototypes under a small heap.

**Contract fixtures:**

- annotated fields throw on bad writes from untyped code;
- unannotated fields accept any value.

**Elsewhere:** the ledger constructs; `class-basic` and new heritage
constructs (typed and untyped); Test262 smoke in both modes; the frozen v7 and
stage 2 = stage 3 budgets; and the typed benchmark's `classes` kernel in the
typed image.
