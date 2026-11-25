# One-byte strings

Status: slices 1 (flat kinds), 2 (primitive fast paths) and 3 (codec and
number fast paths) implemented on PR #18 for AArch64 and x86-64 (see
[Slices](#slices)). Measurements:

- [string baseline v1](results/string-baseline-v1.md);
- slice 1 A/B against main: [v1](results/string-slice1-ab-v1.md),
  [v2](results/string-slice1-ab-v2.md) and
  [v3](results/string-slice1-ab-v3.md). The frozen self-compile is at
  parity in v3.
- slice 3 A/B against main: [v1](results/string-slice3-ab-v1.md). Five
  kernels beat Node; the remaining gaps are listed there.

Tint stores every string as UTF-16. V8 stores a string whose code units all
fit in Latin-1 (at most 0xFF) as one byte per unit. This design adds that
representation while keeping JavaScript semantics exact: indexing, lengths,
comparisons and surrogates are always defined on UTF-16 code units, whatever
the storage.

## Decision summary

- **Two flat kinds, chosen by content.** A string is _one-byte_ if every code
  unit is at most 0xFF. Otherwise it is _two-byte_. Both kinds keep the
  marker-1 header and the current length and data offsets. Kind flag 1 marks
  one-byte storage.
- **Canonical invariant.** Every string has the narrowest kind its content
  allows. A two-byte string therefore always holds at least one unit above
  0xFF. Equal strings always have the same kind. A one-byte string never
  equals, starts with, or contains a two-byte string.
- **Kind is decided where strings are produced.** Producers decide the kind
  once, usually without scanning: concatenation and joins combine their
  inputs' kinds, and literals are encoded at compile time. Only two paths
  can narrow and so must scan: slices of two-byte strings, and strings built
  from computed code units. Consumers branch once on the kind flag.
- **Hashes stay defined on code units**, so equal strings hash equally
  whatever their kind. A cached hash word is a separate, later decision,
  coordinated with PR #12.
- **No indirect strings in the first slices.** Ropes and sliced strings are
  separate representations (marker 8 and above), considered after the flat
  kinds land; see [Indirect strings](#indirect-strings).

## Current layout

`@tint/abi/host` defines the flat string:

| Offset | Contents                                                          |
| -----: | ----------------------------------------------------------------- |
|      0 | Header: marker 1, kind flags 0                                    |
|      8 | Length in UTF-16 units (stored as a 64-bit word, read as 32 bits) |
|     16 | Units, two bytes each; at least four units of space are allocated |

Allocations use the 8-byte granule. Inline literal comparisons read eight
data bytes unchecked, so every string has at least eight data bytes. The longest
string has `maximumStringLength` (0x7fffffec) units.

Typed code (`string`), general values (tag 3, payload is the string), the
runtime and image literals all share this one object. Strings have no
outgoing references.

## Inventory

Every place that knows the layout, and the change each needs. "Agnostic"
means TypeScript that reaches string contents only through `length`,
`charCodeAt`, concatenation, `slice` and the other primitives below, so it
needs no layout change. Those sites still matter for speed (see
[Gaps](#gaps-to-node-beyond-the-representation)).

### Contracts and debugging

| Site                                                                                                            | Knows                                                                                                         | Change                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/abi/src/host.ts` (`nativeString*`, header comment)                                                    | Offsets; "strings always have flags 0"                                                                        | Add `nativeStringOneByteFlag`, a width helper and comments                                                                                                                                                                 |
| `packages/abi/src/heap-debug.ts` kind table                                                                     | `kind(1, 0, 16, 8, 2, …, "string", 4)`                                                                        | Add the one-byte kind `(1, 1, 16, 8, 1, …, minimum 8)`; bump `heapDebugVersion`                                                                                                                                            |
| `packages/compiler/src/debug-types.ts`                                                                          | DWARF `string` (`length`, `char16_t units[]`); string variables shown as a `char16_t[]` counted by the length | `string` gains `bytes` (`latin1[]`) over the same data. A fixed element type cannot describe both kinds, so string variables become `string *` like strings inside objects, and the Tint LLDB/GDB formatters show the text |
| `packages/codegen/src/aarch64/diagnostics.ts` (`report-string`)                                                 | Checks `header == 1`, then reads `ldrh` units                                                                 | Accept both headers, read bytes for one-byte                                                                                                                                                                               |
| `tools/lldb/tint.py`, `tools/gdb/tint.py`, `tools/debugger/tint_heap.py` (`string_text`, `STRING_UNITS_OFFSET`) | UTF-16 units                                                                                                  | Read the kind flag and decode bytes or units                                                                                                                                                                               |
| `tools/heap-snapshot` (via `tint_heap`), `tools/verify-heap-tools.ts`                                           | String names and sizes                                                                                        | Follow the kind table; extend the verification                                                                                                                                                                             |

### Collector

| Site                                                                               | Knows                                      | Change                               |
| ---------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------ |
| `native-runtime/src/tracing/extent.ts` `nativeObjectExtent`                        | `16 + max(length, 4) * 2`; flags must be 0 | Width from the flag; flag 1 is valid |
| `native-runtime/src/tracing/cheney.ts` `cheneyExtent` (also used by `parallel.ts`) | Same                                       | Same                                 |
| `native-runtime/src/tracing/scan.ts`                                               | Width 2 for marker 1; flags 0 or 1         | Width from the flag                  |
| `nursery.ts`, `parallel.ts`, `fixups.ts`, `relocation.ts`                          | Classify by marker; no string edges        | No change (strings have no edges)    |

### Code generation, AArch64

`packages/codegen/src/aarch64/scalar/strings.ts` (leaf helpers) and
`scalar/index.ts`:

| IR operation or site                                                                | Today                             | Change                                                                                                                                                              |
| ----------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `string-length`, truthiness                                                         | 32-bit length load                | No change                                                                                                                                                           |
| `string-code-unit` (helper, inline exact-integer path, `inBounds` path)             | `ldrh` at `16 + 2i`               | Test the kind flag, then `ldrb` or `ldrh`. The header and length come from one `ldp`                                                                                |
| `string-equal` helper and `stringEqual`                                             | Identity, then length, then units | Identity, then header and length together, then `length << width` bytes compared a word at a time                                                                   |
| Inline equality with literals of up to 8 or 32 units (`index.ts` ~14360)            | Length plus units in 8-byte words | Compare the header with the literal's kind as well. One-byte literals compare 8 units per word, so literals of up to 8 characters need one data load instead of two |
| `string-starts-with` (also behind `indexOf`, `includes`, `endsWith`, `lastIndexOf`) | Unit loop at an offset            | Same kind: byte compare. One-byte source with a two-byte search: always false (canonical). Two-byte source with a one-byte search: a widening compare               |
| `string-slice` (`slice-bounds` and `slice-copy`)                                    | Allocate `2n`, copy               | One-byte source: byte copy. Two-byte source: scan the range for a unit above 0xFF, then copy two-byte or narrow                                                     |
| `string-concat` (`concat-copy`)                                                     | Allocate the sum, copy both       | One-byte iff both inputs are one-byte; widen a one-byte part into a two-byte result                                                                                 |
| `string-from-code-units`                                                            | `strh` per value                  | Reduce the values with OR. If the result is at most 0xFF, `strb`, else `strh`                                                                                       |
| `string-allocate` + `string-write` (`Array.prototype.join`, builders)               | Allocate `2n`; copy each part     | `string-allocate` gains a kind operand computed from the parts (new `string-two-byte` query). `string-write` widens a one-byte source into a two-byte target        |
| `prepareStringSize` / `allocate`                                                    | `align8(16 + 2 * max(n, 1))`      | `align8(16 + max(n << w, 1))`, equal to `align8(16 + max(n << w, 8))`; the header is kept with the extent across the allocation                                     |
| Literal pool (`stringFixups`, ~16880 and ~17040)                                    | Header 1, `max(n, 4) * 2` bytes   | Encode the narrowest kind; one-byte pools shrink by half                                                                                                            |

### Code generation, x86-64

`packages/codegen/src/x86_64/scalar/index.ts`: `allocateString`,
`stringCopy`, `compareUnits`, `stringEqual`, `stringPrefix`, the
`string-*` cases (~2286–2490) and the literal pool (~3790). Copies and
comparisons call libc `memcpy` and `memcmp` through `bytesOperation`.
Same-kind operations keep those calls with byte extents. Mixed-kind
operations need a widening loop. Every AArch64 change has an x86-64
counterpart in the same slice, because CI self-builds Linux x86-64.

### IR, lowering and optimization

| Site                                                                                                        | Change                                                                            |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `packages/ir/src/scalar/model.ts`, `index.ts` (verifier), `storage/codec.ts`, `test/function-store.test.ts` | New `string-two-byte` query (a boolean); a `twoByte` operand on `string-allocate` |
| `maximumStringLength` (0x7fffffec)                                                                          | Unchanged: the two-byte limit bounds both kinds                                   |
| `ts-native/src/scalar.ts` join lowering (`string-allocate`/`string-write`)                                  | Reduce the parts' kinds with OR before allocating                                 |
| `ir/src/scalar/word-uses.ts`, `selectArrayAccesses` (`inBounds`)                                            | No change: they reason in code units                                              |
| `ir/src/storage/bytes.ts` (IR string constants)                                                             | No change: serialization, not the heap                                            |

### Runtime TypeScript (layout-agnostic)

These sites reach contents only through the primitives above, so they keep
working unchanged:

- `foundation/text`: the UTF-8 codec (`encodeUTF8`, `decodeUTF8`), the
  string builder, URI coding and well-formedness.
- `foundation/collections/key-index.ts` `hashString`: it hashes code units,
  so the result does not depend on the kind.
- `foundation/numeric/number-text`: `numberToString` and `stringToNumber`.
- `js-runtime`: JSON, RegExp, case mapping, collation, locale data and
  structured clone (`serializeWorkerValue` builds a UTF-16 packet string).
- `native-runtime` host boundaries:
  - FFI (`ffi/c-string.ts` decodes UTF-8);
  - console and fs (`encodeUTF8`);
  - process environment;
  - crypto and zlib (PR #6), which convert through the UTF-8 codec.

### Out of the heap layout

The following sites are not heap layouts and need no change:

- `compiler/src/native/managed-directory-data.ts`: its UTF-16LE length-prefixed
  strings are a file format.
- `js-runtime/src/objects/locale-data-pack.ts`: its 15-bit packed literals
  contain units above 0xFF, so they stay two-byte.
- `js-engine/src/script-evaluation.ts`: its eval-cache bounds count units.

## Representation

Header kind flag 1 on marker 1 is the one-byte kind:

| Kind               | Header     | Data       | Allocation                |
| ------------------ | ---------- | ---------- | ------------------------- |
| Two-byte (UTF-16)  | `1`        | `2n` bytes | `align8(16 + max(2n, 8))` |
| One-byte (Latin-1) | `1 + 2^48` | `n` bytes  | `align8(16 + max(n, 8))`  |

Alternatives considered:

- **A separate marker** (such as 8). Markers that are multiples of eight
  denote record descriptors, so a new built-in marker needs another
  low-bits value. It also breaks the existing "marker plus flags" kind table
  that typed buffers already use for owned, borrowed and view storage.
  Rejected.
- **The kind in the length word's high half.** This saves one load in
  `charCodeAt`, but x86-64 reads the length as 64 bits, and the collector
  and tools read the whole word. That high half is also the natural home for
  a cached hash (PR #12). `ldp` loads the header and length together anyway.
  Rejected.
- **One-byte as flag 0.** This would make one-byte literal comparisons
  compare the header with `1` in one instruction. But a producer that was
  missed would then silently write UTF-16 data under a one-byte header and
  corrupt the string. With two-byte as flag 0, a missed producer creates a
  non-canonical two-byte string, which is an equality bug that the canonical
  checks below catch. Chosen: one-byte is flag 1. Literal comparisons fold
  the flag test into the header compare.
- **Non-canonical kinds (V8).** V8 lets two-byte strings hold only Latin-1
  content: external strings, slices of two-byte strings, and some builder
  results. Equality and searches then need mixed-kind loops, and a
  comparison cannot reject on kind. Tint's flat strings and compile-time
  literals make the canonical invariant cheap. Only two-byte slices and
  computed code units can narrow, and both already touch every unit they
  write. Chosen: canonical.

Kind flags 2–7 stay reserved for strings, and the collector rejects them.
Bits 51–52 remain collector-only.

### Minimum size and alignment

Both kinds keep at least eight data bytes, so inline comparisons may read one
word unchecked. A string of up to four units takes 24 bytes either way. From
five units, one-byte strings save up to half their data bytes.

## Producers

| Producer                                                                        | Kind decision                                                                                                                                           | Cost added                                                      |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Literals (AOT pool, JIT pool)                                                   | Compile time, from the text                                                                                                                             | None                                                            |
| `a + b`, template literals                                                      | Two-byte iff either input is                                                                                                                            | One OR of two header loads already in cache                     |
| `join`, builders (`string-allocate`/`string-write`)                             | OR over the parts                                                                                                                                       | One header load per part, in the length pass                    |
| `slice`, `substring`, `substr`, `charAt`, `at`, trims, `split` parts            | One-byte source: one-byte. Two-byte source: scan the range                                                                                              | Two-byte sources only: one reduction pass (8 units per NEON op) |
| `String.fromCharCode`, `fromCodePoint`, `string-from-code-units`                | OR of the computed units                                                                                                                                | One OR per unit, in registers                                   |
| `repeat`, `padStart`, `padEnd`, case mapping, `normalize`, JSON, RegExp results | Built from the producers above                                                                                                                          | None beyond them                                                |
| Host and UTF-8 decoding (FFI, fs, env, `TextDecoder`)                           | Built from the producers above today; the ASCII and Latin-1 fast paths ([Gaps](#gaps-to-node-beyond-the-representation)) decide the kind while decoding | None                                                            |

## Consumers and mixed kinds

With the canonical invariant:

- **Equality** (`===`, `switch`, `Map` and `Set` probes):
  1. identity;
  2. header and length as one pair (different kinds are unequal);
  3. `n << w` bytes compared a word at a time.
- **Ordering** (`<`, `localeCompare` fallback, sort): the same kind uses
  `memcmp`-style word compares, with a byte-swap at the first difference
  for one-byte and a units loop for two-byte. Mixed kinds use a widening
  loop.
- **Search** (`startsWith`, `indexOf`, `includes`, `split` separators):
  - a two-byte needle in a one-byte haystack can never match;
  - a one-byte needle in a two-byte haystack uses a widening compare;
  - the same kind uses a first-unit scan, then a compare.
- **Hash**: code-unit values only. Equal strings have equal kinds, so a
  native hash may load bytes or halfwords as long as it mixes the same
  unit values.

## Flattening and indirect strings {#indirect-strings}

The first slices keep every string flat. The baseline shows two gaps that
flat strings cannot close against V8:

- **Repeated `+=`**: Tint copies; V8 builds cons strings.
- **Long substrings**: Tint copies; V8 builds sliced strings once the result
  has 13 or more units.

Both are separate representations: a new marker, a flatten-on-read
contract, and collector edges. They are proposed as their own later slice.
Typed lowering can recognise `s += x` loops and use a builder instead,
which may close the concatenation gap without ropes. This design keeps
marker 1 meaning "flat", so later indirect kinds do not change it.

### Sliced strings

Implemented on AArch64 (x86-64 still copies, so its readers never meet
a slice); A/Bs: [first](results/string-s7-ab-v1.md),
[one-bit flat tests](results/string-s8-ab-v1.md). The
[slice 3 A/B](results/string-slice3-ab-v1.md) showed `slice` at 7.9× and
`sliceTwoByte` at 13× Node. Each `substring` there copies 1–2 KiB, and the
copies alone take longer than Node's whole kernel, so the landing bar needs
sliced strings:

- **Object.** A sliced string is marker 1 with kind flag 2 (plus the
  one-byte flag 1): the header, its length, the byte offset of its first
  unit in the flat parent's units, and the parent (32 bytes), as V8 lays
  out its sliced strings. The parent is an ordinary reference slot that
  every collector reaches through its per-slot reference path (Cheney's
  `referenceSlot`, the parallel collector's, the compactor's
  `markReference`), as array views reach their owner. Nothing in a slice
  depends on its own or its parent's address, so collectors copy it
  verbatim. A slice of a sliced string points at the root parent, so
  chains never form.
- **When.** `slice`, `substring` and their relatives produce a sliced
  string when the result has at least 9 units and its
  kind is the parent's. A one-byte parent's long slices are always views.
  A two-byte parent's range is scanned for the canonical kind; when it
  narrows, the result is copied. So strings stay canonical, and equal
  strings keep equal kinds. Shorter results are copied after one length
  test, and the slice is initialized inline.
- **Readers.** Every reader of string data first resolves a string to a
  data base and a flat header:
  - a flat string is its own base;
  - a sliced string's base is its parent plus its start offset.

  The flat test is one bit test of the header (`tbz` on bit 49, or bit 17
  of the high word) on a header the reader loads anyway; the slice path is
  out of the flat path's way. The private string helpers do it once at
  entry. Equality compares lengths first; equal high words go to the
  helper, and otherwise only a pair including a slice does. Inline
  `charCodeAt` dispatches on the high word, flat one-byte first. Literals
  of eight or fewer bytes never equal a sliced string, which is longer.
  Host boundaries, the diagnostics reporter, debugger formatters and heap
  snapshots resolve the same way.

- **Retention.** Like V8's sliced strings, a slice keeps its whole parent
  alive. The 13-unit threshold bounds the overhead on short slices.

### Transfer contract {#transfer-contract}

PR #15 transfers large strings between isolates by copying a string
object verbatim into a shared off-heap arena. Its interface to this
representation is narrow:

- **Flat strings are transferable as they are.** A flat string's object is
  its header, length and units: position-independent, pointer-free,
  immutable and without per-isolate state. No hash or other field is
  cached in it. `nativeStringIsFlat(header)` tests a header, and
  `nativeFlatStringExtent(header, length)` (`@tint/abi/host`) gives the
  object's byte extent, `align8(16 + max(units × width, 8))`, or -1 for
  any other header.
- **Slices are flattened when sent.** Arena bodies are always flat. The
  realm side binds two IR instructions, through the memory intrinsics
  `isFlatString` and `flattenStringInto`:
  - `string-flat(string)`: 1 for a flat string, 0 for a slice;
  - `string-flatten-into(address, byteLength, string)`: writes the
    string's flat image (flat header, length, units and zero padding) at
    the start of a raw window and returns its extent, or -1 without
    writing for a window that is too small or has invalid bounds. A flat
    string's image is its object; a slice's units are copied once from
    its parent. A slice always has its parent's canonical kind, so
    flattening never changes the kind.

  Like `memory-write-bytes`, `string-flatten-into` may write any memory
  its window names, so a module that uses it loses the closed-world
  record-layout facts and needs the copying runtime.
  `tools/native-string-transfer.test.ts` checks the images, including a
  one-byte image literal's.

## SIMD

Before this work, AArch64 had only `ldr-q`/`str-q`, `add-4s`, `mov-16b`
and SHA-256, and x86-64 had scalar SSE2 doubles. Slice 1b added `UXTL`
(`uxtl-8h`), `XTN` (`xtn-8b`) and `SHRN #8` (`shrn-8b-8`) to AArch64, with
llvm-mc–checked encodings. The table lists the instructions the fast paths
need:

| Operation                     | AArch64 (NEON)             | x86-64 (SSE2 baseline)                                |
| ----------------------------- | -------------------------- | ----------------------------------------------------- |
| Narrow two-byte to one-byte   | `ld1` / `xtn` (`uzp1`)     | `packuswb` once the range is checked                  |
| Widen one-byte to two-byte    | `ushll` / `zip1` with zero | `punpcklbw` / `punpckhbw` with zero                   |
| Range check (any unit > 0xFF) | `orr` accumulate, `umaxv`  | `por`, then `pmovmskb` of `pcmpeqb` on the high bytes |
| Search first unit             | `cmeq` + `shrn`/`umaxv`    | `pcmpeqb` / `pcmpeqw` + `pmovmskb`                    |
| Compare and copy              | `ldp q` / `cmeq`           | `movdqu` / `pcmpeqb`                                  |

AArch64 now widens, narrows and scans eight units per instruction, and
copies sixteen bytes per step. Copies of 2–16 bytes use two overlapping
loads and stores with no loop. Small copies dominate string building, and
byte loops there cost more than the bytes saved (v2's `create` and
`template`). x86-64 keeps libc `memmove`/`memcmp` for same-kind copies and
unit loops for mixed kinds; SSE2 versions follow where the benchmark
requires them.

## Bulk text primitives

Slice 3 adds four foundation functions in `foundation/text/latin1.ts`. Each
has a portable body that Node runs. Native builds bind each one to an IR
instruction of the same meaning, as `sha256-rounds` is bound
(`projectBuildRequest` intrinsics, applied when the source defines the
function):

| Function                                        | Instruction           | Native code                                                                                                                    |
| ----------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `latin1Text(bytes, begin, limit)`               | `string-from-latin1`  | One one-byte allocation and a byte copy                                                                                        |
| `copyLatin1(text, begin, limit, bytes, offset)` | `string-copy-latin1`  | One-byte text: a byte copy. Two-byte text: narrow eight units per step (`SHRN` checks the high bytes); -1 at a unit above 0xFF |
| `asciiEndOfText(text, begin, limit)`            | `string-ascii-prefix` | Sixteen bytes per step against the mask 0x8080… (0xFF80… for two-byte units); the first flagged unit by `RBIT` and `CLZ`       |
| `asciiEndOfBytes(bytes, begin, limit)`          | `bytes-ascii-prefix`  | The same scan over bytes                                                                                                       |

Indices must be exact uint32 values in range. Anything else is an invariant
failure: native code traps, and the portable bodies throw. The three
nonallocating instructions inline into their callers like typed-array
accesses. x86-64 scans a word at a time and copies with `memmove`.

`foundation/text/utf8.ts` binds three UTF-8 primitives the same way. A
surrogate pair inside the range is one scalar, and a lone surrogate encodes
as U+FFFD:

| Function                                       | Instruction                     | Native code (AArch64)                                                                                                                                                                                                     |
| ---------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `utf8ByteLength(text, begin, limit)`           | `string-utf8-length`            | One-byte text: the count plus the units at 0x80 or above, sixteen per step (bit 7 of each, summed by a multiply). Two-byte: ASCII four per step, then scalar by scalar                                                    |
| `writeUTF8(text, begin, limit, bytes, offset)` | `string-write-utf8`             | Scalar by scalar while the next one fits, with ASCII eight units per step (two-byte text narrowed by `XTN`); returns the index after the last unit encoded                                                                |
| `utf8Text(bytes, begin, limit)`                | `string-from-utf8`              | Decodes the longest valid prefix: a measuring pass (units, kind, prefix length; ASCII sixteen bytes per step), one allocation of the canonical kind, then a decoding pass (ASCII eight bytes per step, widened by `UXTL`) |
| `utf8WholeText(bytes, begin, limit)`           | `string-from-utf8` with `whole` | The same, but the empty string unless the prefix is the whole range (a nonempty valid range never decodes to it)                                                                                                          |

The decoding pass stays within the measured units and bytes whatever the
bytes hold, since a shared buffer may change between the passes, and it
zeroes any units it does not write. x86-64 runs the same contracts one unit
at a time.

The UTF-8 codec is built on them. ASCII text and input take one Latin-1
scan and one copy, as before. Other text encodes as one length pass, one
allocation and one write. Other input decodes with `utf8WholeText` (after
a dropped byte order mark). Only when it is not all valid does it take
the valid prefix with `utf8Text`, find the prefix's end (by its length
for ASCII, otherwise by re-measuring the decoded text, since valid UTF-8
is canonical), and run the byte state machine on the rest. The state
machine's ASCII runs use the Latin-1 primitives.

## Gaps to Node beyond the representation

The [baseline](results/string-baseline-v1.md) measures typed kernels at
1.2–1000x slower than Node 26.13.1. The representation alone halves copy
and compare work for Latin-1 text, but the large gaps are algorithmic:

| Area                                               | Cause                                                                                                     | Fix                                                                                                           |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `numberString` (~300x)                             | Fractional `numberToString` expands the exact decimal and round-trips candidates through `stringToNumber` | A shortest round-trip formatter (Ryu-style) in `foundation/numeric`                                           |
| `utf8` (~100x)                                     | `decodeUTF8` appends `String.fromCodePoint` per point; `encodeUTF8` uses scalar `codePointAt`             | ASCII and Latin-1 fast paths: an ASCII one-byte string's UTF-8 is a copy; decode chunks into one-byte strings |
| `clone1KiB`, `clone1MiB` (300–1000x)               | Main's Worker codec builds a UTF-16 packet string                                                         | PR #15's binary codec replaces it; this stream adds its one-byte wire encoding there or in a follow-up        |
| `slice` (~12x)                                     | Every substring copies; V8 slices                                                                         | Copies halve with one-byte; sliced strings ([above](#indirect-strings)) for parity                            |
| `search` (~3x)                                     | `indexOf` loops `string-starts-with` per position                                                         | One `string-index-of` primitive: first-unit scan, then compare                                                |
| `codeUnits` (~3.4x)                                | `charCodeAt` on a double index converts and calls a helper                                                | Integer index with an inline kind test; hoist the kind test out of loops                                      |
| `concat`, `equality`, `create` (2–2.6x)            | Flat copies, helper calls, allocation                                                                     | One-byte halves the bytes; inline compares; builders or ropes                                                 |
| `upperCase` (~1700x), `json` (~28x), general suite | General-runtime per-character work                                                                        | Latin-1 case-mapping fast path; JSON quoting scans; general-runtime call costs belong to PR #12               |
| `mapKeys` (~1.3x)                                  | `hashString` in TypeScript per lookup                                                                     | A native code-unit hash helper; a cached hash coordinated with PR #12                                         |

## Memory

A frozen v3 census ([heap findings](results/native-heap-findings-v3-obs.md))
puts string bytes at about 19 MiB of the 770–934 MiB live heap (2%). Strings
are 3.0 GiB of 73.4 GiB allocated (4%). One-byte storage saves at most half
of the string data beyond the 32-byte minimum, so the self-compile's peak RSS
should drop by about 1% at most. String-heavy programs, Worker string copies
and large texts save up to half their string bytes.

## Slices

**Landing bar.** PR #18 lands as one change, only when every operation in
`tools/string-bench` (typed and general suites) is at or faster than Node
26.13.1 on both macOS arm64 and Linux arm64. The set also includes PR
#17's `strings` and `stringBuild` kernels (`tools/typed-bench` at
`aab393287`), which moved to this stream. PR #15's isolated 1 MiB
structured-clone case also depends on this stream. The slices below are
steps within the PR, not separate landings.

Each slice must include:

- semantic tests (ordering, the 0xFF/0x100 boundary, surrogates, mixed kinds,
  and abrupt completion where it applies);
- native fixtures run under LLDB, with Node reference tests;
- the Test262 `built-ins/String` and `built-ins/RegExp` selections, with
  exact denominators against main;
- stage 2 = stage 3, a frozen v7 run with `--runtime-tree`, the native
  self-compile, the ledger and CI.

1. **Flat kinds (done).** This covers:
   - the ABI and debug kind table, the collector, both backends' primitives
     and literal pools, the diagnostics reporter and debugger formatters;
   - the `string-two-byte` IR query and the `string-allocate` kind.

   This is one atomic change: the system cannot produce one-byte strings
   before every consumer reads them. Canonicality is checked by the native
   fixture's equality checks (`tools/native-one-byte-strings.test.ts`): a
   non-canonical string never equals its literal, rather than through a
   separate verification mode.

2. **Primitive fast paths.**
   - Done:
     - the `string-index-of` primitive (`indexOf`, `lastIndexOf`,
       `includes`, `split`);
     - inline `charCodeAt` kind dispatch;
     - header-and-length equality;
     - one-byte literal compares of eight units per word;
     - NEON widening, narrowing and scans;
     - loop-free small copies;
     - one allocation per four digits in `String(n)` (`decimalInteger`);
     - one-unit strings of units below 256 from a table of pooled literals
       at the head of each module's literal pool, without allocating
       (V8's single-character string table; AArch64);
     - the `charCodeAt` in-bounds proof through lengths stored to a slot
       and copied between slots, so `codeUnits` runs as integer
       arithmetic (4.4× to 1.35× Node);
     - `version-string-loops`: a small loop reading code units of a
       string it never changes is entered through a copy for each flat
       kind (tested once in the preheader), whose reads load their unit
       without the kind dispatch; slices take the loop unchanged.
3. **Codec and number fast paths.**
   - Done:
     - the bound Latin-1 and ASCII primitives
       ([above](#bulk-text-primitives)), and the UTF-8 codec moving ASCII
       runs through them;
     - exact `String(n)` for decimals of at most 15 significant digits,
       Clinger's fast path in `Number(text)`, and integers below 10^8 in
       one allocation;
     - native UTF-8 transcoding for non-ASCII text (`utf8TwoByte`;
       [above](#bulk-text-primitives));
     - a number-string cache behind `numberToString` (V8's
       NumberStringCache): 256 direct-mapped entries of a number's bits
       and its string, in a table the runtime drops at every collection
       (`nativeNumberStringCacheWord`), so it is never traced and retains
       nothing across collections (AArch64; elsewhere lookups miss);
     - JSON: strings without escapes parse as one slice of the source,
       and stringify quotes strings with nothing to escape whole;
     - typed code looks the number-string cache up inline
       (`number-string-cached`) and calls `numberToStringMissed`, which
       formats and caches without a second lookup, only on a miss; the
       cache indexes a number by its truncation plus its low bits word, so
       small integers take consecutive entries and never evict each other;
     - `Number(text)` scans a plain decimal in one pass; digit formatting
       multiplies by exact-enough reciprocals instead of dividing; short
       fractions join their integer digits, point and padded fraction
       digits in one concatenation.
   - Open: a shortest formatter for the remaining doubles (Ryu or
     Schubfach style), and parsing (`numberString` spends about 30% in
     `stringToNumber`).
4. **Sliced strings (done on AArch64).** Long `slice` and `substring`
   results share their parent's units ([above](#sliced-strings)); the
   transfer interface for PR #15 ([above](#transfer-contract)); the minimum
   length (9) by a [sweep](results/string-slice-minimum-v1.md). Open:
   x86-64.
5. **Building:** `build-loop-strings` rewrites loops whose only uses of a
   string local are appends to fill a buffer with spare capacity. Its
   first three growths concatenate exactly, so loops of a few appends copy
   no more than before; later growths double the buffer. One-byte
   concatenations of at most eight units join two data words inline, and
   one-byte parts of at most eight units are written as one word while it
   fits the target's data (every builder writes in offset order, and bytes
   past a string's length are never read). Open: ropes, if the builder
   does not reach parity; two-byte parts (inline two-byte writes cost the
   one-byte kernels more than they saved).
6. **Hashing:** a native code-unit hash, and a cached hash with PR #12.
7. **Workers:** the one-byte wire encoding in PR #15's codec.
8. **SIMD:** NEON and SSE2 instructions where scalar loops still trail Node.

## Coordination

- **PR #17 (typed codegen):** it dropped its string-builder item in favour of
  this stream. Its typed class lowering may touch typed string lowering.
  `tools/string-bench` derives from its `tools/typed-bench` harness; fold
  them together when both land.
- **PR #15 (Workers):** it owns the clone codec. The one-byte wire encoding
  lands there or in a follow-up once flat kinds land.
- **PR #12 (general runtime):** it changes string-keyed property lookup and
  key hashing. Hashes stay on code units here. A cached hash word or
  interning is agreed with #12 before either lands.
