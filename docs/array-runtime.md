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

## Packed element storage

Ordinary Script arrays previously stored every index as a `Descriptor` in the
object's property `Map`. In native images that `Map` is a linked map with a
key index whose entry table is itself a sparse list, so one append costs about
eight hashed lookups, three descriptor allocations and a length redefinition.
The [current property profile](results/cluster-j-property-current-performance-profile-v41.json)
attributes most of regExpUtils `buildString` time to that storage and its
collection traffic.

Array exotic objects now start with packed element storage
(`internalArrayElements`). While it is present:

- indices `0..count-1` are own data properties that are writable, enumerable and
  configurable, and no other array index is an own property;
- the property `Map` never contains an array-index key, so it usually holds only
  `length` and stays below the key-index promotion threshold;
- `count` never exceeds the `length` value;
- elements are held as a `number[]` while every element is a Number primitive,
  and as a `Value[]` after the first other value. The switch happens once and
  keeps each element's identity.

The ordinary storage operations (`ordinaryGetOwnProperty`,
`ordinaryDefineOwnProperty`, `ordinaryDeleteProperty` and `ordinaryOwnKeys`)
handle packed elements themselves, so internal algorithms that skip exotic
dispatch see the same properties. `getProperty` and `setProperty` read or
overwrite a present packed element directly, without allocating a descriptor.
Appending at `count` still walks the prototype chain for inherited setters and
still goes through the array's `[[DefineOwnProperty]]`, which updates `length`.

Any operation that would break the invariant first converts the whole store to
ordinary descriptors and then continues on the unchanged generic path. That
includes non-default attributes, accessors, a write that leaves a hole, deleting
an element other than the last one, and appending to a non-extensible array.
Conversion is permanent for that object. Shrinking `length` truncates packed
elements directly, because every packed element is configurable and deleting
them from the highest index down cannot fail. `ArrayObjectHooks` supplies the
pure `indexKey` and `numberPayload` conversions the store needs.

[`tools/bench-script-array-elements.ts`](../tools/bench-script-array-elements.ts)
measures native Script element writes, `apply` reads and truncation against an
empty control case in the same image.

## Primitive property reads

String wrappers materialize every index descriptor when they are created, so
boxing a primitive for each `s.length` or `s[i]` read cost one descriptor and map
entry per character. A native profile of the buildString benchmark above, taken
after packed elements landed, spent both samples collecting those descriptors.
GetValue on a String, Number or Boolean base now reads without a wrapper.
Strings answer `length` and in-range canonical indices directly. Every other key
is read from the realm prototype with the primitive as receiver, exactly as
`[[Get]]` on ToObject(base). Symbol and BigInt bases keep the boxing path, so
object bases pay only three `typeof` checks.

The [packed element evidence](results/cluster-j-packed-elements-v1.json) compares
main `dd5914bf` with the candidate using the same benchmark tool and inferior CPU
time: the buildString case drops from 26.96 to 1.54 CPU-seconds and the string
join case from 7.44 to 3.47. It also records the red-first tests, native
fixtures and the frozen self-build stage comparison.

The [validation record](results/cluster-j-packed-elements-v2.json) adds a native
regression run over built-ins/Array, Object/defineProperty and the TypedArray
`from`/`of` families: [8,595 of 8,595 variants pass](results/cluster-j-dense-regression-v48-combined.json)
on one frozen candidate toolchain. It also records the rebased head's workspace
gate, native fixtures and frozen self-build stage comparison.
