# Native constant-folding hot-body replay

November 27, 2026. Pass 62 in the
[emitter outline screen](parallel-bounded-compile-emitter-outline-v1.md)
took 35.255 s on macOS arm64. A follow-up probe measured phases inside
`foldFunctionConstants` on the same frozen input. The probe reproduced the
signed compiler image and recorded 45.341 s for the pass, including
35.733 s in function 8154 and 4.780 s in function 8220. The ID scan, tag
proofs and optional-slot proofs for function 8154 totaled about 1.14 ms.
It made zero dense substitution arrays during this pass. The same
function call took 21.4 ms in the Node trace.

Function 8154 has 21,549 blocks and 35,119 instructions. A census of its
packed input found 24,428 loads and 3,780 stores. Some loads have value
IDs above 2.6 million. The sum of the per-block spans up to the highest
load ID is 41,342,473,012 indexed elements. Even a load with an unknown
length wrote an `undefined` entry at that index in a fresh local list.
The corresponding store-slot span, across block and effect boundaries,
was 14,156,526 indexed elements.

## Native replay

The typed fixture decoded the same body on each arm64 host and timed
constant folding using the native monotonic clock. Each completed trial
visited 35,119 instructions and returned 29 rewrites. It compared the
re-encoded result byte for byte with the Node reference and exited 42
under LLDB. Input SHA-256 was
`38fabb44b0876745b9efc9b05207401cb62f7697ac2194f6a300afdd37b1384b`.
The rewritten body SHA-256 was
`c3352ca9306ffaf4411ee45bdd627b9fb65d671a7166b2edb91bacabf48788b9`.

The initial fixture compared the existing implementation, reuse of the
substitution table, reuse of the block-local value facts with resets at
block boundaries, and that value-fact reuse plus generation-stamped
slot facts. All four variants also matched the packed reference in the
Node replay and rejected a work budget of 100.

| Variant                       | macOS kernel time |      macOS peak RSS | Linux kernel time |      Linux peak RSS |
| ----------------------------- | ----------------: | ------------------: | ----------------: | ------------------: |
| Control                       |   51.630–53.211 s | 370,032–374,128 KiB |   86.066–99.001 s | 372,596–372,808 KiB |
| Reuse the substitution table  |   54.586–55.513 s | 370,032–377,296 KiB |          74.085 s |         373,388 KiB |
| Reuse block-local value facts |  40.379–41.622 ms | 263,776–263,792 KiB |  59.473–84.521 ms | 259,092–259,860 KiB |
| Also reuse slot facts         |  37.273–38.740 ms | 262,336–262,384 KiB | 74.761–168.856 ms | 258,164–258,280 KiB |

The macOS trial order was control, substitution, value facts, slot
facts, slot facts, value facts, substitution, control. The original
Linux rotation completed its first three cells before the host idle
watchdog stopped the guest command. The retry completed control, value
facts, slot facts, control with a deadline covering both long controls.
The isolated RSS and CPU measurements include decoding and verification.
On macOS the control median retired 915.2 billion instructions and
238.3 billion cycles. The value-fact reuse median retired 1.03 billion
instructions and 0.29 billion cycles.

## Skipping unknown array lengths

The narrow variant keeps the block-local lists and writes a load's
array-length fact only when its source slot has a known length. A load
defines a fresh block-local value. Skipping the write leaves all reads
of the absent fact unchanged. Stores still invalidate an old fact when
an assignment has an unknown length.

The macOS rotation ran candidate, control, control, candidate. Median
kernel wall fell from 49.705 s to 76.605 ms. Median process peak fell
from 373,776 KiB to 294,296 KiB. Median instructions fell from 903.13
billion to 1.66 billion and cycles from 230.56 billion to 0.46 billion.
Both candidate cells reproduced the same reference bytes and passed the
same work and rewrite checks. The whole-build qualification uses this
variant in a separate checkout.

The Linux rotation ran control, candidate, candidate, control. The
median fell from 66.471 s to 112.934 ms. Median peak RSS fell from
373,422 KiB to 325,074 KiB and process CPU from 8,514 to 14.5 ticks.
All four outputs matched the packed reference.

Raw evidence is under `.tint-bootstrap/outline-v2.CaPaRsha`, including
the `fold-profile-native` outputs, `fold-body-8154`,
`count-fold-fact-spans.mjs`, and the `fold-kernel-*-results.log` and
`fold-length-*-results.log` records.
