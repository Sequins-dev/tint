# Language profiles and soundness

Status: agreed direction plus proposed rules. This is not yet a complete formal
soundness specification or a claim of TypeScript conformance.

The [strict-checking case specification](strict-checking-cases.md) now supplies
concrete initial rules and positive/negative examples for implementation.

## Compatibility and strictness

The live/compatible profile targets broad TypeScript syntax and type-system
coverage with ordinary JavaScript runtime behavior even for type-violating programs.
TypeScript is the conformance guide; Tint owns its frontend and checker. Retained
types guide specialization and optional diagnostics; mismatches generalize/deoptimize
instead of imposing additional runtime restrictions. Recovery preserves normal
coercions, effects, and exceptions. See [Runtime type contracts](runtime-types.md).
Unchecked source assertions do not authorize invalid native loads or stores.

The strict profile preserves ordinary TypeScript where possible while rejecting
patterns that prevent sound reasoning. Strictness and output destination are
independent; both profiles support native lowering through the shared pipeline.
An optional bytecode tier would not alter either profile's soundness obligations.

Tint's own compiler uses this same strict/native profile. There is no distinct
bootstrap dialect; only staged implementation of features needed for self-hosting.

Generics and broad types are not intrinsically unsound. Retain structural typing,
unions, generics, mapped/conditional types, and other useful abstractions where
their operational contracts can be enforced. A less precise type may require a
more general representation without requiring rejection.

Strict code should default to type-directed layouts; compatible/live code needs
a general tagged value and dynamic object model. These are representation families
within the shared compiler, not different language implementations. See
[Value representations](representations.md) for layout selection and boundary rules.

## Tagged unions

Native unions are supported. A tagged sum representation is the baseline model:
a discriminant identifies the active payload, and writes change the tag and
payload consistently. A union-typed variable may change variants.

```ts
let value: number | string = 1;
value = "hello";
if (typeof value === "string") {
  value.toUpperCase();
}
```

Variant-specific operations require narrowing, following TypeScript-shaped
control flow. Shared operations may be valid without selecting one member.
Tags and payload storage may cost space and branches; avoiding broad unions is
one way to make representation costs predictable. Later optimization may remove
tags, reuse existing tags, or specialize local values when justified.

Object payloads retain identity through references unless escape/identity analysis
proves value-like storage safe. The GC must trace the active payload correctly.

Structural union members can overlap. An implementation tag is not necessarily a
unique source-language type identity. Property checks and discriminants must
preserve source semantics, including effects of getters and dynamic objects;
lowering every structural test to a hidden variant-number comparison is unsound.

### Tagged storage does not repair incompatible aliases

```ts
const original: { value: number } = { value: 1 };
const widened: { value: number | string } = original;
widened.value = "hello";
original.value.toFixed();
```

Even if the field is physically tagged, the original alias still promises a
number. Strict mode should reject the writable widening rather than silently
weaken all aliases. Writable arrays and fields require compatible read/write
contracts, using invariance in the initial checking contract. Read-only views may safely widen reads, but
do not prove that the underlying object is immutable.

Changing a union variable to a new whole value is straightforward. Mutating a
discriminated union object's tag and correlated fields separately can temporarily
violate its variant contract. The initial checking contract rejects writes that
break the correlation, including through structural views, and permits whole-value
replacement. Aliases and callbacks must not observe an invalid intermediate state.

## Assertions and shape compatibility

Proposed rule: `as T` is permitted in strict mode only when the compiler already
establishes safe assignability to T under Tint's stricter rules. The assertion may
select a safe view; it cannot introduce a missing fact.

- Subclass to ancestor: normally permitted, subject to sound member compatibility.
- Ancestor to subclass: not permitted merely because the classes are related.
  Require prior narrowing or other static proof of the actual subtype.
- Structurally compatible types without an inheritance relationship: permitted
  when member types, mutability, and private/protected identity constraints agree.
- Matching property names alone: insufficient.
- Identical byte layout alone: insufficient.
- Layout differences between safely compatible types: use a view/descriptor or
  conversion; do not reinterpret pointers based on source syntax alone.

For example, a value statically established as a particular subclass can be used
as that subclass after narrowing even if its earlier declared type was the base.
An arbitrary base instance cannot be downcast without proof. `instanceof` provides
a useful source operation, but prototype mutation and custom instance checks must
not be allowed to forge native layout facts.

Keep `as const` and `satisfies` where their usual meaning is safe. Non-null and
definite-assignment assertions cannot substitute for initialization/presence
proof. Diagnostics should name the missing guarantee and suggest narrowing or a
safe view, rather than merely reporting that two types are unrelated.

Runtime-checked conversion, if exposed, should be an explicit operation with a
defined failure result. Do not silently make ordinary `as` execute a conversion.

## User-authored predicates

Provisional initial simplification: reject user-authored `x is T` and `asserts`
signatures in strict modules. They often describe guard functions, but their
annotations alone do not prove the claimed fact. Compatible modules retain them
as part of the conformance target without trusting them for unsafe representation
decisions.

Ordinary boolean helpers remain available. A boolean result need not narrow its
argument unless the compiler independently proves the relationship. Built-in
checks and direct control-flow narrowing remain supported.

An alternative to predicate syntax is returning a validated value as a union,
such as `T | undefined`. The return value must itself be constructed or proven
valid; an annotation alone is not validation. Verified predicates can be revisited
later without changing the native representation contract.

## Other proposed soundness rules

- Safe function-parameter variance also applies to methods and constructors.
- Indexed reads account for missing elements unless presence/bounds are proven.
- Optional fields distinguish absence from an explicit undefined value.
- Writes/deletion through a view cannot invalidate another alias's required fields.
- Calls, getters, callbacks, and suspension invalidate affected refinements unless
  their effects are known. A local primitive snapshot can retain its refinement.
- External declarations do not prove implementation behavior. Imports require
  verified native contracts, checked dynamic boundaries, or explicit trusted ABIs.
- `unknown` remains useful; unrestricted `any` cannot establish native layout
  guarantees. The initial checking contract rejects explicit/implicit `any` in
  ordinary strict source and reached imported signatures; live mode retains it.
- Direct eval, prototype mutation, proxies, and arbitrary property redefinition
  cannot operate unchecked on strict layouts. Initial strict-mode exclusions and
  explicit dynamic handles are preferable to silent semantic changes.

## Cross-profile boundaries

Primitive values may be checked and unboxed. Data may be validated and copied into
native-owned records when copying is part of the API contract. Shared identity
requires a different strategy:

- Native-owned objects exposed dynamically need controlled writes that preserve
  their contracts.
- Arbitrary dynamic objects remain dynamic handles with checked accesses unless
  Tint controls all operations that can invalidate their representation.

A one-time shape check does not make an aliased mutable object permanently safe.
Recursive types, callable values, getters, proxies, and external aliases prevent
a universal trivial `validate<T>` solution. Boundary support should be explicit
about which contracts can be established and maintained.

## Conformance references

- [TypeScript narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html)
- [Type assertions](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#type-assertions)
- [Structural compatibility and soundness](https://www.typescriptlang.org/docs/handbook/type-compatibility.html)
- [Strict function types](https://www.typescriptlang.org/tsconfig/strictFunctionTypes.html)
- [Checked indexed access](https://www.typescriptlang.org/tsconfig/noUncheckedIndexedAccess.html)
- [Exact optional properties](https://www.typescriptlang.org/tsconfig/exactOptionalPropertyTypes.html)
