# Array factory execution

`Array.from`, `Array.of` and `Array.fromAsync` share the internal
`ArrayFactoryOperations` construction/property contract. Generic constructors
receive a length for array-like sources and no arguments for iterable sources;
ordinary Array allocation remains the fallback. Property creation and final
length assignment retain their normal throwing semantics.

The async collector owns one sequential operation through Promise jobs. It uses
intrinsic Promise records and the existing Await and async-from-sync iterator
machinery. An async iterator is acquired before constructing the result, as
required by `Array.fromAsync`; synchronous `Array.from` retains its own ordering.

| Source | Value processing |
| --- | --- |
| Async iterable | Await `next()`; preserve its value unless mapping awaits a result |
| Sync iterable | Async-from-sync adaptation awaits each iterator value |
| Array-like | Await each indexed value before invoking an optional mapper |

Mapped results are awaited before defining an element or requesting another one.
Mapper failures, property-definition failures and index overflow close an active
iterator and await a present return result. Next/done/value extraction failures
do not close it. The original throw completion wins over closing failures.

The [native regression](results/native-array-from-async-green-v2.json) covers
these sequencing boundaries. The earlier [raw-fixture harness error](results/native-array-from-async-fixture-v1-diagnostic.json)
is retained separately. Unchanged complete selections belong in the
[Test262 dashboard](test262.md). The full-suite baseline uses a saved older source
graph; adding a factory does not retroactively change that run's outcomes.
