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

## Typed-path representation

Typed code holds all 12 standard typed-array kinds (`Uint8Array`, `Int8Array`,
`Uint8ClampedArray`, `Uint16Array`, `Int16Array`, `Float16Array`, `Uint32Array`,
`Int32Array`, `Float32Array`, `Float64Array`, `BigInt64Array` and
`BigUint64Array`) natively: one header word, the length, a data pointer and
inline, borrowed or viewed elements. The [kind table](../packages/abi/src/typed-array.ts)
gives each kind a marker `(kind index << 3) | width class` (width classes 2-5
for 1, 2, 4 and 8 bytes), so the original four kinds keep markers 2-5 and every
built-in marker stays below 32, under any record descriptor address. The
header has no spare bits for a separate kind byte: the marker field holds
descriptor addresses, the three flag bits distinguish owned, borrowed and
viewed storage, and the next two bits belong to the collectors. Collectors
and extent decoding treat any typed-array marker as pointer-free elements
whose extent follows from the header, through one predicate
(`nativeTypedArrayMarker`) and the width class
(`nativeTypedArrayElementBytes`), never per-kind cases.

Element writes convert as the specification requires: the integer kinds
store the low bits of ToInt32 (ToInt8 and ToInt16 equal ToUint8 and
ToUint16 bit for bit), `Uint8ClampedArray` stores ToUint8Clamp (AArch64
FCVTNU then a clamp to 255; x86-64 CVTSD2SI under round-to-nearest after
range checks; int64 values clamp directly), `Float16Array` and `Float32Array`
round to nearest, ties to even (AArch64 `FCVT H, D` / `FCVT S, D`; x86-64
exact bit-level binary64-to-binary16 helper / `CVTSD2SS`), overflowing to
infinity, and `BigInt64Array`/`BigUint64Array` store tear-free 64-bit two's
complement words converted via `ToBigInt64`/`ToBigUint64`. Reads zero- or
sign-extend to an exact integer, widen floats to double (widened Float16 and
Float32 NaNs are always quiet, never optional-number absence), or decode
signed/unsigned 64-bit words into `bigint`. Typed `Atomics` covers all 8
integer kinds (8/16/32-bit signed and unsigned plus 64-bit BigInt), including
`Atomics.wait` and `Atomics.notify` on shared `Int32Array` and `BigInt64Array`
with worker-stop interruption. Typed `instanceof` compares header markers, and
realm-capable code passes the kind name to the realm, which selects that kind's
prototype.

The general path's per-kind Test262 selections pass after the marker change
(TZ=UTC): `built-ins/TypedArrayConstructors/`
[Int8Array](results/test262-typedarrayconstructors-int8array-native-v1.json),
[Uint8ClampedArray](results/test262-typedarrayconstructors-uint8clampedarray-native-v1.json),
[Int16Array](results/test262-typedarrayconstructors-int16array-native-v1.json),
[Int32Array](results/test262-typedarrayconstructors-int32array-native-v1.json) and
[Float32Array](results/test262-typedarrayconstructors-float32array-native-v1.json)
22/22 each, [BigInt64Array](results/test262-typedarrayconstructors-bigint64array-native-v1.json)
and [BigUint64Array](results/test262-typedarrayconstructors-biguint64array-native-v1.json)
24/24 each. These are focused selections that overlap the complete
TypedArrayConstructors report; they do not add to its denominator.

## Strict compiler construction

The strict native compiler accepts numeric and readonly numeric-array inputs
for every native kind, alongside numeric lengths and supported typed-array
sources. Copying evaluates the source once, produces independent storage,
and converts holes/undefined to NaN before element encoding; copies between
different kinds convert by value. The
[native regression](results/native-numeric-array-construction-v1.json) covers
the original four encodings, sparse inputs, empty arrays and copy ownership;
`tools/native-typed-array-kinds.test.ts` covers the conversions, access forms,
library operations and identities of the added kinds. This is separate from
the Script runtime's broader TypedArray constructor support.
