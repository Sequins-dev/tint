# Native reference vectors for generic arrays

The compiler build requests `denseReferenceLists`; selection requires a closed
executable and proof that the list header is private. Managed vector storage,
generated list policy, moving-GC tests, and a complete self-build are verified.
The `direct-references-v2` capture is 246.69 seconds, with matching Node/native
compiler binaries and a stage2 smoke program exiting 42. This includes debugger
pause and profiling overhead. The one-minute target is not met.

## Storage and semantics

Managed vectors have marker 6, flags, capacity, and a reserved word, followed by
aligned reference slots. Allocation, extent calculation, scanning, relocation,
shadow roots and write barriers share this contract. Payload addresses are derived
from the current object pointer rather than retained across safepoints.

The source list header retains length and a nullable root. An absent root is an
empty list; a vector root uses dense storage; an ordinary tree root preserves the
original sparse implementation. Allocation is lazy. Geometric growth serves dense
writes; a high or disproportionately sparse index migrates present entries into
the sparse tree. Shrinking clears removed references; zero length drops the root.

Reference elements are stored directly. A null slot is a hole, the private vector's
own identity represents present undefined, and any other reference is the value.
The vector cannot be observed by source code under the required opacity proof,
so a source value cannot collide with this marker. Source arrays containing other
arrays hold their public list headers, not private storage vectors. Growth
translates the old self-marker to the replacement vector; sparse migration
translates it back to undefined. Relocation treats the marker as an ordinary
self-reference, preserving both identity and presence.

String arrays use the same direct encoding: a string is one managed word, so
each element slot holds the string itself (null a hole, the vector present
undefined). The accessors view that word as a reference through
`string-reference` and back through `reference-string`; presence is decided on
the reference, so an empty string is a present element. Pushing a string
allocates nothing beyond vector growth.

Boxed primitive, general and optional-boolean arrays use private typed value
cells. A null vector slot is a hole; a nonnull cell holds its element encoding.
Existing cells update in place. Missing boxed primitive reads invoke the original reader on a private
empty header, preserving the primitive runtime's undefined encoding. That cold
path currently allocates. Numeric arrays retain their separate implementation.

## Compile-time authorization

The embedding explicitly identifies bundled collection runtime bindings.
`lowerReferenceLists` filters unused specializations using closed-root reachability,
checks every active ABI and header construction, and rejects unrecognized private
root access or mutation. Ordinary length reads remain valid. Raw inspection and
unknown aliases decline the rewrite. Recognizing a module name alone is insufficient.

Additional generic instantiations require matching original source provenance,
calling conventions, and transitive record-layout sets. Comparing only direct
layouts is unsound: `hasList` delegates node inspection to `findEntry`, whose
payload layout can differ across specializations. The graph analysis includes
callee accesses, and indexed caches reuse these facts. A reachable unbound
`popList` or another private mutation still declines the transform.

The policy is TypeScript code producing typed IR. It constructs read/write/has/
delete/resize helpers and preserves consistently rewired sparse fallbacks.
Create, length, and push retain compatible source logic. Generic specialization
preserves actual result encodings; numeric host calls never hide pointers.

## Validation and remaining work

`tools/verify-reference-vectors.ts` validates native vector primitives and marker
discrimination. `tools/verify-reference-list-policy.ts` checks growth, overwrite,
holes, undefined, deletion, resizing, invalid inputs and sparse migration against
the original list implementation.

`tools/verify-dense-lists.ts` requires actual dense-pass selection, compares Node
behavior, and executes twice under moving GC and LLDB. It covers reference,
string and boxed primitive arrays; aliases, cycles, closures, nested arrays,
sorting, key-index collisions/deletion, and present undefined across growth,
relocation and sparse migration. `TINT_DEBUG=1 TINT_BUILD_ONLY=1` retains a
symbolized artifact for diagnosis. The same expanded suite also passed with
cell-based reference storage as a control.

Old-vector mutations participate in remembering. Whole-object remembering is
correct but may rescan a large vector; card/range remembering remains a possible
measured follow-up. No further allocation or timing improvement is assumed
without another complete self-build profile and artifact verification.
