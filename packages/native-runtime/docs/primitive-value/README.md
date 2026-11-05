# Primitive values

Dependency-free TypeScript operations for a baseline managed representation of
`undefined`, numbers, booleans, and strings. Constructors initialize a tag and all
payload fields. Extraction validates the tag; strict equality and SameValueZero
compare payloads rather than box identities.

The ordinary native record layout is 48 bytes on the current 64-bit target. Its
optional string field uses existing managed-reference tracing. Numeric and
boolean payloads never masquerade as pointers. This intentionally simple layout
can later be replaced or eliminated by representation specialization.

The public record is a compiler/runtime contract: consumers must use the
constructors to establish valid tags and payloads. It is not a validator for
arbitrary external objects. This slice excludes null, symbols, bigints, and
objects; it does not claim a complete ECMAScript value representation.

Explicit `PrimitiveRuntime` bindings connect these functions to source-union
lowering. Runtime preparation registers the bindings when this package is linked.
The IR distinguishes primitive boxes from ordinary object references, includes
them in root maps, and rejects raw pointer equality/truthiness for them.

Native fixtures cover function arguments/results, narrowing, `typeof`, strict
equality, truthiness, nullish coalescing, mixed primitive arrays/Sets/Maps,
SameValueZero, and Set insertion's negative-zero canonicalization. Each checks
exact allocation and exhaustion accounting. This is baseline representation
support, not completion of all union operations or the dynamic profile.
