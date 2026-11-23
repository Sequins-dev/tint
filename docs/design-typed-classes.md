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
back-reference and a hidden link to the base prototype. Prototype layouts
follow the same prefix rule, so a base method slot has the same offset in
every subclass prototype.

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
  and `x`'s static type is `C`. The call guards that the presence byte is
  clear and that the prototype slot still holds the class definition's
  closure, which is one compare against the identity captured at definition.
  It then calls the method's entry directly, which makes the call inlinable.
  On a guard miss it loads the slot and calls indirectly. Prototype mutation
  and own overrides keep JavaScript semantics.
- **Class hierarchy.** The call reads the slot at its fixed prototype offset
  (prefix layouts), a vtable-like load, and calls it indirectly with the same
  own-shadow guard. Closed-world devirtualization applies when only one
  implementation exists for the receiver's possible classes.
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
- own overrides of methods;
- prototype mutation after construction;
- receiver borrowing (`C.prototype.m.call(other)`);
- getters and setters;
- statics;
- `super` ordering, including `this` before `super`;
- `new.target`;
- exceptions thrown from initializers and constructors;
- GC survival of instances and prototypes under a small heap.

**Contract fixtures:**
- annotated fields throw on bad writes from untyped code;
- unannotated fields accept any value.

**Elsewhere:** the ledger constructs; `class-basic` and new heritage
constructs (typed and untyped); Test262 smoke in both modes; the frozen v7 and
stage 2 = stage 3 budgets; and the typed benchmark's `classes` kernel in the
typed image.
