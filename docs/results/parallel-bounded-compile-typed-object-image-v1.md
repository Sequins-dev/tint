# Typed streaming Object image comparison

On November 21, 2026, the typed streaming prototype compiled all 2,252
variants of the frozen Object selection into one signed macOS arm64
image. The build used Node 24.12.0, 4,096 MiB V8 old space, 4 MiB
semi-spaces, and an 8 MiB packed-IR budget backed by spill files.

The producer stores bodies during lowering. Pruning reads and
renumbers the reachable bodies, the optimizer commits stored changes
in pass order, and the emitter reads the final generation. A regular
in-memory route remains available for comparison.

| Object compile-only variant  | Wall (s) |  CPU (s) | Cycles (billions) | Peak RSS (bytes) |
| ---------------------------- | -------: | -------: | ----------------: | ---------------: |
| Earlier LICM and SSA control |   524.22 |   663.41 |         2,191.318 |    5,448,007,680 |
| Typed streaming prototype    | 1,969.43 | 2,094.54 |         5,490.588 |    4,798,824,448 |

These runs used the same frozen sources. They were run on different
shared-host schedules. The prototype used 649,183,232 fewer RSS bytes
and took 3.76 times as long in the observed runs. The prototype exceeds
the 3,006,477,107-byte limit for the full build.

The executable was 189,938,783 bytes and matched the control by `cmp`.
Both files have SHA-256
`101fb0f4674648a163500a09793b756aec7d1e0baefc4e6ee721f50fd1485290`.
The compile-only harness stops before test execution. The report
establishes image identity for the full variant selection.

## Lower heap screens

The lower-heap screens continued from the typed streaming prototype.
One omitted the final specialization rewrite when there were no local
generated declarations. Another skipped a final syntax hash assignment
in the collection-runtime transform. The last variant combined generic
callee discovery with specialization when the syntax graph allowed it.

| Variant                                                    | V8 old space (MiB) | Wall (s) | CPU (s) | Cycles (billions) | Peak RSS (bytes) |
| ---------------------------------------------------------- | -----------------: | -------: | ------: | ----------------: | ---------------: |
| Conditional specialization rewrite                         |              2,176 |   241.28 |  224.92 |           573.252 |    2,697,641,984 |
| Conditional specialization rewrite                         |              2,368 |   282.34 |  334.77 |           854.488 |    3,128,688,640 |
| Also omit the final collection syntax hash pass            |              2,176 |   193.69 |  234.62 |           597.094 |    3,140,403,200 |
| Fold generic callee discovery into the specialization walk |              2,176 |   168.86 |  220.17 |           540.528 |    3,113,287,680 |

All four ran out of heap during collection-runtime preparation
before lowering the Object functions. The syntax hash variant reached a handoff
with 5,962 statements, 808 runtime roots, 1,942,229,880 bytes of JS
heap in use, and 2,963,210,240 bytes RSS. It entered another helper
specialization before allocation failed. Its last full collection
recorded 2,119.8 MiB of JS heap in use.

The logs are `object-packed-typed-4096.log`,
`object-optimizer-combined-compile-only-4096.log`,
`object-packed-typed-no-copy-2176.log`,
`object-packed-typed-no-copy-2368.log`,
`object-packed-typed-no-final-hash-2176.log`, and
`object-packed-typed-generic-callees-2176.log`.
