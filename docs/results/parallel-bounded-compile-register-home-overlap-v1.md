# Overlapping native register-home batch production and analysis

On November 21, 2026, the native Linux arm64 compiler and sidecar
compiled the frozen 821-file compiler. The coordinator still packed
the actual register-home inputs. It published one file at a time.
A FIFO notification released each completed batch to the sidecar.
Six typed workers took available batches while the compiler prepared
the rest.

Both worker runs consumed all 31 batches and used 5,910 precomputed
register-home plans. Each of the four compiles emitted the same ELF
by `cmp`, 49,771,592 bytes, SHA-256
`30c2dcb3323529be64ba35c4ca114b112936bc6b2caccf34a2479e3903dcb440`.

| Run order | Configuration | Wall (s) | CPU (s) | Peak sampled RSS (KiB) | AArch64 emission (s) |
| --------: | ------------- | -------: | ------: | ---------------------: | -------------------: |
|         1 | Six workers   |  375.734 |  315.61 |              7,400,980 |              199.644 |
|         2 | Serial        |  396.974 |  268.47 |              2,095,196 |              173.865 |
|         3 | Serial        |  325.864 |  263.75 |              2,096,920 |              122.119 |
|         4 | Six workers   |  195.019 |  254.68 |              7,503,628 |               85.204 |

CPU sums coordinator and sidecar process time. Peak RSS is the maximum
sampled sum of the two processes at 25 ms intervals. Hardware cycles
were unavailable in the VM. The compiler waited for 30.09 s after
producing the last batch in the first worker run, and 12.01 s in the
second. The broker released every batch in both cases. The second
pair ran after the separate Object capture released the VM CPU and
memory it had held during the first pair. The first pair saved whole
wall time while raising CPU and emitter wall time. The second pair
saved all three. Both six-worker runs consumed over 7 GiB RSS. The
native in-process launcher is a separate experiment.

The first in-process launcher started six typed workers before the
compiler loaded the input. It reached the 900 s timeout with
568.42 s CPU and 4,281,984 KiB RSS. The coordinator had published
zero batches. During inspection all six workers were parked on the
ready word and the coordinator kept using CPU. This launcher had
been built with the worker image's existing global inlining exclusion.
Its result establishes a startup and coordinator cost to isolate before
evaluating a production pool.

A second launcher started two workers on the first batch and packed
only functions above the measured slot-count times operation-count
threshold. Each batch carried its own descriptor projection. A host
build probe preserved inlining outside the worker-marked functions.
The launcher reused 234 worker plans and computed 5,676 inline.
It produced the same ELF in 728.10 s wall and 763.07 s CPU, with
7,444,228 KiB peak RSS. The coordinator spent 23.96 s preparing
requests, 6.40 s waiting after publication and 0.09 s decoding results.
This single trial established exact output for the generated vocabulary
and selective scheduling. Its wall time exceeded the separate native
compiler and sidecar totals.

A selective sidecar moved the same descriptor projection into an
independent native helper. In a pool-first screen, two workers took
164.152 s wall, 203.65 s summed CPU and 5,104,480 KiB peak sampled
RSS. The serial control took 155.540 s wall, 176.98 s CPU and
2,096,544 KiB peak RSS. Both produced the reference ELF. The sidecar
used 234 worker plans, with 9.01 s of coordinator preparation and
22.47 s of handoff and wait. Restricting the producer to those jobs
reduced setup time in this screen, and the full build stayed slower
with two workers.

Raw logs are `register-home-fifo-{pool-overlap,control}-{a,b}`,
`register-home-overlap-rotation.log`,
`register-home-inline-pool6-screen/run.log`,
`register-home-selective-r3-pool2-a/run.log`, and
`register-home-selective-sidecar-{pool,control}-screen`.
