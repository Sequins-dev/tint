# Logical call contract

Status: accepted baseline defaults, with illustrative lowering traces. The initial
scalar compiler implements closed, nonallocating typed calls using the physical ABI
in [macOS arm64 target](macos-arm64-target.md). General calls, managed results,
exceptions and descriptors remain future work. Examples below specify the broader
behavior, not claims of implemented coverage.

## Scope

Use the same logical call machinery for strict and live code. Representation
differences are explicit entry signatures and adapters. The contract composes with
[memory and lifetimes](memory-and-lifetimes.md) and the
[semantic baseline](semantic-baseline.md).

It preserves source-level evaluation and call behavior. Default/rest/receiver
handling occurs where required; optimizations omit it only with proof. Tint's
internal ABI is distinct from a public C ABI or the OS calling convention.

## Logical information at a call

- Runtime context: owning heap, stack-map registry, and runtime/module services.
- Callee identity and selected code version: distinguish the callable from its
  current implementation and keep the selected version alive while active.
- Environment: captured bindings, when needed.
- Receiver: `this` information when required by the function kind.
- Arguments: ordered values in representations agreed with the selected entry.
- Argument metadata: actual count/general argument access where behavior needs it.
- Result destination: caller-owned storage for reference-bearing normal/throw values.

These are logical fields, not a mandated parameter packet or heap allocation.
Specialized entries can omit proven-unneeded fields. The runtime context is explicit
in the logical ABI even when a leaf implementation needs no physical context input.

Each function object retains its identity across version replacement. Distinct
closure objects remain distinct even if they share generated code and a lexical
function definition. Shared code identity must not collapse object identity.

## Entry forms

A typed entry declares exact physical argument/result representations. A proven
direct caller can use it without constructing a general value array or dispatching
through a dynamic adapter. Source assignability alone does not prove ABI layout
compatibility; conversion/view adapters may still be required.

A general entry accepts general values and an actual argument count, preserving
receiver/environment information. Its argument storage can be caller-owned rooted
slots; a heap array is not intrinsically required. It checks actual representation
evidence, selects a compatible typed entry, or uses/generates a general version.

Both forms use the same backend and return/throw protocol. General entries adapt
representations, not source semantics: a failed TypeScript expectation in live mode
must not cause a new type-contract rejection or coerce an argument into its annotation.

## Evaluation, defaults, and receivers

Evaluate the callee/property access, receiver, and arguments according to the
applicable language algorithm, preserving effects and exceptions. Root each managed
intermediate before further evaluation can allocate. Do not repeat a getter or
argument expression when dispatch misses or compilation occurs.

Absent arguments become undefined. Defaults run under the language's specified
conditions, including explicitly supplied undefined; null is not interchangeable.
Extra argument expressions still execute even if their values are unused. Rest
parameters or supported `arguments` access require the appropriate actual values.
Omitting count/extra-value storage must not omit those expressions' side effects.

Methods receive their call-site receiver. Arrow functions obtain lexical `this`;
they do not adopt an arbitrary dynamic receiver. Argument/default initialization
can itself allocate or throw and participates in the same rooting/effect protocol.

## Results, throws, and cleanup

Logical outcomes are Normal(result) and Throw(value). Normal results follow the
entry's physical signature; thrown values use a general representation because
they need not be Error objects. Function-local break/continue use control flow and
are not ordinary inter-function return statuses.

Before a call, initialize and register caller-owned reference result storage so
the GC can safely trace it. It includes a valid initialized state and a result-kind
description; uninitialized bits are never treated as pointers. The callee publishes
the result before dropping its own roots. The caller transfers the result into
its live roots before any subsequent collection point.

Normal and exceptional payload storage can be separate or overlaid under a valid
descriptor; that physical choice is open. Scalar normal values may later travel in
registers, while a potentially thrown reference still requires a safe channel.

A pending return/throw crossing finally remains rooted separately from nested
cleanup-call results. Cleanup preserves or replaces the pending completion as
specified. A single global result slot, or reuse that overwrites pending state,
is invalid under recursion, exceptions, and reentrancy.

## Effects and lifetime obligations

IR calls conservatively record allocation, throwing, state mutation, and possible
reentry into user code. Unknown calls assume relevant effects. A known non-allocating
leaf may omit root publication only when every reachable operation satisfies that
claim. Runtime helpers, error construction, instrumentation, and foreign callbacks
must not introduce hidden collecting paths.

The caller stores its live references to the frame words its safepoint map lists
before collecting/reentrant calls; the callee establishes its frame (and frame
record) before allocation. Nothing is published or restored on exit. The active code version and its metadata remain owned until frame exit or
completed deoptimization handoff.

Direct calls that bypass a stable entry record code-version dependencies. Replacement
of a general entry cannot redirect an existing typed call to an incompatible ABI.
Invalidation, patching, or a stable compatible adapter must cover those dependencies.

## Worked traces

### Direct numeric call

```ts
function add(a: number, b: number): number {
  return a + b;
}
const result = add(2, 3);
```

1. Strict checking/lowering establishes numeric operands and an `f64, f64 -> f64`
   typed entry, preserving Number semantics.
2. The proven caller passes scalar operands directly. No boxed argument array or
   closure environment is needed.
3. A proven effect-free leaf uses its specialized implementation; unused context,
   receiver, and reference roots can be omitted physically.
4. Return the scalar result through the selected physical ABI. Introducing later
   instrumentation that allocates requires updating the entry/effect contract.

### Captured variable closure

```ts
function makeCounter(): () => number {
  let count = 0;
  return () => ++count;
}
```

1. Allocate a binding cell/environment for count and root it before allocating
   the closure object. The descriptor identifies managed references.
2. Publish the closure into makeCounter's caller-owned rooted result storage.
   Removing makeCounter's stack frame does not discard the captured binding.
3. Calling the closure passes its environment; successive calls mutate the same
   binding and return scalar results.
4. Separate makeCounter invocations have distinct captured state and closure
   identities even if their bodies share one code version.

### Throw through finally

```ts
function fail(): never {
  throw { message: "failed" };
}
function run(): void {
  try {
    fail();
  } finally {
    cleanup();
  }
}
```

1. fail allocates and roots the thrown object, then publishes Throw(object) into
   run's registered result channel before leaving its frame.
2. run saves that pending throw in rooted completion storage. cleanup gets its own
   result channel and can allocate without losing or overwriting the original throw.
3. If cleanup completes normally, propagate the original throw. If it completes
   abruptly, apply finally's specified replacement behavior.
4. Publish run's outgoing completion before unlinking its frame. The thrown object's
   traceable lifetime spans the entire propagation, including allocating cleanup.

### Dynamic specialization miss

```ts
function twice(x: number): number {
  return x + x;
}
// Live-mode execution: the assertion changes no runtime value.
twice("a" as unknown as number);
```

1. Evaluate the argument once; the general entry sees a string rather than the
   numeric representation expected by its available typed version.
2. Keep inputs/callee rooted while recording optional diagnostics and choosing a
   general version or compiling an appropriate widened version.
3. Execute string addition and return "aa" through the general result channel.
   The declared return type does not authorize the caller to load it as `f64`.
4. A caller specialized to a numeric result must guard/recover too. Strict-profile
   compilation rejects the unproven assertion rather than using this live recovery.

This entry miss requires no reconstruction of a partially executed callee. A guard
failure after effects inside optimized code is different: recover execution state
and resume without replay, as described in [runtime type contracts](runtime-types.md).

## Foreign and future call forms

C ABI entries use explicit adapters, not Tint's internal parameter layout. Establish
rooted foreign scopes before leaving Tint if callbacks are possible. Nested callbacks
get distinct frames/result storage and initially run on the instance's owning thread.
Exceptions must be translated according to the foreign API contract.

Constructor calls reserve a distinct operation carrying construction semantics,
including new.target, rather than pretending every call is an ordinary function call.
Async/generator suspension will require persistent frames and roots. Neither needs
implementation before self-build if the compiler source does not depend on it.

## Physical target proposal and verification

The [macOS arm64 target contract](macos-arm64-target.md) now proposes register/stack
assignments, overflow areas, result-area layout, frame/root handoff and Darwin host
adapters beneath this accepted logical contract. These are concrete initial defaults
to validate, not implemented capabilities or a permanent public ABI. Heap/root
descriptor encoding and the full public foreign ABI still need specifications.

Turn each trace into native/Node differential fixtures as implementation arrives.
Force collection during argument evaluation, closure construction, and finally;
test nested reentry and both normal/throw handoffs. Verify extra-argument effects,
defaults, receiver behavior, version dependency lifetime, and dynamic result guards.
No trace has been implemented or run as a Tint test yet.

References: [calls](https://tc39.es/ecma262/2025/multipage/ordinary-and-exotic-objects-behaviours.html#sec-ecmascript-function-objects-call-thisargument-argumentslist),
[expressions](https://tc39.es/ecma262/2025/multipage/ecmascript-language-expressions.html),
[environments](https://tc39.es/ecma262/2025/multipage/executable-code-and-execution-contexts.html#sec-environment-records),
[finally](https://tc39.es/ecma262/2025/multipage/ecmascript-language-statements-and-declarations.html#sec-try-statement-runtime-semantics-evaluation).
