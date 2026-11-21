# End-to-end native SSA sidecar screen

November 21, 2026. The Linux arm64 `dev` screen ran the frozen 821-file
self-compile with the settled-SSA and LICM changes. Both cases used the
same instrumented compiler executable, SHA-256
`4d7feb923a821596298520686db4253f9c37b3c772e3a068bddeff290b7ec12f`.

The compiler packed its actual SSA input into 27 contiguous batches.
Every input batch matched the earlier frozen pass capture. A typed
sidecar ran two `node:worker_threads` workers against those files, using
one batch ID per message. After a pipe signaled completion, the
coordinator decoded the results into the original function order.

| Variant          | Self-compile wall (s) | CPU (s) | Peak sampled RSS (KiB) | SSA wall (s) |
| ---------------- | --------------------: | ------: | ---------------------: | -----------: |
| Serial control   |               302.077 |  315.82 |              2,093,900 |       11.986 |
| Two-worker files |               308.106 |  331.63 |              2,235,316 |       27.097 |

CPU is user plus system time, summed across both native processes in the
sidecar case. Peak RSS is the maximum contemporaneous sum sampled every
25 ms. Hardware cycles were unavailable in the VM. The sidecar pass took
2.302 s to pack the live input, 20.256 s to hand off and wait, and 4.538 s
to merge. The measurements preserve a single control-first screen.

The compiler exited zero in both cases and all optimization work counters
matched. All 5,665 decoded SSA bodies also matched the Node reference pass
by deep comparison. The executable identity check failed. The two-worker
ELF `.text` section was 32 bytes larger than the serial control.

| Artifact         |      Bytes | SHA-256                                                            |
| ---------------- | ---------: | ------------------------------------------------------------------ |
| Serial image     | 49,771,592 | `30c2dcb3323529be64ba35c4ca114b112936bc6b2caccf34a2479e3903dcb440` |
| Two-worker image | 49,771,624 | `ac681dd1a39f05df039d85eea03af87305b1eab39cb3d1e06d2652eb62a3ae47` |

The serial image matched the preceding Linux arm64 profile. The sidecar
prototype was rejected on both wall time and executable identity. The
earlier worker result established pass-level determinism on packed IR.
The full compile establishes a downstream identity boundary that a new
transport must pass.

The source and results remain in the experiment directory
under `ssa-sidecar-source`, `ssa-sidecar-control-a`,
`ssa-sidecar-pool-a`, and `ssa-sidecar-structural-compare.log`.
