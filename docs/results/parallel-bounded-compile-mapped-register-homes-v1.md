# Earlier worker startup, cached tables and immutable packed input

These screens used the frozen 821-source self-compile described in the
[native transport timeline](parallel-bounded-compile-native-transport-timeline-v1.md).
The Linux arm64 workers used the same slot-home computation and finished
31 batches in the successful configurations. The host ran under both
gate locks. Aggregate RSS sums the coordinator and worker processes,
sampled every 25 ms. The VM does not expose hardware cycle counters.

The release-on-first-batch host entered after about 10 ms. The first
two isolates took about 16 ms from worker process spawn to receipt
of an assignment. Prelaunching before the compiler process moved that
work off the critical path. The isolates entered 41–42 ms after the
compiler launch in that screen and initially blocked for more than
138 s before receiving input. The prelaunched build spent 244.53 s
compiler CPU and 82.58 s worker CPU. Its peak sampled RSS was 5,200,020
KiB versus 5,200,376 KiB in the previous late launch. The wall times
were 268.281 s and 111.633 s. The pre-emission work alone took 123.54 s
and 60.92 s respectively, illustrating co-load variation across lock
acquisitions. These results isolate the startup cost with timestamps.
They are unpaired wall-time screens.

The first cached-table fixture failed after writing batch 0 because
the worker returned the tagged message ID and the host compared it
with the untagged ordinal. That run produced no image. The corrected
host checks the tagged reply against its own tagged assignment. The
worker caches the vocabulary and call summary after its first task.

The read-only mapping variant takes its length from the broker's
published packet metadata. It maps the immutable file once in the
worker, decodes a function at a time and unmaps it at batch completion.
The coordinator still encodes and writes the same bytes. The recipient
avoids the packed input read and copy into a managed byte buffer.

The compiler SHA-256 was
`3dfbdd9ffef191bb65f890064ad16851fa0bdb43cff7b7a6d37321723cec7b99`.
The corrected worker used for cached read and mapped input was
`816c1f06be6e00ff8078e8420b4c09a9be1b11895aa17e2e4520e5aeaa8b5538`.
All four successful worker runs consumed the 31 reference input
files and used 5,910 worker plans. Each produced the same 49,771,592-byte
ELF by `cmp`, SHA-256
`30c2dcb3323529be64ba35c4ca114b112936bc6b2caccf34a2479e3903dcb440`.

| Configuration             | Native build wall (s) | Total CPU (s) | Peak sampled RSS (KiB) | Coordinator prep (s) | Wait after prep (s) |
| ------------------------- | --------------------: | ------------: | ---------------------: | -------------------: | ------------------: |
| Serial                    |               147.560 |        167.78 |              2,097,744 |                    — |                   — |
| Two workers, late         |               111.633 |        155.12 |              5,200,376 |                9.285 |               9.756 |
| Two workers, early        |               268.281 |        327.11 |              5,200,020 |               32.347 |              30.263 |
| Early, cached tables      |               221.635 |        267.85 |              5,200,644 |               19.475 |              19.590 |
| Early, cached, mapped     |               237.100 |        285.18 |              5,179,248 |               23.610 |              21.536 |

| Configuration          | Read or map (s) | Table setup (s) | Decode (s) | Kernel (s) |
| ---------------------- | --------------: | --------------: | ---------: | ---------: |
| Two workers, late      |           0.091 |           0.008 |      0.965 |     32.276 |
| Two workers, early     |           0.741 |           0.197 |      3.286 |     95.991 |
| Early, cached tables   |           0.242 |           0.001 |      2.113 |     64.303 |
| Early, cached, mapped  |           0.122 |           0.032 |      2.472 |     77.121 |

The worker rows sum both worker clocks. A mapping can fault in pages
during decode. These counters show the scale of the measured storage
and setup costs. They do not isolate a wall-time effect from co-load.
File mappings can use the same physical pages in both processes, so
summed RSS can count pages twice. The entire packed input was 42.7 MiB.
Aggregate sampled peak was 4.94 GiB for the mapped worker run and
2.00 GiB serial. The worker computed plans in its own managed heap
while the coordinator retained the module and frame state. Avoiding
the input copy left that overlap intact.

The early, cached and mapped variants were rejected at the RSS gate.
The direct-call census and batch trace also show limits to coarse
independent groups and changing queue order alone. A redesign would
need to release the decoded program before worker allocation peaks
and run more of each function's frame and emission work in the
same worker, using shared immutable input facts.

The mapped fixture's first build attempts failed to resolve its
mapping and external-byte-view dependencies. The corrected fixture
uses the existing platform C-memory and native FFI primitive bindings
inside the sidecar. The compilation path still uses its original
collector.

Raw logs are `register-transport-timeline-early-2/`,
`register-transport-timeline-reuse-2/`,
`register-transport-timeline-reuse-2-r1/`,
`register-transport-timeline-mapped-2-r1/`, and
`register-transport-map-worker-build-r1.log`.
