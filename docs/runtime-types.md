# Runtime type contracts

Status: agreed warn/deopt/generalize direction with proposed mechanisms. Runtime
type vocabulary and the transition implementation remain open.

## Goal and compatibility

Tint should extend TypeScript type information into runtime checking and
optimization, rather than treating every type as erased after checking. Live code
can retain expected type contracts and specialize code for them. When a value
violates an expectation, live mode can warn, deoptimize, and generalize the code
and storage to accommodate it. Rejecting every mismatch is not the intended policy.

Dynamic mode preserves ordinary JavaScript execution semantics, including behavior
when TypeScript assertions or unsound checking permit a type violation. Retained
type information guides optimization and optional diagnostics; it does not impose
additional runtime acceptance rules. No separate erased policy is needed to obtain
this behavior. A cast is not a runtime conversion or a new throwing validation.

Recovery protects execution from invalid compiler assumptions, not from ordinary
program errors. Preserve JavaScript results, coercions, identity, effects, and
exceptions. A mismatch itself must not introduce a new TypeError, but a subsequent
operation can still throw exactly as it would in JavaScript. Diagnostic emission
is separately configurable and must not affect program control flow or values.

## Distinct type and representation information

Keep these concepts separate even if implementations share interned metadata:

- Declared type contract: the source-level expected values and operations.
- Effective runtime domain: the cases supported by a storage/code version, which
  can widen beyond the declared expectation.
- Runtime layout: where fields/payloads live and how to access/trace them.
- Optimization facts: what is established or speculated at a particular program point.

A semantic contract need not be stored inline on every value. It may belong to a
typed storage location, object descriptor, closure/signature, or module export.
Type/layout references and checks can be eliminated where the compiler proves them
unnecessary. A value may satisfy several structural types; it need not have a unique
nominal "actual TypeScript type."

## Unknown values and representation-preserving views

TypeScript checking and control-flow narrowing define which source operations are
available. Runtime representation choices must not introduce arbitrary additional
assignment restrictions. An `unknown` value can be a primitive or an object;
it is an opaque value, not necessarily a pointer. Narrowing through `typeof`,
`instanceof`, and other supported TypeScript checks can authorize operations
without a source assertion. Retained runtime evidence selects the appropriate
representation-dependent access; it need not reproduce every source type.

An `unknown[]` is different from `unknown`: its array operations are available,
while each element has an unknown type. For example, assigning `number[]` to
`readonly unknown[]` must preserve the original array identity and aliases. A read
through that view loads using the actual numeric storage representation and
encodes the result as a general value. It must not reinterpret numeric backing
storage as general-value slots, copy the array, or prevent writes through another
valid alias. Nested properties and function argument/result variance require the
same representation-aware treatment.

The implementation can erase static knowledge while retaining a layout descriptor,
use a compatible shared representation, or introduce internal access adapters.
Such adapters must not become observably distinct JavaScript objects. Narrowing
and assertions do not themselves convert storage. A TypeScript assertion alone
is not evidence that a raw native load is safe: live code must guard or generalize
as needed while preserving JavaScript behavior; strict-profile restrictions must
identify actual unsoundness rather than merely inconvenient storage layouts.

## Speculative union contracts

A location declared as `number | string` initially supports either alternative.
A number-to-string assignment fits the expectation. Forcing an object through a
cast can warn and trigger generalization to accommodate the object. The source
declaration remains unchanged while the effective runtime domain widens. Guards
and dependency invalidation protect specialized assumptions during this transition.

An observed numeric value is still a stronger, potentially speculative fact than
the number-or-string expectation. Numeric specialization can bail out on a valid
string without a type-violation warning. An object requires broader generalization.

## Enforcement sites and aliases

Candidate checks include initialization/assignment, typed field writes, call
arguments and results, module boundaries, and checked casts. Static proof can
remove checks. Runtime-owned layouts and storage contracts must ensure that aliases,
callbacks, reflection, and property-definition paths cannot bypass required checks.

A one-time structural validation does not protect a mutable object with external
aliases. Options include controlled storage, mediated access, or explicitly copied
values. Proxies/getters require semantic validation and continued access checks,
not blindly reading raw fields. Specialized calls/results need representation
guards and recovery; inspecting a function cannot prove all its future behavior.
Checks must not invoke extra getters/proxy traps or repeat coercions merely to
diagnose a source type. Prefer existing representation evidence; omit a diagnostic
when inspecting it would change observable execution.

Adding an expected contract to an aliased object must not silently narrow another
alias's permitted writes. Layout/dependency metadata or mediated access must let
violating writes invalidate all affected specializations, not just the writer.

## Diagnostics versus guarantees

A failed cast can diagnose the source location, expected contract, and actual
category/shape. The intended response is warning plus deoptimization/generalization,
not continued execution of invalid specialized instructions.

The transition must detect the mismatch before unsafe representation-dependent
operations, invalidate dependent assumptions, recover active state where needed,
generalize storage, and resume through code capable of handling the actual value.
The operation must complete exactly once without replaying earlier side effects.
Write commitment, layout publication, and invalidation must be coordinated so no
alias or callback observes a layout using stale code assumptions.

Changing code alone cannot fit an object into storage reserved for a raw double.
Live storage needs a generalization mechanism, such as stable object identity with
replaceable backing storage, or general slots with specialized accesses. Selecting
this mechanism is an implementation decision still to be made.

An existing general version may cover the new case; otherwise the shared pipeline
generates a widened version. Bound recompilation and warning repetition for unstable
inputs. Entry misses can dispatch before execution starts; mid-function failures
need state recovery. Generalized code preserves ordinary operation semantics,
including errors for invalid operations; it does not coerce values into their
asserted types or guarantee the rest of the program cannot throw.

This does not automatically relax strict-profile assertion rules. Strict mode can
continue rejecting unproven assertions. In live mode, assertions remain semantic
no-ops apart from optional diagnostics and transparent optimization machinery.

## Reifying types without copying the entire checker into values

Proposed initial runtime vocabulary: primitive categories, literal values, unions,
records with optional/read/write contracts, arrays/tuples, references, and callable
contracts. Recursive descriptors need cycle handling and efficient identity/caching.
Type-level expressions can often be resolved by the compiler into this vocabulary;
the runtime need not interpret their original syntax.

Unresolved generics may require a descriptor argument, a specialization, or explicit
constraints. Arbitrary conditional/mapped types, recursive structure, and higher-order
contracts need defined support limits. Do not promise a universal finite deep check
for every TypeScript type. If a type cannot be checked transparently, use general
execution or narrower operational guards rather than rejecting valid dynamic code
or silently claiming a proof. Missing diagnostic precision is not a language error.

User-authored type predicates cannot create trusted contracts by annotation alone.
Generated validators and compiler-established checks may do so. The earlier proposed
strict-profile predicate exclusion remains unchanged pending a separate decision.

## Bootstrap priority

The first deliverable is the strict-profile self-hosted compiler. Retain the type
information and IR boundaries needed for runtime contracts while building it;
complete live-mode reification and diagnostics must not delay self-hosting.

After self-hosting, validate recovery with union changes, aliasing, foreign
values, callbacks, and warn/deopt/generalize casts. Compare general and optimized behavior
against type-erased JavaScript execution. Include coercions, ordinary exceptions,
getter/proxy call counts, and exactly-once effects across bailouts. Compare optional
diagnostics separately from program results and observable language behavior.
