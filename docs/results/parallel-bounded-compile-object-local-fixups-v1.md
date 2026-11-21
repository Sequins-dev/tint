# Object emission with function-local fixups

On November 21, 2026, a Linux arm64 run captured the packed AArch64
emitter input from all 2,252 variants of the frozen Object Test262
selection. The archive contained 29,636 function records, 27,198 record
layouts and 146,836,351 bytes across 87 files. The archive digest is
`6ede15208e356d7a40f4466e0e95089cf19f3e03ee607c800d097981a113c2a8`,
computed from each filename followed by a zero byte and its binary
SHA-256, in filename order.

The capture used a 256 MiB decoded cache. RSS at archive publication
was 5,257,367,552 bytes, with 418,313,032 bytes of JavaScript heap
in use. The capture process was stopped after it published the archive.
At 55:15 wall and 46:30 CPU, its RSS high-water mark was 5,681,280 KiB.
It produced no complete image. The separate typed streaming run had
already produced the complete byte-identical signed Object image.

## Isolated macOS replay

The Node v24.12.0 replays read the same frozen packed records. Each
ran with a 4 MiB semi-space setting. The candidate patched branches
whose targets belonged to the current function as soon as their
offsets were final, then released those fixups. It interned repeated
safepoint root arrays. Global layout still placed functions and
symbols in the original order.

| Emitter | Old space (MiB) | Wall (s) | CPU (s) | Cycles (billions) | Peak RSS (bytes) | Result            |
| ------- | --------------: | -------: | ------: | ----------------: | ---------------: | ----------------- |
| Serial  |           2,176 |   295.24 |  329.64 |           812.364 |    2,946,416,640 | V8 heap exhausted |
| Compact |           2,176 |   246.69 |  289.00 |           756.143 |    3,102,851,072 | Complete          |
| Serial  |           3,072 |   238.03 |  302.12 |           859.634 |    4,179,214,336 | Complete          |
| Compact |           2,048 |   222.36 |  267.03 |           759.050 |    2,881,650,688 | Complete          |

The last two replays ran concurrently in separate memory slots.
Heap settings differ across the successful serial and compact
runs. Their times measure the configurations in the table.

A separate 2,048 MiB replay released local fixups with stack-map
interning disabled. It exhausted V8 old space at global placement.
Peak RSS was 2,927,296,512 bytes, with 205.54 s wall, 269.56 s
CPU and 815.309 billion cycles. Both changes were active in the
completed 2,048 MiB replay.

All three successful replays emitted 186,355,560 code bytes that
matched by `cmp`, SHA-256
`6e42a42f0c30980ba303b31181736a88a1701260aa465f3960ca164f5b5db238`.
At 29,500 functions, the 2,176 MiB serial emitter kept 2,802,235
branch fixups. The compact emitter kept 112,584 at the same point.
The 2,048 MiB compact emitter reached global placement at
2,557,886,464 bytes RSS and 1,170,139,632 bytes of JavaScript heap
in use. The highest RSS of that complete replay was 2.68 GiB.

The replay covers native code emission from the packed archive.
The whole Object build includes collection-runtime preparation,
where the instance check reached 4,043,046,912 bytes RSS. That is
the remaining whole-program memory boundary.
[Object instance-check resident set](parallel-bounded-compile-shared-preparation-v1.md#object-selections-collection-runtime-retry)

The separate typed streaming compiler reached a fixed point on
macOS arm64. Stages 2 and 3 both exited zero under LLDB and produced
50,312,586-byte images, SHA-256
`388d8172f3584204475fd58fee7e7655a8ac5ba087f2a64bba8d698b8c40219a`.
The Linux arm64 fixed point used the same typed streaming sources.
[Linux fixed-point evidence](parallel-bounded-compile-native-register-homes-v1.md#typed-streaming-compiler-fixed-point)

Raw logs are `object-emission-wide-cache-linux.log`,
`object-emission-wide-cache-stop.log` and
`object-emitter-replay-{serial-2176,compact-2176,reference-3072,compact-2048,local-only-2048}.log`.
The macOS fixed-point runs are `typed-store-mac-fixed-{2,3}*`.
