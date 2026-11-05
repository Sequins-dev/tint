# @tint/foundation/layout

Target-aware byte layout for records, tagged storage, allocation headers and shadow
root headers. Depends on bytes only for its checked alignment primitive. It has no
language type system, trace vocabulary, heap, native pointers or platform dependency.

`createLayoutPlanner(target, maxBytes)` validates and captures an explicit target.
Pointer/word widths are 4 or 8; allocation/frame/max alignments are powers of two.
Allocation and frame alignment must accommodate every supported payload alignment.
No target values come from the Node host. The budget bounds each planned result.

The returned planner provides:

- `record(fields)`: place unique named fields in order, align each, and round total
  size to the largest field alignment. Empty records have size zero/alignment one.
- `tagged(tagWidth, variants)`: place a 1/2/4-byte tag followed by aligned storage
  large enough for any variant. Names are unique and the tag must have enough values.
  Numeric tag assignments and variant semantics remain the caller's contract.
- `object(payload, tailBytes = 0)`: descriptor pointer, aligned target-word flags,
  aligned payload, optional trailing bytes, then allocation-alignment rounding.
- `rootRecord()`: previous/descriptor/slot-base pointer offsets and rounded header
  size. Root slots are separately addressed storage, not appended implicitly.

Offsets/sizes are nonnegative bounded byte counts. Invalid storage, duplicate names,
invalid targets and budget excess return structured failures; no partial layout is
returned. Alignment never silently truncates. Target inputs and returned field
metadata are copied; output is readonly by contract rather than recursively frozen.

The standard 8-byte-pointer/word, 16-byte-alignment target yields a 16-byte object
header and 32-byte root header. Alternate 4-byte target tests are layout evidence,
not proof of Linux/Windows execution. This module does not allocate memory, decide
which fields contain references or serialize descriptors.
