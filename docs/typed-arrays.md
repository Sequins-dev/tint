# Typed arrays

The live object model uses the existing owned ByteStorage, shared with ArrayBuffer
and DataView. Strict-profile compiler storage remains a separate representation.
Target adapters explicitly supply byte order; portable code does not infer it
from the Node bootstrap host.

## Current boundary

Native regression fixtures cover length, ArrayBuffer, iterable, array-like and
typed-array copy construction for numeric
and BigInt kinds, indexed reads/writes, clamping, descriptors, borrowed receivers,
shared bytes, resizing, view accessors, iteration, static from/of, indexed search,
bulk set (including overlapping views), text conversion, reversal, fill, copyWithin,
callback iteration/search/reduction, species-aware map/filter, toReversed/with
sort/toSorted, subarray storage sharing and slice copying. These are focused checks, not a complete
TypedArray Test262 result; see the [dashboard](test262.md).

Locale formatting, SharedArrayBuffer and Atomics remain to be implemented and
measured. The shared and immutable storage boundaries are described in
[buffer storage](buffer-storage.md).

## Contracts

- `integer-indexed.ts` provides generic exotic internal methods. Canonical numeric
  keys terminate lookup even when invalid; ordinary strings and symbols retain
  ordinary property behavior. The storage adapter owns element conversion and
  must recheck bounds after coercion.
- `numeric-element.ts` shares integer and IEEE encodings with DataView, including
  Uint8Clamped ties-to-even conversion. BigInt uses the existing exact word codec.
- `typed-array-data.ts` binds these operations to backing storage. A fixed view
  can become out of bounds and recover after growth; an omitted length tracks
  complete elements. No borrowed byte array survives observable coercion.
- `typed-array-construction.ts` owns allocation and source copying, preserving
  same-kind byte patterns and iterable versus array-like coercion order.
- Array and typed-array iterators share explicit per-instance slots. Length-access
  failures preserve the index; element-access failures preserve the incremented
  index. Reentry is permitted, only exhaustion releases the source, and borrowed
  `next` methods create results, entries and errors in the invoked method's realm.
  This adopts the [living specification's internal-slot algorithm](https://tc39.es/ecma262/multipage/indexed-collections.html#sec-%arrayiteratorprototype%.next)
  rather than the older generator-based algorithm. The complete pinned iterator
  family passes [46/46 variants](results/test262-array-iterator-family-native-v2.json);
  separate native regressions cover recovery, reentry and cross-realm behavior.
- `typed-array-set.ts` uses overlap-safe raw byte copies for equal element kinds
  and snapshots values when converting between element kinds. Array-like input
  retains observable read/coercion ordering and rechecks storage on each write.
- `typed-array-result.ts` shares constructor result validation between static and
  species-aware collection methods. Intrinsic constructors are retained separately
  from mutable source properties. Map constructs before callbacks; filter constructs
  after selection. Empty species results must retain Number versus BigInt content
  kind; the [Node comparison](results/typed-array-empty-species-node-comparison-v1.json)
  records Node 24.12 accepting this invalid case.
- `typed-array-static.ts` validates constructor results and minimum lengths for
  from/of, while preserving iterable and array-like mapper ordering.
- `typed-array-ranges.ts` shares coercion and species selection for slice/subarray.
  Slice preserves forward copy order even for aliasing species results. Subarray
  passes the backing buffer through species selection;
  omitted end preserves tracking, while explicit end creates a fixed view.
  [Native argument-count validation](results/native-typed-array-subarray-arguments-focused-v1.json)
  follows the specification; [Node 24.12 differs](results/typed-array-subarray-arguments-node-comparison-v1.json).
- `typed-array-intrinsics.ts` owns constructor/prototype installation and source
  conversion order. Per-kind prototypes are realm-local and constructor fallback
  selection uses the new target's realm.

Semantics follow [ECMAScript typed-array exotic objects](https://262.ecma-international.org/16.0/#sec-typedarray-exotic-objects)
and [typed-array constructors](https://262.ecma-international.org/16.0/#sec-typedarray-constructors).

## Targeted specification corrections

`copyWithin` adopts the [living specification correction](https://tc39.es/ecma262/multipage/indexed-collections.html#sec-%typedarray%.prototype.copywithin)
to ES2025 for buffers shrunk during argument coercion: shorten the copy to its
still-valid prefix before choosing overlap direction. The retained
[regression failure](results/native-typed-array-copywithin-shrink-red-v1.json)
records the older algorithm's skipped copy; the [corrected native result](results/native-typed-array-copywithin-shrink-focused-v1.json) passes. This targeted correction does not
change the project's overall specification baseline.

## Strict compiler construction

The strict native compiler accepts numeric and readonly numeric-array inputs for
Uint8Array, Uint16Array, Uint32Array and Float64Array, alongside numeric lengths
and supported typed-array sources. Copying evaluates the source once, produces
independent storage, and converts holes/undefined to NaN before element encoding.
The [native regression](results/native-numeric-array-construction-v1.json) covers
all four encodings, sparse inputs, empty arrays and copy ownership. This is separate
from the Script runtime's broader TypedArray constructor support.
