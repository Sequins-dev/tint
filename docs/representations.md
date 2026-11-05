# Value representations

Status: proposed design following the decision to support stricter native layouts
and general dynamic encodings. Exact sizes, tags, and ABIs are not yet fixed.

## Shared semantics, different storage

The compiler must distinguish a source type, established facts about a value,
and its physical representation. Sharing the pipeline does not require identical
encodings across strict and compatible code.

The intended defaults are fixed, type-directed storage in strict code and a
general tagged value model in compatible/live code. These defaults follow the
language contract, not whether code is emitted into a file or memory. Strict
runtime-compiled functions can use fixed layouts; compatible AOT functions may
still require dynamic values. Proven or guarded specialization can improve either.

Representation selection belongs in a shared lowering stage. Semantic IR should
not prematurely require every value to occupy a generic tagged slot.

## Strict representations

Use direct representations where the language contract establishes them:

- Numbers: initially binary64 with JavaScript numeric semantics, not implicit
  fixed-width integer arithmetic.
- Booleans: a compact scalar, with register and memory layouts chosen separately.
- Strings and heap objects: managed references to known runtime layouts.
- Records: known field offsets and field representations, normally heap allocated
  when identity or aliasing matters.
- Unions: a finite tag plus a payload capable of representing admitted alternatives.
- Optional fields: presence information distinct from an explicitly undefined value.
- Closures: a code entry plus an environment whose layout is known or described.

An exact record layout can store numeric fields directly rather than in generic
value slots. This does not mean every structural interface names one exact layout.
For example, `{ x: number }` may describe views into several concrete records.
The compiler can specialize such a use or pass a layout/view descriptor; structural
assignability does not establish identical offsets.

Keep semantic type identity separate from layout identity. Multiple types may
share a representation, and one source type may have several proven-safe layouts.
Fixed layouts do not imply stack allocation or copying reference-like objects.

## Dynamic values

Use a general `Value` abstraction capable of representing undefined, null,
booleans, numbers, strings, symbols, bigints, and object references. A tag describes
a runtime value category, not an arbitrary TypeScript interface or erased type.
Functions are callable objects with appropriate runtime metadata.

An explicit tag and payload is a candidate general-boundary encoding, not a rule
that every live value physically carries a tag. The concrete encoding remains
open. Runtime evidence can reside in value bits, object/shape headers, side
metadata, or an established storage/calling contract. Proven or guarded regions
can use untagged scalars. NaN boxing, pointer compression, and other packing
techniques can be evaluated without changing language semantics.

This is not necessarily a heap-allocated wrapper for each value. Primitive tags
and payloads can occupy registers, stack slots, or object slots directly. References
point to managed objects. The representation must preserve numeric details such as
negative zero and NaN behavior.

The representation of `Value` supports broad live behavior alongside retained
[runtime type contracts](runtime-types.md). Expectations guide guarded specialization;
violations can warn, deoptimize, and widen the effective runtime domain and storage.
A warning cannot authorize continued execution with an invalid representation.
Expected contracts need not be stored inline on values.

## Dynamic objects need more than a tag

A generic object value refers to storage whose runtime metadata describes how
properties behave. A proposed ordinary-object representation contains:

- A stable object identity and GC metadata.
- A shape/layout descriptor for property keys, slot locations, and attributes.
- A prototype reference and extensibility state.
- Property storage, initially general `Value` slots.

Descriptors must distinguish data properties from accessors and preserve property
attributes. Complex mutation can transition to dictionary-like storage. Arrays
need length and hole semantics; functions, proxies, typed arrays, and other exotic
objects require their own behavior. An object tag alone does not implement these.

Property insertion, deletion, attribute changes, and prototype changes must be
represented explicitly. A shape describes a runtime object's storage/behavior;
it is not the source-level TypeScript shape used for assignability.

Initial shared shapes can describe keys and slots without fixing each slot's
value type. If later layouts specialize slot types, type-changing writes must
transition the layout or take a supported general path. All aliases must continue
to observe the same object identity and correct values.

Generic operations implement property lookup, prototype traversal, accessor calls,
coercion, and exceptions. Specialized code may bypass parts of these operations
only when its guards or proofs establish equivalent behavior. A shape check alone
does not validate an entire mutable prototype chain or authorize ignoring a proxy.

## One lowering vocabulary

Semantic IR expresses language operations such as reading a property or adding
two values. Lowering selects typed instructions or shared general operations:

- A known numeric record field becomes a field load at a proven offset.
- An unknown object property becomes general lookup, with optional guarded fast paths.
- Addition of established numbers becomes floating-point addition.
- General addition performs the required conversions and string/numeric behavior.

Native IR makes representation changes explicit: tag tests, box/unbox operations,
union injection/projection, layout checks, view construction, and ABI adapters.
Boxing a scalar into a `Value` need not allocate; adapting an object may require
metadata or an explicitly defined wrapper/copy contract.

The same lowerings are available to AOT and runtime compilation. Avoid separate
strict and dynamic backends with duplicated arithmetic, calling, or GC machinery.

## Boundaries and identity

Primitive crossings are comparatively simple: construct a tagged value or check
its category and extract a scalar. A checked conversion's failure behavior must
be specified, rather than allowing a mismatched tag to reach a raw native load.

Objects have three useful boundary policies:

1. Explicit copy: validate and construct a strict record, intentionally creating
   independent storage. This cannot silently implement an identity-preserving call.
2. Shared dynamic handle: retain the original object and use checked operations.
   Suitable for arbitrary compatible objects and their existing aliases.
3. Controlled strict-object exposure: expose native-owned storage through a runtime
   descriptor or stable wrapper that enforces valid operations on every write.

The third policy cannot simultaneously promise unrestricted mutation and an
unchangeable strict layout. Incompatible writes must fail under an explicit API
contract, or the implementation must promote/generalize storage and invalidate
all dependent code assumptions. The initial proposal is explicit controlled
exposure, not transparent promotion of arbitrary aliased strict records.

Such an exposed strict object has an explicit interop contract. Live objects instead
support warn/deopt/generalize behavior when an expected type is violated, with
coordinated storage and code transitions. This does not automatically permit
promotion of externally exposed fixed strict/C ABI layouts.
Wrapper identity, repeated crossings, equality,
and collection require a canonical policy; never create unrelated wrappers on
each crossing when the contract promises shared identity.

Calls need adapters as well as values. A dynamic entry can accept general values,
validate arguments, preserve receiver/call semantics, invoke a specialized strict
entry, and encode its result or exception. Callback and return paths require the
same checks. An entry signature's representation is part of its ABI, not just its
TypeScript signature.

## Optimization and GC

Dynamic code can use direct scalars and field accesses within proven or guarded
regions. It does not need to remain boxed everywhere. Profiles suggest candidates;
guards and dependency tracking make them valid. Strict code generally obtains
more of these guarantees statically.

### Runtime evidence versus compiler knowledge

The IR can know that a particular SSA value is `f64`, so its register or stack slot
needs no runtime type tag. A specialized call can pass raw doubles when the caller
has established that the callee's entry contract is satisfied. Object field types
can likewise be implied by a validated layout descriptor rather than per-field tags.

At an unconstrained dynamic boundary, however, there must be sufficient runtime
evidence to distinguish actual representations. Compile-time metadata alone cannot
identify whether arbitrary incoming bits mean a double, reference, or another value.
Guards inspect real evidence, such as a value category, object shape, or protected
dependency. Do not jump to an unboxed ABI and only discover a mismatch afterward.

One function can have a stable general entry and several specialized versions.
A dispatch stub checks a bounded set of known cases, unboxes/adapts inputs, and
selects a version. Proven callers may bypass the stub through a compatible direct
entry, subject to code-version and dependency tracking.

### Misses, fallback, and recompilation

A newly observed category or shape can miss a dispatch/inline cache or fail an
optimized guard. These are different events from a mandatory optimizer invocation:

1. Preserve semantics immediately through a general operation or baseline version.
2. Record the observed category/shape and miss reason.
3. Reuse an existing specialization, extend a small polymorphic dispatch, or retain
   the general path.
4. Recompile when hotness and stability justify the time and code-size cost.

Bound specialization counts and compilation budgets. Repeatedly changing call
patterns should converge on general behavior rather than endless recompilation.
A new source-level type does not necessarily require new code if its representation
and relevant behavior match an existing case.

An entry miss can choose a different version before execution starts. A guard
failure inside an optimized frame may instead need state reconstruction and
deoptimization. Resuming must not repeat prior side effects. Prototype changes,
accessors, callbacks, or mutations can invalidate assumptions after entry; argument
checks alone do not cover them.

V8 provides useful precedents for runtime feedback, shape guards, representation
selection, and deoptimization. It also retains runtime tagging and object maps;
unboxed optimized values do not mean type information exists only in the compiler.
Tint can adopt these mechanisms without committing to V8's execution tiers or
expecting equivalent performance without measurement.

Value materialization metadata must describe how optimized scalars, unions, and
eliminated allocations reconstruct baseline state, if deoptimization is added.
Code-version replacement must preserve the stable entry ABI or install adapters.

Both representation families share a heap/GC contract. The collector needs tagged
value tracing and layout-driven tracing of strict fields and active union payloads.
Safepoint metadata identifies direct references, tagged slots, and live layouts.
Any future write barriers must cover stores from both profiles and their adapters.

## First experiments and unresolved decisions

Validate a record with two numeric fields in strict and compatible representations;
show direct native loads in one and correct general lookup in the other. Then
exercise a union change, incompatible mutation, callbacks, repeated object crossings,
GC, and code replacement. Compare memory and file outputs using the same lowering.

Still open: exact tag encoding, object-header and shape design, structural view ABI,
union layout, controlled-exposure API, callable adapters, and the mechanism for
live-layout generalization. Promotion of fixed strict/foreign layouts remains a
separate question. None requires choosing a bytecode tier now.

## Reference material

- [V8 Maglev: feedback, guards, representations, and deoptimization](https://v8.dev/blog/maglev)
- [V8 maps and hidden classes](https://v8.dev/docs/hidden-classes)
- [V8 pointer compression and tagged values](https://v8.dev/blog/pointer-compression)
