# Initial strict-checking rules and cases

Status: proposed version 0 decisions for structural checking. The initial
[scalar checker](../packages/ts-checker/README.md) now verifies lexical binding,
initialization, scalar types, direct calls and return paths. The structural examples
below remain test specifications, not executed tests. These rules apply to the ordinary strict profile, including Tint's
own source. Trusted intrinsics remain a separate explicit capability boundary.

## Writable views are invariant

A writable field/element view must preserve its read, write and presence contract.
Structural width subtyping remains possible when shared writable members have the
same contracts. Readonly views may widen readable types but cannot make a mutable
object globally immutable or authorize adding writes through a later conversion.

```ts
const a: { value: number } = { value: 1 };
const bad: { value: number | string } = a; // S01 reject: writable widening
const good: { readonly value: number | string } = a; // S02 accept
const writable: { value: number | string } = good; // S03 reject: adds write authority
```

Apply the same rule to arrays, nested mutable members, generic fields and function
parameters. Readonly is shallow: readonly access to a mutable child still exposes
that child's declared operations. A readonly reference may observe another alias's
writes; narrowing its properties is therefore subject to effects.

Native lowering gap: returning a record with a concretely encoded `value` field
through a result contract whose `value` is `unknown` can preserve the concrete
field encoding instead of converting it. The BigInt arithmetic adapter exposed
this for both optional BigInt and Number results. It currently constructs a new
result at that boundary, which explicitly boxes the field; direct structural
return adaptation still needs a compiler regression test and correction. This
is an implementation defect, not an intentional restriction on readonly widening.

Function inputs are contravariant and outputs covariant under these stricter member
rules. Do not retain a method-parameter bivariance exception. Class inheritance later
uses these rules too; general class lowering is not required for first source.

## Correlated union fields

Construct complete variants and replace union variables. Initially prohibit writes
to discriminants or other fields whose change would invalidate an established
variant/alias contract. Mutations preserving the current variant remain legal.

```ts
type Node = { kind: "text"; text: string } | { kind: "count"; count: number };
let node: Node = { kind: "text", text: "a" };
node = { kind: "count", count: 1 }; // S04 accept: whole value replacement
if (node.kind === "count") {
  node.count = 2; // S05 accept
  node.kind = "text"; // S06 reject: invalid correlated mutation
}
```

A writable structural view cannot hide a correlation and then mutate its protected
fields. Attach write constraints to the originating storage contract and preserve
those constraints through views/generics. If a proposed view cannot express them,
reject that conversion or expose it readonly. Copying an object is not a silent fix
for an identity-preserving conversion.

## Presence, indexing and initialization

Required properties cannot become deletable through a view. Optional property reads
include undefined; assignment of explicit undefined requires that member's value
type to include it. Absence and present-undefined remain different states.

```ts
const required: { x: number } = { x: 1 };
const deletable: { x?: number } = required; // S07 reject: grants deletion
const optional: { x?: number } = {};
optional.x = undefined; // S08 reject
optional.x = 1; // S09 accept
delete optional.x; // S10 accept: optional storage owns this contract
```

An optional readonly view of a required member is safe for reads. A required member
view of genuinely optional storage requires stable presence proof, not a one-time
check that another alias can invalidate. Initially prefer a checked local snapshot.

```ts
function first(xs: number[]): number {
  const x = xs[0];
  if (x === undefined) throw "missing element";
  return x; // S11 accept
}
function bad(xs: number[]): number {
  return xs[0]; // S12 reject: possibly missing
}
```

A bounds check alone does not prove a normal array element is present: arrays can
have holes. Refinement requires presence/density evidence as well as stable bounds.
Initialize locals/fields before reads; postfix non-null or definite-assignment
assertions cannot supply missing proof. Checked access retains ordinary runtime
errors/values for supported operations rather than performing unsafe loads.

## Refinement across effects

Unknown calls invalidate affected mutable-storage refinements, including captured
locals the call can change. A readonly view does not suppress this invalidation.
Retain facts about immutable snapshots when their underlying value cannot change.

```ts
function read(box: { value: number | string }, change: () => void): number {
  if (typeof box.value === "number") {
    const snapshot = box.value;
    change();
    const invalid: number = box.value; // S13 reject: possibly changed
    return snapshot; // S14 accept when the rejected line is removed
  }
  return 0;
}
```

Track assignment and aliases within a function; start conservatively for calls.
Verified effect summaries can preserve facts later. For an initial safe pattern,
load, test and use the local value, or repeat a check after the call. Property access
that can invoke user code must carry those effects as well.

## Assertions, unknown and any

`as T` is accepted only if strict assignability already proves the conversion safe.
It neither performs validation nor establishes missing facts. Apply this transitively:
`as unknown as T` cannot manufacture proof. Safe structural views need compatible
layout access even when source types are assignable.

```ts
function checked(x: unknown): number | undefined {
  if (typeof x === "number") return x; // S15 accept
  return undefined;
}
function unchecked(x: unknown): number {
  return x as number; // S16 reject: unproved assertion
}
```

Initially reject explicit/implicit `any` in strict source and imported signatures
reached by strict source. Use `unknown` plus supported checks, or a deliberately
specified dynamic handle boundary later. This is an initial strict restriction,
not a ban in live mode. Never treat an ambient declaration as proof of implementation.

Reject user-defined `x is T` and `asserts` declarations initially. Boolean helpers
remain usable but do not narrow callers unless Tint independently proves the relation.
Returning a constructed/checked value such as `T | undefined` remains supported.
`as const` and `satisfies` may retain their safe static meaning when implemented;
neither establishes deep immutability or bypasses writable alias checks.

## Structural views and external boundaries

Accept unrelated structural types when all exposed operations are safe; inheritance
is not required. Store field-mapping/layout metadata or specialize access as needed.
Identical field names or bytes alone are not proof. Never turn an arbitrary base
class instance into a subclass solely because the classes are related.

Strict-to-strict calls require checked implementations and compatible signatures.
Foreign imports require the trusted manifest. Live-to-strict calls require explicit
boundary adapters; initial self-hosting does not require arbitrary live-object imports.
A successful shape check cannot promise that all aliases will preserve that shape.

## Evidence and diagnostics

Give each case a distinct test with one intended error and a nearby accepted repair;
the combined snippets above are explanatory. Add counterexamples through generic
helpers, readonly nesting, hidden union views and callbacks. Test runtime behavior of
accepted cases against type-erased execution and ensure rejected programs emit no code.

Use diagnostic categories such as unsafe writable conversion, unproved narrowing,
missing presence, invalid correlated write and unsupported feature. Include the
operation and missing guarantee. Unsupported classes or advanced type syntax are
coverage gaps, not evidence that those constructs are unsound.
