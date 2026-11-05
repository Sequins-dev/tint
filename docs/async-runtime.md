# Async runtime integration

## Implemented boundary

The native continuation pipeline supports synchronous generators, delegation and
structured abrupt completion. `@tint/js-runtime/jobs`
provides FIFO checkpoints; `@tint/js-runtime/promises`
owns settlement, resolving functions, thenable assimilation and reactions.

The Script host exposes Promise construction, `then`, `catch`, `finally`, `resolve`,
`reject`, `try`, `race`, `all`, `allSettled`, `any`, `withResolvers`, `Symbol.species` and AggregateError.
`Promise.try` follows the current specification: the callback runs before the
constructor is consulted, and a normal result goes through PromiseResolve.
Combinators share iterator acquisition/closing and generic constructor capabilities.
Native errors and result arrays use intrinsic identities rather than mutable globals.

Shared agents retain callback realms and enqueue-time Script/module identities.
Source functions and generators capture definition contexts; top-level Script
entries restore their caller context. Checkpoints drain only after Script execution
exits. Rejection notifications remain distinct from thrown jobs and `$DONE` failures.
The Test262 host preserves the original harness and detects repeated completion.
An empty queue without `$DONE` is a timeout; external event sources are not present.

Async declarations, expressions, arrows and object/class methods lower through
native continuation segments shared with generators. Bodies start immediately;
`await` resumes through intrinsic Promise reactions with retained execution context.
Rejections re-enter the suspended catch/finally path. A throwing PromiseResolve
injects its error synchronously before suspension. Await bypasses mutable `.then`
and does not create an unused chained Promise.

Arrows retain lexical receivers, arguments and new.target. The typed strict profile
still rejects async functions explicitly. Module execution and
`$262.agent` remain unimplemented. The Script host now installs
`globalThis` for unchanged async harness helpers.

Async iterator acquisition prefers Symbol.asyncIterator and falls back to a
native async-from-sync wrapper only for a missing/null method. Native fixtures
verify Promise assimilation, cached next, argument presence and rejection cleanup.
Source `for await…of` now uses native suspension for iterator steps and cleanup.
It supports declaration/destructuring and assignment heads, per-iteration bindings,
labels, and abrupt completion through catch/finally. Native async iterator values
are not unwrapped; the sync adapter unwraps its values. Failed steps do not close
the iterator. Body throws retain precedence over cleanup failures, while break and
return propagate cleanup failures. Top-level module execution and strict-profile
async iteration remain unsupported.

Async iterator disposal uses the same intrinsic Promise reactions. It returns a
fresh promise, rejects instead of throwing for return-method lookup/call errors,
awaits a present return value and fulfills with undefined. It does not require
an iterator-result object or access an overridden `.then` on an intrinsic promise.
The focused [async-disposal fixture](../tools/verify-test262-native-async-dispose.ts)
passes all five native cases ([report](results/native-async-dispose-focused-v1.json)).

## Verification

The original async-integration snapshot recorded **2,043 workspace tests**,
**1,649 native Script cases** and **102 native async host cases** passing. Current
conformance evidence lives in the [Test262 dashboard](test262.md). Separate native fixtures verify cross-realm
errors/species, retained contexts, iterator closing and callback identity. A native
await fixture verifies reaction scheduling, synchronous constructor-getter errors,
cross-realm Promise adoption and resumption after settlement by another script.
A focused native Script check verifies globalThis identity and mutable descriptors.
[Self-hosting evidence](generators.md) identifies the exact compiler snapshot;
these regression checks are separate from Test262 passes.

Focused unchanged Test262 selections (34 variants total; overlapping broader
selections must not be added to this count):

| Contract                                  | Passed variants | Reports                                                                                                                                                                                       |
| ----------------------------------------- | --------------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Executor arguments and abrupt completion  |               4 | [Arguments](results/test262-promise-executor-native-v2.json), [abrupt](results/test262-promise-executor-abrupt-native-v1.json)                                                                |
| Species                                   |              10 | [Selection](results/test262-promise-species-native-v1.json)                                                                                                                                   |
| Deferred resolution and sequencing        |               4 | [Deferred](results/test262-promise-deferred-native-v1.json), [sequencing](results/test262-promise-sequence-foreach-native-v1.json)                                                            |
| Finally preservation and forwarding       |               6 | [Value](results/test262-promise-finally-value-native-v1.json), [apply](results/test262-promise-finally-apply-native-v1.json), [filter](results/test262-promise-finally-filter-native-v1.json) |
| Race closing and all resolution           |               4 | [Race](results/test262-promise-race-close-native-v1.json), [all](results/test262-promise-all-resolve-native-v1.json)                                                                          |
| AllSettled callback guard                 |               2 | [Selection](results/test262-promise-settled-once-native-v1.json)                                                                                                                              |
| AggregateError ordering and any rejection |               4 | [Ordering](results/test262-aggregate-order-native-v1.json), [any](results/test262-promise-any-reject-native-v1.json)                                                                          |

See [Test262 coverage](test262.md) for completed broader runs and their remaining
failures. The later [async-returning-arrow check](results/test262-async-return-arrow-native-v1.json)
passes both variants; it overlaps the declaration selection. Earlier reports remain immutable.

The dependency-free async-generator request protocol now has unit and native
fixture coverage for ordered suspension, awaited returns, abrupt resumption and
stack-bounded queue draining. Its native object adapter supplies private brands,
intrinsic prototypes,
per-request Promises and retained execution contexts. Native checks cover invalid
receivers, queued returns and cross-realm calls. Source declarations, expressions and object/class methods now use distinct native
await/yield segments, including awaited return expressions and catch/finally routing.
Async delegation now uses a generic resumable protocol for awaited method results,
missing-throw cleanup and abrupt completion. Native async delegate values retain
identity; sync delegates pass through the async-from-sync adapter. Nine protocol
tests, a native protocol fixture, and six native source cases pass. The 102-case
async regression, 1,649-case Script regression and byte-identical native self-build
pass. See the current
[Test262 selections](test262.md) for conformance results.

## Compiler-owned await operations

Native work such as lexical resource disposal performs its own specified Awaits.
Wrapping that work in a Promise and awaiting the wrapper would add an observable
reaction job. A private await-operation slot instead connects that work directly
to its compiled continuation. The completing job resumes the continuation without
another reaction. The operation settles once, accepts one continuation, and releases
callback references when it resumes.

This is an internal compiler/runtime contract. Script properties cannot construct
or forward the slot; ordinary JavaScript await operands still use intrinsic Promise
resolution and reactions. Async functions and async generators share the adapter.
`AsyncDisposableStack.disposeAsync()` still returns a normal intrinsic Promise;
lexical cleanup uses an internal operation only when it actually suspends.

## Next contracts

1. Expand Promise conformance and address remaining builtins, including
   `try` in the pinned suite. Missing `eval` and Proxy also
   affect tests of otherwise implemented methods.
2. Expand async/await conformance, suspension-root and cross-realm checks; connect
   Promise types to the strict profile.
3. Expand async-generator delegation and async iteration conformance, including
   iterator closing and rejection precedence.
4. Add module and multi-agent host contracts without conflating them with the
   existing in-process realm/job abstraction.

Normative references: [Jobs and host scheduling](https://tc39.es/ecma262/multipage/executable-code-and-execution-contexts.html#sec-jobs),
[Promise objects](https://tc39.es/ecma262/multipage/control-abstraction-objects.html#sec-promise-objects).

General AsyncFunction and AsyncGeneratorFunction bodies now use the managed
Script compiler after the narrow profiles decline. The AsyncFunction adapter
returns the carrier promise without an extra resolution layer. The
AsyncGeneratorFunction adapter takes an idle hidden carrier's continuation and
leaves all requests with the visible generator. The current
[Node checkpoint](results/async-generator-function-node-checkpoint-v1.json)
records validation separately from the queued native proofs and Test262 groups.
