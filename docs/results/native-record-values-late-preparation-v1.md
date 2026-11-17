# Late field scheduling: preparation remains held

Preserving established scalar cleanup restores the baseline-sized compiler image
at **52,789,202 bytes**. The independent direct baseline and sealed control match
byte for byte. The candidate has the same length and differs only in two native
function bodies: heap `collect` 6,008→5,931 instructions and a generated cell
writer 9,756→9,753. No `hasSet` specialization changes. This is **80 static
instructions**, not a measured whole-compiler speedup. The candidate stays held.

Manifest-covered Node tracing explains why: the program has 3,525 functions,
1,224,972 IR instructions, 385,842 blocks and 364,261 slots. Both original and
late pipelines exhaust the unchanged 20-million-work bound in proven-record
lowering, before late field work. The 159-function runtime module completes its
existing passes and then performs 266,040 units of optional work, with 39
rewrites including cleanup. The trace observes compilation; it is not a native
CPU profile. No bound was raised.

All **24 exact-source native fixture/benchmark runs** stop initially and exit
42. Four-pair string-membership median CPU is 178.504→128.735 ms; instructions
2,022,031,838→1,631,741,690 and cycles 578,287,501→416,019,545. Reference CPU is
150.265→151.262 ms, effectively flat/slightly worse despite fewer instructions.
The short allocation/semantic fixture is also timing noise. Every repetition's
spread, load and missing-CPU bound is retained.

The frozen source is `51066a78e194886c50a7bbadebdca54177a3a9496d987669d3c0b1f1cba59e8b`
(605 files). This source has **not** completed a native compiler self-build or a
final green full gate. The six successful stage-image comparisons in the
[earlier assessment](native-record-values-assessment-v1.md) belong to earlier
source graphs and do not validate this source. [Raw late evidence](native-record-values-late-preparation-v1.json)
links the shared hash-indexed artifacts. No READY or main gain is claimed.

The coordinator selected steady-state eval contract/type-system reuse next;
[the scoped proposal](native-managed-preparation-next-slice-v1.md) records that
choice and defers private dense arrays and AOT metadata until the cache is
measured. J owns ordinary Script array/buildString fast paths.
