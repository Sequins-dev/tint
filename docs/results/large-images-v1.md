# Full-size AArch64 image verification

The hosted fixture compiled a copying collector and a program that keeps a
heap object live in a far frame while calling `collectGarbage()`. The fixture
inserted a 4 GiB + 64 KiB gap between the compiled runtime and application.
It then linked and wrote each image through the production hosted path.
Both builds used Node 24.12.0 and the same 768-file compiler source snapshot,
SHA-256 `2b6b3f273411c7c10ef506b966994ca2d959e004f047c41f414aff249ebd1a0d`.

| Target | Image bytes | SHA-256 |
| --- | ---: | --- |
| macOS 26.6.2, arm64 | 4,332,685,956 | `cf8fe122b2621671d854545ce53db233d790dd7997523582673ce218571ae8d3` |
| Linux, arm64, `dev` VM | 4,299,008,048 | `e79f128e1e493a3b428c959cd4e37e2078f41271746e052c8bb551121bfb0e4a` |

LLDB resolved the Mach-O symbol `program:fixture:retainAcrossCollection` at
`0x404b6da74` after launch. The backtrace included `program:__tint_invoke`
and `tint:process-entry` at `0x304a28c44`, a VM separation of 4,296,298,032
bytes. The inferior exited 42 after continuing through copying GC.

GDB resolved the ELF symbol at `0xaaabd33b6a98`. The backtrace included
`program:fixture:run`, `program:__tint_invoke`, and `tint:process-entry` at
`0xaaaad3271c44`, a VM separation of 4,296,298,068 bytes. The inferior
exited 42 after continuing through copying GC. Both verifiers removed
their temporary images.

The first attempts built both multi-GiB buffers and hit Node's signed
32-bit limit on one filesystem write. The successful runs used the shared
bounded write loop.

See the [verification commands](../large-images.md#verification).
