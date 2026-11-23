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
- **Annotated required fields are contracts.** They report
  `configurable: false`, so deleting one fails as JavaScript specifies:
  `false` in sloppy code, a `TypeError` in strict code. A write of the wrong
  type throws a `TypeError`. This is the one deliberate departure from
  JavaScript, where class fields are configurable, and it follows from
  treating the annotation as a contract. Defining one as an accessor through
  `defineProperty` throws for the same reason.

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

| Phase | Scope | Exit |
| --- | --- | --- |
| C1 | Classes without heritage in module instances: fields (annotated contracts, unannotated open), constructor, methods, accessors, statics, `instanceof`; exact-class guarded direct calls; class instance → interface assignability | `classes`-style kernels without `extends` compile with `TINT_GENERAL_FALLBACK=0`; ledger `class-basic` passes typed |
| C2 | Single inheritance among typed classes: prefix layouts, `super(...)`, `super.m()`, overrides, hierarchy dispatch, unions of classes and narrowing | the benchmark's `classes` kernel compiles typed and is at or under Node |
| C3 | Private elements and brand checks, static blocks, class expressions, `extends` of a general (untyped) constructor through the general path at the boundary | Test262 `language/statements/class` typed subset |
| C4 | Descriptor metadata for PR #12's inline caches | untyped access to typed instances at #12's IC cost |

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
