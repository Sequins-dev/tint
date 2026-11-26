# Typed AArch64 backend packets

November 22, 2026. The prototype is based on
`a2fa55d64add2ce9d1eb21b930fe7c4f913cedc8`. Node-hosted preparation and
tests used Node 24.12.0 and `TZ=UTC`. The packed codegen input was the
frozen 7,111-function capture, SHA-256
`5115e42db0c942900e33cac5d03c82939fa2c7b03d68719445bfb260d7b5fce4`.
AOT optimization and analysis budgets were unchanged.

## Packet identity

The same backend preparation writes 44,786,949 bytes of bodies and
per-value facts and 2,540,589 bytes of common preparation. The persistent
actor opens the preparation once. It lazily decodes function bodies
from the immutable byte window. The schedule has 35 contiguous ranges
sorted by estimated cost, including 17 large functions assigned their
own jobs. The two largest have estimated costs of 4,587,060 and
4,587,043 and slot/block products of 478,973,793 and 478,898,080.

| Packet | SHA-256 |
| --- | --- |
| Bodies and per-value facts | `bb0bb70a63735faed98c91344abb28bfbeabf8ad26c17b782cfa2f87c06c1ae0` |
| Common preparation | `fc26e62576070157a0185c9b56035402bff7986b8caf319f7e61cea65b329e28` |

The first full packed replay matched all 48,799,664 code bytes and had
one metadata difference. The near-form import decoder omitted the
`far` property that serial emission populated with `undefined`.
A focused foreign-relocation regression reproduced it. The corrected
replay matched every field of the frozen backend golden, including
imports, stack maps, descriptors, unwind entries, function ranges and
form hints. The code SHA-256 is
`ed326c4353628ea079f6e765cbcd2bfb2a89d2b37eb2077d88103c39aab36c75`.

The compiler and codegen tests cover the packed handoff, canonical
placement, out-of-order replies, near and far imports, spill order,
and rejected packet headers. The focused run passed 47 cases.
Workspace type checking, the dependency boundary check, and the
complete native compiler pipeline subset test passed.

## Native execution

The stopped-at-entry typed packet smoke fixture ran under LLDB on
macOS arm64 and Linux arm64 and returned 42 after comparing emitted
code to its serial control. A second Linux arm64 fixture used the
typed Worker entry bridge from the earlier register-home experiment.
Each persistent Worker opened the same two immutable file-backed
mappings once. Requests carried a range ID and completion messages
carried that ID back. Each Worker published its typed result packet.
The inline fixture and the fixtures using 1, 2 and 3 actual Workers
each returned 42 under LLDB and reproduced all three Node reference
packets by `cmp`.

## Full compiler handoff screen

The experimental native CLI includes a force-collection hook and a
late packing path. The first screen stopped during source intake
because the newer compiler catalog expected an extra source path.
A compatibility copy added an empty, unreachable file at that path.
With the fragment setting off, the Linux arm64 compiler completed the
frozen workload and reproduced the 49,771,592-byte serial ELF,
SHA-256 `30c2dcb3323529be64ba35c4ca114b112936bc6b2caccf34a2479e3903dcb440`.
The single stopped-at-entry diagnostic cell took 100.80 s and sampled
2,095,992 KiB kernel peak RSS and 12,064 total CPU ticks. It provides
a control for functional diagnosis.

The enabled late packing path stopped on `BRK #3` in
`emitProgram` before the range planner produced a first marker.
A second build that explicitly skipped the new source paths at
intake reached the same guard. Both variants stopped before the
force-collection hook and produced no executable. The Linux fixture
uses the copying worker heap. The full compiler runs with the
generational heap. Worker scratch admission, full-image identity by
worker count, paired wall and RSS measurements, and the fixed point
remain incomplete for this candidate.

Raw evidence is in `.tint-bootstrap/worker-overhead.BMVafJRT`.
The full packet identity comparisons are
`frozen-typed-packets-digest.log` and `frozen-typed-packets-digest-r1.log`.
The functional worker logs are in `actor-tiny-linux-aarch64-*/fixture.log`.
Full-compiler screens are `native-fragment-r0-linux-aarch64-*.log` and
`native-fragment-integration-linux-functional.log`.
