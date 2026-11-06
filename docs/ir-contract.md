# Initial IR and verifier contract

Status: proposed version 0, with an initial semantic scalar subset implemented in
[scalar-ir](../packages/scalar-ir/README.md) and
[scalar-lowering](../packages/ts-native/README.md). The subset uses typed slots
across blocks and block-local SSA values; block parameters, representation/machine
IR, effects beyond scalar direct calls and root lowering remain unimplemented.
[Scalar AArch64 emission](../packages/scalar-aarch64/README.md) now performs a direct
scalar storage/ABI/selection pass without a separately materialized machine IR. This makes the existing semantic,
call, memory and intrinsic contracts concrete without choosing a second language
or an interpreter tier. Linux is the intended primary platform; macOS is only the
first physical lowering. See the [platform roadmap](platform-roadmap.md).

## Three levels, one infrastructure

Use a shared graph/container/verifier infrastructure with three explicit operation
sets. Do not implement three unrelated compiler frameworks.

1. Semantic IR: language values, bindings, properties, calls and completions. Retain
   source types separately from established facts and representation choices.
2. Representation IR: SSA values with actual storage types, explicit runtime calls,
   managed accesses, guards, exceptional edges and safepoint requirements.
3. Machine IR: target instructions, virtual registers, register classes, call
   clobbers, frame slots and symbolic fixups. Register allocation and final layout
   resolve these constraints before encoding.

Initially every level is an in-memory TypeScript graph. A serialized IR or bytecode
format is optional later work. Operations use stable numeric IDs internally with
human-readable dump names; source locations survive lowering. One module contains
functions, globals, constants, layout/signature references and ESM binding records.
Keep functions independently verifiable; do not require whole-program optimization.

A function has a signature, entry block and basic blocks. Each block has typed
parameters, an ordered instruction list and exactly one terminator. Branch operands
supply destination parameters instead of separate phi nodes. SSA definitions dominate
uses. Loop backedges are explicit. Locals can begin as cells/stack slots and later
be promoted to SSA; native correctness must not depend on a sophisticated SSA builder.

## Operation vocabulary

Semantic operations initially cover constants, arithmetic/comparison/conversions,
binding initialize/read/write, closure creation, module binding access, allocation,
property/element read/write, presence tests, union construction/narrowing, calls and
throw/return. Short-circuit expressions become control flow, preserving evaluation
order. Distinguish general addition from proven Number addition and string concatenation.

Representation types initially include `bool`, `f64`, fixed-width integer bits,
`usize`, `ref(layout)`, nullable references, `value` (general ECMAScript value),
`sum(layout)`, scoped raw pointers, and typed slot addresses. Machine integers and
pointers are not ordinary source Number values. `ref(layout)` names a storage
contract, not the complete TypeScript type. Structural views carry the metadata
needed to find fields safely; source assignability alone does not prove offsets.

Initial representation operations include:

- Pure scalar arithmetic/comparison and explicit language-to-machine conversions.
- Union inject/test/project, general-value pack/category-test/unpack, and view access.
- Managed allocate, field/element load/store, binding-cell operations and closure
  initialization. Allocations name verified layouts; stores remain identifiable
  as managed operations for later write barriers.
- Runtime calls for strings, collections and general language behavior that has
  not been lowered to proven direct operations.
- Trusted word/region/foreign operations from the finite intrinsic registry.
- Root-slot updates and completion publication introduced by root/call lowering.

Loads name their owner, layout/view, field or index, access type and relevant proof.
They do not become arbitrary pointer arithmetic until a later verified lowering.
Keep owner-plus-offset information for interior accesses across analysis; raw interior
addresses may not survive invalidating effects or collecting/reentrant calls.

Do not encode operating-system file descriptors, errno, Mach-O imports or Apple
registers in semantic operations. Host calls name logical services or manifest imports;
target adapters supply physical lowering.

## Control flow, calls and completion

Terminators are branch, conditional branch, switch, return, throw, invoke and
unreachable. Switch cases must be disjoint and have a default or a verified exhaustive
domain. Unreachable requires proof or a terminating trap; it cannot disguise an
unsupported construct.

An `invoke` identifies the callable entry/signature, context, environment, receiver,
ordered arguments and effect summary, with normal and throw successors. Successor
parameters receive the typed result or arbitrary thrown value. A proven non-throwing
call may be an instruction; it can still allocate and require a safepoint.
General and typed entry adapters use this same representation.

At semantic level return/throw are language completions. Call lowering implements
them with caller-owned result storage and explicit state/status, as in the
[call contract](call-contract.md). Logical result SSA values do not imply that the
physical return uses registers. Machine IR records the concrete target convention.

Finally lowering stores a pending completion in typed rooted slots and routes each
exit through cleanup. A nested call has different result storage; it cannot overwrite
the pending value. Break/continue retain destinations across cleanup. IteratorClose,
when supported, has its own specified precedence rather than a generic cleanup rule.
No native exception unwinder is required for Tint language throws.

## Effects and facts

Instructions remain ordered within blocks. Each operation declares reads, writes,
managed allocation/collection, language throw, reentry, host interaction and possible
termination. Unknown calls conservatively include all applicable effects. Version 0
uses ordering and conservative effect checks rather than requiring memory SSA or
an effect-token value threaded through every operation.

Optimizations may reorder or remove operations only under checked dependence and
effect conditions. A property load may call a getter; a bounds error may allocate
an exception. Such operations cannot be marked pure merely because their common
case is a load. Imported intrinsic summaries come from the verified registry.

Facts have provenance: static proof, dominating check, or a guarded dependency.
Source annotations in live mode are expectations, never evidence that permits an
unboxed load. Profile data suggests a specialization; it does not establish its
preconditions. For mutable storage, effect analysis invalidates affected facts.
Initially invalidate conservatively at unknown writes/calls; retain safe snapshots
of already-loaded primitive values rather than trusting a stale object refinement.

Associate fact-dependent operations with the applicable proof/guard ID. The verifier
checks dominance, domain and invalidation. Arbitrary metadata saying "proven" cannot
suppress a check. Restricted trusted operations carry their capability and preconditions
explicitly and remain identifiable in dumps and diagnostics.

## Safepoints and roots

Perform reference liveness on normal and exceptional CFG edges after representation
lowering. Assign shadow slots for values that must survive a potentially collecting
operation, including references embedded in sums/general values. Model arguments
already evaluated, environments, indirect aggregate arguments and pending completions.

Before a safepoint, materialize live roots and clear dead slots or select an exact
trace state. Register result storage in Empty state before invoking a callee. On
return, preserve the published result until its references have other roots. Root
lowering verifies both successors and all frame exits. Non-moving GC simplifies
address updates; it does not remove liveness obligations.

After root lowering, an optimization that changes reference liveness, layouts,
collecting calls or control flow must rebuild and reverify root information. Machine
register spills are not automatically GC roots. The final verifier checks that stack
slot placement still matches descriptor offsets and that every exit unlinks its frame.

## Shared optimization and live recovery

Each compilation request includes target, language profile, optimization budget,
feedback and allowed assumptions. AOT and runtime compilation execute the same passes.
Start with correct direct lowering; no speculative optimizer is needed for self-build.

Reserve guard IDs, dependency records, code-version IDs and state-reconstruction
metadata in the IR model. Entry guards can dispatch to an existing general entry
before any callee effects occur. Mid-function guards need a valid continuation and
reconstruction of values, roots and pending completions at that exact point.

Until reconstruction exists, reject mid-function speculative lowering that needs it
or retain the general operation. Never restart the function after observable effects.
Baseline recovery may itself be native code from this pipeline. Code replacement
must keep active frames and their referenced metadata alive; fresh code publication
is separate from redirecting future calls.

## Verifier gates

Run these checks at construction/lowering boundaries and after transforming passes:

1. Graph: unique definitions, dominance, block arity/types, terminators, reachable
   successor structure, declared signatures and valid symbol references.
2. Semantics: binding initialization checks, evaluation order, correct normal/throw
   routing, missing/extra argument behavior and completion-aware cleanup.
3. Representation: compatible layouts, bounded accesses, validated projections,
   proven conversions and no untracked raw/managed pointer reinterpretation.
4. Effects/capabilities: conservative call summaries, noGC/noReentry obligations,
   borrow scope, fact invalidation and authority for intrinsic operations.
5. Lifetime: valid initialization before publication, full safepoint roots, descriptor
   agreement, result handoff, and balanced shadow-frame lifetime on all paths.
6. Machine: legal operand classes, reserved registers, preserved registers, call
   clobbers, stack alignment, slot offsets, instruction constraints and checked fixups.

Verification checks compiler invariants, not complete semantic equivalence. Keep
Node/native behavior tests, exact encoding tests and negative IR fixtures separately.
Verification failure is a compiler diagnostic with function/block/operation and source
location; do not emit a partly valid executable. An unsupported operation is a coverage
diagnostic, not permission to insert a semantic approximation.

## First executable fixture

Lower a function that selects between a Number and a reference-bearing union,
calls an allocating helper, then returns or throws through finally. Inspect semantic,
representation and machine dumps; force GC at the helper and cleanup call. Verify
both completion paths and rejection of a deliberately missing root or invalid projection.

Precede it with scalar/call fixtures to bring up the encoder, but use this combined
fixture before depending on the pipeline for compiler graphs. Add a target-neutral
layout fixture with different pointer/alignment parameters to catch host leakage;
that does not count as Linux or Windows execution support.

### Current scalar receiver lowering

`FunctionIR.receiverSlot`, when present, names a general-value local initialized
on entry independently of positional parameters. It must not alias a parameter
slot. `call` and `call-indirect` may supply a general-value SSA operand in
`receiver`; omission supplies undefined. Receiver operands participate in ordinary
operand visitation, liveness and substitution. Slot compaction remaps the entry
slot, while slot promotion and inlining conservatively retain its entry semantics.

The AArch64 implementation passes a pointer to caller-rooted storage in `x2` and
copies the value into the callee before safepoints. It never retains the pointer
into the caller frame. General-value root descriptors cover the callee storage
when a root frame is required. Source method calls preserve the property reference and use this contract.
Lexical arrows capture an immutable typed receiver cell in the existing owned
closure environment; their call-site receiver does not replace that capture.

### General null and primitive conversions

Mixed primitive unions use the existing 16-byte `general` tag/payload storage
in native function arguments, results, locals and record fields. Numeric,
boolean and string values no longer require a managed wrapper at those
boundaries. Homogeneous scalar and optional scalar/string representations stay
specialized. Nullish coalescing on `general` tests undefined and null separately,
preserving false, zero, NaN and empty strings and evaluating its fallback lazily.

`general-null` constructs a general value with category 4 and a zero payload;
`general-none` constructs undefined with category 0. Neither allocates or carries
a GC reference. `general-wrap` continues to accept concrete number, boolean,
string, and reference operands only. Managed primitive unions must be classified
and unpacked before constructing a general value; their container pointer is not
the semantic value and must not be wrapped as an object.

Representation conversion can introduce control-flow blocks. Call arguments and
general comparison operands therefore retain converted values in slots and reload
them at the final operation, rather than retaining block-local SSA IDs across a
conversion's branches. Existing compatible argument slots can be reused.

Unary `truthy` and `!` accept general operands and inspect their category and
payload. Undefined, null, false, either numeric zero, NaN, and empty strings are
falsy; objects and symbols are truthy. The AArch64 implementation performs no
allocation or user calls. Other unary operators still require concrete payload
lowering. BigInt truthiness awaits the native BigInt payload contract and is not
silently approximated by testing a pointer.

### Checked general record identity

`general-record-is(value, record)` returns a boolean without extracting a pointer
from non-object categories. For object values it compares the managed header's
descriptor identity with the specified module record. The descriptor index is
verified; null payloads and other record layouts return false. It reads managed
metadata but does not allocate, invoke user code, or throw. This is an internal
representation guard, not structural TypeScript assignability or JavaScript
`instanceof`. A successful check can justify a subsequent general reference
extraction and access using that record's layout; callers must preserve the
checked value and descriptor association.

`CompileRequest.recordBindings` (also exposed by `BuildRequest`) explicitly names
trusted exports from declared runtime modules. Each must be a module function
with signature `(value: unknown, witness: ConcreteRecord) => boolean` for the
`test` operation or `=> ConcreteRecord | undefined` for `view`, with no default
parameters, captured environment or receiver. Lowering replaces only registered
functions using the predicate and the witness parameter's statically planned
record descriptor. The witness is a type/layout anchor; it is not used to compare
object identity and ordinary argument evaluation still occurs. Invalid signatures,
unknown exports and duplicate registrations are rejected. No function name grants
this capability by itself. A view validates that its declared result matches the
witness's semantic type in both assignability directions and its physical layout.
Only the successful branch extracts and wraps the original reference; the failing
branch returns undefined. The view preserves identity and aliases, allocates no
replacement object, and cannot assert a narrower semantic type such as a literal
field merely because it has the same storage encoding.
