# Native register-home sidecar and local fixup rotations

These November 21, 2026 comparisons used the frozen 821-file
self-compile. Each macOS output matched the 50,163,978-byte
signed reference by `cmp`, SHA-256
`334b71602e62113f13c967a902a728df52e5445eacbe4eec1886bbf27eda9613`.
All measured native inferiors launched under LLDB, stopped at entry
and exited with their expected status.

## macOS sidecar with six workers

The native compiler ran either its ordinary serial register-home
analysis or the file-backed six-worker helper. The helper used
the same 31 batches as the Linux capture. Both pool runs verified
the inputs. The compiler used 5,910 precomputed plans in those runs.
The kernel and result merge were native.

| Run order | Workers | Wall (s) | CPU (s) | Cycles (billions) | Peak sampled RSS (KiB) |
| --------: | ------: | -------: | ------: | ----------------: | ---------------------: |
|         1 |  Serial |  208.000 | 226.409 |           553.197 |              2,101,312 |
|         2 |       6 |  162.567 | 204.665 |           630.580 |              6,626,416 |
|         3 |       6 |  153.780 | 195.469 |           620.285 |              6,615,312 |
|         4 |  Serial |   94.655 | 110.250 |           453.795 |              2,101,552 |

CPU and cycles are sums of the last available compiler and sidecar
samples. RSS is the maximum contemporaneous process sum. Wall
includes both programs and their handoff. The pool saved 45.43 s in
the first pair and added 59.12 s in reverse order. The pools consumed
more cycles and about triple the RSS in both orders. The control
wall times varied by more than a factor of two, so the two pairs
support different whole-build speed conclusions.

## macOS function-local branch fixups

A separate compiler resolved local branches before leaving each body
and kept cross-function and far address fixups for placement. Its
source differed from the incumbent only in the AArch64 encoder and
scalar emitter. This compiler's own stages 2 and 3 matched, with
50,197,002 bytes and SHA-256
`a358d2281e6d85195c1137a14129035637248e8685b01a0b47458050560779a0`.
All 464 focused encoder and scalar emitter tests passed.

| Run order | Emitter       | Wall (s) | CPU (s) | Cycles (billions) | Peak sampled RSS (MiB) |
| --------: | ------------- | -------: | ------: | ----------------: | ---------------------: |
|         1 | Serial fixups |  237.013 | 226.437 |           556.837 |                2,050.0 |
|         2 | Local fixups  |  164.489 | 162.482 |           520.489 |                2,054.9 |
|         3 | Local fixups  |  139.616 | 157.577 |           513.525 |                2,054.7 |
|         4 | Serial fixups |   91.909 | 109.886 |           454.364 |                2,050.9 |

The first pair benefited by 72.524 s and the reverse pair lost
47.707 s. CPU and cycles also moved in opposite directions across
the pairs. The native comparison did not establish a repeatable
throughput improvement for this change. The isolated Object memory
trial required local fixups and stack-map interning together at its
successful heap setting.
[Isolated Object emitter evidence](parallel-bounded-compile-object-local-fixups-v1.md)

## Selective sidecar fixed point on Linux arm64

The selective probe packed only register-home requests above the
threshold from the Node kernel profile. Each batch carried a local
descriptor projection. This replaced the fixed vocabulary and batch
count of the first sidecar. It used the ordinary native compiler
process and a separate typed worker host.

A one-worker compiler produced stage 2 in 193.339 s. Stage 2 used six
workers to produce stage 3 in 112.712 s. Both matched the original
probe compiler, SHA-256
`73497022bad75f02172a54dd18a6cd188364d46d85c62e8e0d86e20fddbc623f`.
Their peak sampled aggregate RSS was 3,521,832 and 5,107,332 KiB.
These are successive fixed-point observations on a shared host.
The performance rotation uses separate controls.

Raw logs are `register-home-darwin-rotation.log`,
`register-home-darwin-{control,pool}-{a,b}`,
`branch-{control,candidate}-{a,b}.*`,
`local-branch-fixed-{2,3}.*`,
`local-branch-codegen-tests.log` and
`register-home-selective-sidecar-fixed.log`.

The selective probe's six-worker performance rotation also reproduced
the frozen compiler reference ELF in every run. Each control ran the same compiler with its serial register-home path.
Hardware cycles were unavailable in the Linux VM.

| Run order | Workers | Wall (s) | CPU (s) | Peak sampled RSS (KiB) | AArch64 emission (s) |
| --------: | ------: | -------: | ------: | ---------------------: | -------------------: |
|         1 |       6 |  100.447 |  137.95 |              5,105,192 |               48.282 |
|         2 |  Serial |   95.700 |  114.55 |              2,096,956 |               42.476 |
|         3 |  Serial |  109.044 |  130.75 |              2,097,660 |               56.934 |
|         4 |       6 |  110.213 |  151.98 |              5,105,600 |               52.615 |

Both six-worker runs used more wall time, CPU and memory than their
paired controls. The stage 2/3 check verified the probe's output
identity. The throughput rotation determined that this pool would
stay experimental.

## Typed store candidate on macOS

The typed store candidate staged optimization changes with the
function store. The default compiler path built the frozen compiler
without an explicit storage request in each run below. All four
images matched the signed reference.

| Run order | Compiler    | Wall (s) | CPU (s) | Cycles (billions) | Peak sampled RSS (MiB) |
| --------: | ----------- | -------: | ------: | ----------------: | ---------------------: |
|         1 | Control     |  180.219 | 179.883 |           542.421 |                2,051.3 |
|         2 | Typed store |  144.683 | 165.570 |           532.534 |                2,090.3 |
|         3 | Typed store |   87.823 | 105.214 |           445.046 |                2,090.5 |
|         4 | Control     |   94.852 | 112.514 |           448.837 |                2,051.8 |

Both orders reduced wall time, CPU and cycles. Peak sampled RSS rose
by 38.7–39.0 MiB on the self-compile. The separate opt-in 8 MiB IR
budget built the identical full Object image and saved 649,183,232
bytes of observed peak RSS. It took 3.76 times as long and the full
build exceeded 2.8 GiB.
[Typed streaming Object image comparison](parallel-bounded-compile-typed-object-image-v1.md)

The corresponding logs are `typed-store-{control,candidate}-{a,b}.*`
and `register-home-selective-sidecar-six-rotate.log`.

The full Object suite build with local branch fixups
compiled a selection of 2,252 input variants at the same 4,096 MiB old-space
setting. It took 676.72 s wall, 787.59 s CPU and 2,879.367 billion
cycles. It reached 5,418,303,488 bytes peak RSS. The earlier Object
control took 524.22 s wall, 663.41 s CPU and 2,191.318 billion cycles,
with 5,448,007,680 bytes peak RSS. The source
snapshots differed in the AArch64 encoder and emitter and in the
LICM and SSA optimizer files. These single runs cannot isolate
the effect of local branch fixups. The candidate image differed at
byte 138 and was 16,512 bytes larger. Its SHA-256 was
`7a8f87735d59c9087369b6a12b90a219f9b0e3c9423b91b72dd67e3c03eee24a`.
The isolated code replay with stack-map interning still reproduced the
reference machine code. The standalone local-branch change was discarded
after the mixed frozen self-compile rotation.

Raw logs are `object-local-branch-compile-only-4096-r3.log` and
`object-optimizer-combined-compile-only-4096.log`. The first two
Object launch attempts stopped during setup. The final run used
monolithic native linking, suite script linking and enabled module cases.
