# Ordered AArch64 worker fragments on the frozen compiler

On November 21, 2026, a Node 24.12.0 capture took 7,111 optimized
functions and their emission options from the frozen 821-file
self-compile. The capture SHA-256 is
`5115e42db0c942900e33cac5d03c82939fa2c7b03d68719445bfb260d7b5fce4`.
The capture build finished normally and its signed output matched the
frozen control by `cmp`, with SHA-256
`334b71602e62113f13c967a902a728df52e5445eacbe4eec1886bbf27eda9613`.

In the replay, each worker read the frozen IR, repeated the module
setup, and emitted only its contiguous function range. Shards wrote
instruction pages, relocations, stack maps and range metadata to files.
The coordinator applied function offsets in order and used the existing
AArch64 layout and patcher. It seeded the 123 dispatch-family numbers
and branch forms from the serial control. The workload requested zero
callback thunks.

| Workers | Serial emission wall (s) | Worker emission plus merge wall (s) | Worker emission plus merge CPU (s) | Whole replay peak RSS (bytes) |
| ------: | -----------------------: | ----------------------------------: | ---------------------------------: | ----------------------------: |
|       1 |                  124.985 |                             142.664 |                            155.442 |                 5,444,681,728 |
|       2 |                  143.656 |                             101.733 |                            188.718 |                 8,548,876,288 |
|       6 |                  119.470 |                             121.390 |                            348.020 |                11,885,395,968 |

All three assembled modules matched the serial module by deep
comparison, including 48,799,664 bytes of code with SHA-256
`ed326c4353628ea079f6e765cbcd2bfb2a89d2b37eb2077d88103c39aab36c75`.
All raw code words also matched the corresponding serial ranges before
final placement.

The two-worker replay saved 41.923 s, or 29.2%, in its serial-first
screen. One and six workers lost to their paired serial emission.
Each row includes a separate preparatory serial pass for the seed.
The column for worker emission plus merge begins after that pass.
Peak RSS covers the entire replay process, including both serial
and worker allocations. This screen compares an emission replay
with precomputed metadata. Native compiler integration and a self-build
with workers remain open.

## Symbolic families and transfer

Two additional two-worker replays assigned dispatch-family IDs during
ordered merge. Fragments recorded first use and held the fixed-width
family instruction operands for patching. They produced the same
code and metadata as the serial reference. The file transport kept
the serial layout's branch-form hints. The transfer variant derived
those hints from the worker results and transferred instruction pages
through worker messages. The frozen input had 123 families, within
the emitter's 128-family limit.

| Two-worker transport | Serial emission wall (s) | Worker emission plus merge wall (s) | Worker emission plus merge CPU (s) | Whole replay peak RSS (bytes) |
| -------------------- | -----------------------: | ----------------------------------: | ---------------------------------: | ----------------------------: |
| Spill                |                  120.580 |                             162.700 |                            194.899 |                 7,889,764,352 |
| Transfer             |                  122.654 |                             125.152 |                            188.150 |                 8,388,526,080 |

Both took longer than their paired serial emission. Replaying the
same global setup in every worker contributes to the time and
memory cost. The logs are `arm64-fragment-symbolic-2.log` and
`arm64-fragment-transfer-2.log`.

## Native register-home profile

A finer native Linux arm64 profile reproduced the 49,771,592-byte ELF
control, SHA-256
`30c2dcb3323529be64ba35c4ca114b112936bc6b2caccf34a2479e3903dcb440`.
It took 450.69 s wall and 383.99 s CPU, with 2,095,816 KiB peak RSS.
Hardware cycles were unavailable in the VM.

Register-home analysis took 52.937 s inside the function loop.
Frame-slot sharing took 12.635 s, reference temporary placement took
3.950 s, and precise safepoint liveness took 4.319 s. The AArch64
register-home kernel uses per-function slots, frame-sharing results,
and the module's no-safepoint summaries.

A typed transport probe using `SharedArrayBuffer` and `Atomics.wait`
failed at link time. The typed program realm did not install the
`SharedArrayBuffer` global. The probe required typed execution.

Logs are `fragment-capture.log`, `arm64-fragment-proof-{1,2,6}.log`,
`frame-kernel-linux.log`, and `native-compiler-shared-wait-build.log`.
