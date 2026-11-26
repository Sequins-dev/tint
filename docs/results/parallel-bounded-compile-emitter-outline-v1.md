# Native emitter outlining screen

November 27, 2026. This experiment used PR #4 at `2912951cf` and the
881-source snapshot from the [current-main recheck](parallel-bounded-compile-recheck-v2.md).
It tested whether decomposing `emitModuleForms` could remove the longest
job from the native actor schedule.

The first variant moved the six handlers for host calls, foreign calls,
foreign memory, script entries, record construction, and string flattening
into typed local functions. The second variant also moved the basic-block
traversal into a typed local function. Both variants use the original
emission helpers and state. The source transformation preserved nested
loop and switch exits within each handler.

One instrumented native compiler built all three frozen snapshots. It
recorded large function emissions using the native monotonic clock. Each
native build ran on macOS arm64 under LLDB with both gate locks and a
verified inferior exit of zero. Each image matched the Node-hosted
bootstrap of the same source. These are input-shape comparisons. They
come from single observations and include load from other bootstrap
processes on the host.

| Frozen input                          | Functions | Largest emission job | Blocks in that job | Slots in that job | Total emission |
| ------------------------------------- | --------: | -------------------: | -----------------: | ----------------: | -------------: |
| Original                              |     7,782 |             17.616 s |             35,130 |            18,963 |       41.651 s |
| Six opcode handlers outlined          |     7,800 |              8.082 s |             30,930 |            14,770 |       32.129 s |
| Handlers and block traversal outlined |     7,846 |              2.044 s |             15,901 |             5,790 |       30.731 s |

The second-largest job for the third input took 1.938 s and had 14,953
blocks and 4,701 slots. In the Node-hosted bootstrap the largest jobs for
the three inputs took 16.192, 12.159, and 2.540 s. Outlining removed the
single-job floor and also reduced the amount of serial emission time a
worker pool can recover.

The block-outline compiler itself compiled the original frozen input to
the same 46,250,634-byte signed image, SHA-256
`1f168e8a89fd6303ce999103f4946c4902daa83e4b81841fa5bdd0de6565f012`.
Its `emit-native-code` pass took 63.457 s on that input. The common
probe's 41.651 s control came from an earlier lock ticket, so that
comparison leaves commit and host effects confounded. It gives no
evidence for retaining the closure-based outline as a speedup.

The serial block-outline compiler reached the native macOS fixed point.
The Node-hosted bootstrap, stage 2 and stage 3 all matched at
44,582,922 bytes with SHA-256
`34e1eef26724bcf69941ad405c9a48a08724aa9bcea6b3a3213ccc177f5ab62e`.

The remaining per-function constant-folding sweep, pass 62, took 28.842 s
on the original input and 35.255 s in the outlined screen. It visited
2,945,062 instructions and rewrote 5,814 on the latter. This pass is a
second scheduling candidate. The earlier SSA experiments measure a
different operation.

A Node-hosted function trace of the outlined input accounted for the
same pass counts. The pass processed 7,421 functions, changing 930.
The 7,421 timed calls totaled 1.331 s, with just 0.039 s in the
largest call. The traced bootstrap reproduced the signed image. The
profile isolates a native cost to investigate before distributing that
sweep.

Build manifests, snapshots, the source transformation, run scripts and
profiles are under `.tint-bootstrap/outline-v2.CaPaRsha`. The primary
logs are `native-profile.log` and `native-block-outline.log` and their
per-build `.pass-stats.json` files. `observe-fold-load.mjs` and
`fold-pass-block-outline.json` contain the Node-hosted fold trace.
