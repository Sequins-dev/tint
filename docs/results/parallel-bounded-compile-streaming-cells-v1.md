# Object suite loop-cell promotion and the next hydration boundary

November 21, 2026. These diagnostic runs used Node 24.12.0 on macOS arm64,
the monolithic Object Test262 selection of 2,252 variants, and the same
frozen input as the earlier streaming trials. Its SHA-256 is
`7d3f40ab7477dce55da4b3dff2f539c91678141eba2ee077a7556968fcbeed42`.
The baseline image is 189,938,783 bytes with SHA-256
`101fb0f4674648a163500a09793b756aec7d1e0baefc4e6ee721f50fd1485290`.

## Loop-cell promotion

The prototype scans function bodies one at a time to build the call and
cell-layout summaries. The rewrite decodes each function again and uses the
original block and instruction position to retrieve the call summary. The
summary carries no decoded call instruction references. The rewrite uses
the ordinary compiler's full AOT work allowance and applies functions in
original order.

The Object run finished this pass on 37,475 functions with 7,024,959
summary work units and 193 promoted loop-cell pairs. Values below are
instantaneous samples from the Node process. Use the OS high-water mark
for the run's peak.

| Boundary              |   RSS (bytes) | JS heap used (bytes) | External bytes |
| --------------------- | ------------: | -------------------: | -------------: |
| Optimizer entry       | 3,265,511,424 |          380,170,328 |    135,108,916 |
| Before cell promotion | 3,066,937,344 |          478,040,648 |    125,432,285 |
| Cell summary complete | 3,061,628,928 |          423,825,464 |    123,275,625 |
| Cell rewrite complete | 3,071,770,624 |          488,519,672 |    130,684,617 |

The next pass, bulk list copies, still entered the diagnostic runner's
generic module driver. The driver attempted to decode all 37,475 functions
before the pass could look for list helpers. V8 ran out of heap during that
hydration. Bulk list copies can find candidate helpers by name from
function headers. It only needs the bodies of matching helpers for its
summary, followed by one caller body per rewrite.

## Whole-process measurements

Both probes used an 8 MiB packed-store budget. The 2,130 MiB attempt also
used a 4 MiB V8 semispace setting. It kept subsequent record proofs, selected cleanup
and final prune on packed bodies, and screened bulk and vector helpers
using headers before taking the module-wide path. It ran out of heap in
the frontend before the main suite reached optimizer entry.

| Prototype                     | V8 old space (MiB) | Wall (s) |  CPU (s) | Cycles (billions) | Peak RSS (bytes) |
| ----------------------------- | -----------------: | -------: | -------: | ----------------: | ---------------: |
| Packed through cell promotion |              2,400 | 1,156.51 | 1,738.85 |          4,669.22 |    3,658,301,440 |
| Packed through optimizer tail |              2,130 |    94.00 |   161.51 |            437.89 |    3,092,086,784 |

Neither run produced the suite image. The first run had already reached
3,328,278,528 bytes RSS before the initial optimizer prune. A live allocator
inspection during its optimizer run showed 500.4 MiB resident in empty
small malloc regions and 92.1 MiB resident in empty large malloc regions.
The operating system's separate physical-footprint peak was
2,908,001,224 bytes. The RSS criterion includes resident allocator pages.

A small captured-closure and inlining fixture produced identical code,
symbol and line data in memory, budget and forced-spill modes. The code
SHA-256 was
`b2b7f3adbabfe0382d5b4daf57d14345c12ed17877a3a1930b4828f4a7211d02`.
The focused cell promotion test also exercises two address-taken closures
of the same signature, with a distinct target set for each call site.
These checks cover the streaming semantics on the fixtures.

The Object measurements were diagnostic screens on a shared host. The
prototype used an array proxy to run the existing passes in Node and
remains outside the compiler. Raw logs in the experiment directory are
`object-packed-cells-2400.log`, `object-packed-tail-2130-r1.log`,
`object-packed-cells-2400-vmmap.txt`, and `packed-tail-smoke-recheck.log`.
An earlier 2,130 MiB attempt failed before compilation because the
heartbeat worker inherited a semispace CLI flag. The measured rerun
supplied both V8 limits through `NODE_OPTIONS`.
